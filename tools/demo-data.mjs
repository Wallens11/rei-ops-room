/**
 * Demo data for Rei Ops Room — simulates a fully active agent environment
 * without requiring GitHub auth, Codex state DB, or any AI runtime.
 *
 * Used exclusively by tools/demo-server.mjs when DEMO_MODE=true.
 */

const now = Date.now();

function minsAgo(n) {
  return new Date(now - n * 60 * 1000).toISOString();
}

function hoursAgo(n) {
  return new Date(now - n * 60 * 60 * 1000).toISOString();
}

function daysAgo(n) {
  return new Date(now - n * 24 * 60 * 60 * 1000).toISOString();
}

// ─── Raw issues (already normalized — matches normalizeGithubIssue() shape) ──────

export const DEMO_ISSUES = [
  {
    number: 42,
    title: "Add dark mode toggle to settings page",
    state: "OPEN",
    createdAt: daysAgo(5),
    updatedAt: minsAgo(12),
    url: "https://github.com/demo-user/my-app/issues/42",
    labels: ["agent:rei", "mode:execute", "status:done"],
    assignees: ["rei-bot"],
    author: "raffi"
  },
  {
    number: 41,
    title: "Fix N+1 query in /api/users endpoint",
    state: "OPEN",
    createdAt: daysAgo(4),
    updatedAt: minsAgo(3),
    url: "https://github.com/demo-user/my-app/issues/41",
    labels: ["agent:rei", "mode:execute", "status:in_progress"],
    assignees: ["rei-bot"],
    author: "raffi"
  },
  {
    number: 40,
    title: "Write unit tests for auth middleware",
    state: "OPEN",
    createdAt: daysAgo(3),
    updatedAt: hoursAgo(2),
    url: "https://github.com/demo-user/my-app/issues/40",
    labels: ["agent:rei", "mode:execute", "status:todo"],
    assignees: [],
    author: "raffi"
  },
  {
    number: 39,
    title: "Migrate database schema to support multi-tenant",
    state: "OPEN",
    createdAt: daysAgo(6),
    updatedAt: hoursAgo(8),
    url: "https://github.com/demo-user/my-app/issues/39",
    labels: ["agent:rei", "mode:execute", "status:blocked"],
    assignees: [],
    author: "raffi"
  },
  {
    number: 38,
    title: "Update API documentation for v2 endpoints",
    state: "CLOSED",
    createdAt: daysAgo(8),
    updatedAt: daysAgo(1),
    url: "https://github.com/demo-user/my-app/issues/38",
    labels: ["agent:rei", "mode:report_only", "status:done"],
    assignees: ["rei-bot"],
    author: "wei"
  },
  {
    number: 37,
    title: "Add rate limiting to public API endpoints",
    state: "OPEN",
    createdAt: daysAgo(2),
    updatedAt: hoursAgo(5),
    url: "https://github.com/demo-user/my-app/issues/37",
    labels: ["agent:rei", "mode:execute", "status:todo"],
    assignees: [],
    author: "raffi"
  },
  {
    number: 36,
    title: "Refactor authentication flow to use OAuth2 PKCE",
    state: "CLOSED",
    createdAt: daysAgo(10),
    updatedAt: daysAgo(2),
    url: "https://github.com/demo-user/my-app/issues/36",
    labels: ["agent:rei", "mode:execute", "status:done"],
    assignees: ["rei-bot"],
    author: "raffi"
  },
  {
    number: 35,
    title: "Set up Playwright E2E tests for checkout flow",
    state: "CLOSED",
    createdAt: daysAgo(12),
    updatedAt: daysAgo(3),
    url: "https://github.com/demo-user/my-app/issues/35",
    labels: ["agent:rei", "mode:execute", "status:done"],
    assignees: ["rei-bot"],
    author: "wei"
  }
];

// ─── GitHub issues API response shape ────────────────────────────────────────

export function buildDemoGithubIssues() {
  const issues = DEMO_ISSUES;
  const summary = {
    total: issues.length,
    todo: issues.filter((i) => i.labels.includes("status:todo")).length,
    inProgress: issues.filter((i) => i.labels.includes("status:in_progress")).length,
    blocked: issues.filter((i) => i.labels.includes("status:blocked")).length
  };

  const activeIssue = issues.find((i) => i.labels.includes("status:in_progress")) || null;
  const suggestedIssue = issues.find((i) => i.labels.includes("status:todo")) || null;

  return {
    repo: "demo-user/my-app",
    filters: {
      state: "open",
      labels: ["agent:rei"],
      limit: 20
    },
    summary,
    planner: {
      status: "active",
      activeCount: 1,
      blockedCount: 1,
      activeIssue: activeIssue
        ? { number: activeIssue.number, title: activeIssue.title, updatedAt: activeIssue.updatedAt, status: "in_progress", url: activeIssue.url }
        : null,
      suggestedIssue: suggestedIssue
        ? { number: suggestedIssue.number, title: suggestedIssue.title, updatedAt: suggestedIssue.updatedAt, status: "todo", url: suggestedIssue.url }
        : null
    },
    issues
  };
}

// ─── Execute preview (/api/github/execute/preview) ───────────────────────────

export function buildDemoExecutePreview() {
  return {
    status: "ready",
    target: {
      number: 40,
      title: "Write unit tests for auth middleware",
      status: "todo",
      url: "https://github.com/demo-user/my-app/issues/40"
    },
    repo: "demo-user/my-app",
    issue: {
      number: 40,
      title: "Write unit tests for auth middleware",
      state: "OPEN",
      labels: ["agent:rei", "mode:execute", "status:todo"],
      body: "The auth middleware at `src/middleware/auth.js` currently has 0% test coverage. We need unit tests covering:\n\n- JWT token validation\n- Expired token handling\n- Missing Authorization header\n- Role-based access checks\n\nAcceptance: `npm test` passes with coverage ≥ 80% for the auth module.",
      url: "https://github.com/demo-user/my-app/issues/40",
      createdAt: daysAgo(3),
      updatedAt: hoursAgo(2)
    },
    skillProfile: { id: "backend", label: "Backend" },
    prompt: "Write unit tests for the auth middleware at src/middleware/auth.js. Cover JWT validation, expired tokens, missing headers, and role checks. Target ≥80% coverage. Run the tests and confirm they pass.",
    trust: {
      items: [
        "backend tasks: 9/11 completed (82%)",
        "best runtime: claude-code (12/14 ok, 86%)",
        "last run: 8 min ago — completed issue #42"
      ],
      riskLevel: "low",
      failurePattern: null
    },
    detail: "Issue #40 is queued and ready to execute. No blockers detected.",
    continuity: null
  };
}

// ─── Execute service status (/api/github/execute/service) ────────────────────

export function buildDemoServiceStatus() {
  return {
    status: "running",
    running: true,
    pid: 12345,
    source: "pid",
    currentTarget: {
      number: 41,
      title: "Fix N+1 query in /api/users endpoint",
      status: "in_progress",
      url: "https://github.com/demo-user/my-app/issues/41"
    },
    currentChildPid: 12346,
    detail: "claude-code is running issue #41 (resumed session). Elapsed: 3m 24s.",
    lastResult: {
      status: "completed",
      target: {
        number: 42,
        title: "Add dark mode toggle to settings page"
      },
      runtimeId: "claude-code",
      detail: "Completed execute issue #42. PR opened: #88.",
      finishedAt: minsAgo(8)
    }
  };
}

// ─── Metrics (/api/metrics) ───────────────────────────────────────────────────

export function buildDemoMetrics() {
  return {
    totalRuns: 23,
    successRate: 0.783,
    byRuntime: {
      "claude-code": { completed: 12, failed: 2, total: 14 },
      "codex": { completed: 6, failed: 3, total: 9 }
    },
    byProfile: {
      "frontend": { completed: 7, failed: 1, total: 8 },
      "backend": { completed: 9, failed: 2, total: 11 },
      "general": { completed: 2, failed: 2, total: 4 }
    },
    recentRuns: [
      { issueNumber: 42, outcome: "completed", runtimeId: "claude-code", profileId: "frontend", recordedAt: minsAgo(8) },
      { issueNumber: 39, outcome: "failed",    runtimeId: "codex",       profileId: "backend",  recordedAt: minsAgo(45) },
      { issueNumber: 38, outcome: "completed", runtimeId: "claude-code", profileId: "general",  recordedAt: hoursAgo(2) },
      { issueNumber: 37, outcome: "completed", runtimeId: "codex",       profileId: "backend",  recordedAt: hoursAgo(4) },
      { issueNumber: 36, outcome: "completed", runtimeId: "claude-code", profileId: "backend",  recordedAt: hoursAgo(6) },
      { issueNumber: 35, outcome: "failed",    runtimeId: "codex",       profileId: "backend",  recordedAt: hoursAgo(9) },
      { issueNumber: 34, outcome: "completed", runtimeId: "claude-code", profileId: "frontend", recordedAt: daysAgo(1) },
      { issueNumber: 33, outcome: "completed", runtimeId: "claude-code", profileId: "frontend", recordedAt: daysAgo(1) },
      { issueNumber: 32, outcome: "failed",    runtimeId: "codex",       profileId: "general",  recordedAt: daysAgo(2) },
      { issueNumber: 31, outcome: "completed", runtimeId: "claude-code", profileId: "backend",  recordedAt: daysAgo(2) }
    ]
  };
}

// ─── Artifacts (/api/artifacts) ──────────────────────────────────────────────

export function buildDemoArtifacts() {
  // No real HTML files available in demo — return empty list
  return [];
}

// ─── Queue (/api/queue) ───────────────────────────────────────────────────────

export function buildDemoQueue() {
  return { tasks: [], total: 0 };
}

// ─── Workers (/api/workers) ───────────────────────────────────────────────────

export function buildDemoWorkers() {
  return [
    {
      workerId: "demo-01",
      pid: 12345,
      runtimeId: "claude-code",
      startedAt: minsAgo(24),
      currentIssue: 41
    }
  ];
}

// ─── Status (the main /api/status response) ───────────────────────────────────
// buildRoomState() produces a complex shape. We craft a plausible one directly
// so the UI renders in a live-looking "coding" state.

export function buildDemoRoomStatus() {
  return {
    demo: true,
    generatedAt: new Date().toISOString(),
    workspaceRoot: "/workspace/my-app",
    status: "busy",
    room: {
      title: "Rei Ops Room",
      phase: "coding",
      phase_confidence: 0.91,
      review_stage: null,
      focus_zone: "backend",
      focus_confidence: 0.88,
      status: "busy",
      current_task: "Fix N+1 query in /api/users endpoint",
      current_repo: "my-app",
      mode: "execute",
      substate: null,
      resting: false,
      skills: [],
      phase_reason: "Agent is actively executing a backend task via claude-code.",
      focus_reason: "Backend zone is dominant — API query optimization in progress.",
      rest_corner: null
    },
    objective: {
      title: "Fix N+1 query in /api/users endpoint",
      focus_title: "Backend Rack",
      repo: "demo-user/my-app",
      phase_title: "Executing",
      detail: "Identifying query patterns in UserController and adding eager loading via ORM. Running profiler to confirm improvement."
    },
    runtime: {
      live_now: {
        title: "claude-code running issue #41",
        source_label: "execute-worker",
        age_label: "3 min ago"
      },
      last_finished: {
        title: "Completed issue #42 — dark mode toggle",
        source_label: "execute-worker",
        age_label: "8 min ago"
      },
      prefer_objective: false
    },
    workspace: {
      active_room: {
        repo: "demo-user/my-app",
        recent_thread_count: 3,
        active_lane_count: 1,
        status: "active",
        phase: "coding",
        latest_title: "Fix N+1 query in /api/users endpoint",
        updated_ago: "3m ago"
      },
      sleeping_rooms: [
        {
          repo: "demo-user/design-system",
          status: "sleeping",
          recent_thread_count: 2,
          latest_title: "Audit accessible component tokens",
          updated_ago: "2h ago"
        }
      ]
    },
    taskIntelligence: {
      dominant_zone: "backend",
      confidence: 0.88,
      signals: { passive_mode: false },
      current_task_summary: "Fix N+1 query in /api/users endpoint",
      current_repo: "my-app"
    },
    orchestration: {
      room_phase: "coding",
      phase_confidence: 0.91,
      review_stage: null,
      mode: "execute",
      cooling_down: false
    },
    workstreams: [],
    agents: [],
    recent_events: [],
    skills: [],
    scene: {
      phase_title: "Executing",
      phase_reason: "Agent is actively running a task.",
      focus_title: "Backend Rack",
      focus_label: "Active Desk",
      focus_chip_title: "Backend Rack",
      focus_reason: "API query optimization in progress.",
      tone: "busy",
      active_zone: {
        label: "Active Desk",
        chip_title: "Backend Rack",
        title: "Backend Rack",
        reason: "API query optimization in progress."
      },
      assignment_hint: {
        active: true,
        label: "Next Assignment",
        zone_id: "backend",
        chip_title: "Issue #40",
        title: "Write unit tests for auth middleware",
        reason: "Next in queue."
      }
    },
    thread: {
      id: "demo-thread-001",
      title: "Fix N+1 query in /api/users endpoint",
      cwd: "/workspace/my-app",
      gitBranch: "rei/fix-n-plus-1-query",
      gitOriginUrl: "https://github.com/demo-user/my-app",
      updatedAt: Math.floor((now - 3 * 60 * 1000) / 1000)
    },
    repoContext: null,
    recentThreads: [
      {
        id: "demo-thread-001",
        title: "Fix N+1 query in /api/users endpoint",
        cwd: "/workspace/my-app",
        gitBranch: "rei/fix-n-plus-1-query",
        updatedAt: Math.floor((now - 3 * 60 * 1000) / 1000)
      },
      {
        id: "demo-thread-002",
        title: "Add dark mode toggle to settings page",
        cwd: "/workspace/my-app",
        gitBranch: "rei/dark-mode-toggle",
        updatedAt: Math.floor((now - 8 * 60 * 1000) / 1000)
      }
    ],
    activity: {
      summary: "claude-code running issue #41 — Fix N+1 query in /api/users endpoint",
      source: "execute-worker",
      kind: "coding",
      lastLogAt: Math.floor((now - 3 * 60 * 1000) / 1000),
      lastLogAtIso: minsAgo(3),
      lastLogAgo: "3m ago",
      lastLogAgeSeconds: 180
    },
    phase: {
      mode: "coding",
      title: "Executing",
      reason: "Agent is actively running a task via claude-code.",
      confidence: 0.91
    },
    focus: {
      zone: "backend",
      title: "Backend Rack",
      reason: "API query optimization in progress.",
      confidence: 0.88
    },
    ui: {
      headline: "Rei Ops Room",
      description: "Autonomous agent operations center."
    }
  };
}
