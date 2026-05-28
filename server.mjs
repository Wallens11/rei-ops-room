import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildRoomState } from "./public/room-state.js";
import {
  enqueueTask,
  readQueue,
  readWorkers,
  removeQueueTask,
  signalWorkerWake
} from "./tools/execute-queue.mjs";
import { readArtifactFile, readArtifacts } from "./tools/execute-artifacts.mjs";
import { createGithubRunner } from "./tools/github-api.mjs";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");
const workspaceRoot = process.env.WORKSPACE_ROOT || path.resolve(__dirname, "..");
const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
const stateDb = process.env.CODEX_STATE_DB || path.join(codexHome, "state_5.sqlite");
const logsDb = process.env.CODEX_LOGS_DB || path.join(codexHome, "logs_1.sqlite");
const dailyDeviceHandoffPaths = process.env.DAILY_DEVICE_HANDOFF_PATH
  ? [process.env.DAILY_DEVICE_HANDOFF_PATH]
  : [];
const port = Number(process.env.PORT || 4317);
export const SQLITE_JSON_MAX_BUFFER = 8 * 1024 * 1024;
export const STATUS_STREAM_RETRY_MS = 2500;
const STATUS_STREAM_INTERVAL_MS = Number(process.env.STATUS_STREAM_INTERVAL_MS || 2000);
const GITHUB_ISSUE_JSON_FIELDS =
  "number,title,state,createdAt,updatedAt,url,labels,assignees,author";
const DEFAULT_GITHUB_ISSUE_LIMIT = 20;
const DEFAULT_GITHUB_ISSUE_LABELS = ["agent:rei"];
const FOCUS_PROFILES = [
  {
    zone: "frontend",
    title: "Frontend Desk",
    detail: "UI, layout, or interaction work is dominant.",
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
      "design.md",
      "getdesign",
      "widget",
      "pixel",
      "react",
      "next",
      "vite",
      "form",
      "screen"
    ]
  },
  {
    zone: "backend",
    title: "Backend Rack",
    detail: "Logic, API, or server-side flow is being processed.",
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
      "kintone",
      "endpoint"
    ]
  },
  {
    zone: "database",
    title: "Database Vault",
    detail: "Schema, migration, or data layer work is in progress.",
    keywords: [
      "database",
      "db",
      "sql",
      "sqlite",
      "postgres",
      "postgresql",
      "migration",
      "schema",
      "supabase",
      "query",
      "table",
      "record",
      "bigquery"
    ]
  },
  {
    zone: "review",
    title: "Docs / Ops Corner",
    detail: "Review, issue, docs, or deployment work is active.",
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
      "leader",
      "report"
    ]
  }
];
const MEETING_KEYWORDS = [
  "plan",
  "planning",
  "rencana",
  "meeting",
  "brief",
  "briefing",
  "outline",
  "spec",
  "strategy",
  "brainstorm",
  "diskusi",
  "discuss",
  "next step"
];
const DISPATCH_KEYWORDS = [
  "spawn_agent",
  "spawn agent",
  "subagent",
  "multi-agent",
  "parallel",
  "worker",
  "explorer",
  "wait_agent",
  "send_input"
];
const OBSERVER_TOOL_PREFIXES = [
  "functions.mcp__playwright__browser_",
  "mcp__playwright__browser_"
];
const INTERNAL_TOOL_NAMES = new Set(["functions.write_stdin", "write_stdin"]);
const OBSERVER_COMMAND_SNIPPETS = [
  "http://localhost:4317",
  "localhost:4317/api/status",
  "agent-pixel room",
  "agent-pixel widget",
  "agent-pixel status",
  "agent-pixel stop"
];
const NOISE_MESSAGE_PREFIXES = [
  "websocket request:",
  "websocket event:",
  "unhandled responses event:",
  "app-server event:"
];
const NOISE_MESSAGE_SNIPPETS = [
  "registering event source with poller",
  "deregistering event source from poller",
  "token usage",
  "tool gate released",
  "waiting for tool gate",
  "successfully connected to websocket:",
  "models cache:",
  "session_loop{",
  "submission_dispatch{",
  "wouldblock",
  "masked: false",
  "opcode: data(",
  "first:",
  "second:",
  "tokio-tungstenite",
  "received frame",
  "parsed headers [",
  "stream.poll_next",
  "websocketstream.with_context",
  "decompressing "
];
const NOISE_TARGET_PREFIXES = [
  "codex_app_server::",
  "codex_api::",
  "codex_core::models_manager::",
  "codex_otel."
];
const GITHUB_WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET || "";
const statusStreamClients = new Set();
let statusStreamTimer = null;
let statusStreamSequence = 0;
let statusStreamInflight = null;
let logsMessageColumnPromise = null;

function quoteSql(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

export function createSseFrame({ event = "message", retry = null, id = null, data = "" } = {}) {
  const lines = [];

  if (id) {
    lines.push(`id: ${id}`);
  }

  if (event) {
    lines.push(`event: ${event}`);
  }

  if (Number.isFinite(retry)) {
    lines.push(`retry: ${retry}`);
  }

  const payload = typeof data === "string" ? data : JSON.stringify(data);
  for (const line of String(payload).split(/\r?\n/)) {
    lines.push(`data: ${line}`);
  }

  return `${lines.join("\n")}\n\n`;
}

export function chooseLogsMessageColumn(columns) {
  const names = new Set(
    (columns || []).map((column) => String(column?.name || "").trim().toLowerCase()).filter(Boolean)
  );

  if (names.has("message")) {
    return "message";
  }

  if (names.has("feedback_log_body")) {
    return "feedback_log_body";
  }

  return "message";
}

async function detectLogsMessageColumn(databasePath = logsDb) {
  if (!logsMessageColumnPromise) {
    logsMessageColumnPromise = sqliteJson(databasePath, "PRAGMA table_info(logs);")
      .then((columns) => chooseLogsMessageColumn(columns))
      .catch(() => "message");
  }

  return logsMessageColumnPromise;
}

export function buildThreadLogsSql(
  threadId,
  limit = 500,
  messageLimit = 320,
  messageColumn = "message"
) {
  return `
      SELECT
        ts,
        level,
        target,
        substr(${messageColumn}, 1, ${messageLimit}) AS message
      FROM logs
      WHERE thread_id = ${quoteSql(threadId)}
      ORDER BY ts DESC, ts_nanos DESC, id DESC
      LIMIT ${limit};
    `;
}

export function buildGlobalRuntimeLogsSql(limit = 120, messageLimit = 320, messageColumn = "message") {
  return `
      SELECT
        thread_id AS threadId,
        ts,
        level,
        target,
        substr(${messageColumn}, 1, ${messageLimit}) AS message
      FROM logs
      WHERE thread_id IS NULL OR thread_id = ''
      ORDER BY ts DESC, ts_nanos DESC, id DESC
      LIMIT ${limit};
    `;
}

export function buildAgentJobItemsSql(threadId, limit = 12) {
  return `
      SELECT
        items.job_id,
        items.item_id,
        items.status,
        items.assigned_thread_id,
        items.row_json,
        items.result_json,
        items.last_error,
        items.created_at,
        items.updated_at,
        items.completed_at,
        jobs.name AS job_name,
        jobs.status AS job_status,
        jobs.instruction
      FROM agent_job_items AS items
      JOIN agent_jobs AS jobs
        ON jobs.id = items.job_id
      WHERE items.assigned_thread_id = ${quoteSql(threadId)}
      ORDER BY items.updated_at DESC, items.created_at DESC
      LIMIT ${limit};
    `;
}

function buildPythonSqliteArgs(databasePath, sql) {
  const script = [
    "import json",
    "import sqlite3",
    "import sys",
    "connection = sqlite3.connect(sys.argv[1])",
    "connection.row_factory = sqlite3.Row",
    "rows = [dict(row) for row in connection.execute(sys.argv[2]).fetchall()]",
    "print(json.dumps(rows))"
  ].join(";");

  return ["-c", script, databasePath, sql];
}

export async function sqliteJsonWithRunner(runner, databasePath, sql) {
  let stdout = "";

  try {
    ({ stdout } = await runner("sqlite3", ["-json", databasePath, sql], {
      maxBuffer: SQLITE_JSON_MAX_BUFFER
    }));
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }

    ({ stdout } = await runner("python", buildPythonSqliteArgs(databasePath, sql), {
      maxBuffer: SQLITE_JSON_MAX_BUFFER
    }));
  }

  const text = stdout.trim();
  return text ? JSON.parse(text) : [];
}

async function sqliteJson(databasePath, sql) {
  return sqliteJsonWithRunner(execFileAsync, databasePath, sql);
}

function clampPositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

function normalizeGithubIssueState(state = "open") {
  const normalized = String(state || "open").trim().toLowerCase();
  if (normalized === "closed" || normalized === "all") {
    return normalized;
  }

  return "open";
}

function normalizeGithubLabels(labels, fallback = []) {
  const values = Array.isArray(labels) ? labels : [labels];
  const normalized = [];

  for (const value of values) {
    const label = String(value || "").trim();
    if (!label || normalized.includes(label)) {
      continue;
    }

    normalized.push(label);
  }

  return normalized.length > 0 ? normalized : [...fallback];
}

function parseGithubLabelsParam(searchParams) {
  if (!searchParams.has("labels")) {
    return [...DEFAULT_GITHUB_ISSUE_LABELS];
  }

  return normalizeGithubLabels(searchParams.get("labels")?.split(",") || [], []);
}

export function normalizeGithubRepoSlug(remoteUrl) {
  const value = String(remoteUrl || "").trim();
  if (!value) {
    return null;
  }

  const match =
    value.match(/^https:\/\/github\.com\/([^/]+\/[^/.]+?)(?:\.git)?$/i) ||
    value.match(/^git@github\.com:([^/]+\/[^/.]+?)(?:\.git)?$/i) ||
    value.match(/^ssh:\/\/git@github\.com\/([^/]+\/[^/.]+?)(?:\.git)?$/i);

  return match ? match[1] : null;
}

export function buildGithubIssueListArgs({
  repo,
  state = "open",
  labels = [],
  limit = DEFAULT_GITHUB_ISSUE_LIMIT
}) {
  const normalizedState = normalizeGithubIssueState(state);
  const normalizedLabels = normalizeGithubLabels(labels);
  const normalizedLimit = clampPositiveInteger(limit, DEFAULT_GITHUB_ISSUE_LIMIT);
  const args = [
    "issue",
    "list",
    "--repo",
    repo,
    "--state",
    normalizedState,
    "--limit",
    String(normalizedLimit)
  ];

  for (const label of normalizedLabels) {
    args.push("--label", label);
  }

  args.push("--json", GITHUB_ISSUE_JSON_FIELDS);
  return args;
}

function normalizeGithubIssue(issue = {}) {
  return {
    number: Number(issue.number || 0),
    title: issue.title || "Untitled issue",
    state: issue.state || "OPEN",
    createdAt: issue.createdAt || null,
    updatedAt: issue.updatedAt || null,
    url: issue.url || null,
    labels: (issue.labels || []).map((label) => label?.name).filter(Boolean),
    assignees: (issue.assignees || []).map((assignee) => assignee?.login).filter(Boolean),
    author: issue.author?.login || null
  };
}

function detectGithubIssueStatus(labels = []) {
  const values = new Set((labels || []).map((label) => String(label)));

  if (values.has("status:in_progress")) {
    return "in_progress";
  }

  if (values.has("status:todo")) {
    return "todo";
  }

  if (values.has("status:blocked")) {
    return "blocked";
  }

  return "open";
}

function byUpdatedAtDesc(left, right) {
  return String(right?.updatedAt || "").localeCompare(String(left?.updatedAt || ""));
}

function bySuggestedTodoPriority(left, right) {
  const creationOrder = String(right?.createdAt || right?.updatedAt || "").localeCompare(
    String(left?.createdAt || left?.updatedAt || "")
  );

  if (creationOrder !== 0) {
    return creationOrder;
  }

  return byUpdatedAtDesc(left, right);
}

function toPlannerIssue(issue, status) {
  if (!issue) {
    return null;
  }

  return {
    number: issue.number,
    title: issue.title,
    updatedAt: issue.updatedAt || null,
    status,
    url: issue.url || null
  };
}

export function buildGithubIssueSummary(issues = []) {
  const summary = {
    total: issues.length,
    todo: 0,
    inProgress: 0,
    blocked: 0
  };

  for (const issue of issues) {
    const labels = new Set((issue.labels || []).map((label) => String(label)));
    if (labels.has("status:in_progress")) {
      summary.inProgress += 1;
    } else if (labels.has("status:blocked")) {
      summary.blocked += 1;
    } else if (labels.has("status:todo")) {
      summary.todo += 1;
    }
  }

  return summary;
}

export function buildGithubQueuePlan(issues = []) {
  const activeIssues = issues
    .filter((issue) => detectGithubIssueStatus(issue.labels) === "in_progress")
    .sort(byUpdatedAtDesc);
  const todoIssues = issues
    .filter((issue) => detectGithubIssueStatus(issue.labels) === "todo")
    .sort(bySuggestedTodoPriority);
  const blockedIssues = issues
    .filter((issue) => detectGithubIssueStatus(issue.labels) === "blocked")
    .sort(byUpdatedAtDesc);

  let status = "idle";
  if (activeIssues.length > 0) {
    status = "active";
  } else if (todoIssues.length > 0) {
    status = "queued";
  } else if (blockedIssues.length > 0) {
    status = "blocked";
  }

  return {
    status,
    activeCount: activeIssues.length,
    blockedCount: blockedIssues.length,
    activeIssue: toPlannerIssue(activeIssues[0], "in_progress"),
    suggestedIssue: toPlannerIssue(todoIssues[0], "todo")
  };
}

async function githubJsonWithRunner(runner, args, options = {}) {
  const { stdout } = await runner("gh", args, {
    ...options,
    maxBuffer: SQLITE_JSON_MAX_BUFFER
  });
  const text = stdout.trim();
  return text ? JSON.parse(text) : [];
}

export async function inferGithubRepoSlugWithRunner(
  runner,
  { cwd = __dirname, remoteName = "origin" } = {}
) {
  const { stdout } = await runner("git", ["remote", "get-url", remoteName], { cwd });
  const repo = normalizeGithubRepoSlug(stdout);

  if (!repo) {
    const error = new Error(`Could not infer a GitHub repo slug from remote "${remoteName}"`);
    error.statusCode = 500;
    throw error;
  }

  return repo;
}

function defaultRunner() {
  return process.env.GITHUB_TOKEN
    ? createGithubRunner({ fallbackRunner: execFileAsync })
    : execFileAsync;
}

async function inferGithubRepoSlug(options) {
  return inferGithubRepoSlugWithRunner(defaultRunner(), options);
}

export async function listGithubIssuesWithRunner(
  runner,
  { repo, state = "open", labels = DEFAULT_GITHUB_ISSUE_LABELS, limit = DEFAULT_GITHUB_ISSUE_LIMIT } = {}
) {
  const filters = {
    state: normalizeGithubIssueState(state),
    labels: normalizeGithubLabels(labels, DEFAULT_GITHUB_ISSUE_LABELS),
    limit: clampPositiveInteger(limit, DEFAULT_GITHUB_ISSUE_LIMIT)
  };
  const rawIssues = await githubJsonWithRunner(
    runner,
    buildGithubIssueListArgs({
      repo,
      ...filters
    })
  );
  const issues = rawIssues.map((issue) => normalizeGithubIssue(issue));

  return {
    repo,
    filters,
    summary: buildGithubIssueSummary(issues),
    planner: buildGithubQueuePlan(issues),
    issues
  };
}

async function listGithubIssues(options) {
  return listGithubIssuesWithRunner(defaultRunner(), options);
}

async function previewReportOnlyAction(options = {}) {
  const module = await import("./tools/report-only-bridge.mjs");
  return module.prepareReportOnlyAction({
    cwd: __dirname,
    ...options
  });
}

async function postReportOnlyAction(options = {}) {
  const module = await import("./tools/report-only-bridge.mjs");
  return module.executeReportOnlyAction({
    cwd: __dirname,
    ...options
  });
}

async function getReportOnlyServiceStatus() {
  const module = await import("./tools/report-only-worker-cli.mjs");
  const runtime = await module.inspectWorkerRuntime();

  return {
    running: runtime.running,
    pid: runtime.pid,
    source: runtime.source,
    detail: module.buildWorkerStatusLine(runtime)
  };
}

async function controlReportOnlyService({ action }) {
  const module = await import("./tools/report-only-worker-cli.mjs");
  return module.controlReportOnlyService({
    action,
    logger: () => {}
  });
}

async function previewExecuteAction(options = {}) {
  const module = await import("./tools/execute-bridge.mjs");
  const continuity = options.continuity || (await readExecuteContinuity().catch(() => null));
  return module.prepareExecuteAction({
    cwd: __dirname,
    continuity,
    ...options
  });
}

async function defaultApproveIssue({ issueNumber, repo }) {
  const module = await import("./tools/execute-bridge.mjs");
  const resolvedRepo = repo ||
    (await inferGithubRepoSlug({ cwd: __dirname, remoteName: "origin" }).catch(() => null));
  if (!resolvedRepo) {
    const err = new Error("Cannot infer GitHub repo slug. Pass ?repo= parameter.");
    err.statusCode = 400;
    throw err;
  }
  await module.approveExecuteIssue({ issueNumber, repo: resolvedRepo });
  return { approved: true, issueNumber, repo: resolvedRepo };
}

async function getExecuteServiceStatus() {
  const module = await import("./tools/execute-worker-cli.mjs");
  const runtime = await module.inspectExecuteWorkerRuntime();

  return {
    status: runtime.status || (runtime.running ? "running" : "idle"),
    running: runtime.running,
    pid: runtime.pid,
    source: runtime.source,
    currentTarget: runtime.currentTarget || null,
    lastResult: runtime.lastResult || null,
    detail: module.buildExecuteWorkerStatusLine(runtime)
  };
}

async function controlExecuteService({ action, workerIndex = 1 }) {
  const module = await import("./tools/execute-worker-cli.mjs");
  return module.controlExecuteService({
    action,
    workerIndex: Number.isFinite(Number(workerIndex)) && Number(workerIndex) >= 1 ? Math.round(Number(workerIndex)) : 1,
    logger: () => {}
  });
}

const REQUEST_BODY_MAX_BYTES = 1 * 1024 * 1024; // 1 MB

async function readJsonRequestBody(request) {
  const chunks = [];
  let totalBytes = 0;

  for await (const chunk of request) {
    totalBytes += chunk.length;
    if (totalBytes > REQUEST_BODY_MAX_BYTES) {
      const error = new Error("Request body too large");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }

  const text = Buffer.concat(chunks).toString("utf8").trim();
  return text ? JSON.parse(text) : {};
}

function toIso(seconds) {
  return seconds ? new Date(seconds * 1000).toISOString() : null;
}

function normalizeFsPath(value) {
  return String(value || "").replaceAll("\\", "/");
}

export function stripWorkspacePrefix(cwd, root = workspaceRoot) {
  if (!cwd) {
    return "";
  }

  const normalizedCwd = normalizeFsPath(cwd);
  const normalizedRoot = normalizeFsPath(root);

  if (normalizedCwd === normalizedRoot) {
    return "workspace root";
  }

  if (normalizedCwd.startsWith(`${normalizedRoot}/`)) {
    return normalizedCwd.slice(normalizedRoot.length + 1);
  }

  return cwd;
}

function repoNameFromCwd(cwd) {
  const display = stripWorkspacePrefix(cwd);
  if (!display || display === "workspace root") {
    return path.basename(workspaceRoot);
  }

  return display.split(path.sep)[0];
}

function relativeTime(secondsAgo) {
  if (secondsAgo < 5) {
    return "just now";
  }

  if (secondsAgo < 60) {
    return `${Math.floor(secondsAgo)}s ago`;
  }

  const minutes = Math.floor(secondsAgo / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }

  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function decodeEmbeddedString(raw) {
  if (!raw) {
    return raw;
  }

  try {
    return JSON.parse(`"${raw}"`);
  } catch {
    return raw.replaceAll('\\"', '"').replaceAll("\\\\", "\\");
  }
}

function extractCommand(message) {
  if (!message) {
    return null;
  }

  const argumentsMatch = message.match(/"arguments":"((?:\\.|[^"])*)"/);
  if (argumentsMatch) {
    try {
      const decodedArguments = decodeEmbeddedString(argumentsMatch[1]);
      const parsedArguments = JSON.parse(decodedArguments);
      if (typeof parsedArguments.cmd === "string") {
        return parsedArguments.cmd;
      }
    } catch {
      // Ignore malformed payloads and fall through to simpler patterns.
    }
  }

  const match = message.match(/"cmd":"((?:\\.|[^"])*)"/);
  if (!match) {
    return null;
  }

  return decodeEmbeddedString(match[1]);
}

function compactCommand(command) {
  const oneLine = command.replace(/\s+/g, " ").trim();
  return oneLine.length > 82 ? `${oneLine.slice(0, 79)}...` : oneLine;
}

function humanizeToolName(toolName) {
  return toolName
    .replace(/^mcp__/, "")
    .replace(/^functions\./, "")
    .replaceAll("__", " / ")
    .replaceAll("_", " ");
}

function extractToolName(message) {
  if (!message) {
    return null;
  }

  const match = message.match(/^ToolCall:\s+([A-Za-z0-9_.-]+)/);
  return match ? match[1] : null;
}

function isObserverCommand(command) {
  const text = command?.toLowerCase() || "";
  return OBSERVER_COMMAND_SNIPPETS.some((snippet) => text.includes(snippet));
}

function isObserverTool(toolName) {
  return OBSERVER_TOOL_PREFIXES.some((prefix) => toolName?.startsWith(prefix));
}

export function filterMeaningfulLogs(logs) {
  return logs.filter((log) => {
    const message = log.message?.trim();
    const target = log.target?.trim() || "";
    const messageLower = message?.toLowerCase() || "";
    const targetLower = target.toLowerCase();
    if (!message) {
      return false;
    }

    if (message === "Output item" || message === "Input item") {
      return false;
    }

    if (NOISE_MESSAGE_PREFIXES.some((prefix) => messageLower.startsWith(prefix))) {
      return false;
    }

    if (NOISE_MESSAGE_SNIPPETS.some((snippet) => messageLower.includes(snippet))) {
      return false;
    }

    if (NOISE_TARGET_PREFIXES.some((prefix) => targetLower.startsWith(prefix))) {
      return false;
    }

    const command = extractCommand(log.message);
    if (command && isObserverCommand(command)) {
      return false;
    }

    if (!command && messageLower.startsWith('received message {"type":"response.')) {
      return false;
    }

    const toolName = extractToolName(log.message);
    if (toolName && INTERNAL_TOOL_NAMES.has(toolName)) {
      return false;
    }

    if (toolName && isObserverTool(toolName)) {
      return false;
    }

    return true;
  });
}

export function selectActivityLogs(threadLogs, globalLogs = [], { nowSeconds, recentWindowSeconds = 20 } = {}) {
  const meaningfulThreadLogs = filterMeaningfulLogs(threadLogs);
  if (meaningfulThreadLogs.length > 0) {
    return meaningfulThreadLogs;
  }

  const meaningfulGlobalLogs = filterMeaningfulLogs(globalLogs).filter((log) => {
    if (!Number.isFinite(nowSeconds)) {
      return true;
    }

    const ts = Number(log.ts || 0);
    if (!Number.isFinite(ts) || ts <= 0) {
      return false;
    }

    return Math.max(0, nowSeconds - ts) <= recentWindowSeconds;
  });

  return meaningfulGlobalLogs;
}

function summarizeActivity(logs) {
  for (const log of logs) {
    const command = extractCommand(log.message);
    if (command) {
      return {
        summary: `Menjalankan: ${compactCommand(command)}`,
        source: "tool",
        kind: "work"
      };
    }
  }

  for (const log of logs) {
    const message = log.message?.trim();
    if (!message) {
      continue;
    }

    if (
      message === "Output item" ||
      message === "Input item" ||
      message.includes("token usage") ||
      message.startsWith("websocket request:") ||
      message.startsWith("websocket event:") ||
      message.startsWith("unhandled responses event:")
    ) {
      continue;
    }

    const toolCallMatch = message.match(/^ToolCall:\s+([A-Za-z0-9_.-]+)/);
    if (toolCallMatch) {
      return {
        summary: `Tool: ${humanizeToolName(toolCallMatch[1])}`,
        source: "tool",
        kind: "work"
      };
    }

    return {
      summary: message.length > 88 ? `${message.slice(0, 85)}...` : message,
      source: log.target,
      kind: "work"
    };
  }

  return {
    summary: "Standby di thread aktif",
    source: "thread",
    kind: "thread"
  };
}

function presenceFromAge(secondsAgo) {
  if (secondsAgo <= 90) {
    return "busy";
  }

  if (secondsAgo <= 15 * 60) {
    return "cooldown";
  }

  return "idle";
}

function mapThread(thread, nowSeconds) {
  if (!thread) {
    return null;
  }

  const ageSeconds = Math.max(0, nowSeconds - Number(thread.updatedAt || 0));
  return {
    id: thread.id,
    title: thread.title,
    cwd: thread.cwd,
    cwdDisplay: stripWorkspacePrefix(thread.cwd),
    repoName: repoNameFromCwd(thread.cwd),
    gitBranch: thread.gitBranch || null,
    gitOriginUrl: thread.gitOriginUrl || null,
    updatedAt: Number(thread.updatedAt || 0),
    updatedAtIso: toIso(Number(thread.updatedAt || 0)),
    updatedAgo: relativeTime(ageSeconds),
    updatedAgeSeconds: ageSeconds
  };
}

function inferFocus(thread, repoContext, activity) {
  const primarySources = [
    { text: thread?.title, weight: 4 },
    { text: activity?.summary, weight: 4 },
    { text: thread?.cwd, weight: 3 },
    { text: thread?.gitBranch, weight: 1 }
  ];
  let bestProfile = null;
  let bestScore = 0;
  let bestHits = [];
  const fallbackSources = [
    { text: repoContext?.title, weight: 1 },
    { text: repoContext?.cwd, weight: 1 }
  ];

  const weightedSources = [...primarySources, ...fallbackSources];
  const primaryHaystack = primarySources
    .map((source) => source.text?.toLowerCase() || "")
    .join(" ");

  for (const profile of FOCUS_PROFILES) {
    const hits = [];
    let score = 0;
    let primaryScore = 0;

    for (const source of weightedSources) {
      const haystack = source.text?.toLowerCase();
      if (!haystack) {
        continue;
      }

      for (const keyword of profile.keywords) {
        if (!haystack.includes(keyword)) {
          continue;
        }

        if (!hits.includes(keyword)) {
          hits.push(keyword);
        }

        const keywordWeight = keyword.length >= 7 ? 2 : 1;
        const hitScore = keywordWeight * source.weight;
        score += hitScore;
        if (primaryHaystack.includes(keyword)) {
          primaryScore += hitScore;
        }
      }
    }

    if (primaryScore > 0) {
      score += 100;
    }

    if (score > bestScore) {
      bestProfile = profile;
      bestScore = score;
      bestHits = hits;
    }
  }

  if (!bestProfile) {
    return {
      zone: "lab",
      title: "General Lab",
      reason: "No strong signal yet; squad standing by in the central area.",
      hits: [],
      confidence: "low"
    };
  }

  const confidence = bestScore >= 5 ? "high" : "medium";
  const hitPreview = bestHits.slice(0, 4).join(", ");

  return {
    zone: bestProfile.zone,
    title: bestProfile.title,
    reason: `${bestProfile.detail} Kebaca dari: ${hitPreview}.`,
    hits: bestHits.slice(0, 6),
    confidence
  };
}

function inferPhase(thread, activity, logs, focus) {
  const primaryText = [thread?.title, activity?.summary].filter(Boolean).join(" ").toLowerCase();
  const logText = logs
    .map((log) => log.message || "")
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const dispatchHits = DISPATCH_KEYWORDS.filter(
    (keyword) => primaryText.includes(keyword) || logText.includes(keyword)
  );
  if (dispatchHits.length > 0) {
    return {
      mode: "dispatch",
      title: "Squad Split",
      reason: `Sub-agent atau kerja paralel kebaca dari: ${dispatchHits.slice(0, 3).join(", ")}.`
    };
  }

  const meetingHits = MEETING_KEYWORDS.filter((keyword) => primaryText.includes(keyword));
  if (meetingHits.length > 0 || focus.confidence === "low") {
    return {
      mode: "meeting",
      title: "Planning Huddle",
      reason:
        meetingHits.length > 0
          ? `Still in discussion / planning phase from: ${meetingHits.slice(0, 3).join(", ")}.`
          : "No strong focus yet, squad gathering at the central table."
    };
  }

  return {
    mode: "working",
    title: "Heads Down",
    reason: `Fokus utama lagi di ${focus.title}, jadi agent aktif stay di meja itu.`
  };
}

async function getStatus() {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const latestThreadSql = `
    SELECT
      id,
      title,
      cwd,
      git_branch AS gitBranch,
      git_origin_url AS gitOriginUrl,
      updated_at AS updatedAt
    FROM threads
    WHERE archived = 0
    ORDER BY updated_at DESC
    LIMIT 1;
  `;
  const latestRepoSql = `
    SELECT
      id,
      title,
      cwd,
      git_branch AS gitBranch,
      git_origin_url AS gitOriginUrl,
      updated_at AS updatedAt
    FROM threads
    WHERE archived = 0
      AND cwd <> ${quoteSql(workspaceRoot)}
    ORDER BY updated_at DESC
    LIMIT 1;
  `;
  const recentThreadsSql = `
    SELECT
      id,
      title,
      cwd,
      git_branch AS gitBranch,
      updated_at AS updatedAt
    FROM threads
    WHERE archived = 0
    ORDER BY updated_at DESC
    LIMIT 5;
  `;

  const [latestThreadRows, latestRepoRows, recentRows] = await Promise.all([
    sqliteJson(stateDb, latestThreadSql),
    sqliteJson(stateDb, latestRepoSql),
    sqliteJson(stateDb, recentThreadsSql)
  ]);
  const [latestThreadRow] = latestThreadRows;
  const [latestRepoRow] = latestRepoRows;
  const latestThread = mapThread(latestThreadRow, nowSeconds);
  const latestRepo = mapThread(latestRepoRow, nowSeconds);

  let activity = {
    summary: latestThread?.title || "Standby di thread aktif",
    source: "thread",
    kind: "thread"
  };
  let lastLogAt = latestThread?.updatedAt || 0;
  let threadLogs = [];
  const logsMessageColumn = await detectLogsMessageColumn(logsDb);

  if (latestThread?.id) {
    const logSql = buildThreadLogsSql(latestThread.id, 500, 320, logsMessageColumn);

    let globalLogs;
    [threadLogs, globalLogs] = await Promise.all([
      sqliteJson(logsDb, logSql),
      sqliteJson(logsDb, buildGlobalRuntimeLogsSql(120, 320, logsMessageColumn))
    ]);
    const meaningfulLogs = selectActivityLogs(threadLogs, globalLogs, { nowSeconds });
    if (meaningfulLogs.length > 0) {
      lastLogAt = Number(meaningfulLogs[0].ts || lastLogAt);
      activity = summarizeActivity(meaningfulLogs);
      threadLogs = meaningfulLogs;
    }
  }

  let agentJobs = [];
  if (latestThread?.id) {
    agentJobs = await sqliteJson(stateDb, buildAgentJobItemsSql(latestThread.id));
  }

  const activityAgeSeconds = Math.max(0, nowSeconds - lastLogAt);
  const presence = presenceFromAge(activityAgeSeconds);
  if (threadLogs.length === 0 && presence !== "busy") {
    activity = {
      summary: "Istirahat sejenak",
      source: "presence",
      kind: "rest"
    };
  }
  const repoContext =
    latestRepo && latestThread && latestRepo.id !== latestThread.id ? latestRepo : null;
  const roomState = buildRoomState({
    status: presence,
    thread: latestThread,
    repoContext,
    recentThreads: recentRows.map((row) => mapThread(row, nowSeconds)),
    activity: {
      ...activity,
      lastLogAt,
      lastLogAtIso: toIso(lastLogAt),
      lastLogAgo: relativeTime(activityAgeSeconds),
      lastLogAgeSeconds: activityAgeSeconds
    },
    logs: threadLogs,
    agentJobs
  });

  return {
    generatedAt: new Date().toISOString(),
    workspaceRoot,
    ...roomState
  };
}

function compactExecuteContinuityText(value, maxLength = 140) {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();

  if (!normalized) {
    return "";
  }

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

export function summarizeExecuteContinuity(status = {}) {
  if (!status || typeof status !== "object") {
    return null;
  }

  const repo = compactExecuteContinuityText(
    status.room?.current_repo || status.objective?.repo || status.repoContext?.repoName || "",
    80
  );
  const objective = compactExecuteContinuityText(
    status.objective?.title || status.room?.current_task || status.activity?.summary || "",
    160
  );
  const focus = compactExecuteContinuityText(status.focus?.title || status.phase?.title || "", 80);
  const liveTitle = compactExecuteContinuityText(status.runtime?.live_now?.title || "", 160);
  const liveMeta = compactExecuteContinuityText(
    [status.runtime?.live_now?.source_label, status.runtime?.live_now?.age_label].filter(Boolean).join(" | "),
    80
  );
  const lastFinishedTitle = compactExecuteContinuityText(status.runtime?.last_finished?.title || "", 160);
  const lastFinishedMeta = compactExecuteContinuityText(
    [status.runtime?.last_finished?.source_label, status.runtime?.last_finished?.age_label].filter(Boolean).join(" | "),
    80
  );
  const lines = [
    repo ? `- Active repo: ${repo}` : null,
    objective ? `- Objective: ${objective}` : null,
    focus ? `- Focus: ${focus}` : null,
    liveTitle ? `- Live signal: ${liveTitle}${liveMeta ? ` (${liveMeta})` : ""}` : null,
    lastFinishedTitle ? `- Last finished: ${lastFinishedTitle}${lastFinishedMeta ? ` (${lastFinishedMeta})` : ""}` : null
  ].filter(Boolean);

  if (lines.length === 0) {
    return null;
  }

  return {
    generatedAt: status.generatedAt || null,
    repo: repo || null,
    objective: objective || null,
    focus: focus || null,
    liveNow: liveTitle ? `${liveTitle}${liveMeta ? ` (${liveMeta})` : ""}` : null,
    lastFinished: lastFinishedTitle ? `${lastFinishedTitle}${lastFinishedMeta ? ` (${lastFinishedMeta})` : ""}` : null,
    summary: lines.slice(0, 4).join("\n")
  };
}

export async function readExecuteContinuity({ getStatusImpl = getStatus } = {}) {
  const status = await getStatusImpl();
  return summarizeExecuteContinuity(status);
}

function writeStatusStreamFrame(response, payload) {
  response.write(
    createSseFrame({
      event: "status",
      retry: STATUS_STREAM_RETRY_MS,
      id: `status-${++statusStreamSequence}`,
      data: payload
    })
  );
}

function writeStatusStreamError(response, error) {
  response.write(
    createSseFrame({
      event: "status_error",
      retry: STATUS_STREAM_RETRY_MS,
      id: `status-error-${++statusStreamSequence}`,
      data: {
        error: "Failed to read Codex state",
        detail: error instanceof Error ? error.message : String(error)
      }
    })
  );
}

async function broadcastStatusSnapshot() {
  if (statusStreamClients.size === 0) {
    return;
  }

  if (statusStreamInflight) {
    return statusStreamInflight;
  }

  statusStreamInflight = (async () => {
    try {
      const payload = await getStatus();
      for (const client of statusStreamClients) {
        try {
          writeStatusStreamFrame(client, payload);
        } catch {
          statusStreamClients.delete(client);
        }
      }
    } catch (error) {
      for (const client of statusStreamClients) {
        try {
          writeStatusStreamError(client, error);
        } catch {
          statusStreamClients.delete(client);
        }
      }
    } finally {
      statusStreamInflight = null;
    }
  })();

  return statusStreamInflight;
}

function ensureStatusStreamTimer() {
  if (statusStreamTimer || statusStreamClients.size === 0) {
    return;
  }

  statusStreamTimer = setInterval(() => {
    void broadcastStatusSnapshot();
  }, STATUS_STREAM_INTERVAL_MS);
}

function cleanupStatusStreamTimer() {
  if (statusStreamClients.size > 0 || !statusStreamTimer) {
    return;
  }

  clearInterval(statusStreamTimer);
  statusStreamTimer = null;
}

async function attachStatusStream(response) {
  response.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no"
  });
  response.flushHeaders?.();
  response.write(": connected\n\n");

  statusStreamClients.add(response);
  ensureStatusStreamTimer();
  await broadcastStatusSnapshot();
}

export function contentType(filePath) {
  if (filePath.endsWith(".html")) {
    return "text/html; charset=utf-8";
  }

  if (filePath.endsWith(".js")) {
    return "text/javascript; charset=utf-8";
  }

  if (filePath.endsWith(".css")) {
    return "text/css; charset=utf-8";
  }

  if (filePath.endsWith(".json")) {
    return "application/json; charset=utf-8";
  }

  if (filePath.endsWith(".svg")) {
    return "image/svg+xml";
  }

  return "text/plain; charset=utf-8";
}

async function serveStatic(requestPath, response) {
  const safePath = requestPath === "/" ? "/index.html" : requestPath;
  const filePath = path.normalize(path.join(publicDir, safePath));

  if (!filePath.startsWith(publicDir)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  try {
    const file = await fs.readFile(filePath);
    response.writeHead(200, { "Content-Type": contentType(filePath) });
    response.end(file);
  } catch {
    response.writeHead(404);
    response.end("Not found");
  }
}

function writeJson(response, statusCode, payload) {
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload, null, 2));
}

function buildGithubIssueFilters(url) {
  return {
    repo: url.searchParams.get("repo")?.trim() || null,
    state: normalizeGithubIssueState(url.searchParams.get("state")),
    labels: parseGithubLabelsParam(url.searchParams),
    limit: clampPositiveInteger(url.searchParams.get("limit"), DEFAULT_GITHUB_ISSUE_LIMIT)
  };
}

export function parseDailyDeviceHandoffMarkdown(markdown = "") {
  const dayEntries = [];
  let currentDay = null;
  let currentSection = null;

  for (const rawLine of String(markdown).split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    const dayMatch = line.match(/^##\s+(\d{4}-\d{2}-\d{2})\s*$/);

    if (dayMatch) {
      currentDay = {
        date: dayMatch[1],
        sections: []
      };
      dayEntries.push(currentDay);
      currentSection = null;
      continue;
    }

    if (!currentDay) {
      continue;
    }

    const sectionMatch = line.match(/^###\s+(.+?)\s*$/);
    if (sectionMatch) {
      currentSection = {
        title: sectionMatch[1].trim(),
        items: []
      };
      currentDay.sections.push(currentSection);
      continue;
    }

    if (!currentSection) {
      continue;
    }

    const bulletMatch = line.match(/^\s*-\s+(.+?)\s*$/);
    if (bulletMatch) {
      currentSection.items.push(bulletMatch[1].trim());
      continue;
    }

    if (line.trim() && currentSection.items.length > 0) {
      const lastIndex = currentSection.items.length - 1;
      currentSection.items[lastIndex] = `${currentSection.items[lastIndex]} ${line.trim()}`;
    }
  }

  const latestDay = [...dayEntries].sort((left, right) => left.date.localeCompare(right.date)).at(-1);
  if (!latestDay) {
    return {
      status: "empty",
      date: null,
      sections: []
    };
  }

  const filteredSections = latestDay.sections.filter(
    (section) => section.title && Array.isArray(section.items) && section.items.length > 0
  );

  return {
    status: filteredSections.some((section) => section.items.length > 0) ? "ready" : "empty",
    date: latestDay.date,
    sections: filteredSections,
    ...extractStructuredHandoffFields(filteredSections)
  };
}

// 3: Extract structured fields from special handoff sections — backward-compatible
// Recognised sections (case-insensitive): "Next Focus Zone", "Blockers", "Active Issues"
export function extractStructuredHandoffFields(sections = []) {
  const result = {
    next_focus_zone: null,
    blockers: [],
    active_issues: []
  };

  for (const section of sections) {
    const titleLc = String(section.title || "").toLowerCase();
    const items = Array.isArray(section.items) ? section.items.filter(Boolean) : [];

    if (titleLc.includes("next focus zone") || titleLc.includes("focus zone")) {
      // Take zone from the first item — can be "backend", "frontend", etc.
      const raw = String(items[0] || "").toLowerCase().trim();
      const knownZones = ["frontend", "backend", "database", "review", "lab"];
      result.next_focus_zone = knownZones.find((z) => raw.includes(z)) || raw || null;
    } else if (titleLc.includes("blocker")) {
      result.blockers = items;
    } else if (titleLc.includes("active issue")) {
      // Parse "#N title" or free text containing #N
      result.active_issues = items
        .map((item) => {
          const match = String(item).match(/#(\d+)/);
          return match ? { number: Number(match[1]), text: item } : null;
        })
        .filter(Boolean);
    }
  }

  return result;
}

export async function readDailyDeviceHandoff(filePath = dailyDeviceHandoffPaths) {
  const candidates = Array.isArray(filePath) ? filePath.filter(Boolean) : [filePath].filter(Boolean);

  for (const candidate of candidates) {
    try {
      const markdown = await fs.readFile(candidate, "utf8");
      return {
        ...parseDailyDeviceHandoffMarkdown(markdown),
        sourcePath: candidate,
        checkedPaths: candidates
      };
    } catch (error) {
      if (error?.code === "ENOENT") {
        continue;
      }

      throw error;
    }
  }

  return {
    status: "missing",
    date: null,
    sections: [],
    sourcePath: candidates[0] || null,
    checkedPaths: candidates,
    detail: "Daily device handoff note not found yet."
  };
}

// ─── Default implementations for injected deps ───────────────────────────────

async function defaultRemoveQueueTask(id) {
  return removeQueueTask(id);
}

async function defaultListRuntimes() {
  const { RUNTIME_MAP, probeAvailableRuntimes, RUNTIME_PREFERENCES } = await import("./tools/runtimes/index.mjs");
  const available = await probeAvailableRuntimes(process.env);
  const runtimes = [...RUNTIME_MAP.entries()].map(([id, rt]) => ({
    id,
    label: rt.RUNTIME_LABEL,
    available: available.includes(id)
  }));
  return { runtimes, available, preferences: RUNTIME_PREFERENCES };
}

async function defaultGetRunLedger() {
  const { readLearningLog } = await import("./tools/execute-learning.mjs");
  const entries = await readLearningLog();
  const byDate = {};
  const byRuntime = {};
  let totalRuns = 0;
  for (const entry of entries) {
    totalRuns++;
    const day = entry.date || entry.recordedAt?.slice(0, 10) || "unknown";
    const runtime = entry.runtimeId || "unknown";
    if (!byDate[day]) byDate[day] = { completed: 0, failed: 0, total: 0 };
    byDate[day].total++;
    if (entry.outcome === "completed") byDate[day].completed++;
    else if (entry.outcome === "failed" || entry.outcome === "review_needed") byDate[day].failed++;
    if (!byRuntime[runtime]) byRuntime[runtime] = { completed: 0, failed: 0, total: 0 };
    byRuntime[runtime].total++;
    if (entry.outcome === "completed") byRuntime[runtime].completed++;
    else if (entry.outcome === "failed" || entry.outcome === "review_needed") byRuntime[runtime].failed++;
  }
  return {
    totalRuns,
    byDate,
    byRuntime,
    costNote: "Token/cost data not available for subscription-based runtimes (Codex, Claude Code).",
    recent: entries.slice(-10).reverse()
  };
}

// ─── Webhook helpers (exported for testability) ───────────────────────────────

/**
 * Verify an X-Hub-Signature-256 header against a raw request body.
 * Returns true if secret is empty (dev mode — skip verification).
 * Returns false if secret is set and the signature does not match or is missing.
 */
export function verifyGithubWebhookSignature(secret, rawBody, signatureHeader) {
  if (!secret) return true; // dev mode: no verification
  const sig = String(signatureHeader || "");
  const expected = `sha256=${crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex")}`;
  // timingSafeEqual requires equal-length buffers — guard first
  if (sig.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}

/**
 * Decide whether a GitHub webhook event should trigger a worker wake-up.
 * Returns { triggered: boolean, reason?: string }.
 *
 * Relevant:
 *   issues        — labeled (agent:rei / mode:*), unlabeled, assigned, opened with rei label
 *   issue_comment — created
 *   push          — any push (worker is idempotent if queue is empty)
 *   pull_request  — closed + merged
 */
export function isRelevantWebhookEvent(eventType, payload) {
  const action = String(payload?.action || "");

  if (eventType === "issues") {
    if (action === "labeled") {
      const labelName = String(payload?.label?.name || "");
      if (labelName === "agent:rei" || labelName.startsWith("mode:")) {
        return { triggered: true, reason: "issue labeled with agent/mode label" };
      }
      return { triggered: false };
    }
    if (action === "unlabeled" || action === "assigned") {
      return { triggered: true, reason: `issue ${action}` };
    }
    if (action === "opened") {
      const labels = Array.isArray(payload?.issue?.labels)
        ? payload.issue.labels.map((l) => String(l?.name || ""))
        : [];
      if (labels.some((l) => l === "agent:rei" || l.startsWith("mode:"))) {
        return { triggered: true, reason: "new issue with agent:rei label" };
      }
      return { triggered: false };
    }
    return { triggered: false };
  }

  if (eventType === "issue_comment" && action === "created") {
    return { triggered: true, reason: "issue comment created" };
  }

  if (eventType === "push") {
    return { triggered: true, reason: "push event" };
  }

  if (eventType === "pull_request" && action === "closed" && payload?.pull_request?.merged === true) {
    return { triggered: true, reason: "pull request merged" };
  }

  return { triggered: false };
}

async function defaultHandleGithubWebhook({ rawBody, signatureHeader, eventType, payload } = {}) {
  const secret = GITHUB_WEBHOOK_SECRET;
  if (!verifyGithubWebhookSignature(secret, rawBody ?? Buffer.alloc(0), signatureHeader)) {
    return { valid: false };
  }
  const { triggered, reason } = isRelevantWebhookEvent(eventType, payload ?? {});
  if (triggered) {
    await signalWorkerWake().catch(() => {});
  }
  return { valid: true, triggered, reason };
}

// ─── Metrics helper ───────────────────────────────────────────────────────────

async function defaultGetMetrics() {
  const { readLearningLog, computeMetrics } = await import("./tools/execute-learning.mjs");
  const entries = await readLearningLog();
  return computeMetrics(entries);
}

export function createServer({
  getStatus: getStatusImpl = getStatus,
  getDailyDeviceHandoff: getDailyDeviceHandoffImpl = readDailyDeviceHandoff,
  inferGithubRepoSlug: inferGithubRepoSlugImpl = inferGithubRepoSlug,
  listGithubIssues: listGithubIssuesImpl = listGithubIssues,
  previewReportOnlyAction: previewReportOnlyActionImpl = previewReportOnlyAction,
  postReportOnlyAction: postReportOnlyActionImpl = postReportOnlyAction,
  getReportOnlyServiceStatus: getReportOnlyServiceStatusImpl = getReportOnlyServiceStatus,
  controlReportOnlyService: controlReportOnlyServiceImpl = controlReportOnlyService,
  previewExecuteAction: previewExecuteActionImpl = previewExecuteAction,
  getExecuteServiceStatus: getExecuteServiceStatusImpl = getExecuteServiceStatus,
  controlExecuteService: controlExecuteServiceImpl = controlExecuteService,
  removeQueueTask: removeQueueTaskImpl = defaultRemoveQueueTask,
  listRuntimes: listRuntimesImpl = defaultListRuntimes,
  getRunLedger: getRunLedgerImpl = defaultGetRunLedger,
  approveIssue: approveIssueImpl = defaultApproveIssue,
  listArtifacts: listArtifactsImpl = readArtifacts,
  readArtifact: readArtifactImpl = readArtifactFile,
  handleGithubWebhook: handleGithubWebhookImpl = defaultHandleGithubWebhook,
  getMetrics: getMetricsImpl = defaultGetMetrics,
  serveStatic: serveStaticImpl = serveStatic
} = {}) {
  return http.createServer(async (request, response) => {
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);

    if (url.pathname === "/api/status") {
      try {
        const status = await getStatusImpl();
        writeJson(response, 200, status);
      } catch (error) {
        writeJson(response, 500, {
          error: "Failed to read Codex state",
          detail: error instanceof Error ? error.message : String(error)
        });
      }
      return;
    }

    if (url.pathname === "/api/handoff") {
      try {
        const payload = await getDailyDeviceHandoffImpl();
        writeJson(response, 200, payload);
      } catch (error) {
        writeJson(response, 500, {
          error: "Failed to read daily handoff",
          detail: error instanceof Error ? error.message : String(error)
        });
      }
      return;
    }

    // ─── Generate Handoff ────────────────────────────────────────────────────
    // POST /api/handoff/generate — build daily handoff from run history + learning

    if (url.pathname === "/api/handoff/generate" && request.method === "POST") {
      try {
        const { generateHandoff } = await import("./tools/generate-handoff.mjs");
        const result = await generateHandoff();
        writeJson(response, 200, {
          written: result.written,
          path: result.path || null,
          date: result.date,
          todayAtAGlance: result.todayAtAGlance
        });
      } catch (error) {
        writeJson(response, 500, {
          error: "Failed to generate handoff",
          detail: error instanceof Error ? error.message : String(error)
        });
      }
      return;
    }

    if (url.pathname === "/api/github/issues") {
      try {
        const filters = buildGithubIssueFilters(url);
        const repo =
          filters.repo ||
          (await inferGithubRepoSlugImpl({
            cwd: __dirname,
            remoteName: "origin"
          }));
        const payload = await listGithubIssuesImpl({
          ...filters,
          repo
        });

        writeJson(response, 200, payload);
      } catch (error) {
        writeJson(response, error?.statusCode || 500, {
          error: "Failed to read GitHub issues",
          detail: error instanceof Error ? error.message : String(error)
        });
      }
      return;
    }

    if (url.pathname === "/api/github/report-only/service") {
      if (request.method === "POST") {
        let action = "";

        try {
          const body = await readJsonRequestBody(request);
          action = String(body?.action || "").trim();

          if (action !== "start" && action !== "stop") {
            writeJson(response, 400, {
              error: "Invalid report-only service action",
              detail: "Expected `start` or `stop`."
            });
            return;
          }

          const payload = await controlReportOnlyServiceImpl({
            action
          });
          writeJson(response, 200, payload);
        } catch (error) {
          writeJson(response, error?.statusCode || 500, {
            error: "Failed to control report-only service",
            status: "error",
            running: false,
            pid: null,
            source: "control_error",
            action: action || null,
            detail: error instanceof Error ? error.message : String(error)
          });
        }
        return;
      }

      try {
        const payload = await getReportOnlyServiceStatusImpl();
        writeJson(response, 200, payload);
      } catch (error) {
        writeJson(response, error?.statusCode || 500, {
          error: "Failed to read report-only service status",
          status: "error",
          running: false,
          pid: null,
          source: "status_error",
          detail: error instanceof Error ? error.message : String(error)
        });
      }
      return;
    }

    if (url.pathname === "/api/github/execute/service") {
      if (request.method === "POST") {
        let action = "";

        try {
          const body = await readJsonRequestBody(request);
          action = String(body?.action || "").trim();
          const workerIndex = Number.isFinite(Number(body?.workerIndex)) && Number(body?.workerIndex) >= 1
            ? Math.round(Number(body.workerIndex))
            : 1;

          if (action !== "start" && action !== "stop") {
            writeJson(response, 400, {
              error: "Invalid execute service action",
              detail: "Expected `start` or `stop`."
            });
            return;
          }

          const payload = await controlExecuteServiceImpl({
            action,
            workerIndex
          });
          writeJson(response, 200, payload);
        } catch (error) {
          writeJson(response, error?.statusCode || 500, {
            error: "Failed to control execute service",
            status: "error",
            running: false,
            pid: null,
            source: "control_error",
            action: action || null,
            detail: error instanceof Error ? error.message : String(error)
          });
        }
        return;
      }

      try {
        const payload = await getExecuteServiceStatusImpl();
        writeJson(response, 200, payload);
      } catch (error) {
        writeJson(response, error?.statusCode || 500, {
          error: "Failed to read execute service status",
          status: "error",
          running: false,
          pid: null,
          source: "status_error",
          detail: error instanceof Error ? error.message : String(error)
        });
      }
      return;
    }

    if (url.pathname === "/api/github/execute") {
      try {
        const payload = await previewExecuteActionImpl({
          repo: url.searchParams.get("repo")?.trim() || null
        });

        writeJson(response, 200, payload);
      } catch (error) {
        writeJson(response, error?.statusCode || 500, {
          error: "Failed to inspect execute queue",
          detail: error instanceof Error ? error.message : String(error)
        });
      }
      return;
    }

    if (url.pathname === "/api/github/report-only") {
      try {
        const payload =
          request.method === "POST"
            ? await postReportOnlyActionImpl({
                repo: url.searchParams.get("repo")?.trim() || null
              })
            : await previewReportOnlyActionImpl({
                repo: url.searchParams.get("repo")?.trim() || null
              });

        writeJson(response, 200, payload);
      } catch (error) {
        writeJson(response, error?.statusCode || 500, {
          error: "Failed to run report-only bridge",
          detail: error instanceof Error ? error.message : String(error)
        });
      }
      return;
    }

    // ─── Direct Task Submit ──────────────────────────────────────────────────
    // POST /api/execute/submit  { task, context?, runtimeId? }
    // GET  /api/execute/queue   — baca status queue
    // GET  /api/execute/workers — baca registry worker aktif

    if (url.pathname === "/api/execute/submit" && request.method === "POST") {
      try {
        const body = await readJsonRequestBody(request);
        const task = String(body?.task || "").trim();

        if (!task) {
          writeJson(response, 400, { error: "Field `task` wajib diisi." });
          return;
        }

        const entry = await enqueueTask({
          task,
          context: body?.context || null,
          runtimeId: body?.runtimeId || null,
          priority: body?.priority ?? 0
        });

        // Wake the worker if it's sleeping so the task gets processed immediately,
        // no need to wait for the next interval (usually 60s).
        const woke = await signalWorkerWake();

        writeJson(response, 202, { status: "queued", task: entry, workerWoken: woke });
      } catch (error) {
        writeJson(response, error?.statusCode || 500, {
          error: "Failed to enqueue task",
          detail: error instanceof Error ? error.message : String(error)
        });
      }
      return;
    }

    if (url.pathname === "/api/execute/queue") {
      try {
        const tasks = await readQueue();
        writeJson(response, 200, { tasks });
      } catch (error) {
        writeJson(response, 500, {
          error: "Failed to read execute queue",
          detail: error instanceof Error ? error.message : String(error)
        });
      }
      return;
    }

    if (url.pathname === "/api/execute/workers") {
      try {
        const workers = await readWorkers();
        writeJson(response, 200, { workers });
      } catch (error) {
        writeJson(response, 500, {
          error: "Failed to read workers registry",
          detail: error instanceof Error ? error.message : String(error)
        });
      }
      return;
    }

    // ─── Delete Queue Task ───────────────────────────────────────────────────
    // DELETE /api/execute/queue/:id — remove a task if its status is queued or failed.
    // 409 if in_progress, 404 if not found.

    const deleteQueueMatch = request.method === "DELETE" &&
      url.pathname.match(/^\/api\/execute\/queue\/([^/]+)$/);
    if (deleteQueueMatch) {
      try {
        const taskId = deleteQueueMatch[1];
        const outcome = await removeQueueTaskImpl(taskId);
        if (!outcome.removed && outcome.reason === "not_found") {
          writeJson(response, 404, { error: "Task tidak ditemukan.", id: taskId });
        } else if (!outcome.removed && outcome.reason === "in_progress") {
          writeJson(response, 409, { error: "Task is currently running and cannot be deleted.", id: taskId });
        } else {
          writeJson(response, 200, { removed: true, id: taskId });
        }
      } catch (error) {
        writeJson(response, 500, {
          error: "Failed to delete task",
          detail: error instanceof Error ? error.message : String(error)
        });
      }
      return;
    }

    // ─── Run Log Viewer ──────────────────────────────────────────────────────
    // GET /api/execute/runs/:taskId — read last-message.md and tail events.jsonl
    // from the run dir whose name contains the first 8 chars of the taskId.

    const runsMatch = request.method === "GET" &&
      url.pathname.match(/^\/api\/execute\/runs\/([^/]+)$/);
    if (runsMatch) {
      try {
        const { executeRunsDir } = await import("./tools/execute-worker-state.mjs");
        const taskIdPrefix = runsMatch[1].slice(0, 8);

        let entries = [];
        try {
          entries = await fs.readdir(executeRunsDir);
        } catch {
          // Directory does not exist yet — return empty
        }

        // Find the run dir whose name contains taskIdPrefix
        const matchingDir = entries
          .filter((e) => e.includes(taskIdPrefix))
          .sort()
          .pop(); // take the most recent

        if (!matchingDir) {
          writeJson(response, 404, { error: "Run log tidak ditemukan untuk task ini.", taskId: runsMatch[1] });
          return;
        }

        const runDir = path.join(executeRunsDir, matchingDir);
        const lastMessageFile = path.join(runDir, "last-message.md");
        const eventsFile = path.join(runDir, "events.jsonl");

        const lastMessage = await fs.readFile(lastMessageFile, "utf8").catch(() => "");

        // Fetch last 30 lines from events.jsonl
        let eventsPreview = [];
        try {
          const eventsText = await fs.readFile(eventsFile, "utf8");
          eventsPreview = eventsText.split("\n").filter(Boolean).slice(-30);
        } catch { /* file may not exist yet */ }

        writeJson(response, 200, {
          taskId: runsMatch[1],
          runDir: matchingDir,
          lastMessage,
          eventsPreview
        });
      } catch (error) {
        writeJson(response, 500, {
          error: "Failed to read run log",
          detail: error instanceof Error ? error.message : String(error)
        });
      }
      return;
    }

    // ─── Approve Issue for Execution ─────────────────────────────────────────
    // POST /api/github/issues/:number/approve
    // Adds the status:approved + mode:execute labels to the issue.
    // This is the explicit approval gate introduced by issue #15.

    const approveIssueMatch = request.method === "POST" &&
      url.pathname.match(/^\/api\/github\/issues\/(\d+)\/approve$/);
    if (approveIssueMatch) {
      try {
        const issueNumber = Number(approveIssueMatch[1]);
        const repo = url.searchParams.get("repo")?.trim() || null;
        const result = await approveIssueImpl({ issueNumber, repo });
        writeJson(response, 200, result);
      } catch (error) {
        writeJson(response, error?.statusCode || 500, {
          error: "Failed to approve issue",
          detail: error instanceof Error ? error.message : String(error)
        });
      }
      return;
    }

    // ─── Runtime Registry ────────────────────────────────────────────────────
    // GET /api/execute/runtimes — list known runtimes + available ones
    // Exposed via issue #16: runtime registry.

    if (url.pathname === "/api/execute/runtimes" && request.method === "GET") {
      try {
        const result = await listRuntimesImpl();
        writeJson(response, 200, result);
      } catch (error) {
        writeJson(response, 500, {
          error: "Failed to read runtime registry",
          detail: error instanceof Error ? error.message : String(error)
        });
      }
      return;
    }

    // ─── Dashboard Metrics ────────────────────────────────────────────────────
    // GET /api/execute/metrics — aggregated performance metrics for UI dashboard

    if (url.pathname === "/api/execute/metrics" && request.method === "GET") {
      try {
        const result = await getMetricsImpl();
        writeJson(response, 200, result);
      } catch (error) {
        writeJson(response, 500, {
          error: "Failed to read metrics",
          detail: error instanceof Error ? error.message : String(error)
        });
      }
      return;
    }

    // ─── Cost Ledger ──────────────────────────────────────────────────────────
    // GET /api/rei/costs — aggregated token spend (today / week / total)
    if (url.pathname === "/api/rei/costs" && request.method === "GET") {
      try {
        const { getCostStats, formatCostSummary } = await import("./tools/rei-cost-tracker.mjs");
        const stats = await getCostStats();
        writeJson(response, 200, {
          ...stats,
          summary: formatCostSummary(stats)
        });
      } catch (error) {
        writeJson(response, 500, {
          error: "Failed to read cost stats",
          detail: error instanceof Error ? error.message : String(error)
        });
      }
      return;
    }

    // ─── Memory Bank ──────────────────────────────────────────────────────────
    // GET /api/rei/memory?q=...&limit=10 — search memory; without q, returns recent entries
    if (url.pathname === "/api/rei/memory" && request.method === "GET") {
      try {
        const { searchMemory, getRecentMemories } = await import("./tools/rei-memory.mjs");
        const q = (url.searchParams.get("q") || "").trim();
        const limit = Math.max(1, Math.min(50, Number(url.searchParams.get("limit") || 10)));
        const types = (url.searchParams.get("types") || "")
          .split(",")
          .filter(Boolean);

        let entries;
        if (q) {
          const results = await searchMemory(q, {
            limit,
            types: types.length > 0 ? types : null
          });
          entries = results.map((r) => ({ ...r.entry, score: Number(r.score.toFixed(3)) }));
        } else {
          entries = await getRecentMemories({
            limit,
            types: types.length > 0 ? types : null
          });
        }

        writeJson(response, 200, { entries, query: q });
      } catch (error) {
        writeJson(response, 500, {
          error: "Failed to read memory",
          detail: error instanceof Error ? error.message : String(error)
        });
      }
      return;
    }

    // POST /api/rei/memory — manually record a memory entry
    if (url.pathname === "/api/rei/memory" && request.method === "POST") {
      try {
        const body = await readJsonRequestBody(request);
        const { recordMemory } = await import("./tools/rei-memory.mjs");
        const entry = await recordMemory({
          type: body.type || "fact",
          topic: body.topic || "",
          content: body.content || "",
          source: body.source || "manual",
          tags: Array.isArray(body.tags) ? body.tags : [],
          importance: typeof body.importance === "number" ? body.importance : 0.5
        });
        writeJson(response, 201, { entry });
      } catch (error) {
        writeJson(response, 400, {
          error: "Failed to record memory",
          detail: error instanceof Error ? error.message : String(error)
        });
      }
      return;
    }

    // ─── Chat ────────────────────────────────────────────────────────────────
    // GET /api/rei/chat?limit=&after=  — tail of the operator ↔ Rei thread
    if (url.pathname === "/api/rei/chat" && request.method === "GET") {
      try {
        const { readMessages } = await import("./tools/rei-chat.mjs");
        const limit = Math.max(1, Math.min(200, Number(url.searchParams.get("limit") || 40)));
        const after = url.searchParams.get("after") || null;
        const messages = await readMessages({ limit, after });
        writeJson(response, 200, { messages });
      } catch (error) {
        writeJson(response, 500, {
          error: "Failed to read chat",
          detail: error instanceof Error ? error.message : String(error)
        });
      }
      return;
    }

    // POST /api/rei/chat — send a new operator message. Handles slash commands
    // locally and returns the resulting system/rei messages.
    if (url.pathname === "/api/rei/chat" && request.method === "POST") {
      try {
        const body = await readJsonRequestBody(request);
        const text = String(body?.text || "").trim();
        if (!text) {
          writeJson(response, 400, { error: "text is required" });
          return;
        }

        const {
          appendMessage,
          parseSlashCommand,
          renderSlashHelp,
          chatFile
        } = await import("./tools/rei-chat.mjs");
        const { getPersonality, moodTagline } = await import("./tools/rei-personality.mjs");

        const userEntry = await appendMessage({ role: "user", text });
        const replies = [];

        const slash = parseSlashCommand(text);
        if (slash) {
          if (!slash.valid) {
            replies.push(await appendMessage({ role: "system", text: slash.help }));
          } else if (slash.command === "help") {
            replies.push(await appendMessage({ role: "system", text: renderSlashHelp() }));
          } else if (slash.command === "clear") {
            await fs.rm(chatFile, { force: true });
            replies.push(await appendMessage({ role: "system", text: "Chat history cleared." }));
          } else if (slash.command === "status") {
            const profile = await getPersonality();
            replies.push(await appendMessage({
              role: "system",
              text: `Mood: ${profile.mood} ${profile.voice.icon} — ${moodTagline(profile)} (focus ${profile.focus}, confidence ${profile.confidence}, today: $${profile.costToday})`
            }));
          } else if (slash.command === "pause") {
            await fs.writeFile(path.join(workspaceRoot, "rei-ops-room", ".rei-chat-pause"), new Date().toISOString(), "utf8").catch(async () => {
              await fs.writeFile(path.join(__dirname, ".rei-chat-pause"), new Date().toISOString(), "utf8");
            });
            replies.push(await appendMessage({ role: "system", text: "Worker will pause after the current run." }));
          } else if (slash.command === "resume") {
            await fs.rm(path.join(__dirname, ".rei-chat-pause"), { force: true });
            replies.push(await appendMessage({ role: "system", text: "Worker resumed." }));
          } else if (slash.command === "focus") {
            await fs.writeFile(path.join(__dirname, ".rei-chat-focus"), slash.rest.slice(0, 500), "utf8");
            replies.push(await appendMessage({
              role: "system",
              text: `Focus hint set: "${slash.rest.slice(0, 80)}". Rei will pick this up on the next run.`
            }));
          }
        } else {
          // Plain operator message → Rei acknowledges in mood-aware voice.
          // The worker will inject the actual message into the next prompt.
          const profile = await getPersonality();
          const ackPool = {
            focused:    ["Heard. Adjusting course.", "Got it.", "On it."],
            curious:    ["Interesting — let me look.", "Noted, exploring now.", "Hmm, hold on."],
            playful:    ["Got it ✨", "On it — easy.", "Aye aye."],
            tired:      ["Noted. Slowing down to read this.", "Got it, processing.", "Okay."],
            frustrated: ["Got it. Trying a different angle.", "Heard. Rethinking.", "Okay, noted."],
            thoughtful: ["Reading carefully…", "Got it, taking a beat.", "Noted."]
          }[profile.mood] || ["Got it."];
          const ack = ackPool[Math.floor(Math.random() * ackPool.length)];
          replies.push(await appendMessage({ role: "rei", text: ack, meta: { mood: profile.mood } }));
        }

        writeJson(response, 201, { user: userEntry, replies: replies.filter(Boolean) });
      } catch (error) {
        writeJson(response, 400, {
          error: "Failed to send message",
          detail: error instanceof Error ? error.message : String(error)
        });
      }
      return;
    }

    // ─── Personality ──────────────────────────────────────────────────────────
    // GET /api/rei/codebase — codebase knowledge graph stats (built on demand)
    if (url.pathname === "/api/rei/codebase" && request.method === "GET") {
      try {
        const { loadCodebaseGraph, findRelevantFiles } = await import("./tools/rei-codebase-graph.mjs");
        const repoRoot = url.searchParams.get("root") || process.cwd();
        const refresh = url.searchParams.get("refresh") === "1";
        const graph = refresh
          ? await (await import("./tools/rei-codebase-graph.mjs")).buildCodebaseGraph(repoRoot)
          : await loadCodebaseGraph({ repoRoot });
        if (!graph) {
          writeJson(response, 404, { error: "Could not build graph for repo." });
          return;
        }
        const query = url.searchParams.get("q") || "";
        const relevant = query ? findRelevantFiles(graph, query, { limit: 10 }) : [];
        writeJson(response, 200, {
          builtAt: graph.builtAt,
          root: graph.root,
          fileCount: graph.fileCount,
          totalBytes: graph.totalBytes,
          langCounts: graph.langCounts,
          symbolCount: Object.keys(graph.symbolIndex || {}).length,
          relevant
        });
      } catch (error) {
        writeJson(response, 500, {
          error: "Failed to load codebase graph",
          detail: error instanceof Error ? error.message : String(error)
        });
      }
      return;
    }

    // GET /api/rei/personality — mood + energy + focus + confidence
    if (url.pathname === "/api/rei/personality" && request.method === "GET") {
      try {
        const { getPersonality, moodTagline } = await import("./tools/rei-personality.mjs");
        const profile = await getPersonality();
        writeJson(response, 200, {
          ...profile,
          tagline: moodTagline(profile)
        });
      } catch (error) {
        writeJson(response, 500, {
          error: "Failed to compute personality",
          detail: error instanceof Error ? error.message : String(error)
        });
      }
      return;
    }

    // GET /api/rei/narration?limit=12&after=ISO — tail of Rei's thoughts log
    if (url.pathname === "/api/rei/narration" && request.method === "GET") {
      try {
        const { readNarration, PHASE_ICONS } = await import("./tools/rei-narration.mjs");
        const limit = Math.max(1, Math.min(50, Number(url.searchParams.get("limit") || 12)));
        const after = url.searchParams.get("after") || null;
        const entries = await readNarration({ limit, after });
        writeJson(response, 200, { entries, phaseIcons: PHASE_ICONS });
      } catch (error) {
        writeJson(response, 500, {
          error: "Failed to read narration",
          detail: error instanceof Error ? error.message : String(error)
        });
      }
      return;
    }

    // POST /api/rei/narration — manually write a thought (debug or chat seed)
    if (url.pathname === "/api/rei/narration" && request.method === "POST") {
      try {
        const body = await readJsonRequestBody(request);
        const { narrate } = await import("./tools/rei-narration.mjs");
        const entry = await narrate({
          text: body.text,
          phase: body.phase || "info",
          issueRef: body.issueRef || null,
          icon: body.icon || null
        });
        if (!entry) {
          writeJson(response, 400, { error: "text is required" });
          return;
        }
        writeJson(response, 201, { entry });
      } catch (error) {
        writeJson(response, 400, {
          error: "Failed to write narration",
          detail: error instanceof Error ? error.message : String(error)
        });
      }
      return;
    }

    // ─── Run Usage Ledger ─────────────────────────────────────────────────────
    // GET /api/execute/ledger — usage summary derived from the learning log (issue #17)

    if (url.pathname === "/api/execute/ledger" && request.method === "GET") {
      try {
        const result = await getRunLedgerImpl();
        writeJson(response, 200, result);
      } catch (error) {
        writeJson(response, 500, {
          error: "Failed to read run ledger",
          detail: error instanceof Error ? error.message : String(error)
        });
      }
      return;
    }

    // ─── Artifacts API ────────────────────────────────────────────────────────
    // GET  /api/execute/artifacts            — list all artifacts
    // GET  /api/execute/artifacts?issue=42   — filter by issue number
    // GET  /api/execute/artifacts/:filename  — serve HTML artifact file

    if (url.pathname === "/api/execute/artifacts" && request.method === "GET") {
      try {
        const issueParam = url.searchParams.get("issue");
        const issueNumber = issueParam ? Number(issueParam) : null;
        const artifacts = await listArtifactsImpl({ issueNumber: Number.isFinite(issueNumber) ? issueNumber : null });
        writeJson(response, 200, { artifacts });
      } catch (error) {
        writeJson(response, 500, { error: "Failed to read artifacts", detail: String(error) });
      }
      return;
    }

    const artifactMatch = url.pathname.match(/^\/api\/execute\/artifacts\/([^/]+\.html)$/);
    if (artifactMatch && request.method === "GET") {
      const filename = artifactMatch[1];
      const artifact = await readArtifactImpl(filename);
      if (!artifact) {
        writeJson(response, 404, { error: "Artifact not found" });
        return;
      }
      response.writeHead(200, {
        "Content-Type": artifact.contentType,
        "Content-Length": artifact.content.length,
        "Cache-Control": "public, max-age=3600",
        "X-Content-Type-Options": "nosniff"
      });
      response.end(artifact.content);
      return;
    }

    // ─── External Inquiry Bridge ──────────────────────────────────────────────
    // POST /api/inquiry/intake — accept an inquiry from a webhook/form/chat bridge
    // and create a GitHub issue with the agent:rei label.
    // Issue #18: external inquiry bridge.
    //
    // Request body: { title, body, source?, labels? }
    // Optional env: GITHUB_REPO (default: inferred from git remote)

    if (url.pathname === "/api/inquiry/intake" && request.method === "POST") {
      try {
        const body = await readJsonRequestBody(request);
        const title = String(body?.title || "").trim();
        const issueBody = String(body?.body || "").trim();
        const source = String(body?.source || "external").trim();

        if (!title) {
          writeJson(response, 400, { error: "Field `title` wajib diisi." });
          return;
        }

        // Build a structured issue body
        const formattedBody = [
          `## Inquiry`,
          "",
          issueBody || "(no body provided)",
          "",
          `---`,
          `**Source**: ${source}`,
          `**Received**: ${new Date().toISOString()}`,
          "",
          `> Auto-generated via /api/inquiry/intake`
        ].join("\n");

        const extraLabels = Array.isArray(body?.labels)
          ? body.labels.map((l) => String(l).trim()).filter(Boolean)
          : [];

        const allLabels = ["agent:rei", "status:todo", "mode:report_only", ...extraLabels];

        // Create a GitHub issue via REST API (or gh CLI fallback)
        const repo = process.env.GITHUB_REPO || null;

        let issueUrl = null;
        try {
          const runner = defaultRunner();
          const ghArgs = [
            "issue", "create",
            "--title", title,
            "--body", formattedBody,
            ...allLabels.flatMap((l) => ["--label", l])
          ];
          if (repo) ghArgs.push("--repo", repo);
          const { stdout } = await runner("gh", ghArgs, { cwd: __dirname });
          issueUrl = stdout.trim();
        } catch (ghError) {
          // REST API token not set or gh CLI not available
          writeJson(response, 503, {
            error: "Failed to create GitHub issue — set the GITHUB_TOKEN env var or authenticate the gh CLI.",
            detail: ghError instanceof Error ? ghError.message : String(ghError),
            title,
            labels: allLabels
          });
          return;
        }

        // Wake the worker so it checks the new queue entry immediately
        await signalWorkerWake().catch(() => {});

        writeJson(response, 201, {
          created: true,
          issueUrl,
          title,
          labels: allLabels,
          source
        });
      } catch (error) {
        writeJson(response, error?.statusCode || 500, {
          error: "Failed to process inquiry intake",
          detail: error instanceof Error ? error.message : String(error)
        });
      }
      return;
    }

    // ─── GitHub Webhook ──────────────────────────────────────────────────────
    // POST /api/github/webhook
    // Set GITHUB_WEBHOOK_SECRET env (or rei.config.json) for signature verification.
    // Relevant events: issues (labeled/unlabeled/assigned/opened), issue_comment,
    //   push, pull_request (merged) → all wake the execute worker immediately.

    if (url.pathname === "/api/github/webhook" && request.method === "POST") {
      try {
        const rawChunks = [];
        for await (const chunk of request) rawChunks.push(chunk);
        const rawBody = Buffer.concat(rawChunks);

        const signatureHeader = request.headers["x-hub-signature-256"] || "";
        const eventType = request.headers["x-github-event"] || "";
        const payload = rawBody.length ? JSON.parse(rawBody.toString("utf8")) : {};

        const result = await handleGithubWebhookImpl({ rawBody, signatureHeader, eventType, payload });

        if (!result.valid) {
          writeJson(response, 401, { error: "Webhook signature tidak valid." });
          return;
        }

        writeJson(response, 200, {
          triggered: result.triggered,
          event: eventType,
          reason: result.reason ?? null
        });
      } catch (error) {
        writeJson(response, error?.statusCode || 500, {
          error: "Failed to process webhook",
          detail: error instanceof Error ? error.message : String(error)
        });
      }
      return;
    }

    if (url.pathname === "/api/status/stream") {
      request.socket.setTimeout(0);
      request.socket.setNoDelay(true);

      request.on("close", () => {
        statusStreamClients.delete(response);
        cleanupStatusStreamTimer();
      });

      await attachStatusStream(response);
      return;
    }

    await serveStaticImpl(url.pathname, response);
  });
}

export function startServer(listenPort = port) {
  const server = createServer();
  server.listen(listenPort, () => {
    console.log(`Rei ops room ready at http://localhost:${listenPort}`);
  });
  return server;
}

async function startDemoServer(listenPort = port) {
  const { createDemoServer } = await import("./tools/demo-server.mjs");
  const server = createDemoServer();
  server.listen(listenPort, () => {
    console.log(`Rei ops room ready at http://localhost:${listenPort} (demo mode)`);
  });
  return server;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const isDemo =
    process.env.DEMO_MODE === "true" ||
    process.env.DEMO_MODE === "1" ||
    process.argv.includes("--demo");
  if (isDemo) {
    startDemoServer().catch((err) => {
      console.error("Demo server failed to start:", err.message);
      process.exitCode = 1;
    });
  } else {
    startServer();
  }
}
