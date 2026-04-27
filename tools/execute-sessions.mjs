/**
 * execute-sessions.mjs — Session pinning untuk Claude Code resume.
 *
 * Menyimpan session_id per issue supaya kalau worker crash di tengah jalan,
 * run berikutnya bisa resume dari konteks yang sama (--resume <session_id>)
 * alih-alih mulai dari nol.
 *
 * Persistent via .execute-sessions.json (gitignored).
 * Hanya relevan untuk runtime claude-code — codex tidak support resume.
 *
 * Cross-session note (buat LLM lain yang lanjut):
 *   - Sessions file: .execute-sessions.json
 *   - Key: issueNumber (string) atau taskId untuk direct tasks
 *   - Value: { sessionId, runtimeId, pinnedAt }
 *   - Pin di-clear setelah issue selesai (done/failed/aborted)
 */

import fs from "node:fs/promises";
import path from "node:path";

import { projectRoot } from "./execute-worker-state.mjs";

export const executeSessionsFile = path.join(projectRoot, ".execute-sessions.json");

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function readSessions() {
  try {
    const text = await fs.readFile(executeSessionsFile, "utf8");
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch (err) {
    if (err?.code === "ENOENT") return {};
    throw err;
  }
}

async function saveSessions(sessions) {
  await fs.writeFile(
    executeSessionsFile,
    `${JSON.stringify(sessions, null, 2)}\n`,
    "utf8"
  );
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Baca session_id yang tersimpan untuk issue/task tertentu.
 *
 * @param key — issueNumber (number) atau taskId (string)
 * @returns session_id string atau null kalau tidak ada / expired
 */
export async function readSessionPin(key) {
  if (!key) return null;
  const sessions = await readSessions();
  const pin = sessions[String(key)];
  if (!pin?.sessionId) return null;

  // Session dianggap expired kalau lebih dari 7 hari
  const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
  if (pin.pinnedAt) {
    const age = Date.now() - new Date(pin.pinnedAt).getTime();
    if (age > SESSION_TTL_MS) {
      await clearSessionPin(key).catch(() => {});
      return null;
    }
  }

  return pin.sessionId;
}

/**
 * Simpan session_id untuk issue/task tertentu.
 *
 * @param key       — issueNumber atau taskId
 * @param sessionId — session ID dari Claude Code output
 * @param runtimeId — runtime yang dipakai (untuk filter — hanya claude-code yang support resume)
 */
export async function writeSessionPin(key, sessionId, runtimeId = null) {
  if (!key || !sessionId) return;
  const sessions = await readSessions();
  sessions[String(key)] = {
    sessionId: String(sessionId),
    runtimeId: runtimeId || null,
    pinnedAt: new Date().toISOString()
  };
  await saveSessions(sessions);
}

/**
 * Hapus pin session untuk issue/task tertentu.
 * Dipanggil setelah issue selesai (done/failed/aborted).
 */
export async function clearSessionPin(key) {
  if (!key) return;
  const sessions = await readSessions();
  if (!(String(key) in sessions)) return; // nothing to do
  delete sessions[String(key)];
  await saveSessions(sessions);
}
