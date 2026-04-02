import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_INTERVAL_SECONDS = 60;
const MIN_INTERVAL_SECONDS = 30;
const DEFAULT_CODEX_CANDIDATES = ["/Applications/Codex.app/Contents/Resources/codex"];

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

async function runCodexMission({
  codexCommand = null,
  repoCwd,
  prompt,
  runDir,
  signal = null,
  onChildPid = () => {}
} = {}) {
  await fs.mkdir(runDir, {
    recursive: true
  });
  const promptFile = path.join(runDir, "prompt.md");
  const outputLastMessageFile = path.join(runDir, "last-message.md");
  const eventsFile = path.join(runDir, "events.jsonl");
  await fs.writeFile(promptFile, `${prompt}\n`, "utf8");
  const resolvedCodexCommand = codexCommand || (await resolveCodexCommand());
  const invocation = buildCodexExecInvocation({
    codexCommand: resolvedCodexCommand,
    repoCwd,
    outputLastMessageFile
  });

  return await new Promise((resolve, reject) => {
    const child = spawn(invocation.command, invocation.args, {
      cwd: projectRoot,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"]
    });
    const stream = createWriteStream(eventsFile, {
      flags: "a"
    });
    let aborted = false;
    let finished = false;

    onChildPid(child.pid || null);

    child.stdout.on("data", (chunk) => {
      stream.write(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stream.write(chunk);
    });

    child.on("error", (error) => {
      if (finished) {
        return;
      }

      finished = true;
      stream.end();
      reject(error);
    });

    child.on("close", (exitCode, exitSignal) => {
      if (finished) {
        return;
      }

      finished = true;
      stream.end();
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
        if (!finished) {
          child.kill("SIGKILL");
        }
      }, 1_000).unref();
    };

    if (signal?.aborted) {
      abortHandler();
    } else {
      signal?.addEventListener?.("abort", abortHandler, {
        once: true
      });
    }

    child.stdin.end(prompt);
  });
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
  codexCommand = "codex",
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

  if (preview.target.status === "todo") {
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
      repoCwd: cwd
    })
  });

  await fs.mkdir(executeRunsDir, {
    recursive: true
  });
  const runDir = path.join(executeRunsDir, createRunDirName(preview.issue));
  await onStateChange({
    status: "launching",
    currentTarget: preview.target,
    currentChildPid: null,
    currentRunDir: runDir,
    detail: `Launching Codex for issue #${preview.target.number}.`
  });

  const mission = await runCodexMission({
    codexCommand,
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
        detail: `Codex is running issue #${preview.target.number}.`
      });
    }
  });
  const lastMessage = await readTextIfExists(mission.outputLastMessageFile);

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

  if (mission.exitCode === 0) {
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
  codexCommand = "codex",
  runner = undefined,
  executeAction = executeNextIssue,
  sleep = sleepWithSignal
} = {}) {
  let lastSignature = null;

  if (!once) {
    stdout.write(
      `[${timestamp()}] execute worker watching ${repo || "origin repo"} every ${Math.round(
        intervalMs / 1000
      )}s\n`
    );
  }

  const persistState = async (nextState) => {
    await writeExecuteWorkerState(nextState);
  };

  while (true) {
    if (signal?.aborted) {
      return 0;
    }

    const result = await executeAction({
      cwd,
      repo,
      signal,
      codexCommand,
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
