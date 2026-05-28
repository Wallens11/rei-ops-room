/**
 * execute-queue.mjs — Direct task queue + multi-worker registry.
 *
 * Two responsibilities:
 *   1. Task queue  — accept tasks from /api/execute/submit without needing a GitHub issue.
 *   2. Workers registry — each execute-worker instance registers itself so
 *      the UI can show how many Rei workers are active and which runtime they use.
 *
 * Persistent via JSON file in the project root (excluded from git via .gitignore).
 *
 * Cross-session note (for other LLMs continuing this work):
 *   - Queue file: .execute-queue.json
 *   - Workers file: .execute-workers.json
 *   - Worker can be woken via SIGUSR1 after a task is submitted
 *     (server.mjs sends the signal to the PID from .execute-worker.pid)
 */

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { executeWorkerPidFile, projectRoot } from "./execute-worker-state.mjs";

export const executeQueueFile = path.join(projectRoot, ".execute-queue.json");
export const executeWorkersFile = path.join(projectRoot, ".execute-workers.json");
export const executeWakeTriggerFile = path.join(projectRoot, ".execute-wake.trigger");
export const executeQueueLockFile = path.join(projectRoot, ".execute-queue.lock");

// ─── Queue lock (multi-worker coordination) ───────────────────────────────────
// Uses atomic file create (O_EXCL) so only one worker can claim a task at a time.
// The lock has a TTL — stale locks (> 5s) are stolen to avoid blocking forever
// if a worker crashes while holding the lock.

const LOCK_TTL_MS = 5_000;
const LOCK_WAIT_MS = 100;
const LOCK_TIMEOUT_MS = 3_000;

async function withQueueLock(fn) {
  const deadline = Date.now() + LOCK_TIMEOUT_MS;

  while (true) {
    try {
      // O_EXCL → atomic: succeeds only if the file doesn't yet exist
      const fd = await fs.open(executeQueueLockFile, "wx");
      await fd.writeFile(String(process.pid), "utf8");
      await fd.close();
      break; // lock acquired
    } catch (e) {
      if (e.code !== "EEXIST") throw e;

      // Lock exists — check whether it's stale
      try {
        const stat = await fs.stat(executeQueueLockFile);
        if (Date.now() - stat.mtimeMs > LOCK_TTL_MS) {
          await fs.rm(executeQueueLockFile, { force: true });
          continue; // retry immediately
        }
      } catch { /* file may have been removed by another worker — retry */ }

      if (Date.now() >= deadline) {
        throw new Error("execute-queue: lock timeout after 3s");
      }
      await new Promise((r) => setTimeout(r, LOCK_WAIT_MS));
    }
  }

  try {
    return await fn();
  } finally {
    await fs.rm(executeQueueLockFile, { force: true }).catch(() => {});
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function readJson(filePath, fallback) {
  try {
    const text = await fs.readFile(filePath, "utf8");
    return JSON.parse(text);
  } catch (error) {
    if (error?.code === "ENOENT") return fallback;
    throw error;
  }
}

async function writeJson(filePath, data) {
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

// ─── Task Queue ───────────────────────────────────────────────────────────────

/** How many done/failed tasks to retain after pruning. */
export const QUEUE_KEEP_COMPLETED = 20;

/**
 * Remove old done/failed entries so the queue file doesn't grow indefinitely.
 * Retains all queued/in_progress + the QUEUE_KEEP_COMPLETED most recent
 * done/failed entries (sorted by finishedAt descending).
 */
async function pruneQueue() {
  const tasks = await readQueue();
  const active = tasks.filter(
    (t) => t.status === "queued" || t.status === "in_progress"
  );
  const finished = tasks
    .filter((t) => t.status === "done" || t.status === "failed")
    .sort((a, b) => new Date(b.finishedAt || 0) - new Date(a.finishedAt || 0))
    .slice(0, QUEUE_KEEP_COMPLETED);

  const pruned = [...active, ...finished];
  if (pruned.length < tasks.length) {
    await saveQueue(pruned);
  }
}

/**
 * Read all tasks from the queue.
 * Return: array of task objects.
 */
export async function readQueue() {
  const data = await readJson(executeQueueFile, { tasks: [] });
  return Array.isArray(data?.tasks) ? data.tasks : [];
}

async function saveQueue(tasks) {
  await writeJson(executeQueueFile, { tasks });
}

/**
 * Add a new task to the queue.
 *
 * @param task              — task description (required)
 * @param context           — additional context (optional, e.g. "this is for repo X")
 * @param runtimeId         — runtime override: "codex" | "claude-code" | null (auto-select)
 * @param priority          — priority number: higher = runs sooner (default 0)
 * @param parentIssueNumber — GitHub issue number that spawned this task (optional)
 * @param spawnedBy         — identifier of who spawned this task (optional, e.g. "agent")
 *
 * Return: the newly created task entry.
 */
export async function enqueueTask({ task, context = null, runtimeId = null, priority = 0, parentIssueNumber = null, spawnedBy = null } = {}) {
  const tasks = await readQueue();

  const entry = {
    id: crypto.randomUUID(),
    task: String(task || "").trim(),
    context: context ? String(context).trim() : null,
    runtimeId: runtimeId || null,
    priority: Number.isFinite(Number(priority)) ? Number(priority) : 0,
    parentIssueNumber: parentIssueNumber ? Number(parentIssueNumber) : null,
    spawnedBy: spawnedBy ? String(spawnedBy) : null,
    submittedAt: new Date().toISOString(),
    status: "queued",
    startedAt: null,
    finishedAt: null,
    result: null,
    retryCount: 0,
    maxRetries: 2,
    retryAfter: null
  };

  tasks.push(entry);
  await saveQueue(tasks);
  return entry;
}

/**
 * Submit a task from an agent spawn request.
 * Maps the spawn-request fields to the queue task format.
 *
 * @param title             — task title (used as `task`)
 * @param body              — full instructions (used as `context`)
 * @param runtimeId         — runtime override (optional)
 * @param parentIssueNumber — parent GitHub issue number (optional)
 * @param spawnedBy         — origin identifier, e.g. "agent" (optional)
 *
 * Return: task entry that was created.
 */
export async function submitQueueTask({ title, body = null, runtimeId = null, parentIssueNumber = null, spawnedBy = null } = {}) {
  return enqueueTask({
    task: String(title || "").trim(),
    context: body ? String(body).trim() : null,
    runtimeId: runtimeId || null,
    parentIssueNumber,
    spawnedBy
  });
}

/**
 * Claim the first task with status "queued" and mark it as "in_progress".
 * Wrapped with a file lock for safe multi-worker access.
 * Tasks with a future `retryAfter` are skipped (still in cooldown).
 * Return: task entry or null if the queue is empty / all tasks are in cooldown.
 */
export async function claimNextQueuedTask() {
  return withQueueLock(async () => {
    const tasks = await readQueue();
    const now = Date.now();
    const eligible = tasks.filter(
      (t) => t.status === "queued" &&
        (!t.retryAfter || new Date(t.retryAfter).getTime() <= now)
    );

    if (eligible.length === 0) return null;

    // Sort: priority desc (higher runs first), then submittedAt asc (FIFO tiebreak)
    eligible.sort((a, b) => {
      const pa = Number(a.priority) || 0;
      const pb = Number(b.priority) || 0;
      if (pb !== pa) return pb - pa;
      return new Date(a.submittedAt).getTime() - new Date(b.submittedAt).getTime();
    });

    const next = eligible[0];
    next.status = "in_progress";
    next.startedAt = new Date().toISOString();
    await saveQueue(tasks);
    return next;
  });
}

/**
 * Reschedule a failed task with exponential backoff.
 * If retryCount exceeds maxRetries → mark as "failed".
 *
 * @param id     — task ID
 * @param result — result summary (saved on permanent failure)
 * Return: true if retried, false if permanently failed.
 */
export async function requeueForRetry(id, { result = null } = {}) {
  const tasks = await readQueue();
  const task = tasks.find((t) => t.id === id);
  if (!task) return false;

  const retryCount = (task.retryCount || 0) + 1;
  const maxRetries = task.maxRetries ?? 2;

  if (retryCount > maxRetries) {
    // Retry quota exhausted — mark as permanent failure
    task.status = "failed";
    task.result = result ? String(result).trim() : null;
    task.finishedAt = new Date().toISOString();
    await saveQueue(tasks);
    await pruneQueue();
    return false;
  }

  // Backoff: 30s → 60s (2^(n-1) * 30s)
  const backoffMs = 30_000 * (2 ** (retryCount - 1));
  task.status = "queued";
  task.retryCount = retryCount;
  task.startedAt = null;
  task.retryAfter = new Date(Date.now() + backoffMs).toISOString();
  await saveQueue(tasks);
  return true;
}

/**
 * Mark a task as finished (done or failed).
 *
 * @param id     — task ID
 * @param status — "done" | "failed"
 * @param result — execution result summary (string)
 */
export async function resolveQueueTask(id, { status, result = null } = {}) {
  const tasks = await readQueue();
  const task = tasks.find((t) => t.id === id);

  if (!task) return;

  task.status = status;
  task.result = result ? String(result).trim() : null;
  task.finishedAt = new Date().toISOString();
  await saveQueue(tasks);
  await pruneQueue();
}

/**
 * Remove a task from the queue by ID.
 * Only tasks with status "queued" or "failed" can be removed.
 * Tasks that are "in_progress" cannot be removed (requires killing the child process first).
 *
 * Return: { removed: true } or { removed: false, reason: "not_found"|"in_progress" }
 */
export async function removeQueueTask(id) {
  const tasks = await readQueue();
  const task = tasks.find((t) => t.id === id);

  if (!task) return { removed: false, reason: "not_found" };
  if (task.status === "in_progress") return { removed: false, reason: "in_progress" };

  const filtered = tasks.filter((t) => t.id !== id);
  await saveQueue(filtered);
  return { removed: true };
}

/**
 * Return an in_progress task back to queued state (e.g. when the worker crashes).
 */
export async function requeueStuckTask(id) {
  const tasks = await readQueue();
  const task = tasks.find((t) => t.id === id && t.status === "in_progress");

  if (!task) return;

  task.status = "queued";
  task.startedAt = null;
  await saveQueue(tasks);
}

// ─── Workers Registry ─────────────────────────────────────────────────────────

/**
 * Read the active worker registry.
 * Return: array of worker objects.
 */
export async function readWorkers() {
  const data = await readJson(executeWorkersFile, { workers: [] });
  return Array.isArray(data?.workers) ? data.workers : [];
}

async function saveWorkers(workers) {
  await writeJson(executeWorkersFile, { workers });
}

/**
 * Register a new worker in the registry.
 * If the workerId already exists (restart), the old entry is replaced.
 */
export async function registerWorker({ workerId, pid, runtimeId = null } = {}) {
  const workers = await readWorkers();
  const filtered = workers.filter((w) => w.workerId !== workerId);

  filtered.push({
    workerId,
    pid,
    runtimeId,
    registeredAt: new Date().toISOString(),
    currentTaskId: null,
    currentIssueNumber: null,
    currentRuntimeId: null
  });

  await saveWorkers(filtered);
}

/**
 * Update what the worker is currently processing (task queue or GitHub issue).
 */
export async function updateWorkerActivity(workerId, {
  taskId = null,
  issueNumber = null,
  runtimeId = null
} = {}) {
  const workers = await readWorkers();
  const worker = workers.find((w) => w.workerId === workerId);

  if (worker) {
    worker.currentTaskId = taskId;
    worker.currentIssueNumber = issueNumber;
    worker.currentRuntimeId = runtimeId;
    worker.updatedAt = new Date().toISOString();
  }

  await saveWorkers(workers);
}

/**
 * Remove a worker from the registry (called when the worker exits).
 */
export async function unregisterWorker(workerId) {
  const workers = await readWorkers();
  await saveWorkers(workers.filter((w) => w.workerId !== workerId));
}

// ─── Wake signal (cross-platform) ────────────────────────────────────────────

/**
 * Wake the execute worker so it processes the task immediately without waiting for the interval.
 *
 * Two mechanisms are used simultaneously:
 *   1. Trigger file (.execute-wake.trigger) — works on all platforms.
 *      The worker checks this file every 2s during sleep and skips ahead if found.
 *   2. SIGUSR1 — fast-path on Mac/Linux. Ignored on Windows (no crash).
 *
 * If the worker isn't running, the trigger file is persisted and will be read
 * when the worker starts in the next iteration.
 */
export async function signalWorkerWake() {
  // 1. Write trigger file — cross-platform, always works
  try {
    await fs.writeFile(executeWakeTriggerFile, new Date().toISOString(), "utf8");
  } catch {
    // ignore — trigger file is best-effort
  }

  // 2. SIGUSR1 as fast-path on Unix (ignore errors on Windows)
  try {
    const pidText = await fs.readFile(executeWorkerPidFile, "utf8");
    const pid = Number(pidText.trim());
    if (Number.isFinite(pid) && pid > 0) {
      process.kill(pid, "SIGUSR1");
    }
  } catch {
    // Windows: SIGUSR1 is not available — the trigger file is sufficient
  }

  return true;
}

/**
 * Check whether the trigger file exists and remove it after reading.
 * Called by the worker on every poll chunk during sleep.
 * Return: true if the trigger exists (worker should wake up immediately).
 */
export async function checkAndClearWakeTrigger() {
  try {
    await fs.access(executeWakeTriggerFile);
    await fs.rm(executeWakeTriggerFile, { force: true });
    return true;
  } catch {
    return false;
  }
}
