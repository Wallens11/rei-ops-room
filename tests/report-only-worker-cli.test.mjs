import test from "node:test";
import assert from "node:assert/strict";

import {
  buildWorkerStatusLine,
  inferWorkerAction,
  inferWorkerRuntime,
  parseWorkerCliArgs
} from "../tools/report-only-worker-cli.mjs";

test("parseWorkerCliArgs understands start interval and repo overrides", () => {
  const parsed = parseWorkerCliArgs(["start", "--repo", "Wallens11/rei-ops-room", "--interval-seconds", "90"]);

  assert.deepEqual(parsed, {
    command: "start",
    repo: "Wallens11/rei-ops-room",
    intervalMs: 90_000
  });
});

test("inferWorkerRuntime treats a live worker pid as running", () => {
  const runtime = inferWorkerRuntime({
    pidFilePid: 7123,
    pidFileAlive: true,
    pidFileCommand: "node /Users/funtoco/workSpace/codex-pixel-agent/tools/report-only-worker.mjs"
  });

  assert.equal(runtime.running, true);
  assert.equal(runtime.pid, 7123);
  assert.equal(runtime.source, "pid");
});

test("inferWorkerRuntime distinguishes stale pid files from an active worker", () => {
  const runtime = inferWorkerRuntime({
    pidFilePid: 8123,
    pidFileAlive: false,
    pidFileCommand: ""
  });

  assert.equal(runtime.running, false);
  assert.equal(runtime.pid, null);
  assert.equal(runtime.source, "stale_pid");
});

test("inferWorkerAction reuses a live worker and starts when no worker is present", () => {
  assert.deepEqual(
    inferWorkerAction({
      runtime: {
        running: true,
        pid: 7123,
        source: "pid"
      }
    }),
    {
      type: "reuse",
      pid: 7123
    }
  );

  assert.deepEqual(
    inferWorkerAction({
      runtime: {
        running: false,
        pid: null,
        source: "none"
      }
    }),
    {
      type: "start"
    }
  );
});

test("buildWorkerStatusLine reports stale pid files without pretending the worker is running", () => {
  const line = buildWorkerStatusLine({
    running: false,
    pid: null,
    source: "stale_pid"
  });

  assert.match(line, /stale pid/i);
  assert.doesNotMatch(line, /running at/i);
});
