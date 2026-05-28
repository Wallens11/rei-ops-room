import { execFile } from "node:child_process";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  inferGithubRepoSlugWithRunner,
  listGithubIssuesWithRunner,
  readDailyDeviceHandoff,
  readExecuteContinuity,
  stripWorkspacePrefix
} from "../server.mjs";
import {
  computeTrustSignals,
  detectFailurePattern,
  formatLearningContext,
  readLearningLog
} from "./execute-learning.mjs";
import { formatMemoryContext, searchMemory } from "./rei-memory.mjs";
import { createGithubRunner } from "./github-api.mjs";

const execFileAsync = promisify(execFile);

function defaultRunner() {
  return process.env.GITHUB_TOKEN
    ? createGithubRunner({ fallbackRunner: execFileAsync })
    : execFileAsync;
}
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

// 2a: Claim cooldown — hindari double-claim kalau issue baru saja di-update proses lain
const EXECUTE_CLAIM_COOLDOWN_SECONDS = 30;

// 2b: Retry policy — blocked issue bisa dicoba ulang dengan backoff
const EXECUTE_MAX_RETRIES = 2;
const EXECUTE_RETRY_BACKOFF_MINUTES = [5, 30]; // backoff per attempt: 1st retry = 5m, 2nd = 30m

// 2c: Weighted scoring — title sinyal paling kuat, label medium, body luas tapi noisy
const SKILL_WEIGHT_TITLE = 3;
const SKILL_WEIGHT_LABEL = 2;
const SKILL_WEIGHT_BODY = 1;

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

/**
 * Cek apakah issue sudah di-approve secara eksplisit untuk eksekusi.
 * Issue dengan `mode:execute + status:approved` = approved.
 * Issue dengan `mode:execute + status:todo` (tanpa status:approved) = awaiting approval.
 */
function isApprovedExecuteIssue(issue) {
  return isExecuteIssue(issue) && hasLabel(issue?.labels, "status:approved");
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
  const lines = [];

  // 3: structured fields didahulukan — info paling penting buat agent
  if (handoff.next_focus_zone) {
    lines.push(`- Next Focus Zone: ${handoff.next_focus_zone}`);
  }

  if (Array.isArray(handoff.active_issues) && handoff.active_issues.length > 0) {
    const refs = handoff.active_issues.map((i) => `#${i.number}`).join(", ");
    lines.push(`- Active Issues: ${refs}`);
  }

  if (Array.isArray(handoff.blockers) && handoff.blockers.length > 0) {
    lines.push(`- Blockers: ${handoff.blockers.slice(0, 2).join(" | ")}`);
  }

  // Fallback ke sections umum — skip yang sudah dihandle di atas
  const HANDLED_SECTION_PATTERNS = ["next focus zone", "focus zone", "blocker", "active issue"];
  const sections = Array.isArray(handoff.sections) ? handoff.sections : [];
  let sectionCount = 0;

  for (const section of sections) {
    if (sectionCount >= 2) {
      break;
    }

    const titleLc = String(section.title || "").toLowerCase();
    if (HANDLED_SECTION_PATTERNS.some((p) => titleLc.includes(p))) {
      continue;
    }

    const items = Array.isArray(section.items) ? section.items.filter(Boolean) : [];
    if (!section.title || items.length === 0) {
      continue;
    }

    lines.push(`- ${section.title}: ${items.slice(0, 2).join(" | ")}`);
    sectionCount++;
  }

  return lines.length > 0 ? lines.join("\n") : "- No current handoff recap was available.";
}

function normalizeDesignTitle(value = "") {
  return String(value || "").replace(/^#\s+/, "").trim();
}

function extractDesignBrand(title = "") {
  const normalized = normalizeDesignTitle(title);
  const match = normalized.match(/inspired by (.+)$/i);
  return match?.[1]?.trim() || normalized || null;
}

function formatDesignProfileLabel(designProfile = null) {
  if (!designProfile) {
    return null;
  }

  if (designProfile.brand) {
    return `${designProfile.brand} inspired DESIGN.md`;
  }

  return designProfile.title || "DESIGN.md";
}

export function readRepoDesignProfile(repoCwd) {
  if (!repoCwd) {
    return null;
  }

  const designPath = path.join(repoCwd, "DESIGN.md");
  let text = "";

  try {
    text = fsSync.readFileSync(designPath, "utf8");
  } catch {
    return null;
  }

  const lines = text.split(/\r?\n/);
  const titleLine = lines.find((line) => line.startsWith("# ")) || "";
  const title = normalizeDesignTitle(titleLine);
  let summary = "";

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    summary = trimmed;
    break;
  }

  return {
    path: designPath,
    title,
    brand: extractDesignBrand(title),
    summary: summary || null
  };
}

function buildDesignGuidanceLines(designProfile = null) {
  if (!designProfile) {
    return [];
  }

  const displayPath = stripWorkspacePrefix(designProfile.path) || designProfile.path;
  const profileLabel = formatDesignProfileLabel(designProfile);

  return [
    "Active design guidance:",
    `- DESIGN.md: ${displayPath}`,
    profileLabel ? `- Profile: ${profileLabel}` : null,
    designProfile.summary ? `- Cue: ${designProfile.summary}` : null,
    "- If the task touches UI, layout, or copy, read and follow DESIGN.md before editing."
  ].filter(Boolean);
}

function buildContinuityPromptLines(continuity = null) {
  if (!continuity?.summary) {
    return [];
  }

  return [
    "",
    `Session continuity snapshot${continuity.generatedAt ? ` (${continuity.generatedAt})` : ""}:`,
    continuity.summary
  ];
}

function buildContinuityAnchor(continuity = null) {
  if (!continuity) {
    return null;
  }

  const fragments = [continuity.repo, continuity.focus, continuity.objective].filter(Boolean);
  return fragments.length > 0 ? fragments.join(" | ") : null;
}

function buildExecuteTrust({
  roadmap = null,
  skillProfile = null,
  designProfile = null,
  continuity = null,
  learningSignals = [],
  failurePattern = null
} = {}) {
  const items = [];

  items.push(
    roadmap?.number
      ? `Queue source: roadmap #${roadmap.number} child queue`
      : "Queue source: explicit mode:execute issue"
  );

  if (skillProfile?.label) {
    items.push(`Assigned profile: ${skillProfile.label}`);
  }

  const continuityAnchor = buildContinuityAnchor(continuity);
  if (continuityAnchor) {
    items.push(`Continuity anchor: ${continuityAnchor}`);
  }

  if (continuity?.liveNow) {
    items.push(`Live signal: ${continuity.liveNow}`);
  }

  if (designProfile && skillProfile?.id === "frontend") {
    items.push(`Design authority: ${formatDesignProfileLabel(designProfile)}`);
  }

  // Inject learning signals — sinyal dari histori run nyata
  for (const signal of (learningSignals || [])) {
    items.push(signal);
  }

  // Failure pattern warning — muncul sebagai item tersendiri kalau ada
  if (failurePattern?.hasWarning && failurePattern.patterns?.length > 0) {
    const topPattern = failurePattern.patterns[0];
    items.push(`⚠️ ${topPattern.message}`);
  }

  return {
    queueSource: roadmap?.number ? "roadmap" : "explicit",
    specialist: skillProfile?.label || null,
    designAuthority: designProfile && skillProfile?.id === "frontend" ? formatDesignProfileLabel(designProfile) : null,
    continuitySummary: continuity?.summary || null,
    riskLevel: failurePattern?.riskLevel || "low",
    items: items.slice(0, 6)
  };
}

function resolveSkillBundle(skillIds = []) {
  return skillIds.map((skillId) => EXECUTE_SKILL_CATALOG[skillId]).filter(Boolean);
}

export function selectExecuteSkillProfile(issue = {}) {
  // 2c: weighted multi-source scoring — title paling kuat, label medium, body luas tapi noisy
  const titleText = String(issue?.title || "").toLowerCase();
  const labelText = normalizeLabelNames(issue?.labels || []).join(" ").toLowerCase();
  const bodyText = String(issue?.body || "").toLowerCase();

  let bestProfile = null;
  let bestScore = 0;

  for (const profile of EXECUTE_SKILL_PROFILES) {
    let score = 0;
    for (const keyword of profile.keywords) {
      if (titleText.includes(keyword)) score += SKILL_WEIGHT_TITLE;
      if (labelText.includes(keyword)) score += SKILL_WEIGHT_LABEL;
      if (bodyText.includes(keyword)) score += SKILL_WEIGHT_BODY;
    }

    // Tie-break: prefer earlier profile in EXECUTE_SKILL_PROFILES (scraping > frontend > backend > docs)
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

/**
 * Expose RUNTIME_PREFERENCES dari runtimes/index.mjs lewat bridge
 * supaya caller yang hanya import execute-bridge tidak perlu tahu soal runtimes/.
 * Lazy import supaya tidak ada circular dep.
 */
/**
 * Bangun prompt untuk direct task (submit via /api/execute/submit).
 * Lebih simpel dari buildExecutePrompt — tidak ada GitHub issue context,
 * tidak ada skill profile. Cukup task, context opsional, dan handoff.
 */
export function buildDirectTaskPrompt({
  task,
  context = null,
  repoCwd,
  handoff = null,
  learningContext = null,
  memoryContext = null,
  continuity = null,
  designProfile = readRepoDesignProfile(repoCwd)
} = {}) {
  const repoLabel = stripWorkspacePrefix(repoCwd) || repoCwd;
  const designGuidanceLines = buildDesignGuidanceLines(designProfile);
  const continuityLines = buildContinuityPromptLines(continuity);

  return [
    `You are Rei, an autonomous agent working inside ${repoCwd} (${repoLabel}).`,
    "",
    "Task:",
    String(task || "").trim() || "No task description provided.",
    context ? `\nAdditional context:\n${String(context).trim()}` : null,
    "",
    `Latest handoff (${handoff?.date || "no date"}):`,
    summarizeHandoff(handoff || {}),
    handoff?.next_focus_zone
      ? `\nOperator-specified next focus zone: ${handoff.next_focus_zone}`
      : null,
    handoff?.blockers?.length > 0
      ? `Known blockers:\n${handoff.blockers.map((b) => `- ${b}`).join("\n")}`
      : null,
    learningContext ? `\n${learningContext}` : null,
    memoryContext ? `\n${memoryContext}` : null,
    ...continuityLines,
    designGuidanceLines.length > 0 ? "" : null,
    ...designGuidanceLines,
    "",
    "Execution rules:",
    "- Inspect the repo before changing anything.",
    "- Implement the smallest safe slice that satisfies the task.",
    "- Run verification before finishing.",
    "- Leave changes locally — do not push or create a PR unless explicitly asked.",
    "- End with a concise summary of what was done."
  ]
    .filter(Boolean)
    .join("\n");
}

export async function selectRuntimeForProfile(profileId) {
  const { selectRuntime, probeAvailableRuntimes } = await import("./runtimes/index.mjs");
  const available = await probeAvailableRuntimes(process.env);
  return selectRuntime(profileId, available);
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

// 2b: Retry helpers — cek apakah blocked issue layak dicoba ulang
const EXECUTE_MARKER_STARTED_RE = /<!--\s*rei:execute\s+issue=\d+\s+state=started\s*-->/g;

export function countExecuteAttempts(comments = []) {
  let count = 0;
  for (const comment of comments) {
    const body = String(comment?.body || "");
    const matches = body.match(EXECUTE_MARKER_STARTED_RE);
    if (matches) {
      count += matches.length;
    }
  }
  return count;
}

export function getLastExecuteAttemptMs(comments = []) {
  let latestMs = null;
  for (const comment of comments) {
    const body = String(comment?.body || "");
    if (!EXECUTE_MARKER_STARTED_RE.test(body)) {
      continue;
    }
    // reset lastIndex karena global regex stateful
    EXECUTE_MARKER_STARTED_RE.lastIndex = 0;
    const createdAt = comment?.createdAt ? Date.parse(String(comment.createdAt)) : NaN;
    if (Number.isFinite(createdAt) && (latestMs === null || createdAt > latestMs)) {
      latestMs = createdAt;
    }
  }
  // reset setelah pemakaian
  EXECUTE_MARKER_STARTED_RE.lastIndex = 0;
  return latestMs;
}

export function isBlockedIssueRetryEligible(issue, comments = [], { nowMs = Date.now(), maxRetries = EXECUTE_MAX_RETRIES, backoffMinutes = EXECUTE_RETRY_BACKOFF_MINUTES } = {}) {
  if (issueStatus(issue) !== "blocked") {
    return false;
  }

  const attemptCount = countExecuteAttempts(comments);
  if (attemptCount >= maxRetries) {
    return false; // sudah habis jatah retry
  }

  const lastAttemptMs = getLastExecuteAttemptMs(comments);
  if (lastAttemptMs === null) {
    return true; // belum pernah ada marker started, boleh retry
  }

  // backoff: cek apakah sudah cukup lama sejak last attempt
  // attemptCount=1 → retry pertama → pakai backoffMinutes[0]; jadi index = attemptCount-1
  const backoffIndex = Math.min(Math.max(0, attemptCount - 1), backoffMinutes.length - 1);
  const requiredBackoffMs = backoffMinutes[backoffIndex] * 60 * 1000;
  const elapsedMs = nowMs - lastAttemptMs;
  return elapsedMs >= requiredBackoffMs;
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

// 2a: claim guard — cek apakah issue baru saja di-update (mungkin sedang diklaim proses lain)
function isWithinClaimCooldown(issue, nowMs = Date.now()) {
  const updatedAt = issue?.updatedAt ? Date.parse(String(issue.updatedAt)) : NaN;
  if (!Number.isFinite(updatedAt)) {
    return false;
  }
  const ageSeconds = (nowMs - updatedAt) / 1000;
  return ageSeconds < EXECUTE_CLAIM_COOLDOWN_SECONDS;
}

export function selectExecuteTarget(payload = {}, { nowMs = Date.now() } = {}) {
  const executeIssues = (payload.issues || []).filter((issue) => isExecuteIssue(issue));

  // 1. in_progress: ambil yang sudah berjalan, tapi skip yang baru saja di-update
  //    (mungkin executor lain baru saja claim-nya)
  const activeIssue = executeIssues
    .filter((issue) => issueStatus(issue) === "in_progress")
    .filter((issue) => !isWithinClaimCooldown(issue, nowMs))
    .sort(byUpdatedAtDesc)[0];

  if (activeIssue) {
    return {
      status: "in_progress",
      issue: formatTarget(activeIssue)
    };
  }

  // 2. Approved: mode:execute + status:approved — approval gate eksplisit.
  //    Hanya issue yang sudah di-approve yang boleh di-execute oleh worker.
  const approvedIssue = executeIssues
    .filter((issue) => isApprovedExecuteIssue(issue) && issueStatus(issue) !== "blocked")
    .sort(byTodoPriority)[0];

  if (approvedIssue) {
    return {
      status: "approved",
      issue: formatTarget(approvedIssue)
    };
  }

  // 3. Awaiting approval: mode:execute + status:todo tapi belum status:approved.
  //    Ditampilkan di UI sebagai "waiting for approval" — worker TIDAK execute ini.
  const todoIssue = executeIssues
    .filter((issue) => issueStatus(issue) === "todo")
    .sort(byTodoPriority)[0];

  if (todoIssue) {
    return {
      status: "awaiting_approval",
      issue: formatTarget(todoIssue)
    };
  }

  return null;
}

/**
 * Ekstrak komentar manusia yang ditulis SETELAH run Rei terakhir dimulai.
 *
 * Dipakai untuk "comment re-prompting": kalau issue in_progress dan ada komentar
 * baru dari manusia (bukan dari Rei), komentar itu di-inject ke prompt supaya
 * Rei bisa course-correct tanpa harus stop/restart worker.
 *
 * @param comments    — array komentar dari GitHub issue (field: body, createdAt, author)
 * @param issueNumber — nomor issue (opsional, tidak dipakai secara fungsional)
 *
 * Return: array komentar manusia baru, atau [] kalau belum ada run sebelumnya.
 */
export function extractNewHumanComments(comments = [], issueNumber = null) {
  const all = Array.isArray(comments) ? comments : [];

  // Cari timestamp komentar Rei terakhir dengan state=started
  const startedRe = /<!--\s*rei:execute\s+issue=\d+\s+state=started\s*-->/;
  let lastReiRunMs = null;

  for (const comment of all) {
    if (!startedRe.test(String(comment?.body || ""))) continue;
    const t = comment?.createdAt ? Date.parse(String(comment.createdAt)) : NaN;
    if (Number.isFinite(t) && (lastReiRunMs === null || t > lastReiRunMs)) {
      lastReiRunMs = t;
    }
  }

  // Belum pernah ada run — fresh start, tidak perlu re-prompt
  if (lastReiRunMs === null) return [];

  // Komentar setelah last started yang bukan dari Rei sendiri
  const reiMarkerRe = /<!--\s*rei:execute/;
  return all.filter((comment) => {
    const body = String(comment?.body || "");
    if (reiMarkerRe.test(body)) return false; // skip komentar Rei
    const t = comment?.createdAt ? Date.parse(String(comment.createdAt)) : NaN;
    return Number.isFinite(t) && t > lastReiRunMs;
  });
}

export function buildExecutePrompt({
  repo,
  repoCwd,
  issue,
  handoff,
  learningContext = null,
  memoryContext = null,
  continuity = null,
  designProfile = readRepoDesignProfile(repoCwd),
  humanComments = []
}) {
  const issueBody = String(issue?.body || "").trim() || "No issue body provided.";
  const repoLabel = stripWorkspacePrefix(repoCwd) || repoCwd;
  const skillProfile = selectExecuteSkillProfile(issue);
  const designGuidanceLines = buildDesignGuidanceLines(designProfile);
  const continuityLines = buildContinuityPromptLines(continuity);
  const skillLines =
    skillProfile.skills.length > 0
      ? skillProfile.skills.map((skill) => `- ${skill.label}: ${skill.path}`).join("\n")
      : "- No specialized skills were matched.";

  const newComments = Array.isArray(humanComments) ? humanComments : [];
  const humanCommentLines = newComments.length > 0
    ? [
        "",
        `⚡ Human corrections since last run (${newComments.length} new comment${newComments.length > 1 ? "s" : ""}):`,
        ...newComments.slice(0, 5).map((c) => {
          const author = c?.author?.login || String(c?.author || "human");
          const body = String(c?.body || "").trim().slice(0, 500);
          return `- @${author}: ${body}`;
        }),
        "→ Incorporate these corrections before continuing."
      ]
    : [];

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
    handoff?.next_focus_zone
      ? `\nOperator-specified next focus zone: ${handoff.next_focus_zone} — lean toward this area unless the issue clearly overrides it.`
      : null,
    handoff?.blockers?.length > 0
      ? `Known blockers from handoff:\n${handoff.blockers.map((b) => `- ${b}`).join("\n")}\nAvoid re-attempting these without a plan to resolve them.`
      : null,
    learningContext ? `\n${learningContext}` : null,
    memoryContext ? `\n${memoryContext}` : null,
    ...continuityLines,
    designGuidanceLines.length > 0 ? "" : null,
    ...designGuidanceLines,
    ...humanCommentLines,
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

function buildExecutePreviewDetail(target, skillProfile, { roadmap = null, designProfile = null } = {}) {
  const specialistLine = skillProfile?.label ? ` Suggested specialist: ${skillProfile.label}.` : "";
  const designLine =
    designProfile && skillProfile?.id === "frontend"
      ? ` Active design profile: ${formatDesignProfileLabel(designProfile)}.`
      : "";

  if (roadmap?.number) {
    return `Roadmap #${roadmap.number} selected #${target.number} as the next unresolved child issue.${specialistLine}${designLine}`;
  }

  if (target?.status === "in_progress") {
    return `Resume the active execute issue #${target.number}.${specialistLine}${designLine}`;
  }

  return `Ready to run the next execute issue #${target.number}.${specialistLine}${designLine}`;
}

export function buildExecuteStartComment({ issue, repoCwd, runtimeLabel = "Codex", runtimePlan = [] }) {
  const runtimePlanLine =
    Array.isArray(runtimePlan) && runtimePlan.length > 0
      ? `Runtime plan: ${runtimePlan.map((runtimeId) => `\`${runtimeId}\``).join(" → ")}`
      : `Runtime: ${runtimeLabel}`;
  const launchLabel = Array.isArray(runtimePlan) && runtimePlan.length > 0 ? runtimePlan[0] : runtimeLabel;

  return [
    `<!-- rei:execute issue=${issue.number} state=started -->`,
    `Rei execute service picked up #${issue.number}.`,
    "",
    `Target: [#${issue.number} ${issue.title}](${issue.url})`,
    `Workspace: \`${repoCwd}\``,
    runtimePlanLine,
    "",
    `The local executor is launching ${launchLabel} now and will post a follow-up summary after verification.`
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildExecuteCompletionComment({
  issue,
  outcome = "completed",
  lastMessage = "",
  runDir = null,
  runtimeId = null
}) {
  const summary = String(lastMessage || "").trim() || "Codex finished without a final summary message.";
  const detail = summary.length > 600 ? `${summary.slice(0, 597)}...` : summary;
  const artifactLine = runDir ? `Artifacts: \`${runDir}\`` : "Artifacts: local worker log only.";
  const runtimeLine = runtimeId ? `Runtime used: \`${runtimeId}\`` : null;
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
    runtimeLine,
    "",
    "Result summary:",
    detail
  ]
    .filter(Boolean)
    .join("\n");
}

export async function prepareExecuteAction({
  runner = defaultRunner(),
  cwd = path.resolve(__dirname, ".."),
  repo = null,
  handoff = null,
  continuity = null
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
  const designProfile = readRepoDesignProfile(cwd);
  const resolvedContinuity = continuity || (await readExecuteContinuity().catch(() => null));

  // Fetch learning entries sekali — dipakai untuk prompt context, trust signals, dan failure detection
  const learningEntries = await readLearningLog().catch(() => []);
  const learningContext = formatLearningContext(learningEntries, { limit: 5 });

  // Helper: build memory context relevant to a given issue (title+body+labels)
  const buildMemoryContextFor = async (issue) => {
    if (!issue) return null;
    const query = [
      issue.title,
      String(issue.body || "").slice(0, 800),
      (issue.labels || []).join(" ")
    ].filter(Boolean).join(" ");
    if (!query.trim()) return null;
    try {
      const hits = await searchMemory(query, { limit: 4, minScore: 0.5 });
      return hits.length > 0 ? formatMemoryContext(hits, { title: "Relevant memory from past runs" }) : null;
    } catch {
      return null;
    }
  };
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
      const memoryContext = await buildMemoryContextFor(issue);
        const prompt = buildExecutePrompt({
          repo: resolvedRepo,
          repoCwd: cwd,
          issue: {
            ...issue,
            roadmap: roadmapTarget.roadmap
          },
          handoff: resolvedHandoff,
          learningContext,
          memoryContext,
          continuity: resolvedContinuity,
          designProfile,
          humanComments: extractNewHumanComments(issue?.comments || [], issue?.number)
        });

      const learningSignals = computeTrustSignals(learningEntries, { profileId: skillProfile?.id, issueNumber: issue?.number });
      const failurePattern = detectFailurePattern(learningEntries, { profileId: skillProfile?.id, issueNumber: issue?.number });
      const trust = buildExecuteTrust({
        roadmap: roadmapTarget.roadmap,
        skillProfile,
        designProfile,
        continuity: resolvedContinuity,
        learningSignals,
        failurePattern
      });

      return {
        repo: resolvedRepo,
        status: "roadmap_ready",
        target: roadmapTarget.issue,
        issue: {
          ...issue,
          roadmap: roadmapTarget.roadmap
        },
        designProfile,
        skillProfile,
        prompt,
        handoff: resolvedHandoff,
        continuity: resolvedContinuity,
        trust,
        detail: buildExecutePreviewDetail(roadmapTarget.issue, skillProfile, {
          roadmap: roadmapTarget.roadmap,
          designProfile
        })
      };
    }
  }

  if (!target?.issue) {
    // 2b: fallback — cek blocked issues yang eligible untuk retry
    const blockedExecuteIssues = (payload.issues || [])
      .filter((issue) => isExecuteIssue(issue) && issueStatus(issue) === "blocked")
      .sort(byUpdatedAtDesc);

    for (const blockedCandidate of blockedExecuteIssues) {
      const fullIssue = await viewIssueWithRunner(runner, {
        repo: resolvedRepo,
        issueNumber: blockedCandidate.number
      });
      if (isBlockedIssueRetryEligible(fullIssue, fullIssue.comments || [])) {
        const skillProfile = selectExecuteSkillProfile(fullIssue);
        const resolvedHandoff = handoff || (await readDailyDeviceHandoff());
        const memoryContext = await buildMemoryContextFor(fullIssue);
        const prompt = buildExecutePrompt({
          repo: resolvedRepo,
          repoCwd: cwd,
          issue: fullIssue,
          handoff: resolvedHandoff,
          learningContext,
          memoryContext,
          continuity: resolvedContinuity,
          designProfile,
          humanComments: extractNewHumanComments(fullIssue?.comments || [], fullIssue?.number)
        });

        const learningSignals = computeTrustSignals(learningEntries, { profileId: skillProfile?.id, issueNumber: fullIssue?.number });
        const failurePattern = detectFailurePattern(learningEntries, { profileId: skillProfile?.id, issueNumber: fullIssue?.number });
        const trust = buildExecuteTrust({
          skillProfile,
          designProfile,
          continuity: resolvedContinuity,
          learningSignals,
          failurePattern
        });

        return {
          repo: resolvedRepo,
          status: "retry",
          target: formatTarget({ ...fullIssue, status: "blocked" }),
          issue: fullIssue,
          designProfile,
          skillProfile,
          prompt,
          handoff: resolvedHandoff,
          continuity: resolvedContinuity,
          trust,
          detail: `Retrying blocked issue #${fullIssue.number} — attempt ${countExecuteAttempts(fullIssue.comments || []) + 1}/${EXECUTE_MAX_RETRIES}.`
        };
      }
    }

    return {
      repo: resolvedRepo,
      status: "no_target",
      target: null,
      issue: null,
      designProfile,
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

  // Approval gate: kalau issue belum di-approve (status:todo tanpa status:approved),
  // return "awaiting_approval" — worker tidak akan execute ini.
  // Hanya issue dengan status:approved yang boleh jalan (atau status:in_progress / retry).
  if (target.status === "awaiting_approval") {
    return {
      repo: resolvedRepo,
      status: "awaiting_approval",
      target: {
        ...target.issue,
        status: target.status
      },
      issue,
      designProfile,
      skillProfile,
      prompt: null,
      handoff: resolvedHandoff,
      continuity: resolvedContinuity,
      trust: buildExecuteTrust({
        skillProfile,
        designProfile,
        continuity: resolvedContinuity,
        learningSignals: computeTrustSignals(learningEntries, { profileId: skillProfile?.id, issueNumber: issue?.number }),
        failurePattern: detectFailurePattern(learningEntries, { profileId: skillProfile?.id, issueNumber: issue?.number })
      }),
      detail: `Issue #${target.issue.number} has mode:execute but needs explicit approval before running. Use /api/github/issues/${target.issue.number}/approve to approve.`
    };
  }

  const memoryContext = await buildMemoryContextFor(issue);
  const prompt = buildExecutePrompt({
    repo: resolvedRepo,
    repoCwd: cwd,
    issue,
    handoff: resolvedHandoff,
    learningContext,
    memoryContext,
    continuity: resolvedContinuity,
    designProfile,
    humanComments: extractNewHumanComments(issue?.comments || [], issue?.number)
  });

  const learningSignals = computeTrustSignals(learningEntries, { profileId: skillProfile?.id, issueNumber: issue?.number });
  const failurePattern = detectFailurePattern(learningEntries, { profileId: skillProfile?.id, issueNumber: issue?.number });
  const trust = buildExecuteTrust({
    skillProfile,
    designProfile,
    continuity: resolvedContinuity,
    learningSignals,
    failurePattern
  });

  return {
    repo: resolvedRepo,
    status: "ready",
    target: {
      ...target.issue,
      status: target.status
    },
    issue,
    designProfile,
    skillProfile,
    prompt,
    handoff: resolvedHandoff,
    continuity: resolvedContinuity,
    trust,
    riskLevel: failurePattern.riskLevel,
    detail: buildExecutePreviewDetail(target.issue, skillProfile, { designProfile })
  };
}

/**
 * Approve issue untuk eksekusi.
 *
 * Menambahkan label `status:approved` dan `mode:execute`, menghapus
 * `mode:report_only` sehingga execute worker bisa pick-up issue ini.
 *
 * Operator memanggil ini via POST /api/github/issues/:number/approve
 * atau via tombol "Approve for Execution" di UI.
 */
export async function approveExecuteIssue({
  runner = defaultRunner(),
  repo,
  issueNumber
} = {}) {
  await editIssueLabelsWithRunner(runner, {
    repo,
    issueNumber,
    addLabels: ["status:approved", "mode:execute"],
    removeLabels: ["mode:report_only"]
  });
}

export async function transitionExecuteIssueToInProgress({
  runner = defaultRunner(),
  repo,
  issueNumber
} = {}) {
  await editIssueLabelsWithRunner(runner, {
    repo,
    issueNumber,
    addLabels: ["status:in_progress", "mode:execute"],
    removeLabels: ["status:todo", "status:approved", "status:blocked", "mode:report_only"]
  });
}

export async function transitionExecuteIssueToDone({
  runner = defaultRunner(),
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
  runner = defaultRunner(),
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
  runner = defaultRunner(),
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
