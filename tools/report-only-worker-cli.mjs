import { execFile, spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const pidFile = path.join(projectRoot, ".report-only-worker.pid");
const logFile = path.join(projectRoot, ".report-only-worker.log");
const defaultIntervalMs = 60_000;
const minIntervalMs = 30_000;

export function parseWorkerCliArgs(argv) {
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

export function inferWorkerRuntime({
  pidFilePid = null,
  pidFileAlive = false,
  pidFileCommand = ""
} = {}) {
  const looksLikeWorker = pidFileAlive && pidFileCommand.includes("report-only-worker.mjs");

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

export function inferWorkerAction({ runtime }) {
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

export function buildWorkerStatusLine(runtime) {
  if (runtime.running) {
    return `report-only worker running (pid ${runtime.pid})`;
  }

  if (runtime.source === "stale_pid") {
    return "report-only worker is not running (stale pid file)";
  }

  if (runtime.source === "foreign_pid") {
    return "report-only worker pid file points at a different live process";
  }

  return "report-only worker is not running";
}

function defaultLogger(message) {
  console.log(message);
}

async function readPidFile() {
  try {
    const pidText = await fs.readFile(pidFile, "utf8");
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

export async function inspectWorkerRuntime() {
  const pidFilePid = await readPidFile();
  const pidFileAlive = isProcessAlive(pidFilePid);
  const pidFileCommand = await readProcessCommand(pidFilePid);

  return {
    ...inferWorkerRuntime({
      pidFilePid,
      pidFileAlive,
      pidFileCommand
    }),
    pidFilePid,
    pidFileAlive,
    pidFileCommand
  };
}

async function cleanupPidFile() {
  await fs.rm(pidFile, {
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
  const logHandle = await fs.open(logFile, "a");
  const args = ["tools/report-only-worker.mjs"];

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
  await fs.writeFile(pidFile, `${child.pid}\n`, "utf8");
  await logHandle.close();

  const alive = await waitForWorkerStart(child.pid);
  if (!alive) {
    throw new Error("report-only worker failed to start");
  }

  return child.pid;
}

export async function startWorker(options = {}) {
  const {
    logger = defaultLogger,
    ...workerOptions
  } = options;
  const runtime = await inspectWorkerRuntime();
  const action = inferWorkerAction({
    runtime
  });

  if (action.type === "reuse") {
    logger(`report-only worker already running (pid ${action.pid})`);
    return runtime;
  }

  await ensureCleanPidFile(runtime);
  const pid = await startDetachedWorker(workerOptions);
  logger(`report-only worker started (pid ${pid})`);
  return inspectWorkerRuntime();
}

export async function stopWorker({ logger = defaultLogger } = {}) {
  const runtime = await inspectWorkerRuntime();

  if (runtime.running && runtime.pid) {
    try {
      process.kill(runtime.pid);
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "ESRCH") {
        throw error;
      }
    }

    await cleanupPidFile();
    logger("report-only worker stopped");
    return inspectWorkerRuntime();
  }

  await ensureCleanPidFile(runtime);
  logger(buildWorkerStatusLine(runtime));
  return inspectWorkerRuntime();
}

export async function printStatus({ logger = defaultLogger } = {}) {
  const runtime = await inspectWorkerRuntime();
  logger(buildWorkerStatusLine(runtime));
  return runtime;
}

export async function controlReportOnlyService({
  action,
  repo = null,
  intervalMs = defaultIntervalMs,
  logger = () => {}
} = {}) {
  if (action === "start") {
    const runtime = await startWorker({
      repo,
      intervalMs,
      logger
    });

    return {
      ...runtime,
      detail: buildWorkerStatusLine(runtime)
    };
  }

  if (action === "stop") {
    const runtime = await stopWorker({
      logger
    });

    return {
      ...runtime,
      detail: buildWorkerStatusLine(runtime)
    };
  }

  const runtime = await inspectWorkerRuntime();
  return {
    ...runtime,
    detail: buildWorkerStatusLine(runtime)
  };
}

async function main() {
  const parsed = parseWorkerCliArgs(process.argv.slice(2));

  if (parsed.command === "start") {
    await startWorker(parsed);
    return;
  }

  if (parsed.command === "stop") {
    await stopWorker();
    return;
  }

  if (parsed.command === "help") {
    console.log("usage: report-only-service start [--repo owner/name] [--interval-seconds 60]");
    console.log("       report-only-service stop");
    console.log("       report-only-service status");
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
