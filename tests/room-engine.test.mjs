import test from "node:test";
import assert from "node:assert/strict";

import {
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
