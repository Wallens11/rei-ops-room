/**
 * execute-queue.mjs — Direct task queue + multi-worker registry.
 *
 * Dua tanggung jawab:
 *   1. Task queue  — terima task dari /api/execute/submit tanpa butuh GitHub issue.
 *   2. Workers registry — tiap execute-worker instance register dirinya supaya
 *      UI bisa tampilkan berapa Rei aktif dan pakai runtime apa.
 *
 * Persistent via file JSON di project root (excluded dari git via .gitignore).
 *
 * Cross-session note (buat LLM lain yang lanjut):
 *   - Queue file: .execute-queue.json
 *   - Workers file: .execute-workers.json
 *   - Worker bisa di-wake via SIGUSR1 setelah task di-submit
 *     (server.mjs kirim sinyal ke PID dari .execute-worker.pid)
 */

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { executeWorkerPidFile, projectRoot } from "./execute-worker-state.mjs";

export const executeQueueFile = path.join(projectRoot, ".execute-queue.json");
export const executeWorkersFile = path.join(projectRoot, ".execute-workers.json");

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

/**
 * Baca semua tasks dari queue.
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
 * Tambah task baru ke queue.
 *
 * @param task      — deskripsi task (required)
 * @param context   — konteks tambahan (optional, misal "ini untuk repo X")
 * @param runtimeId — override runtime: "codex" | "claude-code" | null (auto-select)
 *
 * Return: task entry yang baru dibuat.
 */
export async function enqueueTask({ task, context = null, runtimeId = null } = {}) {
  const tasks = await readQueue();

  const entry = {
    id: crypto.randomUUID(),
    task: String(task || "").trim(),
    context: context ? String(context).trim() : null,
    runtimeId: runtimeId || null,
    submittedAt: new Date().toISOString(),
    status: "queued",
    startedAt: null,
    finishedAt: null,
    result: null
  };

  tasks.push(entry);
  await saveQueue(tasks);
  return entry;
}

/**
 * Ambil task pertama yang status-nya "queued" dan tandai sebagai "in_progress".
 * Atomic dalam satu proses (file lock tidak dipakai — single-worker assumption).
 * Return: task entry atau null kalau queue kosong.
 */
export async function claimNextQueuedTask() {
  const tasks = await readQueue();
  const next = tasks.find((t) => t.status === "queued");

  if (!next) return null;

  next.status = "in_progress";
  next.startedAt = new Date().toISOString();
  await saveQueue(tasks);
  return next;
}

/**
 * Tandai task sebagai selesai (done atau failed).
 *
 * @param id     — task ID
 * @param status — "done" | "failed"
 * @param result — ringkasan hasil eksekusi (string)
 */
export async function resolveQueueTask(id, { status, result = null } = {}) {
  const tasks = await readQueue();
  const task = tasks.find((t) => t.id === id);

  if (!task) return;

  task.status = status;
  task.result = result ? String(result).trim() : null;
  task.finishedAt = new Date().toISOString();
  await saveQueue(tasks);
}

/**
 * Kembalikan task in_progress ke queued (misalnya kalau worker crash).
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
 * Baca registry worker aktif.
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
 * Register worker baru ke registry.
 * Kalau workerId sudah ada (restart), entry lama di-replace.
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
 * Update apa yang sedang dikerjakan worker (task queue atau GitHub issue).
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
 * Hapus worker dari registry (dipanggil saat worker exit).
 */
export async function unregisterWorker(workerId) {
  const workers = await readWorkers();
  await saveWorkers(workers.filter((w) => w.workerId !== workerId));
}

// ─── Wake signal ─────────────────────────────────────────────────────────────

/**
 * Kirim SIGUSR1 ke execute worker yang sedang running supaya skip sleep
 * dan langsung proses task baru di queue.
 *
 * Dibaca dari .execute-worker.pid — kalau file tidak ada atau PID tidak valid,
 * tidak ada efek (worker akan pick up di poll berikutnya).
 */
export async function signalWorkerWake() {
  try {
    const pidText = await fs.readFile(executeWorkerPidFile, "utf8");
    const pid = Number(pidText.trim());

    if (!Number.isFinite(pid) || pid <= 0) return false;

    process.kill(pid, "SIGUSR1");
    return true;
  } catch {
    return false;
  }
}
