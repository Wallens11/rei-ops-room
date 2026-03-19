import test from "node:test";
import assert from "node:assert/strict";

import {
  buildSceneHotspots,
  describeSceneSelection,
  findSceneHotspotAt
} from "../public/scene-details.js";

test("findSceneHotspotAt resolves agent, desk, and event hotspots in priority order", () => {
  const hotspots = buildSceneHotspots({
    agents: [
      {
        id: "lead",
        label: "Lead Rei",
        kind: "agent",
        x: 320,
        y: 220,
        width: 28,
        height: 42
      }
    ],
    desks: [
      {
        id: "backend",
        label: "Backend Rack",
        kind: "desk",
        x: 472,
        y: 116,
        width: 96,
        height: 72
      }
    ],
    events: [
      {
        id: "event_backend",
        label: "runtime sync",
        kind: "event",
        x: 436,
        y: 78,
        width: 84,
        height: 18
      }
    ]
  });

  assert.equal(findSceneHotspotAt(hotspots, 321, 221)?.id, "lead");
  assert.equal(findSceneHotspotAt(hotspots, 440, 80)?.id, "event_backend");
  assert.equal(findSceneHotspotAt(hotspots, 500, 130)?.id, "backend");
});

test("describeSceneSelection explains agents, desks, and event badges without noise", () => {
  const state = {
    scene: {
      active_zone: {
        title: "Backend Rack"
      },
      assignment_hint: {
        active: true,
        title: "Docs / Ops Corner"
      }
    },
    workstreams: [
      {
        id: "ws_main",
        owner: "api",
        zone: "backend",
        task: "Translate runtime signals into room state",
        status: "active"
      }
    ],
    agents: [
      {
        id: "api",
        display_name: "API Rei",
        activity: "idle",
        idle_behavior: "idle_observe",
        assigned_zone: "backend",
        assigned_workstream_ids: ["ws_main"]
      }
    ]
  };

  assert.match(
    describeSceneSelection(
      { id: "api", kind: "agent", zone: "backend", label: "API Rei" },
      state
    ).body,
    /idle_observe/i
  );

  assert.match(
    describeSceneSelection(
      { id: "backend", kind: "desk", zone: "backend", label: "Backend Rack" },
      state
    ).body,
    /Translate runtime signals/i
  );

  assert.match(
    describeSceneSelection(
      { id: "event_backend", kind: "event", label: "runtime sync" },
      state
    ).body,
    /Backend Rack/i
  );
});
