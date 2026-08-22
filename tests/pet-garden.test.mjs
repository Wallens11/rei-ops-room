import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

import {
  PET_ATLAS,
  petAgentStatusLabel,
  petFrameAt,
  petGardenActiveStatus,
  petGardenAgentStates,
  petGardenRenderActors,
  petLabelBox,
  petOverlayAgents,
  petOverlayModeForWidth,
  petRoamingState,
  petSpotlightAgent,
  petSpawnLabelOffset,
  petStatusLabel,
  petVisualState,
  resolvePetAnimation,
  shouldLoadPetSprite
} from "../public/pet-garden.js";
import * as petGarden from "../public/pet-garden.js";

test("pet animation maps runtime activity to readable Codex pet states", () => {
  assert.deepEqual(resolvePetAnimation({ activity: "idle" }), {
    state: "idle",
    row: 0,
    frames: 6,
    holdFrames: 4
  });
  assert.equal(resolvePetAnimation({ activity: "coding" }).state, "running");
  assert.equal(resolvePetAnimation({ activity: "debugging" }).row, 7);
  assert.equal(resolvePetAnimation({ activity: "waiting" }).row, 6);
  assert.equal(resolvePetAnimation({ activity: "reviewing" }).row, 8);
  assert.equal(resolvePetAnimation({ activity: "failed" }).row, 5);
  assert.equal(resolvePetAnimation({ activity: "failed", moving: true }).row, 5);
});

test("moving pets use the matching left or right locomotion row", () => {
  assert.deepEqual(resolvePetAnimation({ activity: "moving", moving: true, facing: 1 }), {
    state: "running-right",
    row: 1,
    frames: 8,
    holdFrames: 1
  });
  assert.equal(
    resolvePetAnimation({ activity: "moving", moving: true, facing: -1 }).state,
    "running-left"
  );
  assert.equal(resolvePetAnimation({ activity: "moving", moving: true, facing: -1 }).row, 2);
});

test("pet reactions use the dedicated wave and startled atlas rows", () => {
  assert.deepEqual(resolvePetAnimation({ activity: "waving" }), {
    state: "waving",
    row: 3,
    frames: 4,
    holdFrames: 3
  });
  assert.deepEqual(resolvePetAnimation({ activity: "jumping" }), {
    state: "jumping",
    row: 4,
    frames: 5,
    holdFrames: 2
  });
});

test("pet labels reserve measured text padding and stay inside the viewport", () => {
  assert.deepEqual(
    petLabelBox({
      textWidth: 190,
      preferredX: 150,
      viewportWidth: 300,
      minWidth: 72,
      maxWidth: 260,
      padding: 24,
      margin: 12
    }),
    { width: 214, centerX: 150, maxTextWidth: 190 }
  );

  assert.deepEqual(
    petLabelBox({
      textWidth: 190,
      preferredX: 298,
      viewportWidth: 300,
      minWidth: 72,
      maxWidth: 260,
      padding: 24,
      margin: 12
    }),
    { width: 214, centerX: 181, maxTextWidth: 190 }
  );
});

test("spawning pets use temporary label lanes to avoid stacked text", () => {
  assert.equal(petSpawnLabelOffset({ entering: true, index: 0 }), 0);
  assert.equal(petSpawnLabelOffset({ entering: true, index: 1 }), 14);
  assert.equal(petSpawnLabelOffset({ entering: true, index: 2 }), 28);
  assert.equal(petSpawnLabelOffset({ entering: false, index: 2 }), 0);
});

test("initially synced pets skip the decorative door-entry animation", () => {
  assert.equal(typeof petGarden.petSpawnState, "function");
  assert.deepEqual(
    petGarden.petSpawnState({ frame: 20, index: 2, staggerFrames: 7 }),
    {
      releaseFrame: 34,
      entering: true,
      burstDone: false,
      labelIndex: 2
    }
  );
  assert.deepEqual(
    petGarden.petSpawnState({ frame: 20, index: 2, staggerFrames: 7, synced: true }),
    {
      releaseFrame: 20,
      entering: false,
      burstDone: true,
      labelIndex: 2
    }
  );
});

test("pet frames animate independently and stop under reduced motion", () => {
  const lead = petFrameAt({ activity: "coding", frame: 12, actorId: "lead" });
  const api = petFrameAt({ activity: "coding", frame: 12, actorId: "api" });
  const reduced = petFrameAt({
    activity: "coding",
    frame: 12,
    actorId: "api",
    reducedMotion: true
  });

  assert.equal(lead.row, 7);
  assert.notEqual(lead.column, api.column);
  assert.equal(reduced.column, 0);
});

test("settled work pets follow the room micro-pose loop", () => {
  assert.equal(resolvePetAnimation({ activity: "coding", pose: "type" }).row, 7);
  assert.equal(resolvePetAnimation({ activity: "coding", pose: "sit" }).row, 0);
  assert.equal(resolvePetAnimation({ activity: "coding", pose: "read" }).row, 8);
  assert.equal(resolvePetAnimation({ activity: "reviewing", pose: "sit" }).row, 0);
  assert.equal(resolvePetAnimation({ activity: "reviewing", pose: "read" }).row, 8);
});

test("failure and movement stay truthful over decorative work poses", () => {
  assert.equal(resolvePetAnimation({ activity: "failed", pose: "read" }).row, 5);
  assert.equal(
    resolvePetAnimation({ activity: "coding", moving: true, facing: -1, pose: "read" }).row,
    2
  );
});

test("desktop overlay choreography exposes the full settled work loop", () => {
  assert.equal(typeof petGarden.petWorkPoseAt, "function");

  const codingPoses = new Set(
    Array.from({ length: 72 }, (_, frame) =>
      petGarden.petWorkPoseAt({ activity: "coding", frame, actorId: "ui" })
    )
  );
  const reviewPoses = new Set(
    Array.from({ length: 72 }, (_, frame) =>
      petGarden.petWorkPoseAt({ activity: "reviewing", frame, actorId: "docs" })
    )
  );

  assert.deepEqual([...codingPoses].sort(), ["read", "sit", "type"]);
  assert.deepEqual([...reviewPoses].sort(), ["read", "sit"]);
  assert.equal(
    petGarden.petWorkPoseAt({ activity: "coding", frame: 31, actorId: "api" }),
    petGarden.petWorkPoseAt({ activity: "coding", frame: 31, actorId: "api" })
  );
  assert.equal(petGarden.petWorkPoseAt({ activity: "waiting", frame: 31 }), null);
});

test("desktop work poses resolve to recognizable props", () => {
  assert.equal(petGarden.petWorkPropForPose("type"), "laptop");
  assert.equal(petGarden.petWorkPropForPose("sit"), "coffee");
  assert.equal(petGarden.petWorkPropForPose("read"), "book");
  assert.equal(petGarden.petWorkPropForPose("walk"), null);
});

test("desktop overlay defaults to a compact spotlight and prioritizes runtime urgency", () => {
  assert.equal(petOverlayModeForWidth(300), "compact");
  assert.equal(petOverlayModeForWidth(519), "compact");
  assert.equal(petOverlayModeForWidth(520), "squad");

  const agents = [
    { id: "lead", activity: "waiting" },
    { id: "ui", activity: "coding" },
    { id: "api", activity: "failed" }
  ];

  assert.equal(petSpotlightAgent(agents)?.id, "api");
  assert.equal(petSpotlightAgent(agents.slice(0, 2))?.id, "ui");
  assert.equal(
    petSpotlightAgent([
      { id: "lead", activity: "waiting" },
      { id: "scout", activity: "idle" }
    ])?.id,
    "lead"
  );
  assert.equal(petSpotlightAgent([]), null);
});

test("desktop roaming uses walking direction only in compact motion-enabled mode", () => {
  assert.deepEqual(petRoamingState({ enabled: true, direction: -4 }), {
    active: true,
    facing: -1
  });
  assert.deepEqual(petRoamingState({ enabled: true, direction: 0 }), {
    active: true,
    facing: 1
  });
  assert.deepEqual(petRoamingState({ enabled: true, expanded: true, direction: 1 }), {
    active: false,
    facing: 1
  });
  assert.deepEqual(petRoamingState({ enabled: true, reducedMotion: true, direction: -1 }), {
    active: false,
    facing: -1
  });
  assert.deepEqual(petRoamingState({ enabled: false, direction: -1 }), {
    active: false,
    facing: -1
  });
});

test("native ambient roaming is limited to one idle pet", () => {
  assert.equal(typeof petGarden.petAmbientRoamingAllowed, "function");
  assert.equal(petGarden.petAmbientRoamingAllowed([{ id: "lead", activity: "idle" }]), true);
  assert.equal(petGarden.petAmbientRoamingAllowed([{ id: "lead", activity: "waiting" }]), true);
  assert.equal(petGarden.petAmbientRoamingAllowed([{ id: "lead", activity: "running" }]), false);
  assert.equal(petGarden.petAmbientRoamingAllowed([{ id: "lead", activity: "reading" }]), false);
  assert.equal(
    petGarden.petAmbientRoamingAllowed([
      { id: "lead", activity: "idle" },
      { id: "api", activity: "idle" }
    ]),
    false
  );
});

test("pet visual reactions temporarily outrank travel and settled work", () => {
  assert.deepEqual(
    petVisualState({ activity: "coding", roaming: true, reaction: "wave" }),
    { activity: "waving", moving: false }
  );
  assert.deepEqual(
    petVisualState({ activity: "coding", roaming: true, reaction: "startled" }),
    { activity: "jumping", moving: false }
  );
  assert.deepEqual(
    petVisualState({ activity: "coding", roaming: true }),
    { activity: "coding", moving: true }
  );
  assert.deepEqual(
    petVisualState({ activity: "coding", roaming: false }),
    { activity: "coding", moving: false }
  );
});

test("solo thread activity is labeled as Reiko instead of a synthetic API worker", () => {
  const agents = petOverlayAgents({
    status: "busy",
    room: { phase: "execution" },
    taskIntelligence: { signals: { agent_jobs: { items: [] } } },
    agents: [
      { id: "lead", display_name: "Lead Rei", activity: "reading", assigned_workstream_ids: [] },
      { id: "api", display_name: "API Rei", activity: "coding", assigned_workstream_ids: ["ws_main"] }
    ]
  });

  assert.equal(agents.length, 1);
  assert.equal(agents[0].id, "lead");
  assert.equal(agents[0].role_label, "Reiko");
  assert.equal(agents[0].status_label, "handling this chat");
  assert.equal(agents[0].activity, "running");
  assert.equal(petAgentStatusLabel(agents[0]), "handling this chat");
});

test("overlay roster stays safe before the first status payload arrives", () => {
  const agents = petOverlayAgents(null, []);

  assert.equal(agents.length, 1);
  assert.equal(agents[0].id, "lead");
  assert.equal(agents[0].status_label, "idle");
});

test("specialist roles appear only when backed by real agent jobs", () => {
  const agents = petOverlayAgents({
    status: "busy",
    room: { phase: "squad_split" },
    taskIntelligence: {
      signals: {
        agent_jobs: {
          items: [
            { id: "job_api", owner: "api", status: "active" },
            { id: "job_old", owner: "docs", status: "stale" }
          ]
        }
      }
    },
    agents: [
      { id: "lead", display_name: "Lead Rei", activity: "reading", assigned_workstream_ids: [] },
      { id: "api", display_name: "API Rei", activity: "coding", assigned_workstream_ids: ["ws_main", "job_api"] },
      { id: "docs", display_name: "Docs Rei", activity: "reviewing", assigned_workstream_ids: ["job_old"] },
      { id: "ui", display_name: "UI Rei", activity: "coding", assigned_workstream_ids: ["ws_main"] }
    ]
  });

  assert.deepEqual(agents.map((agent) => agent.id), ["lead", "api"]);
  assert.equal(agents[0].status_label, "coordinating");
  assert.equal(agents[1].role_label, "API");
  assert.equal(petAgentStatusLabel(agents[1]), "working");
});

test("coordinating Reiko stays in a work pose while specialists execute", () => {
  const agents = petOverlayAgents({
    status: "busy",
    room: { phase: "squad_split" },
    taskIntelligence: {
      signals: {
        agent_jobs: {
          items: [{ id: "job_api", owner: "api", status: "active" }]
        }
      }
    },
    agents: [
      { id: "lead", activity: "moving", assigned_zone: "lab", assigned_workstream_ids: [] },
      {
        id: "api",
        activity: "coding",
        assigned_zone: "backend",
        assigned_workstream_ids: ["job_api"]
      }
    ]
  });

  assert.equal(agents[0].id, "lead");
  assert.equal(agents[0].status_label, "coordinating");
  assert.equal(agents[0].activity, "reading");
});

test("lead-owned child jobs receive distinct neutral pet slots instead of collapsing into Reiko", () => {
  const agents = petOverlayAgents({
    status: "busy",
    room: { phase: "squad_split" },
    taskIntelligence: {
      signals: {
        agent_jobs: {
          items: [
            { id: "job_review", owner: "lead", zone: "lab", status: "active" },
            { id: "job_docs", owner: "lead", zone: "review", status: "active" }
          ]
        }
      }
    },
    agents: [
      { id: "lead", activity: "moving", assigned_workstream_ids: ["job_review", "job_docs"] },
      { id: "ui", activity: "idle", assigned_zone: "frontend", assigned_workstream_ids: [] },
      { id: "api", activity: "idle", assigned_zone: "backend", assigned_workstream_ids: [] }
    ]
  });

  assert.deepEqual(agents.map((agent) => agent.id), ["lead", "ui", "api"]);
  assert.deepEqual(agents.map((agent) => agent.role_label), ["Reiko", "Agent 1", "Agent 2"]);
  assert.deepEqual(agents.slice(1).map((agent) => agent.job_id), ["job_review", "job_docs"]);
  assert.deepEqual(agents.slice(1).map((agent) => agent.activity), ["running", "running"]);
  assert.deepEqual(agents.slice(1).map((agent) => agent.assigned_zone), ["frontend", "backend"]);
});

test("Agent Garden renders only the runtime-backed roster while pixel mode keeps the full crew", () => {
  const actors = [
    { id: "lead" },
    { id: "ui" },
    { id: "api" }
  ];
  const soloRoster = [{ id: "lead" }];

  assert.deepEqual(
    petGardenRenderActors({ actors, agents: soloRoster, enabled: true }).map((actor) => actor.id),
    ["lead"]
  );
  assert.deepEqual(
    petGardenRenderActors({ actors, agents: soloRoster, enabled: false }).map((actor) => actor.id),
    ["lead", "ui", "api"]
  );
  assert.equal(
    petGardenAgentStates({
      runtimeAgents: actors,
      gardenAgents: soloRoster,
      enabled: false
    }),
    actors
  );
  assert.equal(
    petGardenAgentStates({
      runtimeAgents: actors,
      gardenAgents: soloRoster,
      enabled: true
    }),
    soloRoster
  );
});

test("Agent Garden status distinguishes simulated demo agents from live jobs", () => {
  assert.equal(
    petGardenActiveStatus([{ id: "lead", status_label: "handling this chat" }]),
    "Agent Garden active. Solo mode: Reiko is handling this chat; no sub-agents are running."
  );
  assert.equal(
    petGardenActiveStatus([{ id: "lead" }, { id: "api" }], { demo: true }),
    "Agent Garden active. 2 simulated Safe Demo agents are shown."
  );
  assert.equal(
    petGardenActiveStatus([{ id: "lead" }, { id: "api" }]),
    "Agent Garden active. Multi-agent mode: Reiko plus 1 task agent is shown from runtime jobs."
  );
});

test("pet labels preserve task state while the actor is walking", () => {
  assert.equal(petStatusLabel("coding", "running-right"), "working");
  assert.equal(petStatusLabel("reviewing", "running-left"), "review");
  assert.equal(petStatusLabel("failed", "idle"), "failed");
  assert.equal(petStatusLabel("error", "idle"), "error");
  assert.equal(petStatusLabel("blocked", "idle"), "blocked");
  assert.equal(petStatusLabel("idle", "running-right"), "moving");
});

test("the optional pet atlas loads only when Agent Garden is requested", () => {
  assert.equal(shouldLoadPetSprite({ enabled: false }), false);
  assert.equal(shouldLoadPetSprite({ enabled: true }), true);
  assert.equal(shouldLoadPetSprite({ enabled: true, started: true }), false);
  assert.equal(shouldLoadPetSprite({ enabled: true, ready: true }), false);
  assert.equal(shouldLoadPetSprite({ enabled: true, failed: true }), false);
});

test("Agent Garden uses the accepted v2 Reiko atlas", async () => {
  const assetUrl = new URL("../public/pets/reiko/spritesheet.webp", import.meta.url);
  const manifestUrl = new URL("../public/pets/reiko/pet.json", import.meta.url);
  const [asset, manifestText] = await Promise.all([
    fs.readFile(assetUrl).catch(() => null),
    fs.readFile(manifestUrl, "utf8").catch(() => null)
  ]);

  assert.ok(asset, "Expected the packaged Reiko spritesheet to exist");
  assert.ok(manifestText, "Expected the packaged Reiko pet.json to exist");
  assert.equal(asset.subarray(0, 4).toString("ascii"), "RIFF");
  assert.equal(asset.subarray(8, 12).toString("ascii"), "WEBP");
  assert.deepEqual(JSON.parse(manifestText), {
    id: "reiko",
    displayName: "Reiko",
    description: "A calm, playful tanuki copilot who turns Raffi's complex ideas into practical next steps.",
    spriteVersionNumber: 2,
    spritesheetPath: "spritesheet.webp"
  });
  assert.deepEqual(PET_ATLAS, {
    columns: 8,
    rows: 11,
    cellWidth: 192,
    cellHeight: 208
  });
});
