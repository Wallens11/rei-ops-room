import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "rei-cost-test-"));
process.env.REI_PROJECT_ROOT = tmp;

const {
  computeCost,
  parseTokenUsage,
  recordRunCost,
  readCosts,
  getCostStats,
  formatCostSummary,
  costsFile
} = await import("../tools/rei-cost-tracker.mjs");

test("computeCost: known model uses model pricing", () => {
  // Claude Sonnet 4.5: $3/M in, $15/M out
  const cost = computeCost({
    inputTokens: 1_000_000,
    outputTokens: 100_000,
    model: "claude-sonnet-4-5"
  });
  // 3.00 + (0.1 * 15) = 4.50
  assert.equal(cost, 4.5);
});

test("computeCost: unknown model falls back to default pricing", () => {
  const cost = computeCost({
    inputTokens: 1_000_000,
    outputTokens: 0,
    model: "totally-fake-model"
  });
  assert.equal(cost, 3.0); // default in price
});

test("computeCost: returns 0 for zero tokens", () => {
  assert.equal(computeCost({}), 0);
});

test("parseTokenUsage extracts Claude-style input/output", () => {
  const text = "Model: claude-sonnet-4-5\nUsage: input: 12,345 output: 6,789";
  const usage = parseTokenUsage(text);
  assert.ok(usage);
  assert.equal(usage.inputTokens, 12345);
  assert.equal(usage.outputTokens, 6789);
  assert.equal(usage.model, "claude-sonnet-4-5");
});

test("parseTokenUsage returns null when nothing matches", () => {
  assert.equal(parseTokenUsage("nothing relevant here"), null);
  assert.equal(parseTokenUsage(""), null);
  assert.equal(parseTokenUsage(null), null);
});

test("recordRunCost appends a parseable entry", async () => {
  try { await fs.unlink(costsFile); } catch {}

  const entry = await recordRunCost({
    runtimeId: "claude-code",
    issueNumber: 42,
    inputTokens: 1000,
    outputTokens: 500,
    model: "claude-sonnet-4-5",
    outcome: "completed",
    durationMs: 12000
  });

  assert.equal(entry.runtimeId, "claude-code");
  assert.equal(entry.totalTokens, 1500);
  assert.ok(entry.cost > 0);

  const all = await readCosts();
  assert.equal(all.length, 1);
});

test("getCostStats aggregates today/week/total correctly", async () => {
  try { await fs.unlink(costsFile); } catch {}

  await recordRunCost({
    runtimeId: "claude-code",
    inputTokens: 1000,
    outputTokens: 500,
    model: "claude-sonnet-4-5"
  });
  await recordRunCost({
    runtimeId: "codex",
    inputTokens: 2000,
    outputTokens: 1000,
    model: "gpt-5"
  });

  const stats = await getCostStats();
  assert.equal(stats.today.runs, 2);
  assert.equal(stats.total.runs, 2);
  assert.equal(stats.total.tokens, 4500);
  assert.ok(stats.total.cost > 0);
  assert.ok(stats.mostExpensiveRun);
});

test("getCostStats handles empty ledger", async () => {
  try { await fs.unlink(costsFile); } catch {}
  const stats = await getCostStats();
  assert.equal(stats.today.runs, 0);
  assert.equal(stats.total.cost, 0);
  assert.equal(stats.mostExpensiveRun, null);
});

test("formatCostSummary produces human-readable output", () => {
  const summary = formatCostSummary({
    today: { runs: 3, tokens: 12345, cost: 0.0567 }
  });
  assert.match(summary, /today:/);
  assert.match(summary, /\$0\.057/);
  assert.match(summary, /3 runs/);
});

test("formatCostSummary handles null gracefully", () => {
  assert.equal(formatCostSummary(null), "no runs yet");
  assert.equal(formatCostSummary({}), "no runs yet");
});

test.after(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});
