import test from "node:test";
import assert from "node:assert/strict";

import { ROOM_LAYOUT, createZonesFromLayout } from "../public/room-layout.js";

function cloneLayout(layout) {
  return JSON.parse(JSON.stringify(layout));
}

test("layout schema is the source of truth for zone coordinates and desk anchors", () => {
  const zones = createZonesFromLayout();
  const frontend = zones.find((zone) => zone.id === "frontend");

  assert.deepEqual(
    { x: frontend.x, y: frontend.y },
    ROOM_LAYOUT.zones.frontend.origin
  );
  assert.deepEqual(
    frontend.transitAnchor,
    ROOM_LAYOUT.zones.frontend.anchors.transit
  );
  assert.deepEqual(
    frontend.familyHub,
    ROOM_LAYOUT.zones.frontend.anchors.familyHub
  );
  assert.equal(
    frontend.seats.length,
    ROOM_LAYOUT.zones.frontend.seat_offsets.length
  );
});

test("createZonesFromLayout honors custom layout overrides instead of hardcoded coordinates", () => {
  const customLayout = cloneLayout(ROOM_LAYOUT);
  customLayout.zones.backend.origin = { x: 520, y: 154 };
  customLayout.zones.backend.label = { x: 448, y: 90, width: 90, height: 12 };
  customLayout.zones.backend.anchors.transit = { x: 436, y: 194 };
  customLayout.zones.backend.anchors.familyHub = { x: 326, y: 194 };
  customLayout.zones.backend.seat_offsets = [{ x: -10, y: 42 }];

  const zones = createZonesFromLayout(customLayout);
  const backend = zones.find((zone) => zone.id === "backend");

  assert.equal(backend.x, 520);
  assert.equal(backend.y, 154);
  assert.equal(backend.labelX, 448);
  assert.equal(backend.labelY, 90);
  assert.deepEqual(backend.transitAnchor, { x: 436, y: 194 });
  assert.deepEqual(backend.familyHub, { x: 326, y: 194 });
  assert.equal(backend.seats.length, 1);
  assert.deepEqual(backend.seats[0], {
    id: "backend_seat_0",
    x: 510,
    y: 196,
    facing: 1
  });
});

test("layout schema exposes furniture, props, and rest corner as data", () => {
  assert.ok(ROOM_LAYOUT.furniture.frontend.rects.length > 0);
  assert.ok(ROOM_LAYOUT.furniture.review.rects.length > 0);
  assert.ok(ROOM_LAYOUT.props.planning_board.rects.length > 0);
  assert.ok(ROOM_LAYOUT.props.status_monitor.rects.length > 0);
  assert.ok(ROOM_LAYOUT.rest_corner.rects.length > 0);
});
