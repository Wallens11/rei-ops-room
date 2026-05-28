/**
 * execute-learning.mjs — Post-run learning loop.
 *
 * Every execute run (GitHub issue or direct task) leaves an insight:
 *   - which files were changed
 *   - outcome: completed / review_needed / failed
 *   - which runtime was used
 *   - a short summary from the agent's last message
 *
 * Insights are collected in .execute-learning.json and injected into the
 * next run's prompt via formatLearningContext().
 *
 * Result: Rei knows what worked, what got stuck, and which areas have been
 * touched often — without having to re-read the entire git log.
 *
 * Cross-session note (for other LLMs continuing this work):
 *   - Learning log: .execute-learning.json (excluded via .gitignore)
 *   - Max entries: 50 (auto-trims oldest)
 *   - Format context is injected into buildExecutePrompt + buildDirectTaskPrompt
 *     via the `learningContext` parameter (string)
 */

import fs from "node:fs/promises";
import path from "node:path";

import { projectRoot } from "./execute-worker-state.mjs";

export const learningLogFile = path.join(projectRoot, ".execute-learning.json");

const MAX_ENTRIES = 50;
const SUMMARY_MAX_CHARS = 280;

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function readLog() {
  try {
    const text = await fs.readFile(learningLogFile, "utf8");
    const parsed = JSON.parse(text);
    return Array.isArray(parsed?.entries) ? parsed.entries : [];
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

async function writeLog(entries) {
  await fs.writeFile(
    learningLogFile,
    `${JSON.stringify({ entries }, null, 2)}\n`,
    "utf8"
  );
}

/**
 * Extract a short summary from the agent's last message.
 * Takes the first substantive sentence — skips markdown headings.
 */
export function extractKeySummary(lastMessage = "") {
  const text = String(lastMessage || "").trim();
  if (!text) return null;

  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#") && !l.startsWith("---") && l.length > 20);

  const candidate = lines[0] || "";
  return candidate.length > SUMMARY_MAX_CHARS
    ? `${candidate.slice(0, SUMMARY_MAX_CHARS - 1)}…`
    : candidate || null;
}

// ─── Core API ─────────────────────────────────────────────────────────────────

/**
 * Read all learning entries.
 */
export async function readLearningLog() {
  return readLog();
}

/**
 * Alias for readLearningLog — used by adaptive runtime selection.
 */
export const getLearningEntries = readLearningLog;

/**
 * Record an insight from a completed run.
 *
 * @param issueNumber  — GitHub issue number (null for direct tasks)
 * @param taskTitle    — issue title or short description of the direct task
 * @param runtimeId    — "codex" | "claude-code"
 * @param profileId    — specialist profile: "frontend" | "backend" | "general" | ...
 * @param outcome      — "completed" | "review_needed" | "failed" | "aborted"
 * @param filesChanged — array of relative paths of changed files
 * @param lastMessage  — last output text from the agent
 */
export async function recordRunInsight({
  issueNumber = null,
  taskTitle = "",
  runtimeId = "codex",
  profileId = "general",
  outcome = "unknown",
  filesChanged = [],
  lastMessage = ""
} = {}) {
  const entries = await readLog();

  const entry = {
    date: new Date().toISOString().slice(0, 10),
    recordedAt: new Date().toISOString(),
    issueNumber: issueNumber ?? null,
    taskTitle: String(taskTitle || "").trim().slice(0, 120),
    runtimeId,
    profileId: String(profileId || "general"),
    outcome,
    filesChanged: (filesChanged || []).slice(0, 20), // cap to avoid growing too large
    keySummary: extractKeySummary(lastMessage)
  };

  entries.push(entry);

  // Trim to MAX_ENTRIES — discard the oldest
  const trimmed = entries.slice(-MAX_ENTRIES);
  await writeLog(trimmed);

  return entry;
}

// ─── Prompt injection ────────────────────────────────────────────────────────

/**
 * Format learning entries into text that can be injected into a prompt.
 * Takes only the `limit` most recent entries.
 *
 * Return: ready-to-use string, or null if there are no entries.
 */
export function formatLearningContext(entries = [], { limit = 5 } = {}) {
  if (!entries || entries.length === 0) return null;

  const recent = entries.slice(-limit).reverse(); // newest first

  const lines = recent.map((e) => {
    const ref = e.issueNumber ? `#${e.issueNumber}` : "direct";
    const title = e.taskTitle ? ` "${e.taskTitle.slice(0, 60)}"` : "";
    const runtime = e.runtimeId ?? "?";
    const outcome = e.outcome ?? "unknown";
    const files =
      e.filesChanged?.length > 0
        ? ` — changed: ${e.filesChanged.slice(0, 3).join(", ")}${e.filesChanged.length > 3 ? ` +${e.filesChanged.length - 3} more` : ""}`
        : " — no file changes";
    const summary = e.keySummary ? `\n    ↳ ${e.keySummary}` : "";

    return `- [${e.date}] ${outcome} ${ref}${title} (${runtime})${files}${summary}`;
  });

  return `Recent run history (use to avoid repeating past mistakes):\n${lines.join("\n")}`;
}

/**
 * Read the log and format immediately — shortcut for prompt builders.
 */
export async function getLearningContext({ limit = 5 } = {}) {
  const entries = await readLearningLog();
  return formatLearningContext(entries, { limit });
}

// ─── Trust signals ────────────────────────────────────────────────────────────

/**
 * Compute trust signals from learning entries for display in the UI.
 *
 * @param entries    — all learning entries
 * @param profileId  — "frontend" | "backend" | "general" | ...
 * @param issueNumber — number of the issue being processed (null for direct tasks)
 *
 * Return: array of signal strings (max 4), or [] if there's no data yet.
 */
export function computeTrustSignals(entries = [], { profileId = "general", issueNumber = null } = {}) {
  const signals = [];
  const allEntries = Array.isArray(entries) ? entries : [];

  // Signal 1: success rate for this profile type (last 10 runs)
  const profileEntries = allEntries.filter((e) => e.profileId === profileId).slice(-10);
  if (profileEntries.length >= 2) {
    const completed = profileEntries.filter((e) => e.outcome === "completed").length;
    const pct = Math.round((completed / profileEntries.length) * 100);
    signals.push(`${profileId} tasks: ${completed}/${profileEntries.length} completed (${pct}%)`);
  }

  // Signal 2: best runtime for this profile (if enough data is available)
  const runtimeStats = {};
  for (const e of profileEntries) {
    if (!e.runtimeId) continue;
    if (!runtimeStats[e.runtimeId]) runtimeStats[e.runtimeId] = { ok: 0, total: 0 };
    runtimeStats[e.runtimeId].total++;
    if (e.outcome === "completed") runtimeStats[e.runtimeId].ok++;
  }
  const bestEntry = Object.entries(runtimeStats)
    .filter(([, s]) => s.total >= 2)
    .sort(([, a], [, b]) => b.ok / b.total - a.ok / a.total)[0];
  if (bestEntry) {
    const [runtimeId, stats] = bestEntry;
    signals.push(`best runtime for ${profileId}: ${runtimeId} (${stats.ok}/${stats.total} ok)`);
  }

  // Signal 3: history for the same issue (when issueNumber is provided)
  if (issueNumber != null) {
    const issueEntries = allEntries.filter((e) => e.issueNumber === issueNumber);
    if (issueEntries.length > 0) {
      const last = issueEntries[issueEntries.length - 1];
      const recordedAt = last.recordedAt ? new Date(last.recordedAt).getTime() : null;
      const daysAgo = recordedAt ? Math.round((Date.now() - recordedAt) / 86_400_000) : null;
      const when = daysAgo === null ? "unknown" : daysAgo === 0 ? "today" : `${daysAgo}d ago`;
      signals.push(`issue #${issueNumber}: last attempt ${when} — ${last.outcome}`);
    }
  }

  // Signal 4: global success rate (all entries, last 20 max)
  const globalRecent = allEntries.slice(-20);
  if (globalRecent.length >= 5 && profileEntries.length < 2) {
    // Only show if the profile signal isn't already present (avoid duplication)
    const globalCompleted = globalRecent.filter((e) => e.outcome === "completed").length;
    const globalPct = Math.round((globalCompleted / globalRecent.length) * 100);
    signals.push(`overall: ${globalCompleted}/${globalRecent.length} tasks completed (${globalPct}%)`);
  }

  return signals.slice(0, 4);
}

// ─── Failure pattern detection ────────────────────────────────────────────────

/**
 * Detect failure patterns to watch out for before execution.
 *
 * Pattern 1: same issue failed 2+ times → high risk
 * Pattern 2: high profile type failure rate (>60% in the last 5 runs) → medium risk
 *
 * @param entries    — all learning entries
 * @param profileId  — profile of the task about to run
 * @param issueNumber — target issue number (null for direct tasks)
 * @param window     — how many recent entries to analyse for the profile streak (default 5)
 *
 * Return: { hasWarning, riskLevel: "low"|"medium"|"high", patterns: [{type, severity, message}] }
 */
export function detectFailurePattern(entries = [], { profileId = "general", issueNumber = null, window: recentWindow = 5 } = {}) {
  const allEntries = Array.isArray(entries) ? entries : [];
  const patterns = [];

  // Pattern 1: same issue failing repeatedly
  if (issueNumber != null) {
    const issueEntries = allEntries.filter((e) => e.issueNumber === issueNumber);
    const failCount = issueEntries.filter((e) => e.outcome === "failed").length;
    if (failCount >= 2) {
      patterns.push({
        type: "repeated_issue_failure",
        severity: failCount >= 3 ? "high" : "medium",
        message: `Issue #${issueNumber} has failed ${failCount}× — consider changing approach or runtime.`
      });
    }
  }

  // Pattern 2: profile type failure streak
  const recentProfileEntries = allEntries.filter((e) => e.profileId === profileId).slice(-recentWindow);
  if (recentProfileEntries.length >= 3) {
    const failCount = recentProfileEntries.filter((e) => e.outcome === "failed").length;
    const failRate = failCount / recentProfileEntries.length;
    if (failRate >= 0.6) {
      patterns.push({
        type: "profile_failure_streak",
        severity: "medium",
        message: `${profileId} tasks failing ${Math.round(failRate * 100)}% recently — runtime or prompt may need review.`
      });
    }
  }

  const riskLevel = patterns.some((p) => p.severity === "high")
    ? "high"
    : patterns.length > 0
      ? "medium"
      : "low";

  return {
    hasWarning: patterns.length > 0,
    riskLevel,
    patterns
  };
}

// ─── Dashboard metrics ────────────────────────────────────────────────────────

/**
 * Compute aggregated performance metrics from learning entries.
 * Pure function — no file I/O, fully testable.
 *
 * @param entries — array from readLearningLog()
 * @returns {{
 *   totalRuns: number,
 *   successRate: number,       // 0..1
 *   byRuntime: Record<string, { completed: number, failed: number, total: number }>,
 *   byProfile:  Record<string, { completed: number, failed: number, total: number }>,
 *   recentRuns: Array<{ issueNumber, outcome, runtimeId, profileId, recordedAt }>
 * }}
 */
export function computeMetrics(entries = []) {
  const all = Array.isArray(entries) ? entries : [];
  let completedCount = 0;
  const byRuntime = {};
  const byProfile = {};

  for (const e of all) {
    const rt = e.runtimeId || "unknown";
    const pr = e.profileId || "general";
    const isCompleted = e.outcome === "completed";
    const isFailed = e.outcome === "failed" || e.outcome === "review_needed";

    if (isCompleted) completedCount++;

    if (!byRuntime[rt]) byRuntime[rt] = { completed: 0, failed: 0, total: 0 };
    byRuntime[rt].total++;
    if (isCompleted) byRuntime[rt].completed++;
    else if (isFailed) byRuntime[rt].failed++;

    if (!byProfile[pr]) byProfile[pr] = { completed: 0, failed: 0, total: 0 };
    byProfile[pr].total++;
    if (isCompleted) byProfile[pr].completed++;
    else if (isFailed) byProfile[pr].failed++;
  }

  const totalRuns = all.length;
  const successRate = totalRuns === 0 ? 0 : completedCount / totalRuns;

  const recentRuns = all
    .slice(-10)
    .reverse()
    .map(({ issueNumber, outcome, runtimeId, profileId, recordedAt }) => ({
      issueNumber,
      outcome,
      runtimeId,
      profileId,
      recordedAt
    }));

  return { totalRuns, successRate, byRuntime, byProfile, recentRuns };
}
