export const RUNTIME_EVENT_TTL_MS = 4200;
export const RUNTIME_EVENT_FADE_MS = 900;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeSummary(summary) {
  return String(summary || "").trim();
}

function inferEventType(summary) {
  const normalized = normalizeSummary(summary).toLowerCase();

  if (!normalized) {
    return "idle";
  }

  if (normalized.includes("spawn_child_async") || normalized.includes("spawn child")) {
    return "process_spawn";
  }

  if (normalized.includes("wait_agent") || normalized.includes("result returned")) {
    return "result_returned";
  }

  if (normalized.includes("review")) {
    return "review";
  }

  if (normalized.includes("debug") || normalized.includes("fail") || normalized.includes("error")) {
    return "debug";
  }

  if (
    normalized.includes("sqlite") ||
    normalized.includes("logs") ||
    normalized.includes("trace") ||
    normalized.includes("parse")
  ) {
    return "trace";
  }

  if (normalized.includes("test")) {
    return "test_run";
  }

  return "runtime";
}

function inferSeverity(eventType) {
  if (eventType === "debug") {
    return "warn";
  }

  if (eventType === "review" || eventType === "result_returned") {
    return "calm";
  }

  return "info";
}

function labelForEvent(eventType, zone) {
  if (eventType === "process_spawn") {
    return "spawn child";
  }

  if (eventType === "trace") {
    return zone === "database" ? "trace read" : "runtime trace";
  }

  if (eventType === "debug") {
    return "debug pass";
  }

  if (eventType === "review") {
    return "review pulse";
  }

  if (eventType === "result_returned") {
    return "result return";
  }

  if (eventType === "test_run") {
    return "test run";
  }

  return zone === "backend" ? "runtime sync" : `${zone} pulse`;
}

export function buildRuntimeEventSnapshot(data) {
  const summary = normalizeSummary(data?.activity?.summary);
  const roomPhase = data?.room?.phase || "standby";
  const zone = data?.room?.focus_zone || "lab";
  const substate = data?.room?.substate || null;

  if (!summary || data?.room?.resting || roomPhase === "standby" || substate === "cooldown") {
    return null;
  }

  const eventType = inferEventType(summary);
  const severity = inferSeverity(eventType);
  const label = labelForEvent(eventType, zone);
  const generatedAt =
    Date.parse(data?.generatedAt || data?.activity?.lastLogAtIso || "") || Date.now();

  return {
    id: `${generatedAt}:${zone}:${summary}`,
    eventType,
    severity,
    zone,
    label,
    detail: summary,
    createdAt: generatedAt,
    expiresAt: generatedAt + RUNTIME_EVENT_TTL_MS,
    persistentBadge: zone !== "lab",
    source: data?.activity?.source || "runtime"
  };
}

export function reduceRuntimeEventState(previousState, snapshot, now = Date.now()) {
  const nextState = {
    lastEventId: previousState?.lastEventId || null,
    bubble: previousState?.bubble || null,
    badge: null
  };

  if (snapshot?.persistentBadge) {
    nextState.badge = {
      label: snapshot.label,
      zone: snapshot.zone,
      severity: snapshot.severity,
      eventType: snapshot.eventType,
      detail: snapshot.detail,
      persistentBadge: true
    };
  }

  if (snapshot && snapshot.id !== nextState.lastEventId) {
    nextState.lastEventId = snapshot.id;
    nextState.bubble = {
      ...snapshot,
      createdAt: now,
      expiresAt: now + RUNTIME_EVENT_TTL_MS,
      opacity: 1
    };
  } else if (nextState.bubble && snapshot && nextState.bubble.id === snapshot.id) {
    if (now >= nextState.bubble.expiresAt) {
      nextState.bubble = null;
    } else {
      const fadeWindow = nextState.bubble.expiresAt - now;
      nextState.bubble.opacity =
        fadeWindow <= RUNTIME_EVENT_FADE_MS
          ? clamp(fadeWindow / RUNTIME_EVENT_FADE_MS, 0, 1)
          : 1;
    }
  } else if (nextState.bubble && now >= nextState.bubble.expiresAt) {
    nextState.bubble = null;
  }

  if (!snapshot) {
    nextState.badge = null;
  }

  return nextState;
}
