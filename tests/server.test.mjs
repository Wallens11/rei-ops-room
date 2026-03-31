import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";

import {
  buildAgentJobItemsSql,
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
  listGithubIssuesWithRunner,
  normalizeGithubRepoSlug,
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
    normalizeGithubRepoSlug("https://github.com/Wallens11/rei-ops-room.git"),
    "Wallens11/rei-ops-room"
  );
  assert.equal(
    normalizeGithubRepoSlug("git@github.com:Wallens11/rei-ops-room.git"),
    "Wallens11/rei-ops-room"
  );
  assert.equal(normalizeGithubRepoSlug("https://example.com/not-github.git"), null);
});

test("buildGithubIssueListArgs includes labels and the expected JSON fields", () => {
  const args = buildGithubIssueListArgs({
    repo: "Wallens11/rei-ops-room",
    state: "all",
    labels: ["agent:rei", "status:in_progress"],
    limit: 12
  });

  assert.deepEqual(args, [
    "issue",
    "list",
    "--repo",
    "Wallens11/rei-ops-room",
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
        stdout: "git@github.com:Wallens11/rei-ops-room.git\n"
      };
    },
    {
      cwd: "/tmp/rei-ops-room"
    }
  );

  assert.equal(repo, "Wallens11/rei-ops-room");
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
            url: "https://github.com/Wallens11/rei-ops-room/issues/2",
            labels: [{ name: "agent:rei" }, { name: "status:todo" }],
            assignees: [{ login: "Wallens11" }],
            author: { login: "Wallens11" }
          }
        ])
      };
    },
    {
      repo: "Wallens11/rei-ops-room",
      labels: ["agent:rei"],
      limit: 20
    }
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].file, "gh");
  assert.equal(calls[0].options.maxBuffer, SQLITE_JSON_MAX_BUFFER);
  assert.deepEqual(payload, {
    repo: "Wallens11/rei-ops-room",
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
        url: "https://github.com/Wallens11/rei-ops-room/issues/2"
      }
    },
    issues: [
      {
        number: 2,
        title: "GitHub issue-driven assistant workflow for cross-device task handling",
        state: "OPEN",
        createdAt: "2026-03-30T10:00:00Z",
        updatedAt: "2026-03-30T10:30:00Z",
        url: "https://github.com/Wallens11/rei-ops-room/issues/2",
        labels: ["agent:rei", "status:todo"],
        assignees: ["Wallens11"],
        author: "Wallens11"
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
    inferGithubRepoSlug: async () => "Wallens11/rei-ops-room",
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
            url: "https://github.com/Wallens11/rei-ops-room/issues/2"
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
      repo: "Wallens11/rei-ops-room",
      state: "open",
      labels: ["agent:rei"],
      limit: 20
    }
  ]);
  assert.equal(body.repo, "Wallens11/rei-ops-room");
  assert.equal(body.summary.todo, 1);
  assert.equal(body.planner.status, "queued");
});

test("createServer exposes /api/github/report-only preview and post routes", async (t) => {
  const server = createServer({
    getStatus: async () => ({ ok: true }),
    previewReportOnlyAction: async () => ({
      repo: "Wallens11/rei-ops-room",
      status: "ready",
      canComment: true,
      target: {
        number: 5,
        title: "Viewer report-only preview and manual trigger",
        url: "https://github.com/Wallens11/rei-ops-room/issues/5"
      },
      draft: "<!-- rei:report-only issue=5 -->\nRei report-only pickup for #5."
    }),
    postReportOnlyAction: async () => ({
      repo: "Wallens11/rei-ops-room",
      status: "comment_posted",
      canComment: false,
      target: {
        number: 5,
        title: "Viewer report-only preview and manual trigger",
        url: "https://github.com/Wallens11/rei-ops-room/issues/5"
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
