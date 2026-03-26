import test from "node:test";
import assert from "node:assert/strict";

import { ROOM_LAYOUT } from "../public/room-layout.js";
import {
  collectEditableLayoutEntities,
  nudgeLayoutEntity,
  parseLayoutDocument,
  serializeLayoutDocument
} from "../public/layout-editor.js";

test("nudgeLayoutEntity moves zone origins, labels, and anchors without mutating the base layout", () => {
  const moved = nudgeLayoutEntity(ROOM_LAYOUT, "zone:frontend", { x: 8, y: 12 });

  assert.notEqual(moved, ROOM_LAYOUT);
  assert.deepEqual(ROOM_LAYOUT.zones.frontend.origin, { x: 132, y: 136 });
  assert.deepEqual(moved.zones.frontend.origin, { x: 140, y: 148 });
  assert.deepEqual(moved.zones.frontend.label, { x: 90, y: 90, width: 84, height: 12 });
  assert.deepEqual(moved.zones.frontend.anchors.transit, { x: 222, y: 198 });
  assert.deepEqual(moved.zones.frontend.anchors.familyHub, { x: 330, y: 198 });
  assert.deepEqual(moved.zones.frontend.hotspot, ROOM_LAYOUT.zones.frontend.hotspot);
  assert.deepEqual(moved.zones.frontend.seat_offsets, ROOM_LAYOUT.zones.frontend.seat_offsets);
});

test("nudgeLayoutEntity also moves props and the rest corner through the same editor API", () => {
  const propMoved = nudgeLayoutEntity(ROOM_LAYOUT, "prop:planning_board", { x: -12, y: 6 });
  const restMoved = nudgeLayoutEntity(propMoved, "rest:rest_corner", { x: 20, y: -10 });

  assert.deepEqual(propMoved.props.planning_board.origin, { x: 256, y: 50 });
  assert.deepEqual(restMoved.rest_corner.origin, { x: 342, y: 102 });
  assert.deepEqual(restMoved.rest_corner.hotspot, ROOM_LAYOUT.rest_corner.hotspot);
});

test("layout editor document exports, parses, and enumerates editable entities", () => {
  const layout = nudgeLayoutEntity(ROOM_LAYOUT, "zone:review", { x: -16, y: 8 });
  const documentText = serializeLayoutDocument(layout);
  const parsed = parseLayoutDocument(documentText);
  const entities = collectEditableLayoutEntities(parsed);

  assert.deepEqual(parsed.zones.review.origin, { x: 472, y: 300 });
  assert.ok(entities.some((entity) => entity.id === "zone:review" && entity.kind === "zone"));
  assert.ok(
    entities.some((entity) => entity.id === "prop:planning_board" && entity.kind === "prop")
  );
  assert.ok(entities.some((entity) => entity.id === "rest:rest_corner" && entity.kind === "rest"));
});
