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
  getRuntime,
  probeAvailableRuntimes,
  selectRuntime
} from "./runtimes/index.mjs";
import {
  checkAndClearWakeTrigger,
  claimNextQueuedTask,
  registerWorker,
  requeueForRetry,
  resolveQueueTask,
  unregisterWorker,
  updateWorkerActivity
} from "./execute-queue.mjs";
import { recordRunInsight } from "./execute-learning.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_INTERVAL_SECONDS = 60;
const MIN_INTERVAL_SECONDS = 30;
const DEFAULT_CODEX_CANDIDATES = ["/Applications/Codex.app/Contents/Resources/codex"];
const execFileAsync = promisify(execFile);
const EXECUTE_RUNTIME_PATH_PREFIXES = [
  ".execute-runs/",
  ".execute-worker.log",
  ".execute-worker.pid",
  ".execute-worker.state.json",
  ".execute-worker-state.json"
];

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
// wakeResolve di-set oleh sleepWithSignal dan di-call oleh handler SIGUSR1.
// Di Windows, SIGUSR1 tidak tersedia — trigger file dipakai sebagai gantinya.

let wakeResolve = null;

process.on("SIGUSR1", () => {
  if (wakeResolve) {
    wakeResolve();
    wakeResolve = null;
  }
});

/**
 * Sleep selama `ms` milidetik, tapi bisa di-interrupt lebih awal via:
 *   1. Trigger file (.execute-wake.trigger) — cross-platform, di-poll tiap 2s.
 *   2. SIGUSR1 — fast-path di Unix (Mac/Linux). Di Windows diabaikan.
 *   3. AbortSignal — untuk graceful shutdown.
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

    // Cross-platform: cek trigger file dulu sebelum tunggu chunk berikutnya
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

      // SIGUSR1 fast-path (Unix) — panggil resolver untuk skip chunk ini
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

// Backward-compat re-exports — code lama dan test yang import ini tetap jalan.
// Implementasi sekarang ada di tools/runtimes/codex.mjs.
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

/**
 * Jalankan satu mission (execute task) dengan runtime yang dipilih.
 *
 * @param runtimeId  — "codex" | "claude-code" | runtime lain yang terdaftar
 * @param repoCwd    — working directory repo target
 * @param prompt     — prompt lengkap yang dikirim ke runtime
 * @param runDir     — direktori untuk artifact (prompt.md, last-message.md, events.jsonl)
 * @param signal     — AbortSignal untuk cancel
 * @param onChildPid — callback saat child process PID diketahui
 *
 * Return: { exitCode, signal, aborted, outputLastMessageFile, eventsFile }
 */
async function runMission({
  runtimeId = "codex",
  repoCwd,
  prompt,
  runDir,
  signal = null,
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
    outputLastMessageFile
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
    let aborted = false;
    let finished = false;

    onChildPid(child.pid || null);

    child.stdout.on("data", (chunk) => {
      stream.write(chunk);
      // outputMode "stdout": kumpulkan stdout sebagai last message
      if (invocation.outputMode === "stdout") {
        stdoutChunks.push(chunk);
      }
    });
    child.stderr.on("data", (chunk) => {
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
      stream.end();

      // Untuk runtime yang output lewat stdout (bukan --output-last-message file),
      // tulis buffer ke outputLastMessageFile supaya caller bisa baca seragam.
      if (invocation.outputMode === "stdout" && stdoutChunks.length > 0) {
        const output = Buffer.concat(stdoutChunks).toString("utf8");
        await fs.writeFile(outputLastMessageFile, output, "utf8").catch(() => {});
      }

      resolve({
        exitCode: Number.isInteger(exitCode) ? exitCode : exitSignal ? 1 : 0,
        signal: exitSignal || null,
        aborted,
        outputLastMessageFile,
        eventsFile
      });
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

    child.stdin.end(prompt);
  });
}

// Backward-compat alias — test dan code lama yang call runCodexMission tetap jalan.
// Semua call baru pakai runMission({ runtimeId, ... }) langsung.
async function runCodexMission({ codexCommand = null, repoCwd, prompt, runDir, signal = null, onChildPid = () => {} } = {}) {
  return runMission({ runtimeId: "codex", repoCwd, prompt, runDir, signal, onChildPid });
}

// ─── Direct task runner ──────────────────────────────────────────────────────

/**
 * Jalankan satu direct task dari execute-queue.
 * Berbeda dengan GitHub issue — tidak ada transition label, tidak ada comment.
 * Hasilnya disimpan langsung di queue entry.
 */
async function runDirectTask({
  task,
  availableRuntimes = ["codex"],
  signal = null,
  onStateChange = async () => {},
  workerId = null
} = {}) {
  const { buildDirectTaskPrompt } = await import("./execute-bridge.mjs");
  const { readDailyDeviceHandoff } = await import("../server.mjs");
  const { getLearningContext } = await import("./execute-learning.mjs");

  const handoff = await readDailyDeviceHandoff().catch(() => null);
  const learningContext = await getLearningContext({ limit: 5 }).catch(() => null);
  const prompt = buildDirectTaskPrompt({
    task: task.task,
    context: task.context,
    repoCwd: projectRoot,
    handoff,
    learningContext
  });

  const runtimeId = task.runtimeId
    ? task.runtimeId
    : selectRuntime("general", availableRuntimes);
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
    // Coba retry dengan backoff — kalau sudah habis maxRetries, requeueForRetry
    // akan mark sebagai "failed" secara otomatis.
    await requeueForRetry(task.id, { result: lastMessage || null });
  } else {
    await resolveQueueTask(task.id, { status: "done", result: lastMessage || null });
  }

  // Catat ke learning log
  await recordRunInsight({
    issueNumber: null,
    taskTitle: task.task,
    runtimeId,
    outcome: status,
    filesChanged: [],
    lastMessage
  }).catch(() => {});

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

async function executeNextIssue({
  cwd = projectRoot,
  repo = null,
  signal = null,
  codexCommand = "codex", // backward-compat — diabaikan kalau availableRuntimes disediakan
  availableRuntimes = null, // null = fallback ke codex saja
  runner = undefined,
  onStateChange = async () => {}
} = {}) {
  const preview = await prepareExecuteAction({
    cwd,
    repo,
    runner
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

  // Pilih runtime berdasarkan specialist profile issue.
  // Kalau availableRuntimes tidak disediakan (caller lama), fallback ke codex.
  const profileId = preview.skillProfile?.id ?? "general";
  const runtimeId = availableRuntimes
    ? selectRuntime(profileId, availableRuntimes)
    : "codex";
  const runtimeLabel = getRuntime(runtimeId).RUNTIME_LABEL;

  if (preview.target.status !== "in_progress") {
    await transitionExecuteIssueToInProgress({
      runner,
      repo: preview.repo,
      issueNumber: preview.target.number
    });
  }

  await postExecuteIssueComment({
    runner,
    repo: preview.repo,
    issueNumber: preview.target.number,
    body: buildExecuteStartComment({
      issue: preview.issue,
      repoCwd: cwd,
      runtimeLabel
    })
  });

  await fs.mkdir(executeRunsDir, {
    recursive: true
  });
  const runDir = path.join(executeRunsDir, createRunDirName(preview.issue));
  const baselineWorktreePaths = await listMeaningfulWorktreePaths({
    cwd,
    runner
  });
  await onStateChange({
    status: "launching",
    currentTarget: preview.target,
    currentChildPid: null,
    currentRunDir: runDir,
    detail: `Launching ${runtimeLabel} for issue #${preview.target.number}.`
  });

  const mission = await runMission({
    runtimeId,
    repoCwd: cwd,
    prompt: preview.prompt,
    runDir,
    signal,
    onChildPid: async (childPid) => {
      await onStateChange({
        status: "running",
        currentTarget: preview.target,
        currentChildPid: childPid,
        currentRunDir: runDir,
        detail: `${runtimeLabel} is running issue #${preview.target.number}.`
      });
    }
  });
  const lastMessage = await readTextIfExists(mission.outputLastMessageFile);
  const nextWorktreePaths = await listMeaningfulWorktreePaths({
    cwd,
    runner
  });
  const newChanges = findNewMeaningfulWorktreeChanges({
    beforePaths: baselineWorktreePaths,
    afterPaths: nextWorktreePaths
  });
  const outcome = classifyExecuteMissionResult({
    mission,
    newChanges
  });

  // Catat insight ke learning log — best-effort, tidak crash worker kalau gagal
  await recordRunInsight({
    issueNumber: preview.target.number,
    taskTitle: preview.issue?.title ?? "",
    runtimeId,
    outcome: mission.aborted ? "aborted" : outcome,
    filesChanged: newChanges,
    lastMessage
  }).catch(() => {});

  if (mission.aborted) {
    const result = {
      status: "aborted",
      target: preview.target,
      detail: `Execution was stopped while issue #${preview.target.number} was running.`,
      runDir
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
    await transitionExecuteIssueToDone({
      runner,
      repo: preview.repo,
      issueNumber: preview.target.number
    });
    await postExecuteIssueComment({
      runner,
      repo: preview.repo,
      issueNumber: preview.target.number,
      body: buildExecuteCompletionComment({
        issue: preview.issue,
        outcome: "completed",
        lastMessage,
        runDir
      })
    });

    const result = {
      status: "completed",
      target: preview.target,
      detail: `Completed execute issue #${preview.target.number}.`,
      runDir
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
    const detail = `Codex exited cleanly for issue #${preview.target.number} but left no new meaningful repo changes.`;

    await transitionExecuteIssueToBlocked({
      runner,
      repo: preview.repo,
      issueNumber: preview.target.number
    });
    await postExecuteIssueComment({
      runner,
      repo: preview.repo,
      issueNumber: preview.target.number,
      body: buildExecuteCompletionComment({
        issue: preview.issue,
        outcome: "review_needed",
        lastMessage: [detail, String(lastMessage || "").trim()].filter(Boolean).join("\n\n"),
        runDir
      })
    });

    const result = {
      status: "review_needed",
      target: preview.target,
      detail,
      runDir
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

  await transitionExecuteIssueToBlocked({
    runner,
    repo: preview.repo,
    issueNumber: preview.target.number
  });
  await postExecuteIssueComment({
    runner,
    repo: preview.repo,
    issueNumber: preview.target.number,
    body: buildExecuteCompletionComment({
      issue: preview.issue,
      outcome: "failed",
      lastMessage: lastMessage || `Codex exited with code ${mission.exitCode}.`,
      runDir
    })
  });

  const result = {
    status: "failed",
    target: preview.target,
    detail: `Execution failed for issue #${preview.target.number} (exit ${mission.exitCode}).`,
    runDir
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

export async function runExecuteWorker({
  cwd = projectRoot,
  repo = null,
  once = false,
  intervalMs = DEFAULT_INTERVAL_SECONDS * 1000,
  signal = null,
  stdout = process.stdout,
  codexCommand = "codex", // backward-compat
  runner = undefined,
  executeAction = executeNextIssue,
  sleep = sleepWithSignal
} = {}) {
  let lastSignature = null;

  // ID unik per worker instance — untuk multi-worker registry
  const workerId = crypto.randomUUID().slice(0, 8);

  // Probe runtime yang tersedia di sistem saat startup.
  const availableRuntimes = await probeAvailableRuntimes(process.env);

  // Register ke workers registry
  await registerWorker({ workerId, pid: process.pid, runtimeId: availableRuntimes[0] ?? "codex" }).catch(() => {});

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

    // Priority 1: cek direct task queue terlebih dahulu.
    // Direct task = dikirim via /api/execute/submit tanpa GitHub issue.
    const directTask = await claimNextQueuedTask().catch(() => null);
    if (directTask) {
      const result = await runDirectTask({
        task: directTask,
        availableRuntimes,
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
      // Langsung loop lagi — mungkin ada task lain di queue
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
    // Unregister dari workers registry saat keluar (normal atau error)
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
