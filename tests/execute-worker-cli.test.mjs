import test from "node:test";
import assert from "node:assert/strict";

import {
  buildExecuteWorkerStatusLine,
  inferExecuteWorkerAction,
  inferExecuteWorkerRuntime,
  parseExecuteWorkerCliArgs,
  workerPidFile,
  workerLogFile
} from "../tools/execute-worker-cli.mjs";

test("parseExecuteWorkerCliArgs understands start interval and repo overrides", () => {
  const parsed = parseExecuteWorkerCliArgs([
    "start",
    "--repo",
    "example-org/my-project",
    "--interval-seconds",
    "90"
  ]);

  assert.deepEqual(parsed, {
    command: "start",
    repo: "example-org/my-project",
    intervalMs: 90_000,
    workerIndex: 1
  });
});

test("parseExecuteWorkerCliArgs parses --worker flag", () => {
  const parsed = parseExecuteWorkerCliArgs(["start", "--worker", "2"]);
  assert.equal(parsed.workerIndex, 2);
  assert.equal(parsed.command, "start");
});

test("parseExecuteWorkerCliArgs defaults workerIndex to 1 when --worker is omitted", () => {
  const parsed = parseExecuteWorkerCliArgs(["stop"]);
  assert.equal(parsed.workerIndex, 1);
});

test("workerPidFile returns canonical path for worker 1 and indexed path for worker 2", () => {
  const pid1 = workerPidFile(1);
  const pid2 = workerPidFile(2);
  assert.ok(pid1.endsWith(".execute-worker.pid"), `worker 1 pid file should end with .execute-worker.pid, got ${pid1}`);
  assert.ok(pid2.endsWith(".execute-worker-2.pid"), `worker 2 pid file should end with .execute-worker-2.pid, got ${pid2}`);
  assert.notEqual(pid1, pid2);
});

test("workerLogFile returns canonical path for worker 1 and indexed path for worker 2", () => {
  const log1 = workerLogFile(1);
  const log2 = workerLogFile(2);
  assert.ok(log1.endsWith(".execute-worker.log"), `worker 1 log file should end with .execute-worker.log, got ${log1}`);
  assert.ok(log2.endsWith(".execute-worker-2.log"), `worker 2 log file should end with .execute-worker-2.log, got ${log2}`);
  assert.notEqual(log1, log2);
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
