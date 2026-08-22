import {
  PET_ATLAS,
  petAgentStatusLabel,
  petFrameAt,
  petLabelBox,
  petOverlayAgents,
  petOverlayModeForWidth,
  petRoamingState,
  petSpotlightAgent,
  petVisualState,
  petWorkPropForPose,
  petWorkPoseAt
} from "./pet-garden.js";
import { VISUAL_CAST } from "./room-schema.js";
import { createStatusTransport } from "./status-stream.js";

const canvas = document.getElementById("pet-overlay-canvas");
const context = canvas.getContext("2d");
const statusText = document.getElementById("pet-overlay-status");
const roster = document.getElementById("pet-overlay-roster");
const sprite = new Image();
const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

const state = {
  frame: 0,
  status: null,
  transport: "connecting",
  spriteReady: false,
  reducedMotion: motionQuery.matches,
  roaming: false,
  roamDirection: 1,
  reaction: null,
  reactionUntil: 0,
  reportedSquadState: null,
  mode: "compact",
  viewport: {
    width: 300,
    height: 280,
    scale: 1
  }
};

const roleLabels = Object.freeze({
  lead: "Reiko",
  ui: "UI",
  api: "API",
  db: "DB",
  docs: "Docs",
  scout: "Scout"
});

function visibleAgents() {
  return petOverlayAgents(state.status, VISUAL_CAST);
}

function roleLabel(agent) {
  return agent?.role_label || roleLabels[agent?.id] || agent?.display_name || agent?.id || "Reiko";
}

function postNativeMessage(message) {
  window.webkit?.messageHandlers?.reikoOverlay?.postMessage(message);
}

function syncSquadCount() {
  const count = Math.max(1, visibleAgents().length);
  const demo = state.status?.demo === true;
  if (
    state.reportedSquadState?.count === count &&
    state.reportedSquadState?.demo === demo
  ) {
    return;
  }
  state.reportedSquadState = { count, demo };
  postNativeMessage({ action: "setSquadCount", count, demo });
}

function setReaction(kind) {
  if (!["wave", "startled"].includes(kind)) return;
  state.reaction = kind;
  state.reactionUntil = performance.now() + (kind === "startled" ? 950 : 1200);
  state.frame = 0;
  draw();
}

function activeReaction() {
  if (!state.reaction || performance.now() >= state.reactionUntil) {
    state.reaction = null;
    state.reactionUntil = 0;
  }
  return state.reaction;
}

function updateAccessibleStatus() {
  const agents = visibleAgents();
  const spotlight = petSpotlightAgent(agents);
  const isDemo = state.status?.demo === true;
  const agentKind = isDemo ? "simulated Reiko" : "live Reiko";
  const roaming = petRoamingState({
    enabled: state.roaming,
    expanded: state.mode === "squad",
    reducedMotion: state.reducedMotion,
    direction: state.roamDirection
  });
  const modeDescription = state.mode === "compact"
    ? `${roleLabel(spotlight)}: ${petAgentStatusLabel(spotlight)}`
    : `${agents.length} ${agentKind} ${agents.length === 1 ? "agent" : "agents"}`;
  const motionDescription = roaming.active
    ? ` Roaming ${roaming.facing < 0 ? "left" : "right"}.`
    : "";
  canvas.setAttribute(
    "aria-label",
    isDemo
      ? `Animated Reiko pet overlay showing simulated Safe Demo status for ${modeDescription}`
      : `Animated Reiko pet overlay showing live Rei Ops Room status for ${modeDescription}`
  );
  statusText.textContent = state.status
    ? isDemo
      ? `Safe Demo simulation connected over ${state.transport}. ${modeDescription} shown; no live agent activity is shown.${motionDescription}`
      : `Reiko agent overlay connected over ${state.transport}. ${modeDescription} shown.${motionDescription}`
    : "Rei Ops Room is offline. Waiting to reconnect.";
  roster.replaceChildren();

  agents.forEach((agent) => {
    const item = document.createElement("li");
    item.textContent = `${roleLabel(agent)}: ${petAgentStatusLabel(agent)}`;
    roster.appendChild(item);
  });
}

function roundRect(x, y, width, height, radius) {
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
}

function drawLabel(agent, x, y, accent, isLead, pose, spotlight = false) {
  const status = petAgentStatusLabel(agent);
  const label = `${roleLabel(agent)} · ${status}`;
  const font = `${isLead || spotlight ? 700 : 600} ${spotlight ? 12 : 11}px ui-monospace, SFMono-Regular, Menlo, monospace`;

  context.save();
  context.font = font;
  const labelBox = petLabelBox({
    textWidth: context.measureText(label).width,
    preferredX: x,
    viewportWidth: state.viewport.width,
    minWidth: 72,
    maxWidth: spotlight ? 260 : 160,
    padding: 24,
    margin: 12
  });
  context.fillStyle = "rgba(20, 14, 10, 0.88)";
  context.strokeStyle = accent;
  context.lineWidth = isLead ? 1.5 : 1;
  roundRect(labelBox.centerX - labelBox.width / 2, y, labelBox.width, 22, 8);
  context.fill();
  context.stroke();
  context.fillStyle = isLead ? "#fff7e8" : "#e6dfd1";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(label, labelBox.centerX, y + 11.5, labelBox.maxTextWidth);
  context.restore();
}

function drawWorkProp(pose, x, floorY, accent, scale = 1) {
  const prop = petWorkPropForPose(pose);
  if (!prop) return;

  context.save();
  context.translate(x, floorY);
  context.scale(scale, scale);
  context.translate(-x, -floorY);
  context.lineWidth = 2;
  context.strokeStyle = accent;
  context.fillStyle = "rgba(20, 14, 10, 0.94)";

  if (prop === "laptop") {
    roundRect(x - 27, floorY - 47, 54, 34, 5);
    context.fill();
    context.stroke();
    context.fillStyle = "rgba(101, 228, 255, 0.28)";
    context.fillRect(x - 21, floorY - 41, 42, 21);
    context.fillStyle = accent;
    context.fillRect(x - 32, floorY - 12, 64, 5);
    context.fillStyle = "rgba(20, 14, 10, 0.94)";
    context.fillRect(x - 22, floorY - 10, 44, 5);
  } else if (prop === "coffee") {
    roundRect(x + 15, floorY - 32, 20, 22, 5);
    context.fill();
    context.stroke();
    context.beginPath();
    context.arc(x + 36, floorY - 22, 7, -Math.PI / 2, Math.PI / 2);
    context.stroke();
    context.fillStyle = accent;
    context.font = "700 15px ui-monospace, monospace";
    context.textAlign = "center";
    context.fillText("…", x, floorY - 18);
  } else if (prop === "book") {
    context.beginPath();
    context.moveTo(x, floorY - 12);
    context.lineTo(x - 29, floorY - 23);
    context.lineTo(x - 25, floorY - 50);
    context.lineTo(x, floorY - 39);
    context.closePath();
    context.fill();
    context.stroke();
    context.beginPath();
    context.moveTo(x, floorY - 12);
    context.lineTo(x + 29, floorY - 23);
    context.lineTo(x + 25, floorY - 50);
    context.lineTo(x, floorY - 39);
    context.closePath();
    context.fill();
    context.stroke();
    context.beginPath();
    context.moveTo(x, floorY - 39);
    context.lineTo(x, floorY - 12);
    context.stroke();
  }

  context.restore();
}

function drawDemoBadge() {
  const compact = state.mode === "compact";
  const badgeWidth = compact ? 96 : 174;
  const label = compact ? "SAFE DEMO" : "SAFE DEMO · SIMULATED";
  context.save();
  context.fillStyle = "rgba(20, 14, 10, 0.9)";
  context.strokeStyle = "#ffcc66";
  context.lineWidth = 1;
  roundRect(12, 10, badgeWidth, 25, 8);
  context.fill();
  context.stroke();
  context.fillStyle = "#fff7e8";
  context.font = "700 11px ui-monospace, SFMono-Regular, Menlo, monospace";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(label, 12 + badgeWidth / 2, 23);
  context.restore();
}

function accentFor(agent, index) {
  if (["failed", "error", "blocked"].includes(agent.activity)) return "#ff907c";
  if (["coding", "debugging", "executing", "running", "tooling"].includes(agent.activity)) {
    return index % 2 === 0 ? "#ffcc66" : "#7cffba";
  }
  if (["reading", "reviewing", "summarizing", "completed", "done"].includes(agent.activity)) {
    return "#65e4ff";
  }
  return "rgba(216, 202, 180, 0.68)";
}

function drawAgent(agent, index, count, spotlight = false) {
  const slotWidth = state.viewport.width / count;
  const isLead = agent.id === "lead";
  const baseX = slotWidth * (index + 0.5);
  const activity = String(agent.activity || "idle").toLowerCase();
  const roaming = petRoamingState({
    enabled: state.roaming,
    expanded: state.mode === "squad",
    reducedMotion: state.reducedMotion,
    direction: state.roamDirection
  });
  const reaction = spotlight || agent.id === "lead" ? activeReaction() : null;
  const visual = petVisualState({
    activity,
    roaming: activity === "moving" || roaming.active,
    reaction
  });
  const motionOffset = activity === "moving" && !roaming.active && !state.reducedMotion
    ? Math.sin((state.frame + index * 9) * 0.13) * Math.min(24, slotWidth * 0.18)
    : 0;
  const x = baseX + motionOffset;
  const floorY = state.viewport.height - (spotlight ? 35 : 38);
  const pose = visual.moving || reaction
    ? null
    : petWorkPoseAt({
        activity: visual.activity,
        frame: state.frame,
        actorId: agent.id,
        reducedMotion: state.reducedMotion
      });
  const animation = petFrameAt({
    activity: visual.activity,
    moving: visual.moving,
    facing: roaming.active
      ? roaming.facing
      : Math.cos((state.frame + index * 9) * 0.13) < 0
        ? -1
        : 1,
    pose,
    frame: state.frame,
    actorId: agent.id,
    reducedMotion: state.reducedMotion
  });
  const height = spotlight ? 202 : isLead ? 134 : 118;
  const width = height * (PET_ATLAS.cellWidth / PET_ATLAS.cellHeight);
  const accent = accentFor(agent, index);

  context.save();
  context.fillStyle = "rgba(0, 0, 0, 0.26)";
  context.beginPath();
  context.ellipse(x, floorY - 5, isLead ? 36 : 31, 9, 0, 0, Math.PI * 2);
  context.fill();
  context.restore();

  context.save();
  context.imageSmoothingEnabled = true;
  context.drawImage(
    sprite,
    animation.column * PET_ATLAS.cellWidth,
    animation.row * PET_ATLAS.cellHeight,
    PET_ATLAS.cellWidth,
    PET_ATLAS.cellHeight,
    x - width / 2,
    floorY - height,
    width,
    height
  );
  context.restore();

  drawWorkProp(pose, x, floorY, accent, spotlight ? 1.25 : 1);
  drawLabel(agent, x, floorY - 1, accent, isLead, pose, spotlight);
}

function drawOfflineState() {
  const width = Math.min(300, state.viewport.width - 24);
  const x = (state.viewport.width - width) / 2;
  context.save();
  context.fillStyle = "rgba(20, 14, 10, 0.86)";
  roundRect(x, state.viewport.height / 2 - 22, width, 44, 12);
  context.fill();
  context.strokeStyle = "rgba(255, 204, 102, 0.72)";
  context.stroke();
  context.fillStyle = "#f2ead9";
  context.font = "600 13px ui-monospace, SFMono-Regular, Menlo, monospace";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(
    state.mode === "compact" ? "Ops Room offline · reconnecting" : "Rei Ops Room offline · reconnecting",
    state.viewport.width / 2,
    state.viewport.height / 2
  );
  context.restore();
}

function draw() {
  context.setTransform(state.viewport.scale, 0, 0, state.viewport.scale, 0, 0);
  context.clearRect(0, 0, state.viewport.width, state.viewport.height);

  if (!state.spriteReady) return;
  if (!state.status) {
    drawOfflineState();
    return;
  }

  const agents = visibleAgents();
  if (state.mode === "compact") {
    const spotlight = petSpotlightAgent(agents);
    if (spotlight) drawAgent(spotlight, 0, 1, true);
  } else {
    agents.forEach((agent, index) => drawAgent(agent, index, agents.length));
  }
  if (state.status.demo === true) drawDemoBadge();
}

function resizeCanvas() {
  const width = Math.max(1, Math.round(window.innerWidth));
  const height = Math.max(1, Math.round(window.innerHeight));
  const scale = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
  state.mode = petOverlayModeForWidth(width);
  state.viewport = { width, height, scale };
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  updateAccessibleStatus();
  draw();
}

function animate() {
  state.frame += 1;
  draw();
  window.setTimeout(() => window.requestAnimationFrame(animate), 80);
}

const transport = createStatusTransport({
  onStatus(status) {
    state.status = status;
    updateAccessibleStatus();
    syncSquadCount();
  },
  onModeChange(mode) {
    state.transport = mode;
    updateAccessibleStatus();
  },
  onTransportError() {
    state.status = null;
    updateAccessibleStatus();
    syncSquadCount();
  }
});

sprite.addEventListener("load", () => {
  state.spriteReady = true;
  draw();
});
sprite.addEventListener("error", () => {
  statusText.textContent = "The Reiko pet atlas could not load.";
});
sprite.decoding = "async";
sprite.src = "/pets/reiko/spritesheet.webp";

motionQuery.addEventListener("change", (event) => {
  state.reducedMotion = event.matches;
  updateAccessibleStatus();
});

window.addEventListener("reiko-overlay-roaming", (event) => {
  state.roaming = event.detail?.active === true;
  state.roamDirection = Number(event.detail?.direction) < 0 ? -1 : 1;
  updateAccessibleStatus();
  draw();
});

window.addEventListener("reiko-overlay-react", (event) => {
  setReaction(event.detail?.kind);
});

canvas.addEventListener("click", () => {
  setReaction("wave");
});

window.addEventListener("resize", resizeCanvas);
window.addEventListener("beforeunload", () => transport.stop());
void transport.start();
resizeCanvas();
window.webkit?.messageHandlers?.reikoOverlay?.postMessage("ready");
syncSquadCount();
window.requestAnimationFrame(animate);
