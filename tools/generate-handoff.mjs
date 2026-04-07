/**
 * generate-handoff.mjs — Auto-generate daily handoff dari run history.
 *
 * Membaca tiga sumber:
 *   1. .execute-runs/    — last-message.md dari N run terbaru
 *   2. .execute-learning.json  — recent learning entries (insight dari setiap run)
 *   3. .execute-queue.json     — tasks done/failed hari ini
 *
 * Output:
 *   Handoff Markdown yang ditulis ke lokasi yang sama dengan
 *   readDailyDeviceHandoff() di server.mjs — yaitu references/daily-device-handoff.md
 *   di raffi-agent-skill repo.
 *
 * Bisa di-trigger manual:
 *   node tools/generate-handoff.mjs
 *
 * Atau via API:
 *   POST /api/handoff/generate
 *
 * Cross-session note (buat LLM lain yang lanjut):
 *   - Output file: sama dengan dailyDeviceHandoffPaths[0] di server.mjs
 *   - Format: append section baru di bawah entry hari terakhir
 *   - Kalau sudah ada entry untuk hari ini, replace-saja seksi yang ada
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { projectRoot, executeRunsDir } from "./execute-worker-state.mjs";
import { readLearningLog } from "./execute-learning.mjs";
import { readQueue } from "./execute-queue.mjs";

// ─── Config ───────────────────────────────────────────────────────────────────

const workspaceRoot = process.env.WORKSPACE_ROOT || path.resolve(projectRoot, "..");
const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");

export const handoffOutputPaths = process.env.DAILY_DEVICE_HANDOFF_PATH
  ? [process.env.DAILY_DEVICE_HANDOFF_PATH]
  : [
      path.join(workspaceRoot, ".work", "raffi-agent-skill", "references", "daily-device-handoff.md"),
      path.join(codexHome, "skills", "raffi-agent-skill", "references", "daily-device-handoff.md")
    ];

const MAX_RUNS_TO_READ = 5;

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function readTextIfExists(filePath) {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (e) {
    if (e?.code === "ENOENT") return "";
    throw e;
  }
}

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Baca last-message.md dari N run dir terbaru.
 * Return: array of { runDir, lastMessage }
 */
async function readRecentRunMessages(limit = MAX_RUNS_TO_READ) {
  let entries = [];
  try {
    entries = await fs.readdir(executeRunsDir);
  } catch {
    return [];
  }

  // Urutkan berdasarkan nama dir (timestamp suffix) — terbaru dulu
  const sorted = entries.sort().reverse().slice(0, limit);
  const results = [];

  for (const dirName of sorted) {
    const lastMsgFile = path.join(executeRunsDir, dirName, "last-message.md");
    const msg = await readTextIfExists(lastMsgFile);
    if (msg.trim()) {
      results.push({ runDir: dirName, lastMessage: msg.trim() });
    }
  }

  return results;
}

/**
 * Buat ringkasan singkat dari learning entries hari ini.
 */
function summarizeLearningEntries(entries = []) {
  const today = todayDate();
  const todayEntries = entries.filter((e) => e.date === today);
  if (todayEntries.length === 0) return null;

  const lines = todayEntries.map((e) => {
    const ref = e.issueNumber ? `#${e.issueNumber}` : "direct task";
    const title = e.taskTitle ? ` "${e.taskTitle.slice(0, 60)}"` : "";
    const outcome = e.outcome ?? "unknown";
    const files = e.filesChanged?.length > 0
      ? ` → changed: ${e.filesChanged.slice(0, 3).join(", ")}${e.filesChanged.length > 3 ? ` +${e.filesChanged.length - 3}` : ""}`
      : " → no file changes";
    return `- ${outcome} ${ref}${title}${files}`;
  });

  return lines.join("\n");
}

/**
 * Buat ringkasan queue hari ini — tasks done/failed.
 */
function summarizeQueueToday(tasks = []) {
  const today = todayDate();
  const finished = tasks.filter(
    (t) => (t.status === "done" || t.status === "failed") &&
      (t.finishedAt || "").slice(0, 10) === today
  );
  if (finished.length === 0) return null;

  const lines = finished.map((t) => {
    const label = t.status === "done" ? "✓" : "✗";
    const title = String(t.task || "").slice(0, 72);
    const runtime = t.runtimeId || "auto";
    return `- ${label} [${runtime}] ${title}`;
  });

  return lines.join("\n");
}

// ─── Core ─────────────────────────────────────────────────────────────────────

/**
 * Buat object handoff terstruktur dari run history.
 *
 * Return: {
 *   date: "YYYY-MM-DD",
 *   todayAtAGlance: string,
 *   activeIssues: string | null,
 *   blockers: string | null,
 *   sections: { runs, learning, queue }
 * }
 */
export async function buildHandoffPayload() {
  const [runMessages, learningEntries, queueTasks] = await Promise.all([
    readRecentRunMessages(),
    readLearningLog().catch(() => []),
    readQueue().catch(() => [])
  ]);

  const learningSummary = summarizeLearningEntries(learningEntries);
  const queueSummary = summarizeQueueToday(queueTasks);

  // Today at a glance — derive dari learning entries
  const today = todayDate();
  const todayLearning = learningEntries.filter((e) => e.date === today);
  const completed = todayLearning.filter((e) => e.outcome === "completed").length;
  const failed = todayLearning.filter((e) => e.outcome === "failed" || e.outcome === "review_needed").length;
  const total = todayLearning.length;

  let glanceLine = `Auto-generated handoff for ${today}.`;
  if (total > 0) {
    glanceLine = `${total} run(s) today: ${completed} completed, ${failed} review/failed.`;
    if (runMessages.length > 0) {
      const lastRun = runMessages[0];
      const snippet = lastRun.lastMessage.slice(0, 120).replace(/\n/g, " ");
      glanceLine += ` Last run: ${snippet}…`;
    }
  }

  // Active issues dari queue (queued + in_progress)
  const activeQueue = queueTasks.filter(
    (t) => t.status === "queued" || t.status === "in_progress"
  );
  const activeIssues = activeQueue.length > 0
    ? activeQueue.map((t) => `- ${t.status}: ${String(t.task || "").slice(0, 72)}`).join("\n")
    : null;

  return {
    date: today,
    todayAtAGlance: glanceLine,
    sections: {
      runs: runMessages.length > 0
        ? runMessages.map((r) => `**${r.runDir}**\n${r.lastMessage.slice(0, 400)}`).join("\n\n---\n\n")
        : null,
      learning: learningSummary,
      queue: queueSummary
    },
    activeIssues,
    blockers: null // bisa di-extend nanti
  };
}

/**
 * Format payload menjadi Markdown section yang bisa di-append ke handoff file.
 */
export function formatHandoffSection(payload) {
  const lines = [
    `## ${payload.date}`,
    "",
    "### Today At A Glance",
    payload.todayAtAGlance,
  ];

  if (payload.sections.learning) {
    lines.push("", "### Run Outcomes", payload.sections.learning);
  }

  if (payload.sections.queue) {
    lines.push("", "### Tasks Completed Today", payload.sections.queue);
  }

  if (payload.activeIssues) {
    lines.push("", "### Active Issues", payload.activeIssues);
  }

  if (payload.sections.runs) {
    lines.push("", "### Run Log Snippets", payload.sections.runs);
  }

  lines.push("", "### Repo State", `- Source: \`${projectRoot}\``);
  lines.push("");

  return lines.join("\n");
}

/**
 * Tulis atau update section hari ini di handoff file.
 *
 * Strategy:
 *   - Kalau sudah ada section `## YYYY-MM-DD` untuk hari ini → replace-nya.
 *   - Kalau belum → append di bawah.
 *
 * @param outputPaths — array file path (coba satu per satu, pakai yang pertama berhasil)
 * @param section     — Markdown string dari formatHandoffSection()
 */
export async function writeHandoffSection(section, outputPaths = handoffOutputPaths) {
  const today = todayDate();
  const dateHeader = `## ${today}`;

  for (const outputPath of outputPaths) {
    try {
      // Pastikan direktori ada
      await fs.mkdir(path.dirname(outputPath), { recursive: true });

      let existing = "";
      try {
        existing = await fs.readFile(outputPath, "utf8");
      } catch (e) {
        if (e?.code !== "ENOENT") throw e;
      }

      let updated;
      if (existing.includes(dateHeader)) {
        // Replace section hari ini — dari ## YYYY-MM-DD sampai ## berikutnya (atau EOF)
        const startIdx = existing.indexOf(dateHeader);
        // Cari ## berikutnya setelah section ini
        const afterSection = existing.slice(startIdx + dateHeader.length);
        const nextSectionMatch = afterSection.match(/\n## /);
        const endIdx = nextSectionMatch
          ? startIdx + dateHeader.length + nextSectionMatch.index
          : existing.length;

        updated = existing.slice(0, startIdx) + section + existing.slice(endIdx).replace(/^\n/, "");
      } else {
        // Append di bawah
        updated = existing.trimEnd() + (existing.trim() ? "\n\n" : "") + section;
      }

      await fs.writeFile(outputPath, updated, "utf8");
      return { written: true, path: outputPath };
    } catch {
      // Coba path berikutnya
      continue;
    }
  }

  return { written: false, reason: "no_writable_path" };
}

/**
 * Entry point: generate + write handoff.
 * Return: { written, path?, date, todayAtAGlance }
 */
export async function generateHandoff(outputPaths = handoffOutputPaths) {
  const payload = await buildHandoffPayload();
  const section = formatHandoffSection(payload);
  const writeResult = await writeHandoffSection(section, outputPaths);

  return {
    ...writeResult,
    date: payload.date,
    todayAtAGlance: payload.todayAtAGlance,
    payload
  };
}

// ─── CLI entry point ─────────────────────────────────────────────────────────

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  generateHandoff()
    .then((result) => {
      if (result.written) {
        console.log(`✓ Handoff written to ${result.path}`);
      } else {
        console.warn(`⚠ Could not write handoff: ${result.reason || "unknown"}`);
      }
      console.log(`  Date: ${result.date}`);
      console.log(`  ${result.todayAtAGlance}`);
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
