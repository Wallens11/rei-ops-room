import test from "node:test";
import assert from "node:assert/strict";

import {
  buildThreadLogsSql,
  filterMeaningfulLogs,
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

test("buildThreadLogsSql trims message payloads before exporting large log windows", () => {
  const sql = buildThreadLogsSql("thread-123");

  assert.match(sql, /substr\(message,\s*1,\s*320\)\s+AS\s+message/i);
  assert.match(sql, /LIMIT 500/i);
  assert.match(sql, /WHERE thread_id = 'thread-123'/);
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
