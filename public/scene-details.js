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

  return {
    title: selection.label,
    body: [
      `Activity: ${agent?.activity || "idle"}`,
      agent?.idle_behavior ? `Idle mode: ${agent.idle_behavior}` : null,
      `Zone: ${agent?.assigned_zone || selection.zone || "lab"}`,
      workstream ? `Workstream: ${workstream.task}` : "Workstream: standby watch"
    ]
      .filter(Boolean)
      .join(" | ")
  };
}

function describeDeskSelection(selection, state) {
  const workstream = state.workstreams.find((entry) => entry.zone === selection.zone);

  return {
    title: selection.label,
    body: workstream
      ? `${workstream.task} | Status: ${workstream.status}`
      : `${selection.label} is on watch for the next handoff.`
  };
}

function describeEventSelection(selection, state) {
  return {
    title: selection.label,
    body: `Runtime detail stays in the side panel. Focus zone: ${selection.zone || state.scene?.focus_title || "lab"}.`
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
      title: "Room details",
      body: "Hover a desk or click an agent to inspect the current room state."
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
