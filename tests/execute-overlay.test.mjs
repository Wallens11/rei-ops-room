import test from "node:test";
import assert from "node:assert/strict";

import {
  applyExecuteOverlay,
  buildExecuteSignals,
  RUNTIME_VISUAL_MAP,
  EXECUTE_NARRATION_WINDOW_SECONDS
} from "../server.mjs";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeRoomState(overrides = {}) {
  return {
    room: {
      phase: "standby",
      phase_reason: "Quiet.",
      resting: true,
      substate: "cooldown"
    },
    phase: { mode: "standby", title: "Standby", reason: "Quiet." },
    scene: {
      tone: "calm",
      resting: true,
      desk_highlights: ["lab"]
    },
    agents: [
      { id: "lead", activity: "idle", assigned_zone: "lab", idle_behavior: "idle_observe" },
      { id: "ui", activity: "idle", assigned_zone: "frontend", idle_behavior: "idle_observe" },
      { id: "api", activity: "idle", assigned_zone: "backend", idle_behavior: "idle_observe" }
    ],
    ...overrides
  };
}

function runningTask(runtimeId, extra = {}) {
  return { id: `t-${runtimeId}`, status: "running", runtimeId, prompt: `work on ${runtimeId}`, ...extra };
}

// ─── applyExecuteOverlay ──────────────────────────────────────────────────────

test("applyExecuteOverlay is a no-op when nothing is running", () => {
  const room = makeRoomState();
  applyExecuteOverlay(room, { runningTasks: [] });

  assert.equal(room.room.phase, "standby");
  assert.equal(room.scene.tone, "calm");
  assert.equal(room.scene.resting, true);
  assert.equal(room.agents.find((a) => a.id === "ui").activity, "idle");
});

test("applyExecuteOverlay tolerates missing roomState / signals", () => {
  assert.doesNotThrow(() => applyExecuteOverlay(null, { runningTasks: [runningTask("codex")] }));
  assert.doesNotThrow(() => applyExecuteOverlay(makeRoomState(), null));
});

test("applyExecuteOverlay seats the claude-code agent at the frontend desk", () => {
  const room = makeRoomState();
  applyExecuteOverlay(room, { runningTasks: [runningTask("claude-code")] });

  const ui = room.agents.find((a) => a.id === "ui");
  assert.equal(ui.activity, "coding");
  assert.equal(ui.assigned_zone, "frontend");
  assert.equal(ui.idle_behavior, null);
  assert.equal(ui.runtime, "claude-code");
  assert.ok(room.scene.desk_highlights.includes("frontend"));
});

test("applyExecuteOverlay seats the codex agent at the backend desk", () => {
  const room = makeRoomState();
  applyExecuteOverlay(room, { runningTasks: [runningTask("codex")] });

  const api = room.agents.find((a) => a.id === "api");
  assert.equal(api.activity, "coding");
  assert.equal(api.assigned_zone, "backend");
  assert.equal(api.runtime, "codex");
  assert.ok(room.scene.desk_highlights.includes("backend"));
});

test("applyExecuteOverlay animates BOTH runtimes running at once", () => {
  const room = makeRoomState();
  applyExecuteOverlay(room, {
    runningTasks: [runningTask("claude-code"), runningTask("codex")]
  });

  const ui = room.agents.find((a) => a.id === "ui");
  const api = room.agents.find((a) => a.id === "api");
  assert.equal(ui.activity, "coding");
  assert.equal(api.activity, "coding");
  assert.ok(room.scene.desk_highlights.includes("frontend"));
  assert.ok(room.scene.desk_highlights.includes("backend"));
});

test("applyExecuteOverlay lifts the room out of standby + cooldown + rest", () => {
  const room = makeRoomState();
  applyExecuteOverlay(room, { runningTasks: [runningTask("claude-code")] });

  assert.equal(room.room.phase, "execution");
  assert.equal(room.room.resting, false);
  assert.equal(room.room.substate, null);
  assert.equal(room.scene.tone, "busy");
  assert.equal(room.scene.resting, false);
  assert.equal(room.phase.mode, "execution");
  assert.match(room.room.phase_reason, /claude-code/);
});

test("applyExecuteOverlay wakes an idle lead to supervise", () => {
  const room = makeRoomState();
  applyExecuteOverlay(room, { runningTasks: [runningTask("codex")] });

  const lead = room.agents.find((a) => a.id === "lead");
  assert.equal(lead.activity, "reviewing");
  assert.equal(lead.idle_behavior, null);
});

test("applyExecuteOverlay maps an unknown runtime to the claude-code desk", () => {
  const room = makeRoomState();
  applyExecuteOverlay(room, { runningTasks: [runningTask("mystery-runtime")] });

  const ui = room.agents.find((a) => a.id === "ui");
  assert.equal(ui.activity, "coding");
  assert.equal(ui.assigned_zone, RUNTIME_VISUAL_MAP["claude-code"].zone);
});

test("applyExecuteOverlay does not downgrade an already-busy scene tone", () => {
  const room = makeRoomState({
    scene: { tone: "busy", resting: false, desk_highlights: ["backend"] }
  });
  applyExecuteOverlay(room, { runningTasks: [runningTask("codex")] });
  assert.equal(room.scene.tone, "busy");
});

// ─── buildExecuteSignals ──────────────────────────────────────────────────────

test("buildExecuteSignals returns empty signals when there is no activity", async () => {
  const signals = await buildExecuteSignals(1000, {
    readQueueImpl: async () => [],
    readNarrationImpl: async () => []
  });

  assert.deepEqual(signals.runningTasks, []);
  assert.deepEqual(signals.logs, []);
  assert.equal(signals.latestText, null);
  assert.equal(signals.latestTs, 0);
});

test("buildExecuteSignals turns a running task into a live signal", async () => {
  const now = 5000;
  const signals = await buildExecuteSignals(now, {
    readQueueImpl: async () => [
      runningTask("claude-code", { prompt: "restyle the metrics panel" }),
      { id: "done-1", status: "done", runtimeId: "codex" }
    ],
    readNarrationImpl: async () => []
  });

  assert.equal(signals.runningTasks.length, 1);
  assert.equal(signals.latestTs, now);
  assert.match(signals.latestText, /restyle the metrics panel/);
  assert.ok(signals.logs.some((log) => log.target === "execute:claude-code"));
});

test("buildExecuteSignals includes recent narration and drops stale entries", async () => {
  const now = 100_000;
  const fresh = { phase: "edit", text: "editing app.js", timestamp: new Date((now - 60) * 1000).toISOString() };
  const stale = {
    phase: "plan",
    text: "old plan",
    timestamp: new Date((now - EXECUTE_NARRATION_WINDOW_SECONDS - 120) * 1000).toISOString()
  };

  const signals = await buildExecuteSignals(now, {
    readQueueImpl: async () => [],
    readNarrationImpl: async () => [fresh, stale]
  });

  const messages = signals.logs.map((log) => log.message).join("\n");
  assert.match(messages, /editing app\.js/);
  assert.doesNotMatch(messages, /old plan/);
  assert.equal(signals.latestText, "editing app.js");
});

test("buildExecuteSignals survives a queue read failure", async () => {
  const signals = await buildExecuteSignals(1000, {
    readQueueImpl: async () => {
      throw new Error("no queue file");
    },
    readNarrationImpl: async () => []
  });

  assert.deepEqual(signals.runningTasks, []);
  assert.deepEqual(signals.logs, []);
});
