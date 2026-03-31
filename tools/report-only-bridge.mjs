import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  inferGithubRepoSlugWithRunner,
  listGithubIssuesWithRunner,
  SQLITE_JSON_MAX_BUFFER
} from "../server.mjs";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPORT_ONLY_MARKER_PREFIX = "<!-- rei:report-only issue=";

function normalizeLabelNames(labels = []) {
  return labels.map((label) => (typeof label === "string" ? label : label?.name)).filter(Boolean);
}

function isReportOnlyIssue(issue) {
  const labels = new Set(normalizeLabelNames(issue?.labels || []));
  return (
    labels.has("agent:rei") &&
    labels.has("mode:report_only") &&
    labels.has("status:in_progress")
  );
}

export function selectReportOnlyTarget(payload = {}) {
  const activeNumber = Number(payload?.planner?.activeIssue?.number || 0);

  if (!activeNumber) {
    return null;
  }

  return (
    (payload.issues || []).find(
      (issue) => Number(issue.number || 0) === activeNumber && isReportOnlyIssue(issue)
    ) || null
  );
}

export function hasExistingReportOnlyComment(comments = [], issueNumber) {
  const marker = `${REPORT_ONLY_MARKER_PREFIX}${issueNumber} -->`;
  return comments.some((comment) => String(comment?.body || "").includes(marker));
}

function extractIssueScopeLines(body = "", limit = 3) {
  const lines = String(body || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const scopeHeadingIndex = lines.findIndex((line) => /^#+\s+scope\b/i.test(line));
  if (scopeHeadingIndex >= 0) {
    const scopedBullets = [];

    for (const line of lines.slice(scopeHeadingIndex + 1)) {
      if (/^#+\s+/.test(line)) {
        break;
      }

      if (/^[-*]\s+/.test(line)) {
        scopedBullets.push(line.replace(/^[-*]\s+/, "").trim());
      }
    }

    if (scopedBullets.length > 0) {
      return scopedBullets.slice(0, limit);
    }
  }

  const bullets = lines
    .filter((line) => /^[-*]\s+/.test(line))
    .map((line) => line.replace(/^[-*]\s+/, "").trim())
    .slice(0, limit);

  if (bullets.length > 0) {
    return bullets;
  }

  return lines
    .filter((line) => !line.startsWith("#"))
    .slice(0, limit);
}

export function buildReportOnlyComment({ issue }) {
  const scopeLines = extractIssueScopeLines(issue?.body);
  const marker = `${REPORT_ONLY_MARKER_PREFIX}${issue.number} -->`;
  const readback =
    scopeLines.length > 0
      ? scopeLines.map((line) => `- ${line}`).join("\n")
      : "- Scope will be confirmed from the issue body and current repo context.";

  return [
    marker,
    `Rei report-only pickup for #${issue.number}.`,
    "",
    `Target: [#${issue.number} ${issue.title}](${issue.url})`,
    "",
    "Readback:",
    readback,
    "",
    "Proposed next steps:",
    "1. Inspect the current implementation and recent issue history around this target.",
    "2. Draft the smallest safe change or investigation slice that matches the issue scope.",
    "3. Report verification or blockers before any broader execution.",
    "",
    "I will stay in report-only mode and avoid larger autonomous execution until the next approval gate."
  ].join("\n");
}

function parseArgs(argv) {
  const args = [...argv];
  let repo = null;
  let comment = false;

  while (args.length > 0) {
    const current = args.shift();

    if (current === "--repo") {
      repo = args.shift() || null;
      continue;
    }

    if (current === "--comment") {
      comment = true;
    }
  }

  return {
    repo,
    comment
  };
}

async function ghJsonWithRunner(runner, args) {
  const { stdout } = await runner("gh", args, {
    maxBuffer: SQLITE_JSON_MAX_BUFFER
  });
  const text = stdout.trim();
  return text ? JSON.parse(text) : {};
}

async function viewIssueWithRunner(runner, { repo, issueNumber }) {
  const issue = await ghJsonWithRunner(runner, [
    "issue",
    "view",
    String(issueNumber),
    "--repo",
    repo,
    "--json",
    "number,title,body,url,labels,comments"
  ]);

  return {
    ...issue,
    labels: normalizeLabelNames(issue.labels || [])
  };
}

async function commentIssueWithRunner(runner, { repo, issueNumber, body }) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "rei-report-only-"));
  const bodyFile = path.join(tempDir, "comment.md");

  try {
    await fs.writeFile(bodyFile, body, "utf8");
    await runner(
      "gh",
      ["issue", "comment", String(issueNumber), "--repo", repo, "--body-file", bodyFile],
      {
        maxBuffer: SQLITE_JSON_MAX_BUFFER
      }
    );
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

export async function prepareReportOnlyAction({
  runner = execFileAsync,
  cwd = path.resolve(__dirname, ".."),
  repo = null
} = {}) {
  const resolvedRepo =
    repo ||
    (await inferGithubRepoSlugWithRunner(runner, {
      cwd,
      remoteName: "origin"
    }));
  const payload = await listGithubIssuesWithRunner(runner, {
    repo: resolvedRepo
  });
  const target = selectReportOnlyTarget(payload);

  if (!target) {
    return {
      repo: resolvedRepo,
      status: "no_target",
      canComment: false,
      target: null,
      draft: null,
      detail: "No active report-only issue found."
    };
  }

  const issue = await viewIssueWithRunner(runner, {
    repo: resolvedRepo,
    issueNumber: target.number
  });

  if (hasExistingReportOnlyComment(issue.comments || [], target.number)) {
    return {
      repo: resolvedRepo,
      status: "already_commented",
      canComment: false,
      target: {
        number: issue.number,
        title: issue.title,
        url: issue.url
      },
      draft: null,
      detail: `Report-only comment already exists for issue #${target.number}.`
    };
  }

  return {
    repo: resolvedRepo,
    status: "ready",
    canComment: true,
    target: {
      number: issue.number,
      title: issue.title,
      url: issue.url
    },
    draft: buildReportOnlyComment({ issue }),
    detail: `Report-only action is ready for issue #${target.number}.`
  };
}

export async function executeReportOnlyAction(options = {}) {
  const preview = await prepareReportOnlyAction(options);

  if (preview.status !== "ready" || !preview.target || !preview.draft) {
    return preview;
  }

  await commentIssueWithRunner(options.runner || execFileAsync, {
    repo: preview.repo,
    issueNumber: preview.target.number,
    body: preview.draft
  });

  return {
    ...preview,
    status: "comment_posted",
    canComment: false,
    detail: `Posted report-only comment to issue #${preview.target.number}.`
  };
}

export async function runReportOnlyBridge({
  runner = execFileAsync,
  cwd = path.resolve(__dirname, ".."),
  repo = null,
  comment = false,
  stdout = process.stdout
} = {}) {
  if (!comment) {
    const preview = await prepareReportOnlyAction({
      runner,
      cwd,
      repo
    });

    if (preview.status === "ready") {
      stdout.write(`${preview.draft}\n`);
      return 0;
    }

    stdout.write(`${preview.detail}\n`);
    return 0;
  }

  const result = await executeReportOnlyAction({
    runner,
    cwd,
    repo
  });

  stdout.write(`${result.detail}\n`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = parseArgs(process.argv.slice(2));
  runReportOnlyBridge(options).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
