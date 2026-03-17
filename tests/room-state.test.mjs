import test from "node:test";
import assert from "node:assert/strict";

import { buildRoomState } from "../public/room-state.js";

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
  assert.equal(state.agents.find((agent) => agent.id === "lead")?.activity, "idle");
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
