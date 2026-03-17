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
      signal: AbortSignal.timeout(1000)
    });
    return response.ok;
  } catch {
    return false;
  }
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
  if (!(await isServerRunning(port))) {
    await startDetachedServer(port);
  }

  const url = buildViewerUrl({ port, mode });

  if (open) {
    await openViewer(url);
  }

  console.log(`agent pixel active: ${url}`);
}

async function stopServer() {
  try {
    const pidText = await fs.readFile(pidFile, "utf8");
    const pid = Number(pidText.trim());
    if (pid) {
      process.kill(pid);
    }
    await fs.rm(pidFile, { force: true });
    console.log("agent pixel stopped");
  } catch {
    console.log("agent pixel was not running");
  }
}

async function printStatus(port) {
  const running = await isServerRunning(port);
  console.log(
    running
      ? `agent pixel running at ${buildViewerUrl({ port, mode: "room" })}`
      : "agent pixel is not running"
  );
}

async function main() {
  const parsed = parseCliArgs(process.argv.slice(2));

  if (parsed.command === "stop") {
    await stopServer();
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
