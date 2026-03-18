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
  const fromZone = zoneById(zones, scoutScene?.from_zone || "lab");
  const toZone = zoneById(zones, scoutScene?.to_zone || "lab");
  const fromPoint = { x: fromZone.x, y: fromZone.y + 42 };
  const toPoint = { x: toZone.x, y: toZone.y + 46 };
  const midPoint = {
    x: Math.round((fromPoint.x + toPoint.x) / 2),
    y: Math.round((fromPoint.y + toPoint.y) / 2) - 18
  };

  return [fromPoint, midPoint, toPoint, toPoint, midPoint];
}

export function createDefaultZones() {
  return BASE_ZONES.map((zone) => ({
    ...zone,
    patrol: withOffsets(zone, PATROL_OFFSETS[zone.id]),
    activePatrol: withOffsets(zone, ACTIVE_PATROL_OFFSETS[zone.id]),
    workSpot: withOffsets(zone, WORK_SPOT_OFFSETS[zone.id])
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
      moving: false
    };
  });
}

function createMeetingRoute(zones, actorId) {
  const lab = zoneById(zones, "lab");
  return {
    zoneId: "lab",
    points: withOffsets(lab, MEETING_SPOT_OFFSETS[actorId] || MEETING_SPOT_OFFSETS.scout)
  };
}

function createRestRoute(zones, actorId) {
  return {
    zoneId: "lab",
    points: withOffsets(REST_CORNER, REST_SPOT_OFFSETS[actorId] || REST_SPOT_OFFSETS.scout)
  };
}

function createDispatchRoute(actor, zones, assignedZone) {
  const home = zoneById(zones, actor.home);
  const targetZone = zoneById(zones, assignedZone || actor.home);
  const meetingPoint = createMeetingRoute(zones, actor.id).points[0];
  const targetPoint = targetZone.workSpot[0] || targetZone.patrol[0];

  return {
    zoneId: targetZone.id,
    points: [meetingPoint, targetPoint]
  };
}

function stableWorkRoute(actor, targetZone) {
  const spots = targetZone.workSpot?.length ? targetZone.workSpot : targetZone.patrol;
  const slotIndex = actor.id === "lead" || actor.id === "db" || actor.id === "docs" ? 0 : 1;
  const point = spots[Math.min(slotIndex, spots.length - 1)];

  return {
    zoneId: targetZone.id,
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
      return {
        zoneId: scene.scout.to_zone || "lab",
        points: createScoutRoute(zones, scene.scout)
      };
    }

    const lab = zoneById(zones, "lab");
    return {
      zoneId: "lab",
      points: agentState.idle_behavior === "idle_patrol" ? lab.patrol : lab.workSpot
    };
  }

  if (
    roomPhase === "standby" &&
    agentState.activity === "idle" &&
    agentState.idle_behavior !== "idle_patrol"
  ) {
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

  const settledActivities = new Set([
    "reading",
    "coding",
    "debugging",
    "summarizing",
    "reviewing"
  ]);
  const active = assignedZoneId === focusZone;

  return {
    zoneId: assignedZoneId,
    points:
      settledActivities.has(agentState.activity) && roomPhase !== "standby"
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

  if (agentState.activity === "moving") {
    return 2.45;
  }

  if (["coding", "debugging", "reading", "reviewing", "summarizing"].includes(agentState.activity)) {
    return status === "busy" ? 1.25 : 0.9;
  }

  return 1.05;
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
    const target = points[actor.patrolIndex % points.length];
    const speed = speedForActor(actor, agentState, {
      focusZone,
      roomPhase,
      status,
      scene
    });
    const dx = target.x - actor.x;
    const dy = target.y - actor.y;
    const distance = Math.hypot(dx, dy);

    let patrolIndex = actor.patrolIndex;
    let x = actor.x;
    let y = actor.y;

    if (distance <= speed + 0.25) {
      x = target.x;
      y = target.y;
      patrolIndex = (actor.patrolIndex + 1) % points.length;
    } else if (distance > 0) {
      x = actor.x + (dx / distance) * speed;
      y = actor.y + (dy / distance) * speed;
    }

    const facing = Math.abs(dx) > 0.5 ? Math.sign(dx) || actor.facing : actor.facing;
    const moving = distance > 0.3;

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
      stepFrame: frame
    };
  });
}
