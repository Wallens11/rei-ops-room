import crypto from "node:crypto";
import { execFile, spawn } from "node:child_process";
import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  buildExecuteCompletionComment,
  buildExecuteStartComment,
  postExecuteIssueComment,
  prepareExecuteAction,
  transitionExecuteIssueToBlocked,
  transitionExecuteIssueToDone,
  transitionExecuteIssueToInProgress
} from "./execute-bridge.mjs";
import {
  clearExecuteWorkerState,
  executeRunsDir,
  projectRoot,
  writeExecuteWorkerState
} from "./execute-worker-state.mjs";
import {
  checkAndClearWakeTrigger,
  claimNextQueuedTask,
  readQueue,
  registerWorker,
  requeueForRetry,
  requeueStuckTask,
  resolveQueueTask,
  unregisterWorker,
  updateWorkerActivity
} from "./execute-queue.mjs";
import { getLearningEntries, recordRunInsight } from "./execute-learning.mjs";
import { extractMemoryFromRun } from "./rei-memory.mjs";
import { parseTokenUsage, recordRunCost } from "./rei-cost-tracker.mjs";
import {
  findChangedProtectedPaths,
  formatSelfReview,
  runSelfReview,
  snapshotProtectedPaths
} from "./rei-self-review.mjs";
import { narrate } from "./rei-narration.mjs";
import { notifyRun } from "./rei-webhooks.mjs";
import { clearSessionPin, readSessionPin, writeSessionPin } from "./execute-sessions.mjs";
import { injectSkills } from "./inject-skills.mjs";
import { scanRunArtifacts } from "./execute-artifacts.mjs";
import {
  buildRuntimeStartupSummary,
  getRuntime,
  loadRuntimePreferences,
  probeAvailableRuntimes,
  resolveRuntimeOrder,
  selectRuntimeAdaptive
} from "./runtimes/index.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_INTERVAL_SECONDS = 60;
const MIN_INTERVAL_SECONDS = 30;
const STUCK_TASK_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes
const EXECUTE_TIMEOUT_MS = Number(process.env.EXECUTE_TIMEOUT_MS ?? 10 * 60 * 1000); // 10 minute default
const DEFAULT_CODEX_CANDIDATES = ["/Applications/Codex.app/Contents/Resources/codex"];
const execFileAsync = promisify(execFile);
const EXECUTE_RUNTIME_PATH_PREFIXES = [
  ".execute-runs/",
  ".execute-worker.log",
  ".execute-worker.pid",
  ".execute-worker.state.json",
  ".execute-worker-state.json"
];
const RATE_LIMIT_ERROR_PATTERN = /(rate[\s_-]*limit|overloaded|\b529\b|quota exceeded)/i;

function timestamp() {
  return new Date().toISOString();
}

function normalizeTargetNumber(target) {
  return Number(target?.number || 0) || 0;
}

function parseArgs(argv) {
  const args = [...argv];
  let repo = null;
  let once = false;
  let intervalSeconds = DEFAULT_INTERVAL_SECONDS;

  while (args.length > 0) {
    const current = args.shift();

    if (current === "--repo") {
      repo = args.shift() || null;
      continue;
    }

    if (current === "--once") {
      once = true;
      continue;
    }

    if (current === "--interval-seconds") {
      intervalSeconds = Number(args.shift() || DEFAULT_INTERVAL_SECONDS);
    }
  }

  return {
    repo,
    once,
    intervalMs: Math.max(intervalSeconds || DEFAULT_INTERVAL_SECONDS, MIN_INTERVAL_SECONDS) * 1000
  };
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function createRunDirName(issue) {
  return `${String(issue.number).padStart(4, "0")}-${slugify(issue.title) || "execute"}-${Date.now()}`;
}

async function readTextIfExists(filePath) {
  if (!filePath) return "";
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      return "";
    }

    throw error;
  }
}

// ─── Wake-up state (SIGUSR1 fast-path, Unix only) ────────────────────────────
// wakeResolve is set by sleepWithSignal and called by the SIGUSR1 handler.
// On Windows, SIGUSR1 is not available — the trigger file is used instead.

let wakeResolve = null;

process.on("SIGUSR1", () => {
  if (wakeResolve) {
    wakeResolve();
    wakeResolve = null;
  }
});

/**
 * Sleep for `ms` milliseconds, but can be interrupted early via:
 *   1. Trigger file (.execute-wake.trigger) — cross-platform, polled every 2s.
 *   2. SIGUSR1 — fast-path on Unix (Mac/Linux). Ignored on Windows.
 *   3. AbortSignal — for graceful shutdown.
 */
async function sleepWithSignal(ms, signal) {
  if (ms <= 0) return;

  const POLL_MS = 2_000;
  let remaining = ms;

  while (remaining > 0) {
    if (signal?.aborted) {
      const err = new Error("Worker aborted");
      err.name = "AbortError";
      throw err;
    }

    // Cross-platform: check trigger file before waiting for the next chunk
    const triggered = await checkAndClearWakeTrigger().catch(() => false);
    if (triggered) return;

    const chunk = Math.min(POLL_MS, remaining);
    let woken = false;

    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (wakeResolve === resolver) wakeResolve = null;
        resolve();
      }, chunk);

      function resolver() {
        clearTimeout(timer);
        if (wakeResolve === resolver) wakeResolve = null;
        signal?.removeEventListener?.("abort", onAbort);
        woken = true;
        resolve();
      }

      function onAbort() {
        clearTimeout(timer);
        if (wakeResolve === resolver) wakeResolve = null;
        signal?.removeEventListener?.("abort", onAbort);
        const err = new Error("Worker aborted");
        err.name = "AbortError";
        reject(err);
      }

      // SIGUSR1 fast-path (Unix) — call resolver to skip this chunk
      wakeResolve = resolver;
      signal?.addEventListener?.("abort", onAbort, { once: true });
    });

    if (woken) return;
    remaining -= chunk;
  }
}

async function fileExists(candidate) {
  try {
    await fs.access(candidate);
    return true;
  } catch {
    return false;
  }
}

export async function resolveCodexCommand({
  env = process.env,
  fileExists: fileExistsImpl = fileExists,
  fallback = "codex"
} = {}) {
  const configured = String(env?.CODEX_BIN || "").trim();
  if (configured) {
    return configured;
  }

  for (const candidate of DEFAULT_CODEX_CANDIDATES) {
    if (await fileExistsImpl(candidate)) {
      return candidate;
    }
  }

  return fallback;
}

export function buildCodexExecInvocation({
  codexCommand,
  repoCwd,
  outputLastMessageFile
} = {}) {
  return {
    command: codexCommand,
    args: [
      "-a",
      "never",
      "-s",
      "workspace-write",
      "exec",
      "-C",
      repoCwd,
      "--json",
      "--output-last-message",
      outputLastMessageFile,
      "-"
    ]
  };
}

export function parseGitStatusPaths(statusText = "") {
  return String(statusText)
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => {
      const candidate = line.slice(3).trim();
      if (!candidate) {
        return null;
      }

      const renameIndex = candidate.indexOf(" -> ");
      return renameIndex >= 0 ? candidate.slice(renameIndex + 4) : candidate;
    })
    .filter(Boolean);
}

export function isMeaningfulWorktreePath(filePath = "") {
  return Boolean(filePath) && !EXECUTE_RUNTIME_PATH_PREFIXES.some((prefix) => filePath.startsWith(prefix));
}

export async function listMeaningfulWorktreePaths({
  cwd = projectRoot,
  runner = execFileAsync
} = {}) {
  const { stdout = "" } = await runner("git", ["status", "--short", "--untracked-files=all"], {
    cwd
  });

  return parseGitStatusPaths(stdout).filter(isMeaningfulWorktreePath);
}

export function findNewMeaningfulWorktreeChanges({
  beforePaths = [],
  afterPaths = []
} = {}) {
  const beforeSet = new Set(beforePaths.filter(isMeaningfulWorktreePath));

  return afterPaths.filter((filePath) => isMeaningfulWorktreePath(filePath) && !beforeSet.has(filePath));
}

export function classifyExecuteMissionResult({
  mission = {},
  newChanges = []
} = {}) {
  if (mission.aborted) {
    return "aborted";
  }

  if (Number(mission.exitCode || 0) !== 0) {
    return "failed";
  }

  return newChanges.length > 0 ? "completed" : "review_needed";
}

export function detectRateLimitFailure({
  exitCode = 0,
  stdoutText = "",
  stderrText = "",
  lastMessage = ""
} = {}) {
  if (Number(exitCode || 0) === 0) {
    return false;
  }

  return RATE_LIMIT_ERROR_PATTERN.test([stdoutText, stderrText, lastMessage].join("\n"));
}

/**
 * Parse JSONL output from claude-code --output-format stream-json.
 * Extract session_id and the last output text from stream events.
 *
 * Relevant event formats:
 *   {"type":"system","subtype":"init","session_id":"..."}
 *   {"type":"assistant","message":{"content":[{"type":"text","text":"..."}]}}
 *   {"type":"result","subtype":"success","session_id":"...","result":"..."}
 *
 * If a line is not valid JSON (e.g. old output format) → returned as plain text.
 */
export function parseStreamJsonOutput(text = "") {
  let sessionId = null;
  let lastText = "";
  let hasJsonLines = false;

  for (const line of String(text || "").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    try {
      const event = JSON.parse(trimmed);
      hasJsonLines = true;

      // Grab session_id from any event that has that field
      if (event.session_id && typeof event.session_id === "string") {
        sessionId = event.session_id;
      }

      // Text from assistant message blocks
      if (event.type === "assistant" && Array.isArray(event.message?.content)) {
        for (const block of event.message.content) {
          if (block.type === "text" && block.text) {
            lastText = String(block.text);
          }
        }
      }

      // result event: use the result field as a text fallback
      if (event.type === "result" && event.result && !lastText) {
        lastText = String(event.result);
      }
    } catch {
      // Not JSON — likely plain text fallback or log noise
      if (trimmed && !hasJsonLines) {
        lastText = trimmed;
      }
    }
  }

  return { sessionId, lastText: lastText.trim() };
}

async function runMission({
  runtimeId = "codex",
  repoCwd,
  prompt,
  runDir,
  signal = null,
  resumeSessionId = null,
  onChildPid = () => {}
} = {}) {
  await fs.mkdir(runDir, { recursive: true });

  const promptFile = path.join(runDir, "prompt.md");
  const outputLastMessageFile = path.join(runDir, "last-message.md");
  const eventsFile = path.join(runDir, "events.jsonl");

  await fs.writeFile(promptFile, `${prompt}\n`, "utf8");
  const runtime = getRuntime(runtimeId);
  const runtimeCommand = await runtime.resolveCommand({ env: process.env });
  const invocation = runtime.buildInvocation({
    command: runtimeCommand,
    repoCwd,
    outputLastMessageFile,
    resumeSessionId: resumeSessionId || null
  });

  return await new Promise((resolve, reject) => {
    const child = spawn(invocation.command, invocation.args, {
      cwd: invocation.cwd || projectRoot,
      env: process.env,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"]
    });
    const stream = createWriteStream(eventsFile, { flags: "a" });
    const stdoutChunks = [];
    const stderrChunks = [];
    let aborted = false;
    let finished = false;

    onChildPid(child.pid || null);

    child.stdout.on("data", (chunk) => {
      stdoutChunks.push(Buffer.from(chunk));
      stream.write(chunk);
      // outputMode "stdout": collect stdout as the last message
      if (invocation.outputMode === "stdout") {
        stdoutChunks.push(chunk);
      }
    });
    child.stderr.on("data", (chunk) => {
      stderrChunks.push(Buffer.from(chunk));
      stream.write(chunk);
    });

    child.on("error", (error) => {
      if (finished) return;
      finished = true;
      stream.end();
      reject(error);
    });

    child.on("close", async (exitCode, exitSignal) => {
      if (finished) return;
      finished = true;
      void (async () => {
        stream.end();
        const stdoutText = Buffer.concat(stdoutChunks).toString("utf8");
        const stderrText = Buffer.concat(stderrChunks).toString("utf8");

        // stream-json: parse JSONL to extract session_id and final text
        let sessionId = null;
        let derivedLastMessage = "";

        if (invocation.outputMode === "stream-json" && stdoutText) {
          const parsed = parseStreamJsonOutput(stdoutText);
          sessionId = parsed.sessionId;
          derivedLastMessage = parsed.lastText || stderrText.trim();
          // Write the parsed text to file (not raw JSONL)
          if (derivedLastMessage) {
            await fs.writeFile(outputLastMessageFile, `${derivedLastMessage}\n`, "utf8").catch(() => {});
          }
        } else {
          // outputMode "stdout" or other — read as-is
          derivedLastMessage = stdoutText.trim() || stderrText.trim();
          if (invocation.outputMode === "stdout" && stdoutText) {
            await fs.writeFile(outputLastMessageFile, stdoutText, "utf8").catch(() => {});
          }
        }

        if (derivedLastMessage) {
          try {
            await fs.access(outputLastMessageFile);
          } catch {
            await fs.writeFile(outputLastMessageFile, `${derivedLastMessage}\n`, "utf8");
          }
        }

        resolve({
          runtimeId,
          exitCode: Number.isInteger(exitCode) ? exitCode : exitSignal ? 1 : 0,
          signal: exitSignal || null,
          aborted,
          sessionId,
          outputLastMessageFile,
          eventsFile,
          stdoutText,
          stderrText,
          lastMessage: derivedLastMessage
        });
      })().catch(reject);
    });

    const abortHandler = () => {
      aborted = true;
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!finished) child.kill("SIGKILL");
      }, 1_000).unref();
    };

    if (signal?.aborted) {
      abortHandler();
    } else {
      signal?.addEventListener?.("abort", abortHandler, { once: true });
    }

    child.stdin.end(invocation.stdinInput ?? prompt ?? "");
  });
}

// Backward-compat alias — old tests and code that call runCodexMission still work.
// All new calls should use runMission({ runtimeId, ... }) directly.
async function runCodexMission({ codexCommand = null, repoCwd, prompt, runDir, signal = null, onChildPid = () => {} } = {}) {
  return runMission({ runtimeId: "codex", repoCwd, prompt, runDir, signal, onChildPid });
}

// ─── Direct task runner ──────────────────────────────────────────────────────

/**
 * Run a single direct task from execute-queue.
 * Unlike GitHub issues — no label transitions, no comments.
 * The result is stored directly in the queue entry.
 */
async function runDirectTask({
  task,
  availableRuntimes = ["codex"],
  runtimePreferences = null,
  signal = null,
  onStateChange = async () => {},
  workerId = null
} = {}) {
  const { buildDirectTaskPrompt } = await import("./execute-bridge.mjs");
  const { readDailyDeviceHandoff, readExecuteContinuity } = await import("../server.mjs");
  const { getLearningContext } = await import("./execute-learning.mjs");

  const handoff = await readDailyDeviceHandoff().catch(() => null);
  const continuity = await readExecuteContinuity().catch(() => null);
  const learningContext = await getLearningContext({ limit: 5 }).catch(() => null);
  const prompt = buildDirectTaskPrompt({
    task: task.task,
    context: task.context,
    repoCwd: projectRoot,
    handoff,
    learningContext,
    continuity
  });

  const runtimeId = task.runtimeId
    ? task.runtimeId
    : selectRuntime("general", availableRuntimes, runtimePreferences || undefined);
  const runtimeLabel = getRuntime(runtimeId).RUNTIME_LABEL;

  await fs.mkdir(executeRunsDir, { recursive: true });
  const runDir = path.join(executeRunsDir, `direct-${task.id.slice(0, 8)}-${Date.now()}`);

  await onStateChange({
    status: "launching",
    currentTarget: { number: null, title: task.task },
    currentChildPid: null,
    currentRunDir: runDir,
    detail: `Launching ${runtimeLabel} for direct task: ${task.task.slice(0, 60)}`
  });

  if (workerId) {
    await updateWorkerActivity(workerId, { taskId: task.id, runtimeId });
  }

  const mission = await runMission({
    runtimeId,
    repoCwd: projectRoot,
    prompt,
    runDir,
    signal,
    onChildPid: async (childPid) => {
      await onStateChange({
        status: "running",
        currentTarget: { number: null, title: task.task },
        currentChildPid: childPid,
        currentRunDir: runDir,
        detail: `${runtimeLabel} is running direct task.`
      });
    }
  });

  const lastMessage = await readTextIfExists(mission.outputLastMessageFile);
  const status = mission.aborted ? "failed" : mission.exitCode === 0 ? "done" : "failed";

  if (status === "failed") {
    // Retry with backoff — if maxRetries is exhausted, requeueForRetry
    // will automatically mark the task as "failed".
    await requeueForRetry(task.id, { result: lastMessage || null });
  } else {
    await resolveQueueTask(task.id, { status: "done", result: lastMessage || null });
  }

  // Record to learning log
  await recordRunInsight({
    issueNumber: null,
    taskTitle: task.task,
    runtimeId,
    profileId: "general", // direct tasks are always general — no issue context to infer a profile
    outcome: status,
    filesChanged: [],
    lastMessage
  }).catch(() => {});

  // Extract durable memory from agent output
  await extractMemoryFromRun({
    lastMessage,
    outcome: status === "done" ? "completed" : "failed",
    issueNumber: null,
    changedFiles: []
  }).catch(() => {});

  // Record run cost (parse token usage from stdout+stderr)
  const usage = parseTokenUsage(`${mission.stdoutText || ""}\n${mission.stderrText || ""}`);
  if (usage) {
    await recordRunCost({
      runtimeId,
      issueNumber: null,
      profileId: "general",
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      model: usage.model,
      outcome: status === "done" ? "completed" : "failed"
    }).catch(() => {});
  }

  if (workerId) {
    await updateWorkerActivity(workerId, { taskId: null, runtimeId: null });
  }

  return {
    status,
    target: { number: null, title: task.task },
    detail: `Direct task ${status}: ${task.task.slice(0, 60)}`,
    runDir
  };
}

export function createExecuteWorkerResultSignature(result = {}) {
  return `${result.status || "unknown"}:${normalizeTargetNumber(result.target)}`;
}

export function formatExecuteWorkerResultLine(result = {}) {
  const issueNumber = normalizeTargetNumber(result.target);
  const issueTitle = result?.target?.title ? ` ${result.target.title}` : "";
  const issueLabel = issueNumber > 0 ? ` #${issueNumber}${issueTitle}` : "";
  const detail = result.detail || "No detail provided.";

  return `[${timestamp()}] execute worker ${result.status || "unknown"}${issueLabel} | ${detail}`;
}

export async function executeNextIssue({
  cwd = projectRoot,
  repo = null,
  signal = null,
  codexCommand = "codex", // backward-compat — ignored if availableRuntimes is provided
  availableRuntimes = null, // null = fall back to codex only
  runner = undefined,
  onStateChange = async () => {},
  previewAction = prepareExecuteAction,
  transitionIssueToInProgress = transitionExecuteIssueToInProgress,
  transitionIssueToDone = transitionExecuteIssueToDone,
  transitionIssueToBlocked = transitionExecuteIssueToBlocked,
  postIssueComment = postExecuteIssueComment,
  loadRuntimeConfig = loadRuntimePreferences,
  runMission: runMissionImpl = runMission,
  listWorktreePaths = async ({ cwd: worktreeCwd = cwd, runner: runnerImpl = runner }) =>
    listMeaningfulWorktreePaths({
      cwd: worktreeCwd,
      runner: runnerImpl
    })
} = {}) {
  const { readExecuteContinuity } = await import("../server.mjs");
  const continuity = await readExecuteContinuity().catch(() => null);
  const preview = await previewAction({
    cwd,
    repo,
    runner,
    continuity
  });

  if (preview.status !== "ready" || !preview.target || !preview.issue || !preview.prompt) {
    await onStateChange({
      status: "idle",
      currentTarget: null,
      currentChildPid: null,
      detail: preview.detail,
      lastResult: {
        status: preview.status,
        target: null,
        detail: preview.detail,
        finishedAt: new Date().toISOString()
      }
    });
    return preview;
  }

  const profileId = preview.skillProfile?.id ?? "general";
  const runtimeConfig = await loadRuntimeConfig({
    cwd
  });
  const available = Array.isArray(availableRuntimes) && availableRuntimes.length > 0 ? availableRuntimes : ["codex"];
  // Adaptive selection: prefer the runtime with a higher success rate for this profile.
  // Falls back to the normal preference order when there isn't enough learning data.
  const learningEntries = await getLearningEntries().catch(() => []);
  const initialRuntimeId = selectRuntimeAdaptive(profileId, available, learningEntries, runtimeConfig.preferences);
  const initialRuntimeLabel = getRuntime(initialRuntimeId).RUNTIME_LABEL;
  // Full ordered list for the fallback sequence on rate-limit
  const runtimePlan = resolveRuntimeOrder({
    taskType: profileId,
    preferences: runtimeConfig.preferences,
    availableRuntimeIds: available
  });

  if (preview.target.status !== "in_progress") {
    await transitionIssueToInProgress({
      runner,
      repo: preview.repo,
      issueNumber: preview.target.number
    });
  }

  await narrate({
    text: `Starting #${preview.target.number} — "${(preview.issue?.title || "untitled").slice(0, 80)}". Picking ${initialRuntimeLabel}.`,
    phase: "start",
    issueRef: `#${preview.target.number}`
  });

  const __runStartMs = Date.now();
  await notifyRun({
    kind: "started",
    issueNumber: preview.target.number,
    issueTitle: preview.issue?.title,
    issueUrl: preview.issue?.url,
    repo: preview.repo,
    runtimeId: initialRuntimeLabel,
    profileId: preview.skillProfile?.id,
    detail: `Picking ${initialRuntimeLabel}.`
  }).catch(() => {});

  if (runtimePlan.length === 0) {
    const detail = `No configured runtime is available for execute issue #${preview.target.number}.`;

    await transitionIssueToBlocked({
      runner,
      repo: preview.repo,
      issueNumber: preview.target.number
    });
    await postIssueComment({
      runner,
      repo: preview.repo,
      issueNumber: preview.target.number,
      body: buildExecuteCompletionComment({
        issue: preview.issue,
        outcome: "failed",
        lastMessage: detail
      })
    });

    return {
      status: "failed",
      target: preview.target,
      runtimeId: null,
      detail,
      runDir: null
    };
  }

  await postIssueComment({
    runner,
    repo: preview.repo,
    issueNumber: preview.target.number,
    body: buildExecuteStartComment({
      issue: preview.issue,
      repoCwd: cwd,
      runtimeLabel: initialRuntimeLabel,
      runtimePlan
    })
  });

  await fs.mkdir(executeRunsDir, {
    recursive: true
  });
  const runDir = path.join(executeRunsDir, createRunDirName(preview.issue));
  const baselineWorktreePaths = await listWorktreePaths({
    stage: "before",
    cwd,
    runner
  });
  const protectedPathsBefore = await snapshotProtectedPaths({ cwd });
  await onStateChange({
    status: "launching",
    currentTarget: preview.target,
    currentChildPid: null,
    currentRunDir: runDir,
    detail: `Launching ${initialRuntimeLabel} for issue #${preview.target.number}.`
  });

  let mission = null;
  let lastMessage = "";
  let activeRunDir = runDir;
  let activeRuntimeId = initialRuntimeId;

  // Execution timeout: cancel the mission if the runtime hangs too long.
  // Compose with the outer signal if present (from the worker loop AbortController).
  const timeoutController = new AbortController();
  const timeoutHandle = setTimeout(() => timeoutController.abort(), EXECUTE_TIMEOUT_MS);
  const missionSignal = signal
    ? AbortSignal.any([signal, timeoutController.signal])
    : timeoutController.signal;

  // Session pinning: if this issue was previously run with claude-code,
  // try resuming from the last session so conversation context isn't lost on worker crash.
  const pinnedSessionId = await readSessionPin(preview.target.number).catch(() => null);

  for (const [index, runtimeId] of runtimePlan.entries()) {
    const runtimeLabel = getRuntime(runtimeId).RUNTIME_LABEL;
    const attemptRunDir = path.join(runDir, `attempt-${String(index + 1).padStart(2, "0")}-${runtimeId}`);
    // Only use the session pin for the first attempt with claude-code
    const useSessionId = index === 0 && runtimeId === "claude-code" ? pinnedSessionId : null;

    await narrate({
      text: index === 0
        ? `Running on ${runtimeLabel}${useSessionId ? " (resuming previous session)" : ""}.`
        : `Switching to ${runtimeLabel} after the previous runtime tapped out.`,
      phase: index === 0 ? "plan" : "info",
      issueRef: `#${preview.target.number}`
    });

    mission = await runMissionImpl({
      runtimeId,
      repoCwd: cwd,
      prompt: preview.prompt,
      runDir: attemptRunDir,
      signal: missionSignal,
      resumeSessionId: useSessionId,
      onChildPid: async (childPid) => {
        await onStateChange({
          status: "running",
          currentTarget: preview.target,
          currentChildPid: childPid,
          currentRunDir: attemptRunDir,
          detail: `${runtimeLabel} is running issue #${preview.target.number}${useSessionId ? " (resumed session)" : ""}.`
        });
      }
    });

    // Persist the session_id from this run (claude-code only) for future resumption
    if (mission.sessionId && runtimeId === "claude-code") {
      await writeSessionPin(preview.target.number, mission.sessionId, runtimeId).catch(() => {});
    }
    lastMessage = mission.lastMessage || (await readTextIfExists(mission.outputLastMessageFile));
    activeRunDir = attemptRunDir;
    activeRuntimeId = runtimeId;

    const shouldFallback =
      runtimeConfig.rateLimitFallback !== false &&
      detectRateLimitFailure({
        exitCode: mission.exitCode,
        stdoutText: mission.stdoutText,
        stderrText: mission.stderrText,
        lastMessage
      }) &&
      index < runtimePlan.length - 1;

    if (!shouldFallback) {
      break;
    }

    const nextRuntimeId = runtimePlan[index + 1];
    const nextRuntimeLabel = getRuntime(nextRuntimeId).RUNTIME_LABEL;
    await onStateChange({
      status: "launching",
      currentTarget: preview.target,
      currentChildPid: null,
      currentRunDir: runDir,
      detail: `${runtimeLabel} was rate limited for issue #${preview.target.number}; retrying with ${nextRuntimeLabel}.`
    });
  }

  clearTimeout(timeoutHandle);

  // Check for spawn requests written by the agent during its run
  const spawnRequestPath = path.join(cwd, ".spawn-request.json");
  let spawnedTask = null;
  try {
    const spawnRaw = await fs.readFile(spawnRequestPath, "utf8");
    const spawnReq = JSON.parse(spawnRaw);
    // Validate required fields
    if (spawnReq.title && spawnReq.body) {
      // Remove the file so it doesn't trigger again
      await fs.rm(spawnRequestPath, { force: true });
      // Submit to the direct task queue
      const { submitQueueTask } = await import("./execute-queue.mjs");
      spawnedTask = await submitQueueTask({
        title: spawnReq.title,
        body: spawnReq.body,
        runtimeId: spawnReq.runtimeId || null,
        parentIssueNumber: spawnReq.parentIssueNumber || preview.target.number,
        spawnedBy: "agent"
      });
      const tsMid = timestamp();
      process.stdout.write(`[${tsMid}] execute worker spawned sub-task: "${spawnReq.title}"\n`);
    }
  } catch {
    // No spawn request, or invalid JSON — ignore
  }

  const nextWorktreePaths = await listWorktreePaths({
    stage: "after",
    cwd,
    runner
  });
  const gitChanges = findNewMeaningfulWorktreeChanges({
    beforePaths: baselineWorktreePaths,
    afterPaths: nextWorktreePaths
  });
  const protectedPathsAfter = await snapshotProtectedPaths({ cwd });
  const protectedPathChanges = findChangedProtectedPaths(
    protectedPathsBefore,
    protectedPathsAfter
  );
  const newChanges = [...new Set([...gitChanges, ...protectedPathChanges])];
  let outcome = classifyExecuteMissionResult({
    mission,
    newChanges
  });

  // Self-review gate: when the agent thinks it succeeded, run cheap heuristics
  // on the diff. Anything sketchy downgrades "completed" → "review_needed" so a
  // human eyeballs it before the issue auto-closes.
  let selfReview = null;
  if (outcome === "completed") {
    await narrate({
      text: `Mission exit clean. Running self-review on ${newChanges.length} change${newChanges.length === 1 ? "" : "s"}.`,
      phase: "verify",
      issueRef: `#${preview.target.number}`
    });
    selfReview = await runSelfReview({
      cwd,
      changedFiles: newChanges,
      requireChanges: true,
      protectedPathsBefore,
      protectedPathsAfter
    }).catch(() => null);
    if (selfReview && !selfReview.ok) {
      outcome = "review_needed";
      await narrate({
        text: `Self-review flagged ${selfReview.issues.length} issue${selfReview.issues.length === 1 ? "" : "s"} — punting to human review.`,
        phase: "error",
        issueRef: `#${preview.target.number}`
      });
    } else if (selfReview && selfReview.ok) {
      await narrate({
        text: `Self-review passed. ${selfReview.notes[0] || "Clean diff."}`,
        phase: "verify",
        issueRef: `#${preview.target.number}`
      });
    }
  } else if (outcome === "review_needed") {
    await narrate({
      text: `Mission exit clean but no meaningful changes landed — flagging for review.`,
      phase: "info",
      issueRef: `#${preview.target.number}`
    });
  } else if (outcome === "failed") {
    await narrate({
      text: `Run did not complete cleanly. Will requeue or retry per policy.`,
      phase: "error",
      issueRef: `#${preview.target.number}`
    });
  }

  // Scan for HTML artifacts generated during this run (visual-explainer skill output)
  const artifacts = await scanRunArtifacts({
    issueNumber: preview.target.number,
    runDir: activeRunDir,
    runtimeId: activeRuntimeId
  }).catch(() => []);

  // Record insight to learning log — best-effort, won't crash the worker on failure
  await recordRunInsight({
    issueNumber: preview.target.number,
    taskTitle: preview.issue?.title ?? "",
    runtimeId: activeRuntimeId,
    profileId,
    outcome: mission.aborted ? "aborted" : outcome,
    filesChanged: newChanges,
    lastMessage
  }).catch(() => {});

  // Extract durable memory from agent's output
  const extracted = await extractMemoryFromRun({
    lastMessage,
    outcome: outcome === "completed" ? "completed" : "failed",
    issueNumber: preview.target.number,
    changedFiles: newChanges
  }).catch(() => []);
  if (Array.isArray(extracted) && extracted.length > 0) {
    await narrate({
      text: `Filed ${extracted.length} new memor${extracted.length === 1 ? "y" : "ies"} from this run.`,
      phase: "memory",
      issueRef: `#${preview.target.number}`
    });
  }

  // Record run cost (parse token usage from agent output)
  const usage = parseTokenUsage(`${mission.stdoutText || ""}\n${mission.stderrText || ""}`);
  if (usage) {
    await recordRunCost({
      runtimeId: activeRuntimeId,
      issueNumber: preview.target.number,
      profileId,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      model: usage.model,
      outcome: outcome === "completed" ? "completed" : "failed"
    }).catch(() => {});
  }

  // Issue finished (regardless of outcome) — clear session pin so the next run starts fresh
  await clearSessionPin(preview.target.number).catch(() => {});

  // Helper — fire-and-forget webhook notify
  const __notifyOutcome = (kind, detail) => notifyRun({
    kind,
    issueNumber: preview.target.number,
    issueTitle: preview.issue?.title,
    issueUrl: preview.issue?.url,
    repo: preview.repo,
    runtimeId: activeRuntimeId,
    profileId,
    detail,
    durationMs: Date.now() - __runStartMs
  }).catch(() => {});

  if (mission.aborted) {
    await __notifyOutcome("aborted", `Stopped while running #${preview.target.number}.`);
    const result = {
      status: "aborted",
      target: preview.target,
      detail: `Execution was stopped while issue #${preview.target.number} was running.`,
      runDir: activeRunDir,
      runtimeId: activeRuntimeId
    };

    await onStateChange({
      status: "idle",
      currentTarget: null,
      currentChildPid: null,
      currentRunDir: null,
      detail: result.detail,
      lastResult: {
        ...result,
        finishedAt: new Date().toISOString()
      }
    });
    return result;
  }

  if (outcome === "completed") {
    await transitionIssueToDone({
      runner,
      repo: preview.repo,
      issueNumber: preview.target.number
    });
    await postIssueComment({
      runner,
      repo: preview.repo,
      issueNumber: preview.target.number,
      body: buildExecuteCompletionComment({
        issue: preview.issue,
        outcome: "completed",
        lastMessage,
        runDir: activeRunDir,
        runtimeId: activeRuntimeId
      })
    });

    await __notifyOutcome("completed", `PR-ready. ${String(lastMessage || "").slice(0, 300)}`);
    const result = {
      status: "completed",
      target: preview.target,
      runtimeId: activeRuntimeId,
      detail: `Completed execute issue #${preview.target.number}.`,
      runDir: activeRunDir,
      artifacts
    };

    await onStateChange({
      status: "idle",
      currentTarget: null,
      currentChildPid: null,
      currentRunDir: null,
      detail: result.detail,
      lastResult: {
        ...result,
        finishedAt: new Date().toISOString()
      }
    });
    return result;
  }

  if (outcome === "review_needed") {
    const baseDetail = selfReview && !selfReview.ok
      ? `Self-review flagged ${selfReview.issues.length} issue${selfReview.issues.length === 1 ? "" : "s"} for issue #${preview.target.number}.`
      : `Codex exited cleanly for issue #${preview.target.number} but left no new meaningful repo changes.`;
    const reviewBlock = selfReview && !selfReview.ok ? formatSelfReview(selfReview) : "";

    await transitionIssueToBlocked({
      runner,
      repo: preview.repo,
      issueNumber: preview.target.number
    });
    await postIssueComment({
      runner,
      repo: preview.repo,
      issueNumber: preview.target.number,
      body: buildExecuteCompletionComment({
        issue: preview.issue,
        outcome: "review_needed",
        lastMessage: [baseDetail, reviewBlock, String(lastMessage || "").trim()].filter(Boolean).join("\n\n"),
        runDir: activeRunDir,
        runtimeId: activeRuntimeId
      })
    });
    const detail = baseDetail;

    await __notifyOutcome("review_needed", baseDetail);
    const result = {
      status: "review_needed",
      target: preview.target,
      runtimeId: activeRuntimeId,
      detail,
      runDir: activeRunDir
    };

    await onStateChange({
      status: "idle",
      currentTarget: null,
      currentChildPid: null,
      currentRunDir: null,
      detail: result.detail,
      lastResult: {
        ...result,
        finishedAt: new Date().toISOString()
      }
    });
    return result;
  }

  await transitionIssueToBlocked({
    runner,
    repo: preview.repo,
    issueNumber: preview.target.number
  });
  await postIssueComment({
    runner,
    repo: preview.repo,
    issueNumber: preview.target.number,
    body: buildExecuteCompletionComment({
      issue: preview.issue,
      outcome: "failed",
      lastMessage: lastMessage || `${activeRuntimeId} exited with code ${mission.exitCode}.`,
      runDir: activeRunDir,
      runtimeId: activeRuntimeId
    })
  });

  await __notifyOutcome("failed", `Exit ${mission.exitCode}. ${String(lastMessage || "").slice(0, 200)}`);
  const result = {
    status: "failed",
    target: preview.target,
    runtimeId: activeRuntimeId,
    detail: `Execution failed for issue #${preview.target.number} on ${activeRuntimeId} (exit ${mission.exitCode}).`,
    runDir: activeRunDir
  };

  await onStateChange({
    status: "idle",
    currentTarget: null,
    currentChildPid: null,
    currentRunDir: null,
    detail: result.detail,
    lastResult: {
      ...result,
      finishedAt: new Date().toISOString()
    }
  });
  return result;
}

/**
 * At startup, scan the queue for stale in_progress tasks (startedAt >
 * STUCK_TASK_THRESHOLD_MS ago) and return them to queued state.
 * This happens when the worker crashes while a task is running.
 *
 * @param stdout — stream for warn log
 */
export async function recoverStuckTasks({ stdout = process.stdout } = {}) {
  const tasks = await readQueue().catch(() => []);
  const staleThreshold = Date.now() - STUCK_TASK_THRESHOLD_MS;

  for (const task of tasks) {
    if (
      task.status === "in_progress" &&
      task.startedAt &&
      new Date(task.startedAt).getTime() < staleThreshold
    ) {
      await requeueStuckTask(task.id).catch(() => {});
      stdout.write(
        `[warn] requeued stuck task ${task.id} (${String(task.task || "").slice(0, 40)})\n`
      );
    }
  }
}

export async function runExecuteWorker({
  cwd = projectRoot,
  repo = null,
  once = false,
  intervalMs = DEFAULT_INTERVAL_SECONDS * 1000,
  signal = null,
  stdout = process.stdout,
  codexCommand = "codex", // backward-compat — ignored when availableRuntimes is set
  runner = undefined,
  executeAction = executeNextIssue,
  sleep = sleepWithSignal,
  loadRuntimeConfig = loadRuntimePreferences
} = {}) {
  let lastSignature = null;
  const runtimeConfig = await loadRuntimeConfig({
    cwd
  });

  // Probe runtimes available on the system at startup.
  const availableRuntimes = await probeAvailableRuntimes(
    codexCommand && codexCommand !== "codex"
      ? {
          ...process.env,
          CODEX_BIN: codexCommand
        }
      : process.env
  );
  const startupSummary = buildRuntimeStartupSummary({
    config: runtimeConfig,
    availableRuntimeIds: availableRuntimes
  });

  stdout.write(`[${timestamp()}] execute worker ${startupSummary.availableLine}\n`);
  stdout.write(`[${timestamp()}] execute worker ${startupSummary.routingLine}\n`);
  stdout.write(`[${timestamp()}] execute worker ${startupSummary.fallbackLine}\n`);

  // Inject bundled skills into ~/.claude/skills/ so Claude Code can use them
  if (availableRuntimes.includes("claude-code")) {
    const skillResult = await injectSkills().catch(err => ({ installed: [], skipped: [], errors: [err.message] }));
    if (skillResult.installed.length > 0) {
      stdout.write(`[${timestamp()}] execute worker skills injected: ${skillResult.installed.join(", ")}\n`);
    }
    if (skillResult.errors.length > 0) {
      stdout.write(`[${timestamp()}] execute worker skill injection warnings: ${skillResult.errors.join(", ")}\n`);
    }
  }

  // Unique ID per worker instance — for the multi-worker registry
  const workerId = crypto.randomUUID().slice(0, 8);

  // Register with the workers registry
  await registerWorker({ workerId, pid: process.pid, runtimeId: availableRuntimes[0] ?? "codex" }).catch(() => {});

  // At startup, requeue stale in_progress tasks (crash recovery)
  await recoverStuckTasks({ stdout }).catch(() => {});

  if (!once) {
    stdout.write(
      `[${timestamp()}] execute worker ${workerId} watching ${repo || "origin repo"} every ${Math.round(
        intervalMs / 1000
      )}s | runtimes: ${availableRuntimes.join(", ") || "none"}\n`
    );
  }

  const persistState = async (nextState) => {
    await writeExecuteWorkerState(nextState);
  };

  try {
  while (true) {
    if (signal?.aborted) {
      return 0;
    }

    // Priority 1: check the direct task queue first.
    // Direct task = submitted via /api/execute/submit without a GitHub issue.
    const directTask = await claimNextQueuedTask().catch(() => null);
    if (directTask) {
      const result = await runDirectTask({
        task: directTask,
        availableRuntimes,
        runtimePreferences: runtimeConfig.preferences,
        signal,
        onStateChange: persistState,
        workerId
      });

      const signature = createExecuteWorkerResultSignature(result);
      if (signature !== lastSignature) {
        stdout.write(`${formatExecuteWorkerResultLine(result)}\n`);
        lastSignature = signature;
      }

      if (once) return 0;
      // Loop immediately — there may be more tasks in the queue
      continue;
    }

    // Priority 2: GitHub issue queue (existing behavior)
    const result = await executeAction({
      cwd,
      repo,
      signal,
      codexCommand,
      availableRuntimes,
      runner,
      onStateChange: persistState
    });
    const signature = createExecuteWorkerResultSignature(result);

    if (signature !== lastSignature) {
      stdout.write(`${formatExecuteWorkerResultLine(result)}\n`);
      lastSignature = signature;
    }

    if (once) {
      return 0;
    }

    try {
      await sleep(intervalMs, signal);
    } catch (error) {
      if (error?.name === "AbortError") {
        return 0;
      }

      throw error;
    }
  }
  } finally {
    // Unregister from the workers registry on exit (normal or error)
    await unregisterWorker(workerId).catch(() => {});
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = parseArgs(process.argv.slice(2));
  const controller = new AbortController();
  const handleStop = () => controller.abort();

  process.on("SIGINT", handleStop);
  process.on("SIGTERM", handleStop);

  writeExecuteWorkerState({
    status: "idle",
    currentTarget: null,
    currentChildPid: null,
    currentRunDir: null,
    detail: "Execute worker booted."
  })
    .then(() =>
      runExecuteWorker({
        ...options,
        signal: controller.signal
      })
    )
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    })
    .finally(async () => {
      await clearExecuteWorkerState().catch(() => {});
      process.off("SIGINT", handleStop);
      process.off("SIGTERM", handleStop);
    });
}
