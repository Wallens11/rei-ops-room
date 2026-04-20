/**
 * execute-learning.mjs — Post-run learning loop.
 *
 * Tiap execute run (GitHub issue atau direct task) meninggalkan insight:
 *   - file apa yang diubah
 *   - outcome: completed / review_needed / failed
 *   - runtime yang dipakai
 *   - ringkasan singkat dari last message agent
 *
 * Insight ini dikumpulkan di .execute-learning.json dan di-inject ke prompt
 * run berikutnya lewat formatLearningContext().
 *
 * Hasilnya: Rei tau apa yang berhasil, apa yang stuck, dan area mana yang
 * sudah sering disentuh — tanpa perlu baca ulang semua git log.
 *
 * Cross-session note (buat LLM lain yang lanjut):
 *   - Learning log: .execute-learning.json (excluded via .gitignore)
 *   - Max entries: 50 (auto-trim yang lama)
 *   - Format context di-inject ke buildExecutePrompt + buildDirectTaskPrompt
 *     via parameter `learningContext` (string)
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
 * Ekstrak ringkasan singkat dari last message agent.
 * Ambil kalimat pertama yang substantif — bukan heading markdown.
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
 * Baca semua learning entries.
 */
export async function readLearningLog() {
  return readLog();
}

/**
 * Alias untuk readLearningLog — dipakai oleh adaptive runtime selection.
 */
export const getLearningEntries = readLearningLog;

/**
 * Catat insight dari satu run yang sudah selesai.
 *
 * @param issueNumber  — nomor GitHub issue (null untuk direct task)
 * @param taskTitle    — judul issue atau deskripsi singkat direct task
 * @param runtimeId    — "codex" | "claude-code"
 * @param profileId    — specialist profile: "frontend" | "backend" | "general" | ...
 * @param outcome      — "completed" | "review_needed" | "failed" | "aborted"
 * @param filesChanged — array path relatif file yang berubah
 * @param lastMessage  — teks output terakhir dari agent
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
    filesChanged: (filesChanged || []).slice(0, 20), // cap supaya tidak terlalu besar
    keySummary: extractKeySummary(lastMessage)
  };

  entries.push(entry);

  // Trim ke MAX_ENTRIES — buang yang paling lama
  const trimmed = entries.slice(-MAX_ENTRIES);
  await writeLog(trimmed);

  return entry;
}

// ─── Prompt injection ────────────────────────────────────────────────────────

/**
 * Format learning entries menjadi teks yang bisa di-inject ke prompt.
 * Ambil `limit` entries terbaru saja.
 *
 * Return: string siap pakai, atau null kalau tidak ada entries.
 */
export function formatLearningContext(entries = [], { limit = 5 } = {}) {
  if (!entries || entries.length === 0) return null;

  const recent = entries.slice(-limit).reverse(); // terbaru dulu

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
 * Baca log dan langsung format — shortcut untuk prompt builders.
 */
export async function getLearningContext({ limit = 5 } = {}) {
  const entries = await readLearningLog();
  return formatLearningContext(entries, { limit });
}

// ─── Trust signals ────────────────────────────────────────────────────────────

/**
 * Hitung sinyal kepercayaan dari learning entries untuk ditampilkan di UI.
 *
 * @param entries    — semua learning entries
 * @param profileId  — "frontend" | "backend" | "general" | ...
 * @param issueNumber — nomor issue yang sedang diproses (null untuk direct task)
 *
 * Return: array of signal strings (max 4), atau [] kalau belum ada data.
 */
export function computeTrustSignals(entries = [], { profileId = "general", issueNumber = null } = {}) {
  const signals = [];
  const allEntries = Array.isArray(entries) ? entries : [];

  // Signal 1: success rate untuk profile type ini (10 run terakhir)
  const profileEntries = allEntries.filter((e) => e.profileId === profileId).slice(-10);
  if (profileEntries.length >= 2) {
    const completed = profileEntries.filter((e) => e.outcome === "completed").length;
    const pct = Math.round((completed / profileEntries.length) * 100);
    signals.push(`${profileId} tasks: ${completed}/${profileEntries.length} completed (${pct}%)`);
  }

  // Signal 2: runtime terbaik untuk profile ini (kalau ada cukup data)
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

  // Signal 3: riwayat issue yang sama (kalau ada issueNumber)
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

  // Signal 4: global success rate (semua entry, max 20 terakhir)
  const globalRecent = allEntries.slice(-20);
  if (globalRecent.length >= 5 && profileEntries.length < 2) {
    // Hanya tampilkan kalau signal profile tidak muncul (menghindari duplikasi)
    const globalCompleted = globalRecent.filter((e) => e.outcome === "completed").length;
    const globalPct = Math.round((globalCompleted / globalRecent.length) * 100);
    signals.push(`overall: ${globalCompleted}/${globalRecent.length} tasks completed (${globalPct}%)`);
  }

  return signals.slice(0, 4);
}

// ─── Failure pattern detection ────────────────────────────────────────────────

/**
 * Deteksi pola kegagalan yang perlu diwaspadai sebelum eksekusi.
 *
 * Pattern 1: issue yang sama gagal 2+ kali → high risk
 * Pattern 2: profile type failure rate tinggi (>60% dalam 5 run terakhir) → medium risk
 *
 * @param entries    — semua learning entries
 * @param profileId  — profile task yang akan dijalankan
 * @param issueNumber — nomor issue target (null untuk direct task)
 * @param window     — berapa entry terakhir yang dianalisa untuk profile streak (default 5)
 *
 * Return: { hasWarning, riskLevel: "low"|"medium"|"high", patterns: [{type, severity, message}] }
 */
export function detectFailurePattern(entries = [], { profileId = "general", issueNumber = null, window: recentWindow = 5 } = {}) {
  const allEntries = Array.isArray(entries) ? entries : [];
  const patterns = [];

  // Pattern 1: issue yang sama gagal berulang kali
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
