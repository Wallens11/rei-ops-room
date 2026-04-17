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
