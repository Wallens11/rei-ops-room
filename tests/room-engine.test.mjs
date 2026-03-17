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
