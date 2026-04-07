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
export const executeWakeTriggerFile = path.join(projectRoot, ".execute-wake.trigger");
export const executeQueueLockFile = path.join(projectRoot, ".execute-queue.lock");

// ─── Queue lock (multi-worker coordination) ───────────────────────────────────
// Menggunakan atomic file create (O_EXCL) supaya hanya satu worker yang bisa
// claim task di saat yang sama. Lock bersifat TTL — stale lock (> 5s) akan
// di-steal supaya tidak block selamanya kalau worker crash saat pegang lock.

const LOCK_TTL_MS = 5_000;
const LOCK_WAIT_MS = 100;
const LOCK_TIMEOUT_MS = 3_000;

async function withQueueLock(fn) {
  const deadline = Date.now() + LOCK_TIMEOUT_MS;

  while (true) {
    try {
      // O_EXCL → atomic: berhasil hanya kalau file belum ada
      const fd = await fs.open(executeQueueLockFile, "wx");
      await fd.writeFile(String(process.pid), "utf8");
      await fd.close();
      break; // lock acquired
    } catch (e) {
      if (e.code !== "EEXIST") throw e;

      // Lock ada — cek apakah stale
      try {
        const stat = await fs.stat(executeQueueLockFile);
        if (Date.now() - stat.mtimeMs > LOCK_TTL_MS) {
          await fs.rm(executeQueueLockFile, { force: true });
          continue; // langsung retry
        }
      } catch { /* file mungkin sudah dihapus worker lain — retry */ }

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

/** Berapa banyak task done/failed yang disimpan setelah prune. */
export const QUEUE_KEEP_COMPLETED = 20;

/**
 * Hapus entry done/failed lama supaya queue file tidak tumbuh selamanya.
 * Pertahankan semua queued/in_progress + QUEUE_KEEP_COMPLETED terbaru dari
 * done/failed (diurutkan berdasarkan finishedAt descending).
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
 * Ambil task pertama yang status-nya "queued" dan tandai sebagai "in_progress".
 * Di-wrap dengan file lock supaya aman untuk multi-worker.
 * Task dengan `retryAfter` di masa depan dilewati (masih dalam cooldown).
 * Return: task entry atau null kalau queue kosong / semua masih cooldown.
 */
export async function claimNextQueuedTask() {
  return withQueueLock(async () => {
    const tasks = await readQueue();
    const now = Date.now();
    const next = tasks.find(
      (t) => t.status === "queued" &&
        (!t.retryAfter || new Date(t.retryAfter).getTime() <= now)
    );

    if (!next) return null;

    next.status = "in_progress";
    next.startedAt = new Date().toISOString();
    await saveQueue(tasks);
    return next;
  });
}

/**
 * Jadwal ulang task yang gagal dengan exponential backoff.
 * Kalau retryCount sudah melebihi maxRetries → tandai sebagai "failed".
 *
 * @param id     — task ID
 * @param result — ringkasan hasil (disimpan kalau permanent failure)
 * Return: true kalau di-retry, false kalau permanently failed.
 */
export async function requeueForRetry(id, { result = null } = {}) {
  const tasks = await readQueue();
  const task = tasks.find((t) => t.id === id);
  if (!task) return false;

  const retryCount = (task.retryCount || 0) + 1;
  const maxRetries = task.maxRetries ?? 2;

  if (retryCount > maxRetries) {
    // Sudah habis retry — mark permanent failure
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
  await pruneQueue();
}

/**
 * Hapus task dari queue berdasarkan ID.
 * Hanya bisa menghapus task yang status-nya "queued" atau "failed".
 * Task "in_progress" tidak bisa dihapus (butuh kill child process dulu).
 *
 * Return: { removed: true } atau { removed: false, reason: "not_found"|"in_progress" }
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

// ─── Wake signal (cross-platform) ────────────────────────────────────────────

/**
 * Bangunkan execute worker supaya langsung proses task tanpa tunggu interval.
 *
 * Dua mekanisme dipakai sekaligus:
 *   1. Trigger file (.execute-wake.trigger) — bekerja di semua platform.
 *      Worker cek file ini tiap 2s selama sleep, langsung skip kalau ada.
 *   2. SIGUSR1 — fast-path untuk Mac/Linux. Di Windows diabaikan (tidak crash).
 *
 * Kalau worker tidak jalan, trigger file tetap tersimpan dan akan dibaca
 * saat worker start di iterasi berikutnya.
 */
export async function signalWorkerWake() {
  // 1. Tulis trigger file — cross-platform, selalu jalan
  try {
    await fs.writeFile(executeWakeTriggerFile, new Date().toISOString(), "utf8");
  } catch {
    // ignore — trigger file bersifat best-effort
  }

  // 2. SIGUSR1 sebagai fast-path di Unix (abaikan error di Windows)
  try {
    const pidText = await fs.readFile(executeWorkerPidFile, "utf8");
    const pid = Number(pidText.trim());
    if (Number.isFinite(pid) && pid > 0) {
      process.kill(pid, "SIGUSR1");
    }
  } catch {
    // Windows: SIGUSR1 tidak tersedia — trigger file sudah cukup
  }

  return true;
}

/**
 * Cek apakah trigger file ada dan hapus setelah dibaca.
 * Dipanggil oleh worker di tiap poll chunk saat sleep.
 * Return: true kalau trigger ada (worker harus langsung bangun).
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
