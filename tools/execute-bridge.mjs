import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  inferGithubRepoSlugWithRunner,
  listGithubIssuesWithRunner,
  readDailyDeviceHandoff,
  stripWorkspacePrefix
} from "../server.mjs";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

function normalizeLabelNames(labels = []) {
  return labels.map((label) => (typeof label === "string" ? label : label?.name)).filter(Boolean);
}

function hasLabel(labels = [], label) {
  return normalizeLabelNames(labels).includes(label);
}

function issueStatus(issue) {
  const labels = normalizeLabelNames(issue?.labels || []);

  if (labels.includes("status:in_progress")) {
    return "in_progress";
  }

  if (labels.includes("status:todo")) {
    return "todo";
  }

  if (labels.includes("status:blocked")) {
    return "blocked";
  }

  if (labels.includes("status:done")) {
    return "done";
  }

  return "open";
}

function isExecuteIssue(issue) {
  return hasLabel(issue?.labels, "agent:rei") && hasLabel(issue?.labels, "mode:execute");
}

function byUpdatedAtDesc(left, right) {
  return String(right?.updatedAt || "").localeCompare(String(left?.updatedAt || ""));
}

function byTodoPriority(left, right) {
  const creationOrder = String(right?.createdAt || right?.updatedAt || "").localeCompare(
    String(left?.createdAt || left?.updatedAt || "")
  );

  if (creationOrder !== 0) {
    return creationOrder;
  }

  return byUpdatedAtDesc(left, right);
}

function summarizeHandoff(handoff = {}) {
  const sections = Array.isArray(handoff.sections) ? handoff.sections : [];
  const lines = [];

  for (const section of sections.slice(0, 3)) {
    const items = Array.isArray(section.items) ? section.items.filter(Boolean) : [];
    if (!section.title || items.length === 0) {
      continue;
    }

    lines.push(`- ${section.title}: ${items.slice(0, 2).join(" | ")}`);
  }

  return lines.length > 0 ? lines.join("\n") : "- No current handoff recap was available.";
}

async function ghJsonWithRunner(runner, args) {
  const { stdout } = await runner("gh", args);
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
    "number,title,body,url,labels"
  ]);

  return {
    ...issue,
    labels: normalizeLabelNames(issue.labels || [])
  };
}

async function editIssueLabelsWithRunner(runner, { repo, issueNumber, addLabels = [], removeLabels = [] }) {
  const args = ["issue", "edit", String(issueNumber), "--repo", repo];

  for (const label of addLabels.filter(Boolean)) {
    args.push("--add-label", label);
  }

  for (const label of removeLabels.filter(Boolean)) {
    args.push("--remove-label", label);
  }

  await runner("gh", args);
}

async function commentIssueWithRunner(runner, { repo, issueNumber, body }) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "rei-execute-"));
  const bodyFile = path.join(tempDir, "comment.md");

  try {
    await fs.writeFile(bodyFile, body, "utf8");
    await runner("gh", ["issue", "comment", String(issueNumber), "--repo", repo, "--body-file", bodyFile]);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function closeIssueWithRunner(runner, { repo, issueNumber, reason = "completed" }) {
  await runner("gh", ["issue", "close", String(issueNumber), "--repo", repo, "--reason", reason]);
}

function formatTarget(target) {
  if (!target) {
    return null;
  }

  return {
    number: Number(target.number || 0),
    title: target.title || "Untitled issue",
    url: target.url || null,
    status: target.status || issueStatus(target)
  };
}

export function selectExecuteTarget(payload = {}) {
  const executeIssues = (payload.issues || []).filter((issue) => isExecuteIssue(issue));
  const activeIssue = executeIssues
    .filter((issue) => issueStatus(issue) === "in_progress")
    .sort(byUpdatedAtDesc)[0];

  if (activeIssue) {
    return {
      status: "in_progress",
      issue: formatTarget(activeIssue)
    };
  }

  const todoIssue = executeIssues
    .filter((issue) => issueStatus(issue) === "todo")
    .sort(byTodoPriority)[0];

  if (todoIssue) {
    return {
      status: "todo",
      issue: formatTarget(todoIssue)
    };
  }

  return null;
}

export function buildExecutePrompt({ repo, repoCwd, issue, handoff }) {
  const issueBody = String(issue?.body || "").trim() || "No issue body provided.";
  const repoLabel = stripWorkspacePrefix(repoCwd) || repoCwd;

  return [
    `You are handling GitHub issue #${issue.number} in repo ${repo}.`,
    `Work only inside ${repoCwd} (${repoLabel}).`,
    "",
    "Issue context:",
    `- Title: ${issue.title}`,
    `- URL: ${issue.url || "n/a"}`,
    `- Labels: ${(issue.labels || []).join(", ") || "none"}`,
    "",
    "Issue body:",
    issueBody,
    "",
    `Latest handoff (${handoff?.date || "no date"}):`,
    summarizeHandoff(handoff),
    "",
    "Execution rules:",
    "- Inspect the repository and issue history before changing code.",
    "- Implement the smallest safe slice that satisfies the issue scope.",
    "- Run the relevant verification before finishing.",
    "- Leave the working tree changes in place locally.",
    "- Do not push or create a PR unless explicitly asked.",
    "- End with a concise summary suitable for posting back to the GitHub issue."
  ].join("\n");
}

export function buildExecuteStartComment({ issue, repoCwd }) {
  return [
    `<!-- rei:execute issue=${issue.number} state=started -->`,
    `Rei execute service picked up #${issue.number}.`,
    "",
    `Target: [#${issue.number} ${issue.title}](${issue.url})`,
    `Workspace: \`${repoCwd}\``,
    "",
    "The local executor is launching Codex now and will post a follow-up summary after verification."
  ].join("\n");
}

export function buildExecuteCompletionComment({
  issue,
  outcome = "completed",
  lastMessage = "",
  runDir = null
}) {
  const summary = String(lastMessage || "").trim() || "Codex finished without a final summary message.";
  const detail = summary.length > 600 ? `${summary.slice(0, 597)}...` : summary;
  const artifactLine = runDir ? `Artifacts: \`${runDir}\`` : "Artifacts: local worker log only.";
  const stateVerb =
    outcome === "completed"
      ? "finished"
      : outcome === "review_needed"
        ? "finished without closing"
        : "stopped";

  return [
    `<!-- rei:execute issue=${issue.number} state=${outcome} -->`,
    `Rei execute service ${stateVerb} #${issue.number}.`,
    "",
    `Target: [#${issue.number} ${issue.title}](${issue.url})`,
    artifactLine,
    "",
    "Result summary:",
    detail
  ].join("\n");
}

export async function prepareExecuteAction({
  runner = execFileAsync,
  cwd = path.resolve(__dirname, ".."),
  repo = null,
  handoff = null
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
  const target = selectExecuteTarget(payload);

  if (!target?.issue) {
    return {
      repo: resolvedRepo,
      status: "no_target",
      target: null,
      issue: null,
      prompt: null,
      detail: "No active mode:execute issue is ready in the tracked queue."
    };
  }

  const issue = await viewIssueWithRunner(runner, {
    repo: resolvedRepo,
    issueNumber: target.issue.number
  });
  const resolvedHandoff = handoff || (await readDailyDeviceHandoff());
  const prompt = buildExecutePrompt({
    repo: resolvedRepo,
    repoCwd: cwd,
    issue,
    handoff: resolvedHandoff
  });

  return {
    repo: resolvedRepo,
    status: "ready",
    target: {
      ...target.issue,
      status: target.status
    },
    issue,
    prompt,
    handoff: resolvedHandoff,
    detail:
      target.status === "in_progress"
        ? `Resume the active execute issue #${target.issue.number}.`
        : `Ready to run the next execute issue #${target.issue.number}.`
  };
}

export async function transitionExecuteIssueToInProgress({
  runner = execFileAsync,
  repo,
  issueNumber
} = {}) {
  await editIssueLabelsWithRunner(runner, {
    repo,
    issueNumber,
    addLabels: ["status:in_progress"],
    removeLabels: ["status:todo", "status:blocked"]
  });
}

export async function transitionExecuteIssueToDone({
  runner = execFileAsync,
  repo,
  issueNumber
} = {}) {
  await editIssueLabelsWithRunner(runner, {
    repo,
    issueNumber,
    addLabels: [],
    removeLabels: ["status:todo", "status:in_progress", "status:blocked"]
  });
  await closeIssueWithRunner(runner, {
    repo,
    issueNumber
  });
}

export async function transitionExecuteIssueToBlocked({
  runner = execFileAsync,
  repo,
  issueNumber
} = {}) {
  await editIssueLabelsWithRunner(runner, {
    repo,
    issueNumber,
    addLabels: ["status:blocked"],
    removeLabels: ["status:todo", "status:in_progress"]
  });
}

export async function postExecuteIssueComment({
  runner = execFileAsync,
  repo,
  issueNumber,
  body
} = {}) {
  await commentIssueWithRunner(runner, {
    repo,
    issueNumber,
    body
  });
}
