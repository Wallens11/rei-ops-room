import test from "node:test";
import assert from "node:assert/strict";

import {
  RUNTIME_EVENT_TTL_MS,
  buildRuntimeEventSnapshot,
  reduceRuntimeEventState
} from "../public/runtime-events.js";

test("runtime events create a short-lived bubble and a smaller persistent desk badge", () => {
  const snapshot = buildRuntimeEventSnapshot({
    generatedAt: "2026-03-17T14:14:29.597Z",
    room: {
      phase: "execution",
      focus_zone: "backend",
      resting: false
    },
    activity: {
      summary: 'spawn_child_async: "C:\\\\Windows\\\\System32\\\\WindowsPowerShell\\\\v1.0\\\\powershell.exe"',
      source: "codex_core::spawn"
    }
  });

  assert.equal(snapshot.eventType, "process_spawn");
  assert.equal(snapshot.zone, "backend");
  assert.equal(snapshot.persistentBadge, true);
  assert.match(snapshot.label, /spawn/i);

  const initial = reduceRuntimeEventState(
    {
      lastEventId: null,
      bubble: null,
      badge: null
    },
    snapshot,
    1000
  );

  assert.equal(initial.bubble?.eventType, "process_spawn");
  assert.equal(initial.badge?.label, snapshot.label);

  const settled = reduceRuntimeEventState(initial, snapshot, 1000 + RUNTIME_EVENT_TTL_MS + 50);
  assert.equal(settled.bubble, null);
  assert.equal(settled.badge?.label, snapshot.label);
});

test("standby rest snapshots do not generate sticky technical bubbles", () => {
  const snapshot = buildRuntimeEventSnapshot({
    generatedAt: "2026-03-17T14:14:29.597Z",
    room: {
      phase: "standby",
      focus_zone: "lab",
      resting: true
    },
    activity: {
      summary: "Istirahat sejenak",
      source: "presence"
    }
  });

  assert.equal(snapshot, null);
});

test("cooldown snapshots do not keep active runtime bubbles alive", () => {
  const snapshot = buildRuntimeEventSnapshot({
    generatedAt: "2026-03-17T14:14:29.597Z",
    room: {
      phase: "review_wrap",
      focus_zone: "backend",
      resting: false,
      substate: "cooldown"
    },
    activity: {
      summary: 'spawn_child_async: "C:\\\\Windows\\\\System32\\\\WindowsPowerShell\\\\v1.0\\\\powershell.exe"',
      source: "codex_core::spawn"
    }
  });

  assert.equal(snapshot, null);
});
