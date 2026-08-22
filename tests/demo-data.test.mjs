import test from "node:test";
import assert from "node:assert/strict";

import { buildDemoRoomStatus } from "../tools/demo-data.mjs";

test("demo status uses the workspace dock contract", () => {
  const status = buildDemoRoomStatus();

  assert.equal(status.demo, true);
  assert.equal(status.workspace.active_room.repo, "demo-user/my-app");
  assert.equal(status.workspace.active_room.status, "active");
  assert.equal(status.workspace.active_room.active_lane_count, 3);
  assert.equal(status.room.mode, "multi");
  assert.equal(status.orchestration.mode, "multi");
  assert.ok(Array.isArray(status.workspace.sleeping_rooms));
  assert.equal(status.agents.length, 6);
  assert.deepEqual(status.agents.map((agent) => agent.id), [
    "lead",
    "ui",
    "api",
    "db",
    "docs",
    "scout"
  ]);
  assert.ok(new Set(status.agents.map((agent) => agent.activity)).size >= 3);
  assert.deepEqual(status.agents.map((agent) => agent.visual_role), [
    "coordinator",
    "worker",
    "worker",
    "worker",
    "worker",
    "courier"
  ]);
  assert.ok(status.workstreams.length >= 3);
  const workstreamIds = new Set(status.workstreams.map((workstream) => workstream.id));
  status.agents.forEach((agent) => {
    agent.assigned_workstream_ids.forEach((id) => {
      assert.ok(workstreamIds.has(id), `Expected demo workstream ${id} to exist`);
    });
  });
});
