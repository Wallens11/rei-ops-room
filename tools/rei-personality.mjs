/**
 * rei-personality.mjs — derive Rei's current "mood" from observable run history.
 *
 * No magic — just a few cheap signals combined into a stable profile that the
 * UI and worker can react to:
 *
 *   energy    : 0..1  — high after fresh runs / many recent wins, low after a
 *                       long quiet stretch or a streak of fails.
 *   focus     : 0..1  — high while actively running OR with a clear current
 *                       objective. Drops during idle.
 *   confidence: 0..1  — recent success rate (last 10 runs).
 *   mood      : "focused" | "curious" | "playful" | "tired" | "frustrated" |
 *               "thoughtful"  — derived from the three signals above.
 *
 * The result is intentionally a soft profile, not a precise score. The UI uses
 * it for tint/voice/animation density; the worker can use it to bias decisions
 * (e.g. tired → smaller diffs, lower temperature).
 */

import fs from "node:fs/promises";
import path from "node:path";

import { projectRoot } from "./execute-worker-state.mjs";

const learningLogFile = path.join(projectRoot, ".execute-learning.json");
const workerStateFile = path.join(projectRoot, ".execute-worker-state.json");
const costsFile       = path.join(projectRoot, ".rei-costs.jsonl");

const NOW = () => Date.now();
const MIN  = 60 * 1000;
const HOUR = 60 * MIN;
const DAY  = 24 * HOUR;

async function readJsonSafe(file) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return null;
  }
}

async function readJsonlSafe(file) {
  try {
    const text = await fs.readFile(file, "utf8");
    return text.split("\n").filter(Boolean).map((line) => {
      try { return JSON.parse(line); } catch { return null; }
    }).filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Pick a mood from the three signals. Designed so each mood is reachable but
 * "focused" stays the default — Rei is a working agent first, a character
 * second.
 */
export function deriveMood({ energy, focus, confidence, recentRuns = 0, idleMins = 0 }) {
  if (recentRuns === 0 && idleMins > 240) return "thoughtful";   // a long quiet day
  if (confidence < 0.4 && recentRuns >= 3) return "frustrated";   // losing streak
  if (energy < 0.3 && focus < 0.4) return "tired";                 // running on fumes
  if (energy > 0.65 && confidence > 0.7 && focus > 0.6) return "playful";
  if (focus > 0.7) return "focused";
  if (energy > 0.6) return "curious";
  return "focused";
}

/**
 * Compute energy from recency: more recent activity → higher energy, decaying
 * exponentially over the past 4 hours.
 */
function computeEnergy(runEntries) {
  if (runEntries.length === 0) return 0.25;
  const now = NOW();
  let acc = 0;
  for (const e of runEntries.slice(-12)) {
    const ts = new Date(e.recordedAt || e.timestamp || 0).getTime();
    if (!Number.isFinite(ts) || ts <= 0) continue;
    const ageMin = (now - ts) / MIN;
    if (ageMin < 0) continue;
    // half-life ~ 90 minutes
    acc += Math.exp(-ageMin / 90);
  }
  return Math.min(1, acc / 6);
}

function computeConfidence(runEntries) {
  const last = runEntries.slice(-10);
  if (last.length === 0) return 0.55;  // unknown — neutral
  const wins = last.filter((e) => e.outcome === "completed").length;
  return wins / last.length;
}

function computeFocus(state, now = NOW()) {
  if (!state) return 0.4;
  if (state.status === "running" || state.status === "launching") return 0.95;
  // Recent activity carries focus forward briefly
  const updated = state.updatedAt ? new Date(state.updatedAt).getTime() : 0;
  const ageMin = (now - updated) / MIN;
  if (state.currentTarget && ageMin < 30) return 0.75;
  if (ageMin < 90) return 0.55;
  return 0.35;
}

/**
 * Compute Rei's full personality profile.
 *
 * @param {object} opts
 * @param {object} opts.learningLog - parsed entries (optional override)
 * @param {object} opts.workerState - parsed state (optional override)
 * @param {Array}  opts.costs       - parsed cost ledger (optional override)
 * @param {number} opts.now         - timestamp for tests
 */
export async function getPersonality({
  learningLog = null,
  workerState = null,
  costs = null,
  now = NOW()
} = {}) {
  const log    = learningLog ?? (await readJsonSafe(learningLogFile))?.entries ?? [];
  const state  = workerState ?? (await readJsonSafe(workerStateFile));
  const ledger = costs ?? (await readJsonlSafe(costsFile));

  const energy     = computeEnergy(log);
  const confidence = computeConfidence(log);
  const focus      = computeFocus(state, now);

  // Idle minutes — time since most recent run finished
  const lastRunTs = log.length > 0
    ? Math.max(...log.map((e) => new Date(e.recordedAt || 0).getTime()).filter(Number.isFinite))
    : 0;
  const idleMins = lastRunTs > 0 ? (now - lastRunTs) / MIN : Infinity;
  const recentRuns24h = log.filter((e) => {
    const ts = new Date(e.recordedAt || 0).getTime();
    return Number.isFinite(ts) && now - ts < DAY;
  }).length;

  const mood = deriveMood({ energy, focus, confidence, recentRuns: recentRuns24h, idleMins });

  // Cost-aware "vibe" — Rei knows when she's been expensive lately
  const costToday = ledger.filter((c) => {
    const ts = new Date(c.timestamp || 0).getTime();
    return Number.isFinite(ts) && now - ts < DAY;
  }).reduce((s, c) => s + (c.cost || 0), 0);

  return {
    mood,
    energy:     round(energy),
    focus:      round(focus),
    confidence: round(confidence),
    recentRuns24h,
    idleMins:   Number.isFinite(idleMins) ? Math.round(idleMins) : null,
    costToday:  Number(costToday.toFixed(4)),
    voice:      voiceForMood(mood)
  };
}

function round(x) { return Number(x.toFixed(2)); }

/**
 * Tone hints for narration / bubbles. Worker can pick lines like:
 *   `Hmm, ${voice.curious[0]}`
 */
function voiceForMood(mood) {
  return {
    focused:     { icon: "🎯", color: "#65e4ff", tagline: "in the zone" },
    curious:     { icon: "🤔", color: "#b8a2ff", tagline: "exploring" },
    playful:     { icon: "✨", color: "#7cffba", tagline: "feeling good" },
    tired:       { icon: "😴", color: "#8fa8c6", tagline: "running on fumes" },
    frustrated:  { icon: "🌧", color: "#ff907c", tagline: "stuck" },
    thoughtful:  { icon: "🌙", color: "#a8c8ff", tagline: "quiet" }
  }[mood] || { icon: "•", color: "#edf3ff", tagline: "" };
}

/**
 * Suggest a short narration line that matches the current mood — for the
 * UI panel placeholder when there are no recent thoughts.
 */
export function moodTagline(profile) {
  if (!profile) return "Standing by.";
  const lines = {
    focused:    ["Locked in on the current target.", "One thing at a time."],
    curious:    ["Wondering what's hiding in the codebase.", "Following a thread."],
    playful:    ["Things are going well — ride the wave.", "Riding a streak."],
    tired:      ["Could use a break.", "Eyes a bit heavy."],
    frustrated: ["Last few didn't land. Slowing down.", "Need to rethink the approach."],
    thoughtful: ["Quiet morning. Time to read.", "Catching up on memory."]
  };
  const candidates = lines[profile.mood] || ["Standing by."];
  return candidates[Math.floor(Math.random() * candidates.length)];
}
