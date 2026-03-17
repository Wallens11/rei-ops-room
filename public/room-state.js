import {
  AGENT_BY_ID,
  DEFAULT_DESCRIPTION,
  DEFAULT_HEADLINE,
  ROOM_PHASES,
  ROOM_TITLE,
  SKILL_BADGE_LIBRARY,
  VISUAL_CAST,
  ZONE_BY_ID,
  ZONE_DEFINITIONS,
  ZONE_TO_AGENT
} from "./room-schema.js";

const PLANNING_TERMS = [
  "plan",
  "planning",
  "brief",
  "briefing",
  "outline",
  "scope",
  "strategy",
  "brainstorm",
  "huddle",
  "spec"
];
const REVIEW_TERMS = [
  "review",
  "wrap",
  "summary",
  "summarize",
  "handoff",
  "final",
  "label",
  "copy"
];
const DELEGATION_TERMS = [
  "spawn_agent",
  "spawn agent",
  "subagent",
  "parallel",
  "worker",
  "explorer",
  "send_input",
  "wait_agent"
];
const RESULT_TERMS = ["wait_agent", "result", "returned", "merged", "done", "completed"];
const DEBUG_TERMS = ["debug", "fix", "error", "fail", "failing", "trace"];
const READING_TERMS = ["read", "inspect", "parse", "mapping", "map", "log", "logs"];
const SUMMARY_TERMS = ["summary", "summarize", "label", "wrap", "handoff", "review"];
const SCOUT_EVENT_PRIORITY = [
  "review_requested",
  "workstream_spawned",
  "result_returned",
  "handoff_created",
  "reassignment_triggered"
];
const SKILL_HEURISTICS = [
  {
    id: "test-driven-development",
    patterns: ["npm test", "node --test", "red-green", "regression test"]
  },
  {
    id: "verification-before-completion",
    patterns: ["git status", "curl -s http://localhost:4317/api/status", "console_messages", "browser_snapshot", "browser_take_screenshot", "verification"]
  },
  {
    id: "webapp-testing",
    patterns: ["playwright", "browser_navigate", "browser_wait_for", "browser_click", "browser_take_screenshot"]
  }
];

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function roundConfidence(value) {
  return Math.round(clamp(value, 0.2, 0.99) * 100) / 100;
}

function normalizeText(...parts) {
  return parts
    .flat()
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function unique(values) {
  return [...new Set(values)];
}

function countMatches(text, terms, weight = 1) {
  const hits = [];
  let score = 0;

  for (const term of terms) {
    if (!text.includes(term)) {
      continue;
    }

    hits.push(term);
    score += (term.length >= 7 ? 1.3 : 1) * weight;
  }

  return { hits, score };
}

function sourceScore(text, keywords, weight) {
  if (!text) {
    return { score: 0, hits: [] };
  }

  return countMatches(text.toLowerCase(), keywords, weight);
}

function zoneFromId(zoneId) {
  return ZONE_BY_ID[zoneId] || ZONE_BY_ID.lab;
}

function baseSignals({ thread, repoContext, activity, logs, status }) {
  const primaryText = normalizeText(thread?.title, activity?.summary);
  const secondaryText = normalizeText(thread?.cwd, thread?.gitBranch, repoContext?.title, repoContext?.cwd);
  const logText = normalizeText(logs.slice(0, 24).map((log) => log.message));
  const toolCalls = logs
    .slice(0, 18)
    .filter((log) => (log.message || "").includes("ToolCall:")).length;

  const zoneScores = {};
  const zoneHits = {};

  for (const zone of ZONE_DEFINITIONS.filter((entry) => entry.id !== "lab")) {
    const primary = sourceScore(primaryText, zone.keywords, 4);
    const secondary = sourceScore(secondaryText, zone.keywords, 2);
    const log = sourceScore(logText, zone.keywords, 2.5);
    zoneScores[zone.id] = primary.score + secondary.score + log.score;
    zoneHits[zone.id] = unique([...primary.hits, ...secondary.hits, ...log.hits]);
  }

  const sortedZones = Object.entries(zoneScores)
    .sort((left, right) => right[1] - left[1])
    .map(([zoneId, score]) => ({ zoneId, score, hits: zoneHits[zoneId] }));
  const top = sortedZones[0] || { zoneId: "lab", score: 0, hits: [] };
  const second = sortedZones[1] || { zoneId: "lab", score: 0, hits: [] };

  const planning = countMatches(normalizeText(primaryText, logText), PLANNING_TERMS, 1.1);
  const review = countMatches(normalizeText(primaryText, logText), REVIEW_TERMS, 1.1);
  const delegation = countMatches(normalizeText(primaryText, logText), DELEGATION_TERMS, 1.25);
  const results = countMatches(logText, RESULT_TERMS, 1.2);
  const debug = countMatches(normalizeText(primaryText, logText), DEBUG_TERMS, 1.1);
  const reading = countMatches(normalizeText(primaryText, logText), READING_TERMS, 1);
  const summarizing = countMatches(normalizeText(primaryText, logText), SUMMARY_TERMS, 1);
  const newRequest = (thread?.updatedAgeSeconds ?? Number.POSITIVE_INFINITY) <= 45;
  const passiveMode = activity?.kind === "rest" || activity?.kind === "observer";
  const toolBurst = clamp(toolCalls / 3, 0, 4);
  const multiCandidate =
    delegation.score +
    (second.score >= Math.max(2.5, top.score * 0.45) ? 1.25 : 0) +
    (review.score >= 2.2 && top.zoneId !== "review" ? 0.75 : 0) +
    (toolBurst >= 1.5 ? 0.4 : 0);
  const focusZone = passiveMode && status !== "busy" ? "lab" : top.score >= 1.2 ? top.zoneId : "lab";
  const focusConfidence =
    focusZone === "lab"
      ? roundConfidence(newRequest ? 0.52 : 0.46)
      : roundConfidence((top.score + 1.5) / (top.score + second.score + 3));

  return {
    request: thread?.title || activity?.summary || "Standby di room",
    current_repo: resolveCurrentRepo(thread, repoContext),
    current_task_summary:
      passiveMode && status !== "busy"
        ? "Istirahat sejenak"
        : activity?.summary || thread?.title || "Standby di room aktif",
    dominant_zone: focusZone,
    confidence: focusConfidence,
    mode: passiveMode && status !== "busy" ? "solo" : multiCandidate >= 1.9 ? "multi" : "solo",
    zone_scores: zoneScores,
    zone_hits: zoneHits,
    sorted_zones: sortedZones,
    signals: {
      new_request: newRequest,
      planning,
      review,
      delegation,
      results,
      debug,
      reading,
      summarizing,
      passive_mode: passiveMode,
      tool_burst: toolBurst,
      tool_calls: toolCalls,
      status
    }
  };
}

function resolveCurrentRepo(thread, repoContext) {
  if (thread?.cwdDisplay === "workspace root" && repoContext?.repoName) {
    return repoContext.repoName;
  }

  return thread?.repoName || repoContext?.repoName || "workspace";
}

function inferOrchestration(taskIntelligence, { status, thread, activity }) {
  const {
    confidence,
    dominant_zone: dominantZone,
    mode,
    signals
  } = taskIntelligence;
  const standbyDueToInactivity =
    !thread ||
    signals.passive_mode ||
    (status === "idle" && (activity?.lastLogAgeSeconds ?? Number.POSITIVE_INFINITY) > 20 * 60);

  let roomPhase = "execution";
  let reason = `${zoneFromId(dominantZone).title} jadi owner utama karena sinyalnya paling kuat.`;

  if (standbyDueToInactivity) {
    roomPhase = "standby";
    reason = "Belum ada activity baru, jadi room kembali tenang di area tengah.";
  } else if (signals.review.score >= 2.4 && (signals.results.score > 0 || mode === "multi")) {
    roomPhase = "review_wrap";
    reason = "Ada pola review / result return, jadi hasil dipindah ke review lane.";
  } else if (signals.delegation.score >= 1.25 && mode === "multi") {
    roomPhase = "squad_split";
    reason = "Delegation kebaca cukup jelas, jadi squad dipecah ke workstream yang relevan.";
  } else if (
    (signals.planning.score >= 1.4 &&
      (signals.new_request || confidence < 0.82 || dominantZone === "lab")) ||
    (signals.new_request && (confidence < 0.72 || dominantZone === "lab"))
  ) {
    roomPhase = "planning_huddle";
    reason = "Fokus belum cukup stabil, jadi squad kumpul dulu buat ngunci arah.";
  }

  const phaseConfidence = roundConfidence(
    roomPhase === "standby"
      ? 0.93
      : roomPhase === "review_wrap"
        ? 0.8 + signals.review.score * 0.03
        : roomPhase === "squad_split"
          ? 0.75 + signals.delegation.score * 0.04
          : roomPhase === "planning_huddle"
            ? 0.68 + signals.planning.score * 0.04
            : 0.7 + confidence * 0.25
  );

  return {
    room_phase: roomPhase,
    phase_confidence: phaseConfidence,
    mode,
    assignment: {
      focus_zone: dominantZone,
      active_owner: ZONE_TO_AGENT[dominantZone] || "lead"
    },
    review_trigger: signals.review.score >= 2.4 || roomPhase === "review_wrap",
    standby_trigger: standbyDueToInactivity,
    reason
  };
}

function shortTask(summary, fallback) {
  if (!summary) {
    return fallback;
  }

  return summary.length > 72 ? `${summary.slice(0, 69)}...` : summary;
}

function titleizeSkillSlug(slug) {
  return slug
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function extractSkills(logs = []) {
  const pathPattern = /(?:\.codex|\.agents)\/skills\/([^/\s]+)\/SKILL\.md/gi;
  const explicitPattern = /\$([a-z0-9-]+)/gi;
  const found = new Map();
  const aggregateText = normalizeText(logs.map((log) => log.message || ""));

  for (const log of logs) {
    const haystack = `${log.message || ""} ${extractCommandLike(log.message || "")}`.trim();

    for (const match of haystack.matchAll(pathPattern)) {
      const skillId = match[1];
      if (!found.has(skillId)) {
        found.set(skillId, {
          id: skillId,
          source: "skill_file",
          ts: Number(log.ts || 0)
        });
      }
    }

    for (const match of haystack.matchAll(explicitPattern)) {
      const skillId = match[1];
      if (SKILL_BADGE_LIBRARY[skillId] && !found.has(skillId)) {
        found.set(skillId, {
          id: skillId,
          source: "skill_ref",
          ts: Number(log.ts || 0)
        });
      }
    }
  }

  SKILL_HEURISTICS.forEach((rule) => {
    if (found.has(rule.id)) {
      return;
    }

    if (rule.patterns.some((pattern) => aggregateText.includes(pattern))) {
      found.set(rule.id, {
        id: rule.id,
        source: "heuristic",
        ts: 0
      });
    }
  });

  return [...found.values()]
    .sort((left, right) => right.ts - left.ts)
    .slice(0, 4)
    .map((entry) => ({
      id: entry.id,
      label: SKILL_BADGE_LIBRARY[entry.id]?.label || titleizeSkillSlug(entry.id),
      color: SKILL_BADGE_LIBRARY[entry.id]?.color || "#b8a2ff",
      source: entry.source
    }));
}

function extractCommandLike(message) {
  const command = message.match(/"cmd":"((?:\\.|[^"])*)"/);
  if (!command) {
    return "";
  }

  return command[1];
}

function buildWorkstreams(taskIntelligence, orchestration) {
  const streams = [];
  const dominantZone = taskIntelligence.dominant_zone;
  const focusOwner = ZONE_TO_AGENT[dominantZone] || "lead";
  const secondaries = taskIntelligence.sorted_zones
    .filter((entry) => entry.zoneId !== dominantZone && entry.score >= 2.8)
    .slice(0, 2);

  if (orchestration.room_phase === "standby") {
    return [
      {
        id: "ws_standby",
        owner: "lead",
        zone: "lab",
        task: "Watch the room and wait for the next request",
        status: "queued"
      }
    ];
  }

  if (orchestration.room_phase === "planning_huddle") {
    streams.push({
      id: "ws_plan",
      owner: "lead",
      zone: "lab",
      task: "Clarify scope, lock repo context, and pick the first desk",
      status: "active"
    });
  } else {
    streams.push({
      id: "ws_main",
      owner: focusOwner,
      zone: dominantZone,
      task: shortTask(
        taskIntelligence.current_task_summary,
        zoneFromId(dominantZone).defaultTask
      ),
      status: orchestration.room_phase === "review_wrap" ? "completed" : "active"
    });
  }

  if (orchestration.mode === "multi") {
    secondaries.forEach((entry, index) => {
      const zone = zoneFromId(entry.zoneId);
      streams.push({
        id: `ws_${entry.zoneId}_${index + 1}`,
        owner: zone.ownerId,
        zone: zone.id,
        task: zone.defaultTask,
        status: orchestration.room_phase === "squad_split" ? "active" : "queued"
      });
    });
  }

  if (
    orchestration.review_trigger ||
    orchestration.room_phase === "review_wrap" ||
    taskIntelligence.mode === "multi"
  ) {
    streams.push({
      id: "ws_review",
      owner: "docs",
      zone: "review",
      task:
        orchestration.room_phase === "review_wrap"
          ? "Review returned work and prepare concise wrap"
          : "Prepare concise labels and handoff copy",
      status: orchestration.room_phase === "review_wrap" ? "active" : "queued"
    });
  }

  return streams;
}

function buildRecentEvents(taskIntelligence, orchestration, workstreams, thread) {
  const events = [];

  if (taskIntelligence.signals.new_request) {
    events.push({
      type: "new_request",
      title: "Request masuk",
      detail: thread?.title || taskIntelligence.current_task_summary
    });
  }

  if (taskIntelligence.dominant_zone !== "lab" && taskIntelligence.confidence >= 0.72) {
    events.push({
      type: "zone_locked",
      zone: taskIntelligence.dominant_zone,
      confidence: taskIntelligence.confidence
    });
  }

  const spawned = workstreams.filter(
    (workstream) => workstream.id !== "ws_main" && workstream.id !== "ws_plan"
  );
  if (orchestration.room_phase === "squad_split") {
    spawned.forEach((workstream) => {
      events.push({
        type: "workstream_spawned",
        workstream_id: workstream.id,
        zone: workstream.zone
      });
    });
  }

  if (taskIntelligence.mode === "multi" && spawned.length > 0) {
    const docsStream = workstreams.find((workstream) => workstream.owner === "docs");
    if (docsStream) {
      events.push({
        type: "handoff_created",
        from: "lead",
        to: "docs",
        payload: "prepare concise labels"
      });
    }
  }

  if (orchestration.room_phase === "review_wrap") {
    events.push({
      type: "review_requested",
      zone: "review"
    });
  }

  if (taskIntelligence.signals.results.score > 0) {
    events.push({
      type: "result_returned",
      from: taskIntelligence.dominant_zone,
      to: orchestration.room_phase === "review_wrap" ? "review" : "lab"
    });
  }

  const secondary = taskIntelligence.sorted_zones.find(
    (entry) => entry.zoneId !== taskIntelligence.dominant_zone && entry.score >= 2.4
  );
  if (secondary && orchestration.mode === "multi") {
    events.push({
      type: "reassignment_triggered",
      zone: secondary.zoneId
    });
  }

  return events.slice(0, 6);
}

function findScoutEvent(recentEvents) {
  for (const eventType of SCOUT_EVENT_PRIORITY) {
    const event = recentEvents.find((entry) => entry.type === eventType);
    if (event) {
      return event;
    }
  }

  return null;
}

function buildSceneDirector(room, workstreams, recentEvents) {
  const scoutEvent = findScoutEvent(recentEvents);
  const activeWorkstreams = workstreams.filter((workstream) => workstream.status === "active");
  const highlightZones = unique(activeWorkstreams.map((workstream) => workstream.zone));

  let scout = {
    active: false,
    from_zone: "lab",
    to_zone: "lab",
    payload: null,
    reason: null
  };

  if (scoutEvent) {
    if (scoutEvent.type === "workstream_spawned") {
      scout = {
        active: true,
        from_zone: "lab",
        to_zone: scoutEvent.zone,
        payload: "new workstream",
        reason: scoutEvent.type
      };
    } else if (scoutEvent.type === "handoff_created") {
      scout = {
        active: true,
        from_zone: "lab",
        to_zone: "review",
        payload: scoutEvent.payload,
        reason: scoutEvent.type
      };
    } else if (scoutEvent.type === "review_requested") {
      scout = {
        active: true,
        from_zone: room.focus_zone,
        to_zone: "review",
        payload: "review request",
        reason: scoutEvent.type
      };
    } else if (scoutEvent.type === "result_returned") {
      scout = {
        active: true,
        from_zone: scoutEvent.from || room.focus_zone,
        to_zone: scoutEvent.to || "lab",
        payload: "result returned",
        reason: scoutEvent.type
      };
    } else if (scoutEvent.type === "reassignment_triggered") {
      scout = {
        active: true,
        from_zone: "lab",
        to_zone: scoutEvent.zone,
        payload: "reassign focus",
        reason: scoutEvent.type
      };
    }
  }

  const phaseMeta = ROOM_PHASES[room.phase] || ROOM_PHASES.standby;
  const primaryBubble =
    room.resting
      ? { actor_id: "lead", text: "istirahat dulu", tone: "calm" }
      : room.phase === "planning_huddle"
      ? { actor_id: "lead", text: "briefing route", tone: "steady" }
      : room.phase === "squad_split"
        ? {
            actor_id: scout.active ? "scout" : "lead",
            text: scout.payload || "split work",
            tone: "busy"
          }
        : room.phase === "review_wrap"
          ? { actor_id: "docs", text: "review + wrap", tone: "calm" }
          : room.phase === "execution"
            ? {
                actor_id: ZONE_TO_AGENT[room.focus_zone] || "lead",
                text: shortTask(room.current_task, zoneFromId(room.focus_zone).shortTitle),
                tone: room.status === "busy" ? "busy" : "steady"
              }
            : { actor_id: "lead", text: "standby", tone: "calm" };

  return {
    title: ROOM_TITLE,
    headline: DEFAULT_HEADLINE,
    description: DEFAULT_DESCRIPTION,
    resting: room.resting,
    tone:
      room.resting
        ? "rest"
        : room.phase === "standby"
        ? "calm"
        : room.phase === "review_wrap"
          ? "steady"
          : room.status === "busy"
            ? "busy"
            : "steady",
    camera: room.resting ? "rest-lab" : room.mode === "multi" ? "wide" : `focus-${room.focus_zone}`,
    desk_highlights: room.resting
      ? ["lab"]
      : unique([room.focus_zone, ...highlightZones]).filter(Boolean),
    primary_bubble: primaryBubble,
    scout,
    skill_badges: room.skills || [],
    phase_title: phaseMeta.title,
    phase_reason: room.phase_reason,
    focus_title: zoneFromId(room.focus_zone).title,
    focus_reason: room.focus_reason
  };
}

function inferWorkerActivity(agentId, roomPhase, stream, taskIntelligence) {
  if (!stream) {
    return roomPhase === "planning_huddle" ? "gathering" : "waiting";
  }

  if (roomPhase === "squad_split") {
    return "moving";
  }

  if (roomPhase === "review_wrap") {
    if (agentId === "docs") {
      return "reviewing";
    }

    return stream.status === "completed" ? "summarizing" : "waiting";
  }

  if (stream.status === "queued") {
    return "waiting";
  }

  if (agentId === "docs") {
    return taskIntelligence.signals.summarizing.score > 0 ? "summarizing" : "reviewing";
  }

  if (taskIntelligence.signals.debug.score > 0) {
    return "debugging";
  }

  if (agentId === "db" && taskIntelligence.signals.reading.score > 0) {
    return "reading";
  }

  return "coding";
}

function buildAgentStates(workstreams, orchestration, taskIntelligence, scene) {
  const workstreamsByOwner = workstreams.reduce((accumulator, workstream) => {
    accumulator[workstream.owner] ||= [];
    accumulator[workstream.owner].push(workstream);
    return accumulator;
  }, {});

  return VISUAL_CAST.map((agent) => {
    if (agent.id === "scout") {
      return {
        id: agent.id,
        display_name: agent.displayName,
        home_zone: agent.homeZone,
        assigned_zone: scene.scout.active ? "between_zones" : agent.homeZone,
        visual_role: agent.visualRole,
        activity:
          scene.scout.active
            ? "moving"
            : orchestration.room_phase === "standby" && taskIntelligence.signals.passive_mode
              ? "idle"
              : "waiting",
        carrying: scene.scout.payload,
        assigned_workstream_ids: []
      };
    }

    const ownedStreams = workstreamsByOwner[agent.id] || [];
    const primaryStream = ownedStreams.find((stream) => stream.status === "active") || ownedStreams[0];
    const assignedZone =
      orchestration.room_phase === "planning_huddle" || taskIntelligence.signals.passive_mode
        ? "lab"
        : primaryStream?.zone || agent.defaultAssignedZone;

    let activity = inferWorkerActivity(agent.id, orchestration.room_phase, primaryStream, taskIntelligence);

    if (agent.id === "lead") {
      activity =
        orchestration.room_phase === "standby"
          ? "idle"
          : orchestration.room_phase === "planning_huddle"
            ? "gathering"
            : orchestration.room_phase === "squad_split"
              ? "moving"
              : orchestration.room_phase === "review_wrap"
                ? "summarizing"
                : "reading";
    }

    if (agent.id === "docs" && orchestration.room_phase === "review_wrap") {
      activity = "reviewing";
    }

    if (orchestration.room_phase === "standby" && taskIntelligence.signals.passive_mode) {
      activity = "idle";
    }

    return {
      id: agent.id,
      display_name: agent.displayName,
      home_zone: agent.homeZone,
      assigned_zone: assignedZone,
      visual_role: agent.visualRole,
      activity,
      assigned_workstream_ids: ownedStreams.map((stream) => stream.id)
    };
  });
}

function roomReason(taskIntelligence, orchestration) {
  const zone = zoneFromId(taskIntelligence.dominant_zone);
  const hitPreview = taskIntelligence.zone_hits[taskIntelligence.dominant_zone]?.slice(0, 3).join(", ");

  return {
    phase_reason: orchestration.reason,
    focus_reason:
      taskIntelligence.dominant_zone === "lab"
        ? "Belum ada owner desk yang benar-benar ngunci fokus, jadi room tetap kumpul di tengah."
        : `${zone.detail}${hitPreview ? ` Kebaca dari: ${hitPreview}.` : ""}`
  };
}

export function buildRoomState({ status, thread, repoContext, recentThreads = [], activity, logs = [] }) {
  const taskIntelligence = baseSignals({
    status,
    thread,
    repoContext,
    activity,
    logs
  });
  const orchestration = inferOrchestration(taskIntelligence, { status, thread, activity });
  const reasons = roomReason(taskIntelligence, orchestration);

  const room = {
    title: ROOM_TITLE,
    phase: orchestration.room_phase,
    phase_confidence: orchestration.phase_confidence,
    focus_zone: taskIntelligence.dominant_zone,
    focus_confidence: taskIntelligence.confidence,
    status,
    current_task: taskIntelligence.current_task_summary,
    current_repo: taskIntelligence.current_repo,
    mode: orchestration.mode,
    resting: orchestration.room_phase === "standby" && taskIntelligence.signals.passive_mode,
    skills: extractSkills(logs),
    phase_reason: reasons.phase_reason,
    focus_reason: reasons.focus_reason
  };

  const workstreams = buildWorkstreams(taskIntelligence, orchestration);
  const recentEvents = buildRecentEvents(taskIntelligence, orchestration, workstreams, thread);
  const scene = buildSceneDirector(room, workstreams, recentEvents);
  const agents = buildAgentStates(workstreams, orchestration, taskIntelligence, scene);

  return {
    status,
    room,
    taskIntelligence,
    orchestration,
    workstreams,
    agents,
    recent_events: recentEvents,
    skills: room.skills,
    scene,
    thread,
    repoContext,
    recentThreads,
    activity,
    ui: {
      headline: DEFAULT_HEADLINE,
      description: DEFAULT_DESCRIPTION
    },
    phase: {
      mode: room.phase,
      title: ROOM_PHASES[room.phase]?.title || ROOM_PHASES.standby.title,
      reason: room.phase_reason,
      confidence: room.phase_confidence
    },
    focus: {
      zone: room.focus_zone,
      title: zoneFromId(room.focus_zone).title,
      reason: room.focus_reason,
      confidence: room.focus_confidence
    }
  };
}
