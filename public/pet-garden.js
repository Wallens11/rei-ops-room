export const PET_ATLAS = Object.freeze({
  columns: 8,
  rows: 11,
  cellWidth: 192,
  cellHeight: 208
});

export const PET_GARDEN_STORAGE_KEY = "rei-ops-room-agent-garden-v1";

const ANIMATIONS = Object.freeze({
  idle: Object.freeze({ state: "idle", row: 0, frames: 6, holdFrames: 4 }),
  "running-right": Object.freeze({ state: "running-right", row: 1, frames: 8, holdFrames: 1 }),
  "running-left": Object.freeze({ state: "running-left", row: 2, frames: 8, holdFrames: 1 }),
  waving: Object.freeze({ state: "waving", row: 3, frames: 4, holdFrames: 3 }),
  jumping: Object.freeze({ state: "jumping", row: 4, frames: 5, holdFrames: 2 }),
  failed: Object.freeze({ state: "failed", row: 5, frames: 8, holdFrames: 4 }),
  waiting: Object.freeze({ state: "waiting", row: 6, frames: 6, holdFrames: 3 }),
  running: Object.freeze({ state: "running", row: 7, frames: 6, holdFrames: 2 }),
  review: Object.freeze({ state: "review", row: 8, frames: 6, holdFrames: 3 })
});

const FAILED_ACTIVITIES = new Set(["blocked", "error", "failed"]);
const WAITING_ACTIVITIES = new Set(["gathering", "meeting", "planning", "waiting"]);
const WORKING_ACTIVITIES = new Set(["coding", "debugging", "executing", "running", "tooling"]);
const REVIEW_ACTIVITIES = new Set(["reading", "reviewing", "summarizing", "completed", "done"]);
const MOVING_ACTIVITIES = new Set(["moving"]);
const REACTION_ACTIVITIES = new Set(["waving", "jumping"]);
const AMBIENT_ROAM_ACTIVITIES = new Set(["idle", "waiting"]);
const HIDDEN_JOB_STATUSES = new Set(["stale", "unknown"]);
const PET_ROLE_LABELS = Object.freeze({
  lead: "Reiko",
  ui: "UI",
  api: "API",
  db: "DB",
  docs: "Docs",
  scout: "Scout"
});

function normalizeActivity(activity) {
  return String(activity || "idle").trim().toLowerCase();
}

function actorOffset(actorId, frameCount) {
  const total = [...String(actorId || "pet")]
    .reduce((sum, character) => sum + character.codePointAt(0), 0);
  return total % frameCount;
}

export function petOverlayModeForWidth(width) {
  return Number(width) >= 520 ? "squad" : "compact";
}

export function petRoamingState({
  enabled = false,
  expanded = false,
  reducedMotion = false,
  direction = 1
} = {}) {
  return {
    active: Boolean(enabled) && !expanded && !reducedMotion,
    facing: Number(direction) < 0 ? -1 : 1
  };
}

export function petAmbientRoamingAllowed(agents = []) {
  if (!Array.isArray(agents) || agents.length !== 1) return false;
  return AMBIENT_ROAM_ACTIVITIES.has(normalizeActivity(agents[0]?.activity));
}

export function petLabelBox({
  textWidth = 0,
  preferredX = 0,
  viewportWidth = 1,
  minWidth = 72,
  maxWidth = 260,
  padding = 24,
  margin = 12
} = {}) {
  const safeViewportWidth = Math.max(1, Number(viewportWidth) || 1);
  const safeMargin = Math.max(0, Math.min(Number(margin) || 0, safeViewportWidth / 2));
  const availableWidth = Math.max(1, safeViewportWidth - safeMargin * 2);
  const safePadding = Math.max(0, Number(padding) || 0);
  const width = Math.min(
    availableWidth,
    Math.max(1, Number(maxWidth) || availableWidth),
    Math.max(Number(minWidth) || 0, (Number(textWidth) || 0) + safePadding)
  );
  const minCenterX = safeMargin + width / 2;
  const maxCenterX = safeViewportWidth - safeMargin - width / 2;
  const centerX = Math.min(
    Math.max(Number(preferredX) || 0, minCenterX),
    Math.max(minCenterX, maxCenterX)
  );

  return {
    width,
    centerX,
    maxTextWidth: Math.max(1, width - safePadding)
  };
}

export function petSpawnLabelOffset({ entering = false, index = 0 } = {}) {
  if (!entering) return 0;
  return Math.max(0, Math.floor(Number(index) || 0) % 3) * 14;
}

export function petSpawnState({
  frame = 0,
  index = 0,
  staggerFrames = 7,
  synced = false
} = {}) {
  const safeFrame = Math.max(0, Math.floor(Number(frame) || 0));
  const safeIndex = Math.max(0, Math.floor(Number(index) || 0));
  const safeStagger = Math.max(0, Math.floor(Number(staggerFrames) || 0));

  return {
    releaseFrame: synced ? safeFrame : safeFrame + safeIndex * safeStagger,
    entering: !synced,
    burstDone: Boolean(synced),
    labelIndex: safeIndex
  };
}

export function petSpotlightAgent(agents = []) {
  const ranked = [...agents].map((agent, index) => {
    const activity = normalizeActivity(agent?.activity);
    const urgency = FAILED_ACTIVITIES.has(activity)
      ? 0
      : WORKING_ACTIVITIES.has(activity)
        ? 1
        : MOVING_ACTIVITIES.has(activity)
          ? 2
          : REVIEW_ACTIVITIES.has(activity)
            ? 3
            : WAITING_ACTIVITIES.has(activity)
              ? 4
              : 5;

    return { agent, index, urgency };
  });

  ranked.sort((left, right) => left.urgency - right.urgency || left.index - right.index);
  return ranked[0]?.agent || null;
}

function rootOverlayActivity(status = {}) {
  const normalizedStatus = normalizeActivity(status?.status);
  const phase = normalizeActivity(status?.room?.phase);

  if (FAILED_ACTIVITIES.has(normalizedStatus)) return "failed";
  if (phase === "review_wrap") return "reviewing";
  if (normalizedStatus === "busy" || ["execution", "planning_huddle"].includes(phase)) {
    return "running";
  }
  return "idle";
}

function rootOverlayStatusLabel(status = {}, hasAgentJobs = false) {
  if (hasAgentJobs) return "coordinating";

  const activity = rootOverlayActivity(status);
  if (activity === "failed") return "failed";
  if (activity === "reviewing") return "reviewing";
  if (activity === "running") return "handling this chat";
  return "idle";
}

export function petOverlayAgents(status = {}, visualCast = []) {
  const runtimeAgents = Array.isArray(status?.agents) ? status.agents : [];
  const castAgents = Array.isArray(visualCast) ? visualCast : [];
  const castById = new Map(castAgents.map((agent) => [agent.id, agent]));
  const runtimeById = new Map(runtimeAgents.map((agent) => [agent.id, agent]));

  if (status?.demo === true) {
    return runtimeAgents.slice(0, 6).map((agent) => ({
      ...(castById.get(agent.id) || {}),
      ...agent,
      role_label: PET_ROLE_LABELS[agent.id] || agent.display_name || agent.id
    }));
  }

  const agentJobs = status?.taskIntelligence?.signals?.agent_jobs?.items;
  const realJobs = (Array.isArray(agentJobs) ? agentJobs : [])
    .filter((job) => job?.id && !HIDDEN_JOB_STATUSES.has(normalizeActivity(job.status)));
  const rootActivity = rootOverlayActivity(status);
  const leadRuntimeActivity = normalizeActivity(runtimeById.get("lead")?.activity);
  const lead = {
    ...(castById.get("lead") || {}),
    ...(runtimeById.get("lead") || {}),
    id: "lead",
    display_name: "Reiko",
    role_label: "Reiko",
    activity: realJobs.length > 0
      ? FAILED_ACTIVITIES.has(leadRuntimeActivity) ? leadRuntimeActivity : "reading"
      : rootActivity,
    status_label: rootOverlayStatusLabel(status, realJobs.length > 0)
  };

  const slotIds = [...new Set([
    ...castAgents.map((agent) => agent.id),
    ...runtimeAgents.map((agent) => agent.id)
  ])].filter((id) => id && id !== "lead" && PET_ROLE_LABELS[id]);
  const availableSlots = new Set(slotIds);
  let neutralAgentIndex = 0;
  const specialists = realJobs.flatMap((job) => {
    const assignedRuntime = runtimeAgents.find((agent) =>
      agent.id !== "lead" &&
      Array.isArray(agent.assigned_workstream_ids) &&
      agent.assigned_workstream_ids.includes(job.id)
    );
    const ownerSlot = job.owner !== "lead" && availableSlots.has(job.owner)
      ? job.owner
      : null;
    const slotId = assignedRuntime && availableSlots.has(assignedRuntime.id)
      ? assignedRuntime.id
      : ownerSlot || [...availableSlots][0];
    if (!slotId) return [];

    availableSlots.delete(slotId);
    const runtime = runtimeById.get(slotId);
    const hasDirectRole = assignedRuntime?.id === slotId || ownerSlot === slotId;
    const jobStatus = normalizeActivity(job.status);
    const runtimeActivity = normalizeActivity(runtime?.activity);
    const activity = FAILED_ACTIVITIES.has(jobStatus)
      ? "failed"
      : ["completed", "done"].includes(jobStatus)
        ? "reviewing"
        : jobStatus === "active"
          ? hasDirectRole && runtimeActivity !== "idle" ? runtimeActivity : "running"
          : "waiting";
    const roleLabel = hasDirectRole
      ? PET_ROLE_LABELS[slotId] || runtime?.display_name || slotId
      : `Agent ${++neutralAgentIndex}`;
    const assignedIds = Array.isArray(runtime?.assigned_workstream_ids)
      ? runtime.assigned_workstream_ids
      : [];

    return [{
      ...(castById.get(slotId) || {}),
      ...(runtime || {}),
      id: slotId,
      job_id: job.id,
      activity,
      assigned_zone: runtime?.assigned_zone || job.zone,
      assigned_workstream_ids: [...new Set([...assignedIds, job.id])],
      role_label: roleLabel
    }];
  });

  return [lead, ...specialists].slice(0, 6);
}

export function petGardenRenderActors({ actors = [], agents = [], enabled = false } = {}) {
  if (!enabled) return actors;

  const visibleIds = new Set(
    (Array.isArray(agents) ? agents : [])
      .map((agent) => agent?.id)
      .filter(Boolean)
  );
  return (Array.isArray(actors) ? actors : []).filter((actor) => visibleIds.has(actor?.id));
}

export function petGardenAgentStates({
  runtimeAgents = [],
  gardenAgents = [],
  enabled = false
} = {}) {
  return enabled ? gardenAgents : runtimeAgents;
}

export function petGardenActiveStatus(agents = [], { demo = false } = {}) {
  const count = Array.isArray(agents) ? agents.length : 0;

  if (demo) {
    return `Agent Garden active. ${count} simulated Safe Demo agents are shown.`;
  }
  if (count === 1) {
    const statusLabel = petAgentStatusLabel(agents[0]);
    return `Agent Garden active. Solo mode: Reiko is ${statusLabel}; no sub-agents are running.`;
  }
  const taskAgentCount = Math.max(0, count - 1);
  const agentNoun = taskAgentCount === 1 ? "agent" : "agents";
  const verb = taskAgentCount === 1 ? "is" : "are";
  return `Agent Garden active. Multi-agent mode: Reiko plus ${taskAgentCount} task ${agentNoun} ${verb} shown from runtime jobs.`;
}

export function petAgentStatusLabel(agent = {}, animationState = "idle") {
  const explicit = String(agent?.status_label || "").trim();
  return explicit || petStatusLabel(agent?.activity, animationState);
}

export function petVisualState({ activity = "idle", roaming = false, reaction = null } = {}) {
  const normalizedActivity = normalizeActivity(activity);
  const normalizedReaction = normalizeActivity(reaction);

  if (FAILED_ACTIVITIES.has(normalizedActivity)) {
    return { activity: normalizedActivity, moving: false };
  }
  if (normalizedReaction === "wave") {
    return { activity: "waving", moving: false };
  }
  if (normalizedReaction === "startled") {
    return { activity: "jumping", moving: false };
  }
  return { activity: normalizedActivity, moving: Boolean(roaming) };
}

export function petWorkPoseAt({
  activity,
  frame = 0,
  actorId = "pet",
  reducedMotion = false
} = {}) {
  const normalized = normalizeActivity(activity);

  if (!WORKING_ACTIVITIES.has(normalized) && !REVIEW_ACTIVITIES.has(normalized)) {
    return null;
  }

  if (reducedMotion) {
    return WORKING_ACTIVITIES.has(normalized) ? "type" : "read";
  }

  const tick = Math.max(0, Math.floor(Number(frame) || 0));
  const phase = (tick + actorOffset(actorId, 17) * 5) % 72;

  if (WORKING_ACTIVITIES.has(normalized)) {
    if (phase < 28 || phase >= 48) return "type";
    if (phase < 38) return "sit";
    return "read";
  }

  return phase >= 26 && phase < 38 ? "sit" : "read";
}

export function petWorkPropForPose(pose) {
  return {
    type: "laptop",
    sit: "coffee",
    read: "book"
  }[normalizeActivity(pose)] || null;
}

export function resolvePetAnimation({ activity, moving = false, facing = 1, pose: requestedPose } = {}) {
  const normalized = normalizeActivity(activity);
  const pose = normalizeActivity(requestedPose);

  if (FAILED_ACTIVITIES.has(normalized)) {
    return ANIMATIONS.failed;
  }

  if (REACTION_ACTIVITIES.has(normalized)) {
    return ANIMATIONS[normalized];
  }

  if (moving || normalized === "moving") {
    return facing < 0 ? ANIMATIONS["running-left"] : ANIMATIONS["running-right"];
  }

  if (WAITING_ACTIVITIES.has(normalized)) {
    return ANIMATIONS.waiting;
  }

  if (WORKING_ACTIVITIES.has(normalized)) {
    if (pose === "read") return ANIMATIONS.review;
    if (pose === "sit") return ANIMATIONS.idle;
    return ANIMATIONS.running;
  }

  if (REVIEW_ACTIVITIES.has(normalized)) {
    if (pose === "sit") return ANIMATIONS.idle;
    return ANIMATIONS.review;
  }

  return ANIMATIONS.idle;
}

export function petStatusLabel(activity, animationState = "idle") {
  const normalized = normalizeActivity(activity);

  if (FAILED_ACTIVITIES.has(normalized)) return normalized;
  if (WAITING_ACTIVITIES.has(normalized)) return "waiting";
  if (WORKING_ACTIVITIES.has(normalized)) return "working";
  if (REVIEW_ACTIVITIES.has(normalized)) return normalized === "completed" || normalized === "done"
    ? "done"
    : "review";
  if (normalized === "moving" || animationState === "running-left" || animationState === "running-right") {
    return "moving";
  }

  return "idle";
}

export function shouldLoadPetSprite({
  enabled = false,
  ready = false,
  failed = false,
  started = false
} = {}) {
  return Boolean(enabled) && !ready && !failed && !started;
}

export function petFrameAt({
  activity,
  moving = false,
  facing = 1,
  pose,
  frame = 0,
  actorId = "pet",
  reducedMotion = false
} = {}) {
  const animation = resolvePetAnimation({ activity, moving, facing, pose });
  const tick = Math.max(0, Math.floor(Number(frame) || 0));
  const column = reducedMotion
    ? 0
    : (Math.floor(tick / animation.holdFrames) + actorOffset(actorId, animation.frames)) %
      animation.frames;

  return {
    ...animation,
    column
  };
}
