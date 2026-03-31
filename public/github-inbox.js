const DEFAULT_FILTERS = {
  state: "open",
  labels: ["agent:rei"],
  limit: 20
};

const DEFAULT_SUMMARY = {
  total: 0,
  todo: 0,
  inProgress: 0,
  blocked: 0
};

const DEFAULT_PLANNER = {
  status: "idle",
  activeCount: 0,
  blockedCount: 0,
  activeIssue: null,
  suggestedIssue: null
};

function normalizeLabels(labels = []) {
  const normalized = [];

  for (const label of labels) {
    const value = String(label || "").trim();
    if (!value || normalized.includes(value)) {
      continue;
    }

    normalized.push(value);
  }

  return normalized;
}

function detectIssueStatus(labels = []) {
  if (labels.includes("status:blocked")) {
    return "blocked";
  }

  if (labels.includes("status:in_progress")) {
    return "in_progress";
  }

  if (labels.includes("status:todo")) {
    return "todo";
  }

  return "open";
}

function normalizeIssue(issue = {}) {
  const labels = normalizeLabels(issue.labels || []);

  return {
    number: Number(issue.number || 0),
    title: issue.title || "Untitled issue",
    state: issue.state || "OPEN",
    updatedAt: issue.updatedAt || null,
    url: issue.url || null,
    labels,
    status: detectIssueStatus(labels)
  };
}

function normalizeSummary(summary = {}, issues = []) {
  const total = Number(summary.total);
  const todo = Number(summary.todo);
  const inProgress = Number(summary.inProgress);
  const blocked = Number(summary.blocked);

  return {
    total: Number.isFinite(total) ? total : issues.length,
    todo: Number.isFinite(todo)
      ? todo
      : issues.filter((issue) => issue.status === "todo").length,
    inProgress: Number.isFinite(inProgress)
      ? inProgress
      : issues.filter((issue) => issue.status === "in_progress").length,
    blocked: Number.isFinite(blocked)
      ? blocked
      : issues.filter((issue) => issue.status === "blocked").length
  };
}

function normalizePlannerIssue(issue) {
  if (!issue) {
    return null;
  }

  return {
    number: Number(issue.number || 0),
    title: issue.title || "Untitled issue",
    updatedAt: issue.updatedAt || null,
    status: issue.status || "open",
    url: issue.url || null
  };
}

function normalizePlanner(planner = {}) {
  return {
    status: planner.status || DEFAULT_PLANNER.status,
    activeCount: Number(planner.activeCount || 0),
    blockedCount: Number(planner.blockedCount || 0),
    activeIssue: normalizePlannerIssue(planner.activeIssue),
    suggestedIssue: normalizePlannerIssue(planner.suggestedIssue)
  };
}

function formatSyncTimestamp(iso) {
  const match = String(iso || "").match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
  return match ? `${match[1]} ${match[2]} UTC` : "not synced yet";
}

function formatIssueMeta(updatedAt) {
  return `updated ${formatSyncTimestamp(updatedAt)}`;
}

function orderedLabels(labels = []) {
  const statusLabels = [];
  const otherLabels = [];

  for (const label of labels) {
    if (label.startsWith("status:")) {
      statusLabels.push(label);
    } else {
      otherLabels.push(label);
    }
  }

  return [...statusLabels, ...otherLabels];
}

function formatIssueBrief(issue) {
  return `#${issue.number} ${issue.title}`;
}

export function createEmptyGithubInboxState() {
  return {
    status: "idle",
    repo: null,
    filters: {
      ...DEFAULT_FILTERS,
      labels: [...DEFAULT_FILTERS.labels]
    },
    summary: {
      ...DEFAULT_SUMMARY
    },
    planner: {
      ...DEFAULT_PLANNER
    },
    issues: [],
    syncedAt: null,
    error: null
  };
}

export function normalizeGithubInboxPayload(payload = {}, syncedAt = new Date().toISOString()) {
  const issues = (payload.issues || []).map((issue) => normalizeIssue(issue));

  return {
    status: "ready",
    repo: payload.repo || null,
    filters: {
      state: payload.filters?.state || DEFAULT_FILTERS.state,
      labels: normalizeLabels(payload.filters?.labels || DEFAULT_FILTERS.labels),
      limit: Number(payload.filters?.limit || DEFAULT_FILTERS.limit)
    },
    summary: normalizeSummary(payload.summary, issues),
    planner: normalizePlanner(payload.planner),
    issues,
    syncedAt,
    error: null
  };
}

export function createGithubInboxErrorState(
  previous = createEmptyGithubInboxState(),
  error,
  syncedAt = new Date().toISOString()
) {
  return {
    ...previous,
    status: "error",
    syncedAt,
    error: error instanceof Error ? error.message : String(error || "GitHub inbox unavailable")
  };
}

export function buildGithubInboxViewModel(inbox = createEmptyGithubInboxState()) {
  const title = inbox.repo || "GitHub Inbox";
  const labelsText = inbox.filters?.labels?.length ? inbox.filters.labels.join(", ") : "all labels";
  const baseMeta = `${inbox.summary.todo} todo | ${inbox.summary.inProgress} in progress | ${inbox.summary.blocked} blocked`;
  const meta = inbox.status === "error" && inbox.error ? `${baseMeta} | ${inbox.error}` : baseMeta;
  const scope = `${inbox.filters?.state || "open"} | ${labelsText} | synced ${formatSyncTimestamp(inbox.syncedAt)}`;
  let queueTitle = "Queue idle";
  let queueDetail = "No active in-progress issue and no suggested next issue yet.";

  if (inbox.planner?.activeIssue) {
    queueTitle = `Active Queue: ${formatIssueBrief(inbox.planner.activeIssue)}`;
    queueDetail = inbox.planner?.suggestedIssue
      ? `Next: ${formatIssueBrief(inbox.planner.suggestedIssue)}`
      : "No queued todo issue behind the active item.";
  } else if (inbox.planner?.suggestedIssue) {
    queueTitle = `Suggested Next: ${formatIssueBrief(inbox.planner.suggestedIssue)}`;
    queueDetail = "Queue idle, safe to pick the first todo item.";
  } else if (inbox.planner?.status === "blocked") {
    queueTitle = "Queue blocked";
    queueDetail = "Only blocked issues are visible in the tracked inbox right now.";
  }

  if (inbox.status === "loading") {
    return {
      title,
      chip: "syncing",
      meta,
      scope,
      queueTitle,
      queueDetail,
      rows: [
        {
          id: "github-loading",
          title: "Syncing GitHub issues...",
          href: null,
          detail: "Checking the remote inbox for agent-tagged work.",
          meta: "waiting for GitHub",
          tone: "loading"
        }
      ]
    };
  }

  if (!inbox.issues || inbox.issues.length === 0) {
    return {
      title,
      chip: inbox.status === "error" ? "offline" : "idle",
      meta,
      scope,
      queueTitle,
      queueDetail,
      rows: [
        {
          id: "github-empty",
          title: "No matching issues yet.",
          href: null,
          detail: "Tag an issue with agent:rei or move one into the tracked inbox labels.",
          meta: inbox.status === "error" ? "last snapshot unavailable" : "remote inbox is clear",
          tone: inbox.status === "error" ? "error" : "empty"
        }
      ]
    };
  }

  return {
    title,
    chip: inbox.status === "error" ? "offline" : `${inbox.summary.total} open`,
    meta,
    scope,
    queueTitle,
    queueDetail,
    rows: inbox.issues.slice(0, 5).map((issue) => ({
      id: `issue-${issue.number}`,
      title: `#${issue.number} ${issue.title}`,
      href: issue.url,
      detail: orderedLabels(issue.labels).join(" | ") || issue.state,
      meta: formatIssueMeta(issue.updatedAt),
      tone: issue.status
    }))
  };
}
