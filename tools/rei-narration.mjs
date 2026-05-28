/**
 * rei-narration.mjs — Rei's running thoughts log.
 *
 * The worker writes short first-person lines as it moves through a run
 * (planning → reading → editing → verifying → reporting). The UI reads the
 * tail of this log so the user can watch Rei "think out loud" instead of
 * staring at a spinner.
 *
 * Storage: .rei-narration.jsonl, append-only. Each line is one thought.
 * Auto-trimmed to NARRATION_MAX entries.
 */

import fs from "node:fs/promises";
import path from "node:path";

import { projectRoot } from "./execute-worker-state.mjs";

export const narrationFile = path.join(projectRoot, ".rei-narration.jsonl");
const NARRATION_MAX = 200;

/**
 * Append a thought. Best-effort: errors are swallowed so this never
 * disrupts the worker pipeline.
 *
 * @param {object} thought
 * @param {string} thought.text       - the line itself (kept under 280 chars)
 * @param {string} thought.phase      - "start" | "plan" | "explore" | "edit" |
 *                                       "verify" | "summary" | "memory" | "info"
 * @param {string} [thought.issueRef] - "#NN" or null
 * @param {string} [thought.mood]     - mood at time of writing
 * @param {string} [thought.icon]     - optional emoji
 */
export async function narrate(thought = {}) {
  const entry = {
    id: `thought_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`,
    timestamp: new Date().toISOString(),
    text: String(thought.text || "").slice(0, 280).trim(),
    phase: PHASES.has(thought.phase) ? thought.phase : "info",
    issueRef: thought.issueRef || null,
    mood: thought.mood || null,
    icon: thought.icon || null
  };
  if (!entry.text) return null;

  try {
    await fs.mkdir(path.dirname(narrationFile), { recursive: true });
    await fs.appendFile(narrationFile, JSON.stringify(entry) + "\n", "utf8");
    await maybeTrim();
    return entry;
  } catch {
    return null;
  }
}

const PHASES = new Set([
  "start", "plan", "explore", "edit", "verify", "summary", "memory", "info", "error"
]);

async function maybeTrim() {
  // Cheap rolling trim — only run when file size is suspicious.
  try {
    const stat = await fs.stat(narrationFile);
    if (stat.size < 80 * 1024) return; // <80 KB → no trim needed
    const all = await readNarration({ limit: Infinity });
    const trimmed = all.slice(-NARRATION_MAX);
    await fs.writeFile(
      narrationFile,
      trimmed.map((e) => JSON.stringify(e)).join("\n") + "\n",
      "utf8"
    );
  } catch {
    /* skip */
  }
}

/**
 * Read tail of the narration log.
 * @param {object} opts
 * @param {number} opts.limit - max entries to return (default 12)
 * @param {string} opts.after - ISO timestamp; only return entries after this
 */
export async function readNarration({ limit = 12, after = null } = {}) {
  let entries = [];
  try {
    const text = await fs.readFile(narrationFile, "utf8");
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

  return entries.slice(-limit);
}

/** Phase → default icon for the UI. */
export const PHASE_ICONS = {
  start:   "▶",
  plan:    "🗺",
  explore: "🔍",
  edit:    "✍",
  verify:  "✅",
  summary: "📝",
  memory:  "💭",
  info:    "•",
  error:   "⚠"
};
