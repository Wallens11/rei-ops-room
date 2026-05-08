import { execFile, spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  executeWorkerLogFile,
  executeWorkerPidFile,
  readExecuteWorkerState,
  projectRoot
} from "./execute-worker-state.mjs";

const execFileAsync = promisify(execFile);
const defaultIntervalMs = 60_000;
const minIntervalMs = 30_000;

/**
 * Return the PID file path for a given worker index.
 * Worker 1 uses the canonical .execute-worker.pid for backward compat.
 */
export function workerPidFile(workerIndex = 1) {
  if (workerIndex === 1) return executeWorkerPidFile;
  return path.join(path.dirname(executeWorkerPidFile), `.execute-worker-${workerIndex}.pid`);
}

/**
 * Return the log file path for a given worker index.
 * Worker 1 uses the canonical .execute-worker.log for backward compat.
 */
export function workerLogFile(workerIndex = 1) {
  if (workerIndex === 1) return executeWorkerLogFile;
  return path.join(path.dirname(executeWorkerLogFile), `.execute-worker-${workerIndex}.log`);
}

export function parseExecuteWorkerCliArgs(argv) {
  const args = [...argv];
  let command = "status";
  let repo = null;
  let intervalMs = defaultIntervalMs;
  let workerIndex = 1;

  if (args[0] && !args[0].startsWith("--")) {
    command = args.shift();
  }

  while (args.length > 0) {
    const current = args.shift();

    if (current === "--repo") {
      repo = args.shift() || null;
      continue;
    }

    if (current === "--interval-seconds") {
      intervalMs = Math.max(Number(args.shift() || 60) * 1000, minIntervalMs);
      continue;
    }

    if (current === "--worker") {
      const n = Number(args.shift() || 1);
      workerIndex = Number.isFinite(n) && n >= 1 ? Math.round(n) : 1;
    }
  }

  return {
    command,
    repo,
    intervalMs,
    workerIndex
  };
}

export function inferExecuteWorkerRuntime({
  pidFilePid = null,
  pidFileAlive = false,
  pidFileCommand = ""
} = {}) {
  const looksLikeWorker = pidFileAlive && pidFileCommand.includes("execute-worker.mjs");

  if (looksLikeWorker) {
    return {
      running: true,
      pid: pidFilePid,
      source: "pid"
    };
  }

  if (pidFilePid && !pidFileAlive) {
    return {
      running: false,
      pid: null,
      source: "stale_pid"
    };
  }

  if (pidFilePid && pidFileAlive) {
    return {
      running: false,
      pid: null,
      source: "foreign_pid"
    };
  }

  return {
    running: false,
    pid: null,
    source: "none"
  };
}

export function inferExecuteWorkerAction({ runtime }) {
  if (runtime?.running) {
    return {
      type: "reuse",
      pid: runtime.pid
    };
  }

  return {
    type: "start"
  };
}

export function buildExecuteWorkerStatusLine(runtime = {}) {
  if (runtime.running) {
    if (runtime.currentTarget?.number) {
      return `execute worker running (pid ${runtime.pid}) with active mission #${runtime.currentTarget.number} ${runtime.currentTarget.title || ""}`.trim();
    }

    return `execute worker running (pid ${runtime.pid})`;
  }

  if (runtime.source === "stale_pid") {
    return "execute worker is not running (stale pid file)";
  }

  if (runtime.source === "foreign_pid") {
    return "execute worker pid file points at a different live process";
  }

  return "execute worker is not running";
}

function defaultLogger(message) {
  console.log(message);
}

async function readPidFile(workerIndex = 1) {
  try {
    const pidText = await fs.readFile(workerPidFile(workerIndex), "utf8");
    const pid = Number(pidText.trim());
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function isProcessAlive(pid) {
  if (!pid) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function readProcessCommand(pid) {
  if (!pid) {
    return "";
  }

  try {
    const { stdout } = await execFileAsync("ps", ["-p", String(pid), "-o", "command="]);
    return stdout.trim();
  } catch {
    return "";
  }
}

export async function inspectExecuteWorkerRuntime({ workerIndex = 1 } = {}) {
  const pidFilePid = await readPidFile(workerIndex);
  const pidFileAlive = isProcessAlive(pidFilePid);
  const pidFileCommand = await readProcessCommand(pidFilePid);
  const state = await readExecuteWorkerState();

  return {
    ...inferExecuteWorkerRuntime({
      pidFilePid,
      pidFileAlive,
      pidFileCommand
    }),
    pidFilePid,
    pidFileAlive,
    pidFileCommand,
    workerIndex,
    status: state?.status || "idle",
    currentTarget: state?.currentTarget || null,
    lastResult: state?.lastResult || null
  };
}

async function cleanupPidFile(workerIndex = 1) {
  await fs.rm(workerPidFile(workerIndex), {
    force: true
  });
}

async function ensureCleanPidFile(runtime, workerIndex = 1) {
  if (runtime.source === "stale_pid" || runtime.source === "foreign_pid") {
    await cleanupPidFile(workerIndex);
  }
}

async function waitForWorkerStart(pid, attempts = 12) {
  for (let index = 0; index < attempts; index += 1) {
    if (isProcessAlive(pid)) {
      return true;
    }

    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  return false;
}

async function startDetachedWorker({ repo = null, intervalMs = defaultIntervalMs, workerIndex = 1 }) {
  await fs.mkdir(projectRoot, {
    recursive: true
  });
  const isWin = process.platform === "win32";
  const logPath = workerLogFile(workerIndex);
  const pidPath = workerPidFile(workerIndex);
  const logHandle = isWin ? null : await fs.open(logPath, "a");
  const args = ["tools/execute-worker.mjs"];

  if (repo) {
    args.push("--repo", repo);
  }

  args.push("--interval-seconds", String(Math.round(intervalMs / 1000)));

  const child = spawn(process.execPath, args, {
    cwd: projectRoot,
    env: process.env,
    detached: true,
    windowsHide: true,
    stdio: isWin ? "ignore" : ["ignore", logHandle.fd, logHandle.fd]
  });

  child.unref();
  await fs.writeFile(pidPath, `${child.pid}\n`, "utf8");
  if (logHandle) await logHandle.close();

  const alive = await waitForWorkerStart(child.pid);
  if (!alive) {
    throw new Error("execute worker failed to start");
  }

  return child.pid;
}

export async function startExecuteWorker(options = {}) {
  const { logger = defaultLogger, workerIndex = 1, ...workerOptions } = options;
  const runtime = await inspectExecuteWorkerRuntime({ workerIndex });
  const action = inferExecuteWorkerAction({
    runtime
  });

  if (action.type === "reuse") {
    logger(`execute worker ${workerIndex} already running (pid ${action.pid})`);
    return runtime;
  }

  await ensureCleanPidFile(runtime, workerIndex);
  const pid = await startDetachedWorker({ ...workerOptions, workerIndex });
  logger(`execute worker ${workerIndex} started (pid ${pid})`);
  return inspectExecuteWorkerRuntime({ workerIndex });
}

export async function stopExecuteWorker({ logger = defaultLogger, workerIndex = 1 } = {}) {
  const runtime = await inspectExecuteWorkerRuntime({ workerIndex });

  if (runtime.running && runtime.pid) {
    try {
      process.kill(runtime.pid);
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "ESRCH") {
        throw error;
      }
    }

    await cleanupPidFile(workerIndex);
    logger(`execute worker ${workerIndex} stopped`);
    return inspectExecuteWorkerRuntime({ workerIndex });
  }

  await ensureCleanPidFile(runtime, workerIndex);
  logger(buildExecuteWorkerStatusLine(runtime));
  return inspectExecuteWorkerRuntime({ workerIndex });
}

export async function controlExecuteService({
  action,
  repo = null,
  intervalMs = defaultIntervalMs,
  workerIndex = 1,
  logger = () => {}
} = {}) {
  if (action === "start") {
    const runtime = await startExecuteWorker({
      repo,
      intervalMs,
      workerIndex,
      logger
    });

    return {
      ...runtime,
      detail: buildExecuteWorkerStatusLine(runtime)
    };
  }

  if (action === "stop") {
    const runtime = await stopExecuteWorker({
      workerIndex,
      logger
    });

    return {
      ...runtime,
      detail: buildExecuteWorkerStatusLine(runtime)
    };
  }

  const runtime = await inspectExecuteWorkerRuntime({ workerIndex });
  return {
    ...runtime,
    detail: buildExecuteWorkerStatusLine(runtime)
  };
}

async function printStatus({ logger = defaultLogger, workerIndex = 1 } = {}) {
  const runtime = await inspectExecuteWorkerRuntime({ workerIndex });
  logger(buildExecuteWorkerStatusLine(runtime));
  return runtime;
}

async function main() {
  const parsed = parseExecuteWorkerCliArgs(process.argv.slice(2));

  if (parsed.command === "start") {
    await startExecuteWorker(parsed);
    return;
  }

  if (parsed.command === "stop") {
    await stopExecuteWorker({ workerIndex: parsed.workerIndex });
    return;
  }

  if (parsed.command === "help") {
    console.log("usage: execute-service start [--repo owner/name] [--interval-seconds 60] [--worker N]");
    console.log("       execute-service stop [--worker N]");
    console.log("       execute-service status [--worker N]");
    return;
  }

  await printStatus({ workerIndex: parsed.workerIndex });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
