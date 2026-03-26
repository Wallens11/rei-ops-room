import {
  DEFAULT_DESCRIPTION,
  DEFAULT_HEADLINE,
  ROOM_PHASES,
  VISUAL_CAST
} from "./room-schema.js";
import {
  buildCrewActors,
  createDefaultZones,
  stepCrewActors
} from "./room-engine.js";
import { getCanvasRenderMetrics } from "./canvas-layout.js";
import {
  furnitureLayoutById,
  propLayoutById,
  REST_CORNER,
  ROOM_LAYOUT
} from "./room-layout.js";
import {
  buildRuntimeEventSnapshot,
  reduceRuntimeEventState
} from "./runtime-events.js";
import {
  buildSceneHotspots,
  describeSceneSelection,
  findSceneHotspotAt
} from "./scene-details.js";
import {
  createStatusTransport,
  STATUS_POLL_FALLBACK_MS
} from "./status-stream.js";

const canvas = document.getElementById("room-canvas");
const context = canvas.getContext("2d");
context.imageSmoothingEnabled = false;

const COLORS = {
  bg0: "#07111a",
  bg1: "#0e1f31",
  bg2: "#163450",
  wallGlow: "rgba(101, 228, 255, 0.16)",
  floorLine: "rgba(101, 228, 255, 0.08)",
  white: "#edf3ff",
  ink: "#041018",
  cyan: "#65e4ff",
  mint: "#7cffba",
  amber: "#ffcc66",
  rose: "#ff907c",
  violet: "#b8a2ff"
};

const ACTIVITY_LABELS = {
  idle: "Idle",
  gathering: "Gathering",
  moving: "Moving",
  reading: "Reading",
  coding: "Coding",
  debugging: "Debugging",
  summarizing: "Summarizing",
  reviewing: "Reviewing",
  waiting: "Waiting"
};

const EVENT_LABELS = {
  new_request: "Request Masuk",
  zone_locked: "Zone Locked",
  workstream_spawned: "Workstream Spawned",
  handoff_created: "Handoff Created",
  review_requested: "Review Requested",
  reassignment_triggered: "Reassignment",
  result_returned: "Result Returned"
};

const ZONES = createDefaultZones(ROOM_LAYOUT);
const CANVAS_WIDTH = ROOM_LAYOUT.canvas.width;
const CANVAS_HEIGHT = ROOM_LAYOUT.canvas.height;

const elements = {
  statusPill: document.getElementById("status-pill"),
  phaseChip: document.getElementById("phase-chip"),
  focusChip: document.getElementById("focus-chip"),
  assignmentChip: document.getElementById("assignment-chip"),
  modeChip: document.getElementById("mode-chip"),
  confidenceChip: document.getElementById("confidence-chip"),
  activityAge: document.getElementById("activity-age"),
  phaseTitle: document.getElementById("phase-title"),
  phaseReason: document.getElementById("phase-reason"),
  focusLabel: document.getElementById("focus-label"),
  focusTitle: document.getElementById("focus-title"),
  focusReason: document.getElementById("focus-reason"),
  assignmentHint: document.getElementById("assignment-hint"),
  taskTitle: document.getElementById("task-title"),
  taskRepo: document.getElementById("task-repo"),
  objectiveTitle: document.getElementById("objective-title"),
  objectiveMeta: document.getElementById("objective-meta"),
  objectiveRepoChip: document.getElementById("objective-repo-chip"),
  objectivePhaseChip: document.getElementById("objective-phase-chip"),
  objectiveDetail: document.getElementById("objective-detail"),
  runtimeLiveTitle: document.getElementById("runtime-live-title"),
  runtimeLiveMeta: document.getElementById("runtime-live-meta"),
  runtimeFinishedTitle: document.getElementById("runtime-finished-title"),
  runtimeFinishedMeta: document.getElementById("runtime-finished-meta"),
  activeRoomRepo: document.getElementById("active-room-repo"),
  activeRoomMeta: document.getElementById("active-room-meta"),
  activeRoomTitle: document.getElementById("active-room-title"),
  sleepingRoomList: document.getElementById("sleeping-room-list"),
  repoContextName: document.getElementById("repo-context-name"),
  repoContextCwd: document.getElementById("repo-context-cwd"),
  repoContextTitle: document.getElementById("repo-context-title"),
  sceneDetailTitle: document.getElementById("scene-detail-title"),
  sceneDetailBody: document.getElementById("scene-detail-body"),
  recentList: document.getElementById("recent-list"),
  crewList: document.getElementById("crew-list"),
  skillList: document.getElementById("skill-list"),
  workstreamList: document.getElementById("workstream-list"),
  eventList: document.getElementById("event-list"),
  runtimePanel: document.getElementById("runtime-panel"),
  viewButtons: [...document.querySelectorAll("[data-mode]")]
};

const renderState = {
  status: "idle",
  frame: 0,
  data: createEmptyState(),
  mode: "room",
  transportMode: "connecting",
  actors: buildCrewActors(ZONES),
  hotspots: [],
  hoveredHotspot: null,
  selectedHotspot: null,
  runtimeSnapshot: null,
  runtimeEvent: {
    lastEventId: null,
    bubble: null,
    badge: null
  }
};

function cleanupOnPhaseEnter(nextPhase, nextSubstate = null) {
  if (nextSubstate === "cooldown") {
    renderState.runtimeSnapshot = null;
    renderState.runtimeEvent = {
      ...renderState.runtimeEvent,
      bubble: null,
      badge: null
    };

    if (renderState.selectedHotspot?.kind === "event") {
      renderState.selectedHotspot = null;
    }
  }
}

function syncCanvasResolution() {
  const metrics = getCanvasRenderMetrics({
    clientWidth: canvas.clientWidth,
    clientHeight: canvas.clientHeight,
    devicePixelRatio: window.devicePixelRatio || 1
  });

  if (canvas.width !== metrics.pixelWidth || canvas.height !== metrics.pixelHeight) {
    canvas.width = metrics.pixelWidth;
    canvas.height = metrics.pixelHeight;
  }

  context.setTransform(
    metrics.pixelWidth / metrics.logicalWidth,
    0,
    0,
    metrics.pixelHeight / metrics.logicalHeight,
    0,
    0
  );
  context.imageSmoothingEnabled = false;
}

function createEmptyState() {
  return {
    status: "idle",
    room: {
      phase: "standby",
      phase_confidence: 0.46,
      focus_zone: "lab",
      focus_confidence: 0.46,
      current_task: "Standby di room aktif",
      current_repo: "workspace",
      mode: "solo",
      status: "idle",
      phase_reason: ROOM_PHASES.standby.summary,
      focus_reason: "Belum ada desk aktif yang dominan."
    },
    scene: {
      headline: DEFAULT_HEADLINE,
      description: DEFAULT_DESCRIPTION,
      tone: "calm",
      rest_corner: {
        active: false,
        allowed_agent_ids: []
      },
      center_mode: "observed",
      props: [],
      ambient_cues: [],
      primary_bubble: {
        actor_id: "lead",
        text: "standby",
        tone: "calm"
      },
      scout: {
        active: false
      },
      desk_highlights: ["lab"],
      phase_title: ROOM_PHASES.standby.title,
      phase_reason: ROOM_PHASES.standby.summary,
      active_zone: {
        id: "lab",
        label: "Active Desk",
        chip_title: "Lead Table",
        title: "Lead Table",
        reason: "Belum ada desk aktif yang dominan."
      },
      assignment_hint: {
        active: false,
        label: "Next Assignment",
        zone_id: null,
        chip_title: null,
        title: null,
        reason: null,
        confidence: null
      },
      focus_label: "Active Desk",
      focus_chip_title: "Lead Table",
      focus_title: "Lead Table",
      focus_reason: "Belum ada desk aktif yang dominan."
    },
    activity: {
      summary: "Belum ada log thread",
      source: "thread",
      lastLogAgo: "belum ada data"
    },
    objective: {
      title: "Belum ada objective aktif.",
      detail: "Thread baru akan muncul di sini saat room mulai jalan.",
      repo: "workspace",
      focus_title: "Lead Table",
      phase_title: ROOM_PHASES.standby.title,
      mode: "solo",
      updated_ago: "-"
    },
    runtime: {
      live_now: null,
      last_finished: null
    },
    workspace: {
      active_room: {
        repo: "workspace",
        cwd_display: "workspace",
        recent_thread_count: 1,
        active_lane_count: 1,
        status: "idle",
        phase: "standby",
        latest_title: "No active room yet.",
        updated_ago: "-"
      },
      sleeping_rooms: []
    },
    thread: null,
    repoContext: null,
    workstreams: [],
    agents: VISUAL_CAST.map((agent) => ({
      id: agent.id,
      display_name: agent.displayName,
      home_zone: agent.homeZone,
      assigned_zone: agent.homeZone,
      visual_role: agent.visualRole,
      activity: "idle",
      assigned_workstream_ids: []
    })),
    recent_events: [],
    skills: [],
    recentThreads: [],
    ui: {
      headline: DEFAULT_HEADLINE,
      description: DEFAULT_DESCRIPTION
    }
  };
}

function truncate(text, limit = 140) {
  if (!text) {
    return "";
  }

  return text.length > limit ? `${text.slice(0, limit - 3)}...` : text;
}

function zoneById(id) {
  return ZONES.find((zone) => zone.id === id) || ZONES[ZONES.length - 1];
}

function actorById(id) {
  return renderState.actors.find((actor) => actor.id === id);
}

function agentById(id) {
  return renderState.data.agents?.find((agent) => agent.id === id);
}

function currentSceneSelection() {
  return renderState.hoveredHotspot || renderState.selectedHotspot;
}

function updateSceneDetailCard() {
  const detail = describeSceneSelection(currentSceneSelection(), renderState.data);
  elements.sceneDetailTitle.textContent = detail.title;
  elements.sceneDetailBody.textContent = detail.body;
}

function eventBadgeHotspot(badge) {
  const zone = zoneById(badge.zone);
  return {
    id: `event_${badge.zone}`,
    kind: "event",
    zone: badge.zone,
    label: badge.label,
    x: Math.min(CANVAS_WIDTH - 96 - 18, zone.labelX + 92),
    y: Math.max(18, zone.labelY),
    width: Math.min(96, 24 + badge.label.length * 6),
    height: 12
  };
}

function buildInteractiveHotspots() {
  const agents = renderState.actors.map((actor) => {
    const agent = agentById(actor.id);
    return {
      id: actor.id,
      kind: "agent",
      zone: agent?.assigned_zone || actor.currentZone,
      label: agent?.display_name || actor.id,
      x: actor.x - 18,
      y: actor.y - 2,
      width: 36,
      height: 48
    };
  });

  const desks = ZONES.map((zone) => ({
    id: zone.id,
    kind: "desk",
    zone: zone.id,
    label: zone.title,
    x: zone.x + (zone.hotspot?.x || -66),
    y: zone.y + (zone.hotspot?.y || -58),
    width: zone.hotspot?.width || 132,
    height: zone.hotspot?.height || 108
  }));

  const props = (renderState.data.scene?.props || [])
    .map((prop) => {
      const layout = propLayoutById(prop.id);
      const hotspot = layout?.hotspot;
      const origin = layout?.origin || { x: REST_CORNER.x, y: REST_CORNER.y };

      if (!hotspot) {
        return null;
      }

      return {
        id: prop.id,
        kind: "prop",
        zone: prop.zone,
        label: prop.label,
        x: origin.x + hotspot.x,
        y: origin.y + hotspot.y,
        width: hotspot.width,
        height: hotspot.height
      };
    })
    .filter(Boolean);

  const events = renderState.runtimeEvent.badge ? [eventBadgeHotspot(renderState.runtimeEvent.badge)] : [];
  return buildSceneHotspots({ agents, desks, events, props });
}

function statusLabel(status, resting = false) {
  if (resting) {
    return "Rest";
  }

  if (status === "busy") {
    return "Busy";
  }

  if (status === "cooldown") {
    return "Cooldown";
  }

  return "Idle";
}

function transportLabel(mode) {
  if (mode === "stream") {
    return "live stream";
  }

  if (mode === "polling") {
    return `polling ${Math.round(STATUS_POLL_FALLBACK_MS / 1000)}s`;
  }

  if (mode === "stopped") {
    return "transport off";
  }

  return "connecting";
}

function modeLabel(mode) {
  return mode === "multi" ? "Multi" : "Solo";
}

function workstreamStatusLabel(status) {
  if (status === "active") {
    return "Active";
  }

  if (status === "completed") {
    return "Done";
  }

  return "Queued";
}

function formatConfidence(value) {
  return `${Math.round((value || 0) * 100)}%`;
}

function updateActivityAgeLabel() {
  const prefix = transportLabel(renderState.transportMode);
  const ageLabel = renderState.data?.activity?.lastLogAgo || "belum ada data";

  elements.activityAge.textContent = renderState.data?.room?.resting
    ? `${prefix} | idle ${ageLabel}`
    : `${prefix} | last log ${ageLabel}`;
}

function setStatusPill(status, resting = false) {
  elements.statusPill.textContent = statusLabel(status, resting);
  elements.statusPill.className = `status-pill ${resting ? "status-rest" : `status-${status}`}`;
}

function initMode() {
  const params = new URLSearchParams(window.location.search);
  const requested = params.get("mode");
  const saved = localStorage.getItem("codex-pixel-agent-mode");
  renderState.mode = requested || saved || "room";
  applyMode(renderState.mode);
}

function applyMode(mode) {
  renderState.mode = mode;
  localStorage.setItem("codex-pixel-agent-mode", mode);
  document.body.classList.toggle("widget-mode", mode === "widget");

  elements.viewButtons.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.mode === mode);
  });
}

elements.viewButtons.forEach((button) => {
  button.addEventListener("click", () => {
    applyMode(button.dataset.mode);
  });
});

function renderRecentThreads(threads) {
  elements.recentList.innerHTML = "";

  threads.forEach((thread) => {
    const item = document.createElement("li");
    item.className = "trail-item";
    item.innerHTML = `
      <div class="item-head">
        <strong>${thread.repoName}</strong>
        <span class="item-chip">${thread.updatedAgo}</span>
      </div>
      <p class="mono dim">${thread.cwdDisplay}</p>
      <p>${truncate(thread.title, 86)}</p>
    `;
    elements.recentList.appendChild(item);
  });
}

function renderWorkspaceDock(workspace) {
  const activeRoom = workspace?.active_room || {
    repo: "workspace",
    recent_thread_count: 1,
    active_lane_count: 1,
    status: "idle",
    phase: "standby",
    latest_title: "No active room yet.",
    updated_ago: "-"
  };
  const sleepingRooms = workspace?.sleeping_rooms || [];

  elements.activeRoomRepo.textContent = activeRoom.repo;
  elements.activeRoomMeta.textContent = `${activeRoom.active_lane_count} active lane${activeRoom.active_lane_count > 1 ? "s" : ""} | ${activeRoom.phase} | ${activeRoom.status}`;
  elements.activeRoomTitle.textContent = truncate(activeRoom.latest_title, 88);

  elements.sleepingRoomList.innerHTML = "";

  if (sleepingRooms.length === 0) {
    const item = document.createElement("article");
    item.className = "workspace-card workspace-card-sleeping";
    item.innerHTML = `
      <p class="panel-label">Sleeping Rooms</p>
      <h4>No other repos</h4>
      <p class="dim">Repo lain akan muncul di sini sebagai snapshot ringan.</p>
    `;
    elements.sleepingRoomList.appendChild(item);
    return;
  }

  sleepingRooms.forEach((room) => {
    const item = document.createElement("article");
    item.className = "workspace-card workspace-card-sleeping";
    item.dataset.status = room.status;
    item.innerHTML = `
      <p class="panel-label">Sleeping Room</p>
      <h4>${room.repo}</h4>
      <p class="dim mono">${room.recent_thread_count} recent thread${room.recent_thread_count > 1 ? "s" : ""} | ${room.status} | ${room.updated_ago}</p>
      <p class="dim">${truncate(room.latest_title, 72)}</p>
    `;
    elements.sleepingRoomList.appendChild(item);
  });
}

function renderWorkstreams(workstreams) {
  elements.workstreamList.innerHTML = "";

  workstreams.forEach((workstream) => {
    const item = document.createElement("li");
    item.className = `stream-item ${workstream.status}`;
    item.innerHTML = `
      <div class="item-head">
        <strong>${workstream.owner.toUpperCase()}</strong>
        <span class="item-chip">${workstreamStatusLabel(workstream.status)}</span>
      </div>
      <p>${truncate(workstream.task, 92)}</p>
      <p class="dim mono">${workstream.zone}</p>
    `;
    elements.workstreamList.appendChild(item);
  });
}

function renderSkillList(skills) {
  elements.skillList.innerHTML = "";

  if (!skills || skills.length === 0) {
    const empty = document.createElement("span");
    empty.className = "skill-pill is-dim";
    empty.textContent = "No active skill";
    elements.skillList.appendChild(empty);
    return;
  }

  skills.forEach((skill) => {
    const item = document.createElement("span");
    item.className = "skill-pill";
    item.style.setProperty("--skill-color", skill.color);
    item.textContent = skill.label;
    elements.skillList.appendChild(item);
  });
}

function describeEvent(event) {
  if (event.type === "zone_locked") {
    return `${event.zone} locked @ ${formatConfidence(event.confidence)}`;
  }

  if (event.type === "handoff_created") {
    return `${event.from} -> ${event.to}: ${event.payload}`;
  }

  if (event.type === "workstream_spawned") {
    return `${event.zone} lane diaktifkan`;
  }

  if (event.type === "result_returned") {
    return `${event.from} -> ${event.to}`;
  }

  if (event.type === "review_requested") {
    return "Docs lane dipanggil buat wrap";
  }

  if (event.type === "new_request") {
    return truncate(event.detail, 78);
  }

  return truncate(event.zone || event.payload || "runtime event", 78);
}

function renderEvents(events) {
  elements.eventList.innerHTML = "";

  events.forEach((event) => {
    const item = document.createElement("li");
    item.className = "event-item";
    item.innerHTML = `
      <div class="item-head">
        <strong>${EVENT_LABELS[event.type] || event.type}</strong>
      </div>
      <p>${describeEvent(event)}</p>
    `;
    elements.eventList.appendChild(item);
  });
}

function crewNote(agent, workstreams) {
  const assigned = workstreams.filter((workstream) =>
    agent.assigned_workstream_ids.includes(workstream.id)
  );
  const currentZone = zoneById(agent.assigned_zone === "between_zones" ? "lab" : agent.assigned_zone);
  const task = assigned[0]?.task;

  if (agent.id === "scout") {
    return agent.carrying
      ? `Courier aktif: ${truncate(agent.carrying, 50)}`
      : agent.idle_behavior === "idle_patrol"
        ? "Patrol ringan sambil nunggu handoff yang benar-benar berarti."
        : "Nunggu handoff yang memang berarti.";
  }

  if (assigned.length === 0) {
    return agent.idle_behavior
      ? `${currentZone.title} | ${agent.idle_behavior}`
      : `${currentZone.title} standby sambil nunggu assignment.`;
  }

  return truncate(task || `${currentZone.title} aktif.`, 76);
}

function renderCrewList(agents, workstreams) {
  elements.crewList.innerHTML = "";

  agents.forEach((agent) => {
    const item = document.createElement("li");
    const zoneClass =
      agent.assigned_zone === "between_zones" ? "lab" : agent.assigned_zone || agent.home_zone;
    item.className = `crew-item ${zoneClass}`;
    item.innerHTML = `
      <div class="crew-head">
        <span class="crew-dot"></span>
        <strong class="crew-name">${agent.display_name}</strong>
        <span class="crew-state">${ACTIVITY_LABELS[agent.activity] || agent.activity}</span>
      </div>
      <p class="crew-note">${crewNote(agent, workstreams)}</p>
      <p class="dim mono">${agent.assigned_zone}</p>
    `;
    elements.crewList.appendChild(item);
  });
}

function applyStatus(data) {
  const previousPhase = renderState.data?.room?.phase || null;
  const previousSubstate = renderState.data?.room?.substate || null;
  renderState.data = data;
  renderState.status = data.status;
  if (previousPhase !== data.room.phase || previousSubstate !== (data.room.substate || null)) {
    cleanupOnPhaseEnter(data.room.phase, data.room.substate || null);
  }
  renderState.runtimeSnapshot = buildRuntimeEventSnapshot(data);
  renderState.runtimeEvent = reduceRuntimeEventState(
    renderState.runtimeEvent,
    renderState.runtimeSnapshot,
    Date.now()
  );

  document.body.dataset.phase = data.room.phase;
  document.body.dataset.tone = data.scene.tone;

  const activeZone = data.scene.active_zone || {
    label: data.scene.focus_label || "Active Desk",
    chip_title: data.scene.focus_chip_title || data.scene.focus_title || data.focus?.title || "Lead Table",
    title: data.scene.focus_title || data.focus?.title || "Lead Table",
    reason: data.scene.focus_reason || data.focus?.reason || ""
  };
  const assignmentHint = data.scene.assignment_hint || {
    active: false,
    label: "Next Assignment",
    zone_id: null,
    chip_title: null,
    title: null,
    reason: null
  };

  setStatusPill(data.status, Boolean(data.room.resting));
  elements.phaseChip.textContent = data.scene.phase_title || data.phase?.title || "Standby";
  elements.focusChip.textContent = activeZone.chip_title || activeZone.title || "Lead Table";
  elements.assignmentChip.hidden = !assignmentHint.active;
  elements.assignmentChip.textContent = assignmentHint.chip_title || "Next assignment";
  elements.modeChip.textContent = modeLabel(data.room.mode);
  elements.confidenceChip.textContent = `focus ${formatConfidence(data.room.focus_confidence)}`;
  updateActivityAgeLabel();

  elements.phaseTitle.textContent = data.scene.phase_title || data.phase?.title || "Standby";
  elements.phaseReason.textContent = data.scene.phase_reason || data.phase?.reason || "";
  elements.focusLabel.textContent = activeZone.label || "Active Desk";
  elements.focusTitle.textContent = activeZone.title || "Lead Table";
  elements.focusReason.textContent = activeZone.reason || "";
  elements.assignmentHint.hidden = !assignmentHint.active;
  elements.assignmentHint.textContent = assignmentHint.active
    ? `${assignmentHint.label}: ${assignmentHint.title}`
    : "";
  elements.taskTitle.textContent = truncate(data.room.current_task, 64);
  elements.taskRepo.textContent = `${data.room.current_repo} | ${data.room.mode}`;

  elements.objectiveTitle.textContent = truncate(
    data.objective?.title || data.room.current_task || "Belum ada objective aktif.",
    76
  );
  elements.objectiveMeta.textContent = `${data.objective?.focus_title || data.scene.focus_title || "Lead Table"} | ${data.room.mode}`;
  elements.objectiveRepoChip.textContent = data.objective?.repo || data.room.current_repo || "workspace";
  elements.objectivePhaseChip.textContent = data.objective?.phase_title || data.scene.phase_title || "Standby";
  elements.objectiveDetail.textContent = truncate(
    data.objective?.detail || data.thread?.title || "Belum ada thread aktif.",
    160
  );

  elements.runtimeLiveTitle.textContent = truncate(
    data.runtime?.live_now?.title || "Tidak ada activity live.",
    88
  );
  elements.runtimeLiveMeta.textContent = data.runtime?.live_now
    ? `${data.runtime.live_now.source_label} | ${data.runtime.live_now.age_label}`
    : "room idle";
  elements.runtimeFinishedTitle.textContent = truncate(
    data.runtime?.last_finished?.title || "Belum ada aksi terakhir.",
    88
  );
  elements.runtimeFinishedMeta.textContent = data.runtime?.last_finished
    ? `${data.runtime.last_finished.source_label} | ${data.runtime.last_finished.age_label}`
    : "thread";

  if (data.repoContext) {
    elements.repoContextName.textContent = data.repoContext.repoName;
    elements.repoContextCwd.textContent = data.repoContext.cwdDisplay;
    elements.repoContextTitle.textContent = truncate(data.repoContext.title, 170);
  } else {
    elements.repoContextName.textContent = "-";
    elements.repoContextCwd.textContent = "-";
    elements.repoContextTitle.textContent = "Belum ada repo spesifik lain.";
  }

  renderRecentThreads(data.recentThreads || []);
  renderSkillList(data.skills || []);
  renderWorkstreams(data.workstreams || []);
  renderEvents(data.recent_events || []);
  renderCrewList(data.agents || [], data.workstreams || []);
  renderWorkspaceDock(data.workspace || {});
  renderState.hotspots = buildInteractiveHotspots();
  updateSceneDetailCard();
}

function drawPixelRect(x, y, w, h, color) {
  context.fillStyle = color;
  context.fillRect(Math.round(x), Math.round(y), w, h);
}

function resolveLayoutColor(fill, palette = {}) {
  if (!fill) {
    return null;
  }

  return palette[fill] || COLORS[fill] || fill;
}

function drawLayoutRects(origin, rects = [], palette = {}, { active = false } = {}) {
  for (const rect of rects) {
    const fillToken =
      active && rect.fill_active
        ? rect.fill_active
        : !active && rect.fill_inactive
          ? rect.fill_inactive
          : rect.fill;
    const fill = resolveLayoutColor(fillToken, palette);

    if (!fill || fill === "transparent" || fill === "rgba(0,0,0,0)") {
      continue;
    }

    drawPixelRect(origin.x + rect.x, origin.y + rect.y, rect.w, rect.h, fill);
  }
}

function drawRoomBase(tone = "calm") {
  context.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

  context.fillStyle = COLORS.bg0;
  context.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

  const wallGradient = context.createLinearGradient(0, 0, 0, ROOM_LAYOUT.canvas.wall_height);
  wallGradient.addColorStop(0, COLORS.bg2);
  wallGradient.addColorStop(1, COLORS.bg1);
  context.fillStyle = wallGradient;
  context.fillRect(0, 0, CANVAS_WIDTH, ROOM_LAYOUT.canvas.wall_height);

  const glowAlpha =
    tone === "busy" ? 0.22 : tone === "steady" ? 0.18 : tone === "rest" ? 0.08 : 0.12;
  context.fillStyle = `rgba(101, 228, 255, ${glowAlpha})`;
  context.fillRect(220, 26, 200, 14);
  context.fillRect(250, 42, 140, 72);

  context.fillStyle = COLORS.bg2;
  context.fillRect(0, ROOM_LAYOUT.canvas.floor_top, CANVAS_WIDTH, CANVAS_HEIGHT - ROOM_LAYOUT.canvas.floor_top);

  for (let row = 0; row < 12; row += 1) {
    context.strokeStyle = COLORS.floorLine;
    context.beginPath();
    context.moveTo(0, ROOM_LAYOUT.canvas.floor_top + row * 18);
    context.lineTo(CANVAS_WIDTH, ROOM_LAYOUT.canvas.floor_top + row * 18);
    context.stroke();
  }

  for (let col = 0; col < 18; col += 1) {
    context.strokeStyle = "rgba(255, 255, 255, 0.025)";
    context.beginPath();
    context.moveTo(col * 36, ROOM_LAYOUT.canvas.floor_top);
    context.lineTo(col * 36 + 20, CANVAS_HEIGHT);
    context.stroke();
  }

  drawPixelRect(300, 24, 40, 10, COLORS.amber);
  drawPixelRect(312, 34, 16, 18, COLORS.white);

  if (tone === "rest") {
    [
      { x: 72, y: 40 },
      { x: 112, y: 58 },
      { x: 528, y: 46 },
      { x: 570, y: 68 }
    ].forEach((star) => {
      drawPixelRect(star.x, star.y, 4, 4, "rgba(237, 243, 255, 0.82)");
    });

    drawPixelRect(286, 160, 72, 8, "rgba(184, 162, 255, 0.22)");
    drawPixelRect(298, 168, 48, 6, "rgba(184, 162, 255, 0.12)");
  }
}

function drawZoneLabel(zone, active) {
  context.fillStyle = active ? zone.color || COLORS.cyan : "rgba(237, 243, 255, 0.16)";
  context.fillRect(zone.labelX, zone.labelY, zone.labelWidth || 84, zone.labelHeight || 12);

  context.fillStyle = COLORS.ink;
  context.font = "10px monospace";
  context.fillText(zone.id.toUpperCase(), zone.labelX + 8, zone.labelY + 9);
}

function drawDesk(x, y, accent, active) {
  drawLayoutRects(
    { x, y },
    ROOM_LAYOUT.desk_base.rects,
    {
      accent,
      desk_shadow: "rgba(0, 0, 0, 0.25)",
      bg1: COLORS.bg1,
      transparent: "rgba(0,0,0,0)"
    },
    { active }
  );
}

function drawRestCorner(restCorner) {
  const active = Boolean(restCorner?.active);
  drawLayoutRects(
    ROOM_LAYOUT.rest_corner.origin,
    ROOM_LAYOUT.rest_corner.rects,
    {
      rest_glow: "rgba(184, 162, 255, 0.18)",
      rest_glow_idle: "rgba(255, 255, 255, 0.05)",
      rest_accent: "rgba(184, 162, 255, 0.9)",
      rest_surface: "rgba(255, 255, 255, 0.12)",
      bg1: COLORS.bg1,
      violet: COLORS.violet,
      amber: COLORS.amber,
      white: COLORS.white,
      cyan: COLORS.cyan,
      transparent: "rgba(0,0,0,0)"
    },
    { active }
  );
}

function cueIntensity(ambientCues, id) {
  return ambientCues?.find((cue) => cue.id === id)?.intensity || "off";
}

function drawPlanningBoard(scene) {
  const intensity = cueIntensity(scene.ambient_cues, "board_glow");
  const glow =
    intensity === "high" ? 0.22 : intensity === "medium" ? 0.14 : 0.08;
  drawLayoutRects(propLayoutById("planning_board").origin, propLayoutById("planning_board").rects, {
    board_glow: `rgba(101, 228, 255, ${glow})`,
    ink: COLORS.ink,
    cyan: COLORS.cyan,
    amber: COLORS.amber,
    rose: COLORS.rose,
    white: COLORS.white,
    violet: COLORS.violet
  });
}

function drawStatusMonitor(scene, frame) {
  const flicker = cueIntensity(scene.ambient_cues, "monitor_flicker");
  const lit = flicker === "medium" ? (frame % 18 < 13 ? COLORS.cyan : COLORS.white) : COLORS.cyan;
  drawLayoutRects(propLayoutById("status_monitor").origin, propLayoutById("status_monitor").rects, {
    ink: COLORS.ink,
    monitor_lit: lit,
    bg1: COLORS.bg1
  });
}

function drawToolRack(scene, frame) {
  const pulse = cueIntensity(scene.ambient_cues, "status_pulse");
  const lit = pulse !== "off" ? (frame % 20 < 10 ? COLORS.mint : COLORS.cyan) : "rgba(0,0,0,0)";
  drawLayoutRects(propLayoutById("tool_rack").origin, propLayoutById("tool_rack").rects, {
    bg1: COLORS.bg1,
    white: COLORS.white,
    rack_pulse: lit
  });
}

function drawDocumentTray(scene) {
  drawLayoutRects(propLayoutById("document_tray").origin, propLayoutById("document_tray").rects, {
    white: COLORS.white,
    bg2: COLORS.bg2,
    rose: COLORS.rose
  });
}

function drawAmbientProps(scene, frame) {
  drawPlanningBoard(scene);
  drawStatusMonitor(scene, frame);
  drawToolRack(scene, frame);
  drawDocumentTray(scene);
}

function drawFurniture(zone, active) {
  const accent = active ? zone.color : "rgba(255, 255, 255, 0.12)";
  const furniture = furnitureLayoutById(zone.furniture);

  drawDesk(zone.x, zone.y, accent, active);
  drawLayoutRects(
    { x: zone.x, y: zone.y },
    furniture.rects,
    {
      accent,
      zone: zone.color,
      ink: COLORS.ink,
      white: COLORS.white,
      rose: COLORS.rose,
      mint: COLORS.mint,
      amber: COLORS.amber,
      bg1: COLORS.bg1,
      bg2: COLORS.bg2,
      backend_led_a: zone.color,
      backend_led_b: COLORS.amber,
      database_glow_a: "rgba(255, 204, 102, 0.55)",
      database_glow_b: "rgba(255, 204, 102, 0.45)",
      lab_shadow: "rgba(0, 0, 0, 0.24)"
    },
    { active }
  );
}

function actorPalette(actorId, accent) {
  if (actorId === "lead") {
    return { body: COLORS.white, accent: COLORS.violet };
  }

  if (actorId === "api") {
    return { body: COLORS.mint, accent };
  }

  if (actorId === "db") {
    return { body: COLORS.amber, accent };
  }

  if (actorId === "docs") {
    return { body: COLORS.rose, accent };
  }

  if (actorId === "scout") {
    return { body: COLORS.violet, accent: COLORS.white };
  }

  return { body: COLORS.cyan, accent };
}

function drawActivityCue(actor, activity, accent, pose = "stand") {
  const seated = pose === "sit" || pose === "type" || pose === "read";
  const deskYOffset = seated ? 4 : 0;

  if (activity === "coding" || activity === "debugging") {
    drawPixelRect(actor.x + 14, actor.y + 8 + deskYOffset, 8, 6, COLORS.ink);
    drawPixelRect(actor.x + 16, actor.y + 10 + deskYOffset, 4, 2, accent);
    if (activity === "debugging") {
      drawPixelRect(actor.x + 24, actor.y + 4 + deskYOffset, 4, 4, COLORS.rose);
    }
  }

  if (activity === "reading" || activity === "reviewing" || activity === "summarizing") {
    drawPixelRect(actor.x - 18, actor.y + 8 + deskYOffset, 8, 10, COLORS.white);
    drawPixelRect(actor.x - 16, actor.y + 10 + deskYOffset, 4, 2, accent);
    if (activity === "reviewing") {
      drawPixelRect(actor.x - 8, actor.y + 8 + deskYOffset, 4, 4, COLORS.rose);
    }
  }
}

function drawAgent(actor, agentState, isPrimary) {
  const zone = zoneById(agentState.assigned_zone === "between_zones" ? "lab" : actor.currentZone);
  const frame = renderState.frame;
  const { body, accent } = actorPalette(actor.id, zone.color);
  const pose =
    actor.pose ||
    (["coding", "debugging"].includes(agentState.activity)
      ? "type"
      : ["reading", "reviewing", "summarizing"].includes(agentState.activity)
        ? "read"
        : actor.moving
          ? "walk"
          : "stand");
  const seated = actor.motionState === "SEATED" || actor.motionState === "REST" || ["sit", "type", "read"].includes(pose);
  const y = actor.y + (seated ? -8 + (frame % 20 < 10 ? 0 : -1) : 0);
  const direction = actor.facing || 1;
  const armSwing = actor.moving ? ((frame + actor.patrolIndex) % 10 < 5 ? 2 : -2) : seated ? 1 : 0;
  const legSwing = actor.moving ? ((frame + actor.patrolIndex) % 12 < 6 ? 2 : -2) : 0;

  drawPixelRect(actor.x - (seated ? 16 : 18), y + (seated ? 28 : 34), seated ? 32 : 36, 8, "rgba(0, 0, 0, 0.24)");

  if (isPrimary) {
    drawPixelRect(actor.x - 16, y - 2, 32, 4, accent);
  }

  if (seated) {
    drawPixelRect(actor.x - 9, y + 20, 18, 8, COLORS.bg2);
    drawPixelRect(actor.x - 12, y + 24, 24, 5, "rgba(7, 17, 26, 0.55)");
    drawPixelRect(actor.x - 10, y, 20, 20, body);
    drawPixelRect(actor.x - 6, y + 4, 12, 8, COLORS.white);
    drawPixelRect(actor.x - 4, y + 6, 8, 4, COLORS.bg1);
    drawPixelRect(actor.x - 7, y + 20, 14, 8, body);
    drawPixelRect(actor.x - 8, y + 17, 16, 4, accent);

    if (pose === "type") {
      drawPixelRect(actor.x - 14, y + 20, 6, 7, body);
      drawPixelRect(actor.x + 8, y + 20, 6, 7, body);
      drawPixelRect(actor.x - 8, y + 28, 6, 4, body);
      drawPixelRect(actor.x + 2, y + 28, 6, 4, body);
    } else if (pose === "read") {
      drawPixelRect(actor.x - 14, y + 19, 6, 8, body);
      drawPixelRect(actor.x + 8, y + 21, 6, 6, body);
      drawPixelRect(actor.x - 8, y + 28, 6, 4, body);
      drawPixelRect(actor.x + 2, y + 28, 6, 4, body);
    } else {
      drawPixelRect(actor.x - 14, y + 21, 6, 7, body);
      drawPixelRect(actor.x + 8, y + 21, 6, 7, body);
      drawPixelRect(actor.x - 8, y + 28, 6, 4, body);
      drawPixelRect(actor.x + 2, y + 28, 6, 4, body);
    }
  } else {
    drawPixelRect(actor.x - 10, y, 20, 20, body);
    drawPixelRect(actor.x - 6, y + 4, 12, 8, COLORS.white);
    drawPixelRect(actor.x - 4, y + 6, 8, 4, COLORS.bg1);
    drawPixelRect(actor.x - 6, y + 20, 12, 14, body);
    drawPixelRect(actor.x - 14 + armSwing, y + 22, 6, 12, body);
    drawPixelRect(actor.x + 8 - armSwing, y + 22, 6, 12, body);
    drawPixelRect(actor.x - 8 - legSwing, y + 34, 6, 10, body);
    drawPixelRect(actor.x + 2 + legSwing, y + 34, 6, 10, body);
    drawPixelRect(actor.x - 4, y + 18, 8, 4, accent);
  }

  if (pose === "carry") {
    drawPixelRect(actor.x - 8, y + 18, 16, 10, COLORS.amber);
    drawPixelRect(actor.x - 4, y + 16, 8, 2, COLORS.white);
  }

  drawPixelRect(actor.x + 11 * direction, y + 9, 4, 4, "rgba(255,255,255,0.22)");

  drawActivityCue({ x: actor.x, y }, agentState.activity, accent, pose);
}

function bubbleColor(tone) {
  if (tone === "busy") {
    return COLORS.mint;
  }

  if (tone === "steady") {
    return COLORS.cyan;
  }

  return COLORS.white;
}

function drawSkillBadges(skills, resting = false) {
  if (!skills || skills.length === 0) {
    return;
  }

  let x = 28;
  const y = 24;

  skills.slice(0, 3).forEach((skill) => {
    const label = skill.label.toUpperCase();
    const width = 22 + label.length * 6;
    const fill = resting ? "rgba(184, 162, 255, 0.14)" : skill.color;

    drawPixelRect(x, y, width, 14, fill);
    context.fillStyle = resting ? COLORS.violet : COLORS.ink;
    context.font = "10px monospace";
    context.fillText(label, x + 6, y + 10);
    x += width + 8;
  });
}

function drawSleepMarks(actor) {
  const marks = [
    { x: actor.x + 18, y: actor.y - 24, size: 8 },
    { x: actor.x + 30, y: actor.y - 38, size: 6 }
  ];

  context.fillStyle = COLORS.violet;
  context.font = "12px monospace";
  marks.forEach((mark) => {
    context.fillText("Z", mark.x, mark.y);
  });
}

function drawBubble(actor, text, tone = "steady", verticalOffset = 0, opacity = 1) {
  const width = Math.min(220, 82 + text.length * 4);
  const x = Math.max(18, Math.min(CANVAS_WIDTH - width - 18, actor.x - width / 2));
  const y = Math.max(18, actor.y - 78 - verticalOffset);
  const fill = bubbleColor(tone);

  context.save();
  context.globalAlpha = opacity;
  drawPixelRect(x, y, width, 30, fill);
  drawPixelRect(x + 18, y + 30, 8, 8, fill);
  context.fillStyle = COLORS.ink;
  context.font = "12px monospace";
  context.fillText(truncate(text, 34), x + 10, y + 19);
  context.restore();
}

function badgeColor(severity) {
  if (severity === "warn") {
    return COLORS.rose;
  }

  if (severity === "calm") {
    return COLORS.violet;
  }

  return COLORS.cyan;
}

function drawZoneBadge(badge) {
  if (!badge) {
    return;
  }

  const zone = zoneById(badge.zone);
  const width = Math.min(96, 24 + badge.label.length * 6);
  const x = Math.min(CANVAS_WIDTH - width - 18, zone.labelX + 92);
  const y = Math.max(18, zone.labelY);
  const fill = badgeColor(badge.severity);

  drawPixelRect(x, y, width, 12, fill);
  context.fillStyle = COLORS.ink;
  context.font = "10px monospace";
  context.fillText(truncate(badge.label.toUpperCase(), 12), x + 5, y + 9);
}

function drawScene() {
  syncCanvasResolution();
  const data = renderState.data;
  drawRoomBase(data.scene?.tone || "calm");
  drawAmbientProps(data.scene || {}, renderState.frame);
  drawRestCorner(data.scene?.rest_corner);
  drawSkillBadges(data.scene?.skill_badges || [], Boolean(data.scene?.resting));

  const highlightZones = new Set(data.scene?.desk_highlights || ["lab"]);

  ZONES.forEach((zone) => {
    const activeZone = highlightZones.has(zone.id);
    drawZoneLabel(zone, activeZone);
    drawFurniture(zone, activeZone);
  });

  renderState.actors.forEach((actor) => {
    const agentState = agentById(actor.id) || {
      assigned_zone: actor.home,
      activity: "idle"
    };
    const isPrimary = data.scene?.primary_bubble?.actor_id === actor.id;
    drawAgent(actor, agentState, isPrimary);
  });

  const primaryBubble = data.scene?.primary_bubble;
  const bubbleActor =
    actorById(primaryBubble?.actor_id) || actorById("lead") || renderState.actors[0];
  drawBubble(bubbleActor, primaryBubble?.text || "standby", primaryBubble?.tone || "steady");

  if (renderState.runtimeEvent.badge && renderState.data.room?.substate !== "cooldown") {
    drawZoneBadge(renderState.runtimeEvent.badge);
  }

  if (renderState.runtimeEvent.bubble && renderState.data.room?.substate !== "cooldown") {
    const eventZone = zoneById(renderState.runtimeEvent.bubble.zone || data.room?.focus_zone || "lab");
    drawBubble(
      { x: eventZone.x, y: eventZone.y - 8 },
      renderState.runtimeEvent.bubble.label,
      renderState.runtimeEvent.bubble.severity === "warn" ? "busy" : "steady",
      24,
      renderState.runtimeEvent.bubble.opacity ?? 1
    );
  }

  if (data.scene?.resting && bubbleActor) {
    drawSleepMarks(bubbleActor);
  }

  if (
    data.scene?.scout?.active &&
    data.scene.scout.payload &&
    primaryBubble?.actor_id !== "scout" &&
    data.room?.substate !== "cooldown"
  ) {
    const scoutActor = actorById("scout");
    if (scoutActor) {
      drawBubble(scoutActor, data.scene.scout.payload, "steady", 34);
    }
  }
}

function scenePointer(event) {
  const rect = canvas.getBoundingClientRect();
  const x = ((event.clientX - rect.left) / rect.width) * CANVAS_WIDTH;
  const y = ((event.clientY - rect.top) / rect.height) * CANVAS_HEIGHT;
  return { x, y };
}

canvas.addEventListener("mousemove", (event) => {
  const pointer = scenePointer(event);
  renderState.hoveredHotspot = findSceneHotspotAt(renderState.hotspots, pointer.x, pointer.y);
  canvas.style.cursor = renderState.hoveredHotspot ? "pointer" : "default";
  updateSceneDetailCard();
});

canvas.addEventListener("mouseleave", () => {
  renderState.hoveredHotspot = null;
  canvas.style.cursor = "default";
  updateSceneDetailCard();
});

canvas.addEventListener("click", (event) => {
  const pointer = scenePointer(event);
  renderState.selectedHotspot = findSceneHotspotAt(renderState.hotspots, pointer.x, pointer.y);
  updateSceneDetailCard();

  if (renderState.selectedHotspot?.kind === "event") {
    elements.runtimePanel?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
});

function showTransportError(error) {
  elements.runtimeLiveTitle.textContent = "Gagal membaca status lokal.";
  elements.runtimeLiveMeta.textContent = error instanceof Error ? error.message : String(error);
}

function animate() {
  renderState.frame += 1;
  renderState.runtimeEvent = reduceRuntimeEventState(
    renderState.runtimeEvent,
    renderState.runtimeSnapshot,
    Date.now()
  );
  renderState.actors = stepCrewActors(renderState.actors, {
    frame: renderState.frame,
    status: renderState.status,
    focusZone: renderState.data.room?.focus_zone || "lab",
    roomPhase: renderState.data.room?.phase || "standby",
    agents: renderState.data.agents || [],
    scene: renderState.data.scene || {},
    zones: ZONES
  });
  renderState.hotspots = buildInteractiveHotspots();
  drawScene();
}

initMode();
drawScene();
setInterval(animate, 160);

const statusTransport = createStatusTransport({
  onStatus(data) {
    applyStatus(data);
  },
  onModeChange(mode) {
    renderState.transportMode = mode;
    updateActivityAgeLabel();
  },
  onTransportError(error) {
    showTransportError(error);
  }
});

statusTransport.start();
window.addEventListener("beforeunload", () => {
  statusTransport.stop();
});
