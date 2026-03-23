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
const REVIEW_EVIDENCE_TERMS = [
  "review requested",
  "review request",
  "result returned",
  "returned result",
  "returned results",
  "wait_agent",
  "prepare concise labels",
  "summarize changes",
  "human-readable wrap",
  "review wrap"
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
const RESULT_TERMS = [
  "wait_agent",
  "result returned",
  "returned result",
  "returned results",
  "results came back",
  "worker results"
];
const DEBUG_TERMS = ["debug", "fix", "error", "fail", "failing", "trace"];
const READING_TERMS = ["read", "inspect", "parse", "mapping", "map", "log", "logs"];
const SUMMARY_TERMS = ["summary", "summarize", "label", "wrap", "handoff", "review"];
const SCOUT_EVENT_PRIORITY = [
  "result_returned",
  "review_requested",
  "workstream_spawned",
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
const REVIEW_STAGE_RESULT_RETURNING_MAX = 24;
const REVIEW_STAGE_REGROUP_MAX = 60;
const REVIEW_STAGE_COOLDOWN_MIN = 90;
const LIVE_RUNTIME_MAX_SECONDS = 10;
const RECENT_RUNTIME_MAX_SECONDS = 60;
const RUNTIME_NOISE_SNIPPETS = [
  "registering event source with poller",
  "token usage",
  "tool gate released",
  "waiting for tool gate",
  "websocket request:",
  "websocket event:",
  "unhandled responses event:",
  "successfully connected to websocket:"
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

function parseJsonObject(value) {
  if (!value || typeof value !== "string") {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function parseTimestampSeconds(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 1e12 ? Math.round(value / 1000) : Math.round(value);
  }

  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return numeric > 1e12 ? Math.round(numeric / 1000) : Math.round(numeric);
  }

  const parsed = Date.parse(String(value));
  return Number.isNaN(parsed) ? null : Math.round(parsed / 1000);
}

function inferNowSeconds(thread, activity) {
  if (
    Number.isFinite(thread?.updatedAt) &&
    Number.isFinite(thread?.updatedAgeSeconds)
  ) {
    return Number(thread.updatedAt) + Number(thread.updatedAgeSeconds);
  }

  const lastLogAt = parseTimestampSeconds(activity?.lastLogAt);
  if (Number.isFinite(lastLogAt) && Number.isFinite(activity?.lastLogAgeSeconds)) {
    return lastLogAt + Number(activity.lastLogAgeSeconds);
  }

  return null;
}

function fallbackLabelForZone(zoneId, kind = "task") {
  if (kind === "result") {
    if (zoneId === "frontend") {
      return "layout result";
    }

    if (zoneId === "backend") {
      return "runtime result";
    }

    if (zoneId === "database") {
      return "trace result";
    }

    if (zoneId === "review") {
      return "review result";
    }

    return "result return";
  }

  if (zoneId === "frontend") {
    return "layout check";
  }

  if (zoneId === "backend") {
    return "runtime mapping";
  }

  if (zoneId === "database") {
    return "trace reading";
  }

  if (zoneId === "review") {
    return "review wrap";
  }

  return "coordination pass";
}

function looksLikePromptTitle(summary) {
  const text = String(summary || "").trim();
  const normalized = text.toLowerCase();

  if (!text) {
    return false;
  }

  return (
    text.length > 108 ||
    normalized.startsWith("rei ") ||
    normalized.startsWith("btw ") ||
    normalized.startsWith("aku ") ||
    normalized.includes(" wkwk") ||
    normalized.includes("https://") ||
    normalized.includes("http://")
  );
}

function humanizeSummary(summary, { zoneId = "lab", kind = "task" } = {}) {
  const normalized = normalizeText(summary);

  if (!normalized) {
    return fallbackLabelForZone(zoneId, kind);
  }

  if (
    normalized.includes("wait_agent") ||
    normalized.includes("result returned") ||
    normalized.includes("results returned") ||
    normalized.includes("worker results")
  ) {
    return "result return";
  }

  if (
    normalized.includes("review") ||
    normalized.includes("wrap") ||
    normalized.includes("summary") ||
    normalized.includes("summarize") ||
    normalized.includes("handoff") ||
    normalized.includes("label")
  ) {
    return "review wrap";
  }

  if (
    normalized.includes("npm test") ||
    normalized.includes("node --test") ||
    normalized.includes("verification") ||
    normalized.includes("verify") ||
    normalized.includes("playwright") ||
    normalized.includes("browser_snapshot") ||
    normalized.includes("browser_take_screenshot") ||
    normalized.includes("test")
  ) {
    return "verification pass";
  }

  if (
    normalized.includes("agent pixel") ||
    normalized.includes("pixel room") ||
    normalized.includes("ops room")
  ) {
    return "pixel ops room";
  }

  if (
    normalized.includes("ipconfig") ||
    normalized.includes("getifaddr") ||
    normalized.includes("networksetup") ||
    normalized.includes("lan") ||
    normalized.includes("ipad") ||
    normalized.includes("wifi")
  ) {
    return "network check";
  }

  if (
    normalized.includes("layout") ||
    normalized.includes("css") ||
    normalized.includes("style") ||
    normalized.includes("responsive") ||
    normalized.includes("widget") ||
    normalized.includes("canvas") ||
    normalized.includes("overflow") ||
    normalized.includes("clipping")
  ) {
    return "layout check";
  }

  if (
    normalized.includes("runtime") ||
    normalized.includes("orchestration") ||
    normalized.includes("server") ||
    normalized.includes("api") ||
    normalized.includes("state") ||
    normalized.includes("mapping") ||
    normalized.includes("session")
  ) {
    return "runtime mapping";
  }

  if (
    normalized.includes("sqlite") ||
    normalized.includes("logs") ||
    normalized.includes("trace") ||
    normalized.includes("parse") ||
    normalized.includes("query")
  ) {
    return zoneId === "database" ? "trace reading" : "runtime trace";
  }

  if (
    normalized.includes("debug") ||
    normalized.includes("fix") ||
    normalized.includes("error") ||
    normalized.includes("fail")
  ) {
    return "debug pass";
  }

  if (
    normalized.includes("spawn_child_async") ||
    normalized.includes("spawn child") ||
    normalized.includes("powershell") ||
    normalized.includes("windows\\system32") ||
    normalized.includes(".exe") ||
    normalized.includes("bash -lc") ||
    normalized.includes("cmd.exe")
  ) {
    return fallbackLabelForZone(zoneId, kind);
  }

  const cleaned = String(summary).replace(/\s+/g, " ").trim();
  return cleaned.length > 72 ? `${cleaned.slice(0, 69)}...` : cleaned;
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

function runtimeZoneHints(text) {
  const normalized = normalizeText(text);
  const scores = {
    frontend: { score: 0, hits: [] },
    backend: { score: 0, hits: [] },
    database: { score: 0, hits: [] },
    review: { score: 0, hits: [] }
  };

  const add = (zoneId, hit, score) => {
    scores[zoneId].score += score;
    if (!scores[zoneId].hits.includes(hit)) {
      scores[zoneId].hits.push(hit);
    }
  };

  if (
    normalized.includes("npm start") ||
    normalized.includes("node server.mjs") ||
    normalized.includes("node server.js") ||
    normalized.includes("server.mjs")
  ) {
    add("backend", "runtime command", 6);
  }

  if (
    normalized.includes("session_loop") ||
    normalized.includes("submission_dispatch") ||
    normalized.includes("stream_events_utils")
  ) {
    add("backend", "runtime loop", 4.8);
  }

  if (
    normalized.includes("npm test") ||
    normalized.includes("node --test") ||
    normalized.includes("verification")
  ) {
    add("backend", "verification command", 4.5);
  }

  if (
    normalized.includes("public/") ||
    normalized.includes("styles.css") ||
    normalized.includes("index.html") ||
    normalized.includes("canvas") ||
    normalized.includes("widget")
  ) {
    add("frontend", "ui file", 4.2);
  }

  if (
    normalized.includes("sqlite3") ||
    normalized.includes(".sqlite") ||
    normalized.includes("select ") ||
    normalized.includes("query")
  ) {
    add("database", "db command", 5.2);
  }

  if (
    normalized.includes("github") ||
    normalized.includes("gh issue") ||
    normalized.includes("review request") ||
    normalized.includes("prepare concise labels")
  ) {
    add("review", "ops handoff", 4.4);
  }

  return scores;
}

function inferZoneFromText(text) {
  const haystack = normalizeText(text);
  let bestZone = "lab";
  let bestScore = 0;

  for (const zone of ZONE_DEFINITIONS.filter((entry) => entry.id !== "lab")) {
    const { score } = sourceScore(haystack, zone.keywords, 1);
    if (score > bestScore) {
      bestZone = zone.id;
      bestScore = score;
    }
  }

  return bestScore >= 1 ? bestZone : "lab";
}

function summarizeAgentJobTask(agentJob) {
  const row = parseJsonObject(agentJob.row_json);
  const result = parseJsonObject(agentJob.result_json);

  return (
    result?.summary ||
    result?.title ||
    row?.task ||
    row?.title ||
    row?.instruction ||
    agentJob.instruction ||
    "Agent workstream"
  );
}

function normalizeAgentJobStatus(status) {
  const normalized = String(status || "").toLowerCase();

  if (["completed", "done", "succeeded", "success", "reported"].includes(normalized)) {
    return "completed";
  }

  if (["running", "in_progress", "processing", "active"].includes(normalized)) {
    return "active";
  }

  if (["queued", "pending", "created"].includes(normalized)) {
    return "queued";
  }

  if (["failed", "error", "cancelled", "canceled"].includes(normalized)) {
    return "failed";
  }

  return normalized || "queued";
}

function normalizeAgentJobs(agentJobs = []) {
  return agentJobs.map((agentJob) => {
    const task = summarizeAgentJobTask(agentJob);
    const row = parseJsonObject(agentJob.row_json);
    const zone = inferZoneFromText(
      normalizeText(row?.task, row?.title, row?.instruction, agentJob.instruction)
    );

    return {
      id: `agent_${agentJob.item_id}`,
      item_id: agentJob.item_id,
      job_id: agentJob.job_id,
      zone,
      owner: ZONE_TO_AGENT[zone] || "lead",
      task: humanizeSummary(task, { zoneId: zone }),
      status: normalizeAgentJobStatus(agentJob.status),
      assigned_thread_id: agentJob.assigned_thread_id || null,
      result_summary:
        humanizeSummary(
          parseJsonObject(agentJob.result_json)?.summary ||
            parseJsonObject(agentJob.result_json)?.title,
          { zoneId: zone, kind: "result" }
        ) ||
        null
    };
  });
}

function zoneFromId(zoneId) {
  return ZONE_BY_ID[zoneId] || ZONE_BY_ID.lab;
}

function normalizeRepoName(repoName, cwdDisplay = "") {
  const normalizedRepo = String(repoName || "").trim();
  const normalizedDisplay = String(cwdDisplay || "").trim().toLowerCase();

  if (!normalizedRepo && normalizedDisplay === "workspace root") {
    return "workspace";
  }

  if (normalizedRepo && normalizedRepo.toLowerCase() === "workspace") {
    return "workspace";
  }

  return normalizedRepo || "workspace";
}

function repoLabel(repoName) {
  return normalizeRepoName(repoName) === "workspace" ? "Workspace Hub" : normalizeRepoName(repoName);
}

function inferCompletionAgeSeconds({ thread, activity, normalizedAgentJobs, rawAgentJobs }) {
  const nowSeconds = inferNowSeconds(thread, activity);
  const completionTimes = rawAgentJobs
    .filter((job, index) => normalizedAgentJobs[index]?.status === "completed")
    .map((job) => parseTimestampSeconds(job.completed_at || job.updated_at || job.created_at))
    .filter(Number.isFinite);

  if (completionTimes.length > 0 && Number.isFinite(nowSeconds)) {
    const freshestCompletion = Math.max(...completionTimes);
    return Math.max(0, nowSeconds - freshestCompletion);
  }

  return Number.isFinite(activity?.lastLogAgeSeconds)
    ? Number(activity.lastLogAgeSeconds)
    : Number.POSITIVE_INFINITY;
}

function baseSignals({ thread, repoContext, activity, logs, status, agentJobs = [] }) {
  const threadText = normalizeText(thread?.title);
  const activityText = normalizeText(activity?.summary);
  const logText = normalizeText(logs.slice(0, 24).map((log) => log.message));
  const toolCalls = logs
    .slice(0, 18)
    .filter((log) => (log.message || "").includes("ToolCall:")).length;
  const runtimeActive = activity?.source === "tool" || logs.length > 0;
  const repoContextSemanticTitle =
    runtimeActive && thread?.cwdDisplay === "workspace root" ? "" : repoContext?.title;
  const secondaryText = normalizeText(
    thread?.cwd,
    thread?.gitBranch,
    repoContextSemanticTitle,
    repoContext?.cwd
  );
  const runtimeHints = runtimeZoneHints([activityText, logText]);
  const threadWeight = runtimeActive ? 1.75 : 4;
  const activityWeight = runtimeActive ? 5 : 4;
  const logWeight = runtimeActive ? 3.4 : 2.5;

  const zoneScores = {};
  const zoneHits = {};

  for (const zone of ZONE_DEFINITIONS.filter((entry) => entry.id !== "lab")) {
    const threadSource = sourceScore(threadText, zone.keywords, threadWeight);
    const activitySource = sourceScore(activityText, zone.keywords, activityWeight);
    const secondary = sourceScore(secondaryText, zone.keywords, 2);
    const log = sourceScore(logText, zone.keywords, logWeight);
    const runtimeHint = runtimeHints[zone.id] || { score: 0, hits: [] };
    zoneScores[zone.id] =
      threadSource.score +
      activitySource.score +
      secondary.score +
      log.score +
      runtimeHint.score;
    zoneHits[zone.id] = unique([
      ...threadSource.hits,
      ...activitySource.hits,
      ...secondary.hits,
      ...log.hits,
      ...runtimeHint.hits
    ]);
  }

  const sortedZones = Object.entries(zoneScores)
    .sort((left, right) => right[1] - left[1])
    .map(([zoneId, score]) => ({ zoneId, score, hits: zoneHits[zoneId] }));
  const top = sortedZones[0] || { zoneId: "lab", score: 0, hits: [] };
  const second = sortedZones[1] || { zoneId: "lab", score: 0, hits: [] };

  const planning = countMatches(normalizeText(threadText, activityText, logText), PLANNING_TERMS, 1.1);
  const review = countMatches(normalizeText(threadText, activityText, logText), REVIEW_TERMS, 1.1);
  const reviewEvidence = countMatches(
    normalizeText(threadText, activityText, logText),
    REVIEW_EVIDENCE_TERMS,
    1.25
  );
  const delegation = countMatches(
    normalizeText(threadText, activityText, logText),
    DELEGATION_TERMS,
    1.25
  );
  const results = countMatches(logText, RESULT_TERMS, 1.2);
  const debug = countMatches(normalizeText(activityText, logText, threadText), DEBUG_TERMS, 1.1);
  const reading = countMatches(normalizeText(activityText, logText, threadText), READING_TERMS, 1);
  const summarizing = countMatches(
    normalizeText(activityText, logText, threadText),
    SUMMARY_TERMS,
    1
  );
  const newRequest = (thread?.updatedAgeSeconds ?? Number.POSITIVE_INFINITY) <= 45;
  const passiveMode = activity?.kind === "rest" || activity?.kind === "observer";
  const toolBurst = clamp(toolCalls / 3, 0, 4);
  const normalizedAgentJobs = normalizeAgentJobs(agentJobs);
  const activeAgentJobs = normalizedAgentJobs.filter((job) => job.status === "active");
  const completedAgentJobs = normalizedAgentJobs.filter((job) => job.status === "completed");
  if (completedAgentJobs.length > 0) {
    reviewEvidence.hits.push("completed_agent_job");
    reviewEvidence.score += 2.6;
    results.hits.push("completed_agent_job");
    results.score += 2.4;
  }
  const completionAgeSeconds = inferCompletionAgeSeconds({
    thread,
    activity,
    normalizedAgentJobs,
    rawAgentJobs: agentJobs
  });
  const secondaryLaneEligible =
    second.score >= Math.max(2.5, top.score * 0.45) &&
    (delegation.score >= 1.25 || toolBurst >= 1.5 || activeAgentJobs.length > 0);
  const multiCandidate =
    delegation.score +
    (secondaryLaneEligible ? 1.6 : 0) +
    (toolBurst >= 1.5 ? 0.4 : 0);
  const multiFromAgentJobs = activeAgentJobs.length > 0 || normalizedAgentJobs.length >= 2;
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
    mode:
      passiveMode && status !== "busy"
        ? "solo"
        : multiFromAgentJobs || multiCandidate >= 1.9
          ? "multi"
          : "solo",
    zone_scores: zoneScores,
    zone_hits: zoneHits,
    sorted_zones: sortedZones,
    signals: {
      new_request: newRequest,
      planning,
      review,
      review_evidence: {
        hits: unique(reviewEvidence.hits),
        score: reviewEvidence.score
      },
      delegation,
      results,
      debug,
      reading,
      summarizing,
      passive_mode: passiveMode,
      runtime_active: runtimeActive,
      tool_burst: toolBurst,
      tool_calls: toolCalls,
      status,
      agent_jobs: {
        items: normalizedAgentJobs,
        total_count: normalizedAgentJobs.length,
        active_count: activeAgentJobs.length,
        completed_count: completedAgentJobs.length
      },
      completion_age_seconds: completionAgeSeconds
    }
  };
}

function resolveCurrentRepo(thread, repoContext) {
  const threadRepo = normalizeRepoName(thread?.repoName, thread?.cwdDisplay);
  const contextRepo = normalizeRepoName(repoContext?.repoName, repoContext?.cwdDisplay);

  if (thread?.cwdDisplay === "workspace root" && contextRepo !== "workspace") {
    return contextRepo;
  }

  return threadRepo || contextRepo || "workspace";
}

function inferReviewStage(signals, status) {
  const completionAgeSeconds = signals.completion_age_seconds ?? Number.POSITIVE_INFINITY;

  if (completionAgeSeconds <= REVIEW_STAGE_RESULT_RETURNING_MAX) {
    return "results_returning";
  }

  if (completionAgeSeconds <= REVIEW_STAGE_REGROUP_MAX) {
    return "regroup";
  }

  if (status === "cooldown" && completionAgeSeconds >= REVIEW_STAGE_COOLDOWN_MIN) {
    return "cooldown";
  }

  return "wrap";
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
  const explicitAgentJobs = signals.agent_jobs?.total_count > 0;
  const activeDeskEvidence =
    (signals.runtime_active ? 0.8 : 0) +
    (signals.tool_burst >= 0.66 ? 0.7 : 0) +
    (signals.tool_calls > 0 ? 0.55 : 0) +
    (signals.debug.score > 0 ? 0.8 : 0) +
    (signals.reading.score > 0 ? 0.45 : 0) +
    (signals.summarizing.score > 0 && dominantZone === "review" ? 0.45 : 0) +
    (dominantZone !== "lab" ? 0.35 : 0);
  const executionLocked =
    dominantZone !== "lab" &&
    activeDeskEvidence >= 1.65;
  let reviewStage = null;

  let roomPhase = "execution";
  let reason = `${zoneFromId(dominantZone).title} jadi owner utama karena sinyalnya paling kuat.`;

  if (standbyDueToInactivity && !explicitAgentJobs) {
    roomPhase = "standby";
    reason = "Belum ada activity baru, jadi room kembali tenang di area tengah.";
  } else if (
    signals.agent_jobs?.completed_count > 0 &&
    signals.agent_jobs?.active_count === 0
  ) {
    roomPhase = "review_wrap";
    reviewStage = inferReviewStage(signals, status);
    reason =
      reviewStage === "results_returning"
        ? "Lane selesai di desk masing-masing, lalu hasil balik ke review lane tanpa langsung collapse."
        : reviewStage === "regroup"
          ? "Hasil sudah masuk, jadi squad regroup sebentar sebelum wrap final."
          : reviewStage === "cooldown"
            ? "Wrap sudah selesai, jadi room masuk cooldown dengan ritme yang lebih tenang."
            : "Room stay di review wrap sampai hasil rapi dan siap ditutup.";
  } else if (signals.agent_jobs?.active_count > 0) {
    roomPhase = "squad_split";
    reason = "Ada worker thread aktif yang benar-benar assigned, jadi squad split pakai runtime orchestration.";
  } else if (signals.review.score >= 2.4 && signals.review_evidence.score >= 1.25) {
    roomPhase = "review_wrap";
    reviewStage = inferReviewStage(signals, status);
    reason =
      reviewStage === "results_returning"
        ? "Ada pola result return baru, jadi room tahan dulu di review wrap yang stabil."
        : reviewStage === "regroup"
          ? "Result return sudah jelas, jadi squad regroup sebentar sebelum wrap final."
          : reviewStage === "cooldown"
            ? "Review wrap sudah lewat, jadi room bisa masuk cooldown dengan tenang."
            : "Ada pola review / result return, jadi hasil dipindah ke review lane.";
  } else if (signals.delegation.score >= 1.25 && mode === "multi") {
    roomPhase = "squad_split";
    reason = "Delegation kebaca cukup jelas, jadi squad dipecah ke workstream yang relevan.";
  } else if (
    !executionLocked &&
    (
      (signals.planning.score >= 1.4 &&
        (signals.new_request || confidence < 0.82 || dominantZone === "lab")) ||
      (signals.new_request && (confidence < 0.72 || dominantZone === "lab"))
    )
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
    review_stage: roomPhase === "review_wrap" ? reviewStage || "wrap" : null,
    cooling_down:
      roomPhase === "review_wrap"
        ? (reviewStage || "wrap") === "cooldown"
        : roomPhase === "standby" && status === "cooldown",
    mode,
    assignment: {
      focus_zone: dominantZone,
      active_owner: ZONE_TO_AGENT[dominantZone] || "lead"
    },
    review_trigger:
      roomPhase === "review_wrap" ||
      (signals.review.score >= 2.4 && signals.review_evidence.score >= 1.25),
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

export function summarizePrimaryTask(summary) {
  return humanizeSummary(summary, { zoneId: "lab" }) || "Standby di room aktif";
}

function summarizeObjectiveLabel(summary, { zoneId = "lab", phase = "standby" } = {}) {
  const normalized = normalizeText(summary);

  if (!normalized) {
    return phase === "planning_huddle" ? "kunci arah kerja room" : fallbackLabelForZone(zoneId, "objective");
  }

  if (
    normalized.includes("agent pixel") ||
    normalized.includes("pixel room") ||
    normalized.includes("ops room")
  ) {
    return "bangun pixel ops room";
  }

  if (
    normalized.includes("ipad") ||
    normalized.includes("lan") ||
    normalized.includes("network") ||
    normalized.includes("getifaddr") ||
    normalized.includes("ipconfig")
  ) {
    return "cek akses room dari device lain";
  }

  if (
    normalized.includes("issue") &&
    (normalized.includes("split") ||
      normalized.includes("pecah") ||
      normalized.includes("wakeru") ||
      normalized.includes("task"))
  ) {
    return "pecah issue jadi task kecil";
  }

  const humanized = humanizeSummary(summary, { zoneId, kind: "objective" });

  switch (humanized) {
    case "pixel ops room":
      return "bangun pixel ops room";
    case "network check":
      return "cek akses room dari device lain";
    case "review wrap":
      return "rapihin hasil dan siapin wrap";
    case "verification pass":
      return "cek hasil dan verifikasi room";
    case "layout check":
      return "rapihin layout dan tampilan room";
    case "runtime mapping":
      return "rapihin runtime dan state room";
    case "trace reading":
      return "baca trace dan cari sinyal room";
    case "debug pass":
      return "beresin issue yang lagi aktif";
    case "result return":
      return "kumpulkan hasil lane untuk review";
    case "coordination pass":
      return "kunci arah kerja room";
    default:
      return humanized;
  }
}

function summarizeThreadDisplayTitle(summary, { zoneId = "lab", phase = "standby" } = {}) {
  const cleaned = String(summary || "").replace(/\s+/g, " ").trim();

  if (!cleaned) {
    return "No recent thread";
  }

  if (looksLikePromptTitle(cleaned)) {
    return summarizeObjectiveLabel(cleaned, { zoneId, phase });
  }

  return cleaned.length > 88 ? `${cleaned.slice(0, 85)}...` : cleaned;
}

function summarizeObjectiveDetail(threadTitle, taskSummary, { zoneId = "lab", phase = "standby" } = {}) {
  const cleanedThreadTitle = String(threadTitle || "").replace(/\s+/g, " ").trim();
  const taskLabel = summarizePrimaryTask(taskSummary);

  if (cleanedThreadTitle && !looksLikePromptTitle(cleanedThreadTitle)) {
    return cleanedThreadTitle;
  }

  if (phase === "standby" && looksLikePromptTitle(cleanedThreadTitle)) {
    return "Istirahat sejenak";
  }

  if (taskLabel && taskLabel !== "Standby di room aktif") {
    return taskLabel;
  }

  if (cleanedThreadTitle) {
    return summarizeThreadDisplayTitle(cleanedThreadTitle, { zoneId, phase });
  }

  return "Belum ada detail objective.";
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

function extractToolNameFromMessage(message) {
  const match = String(message || "").match(/^ToolCall:\s+([A-Za-z0-9_.-]+)/);
  return match ? match[1] : "";
}

function summarizeToolName(toolName) {
  const normalized = normalizeText(toolName);

  if (!normalized) {
    return null;
  }

  if (normalized.includes("exec_command") || normalized.includes("shell_command")) {
    return "terminal task";
  }

  if (normalized.includes("spawn_agent")) {
    return "spawn workstream";
  }

  if (normalized.includes("wait_agent")) {
    return "wait result";
  }

  if (normalized.includes("send_input")) {
    return "handoff context";
  }

  if (normalized.includes("playwright") || normalized.includes("browser")) {
    return "browser check";
  }

  return null;
}

function cleanRuntimeSummary(summary) {
  return String(summary || "")
    .replace(/^menjalankan:\s*/i, "")
    .replace(/^tool:\s*/i, "")
    .trim();
}

function summarizeRuntimeLabel(summary, zoneId) {
  return humanizeSummary(cleanRuntimeSummary(summary), {
    zoneId,
    kind: "task"
  });
}

function summarizeRuntimeLog(log, zoneId) {
  const message = String(log?.message || "").trim();
  if (!message) {
    return null;
  }

  if (RUNTIME_NOISE_SNIPPETS.some((snippet) => normalizeText(message).includes(snippet))) {
    return null;
  }

  const command = extractCommandLike(log?.message || "");
  if (command) {
    return humanizeSummary(command, { zoneId, kind: "task" });
  }

  const toolSummary = summarizeToolName(extractToolNameFromMessage(log?.message || ""));
  if (toolSummary) {
    return toolSummary;
  }

  return humanizeSummary(message, { zoneId, kind: "task" });
}

function buildWorkstreams(taskIntelligence, orchestration) {
  const streams = [];
  const dominantZone = taskIntelligence.dominant_zone;
  const focusOwner = ZONE_TO_AGENT[dominantZone] || "lead";
  const agentJobs = taskIntelligence.signals.agent_jobs?.items || [];
  const activeAgentJobs = agentJobs.filter((job) => job.status === "active");
  const docsJobActive = agentJobs.some((job) => job.owner === "docs");
  const secondaries = taskIntelligence.sorted_zones
    .filter((entry) => entry.zoneId !== dominantZone && entry.score >= 2.8)
    .slice(0, 2);

  if (orchestration.room_phase === "standby") {
    return [
      {
        id: "ws_standby",
        owner: "lead",
        zone: "lab",
        task: "wait for the next request",
        status: "queued"
      }
    ];
  }

  if (orchestration.room_phase === "planning_huddle") {
    streams.push({
      id: "ws_plan",
      owner: "lead",
      zone: "lab",
      task: "lock scope and route the first lane",
      status: "active"
    });
  } else {
    streams.push({
      id: "ws_main",
      owner: focusOwner,
      zone: dominantZone,
      task: humanizeSummary(taskIntelligence.current_task_summary, {
        zoneId: dominantZone
      }),
      status: orchestration.room_phase === "review_wrap" ? "completed" : "active"
    });
  }

  if (agentJobs.length > 0) {
    streams.push({
      id: "ws_lead_coordination",
      owner: "lead",
      zone: "lab",
      task:
        activeAgentJobs.length > 0
          ? "coordinate active lanes"
          : orchestration.room_phase === "review_wrap"
            ? "regroup returned lanes"
            : "review returned lanes",
      status: activeAgentJobs.length > 0 || orchestration.room_phase === "review_wrap" ? "active" : "queued"
    });

    agentJobs.forEach((job) => {
      streams.push({
        id: job.id,
        owner: job.owner,
        zone: job.zone,
        task: job.task,
        status:
          orchestration.room_phase === "review_wrap" && job.status === "completed"
            ? "completed"
            : job.status === "failed"
              ? "queued"
              : job.status
      });
    });
  }

  if (orchestration.mode === "multi") {
    secondaries.forEach((entry, index) => {
      const zone = zoneFromId(entry.zoneId);
      streams.push({
        id: `ws_${entry.zoneId}_${index + 1}`,
        owner: zone.ownerId,
        zone: zone.id,
        task: humanizeSummary(zone.defaultTask, { zoneId: zone.id }),
        status: orchestration.room_phase === "squad_split" ? "active" : "queued"
      });
    });
  }

  if (
    orchestration.review_trigger ||
    orchestration.room_phase === "review_wrap" ||
    docsJobActive
  ) {
    streams.push({
      id: "ws_review",
      owner: "docs",
      zone: "review",
      task:
        orchestration.room_phase === "review_wrap"
          ? "review wrap"
          : "prepare wrap notes",
      status:
        orchestration.room_phase === "review_wrap"
          ? orchestration.review_stage === "cooldown"
            ? "completed"
            : "active"
          : "queued"
    });
  }

  return [...new Map(streams.map((stream) => [stream.id, stream])).values()];
}

function buildRecentEvents(taskIntelligence, orchestration, workstreams, thread) {
  const events = [];
  const agentJobs = taskIntelligence.signals.agent_jobs?.items || [];
  const activeAgentJobs = agentJobs.filter((job) => job.status === "active");
  const completedAgentJobs = agentJobs.filter((job) => job.status === "completed");

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
    (activeAgentJobs.length > 0 ? activeAgentJobs : spawned).forEach((workstream) => {
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

  if (completedAgentJobs.length > 0) {
    completedAgentJobs.forEach((job) => {
      events.push({
        type: "result_returned",
        from: job.zone,
        to: orchestration.room_phase === "review_wrap" ? "review" : "lab",
        workstream_id: job.id
      });
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

function buildSceneProps(room) {
  return [
    {
      id: "planning_board",
      kind: "briefing",
      zone: "lab",
      label: "Shared planning board",
      emphasis: room.phase === "planning_huddle" || room.phase === "review_wrap" ? "active" : "idle"
    },
    {
      id: "status_monitor",
      kind: "monitor",
      zone: room.focus_zone,
      label: "Wall status monitor",
      emphasis: room.phase === "execution" ? "active" : "idle"
    },
    {
      id: "tool_rack",
      kind: "storage",
      zone: "backend",
      label: "Tool rack",
      emphasis: room.focus_zone === "backend" ? "active" : "idle"
    },
    {
      id: "document_tray",
      kind: "storage",
      zone: "review",
      label: "Document tray",
      emphasis: room.phase === "review_wrap" ? "active" : "idle"
    },
    {
      id: "rest_corner",
      kind: "rest",
      zone: "lab",
      label: "Recharge nook",
      emphasis: room.rest_corner?.active ? "active" : "idle"
    }
  ];
}

function buildAmbientCues(room) {
  const cooldownActive = room.substate === "cooldown";
  return [
    {
      id: "board_glow",
      zone: "lab",
      intensity:
        cooldownActive
          ? "low"
          : room.phase === "planning_huddle"
            ? "high"
            : room.phase === "review_wrap"
              ? "medium"
              : "low"
    },
    {
      id: "monitor_flicker",
      zone: room.focus_zone,
      intensity: cooldownActive ? "low" : room.phase === "execution" ? "medium" : "low"
    },
    {
      id: "status_pulse",
      zone: room.focus_zone,
      intensity: cooldownActive ? "off" : room.status === "busy" ? "medium" : "low"
    },
    {
      id: "rest_corner_steam",
      zone: "lab",
      intensity: room.rest_corner?.active ? "medium" : "off"
    }
  ];
}

function deriveSceneActiveZoneId(room, cooldownActive) {
  if (cooldownActive || room.resting || room.phase === "standby" || room.phase === "planning_huddle") {
    return "lab";
  }

  if (room.phase === "review_wrap") {
    return room.review_stage === "regroup" ? "lab" : "review";
  }

  return room.focus_zone;
}

function sceneActiveZoneReason(room, activeZoneId) {
  if (room.resting) {
    return "Room sengaja stay di lab dulu biar squad bisa recharge sebelum activity berikutnya.";
  }

  if (room.substate === "cooldown") {
    return "Room lagi settle di lab sambil nunggu sinyal kerja berikutnya cukup jelas.";
  }

  if (room.phase === "planning_huddle") {
    return "Semua agent kumpul di lab buat cek scope dan kunci assignment sebelum squad split.";
  }

  if (room.phase === "standby") {
    return "Belum ada desk aktif yang perlu dibuka, jadi room tetap tenang di area tengah.";
  }

  if (room.phase === "review_wrap") {
    return room.review_stage === "regroup"
      ? "Squad regroup sebentar di lab sebelum hasil ditutup rapi."
      : "Review lane jadi pusat scene sambil hasil dirapikan dan diringkas.";
  }

  return room.focus_reason;
}

function buildSceneDirector(room, workstreams, recentEvents) {
  const cooldownActive = room.substate === "cooldown";
  const planningActive = room.phase === "planning_huddle";
  const scoutEvent = findScoutEvent(recentEvents);
  const activeWorkstreams = workstreams.filter((workstream) => workstream.status === "active");
  const completedWorkstreams = workstreams.filter((workstream) => workstream.status === "completed");
  const workerActiveStreams = activeWorkstreams.filter((workstream) => workstream.owner !== "lead");
  const workerActiveLaneCount = unique(workerActiveStreams.map((workstream) => workstream.zone)).length;
  const highlightZones = unique(
    [...activeWorkstreams, ...completedWorkstreams].map((workstream) => workstream.zone)
  );
  const activeZoneId = deriveSceneActiveZoneId(room, cooldownActive);
  const activeZoneMeta = zoneFromId(activeZoneId);
  const focusZoneMeta = zoneFromId(room.focus_zone);
  const hasNextAssignment = planningActive && room.focus_zone !== activeZoneId;
  const allowScoutMovement =
    !cooldownActive &&
    (room.phase !== "review_wrap" || room.review_stage === "results_returning");

  let scout = {
    active: false,
    from_zone: "lab",
    to_zone: "lab",
    payload: null,
    reason: null
  };

  if (scoutEvent && allowScoutMovement) {
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
        payload: "results in",
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

  const intenseExecution =
    room.phase === "execution" &&
    (workerActiveLaneCount >= 2 || scout.active || (room.mode === "multi" && workerActiveStreams.length >= 2));
  const steadyExecution =
    room.phase === "execution" &&
    !intenseExecution &&
    workerActiveLaneCount <= 1;
  const executionBubbleTone = intenseExecution ? "busy" : "steady";

  const phaseMeta = ROOM_PHASES[room.phase] || ROOM_PHASES.standby;
  const activeZone = {
    id: activeZoneId,
    label: "Active Desk",
    chip_title: activeZoneMeta.title,
    title: activeZoneMeta.title,
    reason: sceneActiveZoneReason(room, activeZoneId)
  };
  const assignmentHint = hasNextAssignment
    ? {
        active: true,
        label: "Next Assignment",
        zone_id: room.focus_zone,
        chip_title: `Next: ${focusZoneMeta.title}`,
        title: focusZoneMeta.title,
        reason: `Arah kerja mulai kebaca ke ${focusZoneMeta.title}, tapi squad masih briefing di lab sebelum split.`,
        confidence: room.focus_confidence
      }
    : {
        active: false,
        label: "Next Assignment",
        zone_id: null,
        chip_title: null,
        title: null,
        reason: null,
        confidence: null
      };
  const primaryBubble =
    cooldownActive && !room.resting
      ? { actor_id: "lead", text: "settling down", tone: "calm" }
      : room.resting
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
          ? room.review_stage === "results_returning"
            ? {
                actor_id: scout.active ? "scout" : "lead",
                text: scout.payload || "results in",
                tone: "steady"
              }
            : room.review_stage === "regroup"
              ? { actor_id: "lead", text: "regrouping", tone: "steady" }
              : room.review_stage === "cooldown"
                ? { actor_id: "lead", text: "settling down", tone: "calm" }
                : { actor_id: "docs", text: "review + wrap", tone: "calm" }
        : room.phase === "execution"
            ? {
                actor_id: ZONE_TO_AGENT[room.focus_zone] || "lead",
                text: executionBubbleLabel(room),
                tone: executionBubbleTone
              }
            : { actor_id: "lead", text: "standby", tone: "calm" };

  return {
    title: ROOM_TITLE,
    headline: DEFAULT_HEADLINE,
    description: DEFAULT_DESCRIPTION,
    center_mode:
      cooldownActive
        ? "observed"
        : room.phase === "planning_huddle" ||
            (room.phase === "review_wrap" && room.review_stage !== "results_returning")
        ? "coordination"
        : room.phase === "standby"
          ? "observed"
          : "active_ops",
    resting: room.resting,
    tone:
      cooldownActive
        ? "rest"
        : room.resting
        ? "rest"
        : planningActive
        ? "steady"
        : room.phase === "standby"
        ? "calm"
        : room.phase === "review_wrap"
          ? room.review_stage === "regroup"
            ? "steady"
            : "calm"
          : intenseExecution
            ? "busy"
          : steadyExecution
            ? "steady"
          : room.status === "busy"
            ? "busy"
            : "steady",
    camera:
      cooldownActive || room.resting
        ? "rest-lab"
        : planningActive
          ? "lab"
        : room.mode === "multi"
          ? "wide"
          : activeZoneId === "lab"
            ? "lab"
            : `focus-${activeZoneId}`,
    visual_intensity:
      cooldownActive
        ? "low"
        : room.resting
          ? "low"
          : planningActive
            ? "medium"
          : room.phase === "review_wrap"
            ? room.review_stage === "results_returning"
              ? "medium"
              : room.review_stage === "regroup"
                ? "medium"
                : "low"
            : intenseExecution
              ? "high"
            : steadyExecution
              ? "medium"
            : room.status === "busy"
              ? "high"
              : "medium",
    desk_highlights:
      cooldownActive || room.resting
        ? ["lab"]
        : planningActive
          ? ["lab"]
        : room.phase === "review_wrap" && room.review_stage !== "results_returning"
          ? unique(["lab", "review"]).filter(Boolean)
          : unique([room.focus_zone, ...highlightZones]).filter(Boolean),
    primary_bubble: primaryBubble,
    rest_corner: room.rest_corner || {
      active: false,
      allowed_agent_ids: [],
      reason: null
    },
    props: buildSceneProps(room),
    ambient_cues: buildAmbientCues(room),
    scout,
    review_stage: room.review_stage,
    skill_badges: room.skills || [],
    active_zone: activeZone,
    assignment_hint: assignmentHint,
    phase_title: phaseMeta.title,
    phase_reason: room.phase_reason,
    focus_label: activeZone.label,
    focus_chip_title: activeZone.chip_title,
    focus_title: activeZone.title,
    focus_reason: activeZone.reason
  };
}

function inferWorkerActivity(agentId, roomPhase, stream, taskIntelligence, reviewStage = null) {
  if (!stream) {
    return roomPhase === "planning_huddle" ? "gathering" : "waiting";
  }

  if (roomPhase === "squad_split" && stream.status === "queued") {
    return "moving";
  }

  if (roomPhase === "review_wrap") {
    if (reviewStage === "cooldown") {
      return "idle";
    }

    if (agentId === "docs") {
      return "reviewing";
    }

    if (reviewStage === "regroup") {
      return stream.status === "completed" ? "gathering" : "waiting";
    }

    return stream.status === "completed" ? "summarizing" : "waiting";
  }

  if (stream.status === "queued") {
    return "waiting";
  }

  if (agentId === "docs") {
    if (taskIntelligence.signals.summarizing.score > 0) {
      return "summarizing";
    }

    if (taskIntelligence.signals.reading.score > 0) {
      return "reading";
    }

    return "waiting";
  }

  if (taskIntelligence.signals.debug.score > 0) {
    return "debugging";
  }

  if (agentId === "db" && taskIntelligence.signals.reading.score > 0) {
    return "reading";
  }

  return "coding";
}

function idleBehaviorForAgent(agent, orchestration, taskIntelligence, scene) {
  if (scene.rest_corner?.active && scene.rest_corner.allowed_agent_ids.includes(agent.id)) {
    return "idle_rest";
  }

  if (agent.id === "scout") {
    return orchestration.room_phase === "standby" ? "idle_patrol" : "idle_observe";
  }

  if (agent.id === "lead") {
    return orchestration.room_phase === "review_wrap" ? "idle_chat" : "idle_observe";
  }

  if (agent.id === "db" || agent.id === "api") {
    return "idle_observe";
  }

  if (agent.id === "docs" && orchestration.room_phase === "review_wrap") {
    return "idle_chat";
  }

  return "idle_at_desk";
}

function buildAgentStates(workstreams, orchestration, taskIntelligence, scene) {
  const workstreamsByOwner = workstreams.reduce((accumulator, workstream) => {
    accumulator[workstream.owner] ||= [];
    accumulator[workstream.owner].push(workstream);
    return accumulator;
  }, {});

  return VISUAL_CAST.map((agent) => {
    if (agent.id === "scout") {
      const idleBehavior = idleBehaviorForAgent(agent, orchestration, taskIntelligence, scene);
      return {
        id: agent.id,
        display_name: agent.displayName,
        home_zone: agent.homeZone,
        assigned_zone: scene.scout.active ? "between_zones" : agent.homeZone,
        visual_role: agent.visualRole,
        activity:
          scene.scout.active
            ? "moving"
            : (orchestration.room_phase === "standby" && taskIntelligence.signals.passive_mode) ||
                orchestration.cooling_down
              ? "idle"
              : "waiting",
        idle_behavior: scene.scout.active ? null : idleBehavior,
        carrying: scene.scout.payload,
        assigned_workstream_ids: []
      };
    }

    const ownedStreams = workstreamsByOwner[agent.id] || [];
    const primaryStream = ownedStreams.find((stream) => stream.status === "active") || ownedStreams[0];
    const idleBehavior = idleBehaviorForAgent(agent, orchestration, taskIntelligence, scene);
    const assignedZone =
      orchestration.room_phase === "planning_huddle"
        ? "lab"
        : orchestration.room_phase === "review_wrap" &&
            orchestration.review_stage !== "results_returning" &&
            agent.id !== "docs"
          ? "lab"
        : scene.rest_corner?.active && scene.rest_corner.allowed_agent_ids.includes(agent.id)
          ? "lab"
          : primaryStream?.zone || agent.defaultAssignedZone;

    let activity = inferWorkerActivity(
      agent.id,
      orchestration.room_phase,
      primaryStream,
      taskIntelligence,
      orchestration.review_stage
    );

    if (agent.id === "lead") {
      activity =
        orchestration.room_phase === "standby"
          ? "idle"
          : orchestration.room_phase === "planning_huddle"
            ? "gathering"
            : orchestration.room_phase === "squad_split"
              ? "moving"
              : orchestration.room_phase === "review_wrap"
                ? orchestration.review_stage === "regroup"
                  ? "gathering"
                  : orchestration.review_stage === "cooldown"
                    ? "idle"
                    : "summarizing"
                : "reading";
    }

    if (agent.id === "docs" && orchestration.room_phase === "review_wrap") {
      activity = orchestration.review_stage === "cooldown" ? "idle" : "reviewing";
    }

    if (orchestration.room_phase === "standby" && taskIntelligence.signals.passive_mode) {
      activity = "idle";
    }

    if (orchestration.room_phase === "standby" && !taskIntelligence.signals.passive_mode) {
      activity = "idle";
    }

    if (orchestration.cooling_down) {
      activity = "idle";
    }

    return {
      id: agent.id,
      display_name: agent.displayName,
      home_zone: agent.homeZone,
      assigned_zone: assignedZone,
      visual_role: agent.visualRole,
      activity,
      idle_behavior: activity === "idle" || activity === "waiting" ? idleBehavior : null,
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

function executionBubbleLabel(room) {
  const task = normalizeText(room.current_task);

  if (task.includes("spawn_child_async") || task.includes("spawn child")) {
    return "runtime sync";
  }

  if (task.includes("debug") || task.includes("error") || task.includes("fail")) {
    return "debug pass";
  }

  if (task.includes("review") || task.includes("wrap")) {
    return "wrap notes";
  }

  if (task.includes("sqlite") || task.includes("trace") || task.includes("logs")) {
    return room.focus_zone === "database" ? "trace reading" : "trace sync";
  }

  if (room.focus_zone === "frontend") {
    return "layout pass";
  }

  if (room.focus_zone === "backend") {
    return "runtime sync";
  }

  if (room.focus_zone === "database") {
    return "trace reading";
  }

  if (room.focus_zone === "review") {
    return "review pass";
  }

  return "lock route";
}

function buildRestCorner(room, activity) {
  const lowIntensityStandby = room.phase === "standby" && (room.resting || room.status === "cooldown");
  const settledReviewWrap =
    room.phase === "review_wrap" &&
    room.status !== "busy" &&
    (activity?.lastLogAgeSeconds ?? Number.POSITIVE_INFINITY) >= 90;

  if (lowIntensityStandby) {
    return {
      active: true,
      allowed_agent_ids: ["lead", "ui", "docs"],
      reason: "Low-intensity standby lets a few agents recharge in-room."
    };
  }

  if (settledReviewWrap) {
    return {
      active: true,
      allowed_agent_ids: ["lead", "docs"],
      reason: "Review wrap settled, so the room relaxes into a quieter corner."
    };
  }

  return {
    active: false,
    allowed_agent_ids: [],
    reason: null
  };
}

function presenceFromAgeSeconds(secondsAgo = Number.POSITIVE_INFINITY) {
  if (secondsAgo <= 90) {
    return "busy";
  }

  if (secondsAgo <= 15 * 60) {
    return "cooldown";
  }

  return "idle";
}

function countActiveLanes(room, workstreams = [], agentJobs = []) {
  const activeAgentJobs = agentJobs.filter((job) => job.status === "active");
  if (activeAgentJobs.length > 0) {
    return activeAgentJobs.length;
  }

  const activeWorkstreams = workstreams.filter(
    (stream) => stream.status === "active" && stream.owner !== "lead"
  );
  if (activeWorkstreams.length > 0) {
    return activeWorkstreams.length;
  }

  return 1;
}

function buildObjectiveState(taskIntelligence, room, thread) {
  const detail = summarizeObjectiveDetail(thread?.title, taskIntelligence.current_task_summary, {
    zoneId: room.focus_zone,
    phase: room.phase
  });

  return {
    title: summarizeObjectiveLabel(taskIntelligence.request || taskIntelligence.current_task_summary, {
      zoneId: room.focus_zone,
      phase: room.phase
    }),
    detail,
    repo: room.current_repo,
    focus_title: zoneFromId(room.focus_zone).title,
    phase_title: ROOM_PHASES[room.phase]?.title || ROOM_PHASES.standby.title,
    mode: room.mode,
    updated_ago: thread?.updatedAgo || "-"
  };
}

function formatRelativeAge(secondsAgo) {
  if (!Number.isFinite(secondsAgo) || secondsAgo < 0) {
    return "-";
  }

  if (secondsAgo < 5) {
    return "baru saja";
  }

  if (secondsAgo < 60) {
    return `${Math.floor(secondsAgo)} dtk lalu`;
  }

  const minutes = Math.floor(secondsAgo / 60);
  if (minutes < 60) {
    return `${minutes} mnt lalu`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours} jam lalu`;
  }

  return `${Math.floor(hours / 24)} hari lalu`;
}

function buildRuntimeState(taskIntelligence, room, activity, logs = [], nowSeconds = null) {
  const zoneId = room.focus_zone;
  const ageSeconds = activity?.lastLogAgeSeconds ?? Number.POSITIVE_INFINITY;
  const activeAgentJobs = taskIntelligence.signals.agent_jobs?.active_count || 0;
  const activityKind =
    activity?.kind || (activity?.source === "tool" ? "work" : activity?.source === "presence" ? "rest" : "thread");
  const currentTitle = summarizeRuntimeLabel(activity?.summary, zoneId);
  const history = [];
  const seen = new Set();

  for (const log of logs) {
    const title = summarizeRuntimeLog(log, zoneId);
    if (!title || seen.has(title) || title === currentTitle) {
      continue;
    }

    seen.add(title);
    const logAgeSeconds = Number.isFinite(nowSeconds) && Number.isFinite(Number(log?.ts))
      ? Math.max(0, nowSeconds - Number(log.ts))
      : null;
    history.push({
      title,
      detail: null,
      source_label: "runtime history",
      age_label: formatRelativeAge(logAgeSeconds ?? Number.POSITIVE_INFINITY),
      status: "history"
    });

    if (history.length >= 3) {
      break;
    }
  }

  const hasLiveWork =
    !room.resting &&
    (activeAgentJobs > 0 ||
      (activityKind === "work" &&
        room.status === "busy" &&
        ageSeconds <= LIVE_RUNTIME_MAX_SECONDS));

  let liveNow = null;
  let lastFinished = null;

  if (hasLiveWork && currentTitle) {
    liveNow = {
      title: currentTitle,
      detail: cleanRuntimeSummary(activity?.summary),
      source_label:
        activeAgentJobs > 0
          ? `${activeAgentJobs} active lane${activeAgentJobs > 1 ? "s" : ""}`
          : activity?.source || "runtime",
      age_label: activity?.lastLogAgo || "-",
      status: "active"
    };
  }

  if (
    !hasLiveWork &&
    currentTitle &&
    activityKind === "work" &&
    ageSeconds <= RECENT_RUNTIME_MAX_SECONDS
  ) {
    lastFinished = {
      title: currentTitle,
      detail: cleanRuntimeSummary(activity?.summary),
      source_label: activity?.source || "runtime",
      age_label: activity?.lastLogAgo || "-",
      status: "recent"
    };
  } else if (history[0]) {
    lastFinished = history[0];
  } else if (room.resting) {
    lastFinished = {
      title: "room settled",
      detail: "Room lagi istirahat dan belum ada aksi baru.",
      source_label: "presence",
      age_label: activity?.lastLogAgo || "-",
      status: "idle"
    };
  }

  return {
    live_now: liveNow,
    last_finished: lastFinished
  };
}

function buildWorkspaceState(room, thread, recentThreads = [], workstreams = [], agentJobs = []) {
  const anchoredRepo = normalizeRepoName(room.current_repo || thread?.repoName, thread?.cwdDisplay);
  const roomDormant = room.phase === "standby" && room.status !== "busy";
  const activeRepo = roomDormant ? "workspace" : anchoredRepo;
  const activeRepoLabel = repoLabel(activeRepo);
  const threads = [thread, ...recentThreads]
    .filter(Boolean)
    .filter(
      (entry, index, source) =>
        source.findIndex((candidate) => candidate?.id === entry?.id) === index
    );
  const grouped = new Map();

  threads.forEach((entry) => {
    const repo = normalizeRepoName(entry.repoName, entry.cwdDisplay);
    const current = grouped.get(repo) || {
      repo,
      cwdDisplay: entry.cwdDisplay || repo,
      latestTitle: summarizeThreadDisplayTitle(entry.title, {
        zoneId: "lab",
        phase: room.phase
      }),
      latestAgeSeconds: entry.updatedAgeSeconds ?? Number.POSITIVE_INFINITY,
      latestAgo: entry.updatedAgo || "-",
      issueCount: 0
    };

    current.issueCount += 1;
    if ((entry.updatedAgeSeconds ?? Number.POSITIVE_INFINITY) < current.latestAgeSeconds) {
      current.cwdDisplay = entry.cwdDisplay || current.cwdDisplay;
      current.latestTitle = summarizeThreadDisplayTitle(entry.title, {
        zoneId: "lab",
        phase: room.phase
      });
      current.latestAgeSeconds = entry.updatedAgeSeconds ?? current.latestAgeSeconds;
      current.latestAgo = entry.updatedAgo || current.latestAgo;
    }

    grouped.set(repo, current);
  });

  const activeSummary = grouped.get(activeRepo) || {
    repo: activeRepo,
    cwdDisplay: activeRepo === "workspace" ? "workspace root" : thread?.cwdDisplay || activeRepo,
    latestTitle:
      activeRepo === "workspace" && roomDormant
        ? "No active room yet."
        : summarizeThreadDisplayTitle(thread?.title || room.current_task, {
            zoneId: room.focus_zone,
            phase: room.phase
          }),
    latestAgeSeconds:
      activeRepo === "workspace" && roomDormant
        ? Number.POSITIVE_INFINITY
        : thread?.updatedAgeSeconds ?? Number.POSITIVE_INFINITY,
    latestAgo:
      activeRepo === "workspace" && roomDormant
        ? "-"
        : thread?.updatedAgo || "-",
    issueCount: 1
  };

  return {
    active_room: {
      repo: activeRepoLabel,
      cwd_display: activeSummary.cwdDisplay,
      recent_thread_count: activeSummary.issueCount,
      active_lane_count: countActiveLanes(room, workstreams, agentJobs),
      status: room.status,
      phase: room.phase,
      latest_title: activeSummary.latestTitle,
      updated_ago: activeSummary.latestAgo
    },
    sleeping_rooms: [...grouped.values()]
      .filter((entry) => entry.repo !== activeRepo)
      .sort((left, right) => left.latestAgeSeconds - right.latestAgeSeconds)
      .slice(0, 4)
      .map((entry) => ({
        repo: repoLabel(entry.repo),
        cwd_display: entry.cwdDisplay,
        recent_thread_count: entry.issueCount,
        status: presenceFromAgeSeconds(entry.latestAgeSeconds),
        latest_title: entry.latestTitle,
        updated_ago: entry.latestAgo
      }))
  };
}

export function buildRoomState({
  status,
  thread,
  repoContext,
  recentThreads = [],
  activity,
  logs = [],
  agentJobs = []
}) {
  const taskIntelligence = baseSignals({
    status,
    thread,
    repoContext,
    activity,
    logs,
    agentJobs
  });
  const orchestration = inferOrchestration(taskIntelligence, { status, thread, activity });
  const reasons = roomReason(taskIntelligence, orchestration);

  const room = {
    title: ROOM_TITLE,
    phase: orchestration.room_phase,
    phase_confidence: orchestration.phase_confidence,
    review_stage: orchestration.review_stage,
    focus_zone: taskIntelligence.dominant_zone,
    focus_confidence: taskIntelligence.confidence,
    status,
    current_task: summarizePrimaryTask(taskIntelligence.current_task_summary),
    current_repo: taskIntelligence.current_repo,
    mode: orchestration.mode,
    substate: orchestration.cooling_down ? "cooldown" : null,
    resting: orchestration.room_phase === "standby" && taskIntelligence.signals.passive_mode,
    skills: extractSkills(logs),
    phase_reason: reasons.phase_reason,
    focus_reason: reasons.focus_reason
  };

  const workstreams = buildWorkstreams(taskIntelligence, orchestration);
  const recentEvents = buildRecentEvents(taskIntelligence, orchestration, workstreams, thread);
  const objective = buildObjectiveState(taskIntelligence, room, thread);
  const runtime = buildRuntimeState(
    taskIntelligence,
    room,
    activity,
    logs,
    inferNowSeconds(thread, activity)
  );
  room.current_task = room.resting ? "Istirahat sejenak" : runtime.live_now?.title || objective.title;
  const restCorner = buildRestCorner(room, activity);
  room.rest_corner = restCorner;
  const scene = buildSceneDirector({ ...room, rest_corner: restCorner }, workstreams, recentEvents);
  const agents = buildAgentStates(workstreams, orchestration, taskIntelligence, scene);

  return {
    status,
    room,
    objective,
    runtime,
    workspace: buildWorkspaceState(room, thread, recentThreads, workstreams, agentJobs),
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
