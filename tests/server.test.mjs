import test from "node:test";
import assert from "node:assert/strict";

import {
  buildAgentJobItemsSql,
  buildGlobalRuntimeLogsSql,
  contentType,
  createSseFrame,
  buildThreadLogsSql,
  filterMeaningfulLogs,
  selectActivityLogs,
  stripWorkspacePrefix,
  SQLITE_JSON_MAX_BUFFER,
  sqliteJsonWithRunner
} from "../server.mjs";

test("sqliteJsonWithRunner raises maxBuffer for larger runtime log payloads", async () => {
  let captured = null;

  const rows = await sqliteJsonWithRunner(
    async (file, args, options) => {
      captured = { file, args, options };
      return {
        stdout: '[{"id":1,"message":"ok"}]'
      };
    },
    "/tmp/state.sqlite",
    "SELECT * FROM logs LIMIT 500;"
  );

  assert.deepEqual(rows, [{ id: 1, message: "ok" }]);
  assert.equal(captured.file, "sqlite3");
  assert.deepEqual(captured.args, ["-json", "/tmp/state.sqlite", "SELECT * FROM logs LIMIT 500;"]);
  assert.equal(captured.options.maxBuffer, SQLITE_JSON_MAX_BUFFER);
  assert.ok(SQLITE_JSON_MAX_BUFFER >= 8 * 1024 * 1024);
});

test("sqliteJsonWithRunner falls back to python when sqlite3 CLI is unavailable", async () => {
  const calls = [];

  const rows = await sqliteJsonWithRunner(
    async (file, args, options) => {
      calls.push({ file, args, options });

      if (file === "sqlite3") {
        const error = new Error("spawn sqlite3 ENOENT");
        error.code = "ENOENT";
        throw error;
      }

      return {
        stdout: '[{"thread_id":"thread_1","title":"room status"}]'
      };
    },
    "/tmp/state.sqlite",
    "SELECT thread_id, title FROM threads LIMIT 1;"
  );

  assert.deepEqual(rows, [{ thread_id: "thread_1", title: "room status" }]);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].file, "sqlite3");
  assert.equal(calls[1].file, "python");
  assert.deepEqual(calls[1].args.slice(0, 2), ["-c", calls[1].args[1]]);
  assert.equal(calls[1].args[2], "/tmp/state.sqlite");
  assert.equal(calls[1].args[3], "SELECT thread_id, title FROM threads LIMIT 1;");
});

test("buildThreadLogsSql trims message payloads before exporting large log windows", () => {
  const sql = buildThreadLogsSql("thread-123");

  assert.match(sql, /substr\(message,\s*1,\s*320\)\s+AS\s+message/i);
  assert.match(sql, /LIMIT 500/i);
  assert.match(sql, /WHERE thread_id = 'thread-123'/);
});

test("buildGlobalRuntimeLogsSql pulls recent unscoped runtime logs for fallback activity", () => {
  const sql = buildGlobalRuntimeLogsSql();

  assert.match(sql, /FROM logs/i);
  assert.match(sql, /thread_id IS NULL OR thread_id = ''/i);
  assert.match(sql, /ORDER BY ts DESC/i);
});

test("buildAgentJobItemsSql scopes multi-agent rows to the active thread", () => {
  const sql = buildAgentJobItemsSql("thread-456");

  assert.match(sql, /FROM agent_job_items/i);
  assert.match(sql, /JOIN agent_jobs/i);
  assert.match(sql, /assigned_thread_id = 'thread-456'/i);
  assert.match(sql, /ORDER BY items\.updated_at DESC/i);
});

test("filterMeaningfulLogs ignores tool gate wait noise", () => {
  const logs = filterMeaningfulLogs([
    {
      message: "waiting for tool gate"
    },
    {
      message: "tool gate released"
    },
    {
      message: 'ToolCall: functions.exec_command {"cmd":"npm test"}'
    }
  ]);

  assert.equal(logs.length, 1);
  assert.equal(logs[0].message, 'ToolCall: functions.exec_command {"cmd":"npm test"}');
});

test("filterMeaningfulLogs ignores internal write_stdin plumbing events", () => {
  const logs = filterMeaningfulLogs([
    {
      message: "ToolCall: functions.write_stdin"
    },
    {
      message: 'ToolCall: functions.exec_command {"cmd":"npm test"}'
    }
  ]);

  assert.equal(logs.length, 1);
  assert.equal(logs[0].message, 'ToolCall: functions.exec_command {"cmd":"npm test"}');
});

test("filterMeaningfulLogs ignores codex websocket connection chatter", () => {
  const logs = filterMeaningfulLogs([
    {
      message:
        "successfully connected to websocket: wss://chatgpt.com/backend-api/codex/responses"
    },
    {
      message: 'ToolCall: functions.exec_command {"cmd":"npm test"}'
    }
  ]);

  assert.equal(logs.length, 1);
  assert.equal(logs[0].message, 'ToolCall: functions.exec_command {"cmd":"npm test"}');
});

test("selectActivityLogs falls back to recent global runtime logs when thread logs only contain noise", () => {
  const logs = selectActivityLogs(
    [
      {
        ts: 1710000000,
        message: 'websocket event: {"type":"response.output_item.done"}'
      }
    ],
    [
      {
        ts: 1710000002,
        message: 'Received message {"type":"response.function_call_arguments.done","arguments":"{\\"cmd\\":\\"npm test\\"}"}'
      }
    ],
    {
      nowSeconds: 1710000004,
      recentWindowSeconds: 20
    }
  );

  assert.equal(logs.length, 1);
  assert.match(logs[0].message, /npm test/);
});

test("stripWorkspacePrefix handles Windows-style workspace paths", () => {
  const workspaceRoot = "C:\\Users\\muham\\workSpace";

  assert.equal(
    stripWorkspacePrefix("C:\\Users\\muham\\workSpace\\rei-ops-room", workspaceRoot),
    "rei-ops-room"
  );
  assert.equal(stripWorkspacePrefix(workspaceRoot, workspaceRoot), "workspace root");
});

test("contentType serves svg assets with the correct MIME type", () => {
  assert.equal(contentType("public/favicon.svg"), "image/svg+xml");
});

test("createSseFrame formats named events with retry and JSON data", () => {
  const frame = createSseFrame({
    event: "status",
    retry: 2500,
    id: "evt-1",
    data: {
      ok: true,
      repo: "rei-ops-room"
    }
  });

  assert.equal(
    frame,
    'id: evt-1\nevent: status\nretry: 2500\ndata: {"ok":true,"repo":"rei-ops-room"}\n\n'
  );
});
