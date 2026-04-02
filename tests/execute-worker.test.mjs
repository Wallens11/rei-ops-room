import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCodexExecInvocation,
  resolveCodexCommand
} from "../tools/execute-worker.mjs";

test("resolveCodexCommand prefers CODEX_BIN when provided", async () => {
  const command = await resolveCodexCommand({
    env: {
      CODEX_BIN: "/tmp/custom-codex"
    },
    fileExists: async () => false
  });

  assert.equal(command, "/tmp/custom-codex");
});

test("resolveCodexCommand falls back to the app bundle binary when it exists", async () => {
  const command = await resolveCodexCommand({
    env: {},
    fileExists: async (candidate) =>
      candidate === "/Applications/Codex.app/Contents/Resources/codex"
  });

  assert.equal(command, "/Applications/Codex.app/Contents/Resources/codex");
});

test("resolveCodexCommand falls back to plain codex when no absolute binary is available", async () => {
  const command = await resolveCodexCommand({
    env: {},
    fileExists: async () => false
  });

  assert.equal(command, "codex");
});

test("buildCodexExecInvocation places global flags before the exec subcommand", () => {
  const invocation = buildCodexExecInvocation({
    codexCommand: "/Applications/Codex.app/Contents/Resources/codex",
    repoCwd: "/Users/funtoco/workSpace/codex-pixel-agent",
    outputLastMessageFile: "/tmp/last-message.md"
  });

  assert.equal(invocation.command, "/Applications/Codex.app/Contents/Resources/codex");
  assert.deepEqual(invocation.args.slice(0, 6), [
    "-a",
    "never",
    "-s",
    "workspace-write",
    "exec",
    "-C"
  ]);
});
