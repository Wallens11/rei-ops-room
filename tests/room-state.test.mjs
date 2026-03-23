import test from "node:test";
import assert from "node:assert/strict";

import { buildRoomState } from "../public/room-state.js";
import { summarizePrimaryTask } from "../public/room-state.js";

function makeThread(overrides = {}) {
  return {
    id: "thread_1",
    title: "Refactor runtime logs and map active repo session",
    cwd: "/Users/funtoco/workSpace/codex-pixel-agent",
    cwdDisplay: "codex-pixel-agent",
    repoName: "codex-pixel-agent",
    gitBranch: "codex/rei-ops-room",
    updatedAt: 1710000000,
    updatedAgo: "2 mnt lalu",
    updatedAgeSeconds: 120,
    ...overrides
  };
}

function makeActivity(overrides = {}) {
  return {
    summary: "Parsing runtime logs and mapping active repo session",
    source: "tool",
    lastLogAgeSeconds: 12,
    lastLogAgo: "12 dtk lalu",
    ...overrides
  };
}

test("execution state separates room phase, workstreams, and agent activity", () => {
  const state = buildRoomState({
    status: "busy",
    thread: makeThread({
      title: "Refactor backend runtime state and repo session mapping"
    }),
    repoContext: null,
    recentThreads: [],
    activity: makeActivity({
      summary: "Tool: parse sqlite logs and map active backend session"
    }),
    logs: [
      { ts: 1710000000, message: "ToolCall: functions.exec_command" },
      { ts: 1709999999, message: "ToolCall: functions.exec_command" },
      { ts: 1709999998, message: "Working through backend runtime state" }
    ]
  });

  assert.equal(state.room.phase, "execution");
  assert.equal(state.room.focus_zone, "backend");
  assert.equal(state.room.mode, "solo");
  assert.ok(state.room.phase_confidence >= 0.7);
  assert.equal(state.scene.active_zone.id, "backend");
  assert.equal(state.scene.assignment_hint.active, false);
  assert.equal(state.workstreams[0].zone, "backend");
  assert.equal(state.workstreams[0].status, "active");
  assert.equal(state.agents.find((agent) => agent.id === "api")?.activity, "coding");
  assert.equal(state.scene.scout.active, false);
  assert.match(state.scene.primary_bubble.text, /runtime|backend|sync|debug|trace/i);
  assert.doesNotMatch(state.scene.primary_bubble.text, /spawn_child_async/i);
  assert.equal(state.scene.rest_corner.active, false);
});

test("planning huddle is used when a new request still has low focus confidence", () => {
  const state = buildRoomState({
    status: "busy",
    thread: makeThread({
      title: "Need a plan for this room refactor",
      updatedAgeSeconds: 18,
      updatedAgo: "18 dtk lalu"
    }),
    repoContext: null,
    recentThreads: [],
    activity: makeActivity({
      summary: "Sketch scope and outline next steps",
      lastLogAgeSeconds: 18,
      lastLogAgo: "18 dtk lalu"
    }),
    logs: [{ ts: 1710000000, message: "Need plan before implementation" }]
  });

  assert.equal(state.room.phase, "planning_huddle");
  assert.equal(state.room.mode, "solo");
  assert.equal(state.agents.find((agent) => agent.id === "lead")?.activity, "gathering");
  assert.equal(state.scene.center_mode, "coordination");
  assert.ok(
    state.recent_events.some((event) => event.type === "new_request"),
    "expected a new_request event"
  );
});

test("planning huddle keeps the room staged in lab while exposing the next assignment hint", () => {
  const state = buildRoomState({
    status: "busy",
    thread: makeThread({
      title: "Need a plan for docs review labels before implementation",
      updatedAgeSeconds: 12,
      updatedAgo: "12 dtk lalu"
    }),
    repoContext: null,
    recentThreads: [],
    activity: makeActivity({
      summary: "Brief the squad and outline review labels before implementation",
      lastLogAgeSeconds: 12,
      lastLogAgo: "12 dtk lalu"
    }),
    logs: [{ ts: 1710000000, message: "Need plan for review labels before implementation" }]
  });

  assert.equal(state.room.phase, "planning_huddle");
  assert.equal(state.room.focus_zone, "review");
  assert.equal(state.scene.camera, "lab");
  assert.deepEqual(state.scene.desk_highlights, ["lab"]);
  assert.equal(state.scene.active_zone.id, "lab");
  assert.equal(state.scene.active_zone.label, "Active Desk");
  assert.equal(state.scene.active_zone.title, "Lead Table");
  assert.match(state.scene.active_zone.reason, /kumpul|scope|assignment/i);
  assert.equal(state.scene.assignment_hint.active, true);
  assert.equal(state.scene.assignment_hint.label, "Next Assignment");
  assert.equal(state.scene.assignment_hint.zone_id, "review");
  assert.equal(state.scene.assignment_hint.title, "Docs / Ops Corner");
  assert.equal(state.scene.assignment_hint.chip_title, "Next: Docs / Ops Corner");
  assert.match(state.scene.assignment_hint.reason, /briefing di lab/i);
});

test("active execution evidence breaks out of planning huddle even on a fresh request", () => {
  const state = buildRoomState({
    status: "busy",
    thread: makeThread({
      title: "Need a plan for backend runtime state fix",
      updatedAgeSeconds: 14,
      updatedAgo: "14 dtk lalu"
    }),
    repoContext: null,
    recentThreads: [],
    activity: makeActivity({
      summary: "Apply patch to room-state and run npm test for the backend runtime fix",
      lastLogAgeSeconds: 4,
      lastLogAgo: "4 dtk lalu"
    }),
    logs: [
      { ts: 1710000000, message: "ToolCall: functions.apply_patch" },
      { ts: 1709999999, message: 'ToolCall: functions.exec_command {"cmd":"npm test"}' },
      { ts: 1709999998, message: "Fix backend runtime state mapping and verify the patch" }
    ]
  });

  assert.equal(state.room.phase, "execution");
  assert.equal(state.room.focus_zone, "backend");
  assert.equal(state.scene.active_zone.id, "backend");
  assert.equal(state.scene.assignment_hint.active, false);
  assert.notEqual(state.agents.find((agent) => agent.id === "lead")?.activity, "gathering");
  assert.equal(state.agents.find((agent) => agent.id === "api")?.activity, "debugging");
});

test("live runtime work outweighs a stale thread opener when choosing the active desk", () => {
  const state = buildRoomState({
    status: "busy",
    thread: makeThread({
      title: "Need docs review and issue cleanup for the room",
      updatedAgeSeconds: 35,
      updatedAgo: "35 dtk lalu"
    }),
    repoContext: null,
    recentThreads: [],
    activity: makeActivity({
      summary: "Menjalankan: apply_patch public/room-state.js dan npm test untuk backend state fix",
      source: "tool",
      lastLogAgeSeconds: 6,
      lastLogAgo: "6 dtk lalu"
    }),
    logs: [
      { ts: 1710000000, message: 'ToolCall: functions.exec_command {"cmd":"npm test"}' },
      { ts: 1709999999, message: "ToolCall: functions.apply_patch" },
      { ts: 1709999998, message: "Fix backend runtime state mapping" }
    ]
  });

  assert.equal(state.room.phase, "execution");
  assert.equal(state.room.focus_zone, "backend");
  assert.equal(state.scene.active_zone.id, "backend");
  assert.equal(state.scene.assignment_hint.active, false);
  assert.equal(state.objective.focus_title, "Backend Rack");
});

test("workspace-root runtime activity does not inherit a stale review-heavy repo context title", () => {
  const state = buildRoomState({
    status: "busy",
    thread: makeThread({
      title: "rei kita bisa buat agent pixel ga si disini wkwk",
      cwd: "/Users/funtoco/workSpace",
      cwdDisplay: "workspace root",
      repoName: "workspace",
      updatedAgeSeconds: 20,
      updatedAgo: "20 dtk lalu"
    }),
    repoContext: makeThread({
      id: "thread_old_review_repo",
      title:
        "oke sembari nunggu review leader aku aku mau minta tolong kamu untuk buatin issue yang ada didalam issue ini dong rei",
      cwd: "/Users/funtoco/workSpace/fun-base",
      cwdDisplay: "fun-base",
      repoName: "fun-base",
      updatedAgeSeconds: 4 * 60,
      updatedAgo: "4 mnt lalu"
    }),
    recentThreads: [],
    activity: makeActivity({
      summary:
        "session_loop{thread_id=019cfae1-df1f-73b2-a96a-7439e0c1576d}:submission_dispatch{otel...}",
      source: "codex_core::stream_events_utils",
      lastLogAgeSeconds: 4,
      lastLogAgo: "4 dtk lalu"
    }),
    logs: [
      {
        ts: 1710000000,
        message:
          "session_loop{thread_id=019cfae1-df1f-73b2-a96a-7439e0c1576d}:submission_dispatch{otel...}"
      }
    ]
  });

  assert.equal(state.room.phase, "planning_huddle");
  assert.equal(state.room.focus_zone, "backend");
  assert.equal(state.objective.focus_title, "Backend Rack");
  assert.equal(state.scene.assignment_hint.active, true);
  assert.equal(state.scene.assignment_hint.zone_id, "backend");
});

test("generic runtime commands like npm start still pull the room into execution instead of huddling", () => {
  const state = buildRoomState({
    status: "busy",
    thread: makeThread({
      title: "Need docs review and issue cleanup for the room",
      updatedAgeSeconds: 18,
      updatedAgo: "18 dtk lalu"
    }),
    repoContext: null,
    recentThreads: [],
    activity: makeActivity({
      summary: "Menjalankan: npm start",
      source: "tool",
      lastLogAgeSeconds: 5,
      lastLogAgo: "5 dtk lalu"
    }),
    logs: [
      { ts: 1710000000, message: 'Received message {"type":"response.function_call_arguments.done","arguments":"{\\"cmd\\":\\"npm start\\"}"}' },
      { ts: 1709999999, message: "ToolCall: functions.exec_command" }
    ]
  });

  assert.equal(state.room.phase, "execution");
  assert.equal(state.room.focus_zone, "backend");
  assert.equal(state.scene.active_zone.id, "backend");
});

test("delegation creates squad split, multiple workstreams, and scout handoff", () => {
  const state = buildRoomState({
    status: "busy",
    thread: makeThread({
      title: "Split room UI polish and backend state mapping"
    }),
    repoContext: null,
    recentThreads: [],
    activity: makeActivity({
      summary: "Spawn agent for review labels while backend runtime mapping keeps running"
    }),
    logs: [
      { ts: 1710000000, message: "ToolCall: functions.spawn_agent" },
      { ts: 1709999999, message: "ToolCall: functions.send_input" },
      { ts: 1709999998, message: "Prepare concise labels for review" }
    ]
  });

  assert.equal(state.room.phase, "squad_split");
  assert.equal(state.room.mode, "multi");
  assert.ok(state.workstreams.length >= 2);
  assert.ok(
    state.recent_events.some((event) => event.type === "workstream_spawned"),
    "expected a workstream_spawned event"
  );
  assert.equal(state.scene.scout.active, true);
  assert.equal(state.scene.scout.reason, "workstream_spawned");
  assert.equal(state.agents.find((agent) => agent.id === "scout")?.activity, "moving");
});

test("review wrap activates docs review flow after results come back", () => {
  const state = buildRoomState({
    status: "busy",
    thread: makeThread({
      title: "Review final copy and wrap the room state refactor"
    }),
    repoContext: null,
    recentThreads: [],
    activity: makeActivity({
      summary: "Review returned results, summarize labels, and prepare final wrap"
    }),
    logs: [
      { ts: 1710000000, message: "ToolCall: functions.wait_agent" },
      { ts: 1709999999, message: "Review requested for concise labels" },
      { ts: 1709999998, message: "Summarize changes for handoff" }
    ]
  });

  assert.equal(state.room.phase, "review_wrap");
  assert.ok(
    state.workstreams.some(
      (workstream) => workstream.owner === "docs" && workstream.status === "active"
    )
  );
  assert.equal(state.agents.find((agent) => agent.id === "docs")?.activity, "reviewing");
  assert.ok(
    state.recent_events.some(
      (event) => event.type === "result_returned" || event.type === "review_requested"
    )
  );
});

test("generic multi-lane execution does not create a docs review lane without review evidence", () => {
  const state = buildRoomState({
    status: "busy",
    thread: makeThread({
      id: "thread_multi_no_review",
      title: "Coordinate frontend and backend fixes for the room"
    }),
    repoContext: null,
    recentThreads: [],
    activity: makeActivity({
      summary: "Lead is coordinating active worker threads"
    }),
    logs: [{ ts: 1710000000, message: "Agent workers are running" }],
    agentJobs: [
      {
        job_id: "job_multi_no_review",
        item_id: "item_frontend_live",
        status: "running",
        assigned_thread_id: "thread_multi_no_review",
        instruction: "Fix clipping and CSS layout in the room shell",
        row_json: JSON.stringify({
          task: "Fix clipping and CSS layout in the room shell"
        }),
        result_json: null
      },
      {
        job_id: "job_multi_no_review",
        item_id: "item_backend_live",
        status: "running",
        assigned_thread_id: "thread_multi_no_review",
        instruction: "Refine runtime event mapping and state cleanup",
        row_json: JSON.stringify({
          task: "Refine runtime event mapping and state cleanup"
        }),
        result_json: null
      }
    ]
  });

  assert.equal(state.room.phase, "squad_split");
  assert.equal(
    state.workstreams.some((workstream) => workstream.id === "ws_review"),
    false
  );
  assert.equal(state.agents.find((agent) => agent.id === "docs")?.activity, "waiting");
});

test("generic result wording does not synthesize a returned-result event without explicit completion", () => {
  const state = buildRoomState({
    status: "cooldown",
    thread: makeThread({
      title: "Review final room wording and keep the layout tidy",
      updatedAgeSeconds: 160,
      updatedAgo: "2 mnt lalu"
    }),
    repoContext: null,
    recentThreads: [],
    activity: makeActivity({
      summary: "Review notes are done and the room is settling down",
      lastLogAgeSeconds: 95,
      lastLogAgo: "1 mnt lalu"
    }),
    logs: [{ ts: 1710000000, message: "Done checking room wording" }]
  });

  assert.notEqual(state.room.phase, "review_wrap");
  assert.equal(state.room.mode, "solo");
  assert.equal(
    state.recent_events.some((event) => event.type === "result_returned"),
    false
  );
  assert.equal(
    state.recent_events.some((event) => event.type === "handoff_created"),
    false
  );
  assert.equal(
    state.workstreams.some((workstream) => workstream.id === "ws_review"),
    false
  );
  assert.notEqual(state.agents.find((agent) => agent.id === "docs")?.activity, "reviewing");
});

test("assigned agent job items drive real multi-agent squad split", () => {
  const state = buildRoomState({
    status: "busy",
    thread: makeThread({
      id: "thread_multi_real",
      title: "Coordinate frontend and backend fixes for the room"
    }),
    repoContext: null,
    recentThreads: [],
    activity: makeActivity({
      summary: "Lead is coordinating active worker threads"
    }),
    logs: [
      { ts: 1710000000, message: "Agent workers are running" }
    ],
    agentJobs: [
      {
        job_id: "job_1",
        item_id: "item_frontend",
        status: "running",
        assigned_thread_id: "thread_multi_real",
        instruction: "Fix clipping and CSS layout in the room shell",
        row_json: JSON.stringify({
          task: "Fix clipping and CSS layout in the room shell"
        }),
        result_json: null
      },
      {
        job_id: "job_1",
        item_id: "item_backend",
        status: "running",
        assigned_thread_id: "thread_multi_real",
        instruction: "Refine runtime event mapping and state cleanup",
        row_json: JSON.stringify({
          task: "Refine runtime event mapping and state cleanup"
        }),
        result_json: null
      }
    ]
  });

  assert.equal(state.room.mode, "multi");
  assert.equal(state.room.phase, "squad_split");
  assert.ok(
    state.workstreams.some(
      (workstream) => workstream.id === "agent_item_frontend" && workstream.zone === "frontend"
    )
  );
  assert.ok(
    state.workstreams.some(
      (workstream) => workstream.id === "agent_item_backend" && workstream.zone === "backend"
    )
  );
  assert.ok(
    state.recent_events.some(
      (event) => event.type === "workstream_spawned" && event.workstream_id === "agent_item_frontend"
    )
  );
  assert.match(
    state.agents.find((agent) => agent.id === "ui")?.activity || "",
    /coding|debugging|reading|reviewing|summarizing/
  );
  assert.match(
    state.agents.find((agent) => agent.id === "api")?.activity || "",
    /coding|debugging|reading|reviewing|summarizing/
  );
  assert.doesNotMatch(state.agents.find((agent) => agent.id === "ui")?.activity || "", /moving|waiting/);
  assert.doesNotMatch(state.agents.find((agent) => agent.id === "api")?.activity || "", /moving|waiting/);
});

test("completed agent job items become returned results for review wrap", () => {
  const state = buildRoomState({
    status: "busy",
    thread: makeThread({
      id: "thread_multi_review",
      title: "Wrap up multi-agent room stabilization"
    }),
    repoContext: null,
    recentThreads: [],
    activity: makeActivity({
      summary: "Worker results came back and need final review"
    }),
    logs: [
      { ts: 1710000000, message: "Agent workers completed their assigned tasks" }
    ],
    agentJobs: [
      {
        job_id: "job_2",
        item_id: "item_frontend_done",
        status: "completed",
        assigned_thread_id: "thread_multi_review",
        instruction: "Fix clipping and CSS layout in the room shell",
        row_json: JSON.stringify({
          task: "Fix clipping and CSS layout in the room shell"
        }),
        result_json: JSON.stringify({
          summary: "Layout shell patched and overflow regression removed"
        })
      },
      {
        job_id: "job_2",
        item_id: "item_backend_done",
        status: "completed",
        assigned_thread_id: "thread_multi_review",
        instruction: "Refine runtime event mapping and state cleanup",
        row_json: JSON.stringify({
          task: "Refine runtime event mapping and state cleanup"
        }),
        result_json: JSON.stringify({
          summary: "Cooldown cleanup and runtime lifecycle are now stable"
        })
      }
    ]
  });

  assert.equal(state.room.mode, "multi");
  assert.equal(state.room.phase, "review_wrap");
  assert.ok(
    state.recent_events.some(
      (event) => event.type === "result_returned" && event.from === "frontend"
    )
  );
  assert.ok(
    state.recent_events.some(
      (event) => event.type === "result_returned" && event.from === "backend"
    )
  );
  assert.equal(state.agents.find((agent) => agent.id === "docs")?.activity, "reviewing");
  assert.equal(state.scene.scout.reason, "result_returned");
});

test("fresh lane completion stays in a stable result-return review wrap before cooldown", () => {
  const state = buildRoomState({
    status: "cooldown",
    thread: makeThread({
      id: "thread_finish_hold",
      title: "Wrap up multi-lane room stabilization",
      updatedAt: 1710000060,
      updatedAgeSeconds: 20,
      updatedAgo: "20 dtk lalu"
    }),
    repoContext: null,
    recentThreads: [],
    activity: makeActivity({
      summary: "Worker results returned and review wrap is starting",
      lastLogAgeSeconds: 20,
      lastLogAgo: "20 dtk lalu"
    }),
    logs: [{ ts: 1710000060, message: "Result returned from worker lane" }],
    agentJobs: [
      {
        job_id: "job_finish_hold",
        item_id: "item_frontend_done",
        status: "completed",
        assigned_thread_id: "thread_finish_hold",
        instruction:
          'spawn_child_async: "C:\\\\Windows\\\\System32\\\\WindowsPowerShell\\\\v1.0\\\\powershell.exe" ["npm","test"]',
        row_json: JSON.stringify({
          task: 'spawn_child_async: "C:\\\\Windows\\\\System32\\\\WindowsPowerShell\\\\v1.0\\\\powershell.exe" ["npm","test"]'
        }),
        result_json: JSON.stringify({
          summary: "Verification completed and UI lane is ready for wrap"
        }),
        completed_at: 1710000060
      }
    ]
  });

  assert.equal(state.room.phase, "review_wrap");
  assert.equal(state.room.review_stage, "results_returning");
  assert.equal(state.room.substate, null);
  assert.equal(state.scene.primary_bubble.text, "results in");
  assert.equal(state.scene.scout.active, true);
  assert.equal(state.agents.find((agent) => agent.id === "lead")?.activity, "summarizing");
  assert.notEqual(state.agents.find((agent) => agent.id === "docs")?.activity, "idle");
  assert.notEqual(state.workstreams.find((stream) => stream.id === "agent_item_frontend_done")?.task, undefined);
  assert.doesNotMatch(
    state.workstreams.find((stream) => stream.id === "agent_item_frontend_done")?.task || "",
    /spawn_child_async|powershell|windows\\\\system32/i
  );
});

test("review wrap regroups workers briefly before the room settles into cooldown", () => {
  const state = buildRoomState({
    status: "cooldown",
    thread: makeThread({
      id: "thread_finish_regroup",
      title: "Wrap up multi-lane room stabilization",
      updatedAt: 1710000100,
      updatedAgeSeconds: 55,
      updatedAgo: "55 dtk lalu"
    }),
    repoContext: null,
    recentThreads: [],
    activity: makeActivity({
      summary: "Review wrap is consolidating returned lanes",
      lastLogAgeSeconds: 55,
      lastLogAgo: "55 dtk lalu"
    }),
    logs: [{ ts: 1710000100, message: "Review wrap is consolidating returned lanes" }],
    agentJobs: [
      {
        job_id: "job_finish_regroup",
        item_id: "item_frontend_done",
        status: "completed",
        assigned_thread_id: "thread_finish_regroup",
        instruction: "Fix clipping and CSS layout in the room shell",
        row_json: JSON.stringify({
          task: "Fix clipping and CSS layout in the room shell"
        }),
        result_json: JSON.stringify({
          summary: "Layout shell patched and ready for review wrap"
        }),
        completed_at: 1710000100
      },
      {
        job_id: "job_finish_regroup",
        item_id: "item_backend_done",
        status: "completed",
        assigned_thread_id: "thread_finish_regroup",
        instruction: "Refine runtime event mapping and state cleanup",
        row_json: JSON.stringify({
          task: "Refine runtime event mapping and state cleanup"
        }),
        result_json: JSON.stringify({
          summary: "Runtime mapping is stable and ready for review wrap"
        }),
        completed_at: 1710000100
      }
    ]
  });

  assert.equal(state.room.phase, "review_wrap");
  assert.equal(state.room.review_stage, "regroup");
  assert.equal(state.room.substate, null);
  assert.equal(state.scene.scout.active, false);
  assert.equal(state.agents.find((agent) => agent.id === "ui")?.assigned_zone, "lab");
  assert.equal(state.agents.find((agent) => agent.id === "api")?.assigned_zone, "lab");
  assert.match(state.agents.find((agent) => agent.id === "ui")?.activity || "", /gathering|summarizing/);
  assert.match(state.agents.find((agent) => agent.id === "api")?.activity || "", /gathering|summarizing/);
});

test("human-readable summaries replace raw runtime strings in primary and lane copy", () => {
  const state = buildRoomState({
    status: "busy",
    thread: makeThread({
      title:
        'spawn_child_async: "C:\\\\Windows\\\\System32\\\\WindowsPowerShell\\\\v1.0\\\\powershell.exe" ["npm","test"]'
    }),
    repoContext: null,
    recentThreads: [],
    activity: makeActivity({
      summary:
        'spawn_child_async: "C:\\\\Windows\\\\System32\\\\WindowsPowerShell\\\\v1.0\\\\powershell.exe" ["npm","test"]'
    }),
    logs: [
      {
        ts: 1710000000,
        message:
          'ToolCall: functions.exec_command {"cmd":"C:\\\\Windows\\\\System32\\\\WindowsPowerShell\\\\v1.0\\\\powershell.exe -NoProfile -Command npm test"}'
      }
    ],
    agentJobs: [
      {
        job_id: "job_humanize",
        item_id: "item_verify",
        status: "running",
        assigned_thread_id: "thread_1",
        instruction:
          'spawn_child_async: "C:\\\\Windows\\\\System32\\\\WindowsPowerShell\\\\v1.0\\\\powershell.exe" ["npm","test"]',
        row_json: JSON.stringify({
          task: 'spawn_child_async: "C:\\\\Windows\\\\System32\\\\WindowsPowerShell\\\\v1.0\\\\powershell.exe" ["npm","test"]'
        }),
        result_json: null
      }
    ]
  });

  assert.match(state.room.current_task, /verification|local process/i);
  assert.doesNotMatch(state.room.current_task, /spawn_child_async|powershell|windows\\\\system32/i);
  assert.doesNotMatch(
    state.workstreams.find((stream) => stream.id === "agent_item_verify")?.task || "",
    /spawn_child_async|powershell|windows\\\\system32/i
  );
});

test("parallel tool-call bursts act as real multi-lane fallback when agent jobs are absent", () => {
  const state = buildRoomState({
    status: "busy",
    thread: makeThread({
      id: "thread_parallel_logs",
      title: "Audit frontend and backend state in parallel"
    }),
    repoContext: null,
    recentThreads: [],
    activity: makeActivity({
      summary: "Parallel checks are running across frontend and backend lanes"
    }),
    logs: [
      {
        ts: 1710000000,
        message:
          'ToolCall: shell_command {"command":"Get-Content C:\\\\repo\\\\public\\\\styles.css","workdir":"C:\\\\repo","timeout_ms":120000}'
      },
      {
        ts: 1710000000,
        message:
          'ToolCall: shell_command {"command":"Get-Content C:\\\\repo\\\\server.mjs","workdir":"C:\\\\repo","timeout_ms":120000}'
      },
      {
        ts: 1709999999,
        message: "Parallel checks launched for multiple lanes"
      }
    ]
  });

  assert.equal(state.room.mode, "multi");
  assert.equal(state.room.phase, "squad_split");
  assert.ok(
    state.workstreams.some((workstream) => workstream.zone === "frontend"),
    "expected inferred frontend lane"
  );
  assert.ok(
    state.workstreams.some((workstream) => workstream.zone === "backend"),
    "expected inferred backend lane"
  );
  assert.ok(
    state.recent_events.some((event) => event.type === "workstream_spawned"),
    "expected spawned fallback lane event"
  );
});

test("workspace state keeps one active room and groups other repos into sleeping rooms", () => {
  const state = buildRoomState({
    status: "busy",
    thread: makeThread({
      id: "thread_active",
      repoName: "rei-ops-room",
      cwdDisplay: "rei-ops-room",
      title: "Refactor active room dock behavior"
    }),
    repoContext: {
      id: "thread_budget_latest",
      repoName: "budget-app",
      cwdDisplay: "project/budget-app",
      title: "Budget app OCR issue",
      updatedAgo: "6 mnt lalu",
      updatedAgeSeconds: 360
    },
    recentThreads: [
      makeThread({
        id: "thread_active",
        repoName: "rei-ops-room",
        cwdDisplay: "rei-ops-room",
        title: "Refactor active room dock behavior",
        updatedAgo: "12 dtk lalu",
        updatedAgeSeconds: 12
      }),
      makeThread({
        id: "thread_same_repo_2",
        repoName: "rei-ops-room",
        cwdDisplay: "rei-ops-room",
        title: "Fix room overflow follow-up",
        updatedAgo: "4 mnt lalu",
        updatedAgeSeconds: 240
      }),
      makeThread({
        id: "thread_budget_latest",
        repoName: "budget-app",
        cwdDisplay: "project/budget-app",
        title: "Budget app OCR issue",
        updatedAgo: "6 mnt lalu",
        updatedAgeSeconds: 360
      }),
      makeThread({
        id: "thread_pids_latest",
        repoName: "pids-onprem-dashboard",
        cwdDisplay: "project/pids-onprem-dashboard",
        title: "Dashboard polish and release prep",
        updatedAgo: "19 mnt lalu",
        updatedAgeSeconds: 1140
      })
    ],
    activity: makeActivity({
      summary: "Wiring workspace dock into the active room"
    }),
    logs: [{ ts: 1710000000, message: "Workspace dock is being built" }]
  });

  assert.equal(state.workspace.active_room.repo, "rei-ops-room");
  assert.equal(state.workspace.active_room.recent_thread_count, 2);
  assert.equal(state.workspace.active_room.active_lane_count, 1);
  assert.equal(state.workspace.sleeping_rooms.length, 2);
  assert.equal(state.workspace.sleeping_rooms[0].repo, "budget-app");
  assert.equal(state.workspace.sleeping_rooms[0].status, "cooldown");
  assert.equal(state.workspace.sleeping_rooms[0].recent_thread_count, 1);
  assert.equal(state.workspace.sleeping_rooms[1].repo, "pids-onprem-dashboard");
  assert.equal(state.workspace.sleeping_rooms[1].status, "idle");
});

test("workspace dock falls back to Workspace Hub when the room is dormant and the last repo is stale", () => {
  const state = buildRoomState({
    status: "idle",
    thread: makeThread({
      id: "thread_fun_base_stale",
      repoName: "fun-base",
      cwdDisplay: "fun-base",
      title: "Issue follow-up in fun-base",
      updatedAgo: "2 jam lalu",
      updatedAgeSeconds: 2 * 60 * 60
    }),
    repoContext: null,
    recentThreads: [
      makeThread({
        id: "thread_fun_base_stale",
        repoName: "fun-base",
        cwdDisplay: "fun-base",
        title: "Issue follow-up in fun-base",
        updatedAgo: "2 jam lalu",
        updatedAgeSeconds: 2 * 60 * 60
      }),
      makeThread({
        id: "thread_workspace_recent",
        repoName: "workSpace",
        cwd: "/Users/funtoco/workSpace",
        cwdDisplay: "workspace root",
        title: "General workspace chat",
        updatedAgo: "40 dtk lalu",
        updatedAgeSeconds: 40
      }),
      makeThread({
        id: "thread_budget_recent",
        repoName: "budget-app",
        cwdDisplay: "budget-app",
        title: "Budget OCR follow-up",
        updatedAgo: "8 mnt lalu",
        updatedAgeSeconds: 8 * 60
      })
    ],
    activity: makeActivity({
      summary: "Standby di room aktif",
      source: "thread",
      lastLogAgeSeconds: 26 * 60,
      lastLogAgo: "26 mnt lalu"
    }),
    logs: []
  });

  assert.equal(state.room.phase, "standby");
  assert.equal(state.workspace.active_room.repo, "Workspace Hub");
  assert.equal(state.workspace.active_room.cwd_display, "workspace root");
  assert.equal(state.workspace.active_room.latest_title, "General workspace chat");
  assert.ok(
    state.workspace.sleeping_rooms.some((entry) => entry.repo === "fun-base"),
    "expected stale repo to move into sleeping rooms"
  );
});

test("workspace dock counts the real number of active lanes when multiple worker jobs are running", () => {
  const state = buildRoomState({
    status: "busy",
    thread: makeThread({
      id: "thread_workspace_lanes",
      repoName: "rei-ops-room",
      cwdDisplay: "rei-ops-room",
      title: "Split three live lanes across the room"
    }),
    repoContext: null,
    recentThreads: [],
    activity: makeActivity({
      summary: "Lead is coordinating three active worker lanes"
    }),
    logs: [{ ts: 1710000000, message: "Worker lanes are active" }],
    agentJobs: [
      {
        job_id: "job_workspace_lanes",
        item_id: "item_frontend",
        status: "running",
        assigned_thread_id: "thread_workspace_lanes",
        instruction: "Fix room shell overflow",
        row_json: JSON.stringify({ task: "Fix room shell overflow" }),
        result_json: null
      },
      {
        job_id: "job_workspace_lanes",
        item_id: "item_backend",
        status: "running",
        assigned_thread_id: "thread_workspace_lanes",
        instruction: "Refine runtime event mapping",
        row_json: JSON.stringify({ task: "Refine runtime event mapping" }),
        result_json: null
      },
      {
        job_id: "job_workspace_lanes",
        item_id: "item_review",
        status: "running",
        assigned_thread_id: "thread_workspace_lanes",
        instruction: "Prepare concise room wrap labels",
        row_json: JSON.stringify({ task: "Prepare concise room wrap labels" }),
        result_json: null
      }
    ]
  });

  assert.equal(state.room.mode, "multi");
  assert.equal(state.room.phase, "squad_split");
  assert.equal(state.workspace.active_room.active_lane_count, 3);
});

test("current objective summarizes the active goal instead of echoing the raw thread opener", () => {
  const state = buildRoomState({
    status: "busy",
    thread: makeThread({
      title: "rei kita bisa buat agent pixel ga si disini wkwk",
      cwd: "/Users/funtoco/workSpace",
      cwdDisplay: "workspace root",
      repoName: "workSpace"
    }),
    repoContext: makeThread({
      id: "thread_repo_context",
      title: "Refine room workspace and wrap transitions",
      cwd: "/Users/funtoco/workSpace/codex-pixel-agent",
      cwdDisplay: "codex-pixel-agent",
      repoName: "codex-pixel-agent"
    }),
    recentThreads: [],
    activity: makeActivity({
      summary: "Sketch room behavior and define the first pixel agent flow",
      lastLogAgeSeconds: 14,
      lastLogAgo: "14 dtk lalu"
    }),
    logs: [{ ts: 1710000000, message: "Planning pixel room behavior" }]
  });

  assert.equal(state.objective.title, "bangun pixel ops room");
  assert.equal(state.objective.detail, "Sketch room behavior and define the first pixel agent flow");
  assert.equal(state.objective.repo, "codex-pixel-agent");
  assert.equal(state.room.current_task, "bangun pixel ops room");
});

test("workspace and objective cards use cleaned display titles when codex stores a raw prompt opener", () => {
  const state = buildRoomState({
    status: "idle",
    thread: makeThread({
      title: "rei kita bisa buat agent pixel ga si disini wkwk",
      cwd: "/Users/funtoco/workSpace",
      cwdDisplay: "workspace root",
      repoName: "workSpace",
      updatedAgeSeconds: 4,
      updatedAgo: "4 dtk lalu"
    }),
    repoContext: makeThread({
      id: "thread_fun_base_latest",
      title:
        "oke sembari nunggu review leader aku aku mau minta tolong kamu untuk buatin issue yang ada didalam issue ini dong rei https://github.com/funtoco/fun-docs/issues/527, di bawahnya kan itu ada task gitu kan nah itu aku mau komakaku kitte wakeru gitu buat aja di no status dulu soalnya nanti paling minggu depan pas aku teirei sama leader baru ngomong yang mana yang mau di kelarin dulu.. kalo udah kamu sambungin issue 527 itu ke issue issue yang udah di pecah ya.. bisa?",
      cwd: "/Users/funtoco/workSpace/fun-base",
      cwdDisplay: "fun-base",
      repoName: "fun-base",
      updatedAgeSeconds: 3600,
      updatedAgo: "1 jam lalu"
    }),
    recentThreads: [
      makeThread({
        id: "thread_workspace_latest",
        title: "rei kita bisa buat agent pixel ga si disini wkwk",
        cwd: "/Users/funtoco/workSpace",
        cwdDisplay: "workspace root",
        repoName: "workSpace",
        updatedAgeSeconds: 4,
        updatedAgo: "4 dtk lalu"
      }),
      makeThread({
        id: "thread_fun_base_latest",
        title:
          "oke sembari nunggu review leader aku aku mau minta tolong kamu untuk buatin issue yang ada didalam issue ini dong rei https://github.com/funtoco/fun-docs/issues/527, di bawahnya kan itu ada task gitu kan nah itu aku mau komakaku kitte wakeru gitu buat aja di no status dulu soalnya nanti paling minggu depan pas aku teirei sama leader baru ngomong yang mana yang mau di kelarin dulu.. kalo udah kamu sambungin issue 527 itu ke issue issue yang udah di pecah ya.. bisa?",
        cwd: "/Users/funtoco/workSpace/fun-base",
        cwdDisplay: "fun-base",
        repoName: "fun-base",
        updatedAgeSeconds: 3600,
        updatedAgo: "1 jam lalu"
      })
    ],
    activity: makeActivity({
      summary: "Standby di room aktif",
      source: "thread",
      lastLogAgeSeconds: 45 * 60,
      lastLogAgo: "45 mnt lalu"
    }),
    logs: []
  });

  assert.equal(state.objective.title, "bangun pixel ops room");
  assert.equal(state.objective.detail, "Istirahat sejenak");
  assert.equal(state.workspace.active_room.latest_title, "bangun pixel ops room");
  assert.equal(state.workspace.sleeping_rooms[0].repo, "fun-base");
  assert.equal(state.workspace.sleeping_rooms[0].latest_title, "pecah issue jadi task kecil");
});

test("runtime trail decays a finished command into last finished instead of keeping it live", () => {
  const state = buildRoomState({
    status: "busy",
    thread: makeThread({
      title: "Check LAN access for the pixel room"
    }),
    repoContext: null,
    recentThreads: [],
    activity: makeActivity({
      summary: "Menjalankan: ipconfig getifaddr en1",
      lastLogAgeSeconds: 26,
      lastLogAgo: "26 dtk lalu"
    }),
    logs: [
      {
        ts: 1710000000,
        message:
          'ToolCall: functions.exec_command {"cmd":"ipconfig getifaddr en1"}'
      },
      {
        ts: 1709999990,
        message:
          'ToolCall: functions.exec_command {"cmd":"ipconfig getifaddr en0"}'
      }
    ]
  });

  assert.equal(state.runtime.live_now, null);
  assert.equal(state.runtime.last_finished.title, "network check");
  assert.equal(state.runtime.last_finished.status, "recent");
  assert.equal(state.room.current_task, state.objective.title);
});

test("runtime trail ignores low-level transport noise when there is no meaningful finished action", () => {
  const state = buildRoomState({
    status: "busy",
    thread: makeThread({
      title: "rei kita bisa buat agent pixel ga si disini wkwk",
      cwd: "/Users/funtoco/workSpace",
      cwdDisplay: "workspace root",
      repoName: "workSpace",
      updatedAgeSeconds: 0,
      updatedAgo: "baru saja"
    }),
    repoContext: makeThread({
      id: "thread_repo_context",
      title: "Refine room workspace and wrap transitions",
      cwd: "/Users/funtoco/workSpace/codex-pixel-agent",
      cwdDisplay: "codex-pixel-agent",
      repoName: "codex-pixel-agent"
    }),
    recentThreads: [],
    activity: {
      summary: "rei kita bisa buat agent pixel ga si disini wkwk",
      source: "thread",
      kind: "thread",
      lastLogAgeSeconds: 0,
      lastLogAgo: "baru saja"
    },
    logs: [
      {
        ts: 1710000000,
        message: "registering event source with poller: token=Token(36376310912)"
      },
      {
        ts: 1709999999,
        message: "token usage"
      }
    ]
  });

  assert.equal(state.runtime.live_now, null);
  assert.equal(state.runtime.last_finished, null);
  assert.equal(state.room.current_task, "bangun pixel ops room");
});

test("cooldown rest mode returns the room to standby with a visible break state", () => {
  const state = buildRoomState({
    status: "cooldown",
    thread: makeThread({
      title: "Refactor room visuals",
      updatedAgeSeconds: 320,
      updatedAgo: "5 mnt lalu"
    }),
    repoContext: null,
    recentThreads: [],
    activity: makeActivity({
      summary: "Istirahat sejenak",
      source: "presence",
      kind: "rest",
      lastLogAgeSeconds: 320,
      lastLogAgo: "5 mnt lalu"
    }),
    logs: []
  });

  assert.equal(state.room.phase, "standby");
  assert.equal(state.room.resting, true);
  assert.equal(state.room.current_task, "Istirahat sejenak");
  assert.equal(state.scene.primary_bubble.text, "istirahat dulu");
  assert.equal(state.scene.resting, true);
  assert.equal(state.scene.rest_corner.active, true);
  assert.deepEqual(state.scene.rest_corner.allowed_agent_ids, ["lead", "ui", "docs"]);
  assert.equal(state.agents.find((agent) => agent.id === "lead")?.idle_behavior, "idle_rest");
  assert.equal(state.agents.find((agent) => agent.id === "api")?.assigned_zone, "backend");
  assert.equal(state.agents.find((agent) => agent.id === "lead")?.activity, "idle");
});

test("review wrap only opens the rest corner after the room settles", () => {
  const activeReview = buildRoomState({
    status: "busy",
    thread: makeThread({
      title: "Review final copy and wrap the room state refactor"
    }),
    repoContext: null,
    recentThreads: [],
    activity: makeActivity({
      summary: "Review returned results, summarize labels, and prepare final wrap",
      lastLogAgeSeconds: 12,
      lastLogAgo: "12 dtk lalu"
    }),
    logs: [
      { ts: 1710000000, message: "ToolCall: functions.wait_agent" },
      { ts: 1709999999, message: "Review requested for concise labels" }
    ]
  });

  assert.equal(activeReview.scene.rest_corner.active, false);

  const settledReview = buildRoomState({
    status: "cooldown",
    thread: makeThread({
      title: "Review final copy and wrap the room state refactor",
      updatedAgeSeconds: 220,
      updatedAgo: "3 mnt lalu"
    }),
    repoContext: null,
    recentThreads: [],
    activity: makeActivity({
      summary: "Results wrapped and room is settling down",
      lastLogAgeSeconds: 130,
      lastLogAgo: "2 mnt lalu"
    }),
    logs: [
      { ts: 1710000000, message: "Result returned from review lane" },
      { ts: 1709999999, message: "Summarize changes for handoff" }
    ]
  });

  assert.equal(settledReview.scene.rest_corner.active, true);
  assert.deepEqual(settledReview.scene.rest_corner.allowed_agent_ids, ["lead", "docs"]);
});

test("standby distributes workers across home zones instead of parking everyone in the center", () => {
  const state = buildRoomState({
    status: "idle",
    thread: makeThread({
      title: "Room is quiet while waiting for the next request",
      updatedAgeSeconds: 1800,
      updatedAgo: "30 mnt lalu"
    }),
    repoContext: null,
    recentThreads: [],
    activity: makeActivity({
      summary: "Waiting for the next request and watching the room",
      source: "thread",
      lastLogAgeSeconds: 1800,
      lastLogAgo: "30 mnt lalu"
    }),
    logs: []
  });

  assert.equal(state.room.phase, "standby");
  assert.equal(state.scene.center_mode, "observed");
  assert.equal(state.agents.find((agent) => agent.id === "lead")?.assigned_zone, "lab");
  assert.equal(state.agents.find((agent) => agent.id === "ui")?.assigned_zone, "frontend");
  assert.equal(state.agents.find((agent) => agent.id === "api")?.assigned_zone, "backend");
  assert.equal(state.agents.find((agent) => agent.id === "db")?.assigned_zone, "database");
  assert.equal(state.agents.find((agent) => agent.id === "docs")?.assigned_zone, "review");
  assert.equal(state.agents.find((agent) => agent.id === "ui")?.idle_behavior, "idle_at_desk");
  assert.equal(state.agents.find((agent) => agent.id === "db")?.idle_behavior, "idle_observe");
  assert.equal(state.agents.find((agent) => agent.id === "scout")?.idle_behavior, "idle_patrol");
});

test("scene includes purposeful props and ambient cues for inhabited atmosphere", () => {
  const state = buildRoomState({
    status: "busy",
    thread: makeThread({
      title: "Plan and review room activity flow"
    }),
    repoContext: null,
    recentThreads: [],
    activity: makeActivity({
      summary: "Planning board review and monitor check"
    }),
    logs: [{ ts: 1710000000, message: "Need plan before implementation" }]
  });

  assert.ok(state.scene.props.some((prop) => prop.id === "planning_board"));
  assert.ok(state.scene.props.some((prop) => prop.id === "status_monitor"));
  assert.ok(state.scene.props.some((prop) => prop.id === "tool_rack"));
  assert.ok(state.scene.props.some((prop) => prop.id === "document_tray"));
  assert.ok(state.scene.ambient_cues.some((cue) => cue.id === "board_glow"));
});

test("summarizePrimaryTask compresses long technical runtime strings for primary UI", () => {
  const summary = summarizePrimaryTask(
    'spawn_child_async: "C:\\\\Windows\\\\System32\\\\WindowsPowerShell\\\\v1.0\\\\powershell.exe" ["npm","test"]'
  );

  assert.equal(summary, "verification pass");
});

test("cooldown cleans active review/request visuals into passive aftermath", () => {
  const state = buildRoomState({
    status: "cooldown",
    thread: makeThread({
      title: "Review final copy and wrap the room state refactor",
      updatedAgeSeconds: 180,
      updatedAgo: "3 mnt lalu"
    }),
    repoContext: null,
    recentThreads: [],
    activity: makeActivity({
      summary: "Review returned results and the room is cooling down",
      lastLogAgeSeconds: 95,
      lastLogAgo: "1 mnt lalu"
    }),
    logs: [
      { ts: 1710000000, message: "ToolCall: functions.wait_agent" },
      { ts: 1709999999, message: "Review requested for concise labels" }
    ]
  });

  assert.equal(state.room.phase, "review_wrap");
  assert.equal(state.room.substate, "cooldown");
  assert.equal(state.scene.primary_bubble.text, "settling down");
  assert.equal(state.scene.scout.active, false);
  assert.equal(state.scene.visual_intensity, "low");
  assert.deepEqual(state.scene.desk_highlights, ["lab"]);
  assert.equal(state.agents.find((agent) => agent.id === "docs")?.activity, "idle");
  assert.equal(
    state.workstreams.find((workstream) => workstream.id === "ws_review")?.status,
    "completed"
  );
});

test("skill badge awareness extracts active skills from runtime traces", () => {
  const state = buildRoomState({
    status: "busy",
    thread: makeThread({
      title: "Refactor room state with better verification"
    }),
    repoContext: null,
    recentThreads: [],
    activity: makeActivity({
      summary: "Wire TDD and verification flow into the room"
    }),
    logs: [
      {
        ts: 1710000000,
        message:
          'ToolCall: functions.exec_command {"cmd":"sed -n \'1,220p\' /Users/funtoco/.codex/skills/test-driven-development/SKILL.md"}'
      },
      {
        ts: 1709999999,
        message:
          'ToolCall: functions.exec_command {"cmd":"sed -n \'1,220p\' /Users/funtoco/.codex/skills/verification-before-completion/SKILL.md"}'
      },
      {
        ts: 1709999998,
        message:
          'ToolCall: functions.exec_command {"cmd":"sed -n \'1,220p\' /Users/funtoco/.codex/skills/webapp-testing/SKILL.md"}'
      }
    ]
  });

  assert.deepEqual(
    state.skills.map((skill) => skill.id),
    ["test-driven-development", "verification-before-completion", "webapp-testing"]
  );
  assert.equal(state.scene.skill_badges.length, 3);
  assert.equal(state.scene.skill_badges[0].label, "TDD");
});
