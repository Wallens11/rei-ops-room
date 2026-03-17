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
  repoName: document.getElementById("repo-name"),
  cwdDisplay: document.getElementById("cwd-display"),
  branchChip: document.getElementById("branch-chip"),
  updatedChip: document.getElementById("updated-chip"),
  threadTitle: document.getElementById("thread-title"),
  activitySummary: document.getElementById("activity-summary"),
  activitySource: document.getElementById("activity-source"),
  repoContextName: document.getElementById("repo-context-name"),
  repoContextCwd: document.getElementById("repo-context-cwd"),
  repoContextTitle: document.getElementById("repo-context-title"),
  recentList: document.getElementById("recent-list"),
  crewList: document.getElementById("crew-list"),
  skillList: document.getElementById("skill-list"),
  workstreamList: document.getElementById("workstream-list"),
  eventList: document.getElementById("event-list"),
  viewButtons: [...document.querySelectorAll("[data-mode]")]
};

const renderState = {
  status: "idle",
  frame: 0,
  data: createEmptyState(),
  mode: "room",
  actors: buildCrewActors(ZONES)
};

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
      : "Nunggu handoff yang memang berarti.";
  }

  if (assigned.length === 0) {
    return `${currentZone.title} standby sambil nunggu assignment.`;
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
  renderState.data = data;
  renderState.status = data.status;

  document.body.dataset.phase = data.room.phase;
  document.body.dataset.tone = data.scene.tone;

  setStatusPill(data.status, Boolean(data.room.resting));
  elements.phaseChip.textContent = data.scene.phase_title || data.phase?.title || "Standby";
  elements.focusChip.textContent = data.scene.focus_title || data.focus?.title || "Lead Table";
  elements.modeChip.textContent = modeLabel(data.room.mode);
  elements.confidenceChip.textContent = `focus ${formatConfidence(data.room.focus_confidence)}`;
  elements.activityAge.textContent = data.room.resting
    ? `idle ${data.activity.lastLogAgo}`
    : `last log ${data.activity.lastLogAgo}`;

  elements.phaseTitle.textContent = data.scene.phase_title || data.phase?.title || "Standby";
  elements.phaseReason.textContent = data.scene.phase_reason || data.phase?.reason || "";
  elements.focusTitle.textContent = data.scene.focus_title || data.focus?.title || "Lead Table";
  elements.focusReason.textContent = data.scene.focus_reason || data.focus?.reason || "";
  elements.taskTitle.textContent = truncate(data.room.current_task, 88);
  elements.taskRepo.textContent = `${data.room.current_repo} · ${data.room.mode}`;

  elements.repoName.textContent = data.room.current_repo || "No thread";
  elements.cwdDisplay.textContent = data.thread?.cwdDisplay || "-";
  elements.branchChip.textContent = data.thread?.gitBranch || "no branch";
  elements.updatedChip.textContent = data.thread
    ? `thread ${data.thread.updatedAgo}`
    : "thread ?";
  elements.threadTitle.textContent = truncate(
    data.thread?.title || "Belum ada thread aktif.",
    160
  );

  elements.activitySummary.textContent = truncate(data.activity.summary, 104);
  elements.activitySource.textContent = data.activity.source;

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
}

function drawPixelRect(x, y, w, h, color) {
  context.fillStyle = color;
  context.fillRect(Math.round(x), Math.round(y), w, h);
}

function drawRoomBase(tone = "calm") {
  context.clearRect(0, 0, canvas.width, canvas.height);

  context.fillStyle = COLORS.bg0;
  context.fillRect(0, 0, canvas.width, canvas.height);

  const wallGradient = context.createLinearGradient(0, 0, 0, 220);
  wallGradient.addColorStop(0, COLORS.bg2);
  wallGradient.addColorStop(1, COLORS.bg1);
  context.fillStyle = wallGradient;
  context.fillRect(0, 0, canvas.width, 220);

  const glowAlpha =
    tone === "busy" ? 0.22 : tone === "steady" ? 0.18 : tone === "rest" ? 0.08 : 0.12;
  context.fillStyle = `rgba(101, 228, 255, ${glowAlpha})`;
  context.fillRect(220, 26, 200, 14);
  context.fillRect(250, 42, 140, 72);

  context.fillStyle = COLORS.bg2;
  context.fillRect(0, 220, canvas.width, 200);

  for (let row = 0; row < 12; row += 1) {
    context.strokeStyle = COLORS.floorLine;
    context.beginPath();
    context.moveTo(0, 220 + row * 18);
    context.lineTo(canvas.width, 220 + row * 18);
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

function drawBubble(actor, text, tone = "steady", verticalOffset = 0) {
  const width = Math.min(220, 82 + text.length * 4);
  const x = Math.max(18, Math.min(canvas.width - width - 18, actor.x - width / 2));
  const y = Math.max(18, actor.y - 78 - verticalOffset);
  const fill = bubbleColor(tone);

  drawPixelRect(x, y, width, 30, fill);
  drawPixelRect(x + 18, y + 30, 8, 8, fill);
  context.fillStyle = COLORS.ink;
  context.font = "12px monospace";
  context.fillText(truncate(text, 34), x + 10, y + 19);
}

function drawScene() {
  const data = renderState.data;
  drawRoomBase(data.scene?.tone || "calm");
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

  if (data.scene?.resting && bubbleActor) {
    drawSleepMarks(bubbleActor);
  }

  if (data.scene?.scout?.active && data.scene.scout.payload && primaryBubble?.actor_id !== "scout") {
    const scoutActor = actorById("scout");
    if (scoutActor) {
      drawBubble(scoutActor, data.scene.scout.payload, "steady", 34);
    }
  }
}

async function refresh() {
  try {
    const response = await fetch("/api/status", { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    applyStatus(data);
  } catch (error) {
    elements.activitySummary.textContent = "Gagal membaca status lokal.";
    elements.activitySource.textContent = error instanceof Error ? error.message : String(error);
  }
}

function animate() {
  renderState.frame += 1;
  renderState.actors = stepCrewActors(renderState.actors, {
    frame: renderState.frame,
    status: renderState.status,
    focusZone: renderState.data.room?.focus_zone || "lab",
    roomPhase: renderState.data.room?.phase || "standby",
    agents: renderState.data.agents || [],
    scene: renderState.data.scene || {},
    zones: ZONES
  });
  drawScene();
}

initMode();
drawScene();
setInterval(animate, 160);
refresh();
setInterval(refresh, 3000);
