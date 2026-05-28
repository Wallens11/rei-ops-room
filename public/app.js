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
  buildDailyHandoffViewModel,
  createDailyHandoffErrorState,
  createEmptyDailyHandoffState,
  normalizeDailyHandoffPayload
} from "./handoff-view.js";
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
  buildExecuteAgentViewModel,
  createEmptyExecutePreviewState,
  createEmptyExecuteServiceState
} from "./execute-agent-view.js";
import { buildTaskQueueViewModel, buildWorkerStatusBadge } from "./execute-queue-panel.js";
import { pollArtifacts } from "./execute-artifacts-panel.js";
import { pollMetrics } from "./execute-metrics-panel.js";
import { pollRei } from "./rei-brain-panel.js";
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

function escapeHtml(str) {
  if (!str && str !== 0) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

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
  handoffTitle: document.getElementById("handoff-title"),
  handoffChip: document.getElementById("handoff-chip"),
  handoffMeta: document.getElementById("handoff-meta"),
  handoffList: document.getElementById("handoff-list"),
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
  githubExecuteTitle: document.getElementById("github-execute-title"),
  githubExecuteChip: document.getElementById("github-execute-chip"),
  githubExecuteDetail: document.getElementById("github-execute-detail"),
  githubExecuteNote: document.getElementById("github-execute-note"),
  githubExecuteTrust: document.getElementById("github-execute-trust"),
  githubExecuteButton: document.getElementById("github-execute-button"),
  githubExecuteWorker2Button: document.getElementById("github-execute-worker2-button"),
  githubExecuteWorker2Badge: document.getElementById("github-execute-worker2-badge"),
  githubInboxList: document.getElementById("github-inbox-list"),
  taskQueueTitle: document.getElementById("task-queue-title"),
  taskQueueChip: document.getElementById("task-queue-chip"),
  workerStatusBadge: document.getElementById("worker-status-badge"),
  taskQueueInput: document.getElementById("task-queue-input"),
  taskQueueRuntime: document.getElementById("task-queue-runtime"),
  taskQueueSubmit: document.getElementById("task-queue-submit"),
  taskQueueList: document.getElementById("task-queue-list"),
  handoffGenerateButton: document.getElementById("handoff-generate-button"),
  handoffGenerateStatus: document.getElementById("handoff-generate-status"),
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
  editorImport: document.getElementById("editor-import"),
  demoBanner: document.getElementById("demo-banner")
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
  dailyHandoff: createEmptyDailyHandoffState(),
  githubInbox: createEmptyGithubInboxState(),
  reportOnly: createEmptyReportOnlyState(),
  reportOnlyService: createEmptyReportOnlyServiceState(),
  executePreview: createEmptyExecutePreviewState(),
  executeService: createEmptyExecuteServiceState(),
  executeServiceWorker2: createEmptyExecuteServiceState(),
  taskQueue: { tasks: [], submitting: false },
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
      current_task: "Rei on standby",
      current_repo: "workspace",
      mode: "solo",
      status: "idle",
      phase_reason: ROOM_PHASES.standby.summary,
      focus_reason: "Rei scanning — no hot desk yet."
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
        reason: "Rei scanning — no hot desk yet."
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
      focus_reason: "Rei scanning — no hot desk yet."
    },
    activity: {
      summary: "No thread log yet",
      source: "thread",
      lastLogAgo: "— rei watching —"
    },
    objective: {
      title: "No active objective. Rei is watching.",
      detail: "New threads appear here when Rei picks up an issue.",
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

let _hotspotsCache = null;
let _hotspotsCacheDataRef = null;
let _hotspotsCacheActorsRef = null;
let _hotspotsCacheZonesRef = null;
let _hotspotsCacheVersion = 0;

function invalidateHotspotsCache() {
  _hotspotsCacheVersion += 1;
}

function buildInteractiveHotspots() {
  const dataRef = renderState.data;
  const actorsRef = renderState.actors;
  const zonesRef = renderState.zones;
  if (
    _hotspotsCache !== null &&
    dataRef === _hotspotsCacheDataRef &&
    actorsRef === _hotspotsCacheActorsRef &&
    zonesRef === _hotspotsCacheZonesRef
  ) {
    return _hotspotsCache;
  }
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
  const result = buildSceneHotspots({ agents, desks, events, props });
  _hotspotsCache = result;
  _hotspotsCacheDataRef = dataRef;
  _hotspotsCacheActorsRef = actorsRef;
  _hotspotsCacheZonesRef = zonesRef;
  return result;
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

function handoffToneLabel(tone) {
  if (tone === "error") {
    return "offline";
  }

  if (tone === "loading") {
    return "syncing";
  }

  if (tone === "empty") {
    return "empty";
  }

  return "ready";
}

function executeToneLabel(tone) {
  if (tone === "error") {
    return "offline";
  }

  if (tone === "loading") {
    return "syncing";
  }

  if (tone === "idle") {
    return "idle";
  }

  return "ready";
}

function formatConfidence(value) {
  return `${Math.round((value || 0) * 100)}%`;
}

function updateActivityAgeLabel() {
  const prefix = transportLabel(renderState.transportMode);
  const ageLabel = renderState.data?.activity?.lastLogAgo || "— rei watching —";

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
    renderState.editorMessage = "Layout JSON imported successfully.";
    syncDerivedLayout({ resetActors: true });
    renderState.hotspots = buildInteractiveHotspots();
    persistLayout("Layout JSON imported and saved locally.");
  } catch (error) {
    renderState.editorMessage =
      error instanceof Error ? error.message : "Failed to import layout JSON.";
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
        <strong>${escapeHtml(thread.repoName)}</strong>
        <span class="item-chip">${escapeHtml(thread.updatedAgo)}</span>
      </div>
      <p class="mono dim">${escapeHtml(thread.cwdDisplay)}</p>
      <p>${escapeHtml(truncate(thread.title, 86))}</p>
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
      <p class="dim">Other repos will appear here as light snapshots.</p>
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
      <h4>${escapeHtml(room.repo)}</h4>
      <p class="dim mono">${escapeHtml(room.recent_thread_count)} recent thread${room.recent_thread_count > 1 ? "s" : ""} | ${escapeHtml(room.status)} | ${escapeHtml(room.updated_ago)}</p>
      <p class="dim">${escapeHtml(truncate(room.latest_title, 72))}</p>
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

function renderDailyHandoff(state) {
  if (!elements.handoffList) {
    return;
  }

  const model = buildDailyHandoffViewModel(state);
  const primaryTone = model.rows[0]?.tone || state.status || "loading";
  elements.handoffTitle.textContent = truncate(model.title, 56);
  elements.handoffMeta.textContent = model.meta;
  elements.handoffChip.textContent = handoffToneLabel(primaryTone);
  elements.handoffList.innerHTML = "";

  model.rows.forEach((row) => {
    const item = document.createElement("li");
    item.className = `github-issue-item ${row.tone}`;

    const head = document.createElement("div");
    head.className = "item-head";

    const title = document.createElement("strong");
    title.className = "github-issue-title";
    title.textContent = row.title;

    const chip = document.createElement("span");
    chip.className = "item-chip";
    chip.textContent = handoffToneLabel(row.tone);

    head.append(title, chip);

    const detail = document.createElement("p");
    detail.textContent = row.detail;

    const note = document.createElement("p");
    note.className = "dim mono";
    note.textContent = row.note;

    item.append(head, detail, note);
    elements.handoffList.appendChild(item);
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

function renderExecuteAgent() {
  if (!elements.githubExecuteTitle || !elements.githubExecuteButton) {
    return;
  }

  const model = buildExecuteAgentViewModel({
    preview: renderState.executePreview,
    service: renderState.executeService
  });
  elements.githubExecuteTitle.textContent = model.title;
  elements.githubExecuteDetail.textContent = model.detail;
  elements.githubExecuteNote.textContent = model.note;
  elements.githubExecuteChip.textContent = executeToneLabel(model.tone);
  elements.githubExecuteButton.textContent = model.buttonLabel;
  elements.githubExecuteButton.disabled = model.buttonDisabled;
  elements.githubExecuteButton.dataset.tone = model.tone;
  elements.githubExecuteButton.dataset.action = model.action;

  if (elements.githubExecuteTrust) {
    elements.githubExecuteTrust.innerHTML = "";
    const signals = Array.isArray(model.signals) ? model.signals.filter(Boolean).slice(0, 4) : [];
    elements.githubExecuteTrust.hidden = signals.length === 0;

    for (const signal of signals) {
      const item = document.createElement("li");
      item.className = "dim mono";
      item.textContent = signal;
      elements.githubExecuteTrust.appendChild(item);
    }
  }

  // Worker 2 badge + button
  if (elements.githubExecuteWorker2Badge && elements.githubExecuteWorker2Button) {
    const w2 = renderState.executeServiceWorker2;
    const w2Running = w2?.running === true;
    elements.githubExecuteWorker2Badge.textContent = w2Running ? "running" : "stopped";
    elements.githubExecuteWorker2Badge.style.opacity = w2Running ? "1" : "0.5";
    elements.githubExecuteWorker2Button.textContent = w2Running ? "Stop Worker 2" : "Start Worker 2";
    elements.githubExecuteWorker2Button.dataset.action = w2Running ? "stop" : "start";
    elements.githubExecuteWorker2Button.disabled = w2?.pendingAction === "start" || w2?.pendingAction === "stop";
  }
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
        <strong>${escapeHtml(workstream.owner.toUpperCase())}</strong>
        <span class="item-chip">${escapeHtml(workstreamStatusLabel(workstream.status))}</span>
      </div>
      <p>${escapeHtml(truncate(workstream.task, 92))}</p>
      <p class="dim mono">${escapeHtml(workstream.zone)}</p>
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
        <strong>${escapeHtml(EVENT_LABELS[event.type] || event.type)}</strong>
      </div>
      <p>${escapeHtml(describeEvent(event))}</p>
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
        <strong class="crew-name">${escapeHtml(agent.display_name)}</strong>
        <span class="crew-state">${escapeHtml(ACTIVITY_LABELS[agent.activity] || agent.activity)}</span>
      </div>
      <p class="crew-note">${escapeHtml(crewNote(agent, workstreams))}</p>
      <p class="dim mono">${escapeHtml(agent.assigned_zone)}</p>
    `;
    elements.crewList.appendChild(item);
  });
}

let demoBannerShown = false;

function applyStatus(data) {
  // Show demo banner once when server reports demo: true
  if (data.demo && !demoBannerShown && elements.demoBanner) {
    elements.demoBanner.hidden = false;
    demoBannerShown = true;
  }

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
    data.objective?.title || data.room.current_task || "No active objective. Rei is watching.",
    76
  );
  elements.objectiveMeta.textContent = `${data.objective?.focus_title || data.scene.focus_title || "Lead Table"} | ${data.room.mode}`;
  elements.objectiveRepoChip.textContent = data.objective?.repo || data.room.current_repo || "workspace";
  elements.objectivePhaseChip.textContent = data.objective?.phase_title || data.scene.phase_title || "Standby";
  elements.objectiveDetail.textContent = truncate(
    data.objective?.detail || data.thread?.title || "No active thread yet.",
    160
  );

  elements.runtimeLiveTitle.textContent = truncate(
    data.runtime?.live_now?.title || "No live activity.",
    88
  );
  elements.runtimeLiveMeta.textContent = data.runtime?.live_now
    ? `${data.runtime.live_now.source_label} | ${data.runtime.live_now.age_label}`
    : "room idle";
  elements.runtimeFinishedTitle.textContent = truncate(
    data.runtime?.last_finished?.title || "Nothing finished yet.",
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
    elements.repoContextTitle.textContent = "No specific repo context yet.";
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

async function refreshDailyHandoff() {
  if (typeof fetch !== "function") {
    renderState.dailyHandoff = createDailyHandoffErrorState(
      renderState.dailyHandoff,
      new Error("fetch is not available")
    );
    renderDailyHandoff(renderState.dailyHandoff);
    return;
  }

  try {
    const response = await fetch("/api/handoff", {
      cache: "no-store"
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const payload = await response.json();
    renderState.dailyHandoff = normalizeDailyHandoffPayload(payload);
  } catch (error) {
    renderState.dailyHandoff = createDailyHandoffErrorState(renderState.dailyHandoff, error);
  }

  renderDailyHandoff(renderState.dailyHandoff);
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

async function refreshExecutePreview() {
  if (typeof fetch !== "function") {
    renderState.executePreview = {
      status: "no_target",
      target: null,
      detail: "fetch is not available"
    };
    renderExecuteAgent();
    return;
  }

  try {
    const response = await fetch("/api/github/execute", {
      cache: "no-store"
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    renderState.executePreview = await response.json();
  } catch (error) {
    renderState.executePreview = {
      status: "no_target",
      target: null,
      detail: error instanceof Error ? error.message : String(error)
    };
  }

  renderExecuteAgent();
}

async function refreshExecuteService() {
  if (typeof fetch !== "function") {
    renderState.executeService = {
      status: "error",
      running: false,
      pid: null,
      source: "status_error",
      detail: "fetch is not available",
      currentTarget: null
    };
    renderExecuteAgent();
    return;
  }

  const prevLastResult = renderState.executeService?.lastResult;

  try {
    const response = await fetch("/api/github/execute/service", {
      cache: "no-store"
    });

    renderState.executeService = await readJsonResponseOrThrow(response);
    renderState.executeService.status = renderState.executeService.running ? "running" : "idle";
  } catch (error) {
    const payload = error?.payload || null;
    renderState.executeService = {
      status: "error",
      running: false,
      pid: null,
      source: payload?.source || "status_error",
      action: payload?.action || null,
      detail: payload?.detail || (error instanceof Error ? error.message : String(error)),
      currentTarget: payload?.currentTarget || null
    };
  }

  // Refresh artifact + metrics panels when a run just completed (lastResult changed)
  const newLastResult = renderState.executeService?.lastResult;
  if (
    newLastResult &&
    newLastResult.finishedAt !== prevLastResult?.finishedAt &&
    (newLastResult.status === "completed" || newLastResult.status === "blocked" || newLastResult.status === "failed")
  ) {
    void pollArtifacts();
    void pollMetrics();
    void pollRei();

    // Celebrate / lament — pixel particle burst over the lead actor
    try {
      const leadActor = renderState.actors?.find?.((a) => a.id === "lead") || renderState.actors?.[0];
      if (leadActor && typeof spawnBurst === "function") {
        if (newLastResult.status === "completed") {
          spawnBurst("confetti", leadActor.x, leadActor.y - 30, 18);
        } else if (newLastResult.status === "failed" || newLastResult.status === "blocked") {
          spawnBurst("sparks", leadActor.x, leadActor.y - 20, 14);
        }
      }
    } catch { /* particle system is best-effort */ }
  }

  renderExecuteAgent();
}

async function approveExecuteIssue() {
  const issueNumber = renderState.executePreview?.target?.number;
  if (!issueNumber) return;

  try {
    const res = await fetch(`/api/github/issues/${encodeURIComponent(issueNumber)}/approve`, {
      method: "POST"
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await refreshExecutePreview();
    await refreshGithubInbox();
  } catch {
    // ignore — UI will refresh on next poll
  }
}

async function controlExecuteService(action) {
  if (action === "approve") {
    await approveExecuteIssue();
    return;
  }

  if (!action || (action !== "start" && action !== "stop")) {
    return;
  }

  renderState.executeService = {
    ...renderState.executeService,
    pendingAction: action
  };
  renderExecuteAgent();

  try {
    const response = await fetch("/api/github/execute/service", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        action
      })
    });

    renderState.executeService = await readJsonResponseOrThrow(response);
    renderState.executeService.status = renderState.executeService.running ? "running" : "idle";
  } catch (error) {
    const payload = error?.payload || null;
    renderState.executeService = {
      status: "error",
      running: false,
      pid: null,
      source: payload?.source || "control_error",
      action: payload?.action || action,
      detail: payload?.detail || (error instanceof Error ? error.message : String(error)),
      currentTarget: payload?.currentTarget || null
    };
  }

  renderExecuteAgent();
  await refreshGithubInbox();
  await refreshExecutePreview();
}

async function controlExecuteServiceWorker2(action) {
  if (!action || (action !== "start" && action !== "stop")) return;

  renderState.executeServiceWorker2 = {
    ...renderState.executeServiceWorker2,
    pendingAction: action
  };
  renderExecuteAgent();

  try {
    const response = await fetch("/api/github/execute/service", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, workerIndex: 2 })
    });

    const payload = await readJsonResponseOrThrow(response);
    renderState.executeServiceWorker2 = {
      ...payload,
      status: payload.running ? "running" : "idle"
    };
  } catch (error) {
    const payload = error?.payload || null;
    renderState.executeServiceWorker2 = {
      status: "error",
      running: false,
      pid: null,
      source: payload?.source || "control_error",
      action: payload?.action || action,
      detail: payload?.detail || (error instanceof Error ? error.message : String(error)),
      currentTarget: null
    };
  }

  renderExecuteAgent();
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

// ─── Task Queue Panel ─────────────────────────────────────────────────────────

function renderTaskQueue() {
  if (!elements.taskQueueList) return;

  const { chip, rows } = buildTaskQueueViewModel(renderState.taskQueue.tasks);

  if (elements.taskQueueChip) elements.taskQueueChip.textContent = chip;

  if (rows.length === 0) {
    elements.taskQueueList.innerHTML =
      '<li style="font-size:12px;font-family:monospace;color:var(--muted);">No tasks yet.</li>';
    return;
  }

  elements.taskQueueList.innerHTML = rows.map((row) => {
    const cancelBtn = row.canCancel
      ? `<button class="task-cancel-btn" data-task-id="${escapeHtml(row.id)}" title="Delete task" style="flex-shrink:0;background:none;border:none;cursor:pointer;color:var(--muted);font-size:12px;padding:2px 4px;line-height:1;opacity:0.5;" onmouseover="this.style.opacity='1'" onmouseout="this.style.opacity='0.5'">✕</button>`
      : "";
    const logLink = (row.taskIdShort && (row.statusLabel === "done" || row.statusLabel === "failed"))
      ? `<details style="margin:4px 0 0 28px;">
          <summary style="font-size:11px;font-family:monospace;color:var(--muted);cursor:pointer;user-select:none;">view run log</summary>
          <div class="task-run-log" data-task-id="${escapeHtml(row.id)}" style="font-size:11px;font-family:monospace;color:var(--muted);margin-top:4px;white-space:pre-wrap;word-break:break-word;">Loading...</div>
          <a href="/api/execute/runs/${escapeHtml(row.taskIdShort)}" target="_blank" style="font-size:10px;font-family:monospace;color:var(--muted);">view full log →</a>
        </details>`
      : "";
    return `<li>
      <div style="display:flex;align-items:flex-start;gap:8px;">
        <span class="item-chip" data-tone="${row.tone}" style="flex-shrink:0;font-size:10px;padding:3px 7px;">${escapeHtml(row.statusLabel)}</span>
        <span style="font-size:12px;font-family:monospace;word-break:break-word;flex:1;">${escapeHtml(row.label)}</span>
        <span style="font-size:10px;font-family:monospace;color:var(--muted);flex-shrink:0;">${escapeHtml(row.runtime)}</span>
        ${cancelBtn}
      </div>${row.result ? `
      <p style="font-size:11px;font-family:monospace;color:var(--muted);margin:4px 0 0 28px;">${escapeHtml(row.result.length > 100 ? row.result.slice(0, 100) + "…" : row.result)}</p>` : ""}
      ${logLink}
    </li>`;
  }).join("");

  // Attach cancel button handlers
  elements.taskQueueList.querySelectorAll(".task-cancel-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const taskId = btn.dataset.taskId;
      if (!taskId) return;
      try {
        const res = await fetch(`/api/execute/queue/${encodeURIComponent(taskId)}`, { method: "DELETE" });
        if (res.ok || res.status === 404) {
          await refreshTaskQueue();
        }
      } catch { /* ignore */ }
    });
  });

  // Attach run log lazy-load handlers
  elements.taskQueueList.querySelectorAll("details").forEach((det) => {
    det.addEventListener("toggle", async () => {
      if (!det.open) return;
      const logDiv = det.querySelector(".task-run-log");
      if (!logDiv || logDiv.dataset.loaded) return;
      const taskId = logDiv.dataset.taskId;
      try {
        const res = await fetch(`/api/execute/runs/${encodeURIComponent(taskId.slice(0, 8))}`, { cache: "no-store" });
        if (!res.ok) { logDiv.textContent = "Run log not found."; return; }
        const data = await res.json();
        const msg = data.lastMessage || "(empty)";
        logDiv.textContent = msg.length > 600 ? msg.slice(0, 600) + "…" : msg;
        logDiv.dataset.loaded = "1";
      } catch {
        logDiv.textContent = "Failed to load run log.";
      }
    });
  });
}

function updateTaskQueueSubmitButton() {
  if (!elements.taskQueueSubmit) return;
  const hasInput = (elements.taskQueueInput?.value || "").trim().length > 0;
  elements.taskQueueSubmit.disabled = !hasInput || renderState.taskQueue.submitting;
}

async function refreshTaskQueue() {
  if (typeof fetch !== "function") return;
  try {
    const response = await fetch("/api/execute/queue", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    renderState.taskQueue.tasks = Array.isArray(data?.tasks) ? data.tasks : [];
  } catch {
    // keep existing state on error
  }
  renderTaskQueue();
}

async function refreshWorkerStatus() {
  if (typeof fetch !== "function") return;
  if (!elements.workerStatusBadge) return;
  try {
    const response = await fetch("/api/execute/workers", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const badge = buildWorkerStatusBadge(Array.isArray(data?.workers) ? data.workers : []);
    elements.workerStatusBadge.textContent = `worker ${badge}`;
    elements.workerStatusBadge.style.color = badge === "running" ? "var(--mint, #7cffba)" : "";
  } catch {
    elements.workerStatusBadge.textContent = "worker stopped";
  }
}

async function submitDirectTask() {
  const task = (elements.taskQueueInput?.value || "").trim();
  if (!task || renderState.taskQueue.submitting) return;

  renderState.taskQueue.submitting = true;
  updateTaskQueueSubmitButton();

  try {
    const runtimeId = elements.taskQueueRuntime?.value || null;
    await fetch("/api/execute/submit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ task, runtimeId: runtimeId || null })
    });
    if (elements.taskQueueInput) elements.taskQueueInput.value = "";
    await refreshTaskQueue();
  } catch {
    // ignore submit errors — task list will reflect true state on next poll
  } finally {
    renderState.taskQueue.submitting = false;
    updateTaskQueueSubmitButton();
  }
}

function startGithubInboxPolling() {
  if (githubInboxPollHandle) {
    return;
  }

  if (!renderState.dailyHandoff.sections.length) {
    renderState.dailyHandoff = createEmptyDailyHandoffState();
    renderDailyHandoff(renderState.dailyHandoff);
  }

  if (!renderState.githubInbox.issues.length) {
    renderState.githubInbox = {
      ...renderState.githubInbox,
      status: "loading"
    };
    renderGithubInbox(renderState.githubInbox);
  }

  void refreshDailyHandoff();
  void refreshGithubInbox();
  void refreshReportOnlyPreview();
  void refreshReportOnlyService();
  void refreshExecutePreview();
  void refreshExecuteService();
  void refreshTaskQueue();
  void refreshWorkerStatus();
  githubInboxPollHandle = setInterval(() => {
    void refreshDailyHandoff();
    void refreshGithubInbox();
    void refreshReportOnlyPreview();
    void refreshReportOnlyService();
    void refreshExecutePreview();
    void refreshExecuteService();
    void refreshTaskQueue();
    void refreshWorkerStatus();
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

const _withAlphaCache = new Map();
const _WITH_ALPHA_CACHE_MAX = 200;

function withAlpha(color, alpha) {
  const key = `${color}\0${alpha}`;
  const cached = _withAlphaCache.get(key);
  if (cached !== undefined) {
    return cached;
  }

  let result;
  if (!color) {
    result = `rgba(255, 255, 255, ${alpha})`;
  } else if (color.startsWith("#") && color.length === 7) {
    const red = Number.parseInt(color.slice(1, 3), 16);
    const green = Number.parseInt(color.slice(3, 5), 16);
    const blue = Number.parseInt(color.slice(5, 7), 16);
    result = `rgba(${red}, ${green}, ${blue}, ${alpha})`;
  } else if (color.startsWith("rgb(")) {
    result = color.replace("rgb(", "rgba(").replace(")", `, ${alpha})`);
  } else if (color.startsWith("rgba(")) {
    result = color.replace(/rgba\(([^)]+),\s*[\d.]+\)/, `rgba($1, ${alpha})`);
  } else {
    result = color;
  }

  if (_withAlphaCache.size >= _WITH_ALPHA_CACHE_MAX) {
    _withAlphaCache.clear();
  }
  _withAlphaCache.set(key, result);
  return result;
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

// ─── Cozy ambient elements ────────────────────────────────────────────────────

function drawWarmLamp(x, y, frame) {
  // Lamp pole
  drawPixelRect(x - 2, y, 4, 28, COLORS.bg1);
  // Lamp shade
  drawPixelRect(x - 10, y - 8, 20, 8, COLORS.amber);
  drawPixelRect(x - 8, y - 12, 16, 6, COLORS.amber);
  // Warm glow cone — flickering slightly
  const flicker = 0.18 + Math.sin(frame * 0.07 + x) * 0.04;
  context.save();
  const grad = context.createRadialGradient(x, y, 2, x, y + 20, 38);
  grad.addColorStop(0, `rgba(255, 200, 100, ${flicker})`);
  grad.addColorStop(1, "rgba(255, 200, 100, 0)");
  context.fillStyle = grad;
  context.fillRect(x - 38, y, 76, 60);
  context.restore();
  // Bulb
  drawPixelRect(x - 3, y - 2, 6, 4, "rgba(255, 240, 180, 0.9)");
}

function drawPlant(x, y) {
  // Pot
  drawPixelRect(x - 6, y + 10, 12, 8, COLORS.rose);
  drawPixelRect(x - 5, y + 12, 10, 6, "rgba(255, 144, 124, 0.6)");
  // Soil
  drawPixelRect(x - 5, y + 10, 10, 3, "#2a1a0e");
  // Stems
  drawPixelRect(x - 1, y - 8, 2, 18, COLORS.mint);
  drawPixelRect(x - 5, y, 2, 10, COLORS.mint);
  drawPixelRect(x + 3, y + 2, 2, 8, COLORS.mint);
  // Leaves
  drawPixelRect(x - 10, y - 6, 10, 6, COLORS.mint);
  drawPixelRect(x + 2, y - 8, 8, 6, COLORS.mint);
  drawPixelRect(x - 8, y + 2, 8, 5, "rgba(124, 255, 186, 0.7)");
  drawPixelRect(x + 1, y + 3, 7, 5, "rgba(124, 255, 186, 0.7)");
}

function drawCoffee(x, y, frame) {
  // Mug body
  drawPixelRect(x - 6, y, 12, 10, COLORS.white);
  drawPixelRect(x - 5, y + 1, 10, 8, "rgba(40, 20, 10, 0.85)");
  // Handle
  drawPixelRect(x + 6, y + 2, 3, 6, COLORS.white);
  // Steam particles
  if (!renderState.reducedMotion) {
    const t = frame * 0.06;
    const steamAlpha = 0.28 + Math.sin(t) * 0.1;
    context.save();
    context.fillStyle = `rgba(237, 243, 255, ${steamAlpha})`;
    // Three wispy steam particles at different phases
    [[x - 2, -10, 0], [x + 1, -14, 1.2], [x - 1, -18, 2.4]].forEach(([sx, dy, phase]) => {
      const wobble = Math.sin(t + phase) * 3;
      const rise = ((t * 20 + phase * 10) % 16);
      context.fillRect(sx + wobble, y + dy - rise + 16, 2, 3);
    });
    context.restore();
  }
  // Liquid surface shine
  drawPixelRect(x - 4, y + 2, 4, 2, "rgba(255, 200, 140, 0.4)");
}

function drawBookshelf(x, y) {
  // Shelf planks
  drawPixelRect(x, y, 64, 4, COLORS.bg1);
  drawPixelRect(x, y + 24, 64, 4, COLORS.bg1);
  drawPixelRect(x, y + 48, 64, 4, COLORS.bg1);
  // Side panels
  drawPixelRect(x, y, 4, 52, COLORS.bg1);
  drawPixelRect(x + 60, y, 4, 52, COLORS.bg1);
  // Books row 1 (various widths and colors)
  const books1 = [
    { w: 6, c: COLORS.cyan },   { w: 4, c: COLORS.violet },
    { w: 8, c: COLORS.mint },   { w: 5, c: COLORS.amber },
    { w: 6, c: COLORS.rose },   { w: 4, c: COLORS.cyan },
    { w: 7, c: COLORS.violet },
  ];
  let bx = x + 5;
  books1.forEach(({ w, c }) => {
    drawPixelRect(bx, y + 4, w, 18, c);
    drawPixelRect(bx, y + 4, w, 2, "rgba(255,255,255,0.2)");
    bx += w + 1;
  });
  // Books row 2
  const books2 = [
    { w: 5, c: COLORS.rose },   { w: 7, c: COLORS.amber },
    { w: 4, c: COLORS.cyan },   { w: 8, c: COLORS.mint },
    { w: 5, c: COLORS.violet }, { w: 6, c: COLORS.rose },
  ];
  let bx2 = x + 5;
  books2.forEach(({ w, c }) => {
    drawPixelRect(bx2, y + 28, w, 18, c);
    drawPixelRect(bx2, y + 28, w, 2, "rgba(255,255,255,0.2)");
    bx2 += w + 2;
  });
}

function drawClock(x, y, frame) {
  // Clock face
  drawPixelRect(x - 12, y - 12, 24, 24, COLORS.bg1);
  drawPixelRect(x - 10, y - 10, 20, 20, "rgba(13, 31, 49, 0.9)");
  drawPixelRect(x - 11, y - 11, 22, 2, COLORS.cyan);
  drawPixelRect(x - 11, y + 9, 22, 2, COLORS.cyan);
  drawPixelRect(x - 11, y - 11, 2, 22, COLORS.cyan);
  drawPixelRect(x + 9, y - 11, 2, 22, COLORS.cyan);
  // Clock hands (animated slowly)
  const seconds = (frame / 30) % 60; // ~30fps
  const minutes = seconds / 60;
  const minuteAngle = minutes * Math.PI * 2 - Math.PI / 2;
  const hourAngle = (minutes / 12) * Math.PI * 2 - Math.PI / 2;
  context.save();
  // Minute hand
  context.strokeStyle = COLORS.white;
  context.lineWidth = 1.5;
  context.beginPath();
  context.moveTo(x, y);
  context.lineTo(x + Math.cos(minuteAngle) * 7, y + Math.sin(minuteAngle) * 7);
  context.stroke();
  // Hour hand
  context.strokeStyle = COLORS.cyan;
  context.lineWidth = 1.5;
  context.beginPath();
  context.moveTo(x, y);
  context.lineTo(x + Math.cos(hourAngle) * 5, y + Math.sin(hourAngle) * 5);
  context.stroke();
  // Center dot
  context.fillStyle = COLORS.white;
  context.fillRect(x - 1, y - 1, 2, 2);
  context.restore();
}

function drawDustParticles(frame, tone) {
  if (renderState.reducedMotion || tone === "busy") return;
  // Subtle floating dust motes when calm/rest — adds life to the room
  const alpha = tone === "rest" ? 0.22 : 0.12;
  context.save();
  context.fillStyle = `rgba(237, 243, 255, ${alpha})`;
  // Use deterministic pseudo-random positions that drift upward
  const seeds = [0.13, 0.37, 0.61, 0.82, 0.24, 0.55, 0.78, 0.42, 0.67, 0.91];
  seeds.forEach((seed, i) => {
    const speed = 0.15 + seed * 0.1;
    const x = ((seed * 580 + i * 63) % 580) + 30;
    const yBase = ((frame * speed + seed * 400) % 300) + 80;
    const wobble = Math.sin(frame * 0.03 + seed * 6) * 6;
    context.globalAlpha = alpha * (0.5 + Math.sin(frame * 0.05 + seed * 4) * 0.5);
    context.fillRect(x + wobble, yBase, 2, 2);
  });
  context.restore();
}

function drawWindowWithLight(frame, tone) {
  // Window frame
  drawPixelRect(220, 20, 200, 72, COLORS.bg2);
  drawPixelRect(222, 22, 196, 68, "rgba(101, 228, 255, 0.06)");

  // Sky color varies by tone
  const skyColor = tone === "rest"
    ? "rgba(30, 20, 80, 0.9)"
    : tone === "busy"
      ? "rgba(20, 60, 100, 0.85)"
      : "rgba(15, 40, 80, 0.8)";
  drawPixelRect(224, 24, 192, 64, skyColor);

  // Window panes (cross dividers)
  drawPixelRect(318, 24, 4, 64, COLORS.bg2);  // vertical
  drawPixelRect(224, 55, 192, 4, COLORS.bg2); // horizontal

  // Stars in night mode
  if (tone === "rest") {
    [[250, 36], [290, 44], [340, 32], [380, 50], [420, 40], [460, 35]].forEach(([sx, sy]) => {
      const twinkle = 0.5 + Math.sin(frame * 0.04 + sx * 0.1) * 0.5;
      drawPixelRect(sx, sy, 2, 2, `rgba(237, 243, 255, ${twinkle * 0.8})`);
    });
  } else {
    // City lights / horizon glow
    const glowAlpha = tone === "busy" ? 0.3 : 0.2;
    context.save();
    const horizGrad = context.createLinearGradient(224, 50, 224, 88);
    horizGrad.addColorStop(0, `rgba(101, 228, 255, 0)`);
    horizGrad.addColorStop(1, `rgba(101, 228, 255, ${glowAlpha})`);
    context.fillStyle = horizGrad;
    context.fillRect(224, 50, 192, 38);
    context.restore();

    // Distant building silhouettes
    [[240, 52, 8, 16], [256, 58, 6, 10], [270, 50, 10, 18], [310, 55, 7, 13],
     [360, 48, 9, 20], [395, 54, 6, 14], [420, 50, 11, 18], [450, 56, 7, 12]].forEach(([bx, by, bw, bh]) => {
      drawPixelRect(bx, by, bw, bh, "rgba(5, 15, 30, 0.7)");
      // Window lights on buildings
      if (bh > 14) {
        drawPixelRect(bx + 2, by + 3, 2, 2, "rgba(255, 200, 100, 0.5)");
        drawPixelRect(bx + 5, by + 7, 2, 2, "rgba(255, 200, 100, 0.3)");
      }
    });
  }

  // Window sill
  drawPixelRect(218, 92, 204, 5, COLORS.bg1);

  // Light rays from window (only calm/steady)
  if (!renderState.reducedMotion && (tone === "calm" || tone === "steady")) {
    const rayAlpha = 0.04 + Math.sin(frame * 0.025) * 0.02;
    context.save();
    context.fillStyle = `rgba(101, 228, 255, ${rayAlpha})`;
    // Two angled light beams
    context.beginPath();
    context.moveTo(260, 88);
    context.lineTo(280, 88);
    context.lineTo(180, 280);
    context.lineTo(160, 280);
    context.fill();
    context.beginPath();
    context.moveTo(360, 88);
    context.lineTo(380, 88);
    context.lineTo(480, 280);
    context.lineTo(460, 280);
    context.fill();
    context.restore();
  }
}

function drawRug(floorTop) {
  // Simple decorative rug in the center of the floor
  drawPixelRect(220, floorTop + 40, 200, 80, "rgba(184, 162, 255, 0.06)");
  drawPixelRect(222, floorTop + 42, 196, 76, "rgba(184, 162, 255, 0.04)");
  // Rug border pattern
  for (let i = 0; i < 10; i++) {
    drawPixelRect(222 + i * 20, floorTop + 42, 2, 76, "rgba(184, 162, 255, 0.08)");
  }
  drawPixelRect(222, floorTop + 42, 196, 4, "rgba(184, 162, 255, 0.12)");
  drawPixelRect(222, floorTop + 114, 196, 4, "rgba(184, 162, 255, 0.12)");
}

// ─── Day/night cycle ─────────────────────────────────────────────────────────
// Returns an ambient profile for the current hour. Drives wall color, lamp
// intensity, star visibility, and window glow.
function getAmbientProfile(now = new Date()) {
  const h = now.getHours() + now.getMinutes() / 60;

  // 5 phases: night (0-6), dawn (6-8), day (8-17), dusk (17-19), evening (19-24)
  let phase = "day";
  let progress = 0; // 0..1 within phase

  if (h < 6) {
    phase = "night";
    progress = h / 6;
  } else if (h < 8) {
    phase = "dawn";
    progress = (h - 6) / 2;
  } else if (h < 17) {
    phase = "day";
    progress = (h - 8) / 9;
  } else if (h < 19) {
    phase = "dusk";
    progress = (h - 17) / 2;
  } else {
    phase = "evening";
    progress = (h - 19) / 5;
  }

  // Wall colors (top → bottom of gradient)
  const palettes = {
    night:   { wallTop: "#0a1428", floorTint: "rgba(60, 80, 140, 0.10)",  lampBoost: 1.0,  starVisible: true,  windowHue: "#2a3050" },
    dawn:    { wallTop: "#2a2040", floorTint: "rgba(180, 120, 100, 0.06)", lampBoost: 0.6,  starVisible: false, windowHue: "#ff9c80" },
    day:     { wallTop: "#1a3658", floorTint: "rgba(200, 200, 220, 0.0)",  lampBoost: 0.0,  starVisible: false, windowHue: "#8acfff" },
    dusk:    { wallTop: "#3a2548", floorTint: "rgba(220, 120, 80, 0.08)",  lampBoost: 0.4,  starVisible: false, windowHue: "#ff7c40" },
    evening: { wallTop: "#10182e", floorTint: "rgba(80, 100, 160, 0.08)",  lampBoost: 0.9,  starVisible: true,  windowHue: "#3050a0" }
  };

  return {
    phase,
    progress,
    hour: h,
    ...palettes[phase]
  };
}

// ─── Particle system ─────────────────────────────────────────────────────────
// Each particle: { x, y, vx, vy, life, maxLife, color, size, kind, gravity }
// kinds:
//   - confetti  : success celebration
//   - sparks    : error / glitch
//   - keystroke : tiny ticks while typing (rate-limited per actor)
//   - thought   : floating idea bubbles

if (typeof renderState !== "undefined" && !renderState.particles) {
  renderState.particles = [];
}

function spawnParticle({ x, y, vx, vy, life, color, size, kind, gravity = 0 }) {
  if (!renderState.particles) renderState.particles = [];
  if (renderState.particles.length > 300) return; // cap to avoid runaway
  renderState.particles.push({
    x, y, vx, vy,
    life, maxLife: life,
    color, size: size || 2,
    kind: kind || "dust",
    gravity
  });
}

function spawnBurst(kind, x, y, count = 12) {
  for (let i = 0; i < count; i++) {
    const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.5;
    const speed = 1.5 + Math.random() * 2;
    if (kind === "confetti") {
      const colors = ["#ff7c98", "#65e4ff", "#7cffba", "#ffcc66", "#b8a2ff"];
      spawnParticle({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 1.5,
        life: 60 + Math.random() * 30,
        color: colors[i % colors.length],
        size: 2 + Math.floor(Math.random() * 2),
        kind: "confetti",
        gravity: 0.08
      });
    } else if (kind === "sparks") {
      spawnParticle({
        x, y,
        vx: Math.cos(angle) * speed * 1.5,
        vy: Math.sin(angle) * speed * 1.5,
        life: 20 + Math.random() * 15,
        color: i % 3 === 0 ? "#ffb050" : "#ff5a40",
        size: 1 + Math.floor(Math.random() * 2),
        kind: "sparks",
        gravity: 0
      });
    } else if (kind === "thought") {
      spawnParticle({
        x: x + (Math.random() - 0.5) * 8,
        y: y - 4,
        vx: (Math.random() - 0.5) * 0.4,
        vy: -0.4 - Math.random() * 0.3,
        life: 60 + Math.random() * 30,
        color: "rgba(180, 220, 255, 0.6)",
        size: 1 + Math.floor(Math.random() * 2),
        kind: "thought",
        gravity: 0
      });
    }
  }
}

function updateParticles() {
  if (!renderState.particles) return;
  const arr = renderState.particles;
  for (let i = arr.length - 1; i >= 0; i--) {
    const p = arr[i];
    p.x += p.vx;
    p.y += p.vy;
    p.vy += p.gravity || 0;
    p.life -= 1;
    if (p.life <= 0 || p.y > CANVAS_HEIGHT + 10 || p.x < -10 || p.x > CANVAS_WIDTH + 10) {
      arr.splice(i, 1);
    }
  }
}

function drawParticles() {
  if (!renderState.particles) return;
  for (const p of renderState.particles) {
    const alpha = Math.min(1, p.life / Math.max(1, p.maxLife * 0.4));
    context.save();
    context.globalAlpha = alpha;
    if (p.kind === "confetti") {
      // Rotating square confetti
      const rot = (p.maxLife - p.life) * 0.2;
      context.translate(p.x, p.y);
      context.rotate(rot);
      context.fillStyle = p.color;
      context.fillRect(-p.size, -p.size, p.size * 2, p.size * 2);
    } else if (p.kind === "sparks") {
      // Streaking sparks
      context.fillStyle = p.color;
      context.fillRect(p.x, p.y, p.size, p.size);
      context.globalAlpha = alpha * 0.5;
      context.fillRect(p.x - p.vx, p.y - p.vy, p.size, p.size);
    } else if (p.kind === "thought") {
      // Soft floating dot
      context.fillStyle = p.color;
      context.beginPath();
      context.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      context.fill();
    } else {
      context.fillStyle = p.color;
      context.fillRect(p.x, p.y, p.size, p.size);
    }
    context.restore();
  }
}

// Snapshot of last-drawn agent state to detect transitions (for spawn triggers)
const __particleTriggerState = { lastActivities: new Map() };
function maybeSpawnActivityParticles(actor, agentState) {
  if (!actor || !agentState) return;
  const prev = __particleTriggerState.lastActivities.get(actor.id);
  const next = agentState.activity || "idle";

  // Transition into success/completion
  if (prev && prev !== next && (next === "summarizing" || next === "reviewing")) {
    if (Math.random() < 0.15) spawnBurst("thought", actor.x, actor.y - 50, 3);
  }
  // Coding/typing — occasional thought puff
  if (next === "coding" && Math.random() < 0.02) {
    spawnBurst("thought", actor.x, actor.y - 50, 1);
  }

  __particleTriggerState.lastActivities.set(actor.id, next);
}

// Exposed so external code (e.g. completion signals) can trigger bursts
if (typeof window !== "undefined") {
  window.reiSpawnBurst = spawnBurst;
}

function drawRoomBase(tone = "calm") {
  context.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  const ambient = getAmbientProfile();

  // Background
  context.fillStyle = COLORS.bg0;
  context.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

  const layout = currentLayout();

  // Wall — gradient driven by both task tone AND time-of-day
  const wallGradient = context.createLinearGradient(0, 0, 0, layout.canvas.wall_height);
  // Blend ambient (time-of-day) with tone-based tweaks: 60% ambient, 40% tone bias
  const toneShift = tone === "rest" ? -8 : tone === "busy" ? -4 : 0;
  const wallTop = ambient.wallTop;
  wallGradient.addColorStop(0, wallTop);
  wallGradient.addColorStop(1, COLORS.bg1);
  context.fillStyle = wallGradient;
  context.fillRect(0, 0, CANVAS_WIDTH, layout.canvas.wall_height);

  // Stars at night (subtle twinkle in upper area)
  if (ambient.starVisible) {
    const starSeed = Math.floor(renderState.frame / 30);
    for (let s = 0; s < 24; s++) {
      const sx = (s * 73 + 13) % CANVAS_WIDTH;
      const sy = ((s * 41) % 70) + 4;
      const twinkle = ((s * 7 + starSeed) % 9) > 4 ? 0.5 : 0.85;
      context.fillStyle = `rgba(220, 230, 255, ${twinkle})`;
      context.fillRect(sx, sy, 1, 1);
    }
  }

  // Ceiling overhead light strip — stronger at night
  const lightBase = tone === "busy" ? 0.28 : tone === "steady" ? 0.22 : 0.16;
  const lightIntensity = lightBase + ambient.lampBoost * 0.12;
  const lightGrad = context.createRadialGradient(320, 0, 0, 320, 0, 180);
  lightGrad.addColorStop(0, `rgba(200, 230, 255, ${lightIntensity})`);
  lightGrad.addColorStop(1, "rgba(200, 230, 255, 0)");
  context.fillStyle = lightGrad;
  context.fillRect(0, 0, CANVAS_WIDTH, layout.canvas.wall_height);
  // Light fixture pixel art
  drawPixelRect(240, 0, 160, 2, "rgba(255,255,255,0.15)");
  drawPixelRect(260, 0, 120, 5, "rgba(220,240,255,0.22)");

  // Decorative bookshelf on left wall
  drawBookshelf(12, 30);

  // Window with city view (replaces old simple glow)
  drawWindowWithLight(renderState.frame, tone);

  // Clock on right wall
  drawClock(590, 52, renderState.frame);

  // Warm lamp glow (right side of room)
  drawWarmLamp(555, 125, renderState.frame);

  // Floor
  context.fillStyle = COLORS.bg2;
  context.fillRect(0, layout.canvas.floor_top, CANVAS_WIDTH, CANVAS_HEIGHT - layout.canvas.floor_top);

  // Ambient tint on floor (cool at night, warm at dawn/dusk)
  if (ambient.floorTint && ambient.floorTint !== "rgba(200, 200, 220, 0.0)") {
    context.fillStyle = ambient.floorTint;
    context.fillRect(0, layout.canvas.floor_top, CANVAS_WIDTH, CANVAS_HEIGHT - layout.canvas.floor_top);
  }

  // Rug
  drawRug(layout.canvas.floor_top);

  // Floor grid lines
  for (let row = 0; row < 12; row += 1) {
    context.strokeStyle = COLORS.floorLine;
    context.lineWidth = 0.5;
    context.beginPath();
    context.moveTo(0, layout.canvas.floor_top + row * 18);
    context.lineTo(CANVAS_WIDTH, layout.canvas.floor_top + row * 18);
    context.stroke();
  }

  // Diagonal floor lines (subtle perspective)
  for (let col = 0; col < 18; col += 1) {
    context.strokeStyle = "rgba(255, 255, 255, 0.018)";
    context.lineWidth = 0.5;
    context.beginPath();
    context.moveTo(col * 36, layout.canvas.floor_top);
    context.lineTo(col * 36 + 20, CANVAS_HEIGHT);
    context.stroke();
  }

  // Plant in bottom-left corner
  drawPlant(38, layout.canvas.floor_top + 30);

  // Coffee on the lab desk area (approximate position)
  drawCoffee(310, layout.canvas.floor_top + 12, renderState.frame);

  // Floating dust particles (ambient life)
  drawDustParticles(renderState.frame, tone);
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
  // Add scrolling "code" characters on monitor screen
  if (!renderState.reducedMotion) {
    const { origin } = layout;
    context.save();
    context.font = "5px monospace";
    context.fillStyle = `rgba(101, 228, 255, 0.55)`;
    const lines = ["01101", "func()", "→ ok", "10110", "run()", "pass ✓"];
    lines.forEach((line, i) => {
      const scrollY = ((frame * 0.4 + i * 8) % 40);
      context.fillText(line, origin.x + 4, origin.y + 8 + scrollY);
    });
    context.restore();
  }
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

// --- Matrix spawn/despawn effect ---

// Per-agent spawn animation state
const agentSpawnState = new Map(); // agentId → { startFrame, active }

function getOrInitSpawnState(agentId, frame) {
  if (!agentSpawnState.has(agentId)) {
    agentSpawnState.set(agentId, { startFrame: frame, active: true });
  }
  return agentSpawnState.get(agentId);
}

function drawMatrixSpawn(x, y, frame, spawnStartFrame, accent) {
  const DURATION_FRAMES = 45; // ~1.5s at 30fps
  const elapsed = frame - spawnStartFrame;
  if (elapsed > DURATION_FRAMES) return false; // done

  const progress = elapsed / DURATION_FRAMES; // 0→1
  const CHAR_W = 20, CHAR_H = 44; // character bounding box
  const COLS = 4;
  const COL_W = Math.floor(CHAR_W / COLS);

  context.save();
  for (let col = 0; col < COLS; col++) {
    const colDelay = col / COLS * 0.3;
    const colProgress = Math.max(0, Math.min(1, (progress - colDelay) / 0.7));
    if (colProgress <= 0) continue;

    const revealY = CHAR_H * colProgress;
    const colX = x - 10 + col * COL_W;

    for (let py = 0; py < revealY; py += 2) {
      // Hash-based flicker like pixel-agents
      const hash = ((col * 7 + py * 13 + frame * 31) & 0xff) / 255;
      let alpha, color;
      if (py > revealY - 6) {
        // Bright head
        alpha = 0.95;
        color = "#ccffcc";
      } else if (py > revealY - 14) {
        // Mid trail
        alpha = 0.55 + hash * 0.2;
        color = accent;
      } else {
        // Fading tail
        alpha = 0.2 + hash * 0.15;
        color = COLORS.mint;
      }
      context.globalAlpha = alpha;
      context.fillStyle = color;
      context.fillRect(colX, y - 10 + py, COL_W - 1, 2);
    }
  }
  context.restore();
  return true; // still animating
}

// --- Z-sorted multi-agent render ---

function renderActorsSorted(actors, agentStates, primaryActorId, frame) {
  if (!actors || actors.length === 0) return;

  // Sort actors by their y-bottom so those lower on screen appear in front
  const sorted = [...actors].sort((a, b) => (a.y + 44) - (b.y + 44));

  sorted.forEach((actor) => {
    const agentState = agentStates?.find((s) => s.id === actor.id) || {
      activity: "idle",
      assigned_zone: actor.currentZone || "lab"
    };
    const isPrimary = actor.id === primaryActorId;

    // Matrix spawn effect for new agents
    const spawn = getOrInitSpawnState(actor.id, frame);
    if (spawn.active) {
      const { accent } = actorPalette(actor.id, COLORS.cyan);
      const still = !drawMatrixSpawn(actor.x, actor.y, frame, spawn.startFrame, accent);
      if (still) {
        spawn.active = false; // spawn complete, draw normally
      }
      return; // during spawn, only show matrix effect
    }

    drawAgent(actor, agentState, isPrimary);
  });
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

// ─── Pixel art character renderer ────────────────────────────────────────────

/**
 * Draw a pixel-art office chair behind a seated character.
 * cx   = horizontal center (same as actor.x)
 * baseY = actor.y (the floor / reference y for this actor's seat position)
 * accent = zone accent colour for subtle highlight
 *
 * Coordinate layout (all in canvas px, relative to baseY):
 *   backrest top  : baseY - 48
 *   seat plank    : baseY - 18 … baseY - 10
 *   legs bottom   : baseY +  4
 */
function drawChair(cx, baseY, accent) {
  const seatTop  = baseY - 18;
  const seatBot  = baseY - 10;
  const backTop  = baseY - 48;
  const legBot   = baseY +  4;

  // ── Backrest ──────────────────────────────────────────────────────────────
  // Main panel
  context.fillStyle = "#14142a";
  context.fillRect(cx - 10, backTop, 20, seatTop - backTop);
  // Horizontal slats (give it a real chair look)
  context.fillStyle = withAlpha(accent, 0.18);
  context.fillRect(cx - 8, backTop + 3, 16, 3);
  context.fillRect(cx - 8, backTop + 10, 16, 3);
  context.fillRect(cx - 8, backTop + 17, 16, 3);
  // Backrest border highlight
  context.fillStyle = withAlpha(accent, 0.30);
  context.fillRect(cx - 10, backTop, 1, seatTop - backTop);
  context.fillRect(cx +  9, backTop, 1, seatTop - backTop);

  // ── Seat plank ────────────────────────────────────────────────────────────
  const seatH = seatBot - seatTop;
  context.fillStyle = "#1c1c34";
  context.fillRect(cx - 12, seatTop, 24, seatH);
  // Top edge highlight
  context.fillStyle = withAlpha(accent, 0.14);
  context.fillRect(cx - 10, seatTop, 20, 2);
  // Side border
  context.fillStyle = withAlpha(accent, 0.22);
  context.fillRect(cx - 12, seatTop, 1, seatH);
  context.fillRect(cx + 11, seatTop, 1, seatH);

  // ── Legs (2 visible in 3/4 view) ─────────────────────────────────────────
  const legH = legBot - seatBot;
  context.fillStyle = "#0e0e1e";
  // left leg
  context.fillRect(cx - 10, seatBot, 3, legH);
  // right leg
  context.fillRect(cx +  7, seatBot, 3, legH);
  // Tiny foot pads
  context.fillStyle = "#1a1a2e";
  context.fillRect(cx - 11, legBot - 2, 5, 2);
  context.fillRect(cx +  6, legBot - 2, 5, 2);
}

// Palette per actor type (hair, shirt, pants, skin, shoe)
const ACTOR_COSTUMES = {
  lead:    { hair: "#2a1a3e", shirt: "#b8a2ff", pants: "#1a1a3a", skin: "#f5cfa0", shoe: "#1a1010" },
  api:     { hair: "#0a3020", shirt: "#3effb0", pants: "#0d2a20", skin: "#f5cfa0", shoe: "#101a14" },
  db:      { hair: "#3a2000", shirt: "#ffcc66", pants: "#2a1800", skin: "#f5cfa0", shoe: "#1a1000" },
  docs:    { hair: "#3a0010", shirt: "#ff907c", pants: "#2a0010", skin: "#f5cfa0", shoe: "#1a0808" },
  scout:   { hair: "#1a1050", shirt: "#a070ff", pants: "#0d0830", skin: "#f5cfa0", shoe: "#100818" },
  default: { hair: "#102030", shirt: "#65e4ff", pants: "#0d1f31", skin: "#f5cfa0", shoe: "#080c10" },
};

function actorCostume(actorId) {
  return ACTOR_COSTUMES[actorId] || ACTOR_COSTUMES.default;
}

// PX = 2px pixel size — feels crisp at canvas scale
const PX = 2;

/**
 * Draw a detailed pixel art character.
 * cx = horizontal center, ty = top of character (head top).
 * Total height: ~44px (22 "pixels" tall at PX=2).
 */
function drawCharacterSprite(cx, ty, {
  costume,
  direction = 1,       // 1=right, -1=left
  pose = "stand",      // stand | walk | sit | type | read
  walkFrame = 0,       // 0-3 for 4-frame walk cycle
  isBlink = false,
  isPrimary = false,
  accent = "#65e4ff",
  idleSway = 0,        // small float for idle head sway
}) {
  const c = costume;
  const flip = direction === -1;

  // Helper: draw pixel block, flipped if facing left
  function dpx(rx, ry, w, h, color) {
    const drawX = flip ? cx + (-(rx + w) * PX) : cx + rx * PX;
    context.fillStyle = color;
    context.fillRect(drawX, ty + ry * PX, w * PX, h * PX);
  }

  // ── Shadow ──────────────────────────────────────────────────────────────────
  context.save();
  context.globalAlpha = 0.25;
  context.fillStyle = "#000";
  context.beginPath();
  if (pose === "sit" || pose === "type" || pose === "read") {
    // Shadow lands near the chair legs area (ty + 50 = actor.y → actor.y + 20 ≈ chair leg bottom)
    context.ellipse(cx, ty + 54 * PX, 14, 4, 0, 0, Math.PI * 2);
  } else {
    context.ellipse(cx, ty + 22 * PX, 14, 4, 0, 0, Math.PI * 2);
  }
  context.fill();
  context.restore();

  // ── Primary agent halo ───────────────────────────────────────────────────────
  if (isPrimary) {
    const haloPulse = 0.25 + Math.abs(Math.sin(renderState.frame * 0.05)) * 0.25;
    context.save();
    context.globalAlpha = haloPulse;
    context.fillStyle = accent;
    context.beginPath();
    // Seated: halo near the feet (ty+50 = actor.y); standing: near feet at ty+44
    const haloY = (pose === "sit" || pose === "type" || pose === "read") ? ty + 26 * PX : ty + 22 * PX;
    context.ellipse(cx, haloY, 18, 5, 0, 0, Math.PI * 2);
    context.fill();
    context.restore();
  }

  // ── SEATED POSE ─────────────────────────────────────────────────────────────
  if (pose === "sit" || pose === "type" || pose === "read") {

    // Lower body (lap)
    dpx(-7, 16, 14, 5, c.pants);
    dpx(-8, 19, 4, 4, c.pants);  // left thigh
    dpx( 4, 19, 4, 4, c.pants);  // right thigh

    // Shoes (visible when seated)
    dpx(-8, 22, 4, 3, c.shoe);
    dpx( 4, 22, 4, 3, c.shoe);

    // Torso / shirt
    dpx(-6, 9, 12, 8, c.shirt);
    // Shirt collar/neckline
    dpx(-2, 9, 4, 2, "#fff");

    // Belt
    dpx(-7, 16, 14, 2, "#333");

    // Arms based on pose
    if (pose === "type") {
      // Arms forward on keyboard
      dpx(-11, 13, 5, 5, c.shirt);
      dpx( 6,  13, 5, 5, c.shirt);
      dpx(-11, 17, 5, 3, c.skin); // hands
      dpx( 6,  17, 5, 3, c.skin);
    } else if (pose === "read") {
      // Arms up holding something
      dpx(-12, 11, 5, 7, c.shirt);
      dpx(  7, 11, 5, 7, c.shirt);
      dpx(-12, 17, 5, 3, c.skin);
      dpx(  7, 17, 5, 3, c.skin);
    } else if (pose === "coffee") {
      // Left arm rests; right arm lifted holding a steaming cup near mouth
      dpx(-11, 14, 5, 6, c.shirt);
      dpx(-11, 19, 5, 3, c.skin);
      // Right arm raised in front of chest
      dpx( 6,  8, 4, 7, c.shirt);
      dpx( 6,  6, 4, 2, c.skin);   // hand
      // Coffee cup (mug)
      dpx( 6,  4, 5, 3, "#552a14"); // mug body
      dpx( 7,  4, 3, 1, "#1a0a04"); // coffee surface
      dpx(10,  5, 1, 2, "#552a14"); // handle
      // Steam wisps
      const steamPhase = Math.floor((renderState?.frame || 0) / 8) % 3;
      if (steamPhase === 0) dpx(8, 1, 1, 2, "rgba(220,230,255,0.55)");
      if (steamPhase >= 1) dpx(7, 0, 1, 2, "rgba(220,230,255,0.45)");
    } else if (pose === "yawn") {
      // Right hand covers mouth
      dpx(-11, 14, 5, 6, c.shirt);
      dpx(-11, 19, 5, 3, c.skin);
      dpx( 4,  4, 4, 6, c.shirt);   // arm up
      dpx( 4,  4, 4, 2, c.skin);    // hand at face
    } else {
      dpx(-11, 14, 5, 6, c.shirt);
      dpx( 6,  14, 5, 6, c.shirt);
      dpx(-11, 19, 5, 3, c.skin);
      dpx( 6,  19, 5, 3, c.skin);
    }

    // Neck
    dpx(-2, 7, 4, 3, c.skin);

    // Head
    const hx = Math.round(idleSway);
    dpx(-6 + hx, 0, 12, 8, c.skin);
    // Hair
    dpx(-6 + hx, 0, 12, 3, c.hair);
    dpx(-7 + hx, 1, 2, 4, c.hair); // left sideburn
    dpx( 5 + hx, 1, 2, 4, c.hair); // right sideburn
    // Ears
    dpx(-7 + hx, 3, 1, 3, c.skin);
    dpx( 6 + hx, 3, 1, 3, c.skin);

    // Eyes
    if (!isBlink) {
      dpx(-5 + hx, 3, 3, 2, "#fff");
      dpx( 2 + hx, 3, 3, 2, "#fff");
      // Pupils
      const pupilOffset = direction === -1 ? -1 : 1;
      dpx(-4 + hx + pupilOffset, 3, 1, 2, "#111");
      dpx( 3 + hx + pupilOffset, 3, 1, 2, "#111");
      // Focused dot when typing
      if (pose === "type") {
        dpx(hx, 5, 2, 1, withAlpha(accent, 0.7));
      }
    } else {
      // Blink — just a line
      dpx(-5 + hx, 4, 3, 1, "#555");
      dpx( 2 + hx, 4, 3, 1, "#555");
    }
    // Nose
    dpx(-1 + hx, 5, 2, 1, withAlpha(c.skin, 0.6));
    // Mouth — smile when primary, neutral otherwise
    if (isPrimary) {
      dpx(-3 + hx, 7, 2, 1, "#c07060");
      dpx(-1 + hx, 8, 4, 1, "#c07060");
      dpx( 3 + hx, 7, 2, 1, "#c07060");
    } else {
      dpx(-2 + hx, 7, 4, 1, "#c07060");
    }

    return; // seated done
  }

  // ── STANDING / WALKING POSE ──────────────────────────────────────────────────

  // 4-frame walk animation: compute leg/arm positions
  // walkFrame 0-3: 0=neutral, 1=left fwd, 2=neutral, 3=right fwd
  let leftLegDY = 0, rightLegDY = 0, leftArmDX = 0, rightArmDX = 0;
  let leftLegDX = 0, rightLegDX = 0;

  if (pose === "walk") {
    const walkCycle = [
      { ll: 0, rl: 0, la: 0, ra: 0 },   // neutral
      { ll: -2, rl: 2, la: 2, ra: -2 }, // left fwd
      { ll: 0, rl: 0, la: 0, ra: 0 },   // neutral
      { ll: 2, rl: -2, la: -2, ra: 2 }, // right fwd
    ][walkFrame % 4];
    leftLegDY  = walkCycle.ll;
    rightLegDY = walkCycle.rl;
    leftArmDX  = walkCycle.la;
    rightArmDX = walkCycle.ra;
    leftLegDX  = walkCycle.ll > 0 ? 1 : 0;
    rightLegDX = walkCycle.rl > 0 ? 1 : 0;
  }

  // Shoes
  dpx(-7,        19 + leftLegDY,  7, 3, c.shoe);
  dpx( 0,        19 + rightLegDY, 7, 3, c.shoe);

  // Pants / legs
  dpx(-6,        12 + leftLegDY,  5, 8, c.pants);
  dpx( 1,        12 + rightLegDY, 5, 8, c.pants);

  // Belt
  dpx(-7, 11, 14, 2, "#333");

  // Torso / shirt
  dpx(-6, 3, 12, 9, c.shirt);
  // Shirt collar
  dpx(-2, 3, 4, 2, "#fff");

  // Arms (swing with walk)
  dpx(-11 + leftArmDX,  4, 5, 8, c.shirt);
  dpx(  6 + rightArmDX, 4, 5, 8, c.shirt);
  // Hands
  dpx(-11 + leftArmDX,  11, 5, 3, c.skin);
  dpx(  6 + rightArmDX, 11, 5, 3, c.skin);

  // Neck
  dpx(-2, 1, 4, 3, c.skin);

  // Head (with idle sway)
  const hx = Math.round(idleSway);
  dpx(-6 + hx, -8, 12, 10, c.skin);

  // Hair
  dpx(-6 + hx, -8, 12, 4, c.hair);
  dpx(-7 + hx, -6, 2, 5, c.hair); // left sideburn
  dpx( 5 + hx, -6, 2, 5, c.hair); // right sideburn
  // Hair spikes / style detail (distinctive per agent)
  dpx(-4 + hx, -9, 3, 2, c.hair);
  dpx( 1 + hx, -9, 3, 2, c.hair);

  // Ears
  dpx(-7 + hx, -4, 1, 3, c.skin);
  dpx( 6 + hx, -4, 1, 3, c.skin);

  // Eyes (open or blink)
  if (!isBlink) {
    dpx(-5 + hx, -4, 3, 2, "#fff");
    dpx( 2 + hx, -4, 3, 2, "#fff");
    const pupilOffset = direction === -1 ? -1 : 1;
    dpx(-4 + hx + pupilOffset, -4, 1, 2, "#111");
    dpx( 3 + hx + pupilOffset, -4, 1, 2, "#111");
    // Eye shine
    dpx(-4 + hx, -5, 1, 1, "rgba(255,255,255,0.5)");
    dpx( 3 + hx, -5, 1, 1, "rgba(255,255,255,0.5)");
  } else {
    dpx(-5 + hx, -3, 3, 1, "#555");
    dpx( 2 + hx, -3, 3, 1, "#555");
  }

  // Nose
  dpx(hx, -2, 2, 1, withAlpha(c.skin, 0.55));

  // Mouth
  if (isPrimary) {
    dpx(-3 + hx, 0, 2, 1, "#c07060");
    dpx(-1 + hx, 1, 4, 1, "#c07060");
    dpx( 3 + hx, 0, 2, 1, "#c07060");
  } else {
    dpx(-2 + hx, 0, 4, 1, "#c07060");
  }
}

function drawAgent(actor, agentState, isPrimary) {
  const zone = zoneById(agentState.assigned_zone === "between_zones" ? "lab" : actor.currentZone);
  const frame = renderState.frame;
  const { accent } = actorPalette(actor.id, zone.color);
  const costume = actorCostume(actor.id);

  // Micro-pose: transient "moment of life" overlay (coffee, yawn, stretch).
  // Expires when actor.microPoseUntil < frame. If active and the actor is seated,
  // it overrides the arm rendering in drawCharacterSprite.
  if (actor.microPoseUntil && actor.microPoseUntil < frame) {
    actor.microPose = null;
    actor.microPoseUntil = null;
  }

  const basePose =
    actor.pose ||
    (["coding", "debugging"].includes(agentState.activity)
      ? "type"
      : ["reading", "reviewing", "summarizing"].includes(agentState.activity)
        ? "read"
        : actor.moving
          ? "walk"
          : "stand");

  // If the actor is currently seated AND has a micro-pose (coffee/yawn), use it
  const seatedBase = ["sit", "type", "read"].includes(basePose) ||
    actor.motionState === "SEATED" || actor.motionState === "REST";
  const pose = seatedBase && (actor.microPose === "coffee" || actor.microPose === "yawn")
    ? actor.microPose
    : basePose;

  const seated = ["sit", "type", "read", "coffee", "yawn"].includes(pose) ||
    actor.motionState === "SEATED" || actor.motionState === "REST";

  // Smooth breathing — sine wave, not hard step
  const breathe = seated
    ? Math.sin(frame * 0.055) * 1.5
    : Math.sin(frame * 0.038 + (actor.patrolIndex || 0)) * 1.0;

  // Actual canvas Y (top of character's head).
  // Seated: shoes bottom (ry=25 → +50px) anchors to actor.y (the floor/seat reference).
  //   ty + 50 = actor.y  →  ty = actor.y - 50
  // Standing: shoe bottom (ry=22 → +44px) anchors slightly above actor.y for depth.
  const ty = seated
    ? actor.y - 50 + breathe
    : actor.y - 20 + breathe;

  const direction = actor.facing || 1;

  // 4-frame walk cycle (changes every 12 frames ≈ 2.5 steps/sec — more natural than 8)
  const walkFrame = Math.floor(frame / 12) % 4;

  // Idle head sway when standing still
  const idleSway = (!actor.moving && !seated)
    ? Math.sin(frame * 0.022) * 2.5
    : 0;

  // Blink every ~3s
  const isBlink = (frame % 90 < 3);

  // Draw chair BEHIND character so the character renders on top of the backrest
  if (seated) {
    drawChair(actor.x, actor.y, accent);
  }

  // Map to drawCharacterSprite's pose vocabulary, preserving micro-poses
  const spritePose = seated
    ? (pose === "type" || pose === "read" || pose === "coffee" || pose === "yawn"
        ? pose
        : "sit")
    : (actor.moving ? "walk" : "stand");

  drawCharacterSprite(actor.x, ty, {
    costume,
    direction,
    pose: spritePose,
    walkFrame,
    isBlink,
    isPrimary,
    accent,
    idleSway,
  });

  // Activity cue (mini icon next to character)
  drawActivityCue({ x: actor.x, y: ty + (seated ? 10 : -10) }, agentState.activity, accent, pose);

  // Speech bubble above Rei when she's doing something
  if (isPrimary && agentState.activity && agentState.activity !== "idle") {
    const bubbleLabels = {
      coding:     "coding…",
      debugging:  "debug…",
      reading:    "reading…",
      reviewing:  "review…",
      summarizing:"writing…",
      planning:   "plan…",
      meeting:    "sync…",
    };
    const bubbleText = bubbleLabels[agentState.activity];
    if (bubbleText) {
      const bx = actor.x;
      const by = ty - 14;
      const pulse = Math.sin(frame * 0.08) * 0.15 + 0.85;
      context.save();
      context.globalAlpha = pulse;
      context.fillStyle = "rgba(8, 20, 34, 0.88)";
      context.strokeStyle = accent;
      context.lineWidth = 1;
      context.beginPath();
      context.roundRect(bx - 26, by - 10, 52, 12, 4);
      context.fill();
      context.stroke();
      // Tail
      context.beginPath();
      context.moveTo(bx - 4, by + 2);
      context.lineTo(bx, by + 8);
      context.lineTo(bx + 4, by + 2);
      context.fillStyle = "rgba(8, 20, 34, 0.88)";
      context.fill();
      context.fillStyle = "#edf3ff";
      context.font = "bold 7px 'IBM Plex Mono', monospace";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(bubbleText, bx, by - 4);
      context.restore();
    }
  }

  // Name tag for non-primary agents
  if (!isPrimary && actor.display_name) {
    const nameText = actor.display_name.slice(0, 8);
    const tagW = nameText.length * 5 + 10;
    context.save();
    context.fillStyle = "rgba(8, 20, 34, 0.78)";
    context.fillRect(actor.x - tagW / 2, ty - 18, tagW, 11);
    context.fillStyle = "#8fa8c6";
    context.font = "7px 'IBM Plex Mono', monospace";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(nameText, actor.x, ty - 12);
    context.restore();
  }
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

  const primaryActorId = data.scene?.primary_bubble?.actor_id;
  renderActorsSorted(
    renderState.actors,
    renderState.data?.agents || [],
    primaryActorId,
    renderState.frame
  );

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

  // Particles render on top of everything except the most foreground UI
  // (badges/bubbles), so they read as belonging to the scene.
  updateParticles();
  drawParticles();

  // Activity-driven particle triggers (subtle thought puffs while coding, etc.)
  for (const actor of renderState.actors) {
    const agent = renderState.data?.agents?.find?.((a) => a.id === actor.id);
    if (agent) maybeSpawnActivityParticles(actor, agent);
  }

  // Micro-pose scheduling — every ~10s, give an idle/seated actor a moment of life
  if (renderState.frame % 300 === 0) {
    for (const actor of renderState.actors) {
      if (actor.microPose) continue; // already in a micro-pose
      const agent = renderState.data?.agents?.find?.((a) => a.id === actor.id);
      if (!agent) continue;
      const idle = !agent.activity || agent.activity === "idle";
      const seatedBase = ["sit", "type", "read"].includes(actor.pose) ||
        actor.motionState === "SEATED" || actor.motionState === "REST";
      if (!seatedBase) continue;
      // 30% chance each cycle (rate-limit by only checking every 300 frames)
      if (Math.random() < (idle ? 0.4 : 0.12)) {
        actor.microPose = Math.random() < 0.55 ? "coffee" : "yawn";
        actor.microPoseUntil = renderState.frame + (60 + Math.floor(Math.random() * 60));
      }
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
  elements.runtimeLiveTitle.textContent = "Failed to read local status.";
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
renderDailyHandoff(renderState.dailyHandoff);
renderGithubInbox(renderState.githubInbox);
renderReportOnly(renderState.reportOnly);
renderReportOnlyAutopilot();
renderReportOnlyService(renderState.reportOnlyService);
renderExecuteAgent();
drawScene();
let lastAnimateTime = 0;
const ANIMATE_INTERVAL = 160;

function animationLoop(timestamp) {
  requestAnimationFrame(animationLoop);
  if (timestamp - lastAnimateTime < ANIMATE_INTERVAL) return;
  lastAnimateTime = timestamp;
  animate();
}
requestAnimationFrame(animationLoop);

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
elements.githubExecuteButton?.addEventListener("click", () => {
  void controlExecuteService(elements.githubExecuteButton.dataset.action || "");
});
elements.githubExecuteWorker2Button?.addEventListener("click", () => {
  void controlExecuteServiceWorker2(elements.githubExecuteWorker2Button.dataset.action || "");
});
elements.taskQueueSubmit?.addEventListener("click", () => {
  void submitDirectTask();
});
elements.handoffGenerateButton?.addEventListener("click", async () => {
  if (!elements.handoffGenerateButton) return;
  elements.handoffGenerateButton.disabled = true;
  if (elements.handoffGenerateStatus) elements.handoffGenerateStatus.textContent = "Generating…";
  try {
    const res = await fetch("/api/handoff/generate", { method: "POST" });
    const data = await res.json();
    if (res.ok && data.written) {
      if (elements.handoffGenerateStatus) elements.handoffGenerateStatus.textContent = `✓ Written: ${data.date}`;
      await refreshDailyHandoff();
    } else {
      if (elements.handoffGenerateStatus) elements.handoffGenerateStatus.textContent = data.reason || data.error || "Could not write.";
    }
  } catch {
    if (elements.handoffGenerateStatus) elements.handoffGenerateStatus.textContent = "Failed.";
  } finally {
    elements.handoffGenerateButton.disabled = false;
  }
});
elements.taskQueueInput?.addEventListener("input", () => {
  updateTaskQueueSubmitButton();
});
elements.taskQueueInput?.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
    void submitDirectTask();
  }
});
window.addEventListener("beforeunload", () => {
  statusTransport.stop();
  stopGithubInboxPolling();
});
