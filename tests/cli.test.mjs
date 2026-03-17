import test from "node:test";
import assert from "node:assert/strict";

import {
  buildViewerUrl,
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
