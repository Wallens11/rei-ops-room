import { VISUAL_CAST } from "./room-schema.js";

export const DEFAULT_CREW = VISUAL_CAST.map((agent) => ({
  id: agent.id,
  name: agent.displayName,
  home: agent.homeZone
}));

export const REST_CORNER = {
  id: "rest_corner",
  title: "Recharge Nook",
  x: 322,
  y: 112
};

const SETTLED_ACTIVITIES = new Set([
  "reading",
  "coding",
  "debugging",
  "summarizing",
  "reviewing"
]);

const OBSERVATION_ACTIVITIES = new Set(["waiting", "idle"]);

const OBSERVE_ROUTE_HOLD_FRAMES = 18;
const OBSERVE_STANDBY_HOLD_FRAMES = 54;
const SCOUT_HANDOFF_LINGER_FRAMES = 18;

const BASE_ZONES = [
  {
    id: "frontend",
    title: "Frontend Desk",
    color: "#65e4ff",
    x: 132,
    y: 136,
    labelX: 82,
    labelY: 78,
    furniture: "frontend"
  },
  {
    id: "backend",
    title: "Backend Rack",
    color: "#7cffba",
    x: 498,
    y: 136,
    labelX: 432,
    labelY: 78,
    furniture: "backend"
  },
  {
    id: "database",
    title: "Database Vault",
    color: "#ffcc66",
    x: 156,
    y: 292,
    labelX: 78,
    labelY: 246,
    furniture: "database"
  },
  {
    id: "review",
    title: "Docs / Ops Corner",
    color: "#ff907c",
    x: 488,
    y: 292,
    labelX: 420,
    labelY: 246,
    furniture: "review"
  },
  {
    id: "lab",
    title: "General Lab",
    color: "#b8a2ff",
    x: 322,
    y: 216,
    labelX: 270,
    labelY: 182,
    furniture: "lab"
  }
];

const PATROL_OFFSETS = {
  frontend: [
    { x: -18, y: 40 },
    { x: 18, y: 40 },
    { x: 20, y: 18 },
    { x: -12, y: 18 }
  ],
  backend: [
    { x: -16, y: 38 },
    { x: 16, y: 38 },
    { x: 18, y: 18 },
    { x: -18, y: 16 }
  ],
  database: [
    { x: -16, y: 44 },
    { x: 16, y: 44 },
    { x: 22, y: 24 },
    { x: -18, y: 22 }
  ],
  review: [
    { x: -18, y: 42 },
    { x: 16, y: 42 },
    { x: 18, y: 22 },
    { x: -18, y: 20 }
  ],
  lab: [
    { x: -10, y: 42 },
    { x: 10, y: 42 },
    { x: 10, y: 18 },
    { x: -10, y: 18 }
  ]
};

const ACTIVE_PATROL_OFFSETS = {
  frontend: [
    { x: -26, y: 44 },
    { x: 22, y: 44 },
    { x: 26, y: 16 },
    { x: -18, y: 14 }
  ],
  backend: [
    { x: -24, y: 42 },
    { x: 20, y: 42 },
    { x: 20, y: 14 },
    { x: -24, y: 14 }
  ],
  database: [
    { x: -20, y: 48 },
    { x: 20, y: 48 },
    { x: 28, y: 20 },
    { x: -20, y: 16 }
  ],
  review: [
    { x: -22, y: 46 },
    { x: 18, y: 46 },
    { x: 22, y: 18 },
    { x: -22, y: 18 }
  ],
  lab: [
    { x: -12, y: 44 },
    { x: 12, y: 44 },
    { x: 12, y: 20 },
    { x: -12, y: 20 }
  ]
};

const WORK_SPOT_OFFSETS = {
  frontend: [
    { x: -6, y: 40 },
    { x: 6, y: 40 }
  ],
  backend: [
    { x: -6, y: 40 },
    { x: 6, y: 40 }
  ],
  database: [
    { x: -6, y: 48 },
    { x: 6, y: 48 }
  ],
  review: [
    { x: -6, y: 44 },
    { x: 6, y: 44 }
  ],
  lab: [
    { x: -8, y: 42 },
    { x: 8, y: 42 }
  ]
};

const MEETING_SPOT_OFFSETS = {
  lead: [{ x: 0, y: 54 }],
  ui: [{ x: -44, y: 42 }],
  api: [{ x: 44, y: 42 }],
  db: [{ x: -30, y: 62 }],
  docs: [{ x: 30, y: 62 }],
  scout: [{ x: 0, y: 68 }]
};
const REST_SPOT_OFFSETS = {
  lead: [{ x: -10, y: 18 }],
  ui: [{ x: -44, y: 26 }],
  api: [{ x: 46, y: 24 }],
  db: [{ x: -24, y: 44 }],
  docs: [{ x: 24, y: 42 }],
  scout: [{ x: 0, y: 52 }]
};

function samePoint(left, right) {
  return left && right && left.x === right.x && left.y === right.y;
}

function dedupePoints(points) {
  const deduped = [];

  for (const point of points.filter(Boolean)) {
    const previous = deduped[deduped.length - 1];
    if (samePoint(previous, point)) {
      continue;
    }

    deduped.push(point);
  }

  return deduped;
}

function hallwayCenter(zones) {
  const lab = zoneById(zones, "lab");
  return { x: lab.x, y: lab.y + 12 };
}

function familyHubForZone(zones, zoneId) {
  const center = hallwayCenter(zones);

  if (zoneId === "frontend" || zoneId === "backend") {
    return { x: center.x, y: 186 };
  }

  if (zoneId === "database" || zoneId === "review") {
    return { x: center.x, y: 248 };
  }

  return center;
}

function transitAnchorForZone(zones, zoneId) {
  const zone = zoneById(zones, zoneId);

  if (zoneId === "frontend") {
    return { x: zone.x + 82, y: 186 };
  }

  if (zoneId === "backend") {
    return { x: zone.x - 84, y: 186 };
  }

  if (zoneId === "database") {
    return { x: zone.x + 72, y: 248 };
  }

  if (zoneId === "review") {
    return { x: zone.x - 84, y: 248 };
  }

  return hallwayCenter(zones);
}

function alternateWorkSpot(actor, targetZone) {
  const spots = targetZone.workSpot?.length ? targetZone.workSpot : targetZone.patrol;
  const primary = stableWorkRoute(actor, targetZone).points[0];

  return (
    spots.find((point) => !samePoint(point, primary)) ||
    targetZone.patrol.find((point) => !samePoint(point, primary)) ||
    primary
  );
}

function buildSeats(zone) {
  return (WORK_SPOT_OFFSETS[zone.id] || []).map((offset, index) => ({
    id: `${zone.id}_seat_${index}`,
    x: zone.x + offset.x,
    y: zone.y + offset.y,
    facing: index === 0 ? 1 : -1
  }));
}

function seatForActor(actor, targetZone) {
  const seats = targetZone.seats?.length
    ? targetZone.seats
    : (targetZone.workSpot || []).map((point, index) => ({
        id: `${targetZone.id}_seat_${index}`,
        ...point,
        facing: index === 0 ? 1 : -1
      }));

  const slotIndex = actor.id === "lead" || actor.id === "db" || actor.id === "docs" ? 0 : 1;
  return seats[Math.min(slotIndex, seats.length - 1)] || null;
}

function createTransitRoute(zones, fromZoneId, toZoneId, finalPoints = []) {
  const center = hallwayCenter(zones);
  const fromAnchor = transitAnchorForZone(zones, fromZoneId);
  const toAnchor = transitAnchorForZone(zones, toZoneId);
  const fromHub = familyHubForZone(zones, fromZoneId);
  const toHub = familyHubForZone(zones, toZoneId);

  const points = [];

  if (fromZoneId !== "lab") {
    points.push(fromAnchor, fromHub);
  } else {
    points.push(center);
  }

  if (!samePoint(fromHub, center) || !samePoint(toHub, center)) {
    points.push(center);
  }

  if (toZoneId !== "lab") {
    points.push(toHub, toAnchor);
  } else {
    points.push(center);
  }

  points.push(...finalPoints);

  return dedupePoints(points);
}

function createObservationLoop(actor, zones, zoneId, roomPhase = "execution") {
  const targetZone = zoneById(zones, zoneId || actor.home);
  const stableRoute = stableWorkRoute(actor, targetZone);
  const primarySeat = stableRoute.seat;
  const primary = stableRoute.points[0];
  const secondary = alternateWorkSpot(actor, targetZone);
  const anchor = transitAnchorForZone(zones, targetZone.id);
  const hub = familyHubForZone(zones, targetZone.id);
  const center = hallwayCenter(zones);

  if (targetZone.id === "lab") {
    return {
      zoneId: "lab",
      routeType: "observe",
      seat: primarySeat,
      holdIndices: [0, 4],
      holdFrames: roomPhase === "standby" ? OBSERVE_STANDBY_HOLD_FRAMES : OBSERVE_ROUTE_HOLD_FRAMES,
      points: dedupePoints([
        primary,
        { x: center.x - 54, y: center.y - 18 },
        { x: center.x + 54, y: center.y + 18 },
        secondary,
        center
      ])
    };
  }

  const points =
    roomPhase === "standby"
      ? [primary, anchor, secondary, primary]
      : [primary, anchor, hub, center, hub, anchor, secondary, primary];

  return {
    zoneId: targetZone.id,
    routeType: "observe",
    seat: primarySeat,
    holdIndices: roomPhase === "standby" ? [0, 3] : [0, 7],
    holdFrames: roomPhase === "standby" ? OBSERVE_STANDBY_HOLD_FRAMES : OBSERVE_ROUTE_HOLD_FRAMES,
    points: dedupePoints(points)
  };
}

function zoneById(zones, id) {
  return zones.find((zone) => zone.id === id) || zones[zones.length - 1];
}

function actorStateById(agentStates, actor) {
  return (
    agentStates?.find((agent) => agent.id === actor.id) || {
      id: actor.id,
      assigned_zone: actor.home,
      activity: "waiting"
    }
  );
}

function withOffsets(zone, offsets) {
  return offsets.map((offset) => ({
    x: zone.x + offset.x,
    y: zone.y + offset.y
  }));
}

function createScoutRoute(zones, scoutScene) {
  const fromZoneId = scoutScene?.from_zone || "lab";
  const toZoneId = scoutScene?.to_zone || "lab";
  const destination = zoneById(zones, toZoneId);
  const finalPoint = { x: destination.x, y: destination.y + 46 };
  const points = createTransitRoute(zones, fromZoneId, toZoneId, [finalPoint, finalPoint]);

  return {
    zoneId: toZoneId,
    routeType: "scout",
    holdIndices: [Math.max(0, points.length - 2)],
    holdFrames: SCOUT_HANDOFF_LINGER_FRAMES,
    points
  };
}

export function createDefaultZones() {
  return BASE_ZONES.map((zone) => ({
    ...zone,
    seats: buildSeats(zone),
    patrol: withOffsets(zone, PATROL_OFFSETS[zone.id]),
    activePatrol: withOffsets(zone, ACTIVE_PATROL_OFFSETS[zone.id]),
    workSpot: buildSeats(zone).map((seat) => ({ x: seat.x, y: seat.y }))
  }));
}

export function buildCrewActors(zones = createDefaultZones()) {
  return DEFAULT_CREW.map((member, index) => {
    const homeZone = zoneById(zones, member.home);
    const start = homeZone.patrol[index % homeZone.patrol.length];

    return {
      ...member,
      currentZone: member.home,
      x: start.x,
      y: start.y,
      patrolIndex: index % homeZone.patrol.length,
      facing: index % 2 === 0 ? 1 : -1,
      moving: false,
      holdFrames: 0,
      holdIndex: null,
      motionState: "IDLE",
      pose: "stand",
      routeType: "patrol",
      seatId: null
    };
  });
}

function createMeetingRoute(zones, actorId) {
  const lab = zoneById(zones, "lab");
  return {
    zoneId: "lab",
    routeType: "meeting",
    points: withOffsets(lab, MEETING_SPOT_OFFSETS[actorId] || MEETING_SPOT_OFFSETS.scout)
  };
}

function createRestRoute(zones, actorId) {
  return {
    zoneId: "lab",
    routeType: "rest",
    points: withOffsets(REST_CORNER, REST_SPOT_OFFSETS[actorId] || REST_SPOT_OFFSETS.scout)
  };
}

function createDispatchRoute(actor, zones, assignedZone) {
  const targetZone = zoneById(zones, assignedZone || actor.home);
  const targetSeat = seatForActor(actor, targetZone);
  const targetPoint = targetSeat || targetZone.workSpot[0] || targetZone.patrol[0];

  return {
    zoneId: targetZone.id,
    routeType: "dispatch",
    seat: targetSeat,
    points: createTransitRoute(zones, "lab", targetZone.id, [targetPoint])
  };
}

function stableWorkRoute(actor, targetZone) {
  const seat = seatForActor(actor, targetZone);
  const spots = targetZone.workSpot?.length ? targetZone.workSpot : targetZone.patrol;
  const point = seat || spots[0];

  return {
    zoneId: targetZone.id,
    routeType: "seat",
    seat,
    points: [point]
  };
}

function routeForActor(actor, agentState, { focusZone, roomPhase, zones, scene }) {
  const restCornerIds = scene?.rest_corner?.allowed_agent_ids || [];
  const reviewStage = scene?.review_stage || null;

  if (scene?.rest_corner?.active && restCornerIds.includes(actor.id)) {
    return createRestRoute(zones, actor.id);
  }

  if (roomPhase === "planning_huddle") {
    return createMeetingRoute(zones, actor.id);
  }

  if (actor.id === "scout") {
    if (scene?.scout?.active) {
      return createScoutRoute(zones, scene.scout);
    }

    const lab = zoneById(zones, "lab");
    return {
      zoneId: "lab",
      routeType: agentState.idle_behavior === "idle_patrol" ? "observe" : "seat",
      seat: seatForActor(actor, lab),
      points:
        agentState.idle_behavior === "idle_patrol"
          ? createObservationLoop(actor, zones, "lab", roomPhase).points
          : lab.workSpot
    };
  }

  if (
    roomPhase === "standby" &&
    agentState.activity === "idle" &&
    agentState.idle_behavior !== "idle_patrol"
  ) {
    if (agentState.idle_behavior === "idle_observe" && actor.id !== "lead") {
      return createObservationLoop(
        actor,
        zones,
        agentState.assigned_zone || actor.home,
        roomPhase
      );
    }

    const assignedZoneId = agentState.assigned_zone || actor.home;
    const targetZone = zoneById(zones, assignedZoneId);
    return stableWorkRoute(actor, targetZone);
  }

  if (roomPhase === "squad_split" && agentState.activity === "moving") {
    return createDispatchRoute(actor, zones, agentState.assigned_zone);
  }

  const assignedZoneId = agentState.assigned_zone || actor.home;
  const targetZone = zoneById(zones, assignedZoneId);

  if (roomPhase === "review_wrap") {
    if (reviewStage === "regroup" && actor.id !== "docs" && actor.id !== "scout") {
      return createMeetingRoute(zones, actor.id);
    }

    if (reviewStage === "wrap" && actor.id !== "docs" && actor.id !== "scout") {
      return {
        zoneId: "lab",
        points: zoneById(zones, "lab").workSpot
      };
    }

    if (actor.id === "lead" && reviewStage !== "results_returning") {
      return {
        zoneId: "lab",
        points: zoneById(zones, "lab").workSpot
      };
    }
  }

  const active = assignedZoneId === focusZone;

  if (
    OBSERVATION_ACTIVITIES.has(agentState.activity) &&
    agentState.idle_behavior === "idle_observe" &&
    actor.id !== "lead"
  ) {
    return createObservationLoop(actor, zones, assignedZoneId, roomPhase);
  }

  return {
    zoneId: assignedZoneId,
    routeType:
      SETTLED_ACTIVITIES.has(agentState.activity) && roomPhase !== "standby"
        ? "seat"
        : active
          ? "active_patrol"
          : "patrol",
    seat: seatForActor(actor, targetZone),
    points:
      SETTLED_ACTIVITIES.has(agentState.activity) && roomPhase !== "standby"
        ? stableWorkRoute(actor, targetZone).points
        : active
          ? targetZone.activePatrol
          : targetZone.patrol
  };
}

function speedForActor(actor, agentState, { roomPhase, status, scene }) {
  if (scene?.resting) {
    return 1.85;
  }

  if (roomPhase === "planning_huddle") {
    return 2.6;
  }

  if (roomPhase === "squad_split") {
    return 2.7;
  }

   if (roomPhase === "review_wrap" && scene?.review_stage === "regroup") {
    return actor.id === "docs" ? 1.2 : 2.2;
  }

  if (actor.id === "scout") {
    return scene?.scout?.active ? 2.85 : 1.1;
  }

  if (roomPhase === "standby" && agentState.idle_behavior === "idle_observe") {
    return 1.55;
  }

  if (agentState.activity === "moving") {
    return 2.45;
  }

  if (["coding", "debugging", "reading", "reviewing", "summarizing"].includes(agentState.activity)) {
    return status === "busy" ? 1.25 : 0.9;
  }

  return 1.05;
}

function poseForActivity(activity) {
  if (activity === "coding" || activity === "debugging") {
    return "type";
  }

  if (activity === "reading" || activity === "reviewing" || activity === "summarizing") {
    return "read";
  }

  return "sit";
}

function actorPhaseOffset(actor) {
  return actor.id
    .split("")
    .reduce((sum, char) => sum + char.charCodeAt(0), 0) % 17;
}

function deriveDeskLoop(actor, agentState, frame) {
  const phase = (frame + actorPhaseOffset(actor) * 5) % 72;

  if (agentState.activity === "coding" || agentState.activity === "debugging") {
    if (phase < 28) {
      return { motionState: "SEATED", pose: "type" };
    }

    if (phase < 38) {
      return { motionState: "PAUSE", pose: "sit" };
    }

    if (phase < 48) {
      return { motionState: "SCAN", pose: "read" };
    }

    return { motionState: "SEATED", pose: "type" };
  }

  if (
    agentState.activity === "reading" ||
    agentState.activity === "reviewing" ||
    agentState.activity === "summarizing"
  ) {
    if (phase < 26) {
      return { motionState: "SEATED", pose: "read" };
    }

    if (phase < 38) {
      return { motionState: "PAUSE", pose: "sit" };
    }

    return { motionState: "SCAN", pose: "read" };
  }

  return { motionState: "SEATED", pose: poseForActivity(agentState.activity) };
}

function isSeatRouteSettled(routeType) {
  return routeType === "seat" || routeType === "rest";
}

function deriveObservationState(route, patrolIndex, moving, holdFrames) {
  const lastIndex = Math.max(0, route.points.length - 1);

  if (holdFrames > 0 || (!moving && (patrolIndex === 0 || patrolIndex === lastIndex))) {
    return {
      motionState: "SEATED",
      pose: "sit"
    };
  }

  const halfway = Math.floor(lastIndex / 2);
  if (patrolIndex >= halfway) {
    return {
      motionState: "RETURN",
      pose: "walk"
    };
  }

  return {
    motionState: "WANDER",
    pose: "walk"
  };
}

function deriveActorMovement(actor, agentState, route, moving, holdFrames, patrolIndex, frame) {
  if (route.routeType === "meeting") {
    return moving
      ? { motionState: "WALK", pose: "walk" }
      : { motionState: "HUDDLE", pose: "read" };
  }

  if (route.routeType === "dispatch") {
    return moving
      ? { motionState: "WALK", pose: route.routeType === "scout" ? "carry" : "walk" }
      : isSeatRouteSettled(route.routeType)
        ? { motionState: "SEATED", pose: poseForActivity(agentState.activity) }
        : { motionState: "WALK", pose: "walk" };
  }

  if (route.routeType === "scout") {
    if (moving) {
      return { motionState: "WALK", pose: "carry" };
    }

    if (holdFrames > 0) {
      return { motionState: "HANDOFF", pose: "carry" };
    }

    return { motionState: "WALK", pose: "walk" };
  }

  if (route.routeType === "observe") {
    return deriveObservationState(route, patrolIndex, moving, holdFrames);
  }

  if (route.routeType === "rest") {
    return moving
      ? { motionState: "WALK", pose: "walk" }
      : { motionState: "REST", pose: "sit" };
  }

  if (route.routeType === "seat") {
    return moving
      ? { motionState: "WALK", pose: "walk" }
      : deriveDeskLoop(actor, agentState, frame);
  }

  if (moving) {
    return { motionState: "WALK", pose: "walk" };
  }

  if (SETTLED_ACTIVITIES.has(agentState.activity)) {
    return { motionState: "SEATED", pose: poseForActivity(agentState.activity) };
  }

  return {
    motionState: actor.currentZone === route.zoneId ? "IDLE" : "RETURN",
    pose: "stand"
  };
}

export function stepCrewActors(
  actors,
  {
    frame = 0,
    focusZone = "lab",
    phase,
    roomPhase = phase || "standby",
    status = "idle",
    agents = [],
    scene = {},
    zones
  }
) {
  return actors.map((actor) => {
    const agentState = actorStateById(agents, actor);
    const route = routeForActor(actor, agentState, {
      focusZone,
      roomPhase,
      zones,
      scene
    });
    const points = route.points;
    const pointCount = Math.max(1, points.length);
    const routeChanged = actor.routeType !== route.routeType || actor.currentZone !== route.zoneId;
    const basePatrolIndex = routeChanged ? 0 : actor.patrolIndex;
    const currentIndex = basePatrolIndex % pointCount;
    const target = points[currentIndex];
    const speed = speedForActor(actor, agentState, {
      focusZone,
      roomPhase,
      status,
      scene
    });
    const dx = target.x - actor.x;
    const dy = target.y - actor.y;
    const distance = Math.hypot(dx, dy);

    let patrolIndex = basePatrolIndex;
    let x = actor.x;
    let y = actor.y;
    let holdFrames = actor.holdFrames || 0;
    let holdIndex = actor.holdIndex ?? null;

    const seatHoldAllowed =
      Array.isArray(route.holdIndices) &&
      actor.routeType === route.routeType &&
      holdFrames > 0 &&
      holdIndex !== null;

    if (seatHoldAllowed && holdFrames > 0) {
      const motion = deriveActorMovement(actor, agentState, route, false, holdFrames, holdIndex, frame);

      return {
        ...actor,
        currentZone: route.zoneId,
        x,
        y,
        patrolIndex,
        facing: route.seat?.facing || actor.facing,
        moving: false,
        roomPhase,
        activity: agentState.activity,
        stepFrame: frame,
        holdFrames: holdFrames - 1,
        holdIndex,
        routeType: route.routeType,
        seatId: route.seat?.id || null,
        motionState: motion.motionState,
        pose: motion.pose
      };
    }

    if (distance <= speed + 0.25) {
      x = target.x;
      y = target.y;
      patrolIndex = (actor.patrolIndex + 1) % pointCount;
      if (Array.isArray(route.holdIndices) && route.holdIndices.includes(currentIndex)) {
        holdFrames = route.holdFrames || OBSERVE_ROUTE_HOLD_FRAMES;
        holdIndex = currentIndex;
      } else {
        holdFrames = 0;
        holdIndex = null;
      }
    } else if (distance > 0) {
      x = actor.x + (dx / distance) * speed;
      y = actor.y + (dy / distance) * speed;
      holdFrames = 0;
      holdIndex = null;
    }

    const facing =
      Math.abs(dx) > 0.5
        ? Math.sign(dx) || actor.facing
        : route.seat?.facing || actor.facing;
    const moving = distance > 0.3;
    const motion = deriveActorMovement(
      actor,
      agentState,
      route,
      moving,
      holdFrames,
      patrolIndex % pointCount,
      frame
    );

    return {
      ...actor,
      currentZone: route.zoneId,
      x,
      y,
      patrolIndex,
      facing,
      moving,
      roomPhase,
      activity: agentState.activity,
      stepFrame: frame,
      holdFrames,
      holdIndex,
      routeType: route.routeType,
      seatId: route.seat?.id || null,
      motionState: motion.motionState,
      pose: motion.pose
    };
  });
}
