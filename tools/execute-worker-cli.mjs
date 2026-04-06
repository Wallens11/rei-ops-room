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

export function parseExecuteWorkerCliArgs(argv) {
  const args = [...argv];
  let command = "status";
  let repo = null;
  let intervalMs = defaultIntervalMs;

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
    }
  }

  return {
    command,
    repo,
    intervalMs
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

async function readPidFile() {
  try {
    const pidText = await fs.readFile(executeWorkerPidFile, "utf8");
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

export async function inspectExecuteWorkerRuntime() {
  const pidFilePid = await readPidFile();
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
    status: state?.status || "idle",
    currentTarget: state?.currentTarget || null,
    lastResult: state?.lastResult || null
  };
}

async function cleanupPidFile() {
  await fs.rm(executeWorkerPidFile, {
    force: true
  });
}

async function ensureCleanPidFile(runtime) {
  if (runtime.source === "stale_pid" || runtime.source === "foreign_pid") {
    await cleanupPidFile();
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

async function startDetachedWorker({ repo = null, intervalMs = defaultIntervalMs }) {
  await fs.mkdir(projectRoot, {
    recursive: true
  });
  const logHandle = await fs.open(executeWorkerLogFile, "a");
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
    stdio: ["ignore", logHandle.fd, logHandle.fd]
  });

  child.unref();
  await fs.writeFile(executeWorkerPidFile, `${child.pid}\n`, "utf8");
  await logHandle.close();

  const alive = await waitForWorkerStart(child.pid);
  if (!alive) {
    throw new Error("execute worker failed to start");
  }

  return child.pid;
}

export async function startExecuteWorker(options = {}) {
  const { logger = defaultLogger, ...workerOptions } = options;
  const runtime = await inspectExecuteWorkerRuntime();
  const action = inferExecuteWorkerAction({
    runtime
  });

  if (action.type === "reuse") {
    logger(`execute worker already running (pid ${action.pid})`);
    return runtime;
  }

  await ensureCleanPidFile(runtime);
  const pid = await startDetachedWorker(workerOptions);
  logger(`execute worker started (pid ${pid})`);
  return inspectExecuteWorkerRuntime();
}

export async function stopExecuteWorker({ logger = defaultLogger } = {}) {
  const runtime = await inspectExecuteWorkerRuntime();

  if (runtime.running && runtime.pid) {
    try {
      process.kill(runtime.pid);
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "ESRCH") {
        throw error;
      }
    }

    await cleanupPidFile();
    logger("execute worker stopped");
    return inspectExecuteWorkerRuntime();
  }

  await ensureCleanPidFile(runtime);
  logger(buildExecuteWorkerStatusLine(runtime));
  return inspectExecuteWorkerRuntime();
}

export async function controlExecuteService({
  action,
  repo = null,
  intervalMs = defaultIntervalMs,
  logger = () => {}
} = {}) {
  if (action === "start") {
    const runtime = await startExecuteWorker({
      repo,
      intervalMs,
      logger
    });

    return {
      ...runtime,
      detail: buildExecuteWorkerStatusLine(runtime)
    };
  }

  if (action === "stop") {
    const runtime = await stopExecuteWorker({
      logger
    });

    return {
      ...runtime,
      detail: buildExecuteWorkerStatusLine(runtime)
    };
  }

  const runtime = await inspectExecuteWorkerRuntime();
  return {
    ...runtime,
    detail: buildExecuteWorkerStatusLine(runtime)
  };
}

async function printStatus({ logger = defaultLogger } = {}) {
  const runtime = await inspectExecuteWorkerRuntime();
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
    await stopExecuteWorker();
    return;
  }

  if (parsed.command === "help") {
    console.log("usage: execute-service start [--repo owner/name] [--interval-seconds 60]");
    console.log("       execute-service stop");
    console.log("       execute-service status");
    return;
  }

  await printStatus();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
