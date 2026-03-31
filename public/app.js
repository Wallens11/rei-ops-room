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
  ROOM_LAYOUT
} from "./room-layout.js";
import {
  LAYOUT_STORAGE_KEY,
  collectEditableLayoutEntities,
  createEditableLayout,
  nudgeLayoutEntity,
  parseLayoutDocument,
  serializeLayoutDocument
} from "./layout-editor.js";
import {
  buildRuntimeEventSnapshot,
  reduceRuntimeEventState
} from "./runtime-events.js";
import {
  buildGithubInboxViewModel,
  createEmptyGithubInboxState,
  createGithubInboxErrorState,
  normalizeGithubInboxPayload
} from "./github-inbox.js";
import {
  buildReportOnlyViewModel,
  createEmptyReportOnlyState
} from "./report-only-view.js";
import {
  buildReportOnlyAutopilotViewModel,
  createReportOnlyAutopilotState,
  shouldAutoTriggerReportOnly
} from "./report-only-autopilot.js";
import {
  buildReportOnlyServiceViewModel,
  createEmptyReportOnlyServiceState
} from "./report-only-service-view.js";
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

const INITIAL_LAYOUT = createEditableLayout(ROOM_LAYOUT);
const INITIAL_ZONES = createDefaultZones(INITIAL_LAYOUT);
const CANVAS_WIDTH = ROOM_LAYOUT.canvas.width;
const CANVAS_HEIGHT = ROOM_LAYOUT.canvas.height;
const GITHUB_INBOX_POLL_MS = 30_000;
const REPORT_ONLY_AUTOPILOT_STORAGE_KEY = "codex-pixel-agent-report-only-autopilot";

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
  githubInboxTitle: document.getElementById("github-inbox-title"),
  githubInboxChip: document.getElementById("github-inbox-chip"),
  githubInboxMeta: document.getElementById("github-inbox-meta"),
  githubInboxScope: document.getElementById("github-inbox-scope"),
  githubQueueTitle: document.getElementById("github-queue-title"),
  githubQueueDetail: document.getElementById("github-queue-detail"),
  githubReportTitle: document.getElementById("github-report-title"),
  githubReportDetail: document.getElementById("github-report-detail"),
  githubReportNote: document.getElementById("github-report-note"),
  githubReportButton: document.getElementById("github-report-button"),
  githubAutopilotTitle: document.getElementById("github-autopilot-title"),
  githubAutopilotDetail: document.getElementById("github-autopilot-detail"),
  githubAutopilotNote: document.getElementById("github-autopilot-note"),
  githubAutopilotButton: document.getElementById("github-autopilot-button"),
  githubServiceTitle: document.getElementById("github-service-title"),
  githubServiceDetail: document.getElementById("github-service-detail"),
  githubServiceNote: document.getElementById("github-service-note"),
  githubServiceButton: document.getElementById("github-service-button"),
  githubInboxList: document.getElementById("github-inbox-list"),
  sceneDetailTitle: document.getElementById("scene-detail-title"),
  sceneDetailBody: document.getElementById("scene-detail-body"),
  recentList: document.getElementById("recent-list"),
  crewList: document.getElementById("crew-list"),
  skillList: document.getElementById("skill-list"),
  workstreamList: document.getElementById("workstream-list"),
  eventList: document.getElementById("event-list"),
  runtimePanel: document.getElementById("runtime-panel"),
  viewButtons: [...document.querySelectorAll("[data-mode]")],
  editorToggle: document.getElementById("editor-toggle"),
  editorPanel: document.getElementById("layout-editor"),
  editorEntityList: document.getElementById("editor-entity-list"),
  editorEntityTitle: document.getElementById("editor-entity-title"),
  editorEntityMeta: document.getElementById("editor-entity-meta"),
  editorStatus: document.getElementById("editor-status"),
  editorStepButtons: [...document.querySelectorAll("[data-editor-step]")],
  editorNudgeButtons: [...document.querySelectorAll("[data-editor-nudge]")],
  editorSave: document.getElementById("editor-save"),
  editorReset: document.getElementById("editor-reset"),
  editorExport: document.getElementById("editor-export"),
  editorImport: document.getElementById("editor-import")
};

const renderState = {
  status: "idle",
  frame: 0,
  data: createEmptyState(),
  layout: INITIAL_LAYOUT,
  zones: INITIAL_ZONES,
  mode: "room",
  transportMode: "connecting",
  actors: buildCrewActors(INITIAL_ZONES),
  hotspots: [],
  hoveredHotspot: null,
  selectedHotspot: null,
  runtimeSnapshot: null,
  runtimeEvent: {
    lastEventId: null,
    bubble: null,
    badge: null
  },
  githubInbox: createEmptyGithubInboxState(),
  reportOnly: createEmptyReportOnlyState(),
  reportOnlyService: createEmptyReportOnlyServiceState(),
  autopilot: loadReportOnlyAutopilotState(),
  reducedMotion: false,
  editorActive: false,
  editorSelectionId: "zone:lab",
  editorStep: 8,
  editorMessage: "Room layout masih pakai schema default."
};
let githubInboxPollHandle = null;

const reducedMotionQuery =
  typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-reduced-motion: reduce)")
    : null;

if (reducedMotionQuery) {
  renderState.reducedMotion = reducedMotionQuery.matches;
  const onReducedMotionChange = (event) => {
    renderState.reducedMotion = event.matches;
  };

  if (typeof reducedMotionQuery.addEventListener === "function") {
    reducedMotionQuery.addEventListener("change", onReducedMotionChange);
  } else if (typeof reducedMotionQuery.addListener === "function") {
    reducedMotionQuery.addListener(onReducedMotionChange);
  }
}

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
      transition_emphasis: {
        type: "settled",
        anchor_zone: "lab",
        target_zone_ids: [],
        label: "Hold the room steady",
        intensity: "low"
      },
      desk_occupancy: [],
      handoff_trail: {
        active: false,
        from_zone: null,
        to_zone: null,
        label: null,
        reason: null,
        live: false,
        intensity: "off"
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
  const zones = renderState.zones || [];
  return zones.find((zone) => zone.id === id) || zones[zones.length - 1];
}

function deskAnchor(zone) {
  return {
    x: Math.round(zone.x + 38),
    y: Math.round(zone.y + 54)
  };
}

function transitPoint(zone) {
  return zone.transitAnchor || zone.familyHub || deskAnchor(zone);
}

function hallwayPoint() {
  return currentLayout().hallway?.center || { x: CANVAS_WIDTH / 2, y: 232 };
}

function occupancyForZone(zoneId) {
  return renderState.data.scene?.desk_occupancy?.find((entry) => entry.zone_id === zoneId) || null;
}

function currentLayout() {
  return renderState.layout || ROOM_LAYOUT;
}

function currentRestCornerOrigin() {
  return currentLayout().rest_corner?.origin || ROOM_LAYOUT.rest_corner.origin;
}

function syncDerivedLayout({ resetActors = false } = {}) {
  renderState.zones = createDefaultZones(currentLayout());

  if (resetActors || !renderState.actors?.length) {
    renderState.actors = buildCrewActors(renderState.zones);
  }
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
  const zones = renderState.zones || [];
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

  const desks = zones.map((zone) => ({
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
      const layout = propLayoutById(prop.id, currentLayout());
      const hotspot = layout?.hotspot;
      const origin = layout?.origin || currentRestCornerOrigin();

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

function githubIssueToneLabel(tone) {
  if (tone === "blocked") {
    return "blocked";
  }

  if (tone === "in_progress") {
    return "in progress";
  }

  if (tone === "todo") {
    return "todo";
  }

  if (tone === "loading") {
    return "syncing";
  }

  if (tone === "error") {
    return "offline";
  }

  if (tone === "empty") {
    return "empty";
  }

  return "open";
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

function readSessionJson(key) {
  if (typeof sessionStorage === "undefined") {
    return null;
  }

  try {
    const raw = sessionStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    console.warn("failed to read session storage", error);
    return null;
  }
}

function writeSessionJson(key, value) {
  if (typeof sessionStorage === "undefined") {
    return;
  }

  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.warn("failed to write session storage", error);
  }
}

function loadReportOnlyAutopilotState() {
  return createReportOnlyAutopilotState(readSessionJson(REPORT_ONLY_AUTOPILOT_STORAGE_KEY) || {});
}

function persistReportOnlyAutopilotState() {
  writeSessionJson(REPORT_ONLY_AUTOPILOT_STORAGE_KEY, {
    enabled: renderState.autopilot.enabled,
    lastHandledIssueNumber: renderState.autopilot.lastHandledIssueNumber
  });
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

function editorEntityIdFromHotspot(hotspot) {
  if (!hotspot) {
    return null;
  }

  if (hotspot.kind === "desk") {
    return `zone:${hotspot.zone}`;
  }

  if (hotspot.kind === "prop") {
    return hotspot.id === "rest_corner" ? "rest:rest_corner" : `prop:${hotspot.id}`;
  }

  return null;
}

function loadSavedLayout() {
  try {
    const raw = localStorage.getItem(LAYOUT_STORAGE_KEY);
    if (!raw) {
      return;
    }

    renderState.layout = parseLayoutDocument(raw);
    renderState.editorMessage = "Custom layout dimuat dari device ini.";
    syncDerivedLayout({ resetActors: true });
  } catch (error) {
    console.warn("failed to load saved room layout", error);
    localStorage.removeItem(LAYOUT_STORAGE_KEY);
    renderState.layout = createEditableLayout(ROOM_LAYOUT);
    renderState.editorMessage = "Custom layout rusak, balik ke schema default.";
    syncDerivedLayout({ resetActors: true });
  }
}

function setEditorSelection(entityId) {
  if (!entityId) {
    return;
  }

  renderState.editorSelectionId = entityId;
  renderEditorControls();
}

function setEditorActive(active) {
  renderState.editorActive = active;

  if (active && renderState.mode === "widget") {
    applyMode("room");
  }

  elements.editorPanel.hidden = !active;
  elements.editorToggle.setAttribute("aria-expanded", String(active));
  elements.editorToggle.textContent = active ? "Close Editor" : "Layout Edit";
  document.body.classList.toggle("layout-editor-open", active);
  renderEditorControls();
}

function selectedEditorEntity() {
  return collectEditableLayoutEntities(currentLayout()).find(
    (entity) => entity.id === renderState.editorSelectionId
  ) || collectEditableLayoutEntities(currentLayout())[0];
}

function renderEditorEntityList() {
  if (!elements.editorEntityList) {
    return;
  }

  const entities = collectEditableLayoutEntities(currentLayout());
  elements.editorEntityList.innerHTML = "";

  entities.forEach((entity) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "editor-entity-button";
    button.textContent = entity.title;
    button.dataset.entityId = entity.id;
    button.classList.toggle("is-active", entity.id === renderState.editorSelectionId);
    button.addEventListener("click", () => {
      setEditorSelection(entity.id);
    });
    elements.editorEntityList.appendChild(button);
  });
}

function renderEditorControls() {
  if (!elements.editorPanel) {
    return;
  }

  const entity = selectedEditorEntity();
  if (entity && renderState.editorSelectionId !== entity.id) {
    renderState.editorSelectionId = entity.id;
  }

  renderEditorEntityList();

  if (!entity) {
    elements.editorEntityTitle.textContent = "Select an anchor";
    elements.editorEntityMeta.textContent = "No editable entity selected.";
  } else {
    elements.editorEntityTitle.textContent = entity.title;
    elements.editorEntityMeta.textContent = `${entity.id} | x ${entity.x} | y ${entity.y}`;
  }

  elements.editorStatus.textContent = renderState.editorMessage;
  elements.editorStepButtons.forEach((button) => {
    button.classList.toggle("is-active", Number(button.dataset.editorStep) === renderState.editorStep);
  });
}

function persistLayout(message = "Custom layout disimpan di device ini.") {
  localStorage.setItem(LAYOUT_STORAGE_KEY, serializeLayoutDocument(currentLayout()));
  renderState.editorMessage = message;
  renderEditorControls();
}

function applyEditorNudge(direction) {
  const entity = selectedEditorEntity();
  if (!entity) {
    return;
  }

  const delta =
    direction === "up"
      ? { x: 0, y: -renderState.editorStep }
      : direction === "down"
        ? { x: 0, y: renderState.editorStep }
        : direction === "left"
          ? { x: -renderState.editorStep, y: 0 }
          : { x: renderState.editorStep, y: 0 };

  renderState.layout = nudgeLayoutEntity(currentLayout(), entity.id, delta);
  renderState.editorMessage = `${entity.title} digeser ${renderState.editorStep}px.`;
  syncDerivedLayout();
  renderState.hotspots = buildInteractiveHotspots();
  renderEditorControls();
}

function resetEditorLayout() {
  renderState.layout = createEditableLayout(ROOM_LAYOUT);
  localStorage.removeItem(LAYOUT_STORAGE_KEY);
  renderState.editorMessage = "Layout dibalikin ke schema default.";
  syncDerivedLayout({ resetActors: true });
  renderState.hotspots = buildInteractiveHotspots();
  renderEditorControls();
}

function exportEditorLayout() {
  const blob = new Blob([serializeLayoutDocument(currentLayout())], {
    type: "application/json"
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "rei-ops-room-layout.json";
  link.click();
  URL.revokeObjectURL(url);
  renderState.editorMessage = "Layout JSON diexport.";
  renderEditorControls();
}

async function importEditorLayout(file) {
  if (!file) {
    return;
  }

  try {
    const text = await file.text();
    renderState.layout = parseLayoutDocument(text);
    renderState.editorMessage = "Layout JSON berhasil diimport.";
    syncDerivedLayout({ resetActors: true });
    renderState.hotspots = buildInteractiveHotspots();
    persistLayout("Layout JSON diimport dan disimpan lokal.");
  } catch (error) {
    renderState.editorMessage =
      error instanceof Error ? error.message : "Gagal import layout JSON.";
    renderEditorControls();
  }
}

elements.editorToggle?.addEventListener("click", () => {
  setEditorActive(!renderState.editorActive);
});

elements.editorStepButtons.forEach((button) => {
  button.addEventListener("click", () => {
    renderState.editorStep = Number(button.dataset.editorStep) || 8;
    renderEditorControls();
  });
});

elements.editorNudgeButtons.forEach((button) => {
  button.addEventListener("click", () => {
    applyEditorNudge(button.dataset.editorNudge);
  });
});

elements.editorSave?.addEventListener("click", () => {
  persistLayout();
});

elements.editorReset?.addEventListener("click", () => {
  resetEditorLayout();
});

elements.editorExport?.addEventListener("click", () => {
  exportEditorLayout();
});

elements.editorImport?.addEventListener("change", async (event) => {
  const input = event.currentTarget;
  await importEditorLayout(input.files?.[0] || null);
  input.value = "";
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

function renderGithubInbox(inbox) {
  if (!elements.githubInboxList) {
    return;
  }

  const model = buildGithubInboxViewModel(inbox);
  elements.githubInboxTitle.textContent = truncate(model.title, 56);
  elements.githubInboxChip.textContent = model.chip;
  elements.githubInboxMeta.textContent = model.meta;
  elements.githubInboxScope.textContent = model.scope;
  elements.githubQueueTitle.textContent = truncate(model.queueTitle, 88);
  elements.githubQueueDetail.textContent = truncate(model.queueDetail, 140);
  elements.githubInboxList.innerHTML = "";

  model.rows.forEach((row) => {
    const item = document.createElement("li");
    item.className = `github-issue-item ${row.tone}`;

    const head = document.createElement("div");
    head.className = "item-head";

    const title = document.createElement(row.href ? "a" : "strong");
    title.textContent = row.title;
    if (row.href) {
      title.href = row.href;
      title.target = "_blank";
      title.rel = "noreferrer";
      title.className = "github-issue-link";
    } else {
      title.className = "github-issue-title";
    }

    const chip = document.createElement("span");
    chip.className = "item-chip";
    chip.textContent = githubIssueToneLabel(row.tone);

    head.append(title, chip);

    const detail = document.createElement("p");
    detail.textContent = row.detail;

    const meta = document.createElement("p");
    meta.className = "dim mono";
    meta.textContent = row.meta;

    item.append(head, detail, meta);
    elements.githubInboxList.appendChild(item);
  });
}

function renderReportOnly(state) {
  if (!elements.githubReportButton) {
    return;
  }

  const model = buildReportOnlyViewModel(state);
  elements.githubReportTitle.textContent = model.title;
  elements.githubReportDetail.textContent = model.detail;
  elements.githubReportNote.textContent = model.note;
  elements.githubReportButton.textContent = model.buttonLabel;
  elements.githubReportButton.disabled = model.buttonDisabled;
  elements.githubReportButton.dataset.tone = model.tone;
}

function renderReportOnlyAutopilot() {
  if (!elements.githubAutopilotButton) {
    return;
  }

  const model = buildReportOnlyAutopilotViewModel({
    autopilot: renderState.autopilot,
    reportOnly: renderState.reportOnly
  });

  elements.githubAutopilotTitle.textContent = model.title;
  elements.githubAutopilotDetail.textContent = model.detail;
  elements.githubAutopilotNote.textContent = model.note;
  elements.githubAutopilotButton.textContent = model.buttonLabel;
  elements.githubAutopilotButton.disabled = model.buttonDisabled;
  elements.githubAutopilotButton.dataset.tone = model.tone;
}

function renderReportOnlyService(state) {
  if (!elements.githubServiceTitle || !elements.githubServiceButton) {
    return;
  }

  const model = buildReportOnlyServiceViewModel(state);
  elements.githubServiceTitle.textContent = model.title;
  elements.githubServiceDetail.textContent = model.detail;
  elements.githubServiceNote.textContent = model.note;
  elements.githubServiceTitle.dataset.tone = model.tone;
  elements.githubServiceButton.textContent = model.buttonLabel;
  elements.githubServiceButton.disabled = model.buttonDisabled;
  elements.githubServiceButton.dataset.tone = model.tone;
  elements.githubServiceButton.dataset.action = model.action;
}

async function readJsonResponseOrThrow(response) {
  let payload = null;

  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (response.ok) {
    return payload;
  }

  const error = new Error(payload?.detail || payload?.error || `HTTP ${response.status}`);
  error.status = response.status;
  error.payload = payload;
  throw error;
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
  renderGithubInbox(renderState.githubInbox);
  renderState.hotspots = buildInteractiveHotspots();
  updateSceneDetailCard();
}

async function refreshGithubInbox() {
  if (typeof fetch !== "function") {
    renderState.githubInbox = createGithubInboxErrorState(
      renderState.githubInbox,
      new Error("fetch is not available")
    );
    renderGithubInbox(renderState.githubInbox);
    return;
  }

  try {
    const response = await fetch("/api/github/issues", {
      cache: "no-store"
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const payload = await response.json();
    renderState.githubInbox = normalizeGithubInboxPayload(payload);
  } catch (error) {
    renderState.githubInbox = createGithubInboxErrorState(renderState.githubInbox, error);
  }

  renderGithubInbox(renderState.githubInbox);
}

async function refreshReportOnlyPreview() {
  if (typeof fetch !== "function") {
    renderState.reportOnly = {
      status: "no_target",
      canComment: false,
      target: null,
      detail: "fetch is not available"
    };
    renderReportOnly(renderState.reportOnly);
    renderReportOnlyAutopilot();
    return;
  }

  try {
    const response = await fetch("/api/github/report-only", {
      cache: "no-store"
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    renderState.reportOnly = await response.json();
  } catch (error) {
    renderState.reportOnly = {
      status: "no_target",
      canComment: false,
      target: null,
      detail: error instanceof Error ? error.message : String(error)
    };
  }

  renderReportOnly(renderState.reportOnly);
  renderReportOnlyAutopilot();
  void maybeRunReportOnlyAutopilot();
}

async function refreshReportOnlyService() {
  if (typeof fetch !== "function") {
    renderState.reportOnlyService = {
      status: "error",
      running: false,
      pid: null,
      source: "status_error",
      detail: "fetch is not available"
    };
    renderReportOnlyService(renderState.reportOnlyService);
    return;
  }

  try {
    const response = await fetch("/api/github/report-only/service", {
      cache: "no-store"
    });

    renderState.reportOnlyService = await readJsonResponseOrThrow(response);
    renderState.reportOnlyService.status = renderState.reportOnlyService.running ? "running" : "idle";
  } catch (error) {
    const payload = error?.payload || null;
    renderState.reportOnlyService = {
      status: "error",
      running: false,
      pid: null,
      source: payload?.source || "status_error",
      action: payload?.action || null,
      detail: payload?.detail || (error instanceof Error ? error.message : String(error))
    };
  }

  renderReportOnlyService(renderState.reportOnlyService);
}

async function controlReportOnlyService(action) {
  if (!action || (action !== "start" && action !== "stop")) {
    return;
  }

  renderState.reportOnlyService = {
    ...renderState.reportOnlyService,
    pendingAction: action
  };
  renderReportOnlyService(renderState.reportOnlyService);

  try {
    const response = await fetch("/api/github/report-only/service", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        action
      })
    });

    renderState.reportOnlyService = await readJsonResponseOrThrow(response);
    renderState.reportOnlyService.status = renderState.reportOnlyService.running ? "running" : "idle";
  } catch (error) {
    const payload = error?.payload || null;
    renderState.reportOnlyService = {
      status: "error",
      running: false,
      pid: null,
      source: payload?.source || "control_error",
      action: payload?.action || action,
      detail: payload?.detail || (error instanceof Error ? error.message : String(error))
    };
  }

  renderReportOnlyService(renderState.reportOnlyService);
}

async function triggerReportOnlyComment({ source = "manual" } = {}) {
  elements.githubReportButton.disabled = true;
  elements.githubReportButton.textContent = "Posting...";

  try {
    const response = await fetch("/api/github/report-only", {
      method: "POST"
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    renderState.reportOnly = await response.json();
    if (
      renderState.reportOnly.status === "comment_posted" &&
      Number(renderState.reportOnly?.target?.number || 0) > 0
    ) {
      renderState.autopilot = {
        ...renderState.autopilot,
        lastHandledIssueNumber: Number(renderState.reportOnly.target.number)
      };
      persistReportOnlyAutopilotState();
    }
    renderReportOnly(renderState.reportOnly);
    renderReportOnlyAutopilot();
    await refreshGithubInbox();
    await refreshReportOnlyPreview();
    return renderState.reportOnly;
  } catch (error) {
    renderState.reportOnly = {
      status: "no_target",
      canComment: false,
      target: null,
      detail: error instanceof Error ? error.message : String(error)
    };
    renderReportOnly(renderState.reportOnly);
    renderReportOnlyAutopilot();
    if (source === "autopilot") {
      console.warn("report-only autopilot failed", error);
    }
    return null;
  }
}

async function maybeRunReportOnlyAutopilot() {
  if (
    !shouldAutoTriggerReportOnly({
      autopilot: renderState.autopilot,
      reportOnly: renderState.reportOnly
    })
  ) {
    return;
  }

  renderState.autopilot = {
    ...renderState.autopilot,
    pending: true
  };
  renderReportOnlyAutopilot();

  try {
    await triggerReportOnlyComment({
      source: "autopilot"
    });
  } finally {
    renderState.autopilot = {
      ...renderState.autopilot,
      pending: false
    };
    persistReportOnlyAutopilotState();
    renderReportOnlyAutopilot();
  }
}

function toggleReportOnlyAutopilot() {
  if (renderState.autopilot.pending) {
    return;
  }

  renderState.autopilot = {
    ...renderState.autopilot,
    enabled: !renderState.autopilot.enabled
  };
  persistReportOnlyAutopilotState();
  renderReportOnlyAutopilot();

  if (renderState.autopilot.enabled) {
    void maybeRunReportOnlyAutopilot();
  }
}

function startGithubInboxPolling() {
  if (githubInboxPollHandle) {
    return;
  }

  if (!renderState.githubInbox.issues.length) {
    renderState.githubInbox = {
      ...renderState.githubInbox,
      status: "loading"
    };
    renderGithubInbox(renderState.githubInbox);
  }

  void refreshGithubInbox();
  void refreshReportOnlyPreview();
  void refreshReportOnlyService();
  githubInboxPollHandle = setInterval(() => {
    void refreshGithubInbox();
    void refreshReportOnlyPreview();
    void refreshReportOnlyService();
  }, GITHUB_INBOX_POLL_MS);
}

function stopGithubInboxPolling() {
  if (!githubInboxPollHandle) {
    return;
  }

  clearInterval(githubInboxPollHandle);
  githubInboxPollHandle = null;
}

function drawPixelRect(x, y, w, h, color) {
  context.fillStyle = color;
  context.fillRect(Math.round(x), Math.round(y), w, h);
}

function withAlpha(color, alpha) {
  if (!color) {
    return `rgba(255, 255, 255, ${alpha})`;
  }

  if (color.startsWith("#") && color.length === 7) {
    const red = Number.parseInt(color.slice(1, 3), 16);
    const green = Number.parseInt(color.slice(3, 5), 16);
    const blue = Number.parseInt(color.slice(5, 7), 16);
    return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
  }

  if (color.startsWith("rgb(")) {
    return color.replace("rgb(", "rgba(").replace(")", `, ${alpha})`);
  }

  if (color.startsWith("rgba(")) {
    return color.replace(/rgba\(([^)]+),\s*[\d.]+\)/, `rgba($1, ${alpha})`);
  }

  return color;
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

  const layout = currentLayout();
  const wallGradient = context.createLinearGradient(0, 0, 0, layout.canvas.wall_height);
  wallGradient.addColorStop(0, COLORS.bg2);
  wallGradient.addColorStop(1, COLORS.bg1);
  context.fillStyle = wallGradient;
  context.fillRect(0, 0, CANVAS_WIDTH, layout.canvas.wall_height);

  const glowAlpha =
    tone === "busy" ? 0.22 : tone === "steady" ? 0.18 : tone === "rest" ? 0.08 : 0.12;
  context.fillStyle = `rgba(101, 228, 255, ${glowAlpha})`;
  context.fillRect(220, 26, 200, 14);
  context.fillRect(250, 42, 140, 72);

  context.fillStyle = COLORS.bg2;
  context.fillRect(0, layout.canvas.floor_top, CANVAS_WIDTH, CANVAS_HEIGHT - layout.canvas.floor_top);

  for (let row = 0; row < 12; row += 1) {
    context.strokeStyle = COLORS.floorLine;
    context.beginPath();
    context.moveTo(0, layout.canvas.floor_top + row * 18);
    context.lineTo(CANVAS_WIDTH, layout.canvas.floor_top + row * 18);
    context.stroke();
  }

  for (let col = 0; col < 18; col += 1) {
    context.strokeStyle = "rgba(255, 255, 255, 0.025)";
    context.beginPath();
    context.moveTo(col * 36, layout.canvas.floor_top);
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

function drawRouteMarkers(points, color, { intensity = "medium", live = false } = {}) {
  if (!points || points.length < 2) {
    return;
  }

  const step = renderState.reducedMotion ? 18 : live ? 12 : 16;
  const offset = renderState.reducedMotion ? 0 : (renderState.frame * (live ? 1.65 : 0.8)) % step;
  const alpha =
    intensity === "high" ? 0.42 : intensity === "medium" ? 0.28 : 0.18;
  const square = live ? 4 : 3;

  context.save();
  context.fillStyle = withAlpha(color, alpha);

  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const distance = Math.hypot(dx, dy);

    if (distance === 0) {
      continue;
    }

    for (let progress = offset; progress < distance; progress += step) {
      const ratio = progress / distance;
      const x = start.x + dx * ratio;
      const y = start.y + dy * ratio;
      drawPixelRect(x - square / 2, y - square / 2, square, square, context.fillStyle);
    }
  }

  context.restore();
}

function drawZoneFloorHalo(zoneId, color, intensity = "medium") {
  const zone = zoneById(zoneId);
  const anchor = deskAnchor(zone);
  const alpha =
    intensity === "high" ? 0.18 : intensity === "medium" ? 0.12 : 0.08;
  const width = intensity === "high" ? 72 : intensity === "medium" ? 60 : 48;
  const height = intensity === "high" ? 12 : 8;

  drawPixelRect(anchor.x - width / 2, anchor.y + 18, width, height, withAlpha(color, alpha));
  drawPixelRect(anchor.x - (width - 14) / 2, anchor.y + 22, width - 14, 4, withAlpha(color, alpha * 0.8));
}

function drawFocusBeam(zoneId, color, intensity = "medium") {
  const zone = zoneById(zoneId);
  const anchor = deskAnchor(zone);
  const topY = 42;
  const layers = intensity === "high" ? 5 : 4;
  const startWidth = intensity === "high" ? 26 : 20;
  const endWidth = intensity === "high" ? 84 : 68;

  for (let layer = 0; layer < layers; layer += 1) {
    const ratio = layer / Math.max(1, layers - 1);
    const y = topY + ratio * (anchor.y - 18 - topY);
    const width = startWidth + (endWidth - startWidth) * ratio;
    const alpha = (intensity === "high" ? 0.16 : 0.1) * (1 - ratio * 0.28);
    drawPixelRect(anchor.x - width / 2, y, width, 10, withAlpha(color, alpha));
  }
}

function buildRoutePolyline(fromZoneId, toZoneId) {
  const from = zoneById(fromZoneId || "lab");
  const to = zoneById(toZoneId || "lab");
  const center = hallwayPoint();
  const points = [];
  const fromAnchor = transitPoint(from);
  const toAnchor = transitPoint(to);

  points.push(fromAnchor);

  if (from.id !== "lab") {
    points.push(from.familyHub || center);
  }

  if (from.id !== to.id) {
    points.push(center);
  }

  if (to.id !== "lab") {
    points.push(to.familyHub || center);
  }

  points.push(toAnchor);
  return points.filter((point, index, array) => {
    const previous = array[index - 1];
    return !previous || previous.x !== point.x || previous.y !== point.y;
  });
}

function transitionAccent(scene, emphasis) {
  if (emphasis?.type === "review") {
    return COLORS.rose;
  }

  if (emphasis?.type === "briefing" || emphasis?.type === "rest" || emphasis?.type === "settling") {
    return COLORS.violet;
  }

  const zone = zoneById(emphasis?.anchor_zone || scene?.active_zone?.id || "lab");
  return zone.color || COLORS.cyan;
}

function drawTransitionEmphasis(scene) {
  const emphasis = scene?.transition_emphasis;

  if (!emphasis) {
    return;
  }

  const accent = transitionAccent(scene, emphasis);

  if (emphasis.type === "briefing" || emphasis.type === "rest" || emphasis.type === "settling") {
    drawZoneFloorHalo(emphasis.anchor_zone || "lab", accent, emphasis.intensity);
  }

  if (emphasis.type === "execution") {
    drawFocusBeam(emphasis.anchor_zone || scene?.active_zone?.id || "lab", accent, emphasis.intensity);
    drawZoneFloorHalo(emphasis.anchor_zone || scene?.active_zone?.id || "lab", accent, emphasis.intensity);
  }

  if (emphasis.type === "dispatch" || emphasis.type === "review") {
    drawZoneFloorHalo(emphasis.anchor_zone || "lab", accent, emphasis.intensity);
  }

  (emphasis.target_zone_ids || [])
    .filter((zoneId) => zoneId && zoneId !== emphasis.anchor_zone)
    .forEach((zoneId) => {
      const route = buildRoutePolyline(emphasis.anchor_zone || "lab", zoneId);
      const zoneColor = zoneById(zoneId).color || accent;
      drawRouteMarkers(route, zoneColor, {
        intensity: emphasis.intensity,
        live: emphasis.type === "dispatch"
      });
      drawZoneFloorHalo(zoneId, zoneColor, emphasis.intensity === "high" ? "medium" : "low");
    });
}

function drawHandoffTrail(scene) {
  const trail = scene?.handoff_trail;

  if (!trail?.active || !trail.from_zone || !trail.to_zone) {
    return;
  }

  const route = buildRoutePolyline(trail.from_zone, trail.to_zone);
  const accent = trail.to_zone === "review" ? COLORS.rose : zoneById(trail.to_zone).color || COLORS.cyan;
  drawRouteMarkers(route, accent, {
    intensity: trail.intensity,
    live: trail.live
  });
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
    currentLayout().desk_base.rects,
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
    currentLayout().rest_corner.origin,
    currentLayout().rest_corner.rects,
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
  const layout = propLayoutById("planning_board", currentLayout());
  drawLayoutRects(layout.origin, layout.rects, {
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
  const layout = propLayoutById("status_monitor", currentLayout());
  drawLayoutRects(layout.origin, layout.rects, {
    ink: COLORS.ink,
    monitor_lit: lit,
    bg1: COLORS.bg1
  });
}

function drawToolRack(scene, frame) {
  const pulse = cueIntensity(scene.ambient_cues, "status_pulse");
  const lit = pulse !== "off" ? (frame % 20 < 10 ? COLORS.mint : COLORS.cyan) : "rgba(0,0,0,0)";
  const layout = propLayoutById("tool_rack", currentLayout());
  drawLayoutRects(layout.origin, layout.rects, {
    bg1: COLORS.bg1,
    white: COLORS.white,
    rack_pulse: lit
  });
}

function drawDocumentTray(scene) {
  const layout = propLayoutById("document_tray", currentLayout());
  drawLayoutRects(layout.origin, layout.rects, {
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
  const furniture = furnitureLayoutById(zone.furniture, currentLayout());

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

function occupancyColor(zone, occupancy) {
  if (!occupancy) {
    return withAlpha(zone.color, 0.2);
  }

  if (occupancy.state === "active") {
    return zone.color;
  }

  if (occupancy.state === "queued") {
    return COLORS.amber;
  }

  if (occupancy.state === "rest") {
    return COLORS.violet;
  }

  return withAlpha(COLORS.white, 0.68);
}

function drawDeskOccupancy(zone, occupancy) {
  if (!occupancy?.occupied) {
    return;
  }

  const accent = occupancyColor(zone, occupancy);
  const baseX = zone.x + 16;
  const baseY = zone.y + 14;
  const pips = Math.min(3, occupancy.count || 1);

  drawPixelRect(baseX - 6, baseY - 3, 16 + pips * 8, 7, withAlpha(accent, 0.28));

  for (let index = 0; index < pips; index += 1) {
    drawPixelRect(baseX + index * 8, baseY, 5, 5, accent);
  }

  if ((occupancy.count || 0) > 3) {
    drawPixelRect(baseX + pips * 8, baseY - 1, 8, 7, COLORS.ink);
    context.fillStyle = COLORS.white;
    context.font = "8px monospace";
    context.fillText(String(Math.min(9, occupancy.count)), baseX + pips * 8 + 2, baseY + 5);
  }

  if (occupancy.primary_agent_id) {
    drawPixelRect(zone.x + 8, zone.y + 10, 6, 11, accent);
  }
}

function editorEntityBounds(entityId) {
  if (!entityId) {
    return null;
  }

  if (entityId.startsWith("zone:")) {
    const zone = zoneById(entityId.slice("zone:".length));
    return {
      x: zone.x + (zone.hotspot?.x || -66),
      y: zone.y + (zone.hotspot?.y || -58),
      width: zone.hotspot?.width || 132,
      height: zone.hotspot?.height || 108,
      accent: zone.color
    };
  }

  if (entityId.startsWith("prop:")) {
    const prop = propLayoutById(entityId.slice("prop:".length), currentLayout());
    const hotspot = prop?.hotspot;
    if (!hotspot) {
      return null;
    }

    return {
      x: prop.origin.x + hotspot.x,
      y: prop.origin.y + hotspot.y,
      width: hotspot.width,
      height: hotspot.height,
      accent: COLORS.rose
    };
  }

  if (entityId === "rest:rest_corner") {
    const restCorner = currentLayout().rest_corner;
    return {
      x: restCorner.origin.x + restCorner.hotspot.x,
      y: restCorner.origin.y + restCorner.hotspot.y,
      width: restCorner.hotspot.width,
      height: restCorner.hotspot.height,
      accent: COLORS.violet
    };
  }

  return null;
}

function drawEditorOverlay() {
  if (!renderState.editorActive) {
    return;
  }

  const entities = collectEditableLayoutEntities(currentLayout());
  const pulse = renderState.reducedMotion ? 0.24 : 0.2 + (Math.sin(renderState.frame / 8) + 1) * 0.08;

  entities.forEach((entity) => {
    const bounds = editorEntityBounds(entity.id);
    if (!bounds) {
      return;
    }

    const selected = entity.id === renderState.editorSelectionId;
    const accent = bounds.accent || COLORS.rose;
    const alpha = selected ? pulse : 0.12;

    drawPixelRect(bounds.x, bounds.y, bounds.width, 2, withAlpha(accent, alpha));
    drawPixelRect(bounds.x, bounds.y + bounds.height - 2, bounds.width, 2, withAlpha(accent, alpha));
    drawPixelRect(bounds.x, bounds.y, 2, bounds.height, withAlpha(accent, alpha));
    drawPixelRect(bounds.x + bounds.width - 2, bounds.y, 2, bounds.height, withAlpha(accent, alpha));

    if (selected) {
      const chipWidth = Math.min(156, 36 + entity.title.length * 6);
      const chipX = Math.max(18, Math.min(CANVAS_WIDTH - chipWidth - 18, bounds.x));
      const chipY = Math.max(18, bounds.y - 18);
      drawPixelRect(chipX, chipY, chipWidth, 14, withAlpha(accent, 0.86));
      context.fillStyle = COLORS.ink;
      context.font = "10px monospace";
      context.fillText(truncate(entity.title, 20), chipX + 6, chipY + 10);
    }
  });
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
  drawTransitionEmphasis(data.scene || {});
  drawHandoffTrail(data.scene || {});
  drawSkillBadges(data.scene?.skill_badges || [], Boolean(data.scene?.resting));

  const highlightZones = new Set(data.scene?.desk_highlights || ["lab"]);

  (renderState.zones || []).forEach((zone) => {
    const activeZone = highlightZones.has(zone.id);
    drawZoneLabel(zone, activeZone);
    drawFurniture(zone, activeZone);
    drawDeskOccupancy(zone, occupancyForZone(zone.id));
  });

  drawEditorOverlay();

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
  if (renderState.editorActive) {
    const entityId = editorEntityIdFromHotspot(renderState.selectedHotspot);
    if (entityId) {
      setEditorSelection(entityId);
    }
  }
  updateSceneDetailCard();

  if (renderState.selectedHotspot?.kind === "event") {
    elements.runtimePanel?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
});

window.addEventListener("keydown", (event) => {
  if (!renderState.editorActive) {
    return;
  }

  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) {
    event.preventDefault();
    applyEditorNudge(
      event.key === "ArrowUp"
        ? "up"
        : event.key === "ArrowDown"
          ? "down"
          : event.key === "ArrowLeft"
            ? "left"
            : "right"
    );
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
    zones: renderState.zones
  });
  renderState.hotspots = buildInteractiveHotspots();
  drawScene();
}

loadSavedLayout();
syncDerivedLayout();
initMode();
renderEditorControls();
renderState.hotspots = buildInteractiveHotspots();
renderGithubInbox(renderState.githubInbox);
renderReportOnly(renderState.reportOnly);
renderReportOnlyAutopilot();
renderReportOnlyService(renderState.reportOnlyService);
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
startGithubInboxPolling();
elements.githubReportButton?.addEventListener("click", () => {
  void triggerReportOnlyComment();
});
elements.githubAutopilotButton?.addEventListener("click", () => {
  toggleReportOnlyAutopilot();
});
elements.githubServiceButton?.addEventListener("click", () => {
  void controlReportOnlyService(elements.githubServiceButton.dataset.action || "");
});
window.addEventListener("beforeunload", () => {
  statusTransport.stop();
  stopGithubInboxPolling();
});
