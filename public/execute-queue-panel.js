/**
 * execute-queue-panel.js — View model untuk Task Queue panel.
 *
 * Membangun data siap-render dari raw task array yang datang dari
 * GET /api/execute/queue, tanpa menyentuh DOM secara langsung.
 *
 * Export tambahan:
 *   buildWorkerStatusBadge(workers) → "running" | "stopped"
 */

const STATUS_CONFIG = {
  queued:      { label: "queued",  tone: "idle"  },
  in_progress: { label: "running", tone: "ready" },
  done:        { label: "done",    tone: "done"  },
  failed:      { label: "failed",  tone: "error" },
};

/** Worker dianggap aktif kalau updatedAt / registeredAt < 3 menit yang lalu. */
const WORKER_ACTIVE_THRESHOLD_MS = 3 * 60 * 1000;

export async function submitDirectTaskRequest({
  task,
  runtimeId = null,
  request = globalThis.fetch
}) {
  const response = await request("/api/execute/submit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ task, runtimeId: runtimeId || null })
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      message: payload?.error || payload?.detail || `HTTP ${response.status}`,
      demo: payload?.demo === true
    };
  }

  return {
    ok: true,
    status: response.status,
    payload
  };
}

/**
 * Tentukan status badge worker berdasarkan registry dari GET /api/execute/workers.
 *
 * @param workers — array dari /api/execute/workers
 * Return: "running" | "stopped"
 */
export function buildWorkerStatusBadge(workers) {
  if (!Array.isArray(workers) || workers.length === 0) return "stopped";
  const now = Date.now();
  const hasActive = workers.some((w) => {
    const ts = w.updatedAt || w.registeredAt;
    return ts && now - new Date(ts).getTime() < WORKER_ACTIVE_THRESHOLD_MS;
  });
  return hasActive ? "running" : "stopped";
}

/**
 * Bangun view model task queue.
 *
 * @param tasks — array dari /api/execute/queue
 * @param limit — berapa task yang ditampilkan (terbaru dulu)
 * Return: { chip, rows }
 *   chip — string untuk item-chip (misal "2 pending", "idle")
 *   rows — array task row objects
 *     .canCancel   — true kalau task bisa dihapus (queued atau failed)
 *     .taskIdShort — 8 char pertama dari id, untuk link ke run log
 */
export function buildTaskQueueViewModel(tasks, { limit = 10 } = {}) {
  if (!Array.isArray(tasks)) return { chip: "idle", rows: [] };

  const active = tasks.filter(
    (t) => t.status === "queued" || t.status === "in_progress"
  ).length;

  const chip = active > 0 ? `${active} pending` : "idle";

  const rows = [...tasks]
    .reverse()
    .slice(0, limit)
    .map((t) => {
      const { label, tone } = STATUS_CONFIG[t.status] || { label: t.status, tone: "idle" };
      const retryCount = t.retryCount || 0;
      const maxRetries = t.maxRetries ?? 2;
      const retryBadge = retryCount > 0 ? ` · retry ${retryCount}/${maxRetries}` : "";
      const raw = t.task || "";
      const taskLabel = raw.length > 72 ? raw.slice(0, 72) + "…" : raw;

      return {
        id: t.id,
        taskIdShort: String(t.id || "").slice(0, 8),
        label: taskLabel + retryBadge,
        statusLabel: label,
        tone,
        runtime: t.runtimeId || "auto",
        result: t.result || null,
        retryAfter: t.retryAfter || null,
        canCancel: t.status === "queued" || t.status === "failed",
      };
    });

  return { chip, rows };
}
