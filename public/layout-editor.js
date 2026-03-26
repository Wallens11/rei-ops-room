import { ROOM_LAYOUT } from "./room-layout.js";

export const LAYOUT_STORAGE_KEY = "codex-pixel-agent-layout-v1";

function clone(value) {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value));
}

function ensureLayoutShape(layout) {
  if (
    !layout ||
    typeof layout !== "object" ||
    !layout.canvas ||
    !layout.hallway ||
    !layout.zones ||
    !layout.props ||
    !layout.rest_corner
  ) {
    throw new Error("Invalid room layout document");
  }

  return layout;
}

function shiftPoint(point, delta) {
  return {
    ...point,
    x: point.x + delta.x,
    y: point.y + delta.y
  };
}

export function createEditableLayout(baseLayout = ROOM_LAYOUT) {
  return clone(baseLayout);
}

export function collectEditableLayoutEntities(layout = ROOM_LAYOUT) {
  const zoneEntities = Object.values(layout.zones).map((zone) => ({
    id: `zone:${zone.id}`,
    kind: "zone",
    title: zone.title,
    x: zone.origin.x,
    y: zone.origin.y
  }));

  const propEntities = Object.values(layout.props).map((prop) => ({
    id: `prop:${prop.id}`,
    kind: "prop",
    title: prop.id.replaceAll("_", " "),
    x: prop.origin.x,
    y: prop.origin.y
  }));

  return [
    ...zoneEntities,
    ...propEntities,
    {
      id: "rest:rest_corner",
      kind: "rest",
      title: layout.rest_corner.title,
      x: layout.rest_corner.origin.x,
      y: layout.rest_corner.origin.y
    }
  ];
}

export function nudgeLayoutEntity(layout, entityId, delta) {
  const next = createEditableLayout(layout);

  if (entityId.startsWith("zone:")) {
    const zoneId = entityId.slice("zone:".length);
    const zone = ensureLayoutShape(next).zones[zoneId];

    if (!zone) {
      return next;
    }

    zone.origin = shiftPoint(zone.origin, delta);
    zone.label = {
      ...zone.label,
      x: zone.label.x + delta.x,
      y: zone.label.y + delta.y
    };
    zone.anchors = {
      transit: shiftPoint(zone.anchors.transit, delta),
      familyHub: shiftPoint(zone.anchors.familyHub, delta)
    };

    return next;
  }

  if (entityId.startsWith("prop:")) {
    const propId = entityId.slice("prop:".length);
    const prop = ensureLayoutShape(next).props[propId];

    if (!prop) {
      return next;
    }

    prop.origin = shiftPoint(prop.origin, delta);
    return next;
  }

  if (entityId === "rest:rest_corner") {
    next.rest_corner = {
      ...next.rest_corner,
      origin: shiftPoint(next.rest_corner.origin, delta)
    };
  }

  return next;
}

export function serializeLayoutDocument(layout) {
  return JSON.stringify(layout, null, 2);
}

export function parseLayoutDocument(text) {
  return ensureLayoutShape(JSON.parse(text));
}
