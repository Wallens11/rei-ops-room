/**
 * rei-chat.mjs — Realtime chat thread between the operator and Rei.
 *
 * The whole point of this module: turn Rei from a fire-and-forget runner
 * into an agent you can talk to while she's working. Messages flow both
 * ways and the worker reads new operator messages between agent
 * iterations so corrections actually land mid-run.
 *
 * Storage: .rei-chat.jsonl, append-only. One message per line.
 *
 * Roles: "user"   — the operator's words
 *        "rei"    — auto-replies (acknowledgements, status updates)
 *        "system" — slash-command results, run lifecycle events
 *
 * Slash commands are first-class — see `parseSlashCommand`. They never
 * reach the agent; the server executes them locally.
 */

import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

import { projectRoot } from "./execute-worker-state.mjs";

export const chatFile = path.join(projectRoot, ".rei-chat.jsonl");
export const chatCursorFile = path.join(projectRoot, ".rei-chat-cursor.json");

const MAX_HISTORY = 500;
const MAX_TEXT = 2000;

const ROLES = new Set(["user", "rei", "system"]);

/** Append a chat message and return the stored entry. */
export async function appendMessage({
  role = "user",
  text = "",
  meta = null
} = {}) {
  const cleaned = String(text || "").slice(0, MAX_TEXT).trim();
  if (!cleaned) return null;

  const entry = {
    id: `chat_${Date.now().toString(36)}_${crypto.randomBytes(2).toString("hex")}`,
    timestamp: new Date().toISOString(),
    role: ROLES.has(role) ? role : "user",
    text: cleaned,
    meta: meta && typeof meta === "object" ? meta : null
  };

  await fs.mkdir(path.dirname(chatFile), { recursive: true });
  await fs.appendFile(chatFile, JSON.stringify(entry) + "\n", "utf8");
  await maybeTrim();
  return entry;
}

async function maybeTrim() {
  try {
    const stat = await fs.stat(chatFile);
    if (stat.size < 250 * 1024) return;
    const all = await readMessages({ limit: Infinity });
    const trimmed = all.slice(-MAX_HISTORY);
    await fs.writeFile(
      chatFile,
      trimmed.map((e) => JSON.stringify(e)).join("\n") + "\n",
      "utf8"
    );
  } catch { /* skip */ }
}

/**
 * Read the tail of the chat thread.
 * @param {object} opts
 * @param {number} opts.limit - max messages (default 40)
 * @param {string} opts.after - ISO timestamp; only return messages newer
 * @param {string} opts.roles - comma-separated role filter
 */
export async function readMessages({ limit = 40, after = null, roles = null } = {}) {
  let entries = [];
  try {
    const text = await fs.readFile(chatFile, "utf8");
    entries = text.split("\n").filter(Boolean).map((line) => {
      try { return JSON.parse(line); } catch { return null; }
    }).filter(Boolean);
  } catch {
    return [];
  }

  if (after) {
    const cutoff = new Date(after).getTime();
    if (Number.isFinite(cutoff)) {
      entries = entries.filter((e) => new Date(e.timestamp).getTime() > cutoff);
    }
  }
  if (Array.isArray(roles) && roles.length > 0) {
    entries = entries.filter((e) => roles.includes(e.role));
  }

  return entries.slice(-limit);
}

/**
 * Read user messages the worker hasn't consumed yet (since `chatCursorFile`).
 * After returning them, the worker calls `advanceChatCursor(timestamp)` so
 * the same messages don't get re-injected on the next iteration.
 */
export async function readUnconsumedUserMessages() {
  const cursor = await readChatCursor();
  const messages = await readMessages({
    limit: 200,
    after: cursor || null,
    roles: ["user"]
  });
  return messages;
}

export async function readChatCursor() {
  try {
    const raw = await fs.readFile(chatCursorFile, "utf8");
    const parsed = JSON.parse(raw);
    return parsed?.cursor || null;
  } catch {
    return null;
  }
}

export async function advanceChatCursor(timestamp) {
  if (!timestamp) return;
  await fs.mkdir(path.dirname(chatCursorFile), { recursive: true });
  await fs.writeFile(
    chatCursorFile,
    JSON.stringify({ cursor: String(timestamp) }, null, 2),
    "utf8"
  );
}

// ─── Slash commands ─────────────────────────────────────────────────────────
/**
 * Recognized slash commands that are handled by the server locally and never
 * passed to the agent.
 */
export const SLASH_COMMANDS = {
  pause:   { args: 0, help: "Pause the execute worker after the current run." },
  resume:  { args: 0, help: "Resume the worker." },
  focus:   { args: "rest", help: "Inject `focus: <hint>` into the next run." },
  clear:   { args: 0, help: "Clear the visible chat history (does not delete the log)." },
  status:  { args: 0, help: "Print current worker state + Rei mood." },
  help:    { args: 0, help: "List available slash commands." }
};

/**
 * Parse a chat message for a leading slash command.
 * Returns { command, rest, valid, help? } or null when not a slash message.
 */
export function parseSlashCommand(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed.startsWith("/")) return null;
  const space = trimmed.indexOf(" ");
  const name = (space === -1 ? trimmed.slice(1) : trimmed.slice(1, space)).toLowerCase();
  const rest = space === -1 ? "" : trimmed.slice(space + 1).trim();
  const spec = SLASH_COMMANDS[name];
  if (!spec) {
    return { command: name, rest, valid: false, help: `Unknown command: /${name}` };
  }
  if (spec.args === "rest" && !rest) {
    return { command: name, rest, valid: false, help: `/${name} requires text (${spec.help})` };
  }
  return { command: name, rest, valid: true };
}

/** Render command list as a system message body. */
export function renderSlashHelp() {
  const rows = Object.entries(SLASH_COMMANDS).map(([name, spec]) => `/${name} — ${spec.help}`);
  return `Slash commands:\n${rows.join("\n")}`;
}

/**
 * Format the worker prompt fragment for injected user messages.
 * Worker prepends this to the next prompt so the agent reads the operator's
 * mid-run nudge.
 */
export function formatChatInjection(messages = []) {
  if (!Array.isArray(messages) || messages.length === 0) return "";
  const lines = [
    "### Operator messages received since the last iteration",
    "(Treat these as live human corrections. Acknowledge briefly and adjust course.)",
    ""
  ];
  for (const m of messages.slice(-5)) {
    lines.push(`- "${String(m.text || "").slice(0, 500)}"`);
  }
  return lines.join("\n");
}
