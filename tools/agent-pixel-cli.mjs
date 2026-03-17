import { execFile, spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const pidFile = path.join(projectRoot, ".agent-pixel.pid");
const logFile = path.join(projectRoot, ".agent-pixel.log");
const defaultPort = 4317;

export function normalizeMode(mode) {
  return mode === "widget" ? "widget" : "room";
}

export function buildViewerUrl({ port = defaultPort, mode = "room" }) {
  const normalized = normalizeMode(mode);
  return `http://localhost:${port}/?mode=${normalized}`;
}

export function inferServerRuntime({
  reachable = false,
  pidFilePid = null,
  pidFileAlive = false,
  pidFileCommand = "",
  listenerPid = null,
  listenerCommand = ""
}) {
  const pidLooksLikeAgent = pidFileAlive && pidFileCommand.includes("server.mjs");
  const listenerLooksLikeAgent = Boolean(listenerPid) && listenerCommand.includes("server.mjs");

  if (reachable) {
    return {
      running: true,
      pid: listenerPid || pidFilePid || null,
      source: "http"
    };
  }

  if (listenerLooksLikeAgent) {
    return {
      running: true,
      pid: listenerPid,
      source: "listener"
    };
  }

  if (pidLooksLikeAgent) {
    return {
      running: true,
      pid: pidFilePid,
      source: "pid"
    };
  }

  return {
    running: false,
    pid: null,
    source: "none"
  };
}

export function parseCliArgs(argv) {
  const args = [...argv];
  let command = "activate";
  let mode = "room";
  let open = true;
  let port = defaultPort;

  if (args[0] && !args[0].startsWith("--")) {
    command = args.shift();
  }

  if (command === "room" || command === "widget") {
    mode = normalizeMode(command);
    command = "activate";
  } else if (args[0] && !args[0].startsWith("--")) {
    mode = normalizeMode(args.shift());
  }

  while (args.length > 0) {
    const current = args.shift();

    if (current === "--no-open") {
      open = false;
      continue;
    }

    if (current === "--open") {
      open = true;
      continue;
    }

    if (current === "--port") {
      port = Number(args.shift() || defaultPort);
      continue;
    }
  }

  return {
    command,
    mode,
    open,
    port
  };
}

async function isServerRunning(port) {
  try {
    const response = await fetch(`http://localhost:${port}/api/status`, {
      signal: AbortSignal.timeout(1500)
    });
    return response.ok;
  } catch {
    return false;
  }
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

async function readListenerPid(port) {
  try {
    const { stdout } = await execFileAsync("lsof", [
      "-nP",
      "-t",
      `-iTCP:${port}`,
      "-sTCP:LISTEN"
    ]);
    const pid = Number(stdout.trim().split(/\s+/)[0]);
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

async function inspectServerRuntime(port) {
  const [reachable, pidFilePid, listenerPid] = await Promise.all([
    isServerRunning(port),
    readPidFile(),
    readListenerPid(port)
  ]);
  const pidFileAlive = isProcessAlive(pidFilePid);
  const [pidFileCommand, listenerCommand] = await Promise.all([
    readProcessCommand(pidFilePid),
    listenerPid === pidFilePid ? Promise.resolve("") : readProcessCommand(listenerPid)
  ]);
  const mergedListenerCommand =
    listenerPid && listenerPid === pidFilePid && pidFileCommand ? pidFileCommand : listenerCommand;
  const runtime = inferServerRuntime({
    reachable,
    pidFilePid,
    pidFileAlive,
    pidFileCommand,
    listenerPid,
    listenerCommand: mergedListenerCommand
  });

  return {
    ...runtime,
    reachable,
    pidFilePid,
    pidFileAlive,
    listenerPid,
    pidFileCommand,
    listenerCommand: mergedListenerCommand
  };
}

async function syncPid(runtime) {
  if (!runtime.pid) {
    await fs.rm(pidFile, { force: true });
    return;
  }

  await fs.writeFile(pidFile, `${runtime.pid}\n`, "utf8");
}

async function waitForServer(port, attempts = 30) {
  for (let index = 0; index < attempts; index += 1) {
    if (await isServerRunning(port)) {
      return true;
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  return false;
}

async function startDetachedServer(port) {
  await fs.mkdir(projectRoot, { recursive: true });
  const logHandle = await fs.open(logFile, "a");
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: projectRoot,
    env: {
      ...process.env,
      PORT: String(port)
    },
    detached: true,
    stdio: ["ignore", logHandle.fd, logHandle.fd]
  });

  child.unref();
  await fs.writeFile(pidFile, `${child.pid}\n`, "utf8");
  await logHandle.close();

  const ready = await waitForServer(port);
  if (!ready) {
    throw new Error(`Pixel agent server failed to start on port ${port}`);
  }
}

async function openViewer(url) {
  if (process.platform === "darwin") {
    await execFileAsync("open", [url]);
    return;
  }

  if (process.platform === "win32") {
    await execFileAsync("cmd", ["/c", "start", "", url]);
    return;
  }

  await execFileAsync("xdg-open", [url]);
}

async function activate({ port, mode, open }) {
  const runtime = await inspectServerRuntime(port);

  if (!runtime.running) {
    await startDetachedServer(port);
  } else {
    await syncPid(runtime);
    if (!runtime.reachable) {
      const ready = await waitForServer(port, 12);
      if (!ready) {
        throw new Error(
          `Port ${port} is held by the pixel agent process, but /api/status is not responding`
        );
      }
    }
  }

  const url = buildViewerUrl({ port, mode });

  if (open) {
    await openViewer(url);
  }

  console.log(`agent pixel active: ${url}`);
}

async function stopServer(port) {
  const runtime = await inspectServerRuntime(port);
  const targetPid =
    runtime.listenerPid && runtime.listenerCommand.includes("server.mjs")
      ? runtime.listenerPid
      : runtime.pidFileAlive && runtime.pidFileCommand.includes("server.mjs")
        ? runtime.pidFilePid
        : null;

  if (targetPid) {
    process.kill(targetPid);
    await fs.rm(pidFile, { force: true });
    console.log("agent pixel stopped");
    return;
  }

  await fs.rm(pidFile, { force: true });
  console.log("agent pixel was not running");
}

async function printStatus(port) {
  const runtime = await inspectServerRuntime(port);
  console.log(
    runtime.running
      ? `agent pixel running at ${buildViewerUrl({ port, mode: "room" })}`
      : "agent pixel is not running"
  );
}

async function main() {
  const parsed = parseCliArgs(process.argv.slice(2));

  if (parsed.command === "stop") {
    await stopServer(parsed.port);
    return;
  }

  if (parsed.command === "status") {
    await printStatus(parsed.port);
    return;
  }

  if (parsed.command === "help") {
    console.log("usage: agent-pixel [activate] [room|widget] [--no-open] [--port 4317]");
    console.log("       agent-pixel stop");
    console.log("       agent-pixel status");
    return;
  }

  await activate(parsed);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
