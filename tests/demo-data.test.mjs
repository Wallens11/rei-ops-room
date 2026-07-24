import test from "node:test";
import assert from "node:assert/strict";

import { buildDemoRoomStatus } from "../tools/demo-data.mjs";

test("demo status uses the workspace dock contract", () => {
  const status = buildDemoRoomStatus();

  assert.equal(status.demo, true);
  assert.equal(status.workspace.active_room.repo, "demo-user/my-app");
  assert.equal(status.workspace.active_room.status, "active");
  assert.ok(Array.isArray(status.workspace.sleeping_rooms));
});
