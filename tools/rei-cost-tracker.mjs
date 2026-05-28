/**
 * rei-cost-tracker.mjs — Token usage + cost accounting per run.
 *
 * Parses the stdout/stderr of Claude Code / Codex runs for token counts
 * and stores them in `.rei-costs.jsonl`. Surfaces aggregates so Rei can:
 *   1. Show "today's spend" in the UI
 *   2. Pick a cheaper model when a task is simple
 *   3. Warn the user when a single run gets expensive
 *
 * No external API calls — everything parsed from local agent output.
 */

import fs from "node:fs/promises";
import path from "node:path";

import { projectRoot } from "./execute-worker-state.mjs";

export const costsFile = path.join(projectRoot, ".rei-costs.jsonl");

// USD per 1M tokens (as of 2026-Q2 published list pricing; cached, can be overridden via env)
// Source of truth: each provider's pricing page. Update when the catalog shifts.
const DEFAULT_PRICING = {
  // Claude
  "claude-sonnet-4-5":    { in: 3.00, out: 15.00 },
  "claude-sonnet-4-7":    { in: 3.00, out: 15.00 },
  "claude-opus-4":        { in: 15.00, out: 75.00 },
  "claude-opus-4-7":      { in: 15.00, out: 75.00 },
  "claude-haiku-4":       { in: 0.80, out: 4.00 },
  // Codex (estimates — Codex uses OpenAI's GPT-5 family)
  "gpt-5":                { in: 1.25, out: 10.00 },
  "gpt-5-mini":           { in: 0.25, out: 2.00 },
  // Fallback when we don't recognize the model name
  "default":              { in: 3.00, out: 15.00 }
};

function pricingFor(model) {
  if (!model) return DEFAULT_PRICING.default;
  // Try exact match, then partial
  if (DEFAULT_PRICING[model]) return DEFAULT_PRICING[model];
  const lower = model.toLowerCase();
  for (const key of Object.keys(DEFAULT_PRICING)) {
    if (lower.includes(key) || key.includes(lower)) return DEFAULT_PRICING[key];
  }
  return DEFAULT_PRICING.default;
}

/** Compute USD cost from token counts. */
export function computeCost({ inputTokens = 0, outputTokens = 0, model = null }) {
  const price = pricingFor(model);
  const inUsd  = (inputTokens  / 1_000_000) * price.in;
  const outUsd = (outputTokens / 1_000_000) * price.out;
  return Number((inUsd + outUsd).toFixed(6));
}

/**
 * Parse token usage from a run's combined stdout+stderr.
 * Matches patterns from both Claude Code and Codex CLI output.
 * Returns the best estimate or null if nothing recognizable.
 */
export function parseTokenUsage(text = "") {
  if (!text || typeof text !== "string") return null;

  let inputTokens = 0;
  let outputTokens = 0;
  let model = null;

  // Claude Code emits "tokens: 12345 in / 6789 out" or "input: 12345, output: 6789"
  const claudeIn  = text.match(/input(?:_tokens)?[:\s]+([0-9,]+)/i);
  const claudeOut = text.match(/output(?:_tokens)?[:\s]+([0-9,]+)/i);
  if (claudeIn)  inputTokens  = Number(claudeIn[1].replace(/,/g, ""));
  if (claudeOut) outputTokens = Number(claudeOut[1].replace(/,/g, ""));

  // Alt pattern: "12345 in / 6789 out"
  if (inputTokens === 0 || outputTokens === 0) {
    const altIn  = text.match(/([0-9,]+)\s*(?:tokens?\s*)?in[,\s]/i);
    const altOut = text.match(/([0-9,]+)\s*(?:tokens?\s*)?out[,\s.]/i);
    if (altIn  && inputTokens  === 0) inputTokens  = Number(altIn[1].replace(/,/g, ""));
    if (altOut && outputTokens === 0) outputTokens = Number(altOut[1].replace(/,/g, ""));
  }

  // Model name detection
  const modelMatch = text.match(/(?:model|using)[:\s]+([a-z0-9\-.]+)/i);
  if (modelMatch) model = modelMatch[1];

  if (inputTokens === 0 && outputTokens === 0) return null;

  return { inputTokens, outputTokens, model };
}

/** Record one run's cost to the ledger. Returns the entry. */
export async function recordRunCost({
  runtimeId,
  issueNumber = null,
  profileId = "general",
  inputTokens = 0,
  outputTokens = 0,
  model = null,
  outcome = "completed",
  durationMs = 0
}) {
  const cost = computeCost({ inputTokens, outputTokens, model });
  const entry = {
    timestamp: new Date().toISOString(),
    runtimeId,
    issueNumber,
    profileId,
    model,
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    cost,
    outcome,
    durationMs
  };
  await fs.mkdir(path.dirname(costsFile), { recursive: true });
  await fs.appendFile(costsFile, JSON.stringify(entry) + "\n", "utf8");
  return entry;
}

/** Read all cost entries. */
export async function readCosts() {
  try {
    const raw = await fs.readFile(costsFile, "utf8");
    return raw.split("\n").filter(Boolean).map((line) => {
      try { return JSON.parse(line); } catch { return null; }
    }).filter(Boolean);
  } catch {
    return [];
  }
}

/** Aggregate stats: today, last 7 days, all-time. */
export async function getCostStats() {
  const entries = await readCosts();
  if (entries.length === 0) {
    return {
      today: { runs: 0, tokens: 0, cost: 0 },
      week:  { runs: 0, tokens: 0, cost: 0 },
      total: { runs: 0, tokens: 0, cost: 0 },
      avgCostPerRun: 0,
      mostExpensiveRun: null
    };
  }

  const now = Date.now();
  const dayMs  = 24 * 60 * 60 * 1000;
  const weekMs = 7 * dayMs;

  let today = { runs: 0, tokens: 0, cost: 0 };
  let week  = { runs: 0, tokens: 0, cost: 0 };
  let total = { runs: 0, tokens: 0, cost: 0 };
  let mostExpensiveRun = null;

  for (const e of entries) {
    const ts = new Date(e.timestamp).getTime();
    const age = now - ts;
    total.runs += 1;
    total.tokens += e.totalTokens || 0;
    total.cost += e.cost || 0;

    if (age < dayMs) {
      today.runs += 1;
      today.tokens += e.totalTokens || 0;
      today.cost += e.cost || 0;
    }
    if (age < weekMs) {
      week.runs += 1;
      week.tokens += e.totalTokens || 0;
      week.cost += e.cost || 0;
    }
    if (!mostExpensiveRun || (e.cost || 0) > (mostExpensiveRun.cost || 0)) {
      mostExpensiveRun = e;
    }
  }

  const round = (obj) => ({
    runs: obj.runs,
    tokens: obj.tokens,
    cost: Number(obj.cost.toFixed(4))
  });

  return {
    today: round(today),
    week:  round(week),
    total: round(total),
    avgCostPerRun: Number((total.cost / Math.max(1, total.runs)).toFixed(4)),
    mostExpensiveRun
  };
}

/** Format stats as a one-line summary for the UI. */
export function formatCostSummary(stats) {
  if (!stats || !stats.today) return "no runs yet";
  const t = stats.today;
  return `today: $${t.cost.toFixed(3)} (${t.runs} run${t.runs === 1 ? "" : "s"}, ${t.tokens.toLocaleString()} tok)`;
}
