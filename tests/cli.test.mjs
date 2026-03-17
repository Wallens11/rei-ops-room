import test from "node:test";
import assert from "node:assert/strict";

import {
  buildViewerUrl,
  inferServerRuntime,
  normalizeMode,
  parseCliArgs
} from "../tools/agent-pixel-cli.mjs";

test("normalizeMode falls back to room", () => {
  assert.equal(normalizeMode("room"), "room");
  assert.equal(normalizeMode("widget"), "widget");
  assert.equal(normalizeMode("weird"), "room");
});

test("buildViewerUrl appends widget mode only when requested", () => {
  assert.equal(buildViewerUrl({ port: 4317, mode: "room" }), "http://localhost:4317/?mode=room");
  assert.equal(
    buildViewerUrl({ port: 4317, mode: "widget" }),
    "http://localhost:4317/?mode=widget"
  );
});

test("parseCliArgs understands activate widget --no-open", () => {
  const parsed = parseCliArgs(["activate", "widget", "--no-open", "--port", "4400"]);
  assert.deepEqual(parsed, {
    command: "activate",
    mode: "widget",
    open: false,
    port: 4400
  });
});

test("inferServerRuntime treats an agent listener as running even when the HTTP probe is down", () => {
  const runtime = inferServerRuntime({
    reachable: false,
    pidFilePid: 1201,
    pidFileAlive: true,
    pidFileCommand: "node /Users/funtoco/workSpace/codex-pixel-agent/server.mjs",
    listenerPid: 1201,
    listenerCommand: "node /Users/funtoco/workSpace/codex-pixel-agent/server.mjs"
  });

  assert.equal(runtime.running, true);
  assert.equal(runtime.pid, 1201);
  assert.equal(runtime.source, "listener");
});

test("inferServerRuntime does not treat an unrelated port listener as the pixel agent", () => {
  const runtime = inferServerRuntime({
    reachable: false,
    pidFilePid: null,
    pidFileAlive: false,
    pidFileCommand: "",
    listenerPid: 4242,
    listenerCommand: "python -m http.server 4317"
  });

  assert.equal(runtime.running, false);
  assert.equal(runtime.pid, null);
  assert.equal(runtime.source, "none");
});
