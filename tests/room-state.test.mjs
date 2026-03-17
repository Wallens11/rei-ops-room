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

  assert.equal(summary, "Started a local process");
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
