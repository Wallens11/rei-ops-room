function contains(hotspot, x, y) {
  return (
    x >= hotspot.x &&
    y >= hotspot.y &&
    x <= hotspot.x + hotspot.width &&
    y <= hotspot.y + hotspot.height
  );
}

export function buildSceneHotspots({ agents = [], desks = [], events = [], props = [] }) {
  return [
    ...events.map((item) => ({ priority: 3, ...item })),
    ...agents.map((item) => ({ priority: 2, ...item })),
    ...desks.map((item) => ({ priority: 1, ...item })),
    ...props.map((item) => ({ priority: 0, ...item }))
  ];
}

export function findSceneHotspotAt(hotspots, x, y) {
  return [...hotspots]
    .sort((left, right) => right.priority - left.priority)
    .find((hotspot) => contains(hotspot, x, y)) || null;
}

function describeAgentSelection(selection, state) {
  const agent = state.agents.find((entry) => entry.id === selection.id);
  const workstream = state.workstreams.find((entry) =>
    agent?.assigned_workstream_ids?.includes(entry.id)
  );
  const activityMap = {
    coding: "writing code",
    debugging: "chasing a bug",
    reading: "reading context",
    reviewing: "reviewing changes",
    summarizing: "writing a summary",
    planning: "planning next steps",
    meeting: "syncing with team",
    idle: "watching the queue",
  };
  const activityLabel = activityMap[agent?.activity] || agent?.activity || "on standby";

  return {
    title: `Rei — ${activityLabel}`,
    body: [
      `Zone: ${agent?.assigned_zone || selection.zone || "lab"}`,
      agent?.idle_behavior ? `Idle mode: ${agent.idle_behavior}` : null,
      workstream ? `Working on: ${workstream.task}` : "Watching for the next issue."
    ]
      .filter(Boolean)
      .join(" · ")
  };
}

function describeDeskSelection(selection, state) {
  const workstream = state.workstreams.find((entry) => entry.zone === selection.zone);
  const occupancy = state.scene?.desk_occupancy?.find((entry) => entry.zone_id === selection.zone);
  const isOccupied = Boolean(occupancy?.occupied ?? ((occupancy?.count || 0) > 0));

  return {
    title: selection.label,
    body: workstream
      ? [
          workstream.task,
          `Status: ${workstream.status}`,
          isOccupied ? `Occupancy: ${occupancy.count}` : null
        ]
          .filter(Boolean)
          .join(" · ")
      : isOccupied
        ? `${selection.label} is active. Rei is working here.`
        : `${selection.label} is clear — ready for the next handoff.`
  };
}

function describeEventSelection(selection, state) {
  const activeZoneTitle =
    state.scene?.active_zone?.title || state.scene?.focus_title || "lab";
  const handoffLabel = state.scene?.handoff_trail?.label;

  return {
    title: selection.label,
    body: [
      `Runtime detail stays in the side panel. Focus zone: ${selection.zone || activeZoneTitle}.`,
      handoffLabel ? `Current handoff: ${handoffLabel}.` : null
    ]
      .filter(Boolean)
      .join(" ")
  };
}

function describePropSelection(selection) {
  return {
    title: selection.label,
    body: `${selection.label} helps the room feel inhabited and explains the current coordination flow.`
  };
}

export function describeSceneSelection(selection, state) {
  if (!selection) {
    return {
      title: "Rei Ops Room",
      body: "Click Rei or hover a desk to inspect current state."
    };
  }

  if (selection.kind === "agent") {
    return describeAgentSelection(selection, state);
  }

  if (selection.kind === "desk") {
    return describeDeskSelection(selection, state);
  }

  if (selection.kind === "event") {
    return describeEventSelection(selection, state);
  }

  return describePropSelection(selection);
}
