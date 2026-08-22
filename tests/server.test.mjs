import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import crypto from "node:crypto";

import {
  buildAgentJobItemsSql,
  buildThreadSpawnEdgesSql,
  buildThreadHeartbeatsSql,
  buildSpawnRootSql,
  buildGithubIssueListArgs,
  buildGithubQueuePlan,
  buildGithubIssueSummary,
  buildGlobalRuntimeLogsSql,
  chooseLogsMessageColumn,
  contentType,
  createServer,
  createSseFrame,
  buildThreadLogsSql,
  filterMeaningfulLogs,
  inferGithubRepoSlugWithRunner,
  isRelevantWebhookEvent,
  listGithubIssuesWithRunner,
  normalizeGithubRepoSlug,
  parseDailyDeviceHandoffMarkdown,
  extractStructuredHandoffFields,
  selectActivityLogs,
  readDailyDeviceHandoff,
  readAgentJobsForThread,
  resolveCodexLogsDbPath,
  resolveThreadRootRow,
  startServer,
  stripWorkspacePrefix,
  verifyGithubWebhookSignature,
  SQLITE_JSON_MAX_BUFFER,
  sqliteJsonWithRunner
} from "../server.mjs";

test("startServer binds to loopback by default", async (t) => {
  const server = startServer(0);
  await once(server, "listening");
  t.after(() => server.close());

  assert.equal(server.address().address, "127.0.0.1");
});

test("demo mode blocks endpoints that inspect arbitrary local codebases", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "rei-demo-isolation-"));
  const server = createServer({ demoMode: true });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    server.close();
    await fs.rm(root, { recursive: true, force: true });
  });

  const { port } = server.address();
  const response = await fetch(
    `http://127.0.0.1:${port}/api/rei/codebase?root=${encodeURIComponent(root)}`
  );
  const payload = await response.json();

  assert.equal(response.status, 403);
  assert.equal(payload.demo, true);
});

test("demo mode serves isolated read-only brain fixtures", async (t) => {
  const server = createServer({ demoMode: true });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());

  const { port } = server.address();
  const [memoryResponse, costsResponse, personalityResponse, chatResponse] = await Promise.all([
    fetch(`http://127.0.0.1:${port}/api/rei/memory?limit=12`),
    fetch(`http://127.0.0.1:${port}/api/rei/costs`),
    fetch(`http://127.0.0.1:${port}/api/rei/personality`),
    fetch(`http://127.0.0.1:${port}/api/rei/chat?limit=60`)
  ]);

  assert.equal(memoryResponse.status, 200);
  assert.deepEqual(await memoryResponse.json(), { entries: [], query: "", demo: true });
  assert.equal(costsResponse.status, 200);
  assert.equal((await costsResponse.json()).demo, true);
  assert.equal(personalityResponse.status, 200);
  assert.equal((await personalityResponse.json()).mood, "focused");
  assert.equal(chatResponse.status, 200);
  assert.deepEqual(await chatResponse.json(), { messages: [], demo: true });
});

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

test("buildThreadLogsSql can target feedback_log_body when newer Codex logs omit the message column", () => {
  const sql = buildThreadLogsSql("thread-123", 500, 320, "feedback_log_body");

  assert.match(sql, /substr\(feedback_log_body,\s*1,\s*320\)\s+AS\s+message/i);
});

test("buildGlobalRuntimeLogsSql pulls recent unscoped runtime logs for fallback activity", () => {
  const sql = buildGlobalRuntimeLogsSql();

  assert.match(sql, /FROM logs/i);
  assert.match(sql, /thread_id IS NULL OR thread_id = ''/i);
  assert.match(sql, /ORDER BY ts DESC/i);
});

test("buildGlobalRuntimeLogsSql can target feedback_log_body when newer Codex logs omit the message column", () => {
  const sql = buildGlobalRuntimeLogsSql(120, 320, "feedback_log_body");

  assert.match(sql, /substr\(feedback_log_body,\s*1,\s*320\)\s+AS\s+message/i);
});

test("chooseLogsMessageColumn prefers message when it exists", () => {
  const column = chooseLogsMessageColumn([
    { name: "id" },
    { name: "message" },
    { name: "feedback_log_body" }
  ]);

  assert.equal(column, "message");
});

test("chooseLogsMessageColumn falls back to feedback_log_body for newer Codex log schemas", () => {
  const column = chooseLogsMessageColumn([
    { name: "id" },
    { name: "feedback_log_body" }
  ]);

  assert.equal(column, "feedback_log_body");
});

test("buildAgentJobItemsSql scopes multi-agent rows to the active thread", () => {
  const sql = buildAgentJobItemsSql("thread-456");

  assert.match(sql, /FROM agent_job_items/i);
  assert.match(sql, /JOIN agent_jobs/i);
  assert.match(sql, /assigned_thread_id = 'thread-456'/i);
  assert.match(sql, /ORDER BY items\.updated_at DESC/i);
  assert.match(sql, /max_runtime_seconds/i);
});

test("buildThreadSpawnEdgesSql maps the current Codex spawn schema into agent jobs", () => {
  const sql = buildThreadSpawnEdgesSql("parent-thread");

  assert.match(sql, /FROM thread_spawn_edges/i);
  assert.match(sql, /JOIN threads/i);
  assert.match(sql, /parent_thread_id = 'parent-thread'/i);
  assert.match(sql, /thread_spawn_edge/i);
  assert.match(sql, /agent_nickname/i);
});

test("buildThreadHeartbeatsSql scopes log heartbeats to child thread ids", () => {
  const sql = buildThreadHeartbeatsSql(["child-a", "child-b"]);

  assert.match(sql, /MAX\(ts\) AS heartbeat_at/i);
  assert.match(sql, /thread_id IN \('child-a', 'child-b'\)/i);
});

test("buildSpawnRootSql walks from the latest child back to its root parent", () => {
  const sql = buildSpawnRootSql("child-live");

  assert.match(sql, /WITH RECURSIVE ancestry/i);
  assert.match(sql, /child_thread_id = 'child-live'/i);
  assert.match(sql, /ORDER BY depth DESC/i);
});

test("resolveThreadRootRow keeps child activity but returns the root room thread", async () => {
  const calls = [];
  const root = await resolveThreadRootRow({
    activityThreadRow: { id: "child-live", title: "Child work" },
    stateDatabase: "state.sqlite",
    sqliteJsonImpl: async (_database, sql) => {
      calls.push(sql);
      if (/WITH RECURSIVE ancestry/i.test(sql)) return [{ root_id: "parent-root" }];
      if (/WHERE id = 'parent-root'/i.test(sql)) {
        return [{ id: "parent-root", title: "Root request", updatedAt: 100 }];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    }
  });

  assert.equal(root.id, "parent-root");
  assert.equal(calls.length, 2);
});

test("readAgentJobsForThread uses spawn edges and merges child log heartbeats", async () => {
  const calls = [];
  const rows = await readAgentJobsForThread({
    threadId: "parent-thread",
    stateDatabase: "state.sqlite",
    logsDatabase: "logs.sqlite",
    sqliteJsonImpl: async (database, sql) => {
      calls.push({ database, sql });
      if (/sqlite_master/i.test(sql)) {
        return [{ name: "thread_spawn_edges" }, { name: "threads" }];
      }
      if (/FROM thread_spawn_edges/i.test(sql)) {
        return [{
          item_id: "child-a",
          status: "open",
          updated_at: 100,
          heartbeat_at: 100,
          source_kind: "thread_spawn_edge"
        }];
      }
      if (/FROM logs/i.test(sql)) {
        return [{ thread_id: "child-a", heartbeat_at: 240 }];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    }
  });

  assert.equal(rows[0].heartbeat_at, 240);
  assert.equal(rows[0].source_kind, "thread_spawn_edge");
  assert.ok(calls.some((call) => call.database === "logs.sqlite"));
  assert.ok(calls.every((call) => !/FROM agent_job_items/i.test(call.sql)));
});

test("resolveCodexLogsDbPath selects the populated current Codex log database", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "rei-codex-logs-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, "logs_1.sqlite"), "stale-but-larger".repeat(20));
  await fs.writeFile(path.join(root, "logs_2.sqlite"), "current");

  assert.equal(
    await resolveCodexLogsDbPath({
      codexHomePath: root,
      sqliteJsonImpl: async (database) => [{
        latest_ts: database.endsWith("logs_2.sqlite") ? 200 : 100
      }]
    }),
    path.join(root, "logs_2.sqlite")
  );
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
      message: "deregistering event source from poller"
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

test("filterMeaningfulLogs ignores app-server envelope chatter", () => {
  const logs = filterMeaningfulLogs([
    {
      target: "codex_app_server::codex_message_processor",
      message: "app-server event: codex/event/agent_message_delta"
    },
    {
      target: "codex_app_server::outgoing_message",
      message: "app-server event: item/agentMessage/delta"
    },
    {
      target: "codex_core::stream_events_utils",
      message: 'ToolCall: functions.exec_command {"cmd":"npm test"}'
    }
  ]);

  assert.equal(logs.length, 1);
  assert.equal(logs[0].message, 'ToolCall: functions.exec_command {"cmd":"npm test"}');
});

test("filterMeaningfulLogs ignores background model cache chatter", () => {
  const logs = filterMeaningfulLogs([
    {
      target: "codex_core::models_manager::manager",
      message: "models cache: using cached models for OnlineIfUncached"
    },
    {
      target: "codex_core::models_manager::cache",
      message: "models cache: cache hit"
    },
    {
      target: "codex_core::stream_events_utils",
      message: 'ToolCall: functions.exec_command {"cmd":"npm test"}'
    }
  ]);

  assert.equal(logs.length, 1);
  assert.equal(logs[0].message, 'ToolCall: functions.exec_command {"cmd":"npm test"}');
});

test("filterMeaningfulLogs ignores codex otel trace chatter", () => {
  const logs = filterMeaningfulLogs([
    {
      target: "codex_otel.trace_safe",
      message:
        "session_loop{thread_id=019cfae1-df1f-73b2-a96a-7439e0c1576d}:submission_dispatch{otel.name=\"op.dispatch.user_input\"}"
    },
    {
      target: "codex_otel.log_only",
      message:
        "session_loop{thread_id=019cfae1-df1f-73b2-a96a-7439e0c1576d}:submission_dispatch{otel.name=\"op.dispatch.user_input\"}"
    },
    {
      target: "codex_core::stream_events_utils",
      message: 'ToolCall: functions.exec_command {"cmd":"npm test"}'
    }
  ]);

  assert.equal(logs.length, 1);
  assert.equal(logs[0].message, 'ToolCall: functions.exec_command {"cmd":"npm test"}');
});

test("filterMeaningfulLogs ignores session loop dispatch chatter even when it arrives through stream_events_utils", () => {
  const logs = filterMeaningfulLogs([
    {
      target: "codex_core::stream_events_utils",
      message:
        "session_loop{thread_id=019cfae1-df1f-73b2-a96a-7439e0c1576d}:submission_dispatch{otel.name=\"op.dispatch.user_input\"}"
    },
    {
      target: "codex_core::stream_events_utils",
      message: 'ToolCall: functions.exec_command {"cmd":"npm test"}'
    }
  ]);

  assert.equal(logs.length, 1);
  assert.equal(logs[0].message, 'ToolCall: functions.exec_command {"cmd":"npm test"}');
});

test("filterMeaningfulLogs ignores low-level websocket frame dumps", () => {
  const logs = filterMeaningfulLogs([
    {
      target: "log",
      message:
        "/Users/runner/.cargo/git/checkouts/tokio-tungstenite-ea4445d9acecae62/132f5b3/src/lib.rs:294 Stream.poll_next"
    },
    {
      target: "log",
      message: "received frame <FRAME> final: true opcode: TEXT payload length: 61"
    },
    {
      target: "codex_core::stream_events_utils",
      message: 'ToolCall: functions.exec_command {"cmd":"npm test"}'
    }
  ]);

  assert.equal(logs.length, 1);
  assert.equal(logs[0].message, 'ToolCall: functions.exec_command {"cmd":"npm test"}');
});

test("filterMeaningfulLogs ignores split websocket frame metadata lines", () => {
  const logs = filterMeaningfulLogs([
    {
      target: "log",
      message: "Masked: false"
    },
    {
      target: "log",
      message: "Opcode: Data(Text)"
    },
    {
      target: "log",
      message: "First: 11000001"
    },
    {
      target: "log",
      message: "Second: 111101"
    },
    {
      target: "codex_core::stream_events_utils",
      message: 'ToolCall: functions.exec_command {"cmd":"npm test"}'
    }
  ]);

  assert.equal(logs.length, 1);
  assert.equal(logs[0].message, 'ToolCall: functions.exec_command {"cmd":"npm test"}');
});

test("filterMeaningfulLogs ignores WouldBlock transport noise", () => {
  const logs = filterMeaningfulLogs([
    {
      target: "log",
      message: "WouldBlock"
    },
    {
      target: "codex_core::stream_events_utils",
      message: 'ToolCall: functions.exec_command {"cmd":"npm test"}'
    }
  ]);

  assert.equal(logs.length, 1);
  assert.equal(logs[0].message, 'ToolCall: functions.exec_command {"cmd":"npm test"}');
});

test("filterMeaningfulLogs ignores received-message transport envelopes when no command can be extracted", () => {
  const logs = filterMeaningfulLogs([
    {
      target: "log",
      message:
        'Received message {"type":"response.output_item.done","item":{"id":"fc_x","type":"function_call","status":"completed","arguments":"TRUNCATED"}}'
    },
    {
      target: "codex_core::stream_events_utils",
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

test("contentType serves jpeg assets with the correct MIME type", () => {
  assert.equal(contentType("public/safe-demo.jpg"), "image/jpeg");
});

test("contentType serves webp pet atlases with the correct MIME type", () => {
  assert.equal(contentType("public/pets/reiko/spritesheet.webp"), "image/webp");
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

test("normalizeGithubRepoSlug parses GitHub HTTPS and SSH remotes", () => {
  assert.equal(
    normalizeGithubRepoSlug("https://github.com/example-org/my-project.git"),
    "example-org/my-project"
  );
  assert.equal(
    normalizeGithubRepoSlug("git@github.com:example-org/my-project.git"),
    "example-org/my-project"
  );
  assert.equal(normalizeGithubRepoSlug("https://example.com/not-github.git"), null);
});

test("buildGithubIssueListArgs includes labels and the expected JSON fields", () => {
  const args = buildGithubIssueListArgs({
    repo: "example-org/my-project",
    state: "all",
    labels: ["agent:rei", "status:in_progress"],
    limit: 12
  });

  assert.deepEqual(args, [
    "issue",
    "list",
    "--repo",
    "example-org/my-project",
    "--state",
    "all",
    "--limit",
    "12",
    "--label",
    "agent:rei",
    "--label",
    "status:in_progress",
    "--json",
    "number,title,state,createdAt,updatedAt,url,labels,assignees,author"
  ]);
});

test("inferGithubRepoSlugWithRunner reads the git remote and normalizes the repo slug", async () => {
  const calls = [];
  const repo = await inferGithubRepoSlugWithRunner(
    async (file, args, options) => {
      calls.push({ file, args, options });
      return {
        stdout: "git@github.com:example-org/my-project.git\n"
      };
    },
    {
      cwd: "/tmp/rei-ops-room"
    }
  );

  assert.equal(repo, "example-org/my-project");
  assert.deepEqual(calls, [
    {
      file: "git",
      args: ["remote", "get-url", "origin"],
      options: {
        cwd: "/tmp/rei-ops-room"
      }
    }
  ]);
});

test("listGithubIssuesWithRunner normalizes GitHub issues for the inbox view", async () => {
  const calls = [];
  const payload = await listGithubIssuesWithRunner(
    async (file, args, options) => {
      calls.push({ file, args, options });
      return {
        stdout: JSON.stringify([
          {
            number: 2,
            title: "GitHub issue-driven assistant workflow for cross-device task handling",
            state: "OPEN",
            createdAt: "2026-03-30T10:00:00Z",
            updatedAt: "2026-03-30T10:30:00Z",
            url: "https://github.com/example-org/my-project/issues/2",
            labels: [{ name: "agent:rei" }, { name: "status:todo" }],
            assignees: [{ login: "example-user" }],
            author: { login: "example-user" }
          }
        ])
      };
    },
    {
      repo: "example-org/my-project",
      labels: ["agent:rei"],
      limit: 20
    }
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].file, "gh");
  assert.equal(calls[0].options.maxBuffer, SQLITE_JSON_MAX_BUFFER);
  assert.deepEqual(payload, {
    repo: "example-org/my-project",
    filters: {
      state: "open",
      labels: ["agent:rei"],
      limit: 20
    },
    summary: {
      total: 1,
      todo: 1,
      inProgress: 0,
      blocked: 0
    },
    planner: {
      status: "queued",
      activeCount: 0,
      blockedCount: 0,
      activeIssue: null,
      suggestedIssue: {
        number: 2,
        title: "GitHub issue-driven assistant workflow for cross-device task handling",
        updatedAt: "2026-03-30T10:30:00Z",
        status: "todo",
        url: "https://github.com/example-org/my-project/issues/2"
      }
    },
    issues: [
      {
        number: 2,
        title: "GitHub issue-driven assistant workflow for cross-device task handling",
        state: "OPEN",
        createdAt: "2026-03-30T10:00:00Z",
        updatedAt: "2026-03-30T10:30:00Z",
        url: "https://github.com/example-org/my-project/issues/2",
        labels: ["agent:rei", "status:todo"],
        assignees: ["example-user"],
        author: "example-user"
      }
    ]
  });
});

test("buildGithubIssueSummary groups issue counts by status label", () => {
  const summary = buildGithubIssueSummary([
    {
      labels: ["agent:rei", "status:todo"]
    },
    {
      labels: ["agent:rei", "status:in_progress"]
    },
    {
      labels: ["agent:rei", "status:blocked"]
    }
  ]);

  assert.deepEqual(summary, {
    total: 3,
    todo: 1,
    inProgress: 1,
    blocked: 1
  });
});

test("buildGithubQueuePlan identifies the active in-progress issue and the next queued issue", () => {
  const planner = buildGithubQueuePlan([
    {
      number: 8,
      title: "Report-only GitHub issue comment bridge",
      updatedAt: "2026-03-31T03:15:00Z",
      labels: ["agent:rei", "status:todo", "mode:report_only"]
    },
    {
      number: 7,
      title: "Issue queue planner and active in-progress recommendation",
      updatedAt: "2026-03-31T04:10:00Z",
      labels: ["agent:rei", "status:in_progress", "mode:report_only"]
    }
  ]);

  assert.deepEqual(planner, {
    status: "active",
    activeCount: 1,
    blockedCount: 0,
    activeIssue: {
      number: 7,
      title: "Issue queue planner and active in-progress recommendation",
      updatedAt: "2026-03-31T04:10:00Z",
      status: "in_progress",
      url: null
    },
    suggestedIssue: {
      number: 8,
      title: "Report-only GitHub issue comment bridge",
      updatedAt: "2026-03-31T03:15:00Z",
      status: "todo",
      url: null
    }
  });
});

test("buildGithubQueuePlan prefers the newest todo issue over an older umbrella issue that only got a fresh comment", () => {
  const planner = buildGithubQueuePlan([
    {
      number: 2,
      title: "GitHub issue-driven assistant workflow for cross-device task handling",
      createdAt: "2026-03-26T08:47:17Z",
      updatedAt: "2026-03-31T02:18:01Z",
      labels: ["agent:rei", "status:todo", "mode:report_only"]
    },
    {
      number: 3,
      title: "Report-only GitHub issue comment bridge",
      createdAt: "2026-03-31T02:13:00Z",
      updatedAt: "2026-03-31T02:13:00Z",
      labels: ["agent:rei", "status:todo", "mode:report_only"]
    }
  ]);

  assert.equal(planner.status, "queued");
  assert.equal(planner.suggestedIssue?.number, 3);
});

test("createServer exposes /api/github/issues with inferred repo and default labels", async (t) => {
  const listCalls = [];
  const server = createServer({
    getStatus: async () => ({ ok: true }),
    inferGithubRepoSlug: async () => "example-org/my-project",
    listGithubIssues: async (options) => {
      listCalls.push(options);
      return {
        repo: options.repo,
        filters: options,
        summary: {
          total: 1,
          todo: 1,
          inProgress: 0,
          blocked: 0
        },
        planner: {
          status: "queued",
          activeCount: 0,
          blockedCount: 0,
          activeIssue: null,
          suggestedIssue: {
            number: 2,
            title: "GitHub issue-driven assistant workflow for cross-device task handling",
            updatedAt: "2026-03-31T04:10:00Z",
            status: "todo",
            url: "https://github.com/example-org/my-project/issues/2"
          }
        },
        issues: [
          {
            number: 2,
            title: "GitHub issue-driven assistant workflow for cross-device task handling",
            labels: ["agent:rei", "status:todo"]
          }
        ]
      };
    }
  });

  server.listen(0);
  await once(server, "listening");
  t.after(() => server.close());

  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/api/github/issues`);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(listCalls, [
    {
      repo: "example-org/my-project",
      state: "open",
      labels: ["agent:rei"],
      limit: 20
    }
  ]);
  assert.equal(body.repo, "example-org/my-project");
  assert.equal(body.summary.todo, 1);
  assert.equal(body.planner.status, "queued");
});

test("parseDailyDeviceHandoffMarkdown extracts the latest day into structured sections", () => {
  const parsed = parseDailyDeviceHandoffMarkdown(`
# Daily Device Handoff

## 2026-03-30
### Today At A Glance
- Older summary

## 2026-04-01
### Today At A Glance
- Pixel room now shows a handoff panel
- App 50 sync guidance expanded

### First Notes To Open Next
- references/visa-bulk-mgmt.md
- references/daily-device-handoff.md

### Carry-Over Context
- Dropbox migration still needs final verification
  `);

  assert.equal(parsed.date, "2026-04-01");
  assert.deepEqual(parsed.sections, [
    {
      title: "Today At A Glance",
      items: ["Pixel room now shows a handoff panel", "App 50 sync guidance expanded"]
    },
    {
      title: "First Notes To Open Next",
      items: ["references/visa-bulk-mgmt.md", "references/daily-device-handoff.md"]
    },
    {
      title: "Carry-Over Context",
      items: ["Dropbox migration still needs final verification"]
    }
  ]);
});

test("createServer exposes /api/handoff using the latest daily device handoff note", async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "pixel-handoff-"));
  const handoffPath = path.join(tempDir, "daily-device-handoff.md");
  await fs.writeFile(
    handoffPath,
    `# Daily Device Handoff

## 2026-04-01
### Today At A Glance
- Pixel room handoff panel wired
- Visa sync recap available

### First Notes To Open Next
- references/visa-bulk-mgmt.md
`,
    "utf8"
  );
  t.after(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  const server = createServer({
    getStatus: async () => ({ ok: true }),
    getDailyDeviceHandoff: async () => readDailyDeviceHandoff(handoffPath)
  });

  server.listen(0);
  await once(server, "listening");
  t.after(() => server.close());

  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/api/handoff`);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.date, "2026-04-01");
  assert.equal(body.sections[0].title, "Today At A Glance");
  assert.deepEqual(body.sections[0].items, [
    "Pixel room handoff panel wired",
    "Visa sync recap available"
  ]);
});

test("readDailyDeviceHandoff falls back to the installed skill copy when the workspace repo is missing", async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "pixel-handoff-fallback-"));
  const missingPath = path.join(tempDir, "workspace", "daily-device-handoff.md");
  const fallbackDir = path.join(tempDir, "runtime");
  const fallbackPath = path.join(fallbackDir, "daily-device-handoff.md");

  await fs.mkdir(fallbackDir, { recursive: true });
  await fs.writeFile(
    fallbackPath,
    `# Daily Device Handoff

## 2026-04-01
### Today At A Glance
- Runtime copy is available
`,
    "utf8"
  );

  t.after(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  const payload = await readDailyDeviceHandoff([missingPath, fallbackPath]);

  assert.equal(payload.status, "ready");
  assert.equal(payload.sourcePath, fallbackPath);
  assert.deepEqual(payload.checkedPaths, [missingPath, fallbackPath]);
  assert.equal(payload.sections[0].title, "Today At A Glance");
});

test("createServer exposes /api/github/report-only preview and post routes", async (t) => {
  const server = createServer({
    getStatus: async () => ({ ok: true }),
    previewReportOnlyAction: async () => ({
      repo: "example-org/my-project",
      status: "ready",
      canComment: true,
      target: {
        number: 5,
        title: "Viewer report-only preview and manual trigger",
        url: "https://github.com/example-org/my-project/issues/5"
      },
      draft: "<!-- rei:report-only issue=5 -->\nRei report-only pickup for #5."
    }),
    postReportOnlyAction: async () => ({
      repo: "example-org/my-project",
      status: "comment_posted",
      canComment: false,
      target: {
        number: 5,
        title: "Viewer report-only preview and manual trigger",
        url: "https://github.com/example-org/my-project/issues/5"
      },
      draft: "<!-- rei:report-only issue=5 -->\nRei report-only pickup for #5."
    })
  });

  server.listen(0);
  await once(server, "listening");
  t.after(() => server.close());

  const { port } = server.address();
  const previewResponse = await fetch(`http://127.0.0.1:${port}/api/github/report-only`);
  const previewBody = await previewResponse.json();
  const postResponse = await fetch(`http://127.0.0.1:${port}/api/github/report-only`, {
    method: "POST"
  });
  const postBody = await postResponse.json();

  assert.equal(previewResponse.status, 200);
  assert.equal(previewBody.status, "ready");
  assert.equal(postResponse.status, 200);
  assert.equal(postBody.status, "comment_posted");
});

test("createServer exposes /api/github/report-only/service with local worker state", async (t) => {
  const server = createServer({
    getStatus: async () => ({ ok: true }),
    getReportOnlyServiceStatus: async () => ({
      running: true,
      pid: 55297,
      source: "pid",
      detail: "report-only worker running (pid 55297)"
    })
  });

  server.listen(0);
  await once(server, "listening");
  t.after(() => server.close());

  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/api/github/report-only/service`);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.running, true);
  assert.equal(body.pid, 55297);
  assert.equal(body.detail, "report-only worker running (pid 55297)");
});

test("createServer can start and stop the local report-only service", async (t) => {
  const actions = [];
  const server = createServer({
    getStatus: async () => ({ ok: true }),
    controlReportOnlyService: async ({ action }) => {
      actions.push(action);
      return {
        running: action === "start",
        pid: action === "start" ? 60001 : null,
        source: action === "start" ? "pid" : "none",
        detail:
          action === "start"
            ? "report-only worker running (pid 60001)"
            : "report-only worker is not running"
      };
    }
  });

  server.listen(0);
  await once(server, "listening");
  t.after(() => server.close());

  const { port } = server.address();
  const startResponse = await fetch(`http://127.0.0.1:${port}/api/github/report-only/service`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      action: "start"
    })
  });
  const startBody = await startResponse.json();

  const stopResponse = await fetch(`http://127.0.0.1:${port}/api/github/report-only/service`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      action: "stop"
    })
  });
  const stopBody = await stopResponse.json();

  assert.deepEqual(actions, ["start", "stop"]);
  assert.equal(startResponse.status, 200);
  assert.equal(startBody.running, true);
  assert.equal(stopResponse.status, 200);
  assert.equal(stopBody.running, false);
});

test("createServer reports report-only service control failures with action context", async (t) => {
  const server = createServer({
    getStatus: async () => ({ ok: true }),
    controlReportOnlyService: async ({ action }) => {
      const error = new Error(`report-only worker refused to ${action}`);
      error.statusCode = 503;
      throw error;
    }
  });

  server.listen(0);
  await once(server, "listening");
  t.after(() => server.close());

  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/api/github/report-only/service`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      action: "start"
    })
  });
  const body = await response.json();

  assert.equal(response.status, 503);
  assert.equal(body.error, "Failed to control report-only service");
  assert.equal(body.status, "error");
  assert.equal(body.source, "control_error");
  assert.equal(body.action, "start");
  assert.equal(body.detail, "report-only worker refused to start");
});

test("createServer exposes /api/github/execute preview and service routes", async (t) => {
  const server = createServer({
    getStatus: async () => ({ ok: true }),
    previewExecuteAction: async () => ({
      repo: "example-org/my-project",
      status: "ready",
      target: {
        number: 31,
        title: "Queue-driven execute service MVP",
        url: "https://github.com/example-org/my-project/issues/31"
      },
      detail: "Ready to run the next execute issue."
    }),
    getExecuteServiceStatus: async () => ({
      status: "running",
      running: true,
      pid: 61001,
      source: "pid",
      detail: "execute worker running (pid 61001)",
      currentTarget: {
        number: 31,
        title: "Queue-driven execute service MVP"
      }
    })
  });

  server.listen(0);
  await once(server, "listening");
  t.after(() => server.close());

  const { port } = server.address();
  const previewResponse = await fetch(`http://127.0.0.1:${port}/api/github/execute`);
  const previewBody = await previewResponse.json();
  const serviceResponse = await fetch(`http://127.0.0.1:${port}/api/github/execute/service`);
  const serviceBody = await serviceResponse.json();

  assert.equal(previewResponse.status, 200);
  assert.equal(previewBody.status, "ready");
  assert.equal(serviceResponse.status, 200);
  assert.equal(serviceBody.running, true);
  assert.equal(serviceBody.pid, 61001);
});

test("createServer can start and stop the local execute service", async (t) => {
  const actions = [];
  const server = createServer({
    getStatus: async () => ({ ok: true }),
    controlExecuteService: async ({ action }) => {
      actions.push(action);
      return {
        status: action === "start" ? "running" : "idle",
        running: action === "start",
        pid: action === "start" ? 62001 : null,
        source: action === "start" ? "pid" : "none",
        detail:
          action === "start"
            ? "execute worker running (pid 62001)"
            : "execute worker is not running"
      };
    }
  });

  server.listen(0);
  await once(server, "listening");
  t.after(() => server.close());

  const { port } = server.address();
  const startResponse = await fetch(`http://127.0.0.1:${port}/api/github/execute/service`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      action: "start"
    })
  });
  const startBody = await startResponse.json();

  const stopResponse = await fetch(`http://127.0.0.1:${port}/api/github/execute/service`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      action: "stop"
    })
  });
  const stopBody = await stopResponse.json();

  assert.deepEqual(actions, ["start", "stop"]);
  assert.equal(startResponse.status, 200);
  assert.equal(startBody.running, true);
  assert.equal(stopResponse.status, 200);
  assert.equal(stopBody.running, false);
});

test("parseDailyDeviceHandoffMarkdown extracts next_focus_zone, active_issues, and blockers from structured sections", () => {
  const parsed = parseDailyDeviceHandoffMarkdown(`
# Daily Device Handoff

## 2026-04-06
### Today At A Glance
- rei-ops-room inference upgrade selesai

### Next Focus Zone
- backend — execute-bridge dan room-state baru di-upgrade

### Active Issues
- #13 Roadmap queue source
- #14 Next auto-pick dari roadmap
- #15 Unresolved, blocked

### Blockers
- Scrapling MCP butuh Codex restart
- Kintone URL bulk update masih pending
  `);

  assert.equal(parsed.date, "2026-04-06");
  assert.equal(parsed.next_focus_zone, "backend");
  assert.equal(parsed.active_issues.length, 3);
  assert.equal(parsed.active_issues[0].number, 13);
  assert.equal(parsed.active_issues[1].number, 14);
  assert.equal(parsed.active_issues[2].number, 15);
  assert.equal(parsed.blockers.length, 2);
  assert.match(parsed.blockers[0], /scrapling/i);
});

test("extractStructuredHandoffFields returns nulls and empty arrays when no special sections exist", () => {
  const result = extractStructuredHandoffFields([
    { title: "Today At A Glance", items: ["Some work done"] },
    { title: "Carry-Over Context", items: ["Some context"] }
  ]);

  assert.equal(result.next_focus_zone, null);
  assert.deepEqual(result.blockers, []);
  assert.deepEqual(result.active_issues, []);
});

test("extractStructuredHandoffFields is case-insensitive for section titles", () => {
  const result = extractStructuredHandoffFields([
    { title: "NEXT FOCUS ZONE", items: ["frontend — UI work"] },
    { title: "Blockers", items: ["Blocker A", "Blocker B"] },
    { title: "Active Issues", items: ["#10 Some issue", "#11 Another issue"] }
  ]);

  assert.equal(result.next_focus_zone, "frontend");
  assert.equal(result.blockers.length, 2);
  assert.equal(result.active_issues.length, 2);
  assert.equal(result.active_issues[0].number, 10);
});

test("parseDailyDeviceHandoffMarkdown remains backward-compatible with old format (no structured sections)", () => {
  const parsed = parseDailyDeviceHandoffMarkdown(`
## 2026-03-30
### Today At A Glance
- Old entry with no structured sections

### Carry-Over Context
- Just plain context
  `);

  assert.equal(parsed.date, "2026-03-30");
  assert.equal(parsed.next_focus_zone, null);
  assert.deepEqual(parsed.blockers, []);
  assert.deepEqual(parsed.active_issues, []);
  assert.equal(parsed.sections.length, 2);
});

// ─── DELETE /api/execute/queue/:id ───────────────────────────────────────────

test("createServer DELETE /api/execute/queue/:id removes queued task", async (t) => {
  const tasks = [
    { id: "task-001", task: "fix bug", status: "queued", submittedAt: new Date().toISOString() },
    { id: "task-002", task: "write docs", status: "done", submittedAt: new Date().toISOString() }
  ];

  const server = createServer({
    getStatus: async () => ({ ok: true }),
    removeQueueTask: async (id) => {
      const task = tasks.find((t) => t.id === id);
      if (!task) return { removed: false, reason: "not_found" };
      if (task.status === "in_progress") return { removed: false, reason: "in_progress" };
      return { removed: true };
    }
  });

  server.listen(0);
  await once(server, "listening");
  t.after(() => server.close());

  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/api/execute/queue/task-001`, {
    method: "DELETE"
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.removed, true);
  assert.equal(body.id, "task-001");
});

test("createServer DELETE /api/execute/queue/:id returns 404 for unknown task", async (t) => {
  const server = createServer({
    getStatus: async () => ({ ok: true }),
    removeQueueTask: async () => ({ removed: false, reason: "not_found" })
  });

  server.listen(0);
  await once(server, "listening");
  t.after(() => server.close());

  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/api/execute/queue/no-such-id`, {
    method: "DELETE"
  });

  assert.equal(response.status, 404);
});

test("createServer DELETE /api/execute/queue/:id returns 409 for in_progress task", async (t) => {
  const server = createServer({
    getStatus: async () => ({ ok: true }),
    removeQueueTask: async () => ({ removed: false, reason: "in_progress" })
  });

  server.listen(0);
  await once(server, "listening");
  t.after(() => server.close());

  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/api/execute/queue/running-task`, {
    method: "DELETE"
  });

  assert.equal(response.status, 409);
});

// ─── GET /api/execute/runtimes ───────────────────────────────────────────────

test("createServer GET /api/execute/runtimes returns runtime list", async (t) => {
  const server = createServer({
    getStatus: async () => ({ ok: true }),
    listRuntimes: async () => ({
      runtimes: [
        { id: "codex", label: "Codex", available: true },
        { id: "claude-code", label: "Claude Code", available: false }
      ],
      available: ["codex"],
      preferences: { general: ["codex"] }
    })
  });

  server.listen(0);
  await once(server, "listening");
  t.after(() => server.close());

  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/api/execute/runtimes`);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.ok(Array.isArray(body.runtimes));
  assert.ok(Array.isArray(body.available));
});

// ─── GET /api/execute/ledger ─────────────────────────────────────────────────

test("createServer GET /api/execute/ledger returns run summary", async (t) => {
  const server = createServer({
    getStatus: async () => ({ ok: true }),
    getRunLedger: async () => ({
      totalRuns: 3,
      byDate: { "2026-04-07": { completed: 2, failed: 1, total: 3 } },
      byRuntime: { codex: { completed: 2, failed: 1, total: 3 } },
      costNote: "Token/cost data not available for subscription-based runtimes.",
      recent: []
    })
  });

  server.listen(0);
  await once(server, "listening");
  t.after(() => server.close());

  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/api/execute/ledger`);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.totalRuns, 3);
  assert.ok(body.byDate);
  assert.ok(body.byRuntime);
  assert.ok(typeof body.costNote === "string");
});

// ─── GET /api/execute/artifacts ──────────────────────────────────────────────

test("createServer GET /api/execute/artifacts returns artifact list", async (t) => {
  const fakeArtifacts = [
    { filename: "arch.html", filePath: "/tmp/arch.html", issueNumber: 5, runtimeId: "claude-code", createdAt: "2026-05-07T00:00:00.000Z", size: 1000 }
  ];
  const server = createServer({
    getStatus: async () => ({ ok: true }),
    listArtifacts: async () => fakeArtifacts
  });

  server.listen(0);
  await once(server, "listening");
  t.after(() => server.close());

  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/api/execute/artifacts`);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.ok(Array.isArray(body.artifacts));
  assert.equal(body.artifacts.length, 1);
  assert.equal(body.artifacts[0].filename, "arch.html");
});

test("createServer GET /api/execute/artifacts?issue=5 filters by issue", async (t) => {
  const server = createServer({
    getStatus: async () => ({ ok: true }),
    listArtifacts: async ({ issueNumber }) => {
      assert.equal(issueNumber, 5);
      return [];
    }
  });

  server.listen(0);
  await once(server, "listening");
  t.after(() => server.close());

  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/api/execute/artifacts?issue=5`);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.ok(Array.isArray(body.artifacts));
});

test("createServer GET /api/execute/artifacts/:filename serves HTML artifact", async (t) => {
  const htmlContent = Buffer.from("<html><body>diagram</body></html>");
  const server = createServer({
    getStatus: async () => ({ ok: true }),
    readArtifact: async (filename) => {
      if (filename === "diagram.html") {
        return { content: htmlContent, contentType: "text/html; charset=utf-8", filename: "diagram.html" };
      }
      return null;
    }
  });

  server.listen(0);
  await once(server, "listening");
  t.after(() => server.close());

  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/api/execute/artifacts/diagram.html`);

  assert.equal(response.status, 200);
  assert.ok(response.headers.get("content-type").startsWith("text/html"));
  const text = await response.text();
  assert.ok(text.includes("diagram"));
});

test("createServer GET /api/execute/artifacts/:filename returns 404 for missing artifact", async (t) => {
  const server = createServer({
    getStatus: async () => ({ ok: true }),
    readArtifact: async () => null
  });

  server.listen(0);
  await once(server, "listening");
  t.after(() => server.close());

  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/api/execute/artifacts/missing.html`);

  assert.equal(response.status, 404);
});

// ─── verifyGithubWebhookSignature ────────────────────────────────────────────

test("verifyGithubWebhookSignature returns true when secret is empty (dev mode)", () => {
  const body = Buffer.from("hello");
  assert.equal(verifyGithubWebhookSignature("", body, ""), true);
  assert.equal(verifyGithubWebhookSignature("", body, "sha256=wrong"), true);
});

test("verifyGithubWebhookSignature returns true for correct HMAC signature", () => {
  const secret = "mysecret";
  const body = Buffer.from('{"action":"labeled"}');
  const mac = crypto.createHmac("sha256", secret).update(body).digest("hex");
  assert.equal(verifyGithubWebhookSignature(secret, body, `sha256=${mac}`), true);
});

test("verifyGithubWebhookSignature returns false for wrong HMAC", () => {
  const secret = "mysecret";
  const body = Buffer.from('{"action":"labeled"}');
  assert.equal(verifyGithubWebhookSignature(secret, body, "sha256=deadbeef00000000000000000000000000000000000000000000000000000000"), false);
});

test("verifyGithubWebhookSignature returns false for empty signature when secret is set", () => {
  const secret = "mysecret";
  const body = Buffer.from("payload");
  assert.equal(verifyGithubWebhookSignature(secret, body, ""), false);
  assert.equal(verifyGithubWebhookSignature(secret, body, undefined), false);
});

// ─── isRelevantWebhookEvent ───────────────────────────────────────────────────

test("isRelevantWebhookEvent triggers on issues.labeled with agent:rei", () => {
  assert.equal(isRelevantWebhookEvent("issues", { action: "labeled", label: { name: "agent:rei" } }).triggered, true);
});

test("isRelevantWebhookEvent triggers on issues.labeled with mode: prefix", () => {
  assert.equal(isRelevantWebhookEvent("issues", { action: "labeled", label: { name: "mode:execute" } }).triggered, true);
});

test("isRelevantWebhookEvent does not trigger on issues.labeled with unrelated label", () => {
  assert.equal(isRelevantWebhookEvent("issues", { action: "labeled", label: { name: "bug" } }).triggered, false);
});

test("isRelevantWebhookEvent triggers on issues.assigned and issues.unlabeled", () => {
  assert.equal(isRelevantWebhookEvent("issues", { action: "assigned" }).triggered, true);
  assert.equal(isRelevantWebhookEvent("issues", { action: "unlabeled" }).triggered, true);
});

test("isRelevantWebhookEvent triggers on issue_comment.created", () => {
  assert.equal(isRelevantWebhookEvent("issue_comment", { action: "created" }).triggered, true);
});

test("isRelevantWebhookEvent does not trigger on issue_comment.deleted", () => {
  assert.equal(isRelevantWebhookEvent("issue_comment", { action: "deleted" }).triggered, false);
});

test("isRelevantWebhookEvent triggers on push", () => {
  assert.equal(isRelevantWebhookEvent("push", {}).triggered, true);
});

test("isRelevantWebhookEvent triggers on merged pull_request", () => {
  assert.equal(isRelevantWebhookEvent("pull_request", { action: "closed", pull_request: { merged: true } }).triggered, true);
});

test("isRelevantWebhookEvent does not trigger on unmerged pull_request.closed", () => {
  assert.equal(isRelevantWebhookEvent("pull_request", { action: "closed", pull_request: { merged: false } }).triggered, false);
});

test("isRelevantWebhookEvent does not trigger on unknown event type", () => {
  assert.equal(isRelevantWebhookEvent("release", { action: "published" }).triggered, false);
});

// ─── POST /api/github/webhook (integration) ───────────────────────────────────

test("createServer POST /api/github/webhook calls handler and responds triggered:true", async (t) => {
  const woken = [];
  const server = createServer({
    getStatus: async () => ({ ok: true }),
    handleGithubWebhook: async ({ eventType }) => {
      woken.push(eventType);
      return { valid: true, triggered: true, reason: "issue labeled" };
    }
  });

  server.listen(0);
  await once(server, "listening");
  t.after(() => server.close());

  const { port } = server.address();
  const res = await fetch(`http://127.0.0.1:${port}/api/github/webhook`, {
    method: "POST",
    headers: { "x-github-event": "issues", "content-type": "application/json" },
    body: JSON.stringify({ action: "labeled", label: { name: "agent:rei" } })
  });
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.equal(body.triggered, true);
  assert.equal(body.event, "issues");
  assert.deepEqual(woken, ["issues"]);
});

test("createServer POST /api/github/webhook returns 401 when signature invalid", async (t) => {
  const server = createServer({
    getStatus: async () => ({ ok: true }),
    handleGithubWebhook: async () => ({ valid: false })
  });

  server.listen(0);
  await once(server, "listening");
  t.after(() => server.close());

  const { port } = server.address();
  const res = await fetch(`http://127.0.0.1:${port}/api/github/webhook`, {
    method: "POST",
    headers: { "x-github-event": "push", "content-type": "application/json" },
    body: JSON.stringify({})
  });

  assert.equal(res.status, 401);
  const body = await res.json();
  assert.ok(body.error);
});

test("createServer POST /api/github/webhook returns triggered:false for non-relevant event", async (t) => {
  const server = createServer({
    getStatus: async () => ({ ok: true }),
    handleGithubWebhook: async () => ({ valid: true, triggered: false })
  });

  server.listen(0);
  await once(server, "listening");
  t.after(() => server.close());

  const { port } = server.address();
  const res = await fetch(`http://127.0.0.1:${port}/api/github/webhook`, {
    method: "POST",
    headers: { "x-github-event": "release", "content-type": "application/json" },
    body: JSON.stringify({ action: "published" })
  });
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.equal(body.triggered, false);
});

// ─── GET /api/execute/metrics ─────────────────────────────────────────────────

test("createServer GET /api/execute/metrics returns metrics payload", async (t) => {
  const fakeMetrics = {
    totalRuns: 10,
    successRate: 0.7,
    byRuntime: { "claude-code": { completed: 7, failed: 2, total: 9 }, codex: { completed: 0, failed: 1, total: 1 } },
    byProfile: { general: { completed: 7, failed: 3, total: 10 } },
    recentRuns: [{ issueNumber: 42, outcome: "completed", runtimeId: "claude-code", profileId: "general", recordedAt: "2026-05-07T10:00:00Z" }]
  };

  const server = createServer({
    getStatus: async () => ({ ok: true }),
    getMetrics: async () => fakeMetrics
  });

  server.listen(0);
  await once(server, "listening");
  t.after(() => server.close());

  const { port } = server.address();
  const res = await fetch(`http://127.0.0.1:${port}/api/execute/metrics`);
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.equal(body.totalRuns, 10);
  assert.equal(body.successRate, 0.7);
  assert.ok(body.byRuntime["claude-code"]);
  assert.ok(Array.isArray(body.recentRuns));
  assert.equal(body.recentRuns[0].issueNumber, 42);
});

test("createServer GET /api/execute/metrics returns 500 on error", async (t) => {
  const server = createServer({
    getStatus: async () => ({ ok: true }),
    getMetrics: async () => { throw new Error("disk read failed"); }
  });

  server.listen(0);
  await once(server, "listening");
  t.after(() => server.close());

  const { port } = server.address();
  const res = await fetch(`http://127.0.0.1:${port}/api/execute/metrics`);
  const body = await res.json();

  assert.equal(res.status, 500);
  assert.ok(body.error);
});
