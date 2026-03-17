import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildRoomState } from "./public/room-state.js";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");
const workspaceRoot = process.env.WORKSPACE_ROOT || path.resolve(__dirname, "..");
const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
const stateDb = process.env.CODEX_STATE_DB || path.join(codexHome, "state_5.sqlite");
const logsDb = process.env.CODEX_LOGS_DB || path.join(codexHome, "logs_1.sqlite");
const port = Number(process.env.PORT || 4317);
export const SQLITE_JSON_MAX_BUFFER = 8 * 1024 * 1024;
const FOCUS_PROFILES = [
  {
    zone: "frontend",
    title: "Frontend Desk",
    detail: "UI, layout, atau interaksi lagi dominan.",
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
      "form",
      "screen"
    ]
  },
  {
    zone: "backend",
    title: "Backend Rack",
    detail: "Logic, API, atau server-side flow lagi diproses.",
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
    detail: "Schema, migration, atau data layer yang lagi diutak-atik.",
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
    detail: "Review, issue, docs, atau deployment lagi aktif.",
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
  "unhandled responses event:"
];
const NOISE_MESSAGE_SNIPPETS = [
  "registering event source with poller",
  "token usage",
  "tool gate released",
  "waiting for tool gate"
];

function quoteSql(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

export function buildThreadLogsSql(threadId, limit = 500, messageLimit = 320) {
  return `
      SELECT
        ts,
        level,
        target,
        substr(message, 1, ${messageLimit}) AS message
      FROM logs
      WHERE thread_id = ${quoteSql(threadId)}
      ORDER BY ts DESC, ts_nanos DESC, id DESC
      LIMIT ${limit};
    `;
}

export async function sqliteJsonWithRunner(runner, databasePath, sql) {
  const { stdout } = await runner("sqlite3", ["-json", databasePath, sql], {
    maxBuffer: SQLITE_JSON_MAX_BUFFER
  });
  const text = stdout.trim();
  return text ? JSON.parse(text) : [];
}

async function sqliteJson(databasePath, sql) {
  return sqliteJsonWithRunner(execFileAsync, databasePath, sql);
}

function toIso(seconds) {
  return seconds ? new Date(seconds * 1000).toISOString() : null;
}

function stripWorkspacePrefix(cwd) {
  if (!cwd) {
    return "";
  }

  if (cwd === workspaceRoot) {
    return "workspace root";
  }

  if (cwd.startsWith(`${workspaceRoot}/`)) {
    return cwd.slice(workspaceRoot.length + 1);
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

  const days = Math.floor(hours / 24);
  return `${days} hari lalu`;
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
    if (!message) {
      return false;
    }

    if (message === "Output item" || message === "Input item") {
      return false;
    }

    if (NOISE_MESSAGE_PREFIXES.some((prefix) => message.startsWith(prefix))) {
      return false;
    }

    if (NOISE_MESSAGE_SNIPPETS.some((snippet) => message.includes(snippet))) {
      return false;
    }

    const command = extractCommand(log.message);
    if (command && isObserverCommand(command)) {
      return false;
    }

    const toolName = extractToolName(log.message);
    if (toolName && isObserverTool(toolName)) {
      return false;
    }

    return true;
  });
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
      reason: "Belum ada sinyal kuat; squad lagi standby umum di ruang tengah.",
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
          ? `Masih fase ngobrol / nyusun arah dari: ${meetingHits.slice(0, 3).join(", ")}.`
          : "Belum ada fokus kuat, jadi squad kumpul dulu di meja tengah."
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

  const [latestThreadRow] = await sqliteJson(stateDb, latestThreadSql);
  const [latestRepoRow] = await sqliteJson(stateDb, latestRepoSql);
  const recentRows = await sqliteJson(stateDb, recentThreadsSql);
  const latestThread = mapThread(latestThreadRow, nowSeconds);
  const latestRepo = mapThread(latestRepoRow, nowSeconds);

  let activity = {
    summary: latestThread?.title || "Standby di thread aktif",
    source: "thread",
    kind: "thread"
  };
  let lastLogAt = latestThread?.updatedAt || 0;
  let threadLogs = [];

  if (latestThread?.id) {
    const logSql = buildThreadLogsSql(latestThread.id);

    threadLogs = await sqliteJson(logsDb, logSql);
    const meaningfulLogs = filterMeaningfulLogs(threadLogs);
    if (meaningfulLogs.length > 0) {
      lastLogAt = Number(meaningfulLogs[0].ts || lastLogAt);
      activity = summarizeActivity(meaningfulLogs);
      threadLogs = meaningfulLogs;
    }
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
    logs: threadLogs
  });

  return {
    generatedAt: new Date().toISOString(),
    workspaceRoot,
    ...roomState
  };
}

function contentType(filePath) {
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

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);

  if (url.pathname === "/api/status") {
    try {
      const status = await getStatus();
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify(status, null, 2));
    } catch (error) {
      response.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
      response.end(
        JSON.stringify(
          {
            error: "Failed to read Codex state",
            detail: error instanceof Error ? error.message : String(error)
          },
          null,
          2
        )
      );
    }
    return;
  }

  await serveStatic(url.pathname, response);
});

export function startServer(listenPort = port) {
  server.listen(listenPort, () => {
    console.log(`Pixel agent viewer ready at http://localhost:${listenPort}`);
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startServer();
}
