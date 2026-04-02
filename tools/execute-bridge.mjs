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
const CODEX_SKILLS_ROOT = path.join(os.homedir(), ".codex", "skills");
const EXECUTE_SKILL_CATALOG = {
  "frontend-design": {
    id: "frontend-design",
    label: "frontend-design",
    path: path.join(CODEX_SKILLS_ROOT, "frontend-design", "SKILL.md")
  },
  arrange: {
    id: "arrange",
    label: "arrange",
    path: path.join(CODEX_SKILLS_ROOT, "arrange", "SKILL.md")
  },
  polish: {
    id: "polish",
    label: "polish",
    path: path.join(CODEX_SKILLS_ROOT, "polish", "SKILL.md")
  },
  adapt: {
    id: "adapt",
    label: "adapt",
    path: path.join(CODEX_SKILLS_ROOT, "adapt", "SKILL.md")
  },
  "next-best-practices": {
    id: "next-best-practices",
    label: "next-best-practices",
    path: path.join(CODEX_SKILLS_ROOT, "next-best-practices", "SKILL.md")
  },
  "scrapling-official": {
    id: "scrapling-official",
    label: "scrapling-official",
    path: path.join(CODEX_SKILLS_ROOT, "scrapling-official", "SKILL.md")
  },
  playwright: {
    id: "playwright",
    label: "playwright",
    path: path.join(CODEX_SKILLS_ROOT, "playwright", "SKILL.md")
  },
  "webapp-testing": {
    id: "webapp-testing",
    label: "webapp-testing",
    path: path.join(CODEX_SKILLS_ROOT, "webapp-testing", "SKILL.md")
  },
  "systematic-debugging": {
    id: "systematic-debugging",
    label: "systematic-debugging",
    path: path.join(CODEX_SKILLS_ROOT, "systematic-debugging", "SKILL.md")
  },
  "verification-before-completion": {
    id: "verification-before-completion",
    label: "verification-before-completion",
    path: path.join(CODEX_SKILLS_ROOT, "verification-before-completion", "SKILL.md")
  },
  "requesting-code-review": {
    id: "requesting-code-review",
    label: "requesting-code-review",
    path: path.join(CODEX_SKILLS_ROOT, "requesting-code-review", "SKILL.md")
  },
  clarify: {
    id: "clarify",
    label: "clarify",
    path: path.join(CODEX_SKILLS_ROOT, "clarify", "SKILL.md")
  }
};
const EXECUTE_SKILL_PROFILES = [
  {
    id: "scraping",
    label: "Scraping specialist",
    keywords: [
      "scrape",
      "scraping",
      "crawl",
      "extract",
      "parser",
      "anti-bot",
      "cloudflare",
      "playwright",
      "browser automation",
      "page data"
    ],
    reason: "Issue points at scraping, extraction, or browser automation work.",
    skills: ["scrapling-official", "playwright", "webapp-testing"]
  },
  {
    id: "frontend",
    label: "Frontend specialist",
    keywords: [
      "frontend",
      "ui",
      "ux",
      "layout",
      "spacing",
      "styling",
      "style",
      "css",
      "panel",
      "viewer",
      "widget",
      "room",
      "pixel",
      "component",
      "responsive",
      "screen",
      "button"
    ],
    reason: "Issue is centered on UI, layout, or interaction polish.",
    skills: ["frontend-design", "arrange", "polish", "adapt", "next-best-practices"]
  },
  {
    id: "backend",
    label: "Backend specialist",
    keywords: [
      "backend",
      "api",
      "server",
      "worker",
      "webhook",
      "queue",
      "sync",
      "service",
      "bridge",
      "route",
      "endpoint"
    ],
    reason: "Issue is centered on server-side flow, workers, or integration plumbing.",
    skills: ["systematic-debugging", "verification-before-completion", "requesting-code-review"]
  },
  {
    id: "docs",
    label: "Docs and guidance specialist",
    keywords: ["docs", "copy", "message", "label", "explain", "summary", "comment", "readme"],
    reason: "Issue is mostly about language clarity, docs, or outward communication.",
    skills: ["clarify", "requesting-code-review", "verification-before-completion"]
  }
];

function normalizeLabelNames(labels = []) {
  return labels.map((label) => (typeof label === "string" ? label : label?.name)).filter(Boolean);
}

function hasLabel(labels = [], label) {
  return normalizeLabelNames(labels).includes(label);
}

function hasAnyModeLabel(labels = []) {
  return normalizeLabelNames(labels).some((label) => label.startsWith("mode:"));
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

function isRoadmapIssue(issue) {
  return hasLabel(issue?.labels, "agent:rei") && !hasAnyModeLabel(issue?.labels);
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

function resolveSkillBundle(skillIds = []) {
  return skillIds.map((skillId) => EXECUTE_SKILL_CATALOG[skillId]).filter(Boolean);
}

export function selectExecuteSkillProfile(issue = {}) {
  const text = `${issue?.title || ""}\n${issue?.body || ""}\n${normalizeLabelNames(issue?.labels || []).join(" ")}`
    .toLowerCase();
  let bestProfile = null;
  let bestScore = 0;

  for (const profile of EXECUTE_SKILL_PROFILES) {
    const score = profile.keywords.reduce((total, keyword) => total + (text.includes(keyword) ? 1 : 0), 0);

    if (score > bestScore) {
      bestProfile = profile;
      bestScore = score;
    }
  }

  if (bestProfile && bestScore > 0) {
    return {
      id: bestProfile.id,
      label: bestProfile.label,
      reason: bestProfile.reason,
      skills: resolveSkillBundle(bestProfile.skills)
    };
  }

  return {
    id: "general",
    label: "General implementation specialist",
    reason: "No narrower domain dominated the issue text, so keep the default implementation discipline tight.",
    skills: resolveSkillBundle([
      "systematic-debugging",
      "verification-before-completion",
      "requesting-code-review"
    ])
  };
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
    "number,title,body,url,labels,comments"
  ]);

  return {
    ...issue,
    labels: normalizeLabelNames(issue.labels || []),
    comments: Array.isArray(issue.comments) ? issue.comments : []
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

function extractIssueNumbers(text = "") {
  const seen = new Set();
  const issueNumbers = [];

  for (const match of String(text || "").matchAll(/#(\d+)/g)) {
    const issueNumber = Number(match[1] || 0);
    if (!issueNumber || seen.has(issueNumber)) {
      continue;
    }

    seen.add(issueNumber);
    issueNumbers.push(issueNumber);
  }

  return issueNumbers;
}

function getRoadmapChildIssueNumbers(roadmap = {}) {
  const issueNumbers = [];
  const seen = new Set();
  const fragments = [
    roadmap.body || "",
    ...(Array.isArray(roadmap.comments) ? roadmap.comments.map((comment) => comment?.body || "") : [])
  ];

  for (const fragment of fragments) {
    for (const issueNumber of extractIssueNumbers(fragment)) {
      if (issueNumber === Number(roadmap.number || 0) || seen.has(issueNumber)) {
        continue;
      }

      seen.add(issueNumber);
      issueNumbers.push(issueNumber);
    }
  }

  return issueNumbers;
}

function attachRoadmap(target, roadmap) {
  return {
    ...formatTarget(target),
    roadmap: formatTarget(roadmap),
    queueSource: "roadmap"
  };
}

async function selectRoadmapTarget({ payload = {}, repo, runner }) {
  const openIssues = Array.isArray(payload.issues) ? payload.issues : [];
  const openIssueMap = new Map(
    openIssues.map((issue) => [
      Number(issue?.number || 0),
      issue
    ])
  );
  const roadmapIssues = openIssues.filter((issue) => isRoadmapIssue(issue)).sort(byUpdatedAtDesc);

  for (const roadmapCandidate of roadmapIssues) {
    const roadmap = await viewIssueWithRunner(runner, {
      repo,
      issueNumber: roadmapCandidate.number
    });
    const childIssueNumbers = getRoadmapChildIssueNumbers(roadmap);

    for (const childIssueNumber of childIssueNumbers) {
      const childIssue = openIssueMap.get(childIssueNumber);
      if (!childIssue) {
        continue;
      }

      const status = issueStatus(childIssue);
      const target = attachRoadmap(
        {
          ...childIssue,
          status
        },
        roadmap
      );

      if (status === "blocked") {
        return {
          status: "roadmap_blocked",
          issue: target,
          roadmap: formatTarget(roadmap)
        };
      }

      if (status === "in_progress" || status === "todo" || status === "open") {
        return {
          status: "roadmap_ready",
          issue: target,
          roadmap: formatTarget(roadmap)
        };
      }
    }
  }

  return null;
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
  const skillProfile = selectExecuteSkillProfile(issue);
  const skillLines =
    skillProfile.skills.length > 0
      ? skillProfile.skills.map((skill) => `- ${skill.label}: ${skill.path}`).join("\n")
      : "- No specialized skills were matched.";

  return [
    `You are handling GitHub issue #${issue.number} in repo ${repo}.`,
    `Work only inside ${repoCwd} (${repoLabel}).`,
    "",
    "Issue context:",
    `- Title: ${issue.title}`,
    `- URL: ${issue.url || "n/a"}`,
    `- Labels: ${(issue.labels || []).join(", ") || "none"}`,
    issue?.roadmap?.number
      ? `- Selected from roadmap: #${issue.roadmap.number} ${issue.roadmap.title || "Untitled roadmap"}`
      : null,
    "",
    "Issue body:",
    issueBody,
    "",
    "Suggested specialist profile:",
    `- Profile: ${skillProfile.label}`,
    `- Why: ${skillProfile.reason}`,
    "- Recommended skills to use if they match the work:",
    skillLines,
    "",
    `Latest handoff (${handoff?.date || "no date"}):`,
    summarizeHandoff(handoff),
    "",
    "Execution rules:",
    "- Inspect the repository and issue history before changing code.",
    "- Lean on the suggested specialist profile and skills before falling back to generic implementation patterns.",
    "- Implement the smallest safe slice that satisfies the issue scope.",
    "- Run the relevant verification before finishing.",
    "- Leave the working tree changes in place locally.",
    "- Do not push or create a PR unless explicitly asked.",
    "- End with a concise summary suitable for posting back to the GitHub issue."
  ]
    .filter(Boolean)
    .join("\n");
}

function buildExecutePreviewDetail(target, skillProfile, { roadmap = null } = {}) {
  const specialistLine = skillProfile?.label ? ` Suggested specialist: ${skillProfile.label}.` : "";

  if (roadmap?.number) {
    return `Roadmap #${roadmap.number} selected #${target.number} as the next unresolved child issue.${specialistLine}`;
  }

  if (target?.status === "in_progress") {
    return `Resume the active execute issue #${target.number}.${specialistLine}`;
  }

  return `Ready to run the next execute issue #${target.number}.${specialistLine}`;
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
    const roadmapTarget = await selectRoadmapTarget({
      payload,
      repo: resolvedRepo,
      runner
    });

    if (roadmapTarget?.status === "roadmap_blocked") {
      return {
        repo: resolvedRepo,
        status: "roadmap_blocked",
        target: roadmapTarget.issue,
        issue: null,
        prompt: null,
        handoff: null,
        detail: `Roadmap #${roadmapTarget.roadmap.number} is halted because #${roadmapTarget.issue.number} is blocked.`
      };
    }

    if (roadmapTarget?.status === "roadmap_ready" && roadmapTarget.issue) {
      const issue = await viewIssueWithRunner(runner, {
        repo: resolvedRepo,
        issueNumber: roadmapTarget.issue.number
      });
      const skillProfile = selectExecuteSkillProfile(issue);
      const resolvedHandoff = handoff || (await readDailyDeviceHandoff());
      const prompt = buildExecutePrompt({
        repo: resolvedRepo,
        repoCwd: cwd,
        issue: {
          ...issue,
          roadmap: roadmapTarget.roadmap
        },
        handoff: resolvedHandoff
      });

      return {
        repo: resolvedRepo,
        status: "roadmap_ready",
        target: roadmapTarget.issue,
        issue: {
          ...issue,
          roadmap: roadmapTarget.roadmap
        },
        skillProfile,
        prompt,
        handoff: resolvedHandoff,
        detail: buildExecutePreviewDetail(roadmapTarget.issue, skillProfile, {
          roadmap: roadmapTarget.roadmap
        })
      };
    }
  }

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
  const skillProfile = selectExecuteSkillProfile(issue);
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
    skillProfile,
    prompt,
    handoff: resolvedHandoff,
    detail: buildExecutePreviewDetail(target.issue, skillProfile)
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
    addLabels: ["status:in_progress", "mode:execute"],
    removeLabels: ["status:todo", "status:blocked", "mode:report_only"]
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
