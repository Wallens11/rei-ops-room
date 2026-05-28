import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// Set HOME to a tmp dir before importing the module so projectRoot resolves there
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "rei-memory-test-"));

// Redirect projectRoot by setting env var (execute-worker-state.mjs honors REI_PROJECT_ROOT if present)
process.env.REI_PROJECT_ROOT = tmp;

const memModule = await import("../tools/rei-memory.mjs");
const {
  tokenize,
  recordMemory,
  readMemory,
  searchMemory,
  getRecentMemories,
  formatMemoryContext,
  extractMemoryFromRun,
  memoryFile
} = memModule;

test("tokenize lowercases, strips punctuation, removes stopwords", () => {
  const tokens = tokenize("The QUICK brown fox jumps over the lazy dog!");
  assert.ok(tokens.includes("quick"));
  assert.ok(tokens.includes("brown"));
  assert.ok(!tokens.includes("the"));
  assert.ok(!tokens.includes("over"));
});

test("tokenize handles empty / invalid input", () => {
  assert.deepEqual(tokenize(""), []);
  assert.deepEqual(tokenize(null), []);
  assert.deepEqual(tokenize(undefined), []);
});

test("recordMemory writes a valid entry", async () => {
  // Reset file for this test
  try { await fs.unlink(memoryFile); } catch {}

  const entry = await recordMemory({
    type: "fact",
    topic: "tree-sitter",
    content: "Tree-sitter parses code into ASTs and supports JavaScript via web-tree-sitter.",
    source: "issue:42",
    tags: ["code", "ast"],
    importance: 0.8
  });

  assert.ok(entry.id.startsWith("mem_"));
  assert.equal(entry.type, "fact");
  assert.equal(entry.topic, "tree-sitter");
  assert.equal(entry.source, "issue:42");
  assert.deepEqual(entry.tags, ["code", "ast"]);
  assert.equal(entry.importance, 0.8);

  const all = await readMemory();
  assert.equal(all.length, 1);
});

test("recordMemory validates type — invalid types fall back to 'fact'", async () => {
  try { await fs.unlink(memoryFile); } catch {}
  const e = await recordMemory({ type: "nonsense", content: "test content here" });
  assert.equal(e.type, "fact");
});

test("recordMemory throws when content is missing", async () => {
  await assert.rejects(() => recordMemory({ type: "fact" }), /content is required/);
});

test("searchMemory ranks BM25-style on relevance", async () => {
  try { await fs.unlink(memoryFile); } catch {}

  await recordMemory({
    type: "solution",
    topic: "port conflict",
    content: "EADDRINUSE error means port already used. Fix: lsof -ti:PORT | xargs kill -9",
    tags: ["network", "server"]
  });
  await recordMemory({
    type: "fact",
    topic: "tree-sitter parsing",
    content: "Tree-sitter parses JavaScript and TypeScript via web-tree-sitter bindings.",
    tags: ["code", "ast"]
  });
  await recordMemory({
    type: "warning",
    topic: "npm install",
    content: "Avoid running npm install in CI without --no-audit, it slows things down.",
    tags: ["ci", "npm"]
  });

  const results = await searchMemory("port already in use server EADDRINUSE", { limit: 3 });
  assert.ok(results.length >= 1, "should find port-related memory");
  assert.match(results[0].entry.content, /EADDRINUSE/);

  const treeResults = await searchMemory("parse javascript AST", { limit: 3 });
  assert.match(treeResults[0].entry.content, /tree-sitter/i);
});

test("searchMemory filters by type", async () => {
  try { await fs.unlink(memoryFile); } catch {}
  await recordMemory({ type: "fact", content: "the test fact about parsing code" });
  await recordMemory({ type: "warning", content: "the test warning about parsing code" });

  const facts = await searchMemory("parsing code", { types: ["fact"] });
  assert.equal(facts.length, 1);
  assert.equal(facts[0].entry.type, "fact");
});

test("searchMemory filters by tags (ALL must match)", async () => {
  try { await fs.unlink(memoryFile); } catch {}
  await recordMemory({ content: "alpha beta gamma content", tags: ["a", "b"] });
  await recordMemory({ content: "alpha beta gamma content", tags: ["a"] });

  const results = await searchMemory("alpha beta", { tags: ["a", "b"] });
  assert.equal(results.length, 1);
});

test("getRecentMemories returns newest first", async () => {
  try { await fs.unlink(memoryFile); } catch {}
  const first = await recordMemory({ content: "first entry recorded" });
  await new Promise((r) => setTimeout(r, 5));
  const second = await recordMemory({ content: "second entry recorded" });

  const recent = await getRecentMemories({ limit: 5 });
  assert.equal(recent[0].id, second.id);
  assert.equal(recent[1].id, first.id);
});

test("formatMemoryContext produces prompt-friendly markdown", () => {
  const memories = [
    { entry: { type: "fact", topic: "x", content: "abc" } },
    { entry: { type: "warning", topic: "y", content: "def" } }
  ];
  const out = formatMemoryContext(memories);
  assert.match(out, /### Relevant memory/);
  assert.match(out, /📌/);
  assert.match(out, /⚠️/);
  assert.match(out, /abc/);
});

test("formatMemoryContext returns empty string for empty input", () => {
  assert.equal(formatMemoryContext([]), "");
  assert.equal(formatMemoryContext(null), "");
});

test("extractMemoryFromRun pulls facts from agent output", async () => {
  try { await fs.unlink(memoryFile); } catch {}

  const recorded = await extractMemoryFromRun({
    lastMessage:
      "I discovered that the worker hangs when token is invalid. " +
      "Fixed by setting GITHUB_TOKEN before starting. " +
      "Be careful: don't commit .env files.",
    outcome: "completed",
    issueNumber: 99,
    changedFiles: ["tools/execute-worker.mjs"]
  });

  assert.ok(recorded.length >= 2, "should extract multiple kinds of memory");
  const types = recorded.map((r) => r.type);
  assert.ok(types.includes("fact"));
});

// Cleanup
test.after(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});
