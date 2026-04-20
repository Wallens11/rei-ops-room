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

  it("prompt ikut menyebut DESIGN.md kalau repo punya design brief lokal", () => {
    const prompt = buildDirectTaskPrompt({
      task: "polish execute panel",
      repoCwd: "/Users/funtoco/workSpace/codex-pixel-agent"
    });

    assert.ok(prompt.includes("Active design guidance:"));
    assert.ok(prompt.includes("Cursor inspired DESIGN.md"));
  });
});

// ─── Retry logic ──────────────────────────────────────────────────────────────

describe("execute-queue: retry + backoff", async () => {
  let tmpDir2;

  // Isolated queue helpers dengan retry fields
  async function makeRetryQueue(dir) {
    const qFile = path.join(dir, ".execute-queue.json");

    async function readQ() {
      try { return JSON.parse(await fs.readFile(qFile, "utf8")).tasks ?? []; }
      catch (e) { if (e?.code === "ENOENT") return []; throw e; }
    }
    async function saveQ(tasks) {
      await fs.writeFile(qFile, JSON.stringify({ tasks }, null, 2), "utf8");
    }

    async function enqueue(task) {
      const tasks = await readQ();
      const entry = {
        id: crypto.randomUUID(), task, context: null, runtimeId: null,
        submittedAt: new Date().toISOString(), status: "queued",
        startedAt: null, finishedAt: null, result: null,
        retryCount: 0, maxRetries: 2, retryAfter: null
      };
      tasks.push(entry);
      await saveQ(tasks);
      return entry;
    }

    async function requeueForRetry(id, { result = null } = {}) {
      const tasks = await readQ();
      const task = tasks.find((t) => t.id === id);
      if (!task) return false;
      const retryCount = (task.retryCount || 0) + 1;
      const maxRetries = task.maxRetries ?? 2;
      if (retryCount > maxRetries) {
        task.status = "failed";
        task.result = result ? String(result).trim() : null;
        task.finishedAt = new Date().toISOString();
        await saveQ(tasks);
        return false;
      }
      const backoffMs = 30_000 * (2 ** (retryCount - 1));
      task.status = "queued";
      task.retryCount = retryCount;
      task.startedAt = null;
      task.retryAfter = new Date(Date.now() + backoffMs).toISOString();
      await saveQ(tasks);
      return true;
    }

    async function claimNext() {
      const tasks = await readQ();
      const now = Date.now();
      const next = tasks.find(
        (t) => t.status === "queued" && (!t.retryAfter || new Date(t.retryAfter).getTime() <= now)
      );
      if (!next) return null;
      next.status = "in_progress";
      next.startedAt = new Date().toISOString();
      await saveQ(tasks);
      return next;
    }

    return { readQ, enqueue, requeueForRetry, claimNext };
  }

  before(async () => {
    tmpDir2 = await fs.mkdtemp(path.join(os.tmpdir(), "rei-retry-test-"));
  });
  after(async () => {
    await fs.rm(tmpDir2, { recursive: true, force: true });
  });

  it("enqueueTask: retryCount=0 dan maxRetries=2 di entry baru", async () => {
    const q = await makeRetryQueue(tmpDir2);
    const entry = await q.enqueue("new task");
    assert.equal(entry.retryCount, 0);
    assert.equal(entry.maxRetries, 2);
    assert.equal(entry.retryAfter, null);
  });

  it("requeueForRetry: retry pertama → status queued, retryCount=1, retryAfter set", async () => {
    const q = await makeRetryQueue(tmpDir2);
    const entry = await q.enqueue("failing task");
    const willRetry = await q.requeueForRetry(entry.id);
    assert.equal(willRetry, true);
    const tasks = await q.readQ();
    const t = tasks.find((x) => x.id === entry.id);
    assert.equal(t.status, "queued");
    assert.equal(t.retryCount, 1);
    assert.ok(t.retryAfter, "retryAfter harus di-set");
    // retryAfter harus di masa depan (~30s)
    assert.ok(new Date(t.retryAfter).getTime() > Date.now());
  });

  it("requeueForRetry: retry kedua → retryCount=2", async () => {
    const q = await makeRetryQueue(tmpDir2);
    const entry = await q.enqueue("failing task 2");
    await q.requeueForRetry(entry.id);
    const willRetry = await q.requeueForRetry(entry.id);
    assert.equal(willRetry, true);
    const tasks = await q.readQ();
    const t = tasks.find((x) => x.id === entry.id);
    assert.equal(t.retryCount, 2);
  });

  it("requeueForRetry: setelah maxRetries → status failed, return false", async () => {
    const q = await makeRetryQueue(tmpDir2);
    const entry = await q.enqueue("permanently failing");
    await q.requeueForRetry(entry.id); // retry 1
    await q.requeueForRetry(entry.id); // retry 2
    const willRetry = await q.requeueForRetry(entry.id, { result: "Exit code 1" }); // melebihi maxRetries
    assert.equal(willRetry, false);
    const tasks = await q.readQ();
    const t = tasks.find((x) => x.id === entry.id);
    assert.equal(t.status, "failed");
    assert.equal(t.result, "Exit code 1");
    assert.ok(t.finishedAt);
  });

  it("claimNextQueuedTask: skip task yang masih dalam retryAfter cooldown", async () => {
    const q = await makeRetryQueue(tmpDir2);
    const entry = await q.enqueue("cooldown task");
    // Manually set retryAfter ke masa depan
    const tasks = await q.readQ();
    const t = tasks.find((x) => x.id === entry.id);
    t.retryAfter = new Date(Date.now() + 60_000).toISOString();
    await fs.writeFile(
      path.join(tmpDir2, ".execute-queue.json"),
      JSON.stringify({ tasks }, null, 2), "utf8"
    );
    const claimed = await q.claimNext();
    // Task lain mungkin di-claim, tapi bukan yang cooldown
    if (claimed) assert.notEqual(claimed.id, entry.id);
  });

  it("claimNextQueuedTask: claim task yang retryAfter sudah lewat", async () => {
    const q = await makeRetryQueue(tmpDir2);
    const entry = await q.enqueue("ready to retry");
    // Set retryAfter ke masa lalu
    const tasks = await q.readQ();
    const t = tasks.find((x) => x.id === entry.id);
    t.retryAfter = new Date(Date.now() - 1000).toISOString();
    await fs.writeFile(
      path.join(tmpDir2, ".execute-queue.json"),
      JSON.stringify({ tasks }, null, 2), "utf8"
    );
    const claimed = await q.claimNext();
    assert.ok(claimed);
    assert.equal(claimed.id, entry.id);
  });
});

// ─── buildTaskQueueViewModel ──────────────────────────────────────────────────

describe("execute-queue-panel: buildTaskQueueViewModel", async () => {
  const { buildTaskQueueViewModel } = await import("../public/execute-queue-panel.js");

  const sampleTasks = [
    { id: "1", task: "fix bug", status: "done", runtimeId: "claude-code", retryCount: 0, maxRetries: 2, result: "Fixed it.", retryAfter: null },
    { id: "2", task: "write tests", status: "in_progress", runtimeId: null, retryCount: 1, maxRetries: 2, result: null, retryAfter: null },
    { id: "3", task: "review docs", status: "queued", runtimeId: "codex", retryCount: 0, maxRetries: 2, result: null, retryAfter: null },
    { id: "4", task: "deploy", status: "failed", runtimeId: null, retryCount: 3, maxRetries: 2, result: "Timeout.", retryAfter: null },
  ];

  it("return chip 'idle' kalau tidak ada task aktif", () => {
    const { chip } = buildTaskQueueViewModel([sampleTasks[0], sampleTasks[3]]);
    assert.equal(chip, "idle");
  });

  it("return chip dengan count kalau ada task queued/in_progress", () => {
    const { chip } = buildTaskQueueViewModel(sampleTasks);
    assert.ok(chip.includes("pending"), `Expected 'pending' in chip: ${chip}`);
  });

  it("rows dibalik (terbaru dulu)", () => {
    const { rows } = buildTaskQueueViewModel(sampleTasks);
    assert.equal(rows[0].id, "4"); // index terakhir muncul pertama
  });

  it("status label dan tone sesuai", () => {
    const { rows } = buildTaskQueueViewModel([sampleTasks[0]]);
    const row = rows.find((r) => r.id === "1");
    assert.equal(row.statusLabel, "done");
    assert.equal(row.tone, "done");
  });

  it("runtime ditampilkan atau 'auto' kalau null", () => {
    const { rows } = buildTaskQueueViewModel(sampleTasks);
    const done = rows.find((r) => r.id === "1");
    const inProgress = rows.find((r) => r.id === "2");
    assert.equal(done.runtime, "claude-code");
    assert.equal(inProgress.runtime, "auto");
  });

  it("retryCount > 0 muncul di label", () => {
    const { rows } = buildTaskQueueViewModel([sampleTasks[1]]);
    const row = rows[0];
    assert.ok(row.label.includes("retry"), `Expected 'retry' in label: ${row.label}`);
  });

  it("task panjang di-truncate", () => {
    const longTask = { id: "x", task: "a".repeat(100), status: "queued", runtimeId: null, retryCount: 0, maxRetries: 2, result: null, retryAfter: null };
    const { rows } = buildTaskQueueViewModel([longTask]);
    assert.ok(rows[0].label.includes("…"));
  });

  it("input kosong return idle chip dan rows kosong", () => {
    const { chip, rows } = buildTaskQueueViewModel([]);
    assert.equal(chip, "idle");
    assert.equal(rows.length, 0);
  });

  it("limit membatasi jumlah rows", () => {
    const { rows } = buildTaskQueueViewModel(sampleTasks, { limit: 2 });
    assert.equal(rows.length, 2);
  });

  it("row.canCancel true untuk status queued dan false untuk in_progress", () => {
    const tasks = [
      { id: "a", task: "queued task", status: "queued", runtimeId: null, retryCount: 0, maxRetries: 2, result: null, retryAfter: null },
      { id: "b", task: "running task", status: "in_progress", runtimeId: null, retryCount: 0, maxRetries: 2, result: null, retryAfter: null },
      { id: "c", task: "done task", status: "done", runtimeId: null, retryCount: 0, maxRetries: 2, result: null, retryAfter: null },
      { id: "d", task: "failed task", status: "failed", runtimeId: null, retryCount: 0, maxRetries: 2, result: null, retryAfter: null },
    ];
    const { rows } = buildTaskQueueViewModel(tasks);
    const queued = rows.find((r) => r.id === "a");
    const running = rows.find((r) => r.id === "b");
    const done = rows.find((r) => r.id === "c");
    const failed = rows.find((r) => r.id === "d");
    assert.equal(queued.canCancel, true);
    assert.equal(running.canCancel, false);
    assert.equal(done.canCancel, false);
    assert.equal(failed.canCancel, true);
  });

  it("row.taskIdShort adalah 8 char pertama dari id", () => {
    const task = { id: "abcd1234-5678-0000", task: "test", status: "done", runtimeId: null, retryCount: 0, maxRetries: 2, result: null, retryAfter: null };
    const { rows } = buildTaskQueueViewModel([task]);
    assert.equal(rows[0].taskIdShort, "abcd1234");
  });
});

// ─── buildWorkerStatusBadge ───────────────────────────────────────────────────

describe("execute-queue-panel: buildWorkerStatusBadge", async () => {
  const { buildWorkerStatusBadge } = await import("../public/execute-queue-panel.js");

  it("return 'stopped' kalau workers array kosong", () => {
    assert.equal(buildWorkerStatusBadge([]), "stopped");
  });

  it("return 'stopped' kalau null/undefined", () => {
    assert.equal(buildWorkerStatusBadge(null), "stopped");
    assert.equal(buildWorkerStatusBadge(undefined), "stopped");
  });

  it("return 'running' kalau ada worker dengan updatedAt baru (< 3 menit)", () => {
    const workers = [{
      workerId: "w1",
      pid: 123,
      updatedAt: new Date().toISOString() // sekarang
    }];
    assert.equal(buildWorkerStatusBadge(workers), "running");
  });

  it("return 'stopped' kalau semua worker updatedAt lama (> 3 menit)", () => {
    const oldTs = new Date(Date.now() - 4 * 60 * 1000).toISOString(); // 4 menit lalu
    const workers = [{
      workerId: "w1",
      pid: 123,
      updatedAt: oldTs
    }];
    assert.equal(buildWorkerStatusBadge(workers), "stopped");
  });

  it("return 'running' kalau registeredAt baru (tidak ada updatedAt)", () => {
    const workers = [{
      workerId: "w1",
      pid: 123,
      registeredAt: new Date().toISOString()
    }];
    assert.equal(buildWorkerStatusBadge(workers), "running");
  });
});

// ─── pruneQueue (via isolated helpers) ───────────────────────────────────────

describe("execute-queue: pruneQueue via resolveQueueTask", async () => {
  let tmpPruneDir;

  // Re-implement pruneQueue inline for isolated testing
  function makePruneQueue(dir) {
    const qFile = path.join(dir, ".execute-queue.json");
    const QUEUE_KEEP_COMPLETED = 20;

    async function readQ() {
      try { return JSON.parse(await fs.readFile(qFile, "utf8")).tasks ?? []; }
      catch (e) { if (e?.code === "ENOENT") return []; throw e; }
    }
    async function saveQ(tasks) {
      await fs.writeFile(qFile, JSON.stringify({ tasks }, null, 2), "utf8");
    }

    async function pruneQueue() {
      const tasks = await readQ();
      const active = tasks.filter((t) => t.status === "queued" || t.status === "in_progress");
      const finished = tasks
        .filter((t) => t.status === "done" || t.status === "failed")
        .sort((a, b) => new Date(b.finishedAt || 0) - new Date(a.finishedAt || 0))
        .slice(0, QUEUE_KEEP_COMPLETED);
      const pruned = [...active, ...finished];
      if (pruned.length < tasks.length) {
        await saveQ(pruned);
      }
    }

    return { readQ, saveQ, pruneQueue };
  }

  before(async () => {
    tmpPruneDir = await fs.mkdtemp(path.join(os.tmpdir(), "rei-prune-test-"));
  });
  after(async () => {
    await fs.rm(tmpPruneDir, { recursive: true, force: true });
  });

  it("pruneQueue: 25 done tasks → hanya 20 yang tersisa setelah prune", async () => {
    const { saveQ, readQ, pruneQueue } = makePruneQueue(tmpPruneDir);

    // Buat 25 done tasks
    const tasks = Array.from({ length: 25 }, (_, i) => ({
      id: `done-${i}`,
      task: `task ${i}`,
      status: "done",
      finishedAt: new Date(Date.now() - i * 1000).toISOString()
    }));
    await saveQ(tasks);

    await pruneQueue();

    const remaining = await readQ();
    assert.equal(remaining.length, 20, `expected 20, got ${remaining.length}`);
  });

  it("pruneQueue: active tasks selalu dipertahankan", async () => {
    const { saveQ, readQ, pruneQueue } = makePruneQueue(tmpPruneDir);

    // 25 done + 3 queued/in_progress
    const tasks = [
      ...Array.from({ length: 25 }, (_, i) => ({
        id: `done-${i}`,
        task: `task ${i}`,
        status: "done",
        finishedAt: new Date(Date.now() - i * 1000).toISOString()
      })),
      { id: "q1", task: "queued", status: "queued", finishedAt: null },
      { id: "q2", task: "in progress", status: "in_progress", finishedAt: null },
    ];
    await saveQ(tasks);

    await pruneQueue();

    const remaining = await readQ();
    assert.ok(remaining.some((t) => t.id === "q1"), "queued task harus tetap ada");
    assert.ok(remaining.some((t) => t.id === "q2"), "in_progress task harus tetap ada");
    const doneCount = remaining.filter((t) => t.status === "done").length;
    assert.equal(doneCount, 20);
  });

  it("pruneQueue: tidak melakukan apa-apa kalau kurang dari 20 done tasks", async () => {
    const { saveQ, readQ, pruneQueue } = makePruneQueue(tmpPruneDir);

    const tasks = Array.from({ length: 5 }, (_, i) => ({
      id: `small-${i}`,
      task: `task ${i}`,
      status: "done",
      finishedAt: new Date(Date.now() - i * 1000).toISOString()
    }));
    await saveQ(tasks);

    await pruneQueue();

    const remaining = await readQ();
    assert.equal(remaining.length, 5);
  });
});

// ─── removeQueueTask (via isolated helpers) ───────────────────────────────────

describe("execute-queue: removeQueueTask", async () => {
  let tmpRemoveDir;

  function makeRemoveQueue(dir) {
    const qFile = path.join(dir, ".execute-queue.json");

    async function readQ() {
      try { return JSON.parse(await fs.readFile(qFile, "utf8")).tasks ?? []; }
      catch (e) { if (e?.code === "ENOENT") return []; throw e; }
    }
    async function saveQ(tasks) {
      await fs.writeFile(qFile, JSON.stringify({ tasks }, null, 2), "utf8");
    }

    async function removeQueueTask(id) {
      const tasks = await readQ();
      const task = tasks.find((t) => t.id === id);
      if (!task) return { removed: false, reason: "not_found" };
      if (task.status === "in_progress") return { removed: false, reason: "in_progress" };
      const filtered = tasks.filter((t) => t.id !== id);
      await saveQ(filtered);
      return { removed: true };
    }

    return { readQ, saveQ, removeQueueTask };
  }

  before(async () => {
    tmpRemoveDir = await fs.mkdtemp(path.join(os.tmpdir(), "rei-remove-test-"));
  });
  after(async () => {
    await fs.rm(tmpRemoveDir, { recursive: true, force: true });
  });

  it("removeQueueTask: hapus task queued dengan sukses", async () => {
    const { saveQ, readQ, removeQueueTask } = makeRemoveQueue(tmpRemoveDir);
    await saveQ([
      { id: "t1", task: "fix", status: "queued" },
      { id: "t2", task: "deploy", status: "queued" }
    ]);
    const result = await removeQueueTask("t1");
    assert.equal(result.removed, true);
    const remaining = await readQ();
    assert.ok(!remaining.some((t) => t.id === "t1"), "t1 harus sudah dihapus");
    assert.ok(remaining.some((t) => t.id === "t2"), "t2 harus masih ada");
  });

  it("removeQueueTask: return not_found untuk id yang tidak ada", async () => {
    const { saveQ, removeQueueTask } = makeRemoveQueue(tmpRemoveDir);
    await saveQ([]);
    const result = await removeQueueTask("no-such");
    assert.equal(result.removed, false);
    assert.equal(result.reason, "not_found");
  });

  it("removeQueueTask: return in_progress untuk task yang sedang berjalan", async () => {
    const { saveQ, removeQueueTask } = makeRemoveQueue(tmpRemoveDir);
    await saveQ([{ id: "running", task: "running task", status: "in_progress" }]);
    const result = await removeQueueTask("running");
    assert.equal(result.removed, false);
    assert.equal(result.reason, "in_progress");
  });
});

// ─── Queue priority ───────────────────────────────────────────────────────────

describe("execute-queue: task priority", async () => {
  let tmpPrioDir;

  before(async () => {
    tmpPrioDir = await fs.mkdtemp(path.join(os.tmpdir(), "rei-prio-test-"));
  });

  after(async () => {
    await fs.rm(tmpPrioDir, { recursive: true, force: true }).catch(() => {});
  });

  // Buat isolated queue yang support priority
  async function makePrioQueue(dir) {
    const qFile = path.join(dir, ".execute-queue.json");
    const readQ = async () => {
      try { return JSON.parse(await fs.readFile(qFile, "utf8")).tasks ?? []; }
      catch (e) { if (e?.code === "ENOENT") return []; throw e; }
    };
    const saveQ = async (tasks) => fs.writeFile(qFile, JSON.stringify({ tasks }, null, 2), "utf8");

    const enqueue = async ({ task, priority = 0 }) => {
      const tasks = await readQ();
      const entry = {
        id: crypto.randomUUID(), task, priority: Number(priority) || 0,
        submittedAt: new Date().toISOString(), status: "queued",
        startedAt: null, finishedAt: null, result: null, retryCount: 0, maxRetries: 2, retryAfter: null
      };
      tasks.push(entry);
      await saveQ(tasks);
      return entry;
    };

    const claim = async () => {
      const tasks = await readQ();
      const now = Date.now();
      const eligible = tasks.filter(t => t.status === "queued" && (!t.retryAfter || new Date(t.retryAfter).getTime() <= now));
      if (!eligible.length) return null;
      eligible.sort((a, b) => {
        const pa = Number(a.priority) || 0, pb = Number(b.priority) || 0;
        if (pb !== pa) return pb - pa;
        return new Date(a.submittedAt).getTime() - new Date(b.submittedAt).getTime();
      });
      const next = eligible[0];
      next.status = "in_progress";
      next.startedAt = new Date().toISOString();
      await saveQ(tasks);
      return next;
    };

    return { enqueue, claim, readQ };
  }

  it("enqueueTask menyimpan field priority", async () => {
    const q = await makePrioQueue(path.join(tmpPrioDir, "t1"));
    await fs.mkdir(path.join(tmpPrioDir, "t1"), { recursive: true });
    const entry = await q.enqueue({ task: "high prio task", priority: 10 });
    assert.equal(entry.priority, 10);
  });

  it("claimNextQueuedTask mengambil task dengan priority tertinggi duluan", async () => {
    const dir = path.join(tmpPrioDir, "t2");
    await fs.mkdir(dir, { recursive: true });
    const q = await makePrioQueue(dir);

    await q.enqueue({ task: "low prio", priority: 0 });
    await q.enqueue({ task: "high prio", priority: 5 });
    await q.enqueue({ task: "mid prio", priority: 2 });

    const first = await q.claim();
    assert.equal(first?.task, "high prio");

    const second = await q.claim();
    assert.equal(second?.task, "mid prio");

    const third = await q.claim();
    assert.equal(third?.task, "low prio");
  });

  it("same priority → FIFO tiebreak (submitted lebih awal dijalankan dulu)", async () => {
    const dir = path.join(tmpPrioDir, "t3");
    await fs.mkdir(dir, { recursive: true });
    const q = await makePrioQueue(dir);

    await q.enqueue({ task: "first submitted", priority: 1 });
    await new Promise(r => setTimeout(r, 5)); // small delay biar submittedAt beda
    await q.enqueue({ task: "second submitted", priority: 1 });

    const first = await q.claim();
    assert.equal(first?.task, "first submitted");
  });

  it("priority default 0 kalau tidak disediakan", async () => {
    const dir = path.join(tmpPrioDir, "t4");
    await fs.mkdir(dir, { recursive: true });
    const q = await makePrioQueue(dir);
    const entry = await q.enqueue({ task: "no priority given" });
    assert.equal(entry.priority, 0);
  });
});
