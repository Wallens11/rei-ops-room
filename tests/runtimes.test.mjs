import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import * as codex from "../tools/runtimes/codex.mjs";
import * as claudeCode from "../tools/runtimes/claude-code.mjs";
import {
  DEFAULT_RUNTIME_PREFERENCES,
  RUNTIME_MAP,
  buildRuntimeStartupSummary,
  getRuntime,
  loadRuntimePreferences,
  probeAvailableRuntimes,
  resolveRuntimeOrder,
  selectRuntime
} from "../tools/runtimes/index.mjs";

test("codex runtime exports a stable identity", () => {
  assert.equal(codex.RUNTIME_ID, "codex");
  assert.equal(typeof codex.RUNTIME_LABEL, "string");
  assert.ok(codex.RUNTIME_LABEL.length > 0);
});

test("codex runtime prefers CODEX_BIN when provided", async () => {
  const command = await codex.resolveCommand({
    env: {
      CODEX_BIN: "/custom/codex"
    }
  });

  assert.equal(command, "/custom/codex");
});

test("claude runtime exports a stable identity", () => {
  assert.equal(claudeCode.RUNTIME_ID, "claude-code");
  assert.equal(typeof claudeCode.RUNTIME_LABEL, "string");
  assert.ok(claudeCode.RUNTIME_LABEL.length > 0);
});

test("claude runtime prefers CLAUDE_BIN when provided", async () => {
  const command = await claudeCode.resolveCommand({
    env: {
      CLAUDE_BIN: "/usr/local/bin/claude"
    }
  });

  assert.equal(command, "/usr/local/bin/claude");
});

test("runtime registry exposes codex and claude-code", () => {
  assert.ok(RUNTIME_MAP.has("codex"));
  assert.ok(RUNTIME_MAP.has("claude-code"));
  assert.equal(getRuntime("unknown-runtime").RUNTIME_ID, "codex");
});

test("selectRuntime uses the configured default routing", () => {
  assert.equal(selectRuntime("frontend", ["codex", "claude-code"]), "claude-code");
  assert.equal(selectRuntime("backend", ["codex", "claude-code"]), "codex");
  assert.equal(selectRuntime("scraping", ["codex", "claude-code"]), "codex");
  assert.equal(selectRuntime("docs", ["codex", "claude-code"]), "claude-code");
});

test("probeAvailableRuntimes returns runtime ids that resolve locally", async () => {
  const result = await probeAvailableRuntimes(process.env);
  assert.ok(Array.isArray(result));
  for (const runtimeId of result) {
    assert.equal(typeof runtimeId, "string");
  }
});

test("loadRuntimePreferences falls back to defaults when the repo config is missing", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "rei-runtimes-missing-"));

  try {
    const config = await loadRuntimePreferences({
      cwd: tempDir
    });

    assert.deepEqual(config.preferences, DEFAULT_RUNTIME_PREFERENCES);
    assert.equal(config.rateLimitFallback, true);
    assert.equal(config.exists, false);
    assert.equal(config.sourcePath, path.join(tempDir, ".rei-runtimes.json"));
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("loadRuntimePreferences merges partial repo overrides with the default routing", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "rei-runtimes-merge-"));
  const configPath = path.join(tempDir, ".rei-runtimes.json");

  try {
    await fs.writeFile(
      configPath,
      `${JSON.stringify(
        {
          preferences: {
            frontend: ["codex"],
            docs: ["claude-code", "codex"]
          },
          rateLimitFallback: false
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    const config = await loadRuntimePreferences({
      cwd: tempDir
    });

    assert.equal(config.exists, true);
    assert.deepEqual(config.preferences.frontend, ["codex"]);
    assert.deepEqual(config.preferences.docs, ["claude-code", "codex"]);
    assert.deepEqual(config.preferences.backend, DEFAULT_RUNTIME_PREFERENCES.backend);
    assert.equal(config.rateLimitFallback, false);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("resolveRuntimeOrder filters unavailable runtimes and falls back to general routing", () => {
  assert.deepEqual(
    resolveRuntimeOrder({
      taskType: "frontend",
      preferences: DEFAULT_RUNTIME_PREFERENCES,
      availableRuntimeIds: ["codex"]
    }),
    ["codex"]
  );

  assert.deepEqual(
    resolveRuntimeOrder({
      taskType: "backend",
      preferences: DEFAULT_RUNTIME_PREFERENCES,
      availableRuntimeIds: ["claude-code", "codex"]
    }),
    ["codex", "claude-code"]
  );

  assert.deepEqual(
    resolveRuntimeOrder({
      taskType: "unknown-task",
      preferences: DEFAULT_RUNTIME_PREFERENCES,
      availableRuntimeIds: ["claude-code", "codex"]
    }),
    DEFAULT_RUNTIME_PREFERENCES.general
  );
});

test("buildRuntimeStartupSummary reports the active routing and fallback flag", () => {
  const summary = buildRuntimeStartupSummary({
    config: {
      preferences: DEFAULT_RUNTIME_PREFERENCES,
      rateLimitFallback: true
    },
    availableRuntimeIds: ["claude-code", "codex"]
  });

  assert.match(summary.availableLine, /claude-code, codex/i);
  assert.match(summary.routingLine, /frontend→claude-code/i);
  assert.match(summary.routingLine, /backend→codex/i);
  assert.match(summary.fallbackLine, /enabled/i);
});
