import test from "node:test";
import assert from "node:assert/strict";

import {
  REST_CORNER,
  buildCrewActors,
  createDefaultZones,
  stepCrewActors
} from "../public/room-engine.js";

function buildAgentState(overrides = {}) {
  const defaults = [
    {
      id: "lead",
      display_name: "Lead Rei",
      assigned_zone: "lab",
      activity: "reading"
    },
    {
      id: "ui",
      display_name: "UI Rei",
      assigned_zone: "frontend",
      activity: "waiting"
    },
    {
      id: "api",
      display_name: "API Rei",
      assigned_zone: "backend",
      activity: "waiting"
    },
    {
      id: "db",
      display_name: "DB Rei",
      assigned_zone: "database",
      activity: "waiting"
    },
    {
      id: "docs",
      display_name: "Docs Rei",
      assigned_zone: "review",
      activity: "waiting"
    },
    {
      id: "scout",
      display_name: "Scout Rei",
      assigned_zone: "lab",
      activity: "waiting"
    }
  ];

  return defaults.map((agent) => ({
    ...agent,
    ...(overrides[agent.id] || {})
  }));
}

test("meeting phase gathers the squad around the lab table", () => {
  const zones = createDefaultZones();
  let actors = buildCrewActors(zones);
  const lab = zones.find((zone) => zone.id === "lab");

  for (let frame = 1; frame <= 80; frame += 1) {
    actors = stepCrewActors(actors, {
      frame,
      status: "busy",
      focusZone: "lab",
      roomPhase: "planning_huddle",
      agents: buildAgentState({
        lead: { activity: "gathering" },
        ui: { activity: "gathering" },
        api: { activity: "gathering" },
        db: { activity: "gathering" },
        docs: { activity: "gathering" }
      }),
      zones
    });
  }

  for (const actor of actors) {
    const distance = Math.hypot(actor.x - lab.x, actor.y - lab.y);
    assert.ok(distance < 72, `${actor.id} did not join the meeting: ${distance}`);
  }
});

test("working phase keeps focused actor close to the assigned desk", () => {
  const zones = createDefaultZones();
  let actors = buildCrewActors(zones);
  const dbZone = zones.find((zone) => zone.id === "database");

  for (let frame = 1; frame <= 90; frame += 1) {
    actors = stepCrewActors(actors, {
      frame,
      status: "busy",
      focusZone: "database",
      roomPhase: "execution",
      agents: buildAgentState({
        db: { activity: "coding", assigned_zone: "database" }
      }),
      zones
    });
  }

  const dbActor = actors.find((actor) => actor.id === "db");
  const distance = Math.hypot(dbActor.x - dbZone.x, dbActor.y - dbZone.y);
  assert.ok(distance < 54, `database actor is not settled at the desk: ${distance}`);
});

test("scout stays near the lab when there is no handoff event", () => {
  const zones = createDefaultZones();
  let actors = buildCrewActors(zones);
  const lab = zones.find((zone) => zone.id === "lab");

  for (let frame = 1; frame <= 90; frame += 1) {
    actors = stepCrewActors(actors, {
      frame,
      status: "busy",
      focusZone: "backend",
      roomPhase: "execution",
      agents: buildAgentState({
        api: { activity: "coding", assigned_zone: "backend" },
        scout: { activity: "waiting", assigned_zone: "lab" }
      }),
      scene: {
        scout: {
          active: false
        }
      },
      zones
    });
  }

  const scout = actors.find((actor) => actor.id === "scout");
  const distance = Math.hypot(scout.x - lab.x, scout.y - lab.y);
  assert.ok(distance < 52, `scout drifted away from lab without a handoff: ${distance}`);
});

test("scout moves toward the target desk during a handoff", () => {
  const zones = createDefaultZones();
  let actors = buildCrewActors(zones);
  const review = zones.find((zone) => zone.id === "review");
  const lab = zones.find((zone) => zone.id === "lab");

  for (let frame = 1; frame <= 100; frame += 1) {
    actors = stepCrewActors(actors, {
      frame,
      status: "busy",
      focusZone: "review",
      roomPhase: "review_wrap",
      agents: buildAgentState({
        docs: { activity: "reviewing", assigned_zone: "review" },
        scout: { activity: "moving", assigned_zone: "between_zones" }
      }),
      scene: {
        scout: {
          active: true,
          from_zone: "lab",
          to_zone: "review",
          payload: "review request",
          reason: "review_requested"
        }
      },
      zones
    });
  }

  const scout = actors.find((actor) => actor.id === "scout");
  const reviewDistance = Math.hypot(scout.x - review.x, scout.y - review.y);
  const labDistance = Math.hypot(scout.x - lab.x, scout.y - lab.y);
  assert.ok(
    reviewDistance < labDistance,
    `scout did not move toward the review desk: review=${reviewDistance} lab=${labDistance}`
  );
});

test("assigned workers settle at their desks instead of pacing during squad split", () => {
  const zones = createDefaultZones();
  let actors = buildCrewActors(zones);
  const backend = zones.find((zone) => zone.id === "backend");

  for (let frame = 1; frame <= 120; frame += 1) {
    actors = stepCrewActors(actors, {
      frame,
      status: "busy",
      focusZone: "backend",
      roomPhase: "squad_split",
      agents: buildAgentState({
        api: { activity: "coding", assigned_zone: "backend" },
        lead: { activity: "reading", assigned_zone: "lab" }
      }),
      scene: {
        scout: {
          active: false
        }
      },
      zones
    });
  }

  const apiActor = actors.find((actor) => actor.id === "api");
  const distance = Math.hypot(apiActor.x - backend.x, apiActor.y - backend.y);
  assert.ok(distance < 54, `backend worker did not settle at the desk: ${distance}`);
  assert.equal(apiActor.moving, false);
});

test("idle observers use a wider hallway loop during execution instead of desk-only pacing", () => {
  const zones = createDefaultZones();
  let actors = buildCrewActors(zones);
  const apiPositions = [];

  for (let frame = 1; frame <= 180; frame += 1) {
    actors = stepCrewActors(actors, {
      frame,
      status: "busy",
      focusZone: "frontend",
      roomPhase: "execution",
      agents: buildAgentState({
        api: { activity: "waiting", assigned_zone: "backend", idle_behavior: "idle_observe" },
        ui: { activity: "coding", assigned_zone: "frontend" }
      }),
      scene: {
        scout: {
          active: false
        }
      },
      zones
    });

    const apiActor = actors.find((actor) => actor.id === "api");
    apiPositions.push({ x: apiActor.x, y: apiActor.y });
  }

  const minX = Math.min(...apiPositions.map((point) => point.x));
  assert.ok(minX < 430, `api observer never left the backend desk loop: minX=${minX}`);
});

test("squad split to the database desk travels through the hallway spine before settling", () => {
  const zones = createDefaultZones();
  let actors = buildCrewActors(zones);
  const corridorHits = [];

  for (let frame = 1; frame <= 120; frame += 1) {
    actors = stepCrewActors(actors, {
      frame,
      status: "busy",
      focusZone: "database",
      roomPhase: "squad_split",
      agents: buildAgentState({
        db: { activity: "moving", assigned_zone: "database" },
        lead: { activity: "reading", assigned_zone: "lab" }
      }),
      scene: {
        scout: {
          active: false
        }
      },
      zones
    });

    const dbActor = actors.find((actor) => actor.id === "db");
    corridorHits.push(
      dbActor.x >= 300 && dbActor.x <= 340 && dbActor.y >= 236 && dbActor.y <= 260
    );
  }

  assert.ok(corridorHits.some(Boolean), "database dispatch never crossed the hallway spine");
});

test("resting standby sends only allowed agents into the rest corner", () => {
  const zones = createDefaultZones();
  let actors = buildCrewActors(zones);
  const lab = zones.find((zone) => zone.id === "lab");

  for (let frame = 1; frame <= 100; frame += 1) {
    actors = stepCrewActors(actors, {
      frame,
      status: "cooldown",
      focusZone: "lab",
      roomPhase: "standby",
      agents: buildAgentState({
        lead: { activity: "idle", assigned_zone: "lab" },
        ui: { activity: "idle", assigned_zone: "lab" },
        api: { activity: "idle", assigned_zone: "lab" },
        db: { activity: "idle", assigned_zone: "lab" },
        docs: { activity: "idle", assigned_zone: "lab" },
        scout: { activity: "idle", assigned_zone: "lab" }
      }),
      scene: {
        resting: true,
        rest_corner: {
          active: true,
          allowed_agent_ids: ["lead", "ui", "docs"]
        },
        scout: {
          active: false
        }
      },
      zones
    });
  }

  for (const actor of actors.filter((entry) => ["lead", "ui", "docs"].includes(entry.id))) {
    const distance = Math.hypot(actor.x - REST_CORNER.x, actor.y - REST_CORNER.y);
    assert.ok(distance < 88, `${actor.id} did not settle into the rest corner: ${distance}`);
  }

  for (const actor of actors.filter((entry) => !["lead", "ui", "docs"].includes(entry.id))) {
    const distance = Math.hypot(actor.x - lab.x, actor.y - lab.y);
    assert.ok(distance < 86, `${actor.id} drifted away from lab while rest corner was active: ${distance}`);
  }
});

test("standby keeps the lead settled at the lab instead of pacing", () => {
  const zones = createDefaultZones();
  let actors = buildCrewActors(zones);
  const lab = zones.find((zone) => zone.id === "lab");
  const leadSpot = lab.workSpot[0];

  for (let frame = 1; frame <= 120; frame += 1) {
    actors = stepCrewActors(actors, {
      frame,
      status: "idle",
      focusZone: "lab",
      roomPhase: "standby",
      agents: buildAgentState({
        lead: { activity: "idle", assigned_zone: "lab", idle_behavior: "idle_observe" },
        ui: { activity: "idle", assigned_zone: "frontend", idle_behavior: "idle_at_desk" },
        api: { activity: "idle", assigned_zone: "backend", idle_behavior: "idle_observe" },
        db: { activity: "idle", assigned_zone: "database", idle_behavior: "idle_observe" },
        docs: { activity: "idle", assigned_zone: "review", idle_behavior: "idle_at_desk" },
        scout: { activity: "idle", assigned_zone: "lab", idle_behavior: "idle_patrol" }
      }),
      scene: {
        resting: false,
        rest_corner: {
          active: false,
          allowed_agent_ids: []
        },
        scout: {
          active: false
        }
      },
      zones
    });
  }

  const lead = actors.find((actor) => actor.id === "lead");
  const distance = Math.hypot(lead.x - leadSpot.x, lead.y - leadSpot.y);
  assert.ok(distance < 12, `lead did not settle near the lab work spot: ${distance}`);
  assert.equal(lead.moving, false);
});

test("review regroup pulls finished workers back toward the lab instead of snapping idle", () => {
  const zones = createDefaultZones();
  let actors = buildCrewActors(zones);
  const lab = zones.find((zone) => zone.id === "lab");

  for (let frame = 1; frame <= 110; frame += 1) {
    actors = stepCrewActors(actors, {
      frame,
      status: "cooldown",
      focusZone: "review",
      roomPhase: "review_wrap",
      agents: buildAgentState({
        lead: { activity: "summarizing", assigned_zone: "lab" },
        ui: { activity: "gathering", assigned_zone: "lab" },
        api: { activity: "gathering", assigned_zone: "lab" },
        db: { activity: "gathering", assigned_zone: "lab" },
        docs: { activity: "reviewing", assigned_zone: "review" },
        scout: { activity: "waiting", assigned_zone: "lab" }
      }),
      scene: {
        review_stage: "regroup",
        scout: {
          active: false
        }
      },
      zones
    });
  }

  for (const actor of actors.filter((entry) => ["lead", "ui", "api", "db"].includes(entry.id))) {
    const distance = Math.hypot(actor.x - lab.x, actor.y - lab.y);
    assert.ok(distance < 84, `${actor.id} did not regroup near the lab: ${distance}`);
  }

  const docs = actors.find((actor) => actor.id === "docs");
  assert.equal(docs.currentZone, "review");
});

test("settled desk work exposes a seated typing pose instead of generic idle movement", () => {
  const zones = createDefaultZones();
  let actors = buildCrewActors(zones);

  for (let frame = 1; frame <= 120; frame += 1) {
    actors = stepCrewActors(actors, {
      frame,
      status: "busy",
      focusZone: "frontend",
      roomPhase: "execution",
      agents: buildAgentState({
        ui: { activity: "coding", assigned_zone: "frontend" },
        api: { activity: "debugging", assigned_zone: "backend" }
      }),
      scene: {
        scout: {
          active: false
        }
      },
      zones
    });
  }

  const ui = actors.find((actor) => actor.id === "ui");
  const api = actors.find((actor) => actor.id === "api");

  assert.equal(ui.motionState, "SEATED");
  assert.equal(ui.pose, "type");
  assert.equal(api.motionState, "SEATED");
  assert.equal(api.pose, "type");
});

test("idle observers transition through wander and return before settling back into their seat", () => {
  const zones = createDefaultZones();
  let actors = buildCrewActors(zones);
  const seenStates = new Set();
  const backend = zones.find((zone) => zone.id === "backend");
  const backendSeat = backend.workSpot[1];

  for (let frame = 1; frame <= 260; frame += 1) {
    actors = stepCrewActors(actors, {
      frame,
      status: "idle",
      focusZone: "frontend",
      roomPhase: "standby",
      agents: buildAgentState({
        api: { activity: "idle", assigned_zone: "backend", idle_behavior: "idle_observe" },
        ui: { activity: "idle", assigned_zone: "frontend", idle_behavior: "idle_at_desk" }
      }),
      scene: {
        resting: false,
        rest_corner: {
          active: false,
          allowed_agent_ids: []
        },
        scout: {
          active: false
        }
      },
      zones
    });

    const api = actors.find((actor) => actor.id === "api");
    seenStates.add(api.motionState);
  }

  const api = actors.find((actor) => actor.id === "api");
  const seatDistance = Math.hypot(api.x - backendSeat.x, api.y - backendSeat.y);

  assert.ok(seenStates.has("WANDER"), "observer never entered a wander loop");
  assert.ok(seenStates.has("RETURN"), "observer never transitioned back toward the seat");
  assert.equal(api.motionState, "SEATED");
  assert.equal(api.pose, "sit");
  assert.ok(seatDistance < 10, `observer did not settle back into the backend seat: ${seatDistance}`);
});

test("settled desk workers cycle through micro-behaviors instead of freezing on one seated pose", () => {
  const zones = createDefaultZones();
  let actors = buildCrewActors(zones);
  const uiPoses = new Set();

  for (let frame = 1; frame <= 180; frame += 1) {
    actors = stepCrewActors(actors, {
      frame,
      status: "busy",
      focusZone: "frontend",
      roomPhase: "execution",
      agents: buildAgentState({
        ui: { activity: "coding", assigned_zone: "frontend" }
      }),
      scene: {
        scout: {
          active: false
        }
      },
      zones
    });

    uiPoses.add(actors.find((actor) => actor.id === "ui")?.pose);
  }

  assert.ok(uiPoses.has("type"), "desk loop never typed");
  assert.ok(uiPoses.has("sit"), "desk loop never paused at screen");
  assert.ok(uiPoses.size >= 2, `desk loop stayed too static: ${[...uiPoses].join(",")}`);
});

test("scout lingers briefly at the handoff destination instead of snapping straight through", () => {
  const zones = createDefaultZones();
  let actors = buildCrewActors(zones);
  const lingerFrames = [];

  for (let frame = 1; frame <= 140; frame += 1) {
    actors = stepCrewActors(actors, {
      frame,
      status: "busy",
      focusZone: "review",
      roomPhase: "review_wrap",
      agents: buildAgentState({
        docs: { activity: "reviewing", assigned_zone: "review" },
        scout: { activity: "moving", assigned_zone: "between_zones" }
      }),
      scene: {
        scout: {
          active: true,
          from_zone: "lab",
          to_zone: "review",
          payload: "review request",
          reason: "review_requested"
        }
      },
      zones
    });

    const scout = actors.find((actor) => actor.id === "scout");
    if (scout.motionState === "HANDOFF") {
      lingerFrames.push(frame);
    }
  }

  assert.ok(lingerFrames.length > 0, "scout never lingered at the handoff destination");
});
