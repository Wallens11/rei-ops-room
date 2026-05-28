/**
 * execute-sessions.mjs — Session pinning for Claude Code resume.
 *
 * Stores a session_id per issue so that if the worker crashes mid-run,
 * the next run can resume from the same context (--resume <session_id>)
 * rather than starting from scratch.
 *
 * Persistent via .execute-sessions.json (gitignored).
 * Only relevant for the claude-code runtime — codex does not support resume.
 *
 * Cross-session note (for other LLMs continuing this work):
 *   - Sessions file: .execute-sessions.json
 *   - Key: issueNumber (string) or taskId for direct tasks
 *   - Value: { sessionId, runtimeId, pinnedAt }
 *   - Pin is cleared after the issue finishes (done/failed/aborted)
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
 * Read the stored session_id for a given issue/task.
 *
 * @param key — issueNumber (number) or taskId (string)
 * @returns session_id string or null if not found / expired
 */
export async function readSessionPin(key) {
  if (!key) return null;
  const sessions = await readSessions();
  const pin = sessions[String(key)];
  if (!pin?.sessionId) return null;

  // Session is considered expired after 7 days
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
 * Save a session_id for a given issue/task.
 *
 * @param key       — issueNumber or taskId
 * @param sessionId — session ID from Claude Code output
 * @param runtimeId — runtime used (for filtering — only claude-code supports resume)
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
 * Clear the session pin for a given issue/task.
 * Called after the issue finishes (done/failed/aborted).
 */
export async function clearSessionPin(key) {
  if (!key) return;
  const sessions = await readSessions();
  if (!(String(key) in sessions)) return; // nothing to do
  delete sessions[String(key)];
  await saveSessions(sessions);
}
