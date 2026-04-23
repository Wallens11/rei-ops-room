import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { DEFAULT_REI_CONFIG, loadReiConfig } from "../tools/rei-config.mjs";

test("loadReiConfig returns defaults when no file and no env", async () => {
  const config = await loadReiConfig({
    configPath: "/nonexistent/rei.config.json",
    env: {}
  });
  assert.equal(config.repo, null);
  assert.equal(config.port, DEFAULT_REI_CONFIG.port);
  assert.equal(config.githubWebhookSecret, "");
  assert.equal(config.statusStreamIntervalMs, DEFAULT_REI_CONFIG.statusStreamIntervalMs);
});

test("loadReiConfig reads repo and port from rei.config.json", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rei-cfg-"));
  const cfgPath = path.join(tmpDir, "rei.config.json");
  try {
    await fs.writeFile(cfgPath, JSON.stringify({ repo: "owner/myrepo", port: 9000 }), "utf8");
    const config = await loadReiConfig({ configPath: cfgPath, env: {} });
    assert.equal(config.repo, "owner/myrepo");
    assert.equal(config.port, 9000);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test("loadReiConfig: env vars override file config", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rei-cfg-"));
  const cfgPath = path.join(tmpDir, "rei.config.json");
  try {
    await fs.writeFile(cfgPath, JSON.stringify({ repo: "file/repo", port: 9000 }), "utf8");
    const config = await loadReiConfig({
      configPath: cfgPath,
      env: { GITHUB_REPO: "env/repo", PORT: "5000" }
    });
    assert.equal(config.repo, "env/repo");
    assert.equal(config.port, 5000);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test("loadReiConfig: does not throw when file is missing (ENOENT)", async () => {
  const config = await loadReiConfig({
    configPath: "/this/does/not/exist/rei.config.json",
    env: {}
  });
  assert.equal(config.repo, null);
  assert.equal(config.port, DEFAULT_REI_CONFIG.port);
});

test("loadReiConfig: partial file config merges with defaults", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rei-cfg-"));
  const cfgPath = path.join(tmpDir, "rei.config.json");
  try {
    await fs.writeFile(cfgPath, JSON.stringify({ repo: "owner/partial" }), "utf8");
    const config = await loadReiConfig({ configPath: cfgPath, env: {} });
    assert.equal(config.repo, "owner/partial");
    assert.equal(config.port, DEFAULT_REI_CONFIG.port);
    assert.equal(config.githubWebhookSecret, "");
    assert.equal(config.codexBin, null);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test("loadReiConfig: all env vars mapped correctly", async () => {
  const config = await loadReiConfig({
    configPath: "/nonexistent.json",
    env: {
      GITHUB_REPO: "env/full",
      WORKSPACE_ROOT: "/workspace",
      PORT: "8080",
      CODEX_HOME: "/custom/codex",
      CODEX_BIN: "/usr/bin/codex",
      CLAUDE_BIN: "/usr/bin/claude",
      DAILY_DEVICE_HANDOFF_PATH: "/daily.md",
      GITHUB_WEBHOOK_SECRET: "secret123",
      STATUS_STREAM_INTERVAL_MS: "3000"
    }
  });
  assert.equal(config.repo, "env/full");
  assert.equal(config.workspacePath, "/workspace");
  assert.equal(config.port, 8080);
  assert.equal(config.codexHome, "/custom/codex");
  assert.equal(config.codexBin, "/usr/bin/codex");
  assert.equal(config.claudeBin, "/usr/bin/claude");
  assert.equal(config.dailyHandoffPath, "/daily.md");
  assert.equal(config.githubWebhookSecret, "secret123");
  assert.equal(config.statusStreamIntervalMs, 3000);
});

test("DEFAULT_REI_CONFIG is frozen and has expected shape", () => {
  assert.ok(Object.isFrozen(DEFAULT_REI_CONFIG));
  assert.equal(typeof DEFAULT_REI_CONFIG.port, "number");
  assert.equal(DEFAULT_REI_CONFIG.repo, null);
});
