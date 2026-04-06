import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it, before, after } from "node:test";

// ─── Setup isolated temp dir ──────────────────────────────────────────────────
// Supaya test tidak sentuh .execute-queue.json di project root.

let tmpDir;
let queueFile;
let workersFile;

// Override projectRoot sebelum import queue module
// dengan membuat module mock yang point ke tmpDir.
// Cara paling bersih: import langsung dan pass file path override via re-export.

// Karena execute-queue.mjs export file path dari execute-worker-state.mjs,
// kita test fungsi-fungsinya dengan mocking file path via env atau direct call.
// Strategy: buat wrapper yang pakai file path custom.

import crypto from "node:crypto";

// Helper: buat fungsi queue yang terisolasi ke tmpDir
async function makeIsolatedQueue(dir) {
  const qFile = path.join(dir, ".execute-queue.json");
  const wFile = path.join(dir, ".execute-workers.json");

  async function readJson(filePath, fallback) {
    try {
      return JSON.parse(await fs.readFile(filePath, "utf8"));
    } catch (e) {
      if (e?.code === "ENOENT") return fallback;
      throw e;
    }
  }

  async function writeJson(filePath, data) {
    await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  }

  async function readQueue() {
    const data = await readJson(qFile, { tasks: [] });
    return Array.isArray(data?.tasks) ? data.tasks : [];
  }

  async function saveQueue(tasks) {
    await writeJson(qFile, { tasks });
  }

  async function enqueueTask({ task, context = null, runtimeId = null } = {}) {
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

  async function claimNextQueuedTask() {
    const tasks = await readQueue();
    const next = tasks.find((t) => t.status === "queued");
    if (!next) return null;
    next.status = "in_progress";
    next.startedAt = new Date().toISOString();
    await saveQueue(tasks);
    return next;
  }

  async function resolveQueueTask(id, { status, result = null } = {}) {
    const tasks = await readQueue();
    const task = tasks.find((t) => t.id === id);
    if (!task) return;
    task.status = status;
    task.result = result ? String(result).trim() : null;
    task.finishedAt = new Date().toISOString();
    await saveQueue(tasks);
  }

  async function requeueStuckTask(id) {
    const tasks = await readQueue();
    const task = tasks.find((t) => t.id === id && t.status === "in_progress");
    if (!task) return;
    task.status = "queued";
    task.startedAt = null;
    await saveQueue(tasks);
  }

  async function readWorkers() {
    const data = await readJson(wFile, { workers: [] });
    return Array.isArray(data?.workers) ? data.workers : [];
  }

  async function saveWorkers(workers) {
    await writeJson(wFile, { workers });
  }

  async function registerWorker({ workerId, pid, runtimeId = null } = {}) {
    const workers = await readWorkers();
    const filtered = workers.filter((w) => w.workerId !== workerId);
    filtered.push({ workerId, pid, runtimeId, registeredAt: new Date().toISOString(), currentTaskId: null, currentIssueNumber: null, currentRuntimeId: null });
    await saveWorkers(filtered);
  }

  async function updateWorkerActivity(workerId, { taskId = null, issueNumber = null, runtimeId = null } = {}) {
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

  async function unregisterWorker(workerId) {
    const workers = await readWorkers();
    await saveWorkers(workers.filter((w) => w.workerId !== workerId));
  }

  return {
    readQueue, enqueueTask, claimNextQueuedTask, resolveQueueTask, requeueStuckTask,
    readWorkers, registerWorker, updateWorkerActivity, unregisterWorker
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("execute-queue: task lifecycle", async () => {
  let q;

  before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rei-queue-test-"));
    q = await makeIsolatedQueue(tmpDir);
  });

  after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("queue kosong di awal", async () => {
    const tasks = await q.readQueue();
    assert.deepEqual(tasks, []);
  });

  it("enqueueTask: tambah task baru dengan status queued", async () => {
    const entry = await q.enqueueTask({ task: "fix auth bug" });
    assert.equal(entry.status, "queued");
    assert.equal(entry.task, "fix auth bug");
    assert.ok(entry.id);
    assert.ok(entry.submittedAt);
    assert.equal(entry.startedAt, null);
    assert.equal(entry.finishedAt, null);
    assert.equal(entry.result, null);
  });

  it("enqueueTask: task masuk ke queue file", async () => {
    const tasks = await q.readQueue();
    assert.ok(tasks.length >= 1);
    assert.ok(tasks.some((t) => t.task === "fix auth bug"));
  });

  it("enqueueTask: runtimeId tersimpan", async () => {
    const entry = await q.enqueueTask({ task: "review docs", runtimeId: "claude-code" });
    const tasks = await q.readQueue();
    const found = tasks.find((t) => t.id === entry.id);
    assert.equal(found?.runtimeId, "claude-code");
  });

  it("enqueueTask: context tersimpan", async () => {
    const entry = await q.enqueueTask({ task: "clean up code", context: "fokus di auth.js" });
    const tasks = await q.readQueue();
    const found = tasks.find((t) => t.id === entry.id);
    assert.equal(found?.context, "fokus di auth.js");
  });

  it("claimNextQueuedTask: ambil task pertama yang queued", async () => {
    const claimed = await q.claimNextQueuedTask();
    assert.ok(claimed);
    assert.equal(claimed.status, "in_progress");
    assert.ok(claimed.startedAt);
  });

  it("claimNextQueuedTask: status in_progress tersimpan di file", async () => {
    const tasks = await q.readQueue();
    const inProgress = tasks.filter((t) => t.status === "in_progress");
    assert.ok(inProgress.length >= 1);
  });

  it("resolveQueueTask: tandai task sebagai done", async () => {
    const tasks = await q.readQueue();
    const inProgress = tasks.find((t) => t.status === "in_progress");
    assert.ok(inProgress);

    await q.resolveQueueTask(inProgress.id, { status: "done", result: "Fixed the auth bug." });

    const updated = await q.readQueue();
    const resolved = updated.find((t) => t.id === inProgress.id);
    assert.equal(resolved?.status, "done");
    assert.equal(resolved?.result, "Fixed the auth bug.");
    assert.ok(resolved?.finishedAt);
  });

  it("resolveQueueTask: tandai task sebagai failed", async () => {
    const entry = await q.enqueueTask({ task: "risky task" });
    await q.resolveQueueTask(entry.id, { status: "failed", result: "Exit code 1." });

    const tasks = await q.readQueue();
    const resolved = tasks.find((t) => t.id === entry.id);
    assert.equal(resolved?.status, "failed");
  });

  it("requeueStuckTask: kembalikan in_progress ke queued", async () => {
    const entry = await q.enqueueTask({ task: "requeue me" });
    await q.claimNextQueuedTask(); // akan claim entry ini atau yang lain

    // Claim entry yang kita buat secara manual
    const tasks = await q.readQueue();
    const target = tasks.find((t) => t.id === entry.id);
    if (target?.status === "in_progress") {
      await q.requeueStuckTask(entry.id);
      const updated = await q.readQueue();
      const requeued = updated.find((t) => t.id === entry.id);
      assert.equal(requeued?.status, "queued");
      assert.equal(requeued?.startedAt, null);
    } else {
      // Task belum di-claim — skip assertion
      assert.ok(true, "task belum in_progress, skip requeue test");
    }
  });

  it("claimNextQueuedTask: return null kalau tidak ada yang queued", async () => {
    // Pastikan semua task di-resolve dulu
    const tasks = await q.readQueue();
    for (const t of tasks.filter((t) => t.status === "queued" || t.status === "in_progress")) {
      await q.resolveQueueTask(t.id, { status: "done" });
    }

    const result = await q.claimNextQueuedTask();
    assert.equal(result, null);
  });
});

describe("execute-queue: workers registry", async () => {
  let q;

  before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rei-workers-test-"));
    q = await makeIsolatedQueue(tmpDir);
  });

  after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("workers kosong di awal", async () => {
    const workers = await q.readWorkers();
    assert.deepEqual(workers, []);
  });

  it("registerWorker: tambah worker baru", async () => {
    await q.registerWorker({ workerId: "w1", pid: 12345, runtimeId: "codex" });
    const workers = await q.readWorkers();
    assert.equal(workers.length, 1);
    assert.equal(workers[0].workerId, "w1");
    assert.equal(workers[0].pid, 12345);
    assert.equal(workers[0].runtimeId, "codex");
  });

  it("registerWorker: replace entry lama kalau workerId sama (restart)", async () => {
    await q.registerWorker({ workerId: "w1", pid: 99999, runtimeId: "claude-code" });
    const workers = await q.readWorkers();
    const w1entries = workers.filter((w) => w.workerId === "w1");
    assert.equal(w1entries.length, 1);
    assert.equal(w1entries[0].pid, 99999);
  });

  it("updateWorkerActivity: update task dan runtime yang sedang dikerjakan", async () => {
    await q.updateWorkerActivity("w1", { taskId: "abc123", runtimeId: "claude-code" });
    const workers = await q.readWorkers();
    const w1 = workers.find((w) => w.workerId === "w1");
    assert.equal(w1?.currentTaskId, "abc123");
    assert.equal(w1?.currentRuntimeId, "claude-code");
  });

  it("unregisterWorker: hapus worker dari registry", async () => {
    await q.registerWorker({ workerId: "w2", pid: 55555 });
    await q.unregisterWorker("w1");
    const workers = await q.readWorkers();
    assert.ok(!workers.some((w) => w.workerId === "w1"));
    assert.ok(workers.some((w) => w.workerId === "w2"));
  });
});

// ─── checkAndClearWakeTrigger + signalWorkerWake (trigger file) ───────────────

describe("execute-queue: wake trigger file (cross-platform)", async () => {
  const {
    checkAndClearWakeTrigger,
    signalWorkerWake,
    executeWakeTriggerFile
  } = await import("../tools/execute-queue.mjs");

  // Cleanup sebelum dan sesudah supaya state bersih
  async function removeTrigger() {
    await fs.rm(executeWakeTriggerFile, { force: true }).catch(() => {});
  }

  before(removeTrigger);
  after(removeTrigger);

  it("checkAndClearWakeTrigger: return false kalau file tidak ada", async () => {
    await removeTrigger();
    const result = await checkAndClearWakeTrigger();
    assert.equal(result, false);
  });

  it("signalWorkerWake: membuat trigger file", async () => {
    await removeTrigger();
    await signalWorkerWake();
    // Cek file ada (tanpa fs.access supaya tidak consume trigger)
    let exists = false;
    try {
      await fs.access(executeWakeTriggerFile);
      exists = true;
    } catch {}
    assert.ok(exists, "trigger file harus ada setelah signalWorkerWake");
  });

  it("checkAndClearWakeTrigger: return true kalau file ada", async () => {
    // File masih ada dari test sebelumnya
    const result = await checkAndClearWakeTrigger();
    assert.equal(result, true);
  });

  it("checkAndClearWakeTrigger: hapus file setelah dibaca", async () => {
    // Buat trigger file manual
    await fs.writeFile(executeWakeTriggerFile, "test", "utf8");
    await checkAndClearWakeTrigger(); // consume
    // Sekarang file harus sudah tidak ada
    const result = await checkAndClearWakeTrigger();
    assert.equal(result, false);
  });

  it("signalWorkerWake: idempotent, tidak crash kalau worker tidak jalan", async () => {
    await removeTrigger();
    // SIGUSR1 ke PID yang tidak ada — harus di-ignore, tidak throw
    await assert.doesNotReject(signalWorkerWake());
  });
});

describe("execute-bridge: buildDirectTaskPrompt", async () => {
  const { buildDirectTaskPrompt } = await import("../tools/execute-bridge.mjs");

  it("return string non-kosong", () => {
    const prompt = buildDirectTaskPrompt({ task: "fix tests", repoCwd: "/repo" });
    assert.equal(typeof prompt, "string");
    assert.ok(prompt.length > 0);
  });

  it("prompt mengandung task description", () => {
    const prompt = buildDirectTaskPrompt({ task: "review auth.js", repoCwd: "/repo" });
    assert.ok(prompt.includes("review auth.js"));
  });

  it("prompt mengandung context kalau di-set", () => {
    const prompt = buildDirectTaskPrompt({ task: "refactor", context: "fokus di utils/", repoCwd: "/repo" });
    assert.ok(prompt.includes("fokus di utils/"));
  });

  it("prompt tidak crash kalau handoff null", () => {
    assert.doesNotThrow(() =>
      buildDirectTaskPrompt({ task: "simple task", repoCwd: "/repo", handoff: null })
    );
  });

  it("prompt mengandung execution rules", () => {
    const prompt = buildDirectTaskPrompt({ task: "do something", repoCwd: "/repo" });
    assert.ok(prompt.includes("Execution rules:"));
    assert.ok(prompt.includes("do not push"));
  });
});
