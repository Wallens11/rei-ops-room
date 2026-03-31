import path from "node:path";
import { fileURLToPath } from "node:url";

import { executeReportOnlyAction } from "./report-only-bridge.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_INTERVAL_SECONDS = 60;
const MIN_INTERVAL_SECONDS = 30;

function timestamp() {
  return new Date().toISOString();
}

function normalizeTargetNumber(target) {
  return Number(target?.number || 0) || 0;
}

export function createWorkerResultSignature(result = {}) {
  return `${result.status || "unknown"}:${normalizeTargetNumber(result.target)}`;
}

export function formatWorkerResultLine(result = {}) {
  const issueNumber = normalizeTargetNumber(result.target);
  const issueTitle = result?.target?.title ? ` ${result.target.title}` : "";
  const issueLabel = issueNumber > 0 ? ` #${issueNumber}${issueTitle}` : "";
  const detail = result.detail || "No detail provided.";

  return `[${timestamp()}] report-only worker ${result.status || "unknown"}${issueLabel} | ${detail}`;
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

async function sleepWithSignal(ms, signal) {
  if (ms <= 0) {
    return;
  }

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);

    function onAbort() {
      cleanup();
      const error = new Error("Worker aborted");
      error.name = "AbortError";
      reject(error);
    }

    function cleanup() {
      clearTimeout(timeout);
      signal?.removeEventListener?.("abort", onAbort);
    }

    if (signal?.aborted) {
      onAbort();
      return;
    }

    signal?.addEventListener?.("abort", onAbort, {
      once: true
    });
  });
}

export async function runReportOnlyWorker({
  executeAction = executeReportOnlyAction,
  cwd = path.resolve(__dirname, ".."),
  repo = null,
  once = false,
  intervalMs = DEFAULT_INTERVAL_SECONDS * 1000,
  maxRuns = Number.POSITIVE_INFINITY,
  sleep = sleepWithSignal,
  signal = null,
  stdout = process.stdout
} = {}) {
  let lastSignature = null;
  let runs = 0;

  if (!once) {
    stdout.write(
      `[${timestamp()}] report-only worker watching ${repo || "origin repo"} every ${Math.round(
        intervalMs / 1000
      )}s\n`
    );
  }

  while (runs < maxRuns) {
    if (signal?.aborted) {
      return 0;
    }

    const result = await executeAction({
      cwd,
      repo
    });
    const signature = createWorkerResultSignature(result);

    if (signature !== lastSignature) {
      stdout.write(`${formatWorkerResultLine(result)}\n`);
      lastSignature = signature;
    }

    runs += 1;

    if (once || runs >= maxRuns) {
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

  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = parseArgs(process.argv.slice(2));
  const controller = new AbortController();
  const handleStop = () => controller.abort();

  process.on("SIGINT", handleStop);
  process.on("SIGTERM", handleStop);

  runReportOnlyWorker({
    ...options,
    signal: controller.signal
  })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    })
    .finally(() => {
      process.off("SIGINT", handleStop);
      process.off("SIGTERM", handleStop);
    });
}
