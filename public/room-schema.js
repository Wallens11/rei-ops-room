export const ROOM_TITLE = "Rei Ops Room";
export const DEFAULT_HEADLINE =
  "Rei lagi ngerjain apa, repo mana yang aktif, dan kapan squad ikut bantu.";
export const HEADLINE_ALTERNATIVES = [
  "Rei lagi ngerjain apa, repo mana yang aktif, dan kapan squad ikut bantu.",
  "Kerjaan aktif, repo yang nyala, dan momen squad mulai kebagi tugas.",
  "Pantau Rei, repo aktif, dan kapan room berubah dari solo jadi squad."
];
export const DEFAULT_DESCRIPTION =
  "Scene jadi sumber utama: phase, desk aktif, split kerja, dan handoff kebaca dari runtime lalu divisualkan di room.";

export const ROOM_PHASES = {
  standby: {
    id: "standby",
    title: "Standby",
    label: "Standby",
    summary: "Room lagi tenang dan belum ada gerakan berarti."
  },
  planning_huddle: {
    id: "planning_huddle",
    title: "Planning Huddle",
    label: "Planning Huddle",
    summary: "Squad ngumpul dulu buat ngunci arah kerja."
  },
  squad_split: {
    id: "squad_split",
    title: "Squad Split",
    label: "Squad Split",
    summary: "Lead lagi mecah kerja dan squad bergerak ke desk masing-masing."
  },
  execution: {
    id: "execution",
    title: "Execution",
    label: "Execution",
    summary: "Owner utama stay di desk aktif, squad lain bantu sesuai workstream."
  },
  review_wrap: {
    id: "review_wrap",
    title: "Review Wrap",
    label: "Review Wrap",
    summary: "Hasil balik ke review lane buat dirapihin dan dirangkum."
  }
};

export const ZONE_DEFINITIONS = [
  {
    id: "frontend",
    title: "Frontend Desk",
    shortTitle: "Frontend",
    color: "#65e4ff",
    detail: "UI, layout, motion, atau interaction lagi dominan.",
    ownerId: "ui",
    defaultTask: "Refine room visuals and interaction polish",
    keywords: [
      "frontend",
      "front",
      "ui",
      "ux",
      "page",
      "component",
      "layout",
      "css",
      "style",
      "design",
      "widget",
      "pixel",
      "react",
      "next",
      "vite",
      "canvas",
      "screen"
    ]
  },
  {
    id: "backend",
    title: "Backend Rack",
    shortTitle: "Backend",
    color: "#7cffba",
    detail: "Runtime, API, orchestration, atau server logic lagi diproses.",
    ownerId: "api",
    defaultTask: "Translate runtime signals into room state",
    keywords: [
      "backend",
      "api",
      "server",
      "function",
      "auth",
      "route",
      "sync",
      "worker",
      "service",
      "webhook",
      "node",
      "script",
      "endpoint",
      "orchestration",
      "runtime"
    ]
  },
  {
    id: "database",
    title: "Database Vault",
    shortTitle: "Database",
    color: "#ffcc66",
    detail: "Schema, query, migration, atau log/data layer lagi dibaca.",
    ownerId: "db",
    defaultTask: "Read thread and log traces from local state",
    keywords: [
      "database",
      "db",
      "sql",
      "sqlite",
      "postgres",
      "postgresql",
      "migration",
      "schema",
      "query",
      "table",
      "record",
      "logs",
      "trace"
    ]
  },
  {
    id: "review",
    title: "Docs / Ops Corner",
    shortTitle: "Review",
    color: "#ff907c",
    detail: "Review, docs, labels, summary, atau handoff lagi aktif.",
    ownerId: "docs",
    defaultTask: "Prepare concise labels and human-readable wrap",
    keywords: [
      "review",
      "issue",
      "docs",
      "document",
      "comment",
      "deploy",
      "release",
      "ci",
      "github",
      "pull request",
      "pr",
      "report",
      "summary",
      "summarize",
      "label",
      "wrap"
    ]
  },
  {
    id: "lab",
    title: "Lead Table",
    shortTitle: "Lab",
    color: "#b8a2ff",
    detail: "Lead lagi nahan squad di meja tengah sambil nentuin arah.",
    ownerId: "lead",
    defaultTask: "Clarify request and lock the next move",
    keywords: [
      "plan",
      "planning",
      "brief",
      "briefing",
      "outline",
      "strategy",
      "scope",
      "request",
      "clarify",
      "meeting",
      "huddle"
    ]
  }
];

function buildSystemPrompt(contract) {
  return [
    `You are ${contract.displayName}.`,
    `Inputs: ${contract.inputs.join("; ")}.`,
    `Outputs: ${contract.outputs.join("; ")}.`,
    `Responsibilities: ${contract.responsibilities.join("; ")}.`,
    `Non-responsibilities: ${contract.nonResponsibilities.join("; ")}.`,
    `Escalation: ${contract.escalation.join("; ")}.`
  ].join(" ");
}

const CAST_BASE = [
  {
    id: "lead",
    displayName: "Lead Rei",
    homeZone: "lab",
    defaultAssignedZone: "lab",
    visualRole: "coordinator",
    responsibility: "Reads the request, assigns work, and integrates outputs.",
    inputs: [
      "user request",
      "dominant zone confidence",
      "workstream availability",
      "recent runtime events"
    ],
    outputs: [
      "room phase decision",
      "focus zone",
      "workstream assignments",
      "integration summary"
    ],
    responsibilities: [
      "lock solo vs multi mode",
      "keep room phase transitions coherent",
      "assign or park workers",
      "integrate results before wrap"
    ],
    nonResponsibilities: [
      "pixel art execution owned by UI Rei",
      "direct database parsing owned by DB Rei"
    ],
    escalation: [
      "keep the room in planning_huddle when focus confidence is weak",
      "trigger squad_split only when multiple workstreams are justified"
    ]
  },
  {
    id: "ui",
    displayName: "UI Rei",
    homeZone: "frontend",
    defaultAssignedZone: "frontend",
    visualRole: "worker",
    responsibility: "Owns layout, motion, readability, and scene presentation.",
    inputs: [
      "room state",
      "scene direction",
      "active phase",
      "focus zone"
    ],
    outputs: [
      "layout changes",
      "canvas motion cues",
      "supporting labels",
      "widget presentation"
    ],
    responsibilities: [
      "make the room readable without turning it into a dashboard",
      "keep text subordinate to the scene",
      "translate state into cinematic visual emphasis"
    ],
    nonResponsibilities: [
      "does not infer backend truth from raw logs",
      "does not invent runtime state"
    ],
    escalation: [
      "ask Lead Rei to revisit hierarchy when text starts dominating the room",
      "defer to API/DB Rei for runtime facts"
    ]
  },
  {
    id: "api",
    displayName: "API Rei",
    homeZone: "backend",
    defaultAssignedZone: "backend",
    visualRole: "worker",
    responsibility: "Owns orchestration logic, server output, and runtime wiring.",
    inputs: [
      "thread metadata",
      "activity summary",
      "log bursts",
      "delegation signals"
    ],
    outputs: [
      "structured room state",
      "workstream status",
      "assignment metadata",
      "viewer API payload"
    ],
    responsibilities: [
      "keep runtime truth separate from visual storytelling",
      "model room phase and mode cleanly",
      "surface reliable data for the viewer"
    ],
    nonResponsibilities: [
      "does not own copy polish",
      "does not invent sub-agents without supporting signals"
    ],
    escalation: [
      "fall back to planning_huddle when signals conflict",
      "surface multi mode only when delegation or clear parallel work exists"
    ]
  },
  {
    id: "db",
    displayName: "DB Rei",
    homeZone: "database",
    defaultAssignedZone: "database",
    visualRole: "worker",
    responsibility: "Reads threads, logs, and local state traces to infer focus.",
    inputs: [
      "state sqlite rows",
      "logs sqlite rows",
      "repo paths",
      "timing signals"
    ],
    outputs: [
      "zone confidence",
      "event candidates",
      "activity classification",
      "recent trail summaries"
    ],
    responsibilities: [
      "prefer deterministic scoring over vibes",
      "weigh keywords, paths, bursts, and delegation traces together",
      "keep confidence visible"
    ],
    nonResponsibilities: [
      "does not decide final UI layout",
      "does not author human-facing wrap copy"
    ],
    escalation: [
      "return low confidence and let Lead Rei keep the room in planning_huddle",
      "trigger review handoff when result-return patterns appear"
    ]
  },
  {
    id: "docs",
    displayName: "Docs Rei",
    homeZone: "review",
    defaultAssignedZone: "review",
    visualRole: "worker",
    responsibility: "Turns room state into concise labels, summaries, and review cues.",
    inputs: [
      "workstream outputs",
      "room phase",
      "recent events",
      "current task summary"
    ],
    outputs: [
      "short labels",
      "review wrap cues",
      "human-readable summaries",
      "handoff language"
    ],
    responsibilities: [
      "keep copy tight and readable",
      "make review and wrap states explicit",
      "avoid dashboard-speak"
    ],
    nonResponsibilities: [
      "does not infer raw runtime state from scratch",
      "does not drive Scout movement directly"
    ],
    escalation: [
      "request review_wrap when results return or labels need cleanup",
      "stay secondary while execution is still the main story"
    ]
  },
  {
    id: "scout",
    displayName: "Scout Rei",
    homeZone: "lab",
    defaultAssignedZone: "lab",
    visualRole: "courier",
    responsibility: "Shows meaningful handoff and context transfer between zones.",
    inputs: [
      "recent_events",
      "handoff payload",
      "from/to zones",
      "room phase"
    ],
    outputs: [
      "movement cue",
      "courier payload bubble",
      "context transfer visibility"
    ],
    responsibilities: [
      "move only on meaningful events",
      "connect the planning table to active desks",
      "show workstream handoff and review requests"
    ],
    nonResponsibilities: [
      "does not roam randomly just to fill motion",
      "does not own a primary workstream"
    ],
    escalation: [
      "stay at the lab when there is no real handoff",
      "defer to Lead Rei when multiple events compete"
    ]
  }
];

export const VISUAL_CAST = CAST_BASE.map((agent) => ({
  ...agent,
  systemPrompt: buildSystemPrompt(agent)
}));

export const ZONE_BY_ID = Object.fromEntries(
  ZONE_DEFINITIONS.map((zone) => [zone.id, zone])
);

export const AGENT_BY_ID = Object.fromEntries(VISUAL_CAST.map((agent) => [agent.id, agent]));

export const ZONE_TO_AGENT = Object.fromEntries(
  ZONE_DEFINITIONS.map((zone) => [zone.id, zone.ownerId])
);
