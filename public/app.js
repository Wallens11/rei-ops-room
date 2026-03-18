import {
  DEFAULT_DESCRIPTION,
  DEFAULT_HEADLINE,
  ROOM_PHASES,
  VISUAL_CAST
} from "./room-schema.js";
import {
  REST_CORNER,
  buildCrewActors,
  createDefaultZones,
  stepCrewActors
} from "./room-engine.js";
import { getCanvasRenderMetrics } from "./canvas-layout.js";
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

const ZONES = createDefaultZones();

const elements = {
  statusPill: document.getElementById("status-pill"),
  phaseChip: document.getElementById("phase-chip"),
  focusChip: document.getElementById("focus-chip"),
  modeChip: document.getElementById("mode-chip"),
  confidenceChip: document.getElementById("confidence-chip"),
  activityAge: document.getElementById("activity-age"),
  phaseTitle: document.getElementById("phase-title"),
  phaseReason: document.getElementById("phase-reason"),
  focusTitle: document.getElementById("focus-title"),
  focusReason: document.getElementById("focus-reason"),
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
    x: Math.min(640 - 96 - 18, zone.labelX + 92),
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
    x: zone.x - 66,
    y: zone.y - 58,
    width: 132,
    height: 108
  }));

  const props = (renderState.data.scene?.props || []).map((prop) => ({
    id: prop.id,
    kind: "prop",
    zone: prop.zone,
    label: prop.label,
    x:
      prop.id === "planning_board"
        ? 266
        : prop.id === "status_monitor"
          ? 520
          : prop.id === "tool_rack"
            ? 548
            : prop.id === "document_tray"
              ? 468
              : REST_CORNER.x - 50,
    y:
      prop.id === "planning_board"
        ? 44
        : prop.id === "status_monitor"
          ? 32
          : prop.id === "tool_rack"
            ? 176
            : prop.id === "document_tray"
              ? 230
              : REST_CORNER.y - 24,
    width:
      prop.id === "planning_board"
        ? 108
        : prop.id === "status_monitor"
          ? 64
          : prop.id === "tool_rack"
            ? 34
            : prop.id === "document_tray"
              ? 40
              : 112,
    height:
      prop.id === "planning_board"
        ? 54
        : prop.id === "status_monitor"
          ? 34
          : prop.id === "tool_rack"
            ? 68
            : prop.id === "document_tray"
              ? 28
              : 56
  }));

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

  setStatusPill(data.status, Boolean(data.room.resting));
  elements.phaseChip.textContent = data.scene.phase_title || data.phase?.title || "Standby";
  elements.focusChip.textContent = data.scene.focus_title || data.focus?.title || "Lead Table";
  elements.modeChip.textContent = modeLabel(data.room.mode);
  elements.confidenceChip.textContent = `focus ${formatConfidence(data.room.focus_confidence)}`;
  updateActivityAgeLabel();

  elements.phaseTitle.textContent = data.scene.phase_title || data.phase?.title || "Standby";
  elements.phaseReason.textContent = data.scene.phase_reason || data.phase?.reason || "";
  elements.focusTitle.textContent = data.scene.focus_title || data.focus?.title || "Lead Table";
  elements.focusReason.textContent = data.scene.focus_reason || data.focus?.reason || "";
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

function drawRoomBase(tone = "calm") {
  context.clearRect(0, 0, 640, 420);

  context.fillStyle = COLORS.bg0;
  context.fillRect(0, 0, 640, 420);

  const wallGradient = context.createLinearGradient(0, 0, 0, 220);
  wallGradient.addColorStop(0, COLORS.bg2);
  wallGradient.addColorStop(1, COLORS.bg1);
  context.fillStyle = wallGradient;
  context.fillRect(0, 0, 640, 220);

  const glowAlpha =
    tone === "busy" ? 0.22 : tone === "steady" ? 0.18 : tone === "rest" ? 0.08 : 0.12;
  context.fillStyle = `rgba(101, 228, 255, ${glowAlpha})`;
  context.fillRect(220, 26, 200, 14);
  context.fillRect(250, 42, 140, 72);

  context.fillStyle = COLORS.bg2;
  context.fillRect(0, 220, 640, 200);

  for (let row = 0; row < 12; row += 1) {
    context.strokeStyle = COLORS.floorLine;
    context.beginPath();
    context.moveTo(0, 220 + row * 18);
    context.lineTo(640, 220 + row * 18);
    context.stroke();
  }

  for (let col = 0; col < 18; col += 1) {
    context.strokeStyle = "rgba(255, 255, 255, 0.025)";
    context.beginPath();
    context.moveTo(col * 36, 220);
    context.lineTo(col * 36 + 20, 420);
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
  context.fillRect(zone.labelX, zone.labelY, 84, 12);

  context.fillStyle = COLORS.ink;
  context.font = "10px monospace";
  context.fillText(zone.id.toUpperCase(), zone.labelX + 8, zone.labelY + 9);
}

function drawDesk(x, y, accent, active) {
  drawPixelRect(x - 58, y + 26, 116, 10, "rgba(0, 0, 0, 0.25)");
  drawPixelRect(x - 52, y - 8, 104, 18, accent);
  drawPixelRect(x - 46, y - 2, 92, 12, COLORS.bg1);
  drawPixelRect(x - 34, y + 10, 12, 28, COLORS.bg1);
  drawPixelRect(x + 22, y + 10, 12, 28, COLORS.bg1);

  if (active) {
    drawPixelRect(x - 60, y - 12, 120, 4, accent);
  }
}

function drawRestCorner(restCorner) {
  const active = Boolean(restCorner?.active);
  const accent = active ? "rgba(184, 162, 255, 0.9)" : "rgba(255, 255, 255, 0.12)";
  const glow = active ? "rgba(184, 162, 255, 0.18)" : "rgba(255, 255, 255, 0.05)";

  drawPixelRect(REST_CORNER.x - 76, REST_CORNER.y - 26, 152, 56, glow);
  drawPixelRect(REST_CORNER.x - 62, REST_CORNER.y + 2, 54, 18, accent);
  drawPixelRect(REST_CORNER.x - 62, REST_CORNER.y - 8, 54, 12, COLORS.bg1);
  drawPixelRect(REST_CORNER.x - 8, REST_CORNER.y + 2, 22, 14, COLORS.violet);
  drawPixelRect(REST_CORNER.x + 20, REST_CORNER.y - 2, 16, 18, COLORS.amber);
  drawPixelRect(REST_CORNER.x + 24, REST_CORNER.y - 14, 8, 12, COLORS.white);
  drawPixelRect(REST_CORNER.x + 42, REST_CORNER.y, 22, 12, COLORS.bg1);
  drawPixelRect(REST_CORNER.x + 48, REST_CORNER.y - 10, 8, 10, COLORS.white);

  if (active) {
    drawPixelRect(REST_CORNER.x - 54, REST_CORNER.y - 16, 26, 4, COLORS.violet);
    drawPixelRect(REST_CORNER.x + 28, REST_CORNER.y - 18, 18, 4, COLORS.cyan);
  }
}

function cueIntensity(ambientCues, id) {
  return ambientCues?.find((cue) => cue.id === id)?.intensity || "off";
}

function drawPlanningBoard(scene) {
  const intensity = cueIntensity(scene.ambient_cues, "board_glow");
  const glow =
    intensity === "high" ? 0.22 : intensity === "medium" ? 0.14 : 0.08;

  drawPixelRect(268, 44, 104, 52, `rgba(101, 228, 255, ${glow})`);
  drawPixelRect(278, 52, 84, 36, COLORS.ink);
  drawPixelRect(284, 58, 24, 4, COLORS.cyan);
  drawPixelRect(314, 58, 18, 4, COLORS.amber);
  drawPixelRect(338, 58, 14, 4, COLORS.rose);
  drawPixelRect(284, 68, 48, 4, COLORS.white);
  drawPixelRect(284, 76, 60, 4, COLORS.violet);
}

function drawStatusMonitor(scene, frame) {
  const flicker = cueIntensity(scene.ambient_cues, "monitor_flicker");
  const lit = flicker === "medium" ? (frame % 18 < 13 ? COLORS.cyan : COLORS.white) : COLORS.cyan;
  drawPixelRect(520, 32, 62, 32, COLORS.ink);
  drawPixelRect(526, 38, 50, 18, lit);
  drawPixelRect(534, 60, 34, 4, COLORS.bg1);
}

function drawToolRack(scene, frame) {
  const pulse = cueIntensity(scene.ambient_cues, "status_pulse");
  drawPixelRect(548, 176, 30, 64, COLORS.bg1);
  for (let row = 0; row < 4; row += 1) {
    drawPixelRect(552, 184 + row * 14, 22, 4, COLORS.white);
  }

  if (pulse !== "off") {
    const lit = frame % 20 < 10 ? COLORS.mint : COLORS.cyan;
    drawPixelRect(558, 238, 8, 4, lit);
  }
}

function drawDocumentTray(scene) {
  drawPixelRect(468, 230, 38, 26, COLORS.white);
  drawPixelRect(474, 236, 24, 4, COLORS.bg2);
  drawPixelRect(474, 244, 18, 4, COLORS.rose);
}

function drawAmbientProps(scene, frame) {
  drawPlanningBoard(scene);
  drawStatusMonitor(scene, frame);
  drawToolRack(scene, frame);
  drawDocumentTray(scene);
}

function drawFurniture(zone, active) {
  const accent = active ? zone.color : "rgba(255, 255, 255, 0.12)";

  if (zone.furniture === "frontend") {
    drawDesk(zone.x, zone.y, accent, active);
    drawPixelRect(zone.x - 20, zone.y - 44, 40, 28, COLORS.ink);
    drawPixelRect(zone.x - 14, zone.y - 38, 28, 16, zone.color);
    drawPixelRect(zone.x - 10, zone.y - 34, 8, 4, COLORS.white);
    drawPixelRect(zone.x, zone.y - 34, 10, 4, COLORS.rose);
    drawPixelRect(zone.x - 6, zone.y - 26, 18, 4, COLORS.mint);
    drawPixelRect(zone.x - 4, zone.y - 16, 8, 8, COLORS.ink);
  }

  if (zone.furniture === "backend") {
    drawDesk(zone.x, zone.y, accent, active);
    drawPixelRect(zone.x - 22, zone.y - 48, 44, 40, COLORS.ink);
    for (let row = 0; row < 4; row += 1) {
      drawPixelRect(zone.x - 16, zone.y - 40 + row * 8, 32, 4, COLORS.bg2);
      drawPixelRect(
        zone.x + 6,
        zone.y - 40 + row * 8,
        4,
        4,
        row % 2 === 0 ? zone.color : COLORS.amber
      );
    }
  }

  if (zone.furniture === "database") {
    drawDesk(zone.x, zone.y, accent, active);
    drawPixelRect(zone.x - 28, zone.y - 44, 56, 10, COLORS.amber);
    drawPixelRect(zone.x - 28, zone.y - 34, 56, 12, "rgba(255, 204, 102, 0.55)");
    drawPixelRect(zone.x - 28, zone.y - 22, 56, 10, COLORS.amber);
    drawPixelRect(zone.x - 20, zone.y - 10, 40, 8, "rgba(255, 204, 102, 0.45)");
  }

  if (zone.furniture === "review") {
    drawDesk(zone.x, zone.y, accent, active);
    drawPixelRect(zone.x - 24, zone.y - 42, 46, 30, COLORS.white);
    drawPixelRect(zone.x - 18, zone.y - 36, 24, 4, COLORS.bg2);
    drawPixelRect(zone.x - 18, zone.y - 28, 28, 4, COLORS.bg2);
    drawPixelRect(zone.x - 18, zone.y - 20, 20, 4, COLORS.rose);
    drawPixelRect(zone.x + 8, zone.y - 40, 8, 6, COLORS.rose);
  }

  if (zone.furniture === "lab") {
    drawPixelRect(zone.x - 52, zone.y + 30, 104, 10, "rgba(0, 0, 0, 0.24)");
    drawPixelRect(zone.x - 44, zone.y - 10, 88, 30, accent);
    drawPixelRect(zone.x - 34, zone.y - 2, 68, 14, COLORS.bg1);
    drawPixelRect(zone.x - 12, zone.y - 38, 24, 28, zone.color);
    drawPixelRect(zone.x - 6, zone.y - 32, 12, 8, COLORS.white);
  }
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

function drawActivityCue(actor, activity, accent) {
  if (activity === "coding" || activity === "debugging") {
    drawPixelRect(actor.x + 14, actor.y + 8, 8, 6, COLORS.ink);
    drawPixelRect(actor.x + 16, actor.y + 10, 4, 2, accent);
    if (activity === "debugging") {
      drawPixelRect(actor.x + 24, actor.y + 4, 4, 4, COLORS.rose);
    }
  }

  if (activity === "reading" || activity === "reviewing" || activity === "summarizing") {
    drawPixelRect(actor.x - 18, actor.y + 8, 8, 10, COLORS.white);
    drawPixelRect(actor.x - 16, actor.y + 10, 4, 2, accent);
    if (activity === "reviewing") {
      drawPixelRect(actor.x - 8, actor.y + 8, 4, 4, COLORS.rose);
    }
  }
}

function drawAgent(actor, agentState, isPrimary) {
  const zone = zoneById(agentState.assigned_zone === "between_zones" ? "lab" : actor.currentZone);
  const frame = renderState.frame;
  const { body, accent } = actorPalette(actor.id, zone.color);
  const settled = ["coding", "debugging", "reading", "reviewing", "summarizing"].includes(
    agentState.activity
  );
  const y = actor.y + (settled ? (frame % 16 < 8 ? 0 : -1) : 0);
  const direction = actor.facing || 1;
  const armSwing = actor.moving ? ((frame + actor.patrolIndex) % 10 < 5 ? 2 : -2) : settled ? 1 : 0;
  const legSwing = actor.moving ? ((frame + actor.patrolIndex) % 12 < 6 ? 2 : -2) : 0;

  drawPixelRect(actor.x - 18, y + 34, 36, 8, "rgba(0, 0, 0, 0.24)");

  if (isPrimary) {
    drawPixelRect(actor.x - 16, y - 2, 32, 4, accent);
  }

  drawPixelRect(actor.x - 10, y, 20, 20, body);
  drawPixelRect(actor.x - 6, y + 4, 12, 8, COLORS.white);
  drawPixelRect(actor.x - 4, y + 6, 8, 4, COLORS.bg1);
  drawPixelRect(actor.x - 6, y + 20, 12, 14, body);
  drawPixelRect(actor.x - 14 + armSwing, y + 22, 6, 12, body);
  drawPixelRect(actor.x + 8 - armSwing, y + 22, 6, 12, body);
  drawPixelRect(actor.x - 8 - legSwing, y + 34, 6, 10, body);
  drawPixelRect(actor.x + 2 + legSwing, y + 34, 6, 10, body);
  drawPixelRect(actor.x - 4, y + 18, 8, 4, accent);
  drawPixelRect(actor.x + 11 * direction, y + 9, 4, 4, "rgba(255,255,255,0.22)");

  drawActivityCue({ x: actor.x, y }, agentState.activity, accent);
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
  const x = Math.max(18, Math.min(640 - width - 18, actor.x - width / 2));
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
  const x = Math.min(640 - width - 18, zone.labelX + 92);
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
  const x = ((event.clientX - rect.left) / rect.width) * 640;
  const y = ((event.clientY - rect.top) / rect.height) * 420;
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
