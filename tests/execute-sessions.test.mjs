import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { parseStreamJsonOutput } from "../tools/execute-worker.mjs";

// ─── parseStreamJsonOutput ────────────────────────────────────────────────────

test("parseStreamJsonOutput: returns nulls for empty input", () => {
  const result = parseStreamJsonOutput("");
  assert.equal(result.sessionId, null);
  assert.equal(result.lastText, "");
});

test("parseStreamJsonOutput: extracts session_id from system init event", () => {
  const jsonl = [
    JSON.stringify({ type: "system", subtype: "init", session_id: "sess-abc123", cwd: "/repo" }),
    JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "Hello" }] } })
  ].join("\n");

  const result = parseStreamJsonOutput(jsonl);
  assert.equal(result.sessionId, "sess-abc123");
  assert.equal(result.lastText, "Hello");
});

test("parseStreamJsonOutput: extracts session_id from result event (takes latest)", () => {
  const jsonl = [
    JSON.stringify({ type: "system", subtype: "init", session_id: "sess-first" }),
    JSON.stringify({ type: "result", subtype: "success", session_id: "sess-final", result: "Done." })
  ].join("\n");

  const result = parseStreamJsonOutput(jsonl);
  assert.equal(result.sessionId, "sess-final");
});

test("parseStreamJsonOutput: extracts last text from multiple assistant messages", () => {
  const jsonl = [
    JSON.stringify({ type: "system", session_id: "s1" }),
    JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "First message." }] } }),
    JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "Final message." }] } })
  ].join("\n");

  const { lastText } = parseStreamJsonOutput(jsonl);
  assert.equal(lastText, "Final message.");
});

test("parseStreamJsonOutput: falls back to result.result when no assistant text", () => {
  const jsonl = [
    JSON.stringify({ type: "system", session_id: "s1" }),
    JSON.stringify({ type: "result", subtype: "success", session_id: "s1", result: "Task completed." })
  ].join("\n");

  const { lastText } = parseStreamJsonOutput(jsonl);
  assert.equal(lastText, "Task completed.");
});

test("parseStreamJsonOutput: handles mixed JSON and non-JSON lines gracefully", () => {
  const mixed = [
    "some plain text log",
    JSON.stringify({ type: "system", session_id: "sess-x" }),
    "another plain line",
    JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "Answer." }] } })
  ].join("\n");

  const result = parseStreamJsonOutput(mixed);
  assert.equal(result.sessionId, "sess-x");
  assert.equal(result.lastText, "Answer.");
});

test("parseStreamJsonOutput: handles all-plain-text output (old format fallback)", () => {
  const plain = "This is a plain text response from the agent.";
  const result = parseStreamJsonOutput(plain);
  assert.equal(result.sessionId, null);
  // plain text captured as lastText when no JSON lines found
  assert.equal(result.lastText, plain);
});

test("parseStreamJsonOutput: empty lines are skipped", () => {
  const jsonl = "\n\n" + JSON.stringify({ type: "system", session_id: "s1" }) + "\n\n";
  const result = parseStreamJsonOutput(jsonl);
  assert.equal(result.sessionId, "s1");
});

// ─── execute-sessions: readSessionPin / writeSessionPin / clearSessionPin ─────

import {
  clearSessionPin,
  executeSessionsFile,
  readSessionPin,
  writeSessionPin
} from "../tools/execute-sessions.mjs";

async function withTmpSessions(fn) {
  let originalContent = null;
  try {
    originalContent = await fs.readFile(executeSessionsFile, "utf8");
  } catch { /* ok if missing */ }

  try {
    await fs.writeFile(executeSessionsFile, JSON.stringify({}), "utf8");
    await fn();
  } finally {
    if (originalContent !== null) {
      await fs.writeFile(executeSessionsFile, originalContent, "utf8").catch(() => {});
    } else {
      await fs.unlink(executeSessionsFile).catch(() => {});
    }
  }
}

test("readSessionPin returns null when no sessions file", async () => {
  const result = await readSessionPin(null);
  assert.equal(result, null);
});

test("writeSessionPin + readSessionPin round-trips session ID", async () => {
  await withTmpSessions(async () => {
    await writeSessionPin(42, "sess-roundtrip", "claude-code");
    const result = await readSessionPin(42);
    assert.equal(result, "sess-roundtrip");
  });
});

test("readSessionPin returns null for missing key", async () => {
  await withTmpSessions(async () => {
    await writeSessionPin(10, "sess-10", "claude-code");
    const result = await readSessionPin(99);
    assert.equal(result, null);
  });
});

test("clearSessionPin removes the session entry", async () => {
  await withTmpSessions(async () => {
    await writeSessionPin(42, "sess-to-clear", "claude-code");
    await clearSessionPin(42);
    const result = await readSessionPin(42);
    assert.equal(result, null);
  });
});

test("clearSessionPin is a no-op for missing key", async () => {
  await withTmpSessions(async () => {
    await assert.doesNotReject(() => clearSessionPin(999));
  });
});

test("writeSessionPin with null key or sessionId is a no-op", async () => {
  await withTmpSessions(async () => {
    await writeSessionPin(null, "sess", "claude-code");
    await writeSessionPin(1, null, "claude-code");
    // Should not throw and should not save anything meaningful
    const r1 = await readSessionPin(null);
    const r2 = await readSessionPin(1);
    assert.equal(r1, null);
    assert.equal(r2, null);
  });
});
