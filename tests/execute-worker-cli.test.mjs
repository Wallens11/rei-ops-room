import test from "node:test";
import assert from "node:assert/strict";

import {
  buildExecuteWorkerStatusLine,
  inferExecuteWorkerAction,
  inferExecuteWorkerRuntime,
  parseExecuteWorkerCliArgs
} from "../tools/execute-worker-cli.mjs";

test("parseExecuteWorkerCliArgs understands start interval and repo overrides", () => {
  const parsed = parseExecuteWorkerCliArgs([
    "start",
    "--repo",
    "Wallens11/rei-ops-room",
    "--interval-seconds",
    "90"
  ]);

  assert.deepEqual(parsed, {
    command: "start",
    repo: "Wallens11/rei-ops-room",
    intervalMs: 90_000
  });
});

test("inferExecuteWorkerRuntime treats a live worker pid as running", () => {
  const runtime = inferExecuteWorkerRuntime({
    pidFilePid: 7123,
    pidFileAlive: true,
    pidFileCommand: "node /Users/funtoco/workSpace/codex-pixel-agent/tools/execute-worker.mjs"
  });

  assert.equal(runtime.running, true);
  assert.equal(runtime.pid, 7123);
  assert.equal(runtime.source, "pid");
});

test("inferExecuteWorkerAction reuses a live worker and starts when no worker is present", () => {
  assert.deepEqual(
    inferExecuteWorkerAction({
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
    inferExecuteWorkerAction({
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

test("buildExecuteWorkerStatusLine includes the active issue when the worker is running", () => {
  const line = buildExecuteWorkerStatusLine({
    running: true,
    pid: 8123,
    source: "pid",
    currentTarget: {
      number: 24,
      title: "Queue runner should expose its active mission"
    }
  });

  assert.match(line, /pid 8123/i);
  assert.match(line, /#24/i);
  assert.match(line, /active mission/i);
});
