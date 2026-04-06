/**
 * execute-queue-panel.js — View model untuk Task Queue panel.
 *
 * Membangun data siap-render dari raw task array yang datang dari
 * GET /api/execute/queue, tanpa menyentuh DOM secara langsung.
 */

const STATUS_CONFIG = {
  queued:      { label: "queued",  tone: "idle"  },
  in_progress: { label: "running", tone: "ready" },
  done:        { label: "done",    tone: "done"  },
  failed:      { label: "failed",  tone: "error" },
};

/**
 * Bangun view model task queue.
 *
 * @param tasks — array dari /api/execute/queue
 * @param limit — berapa task yang ditampilkan (terbaru dulu)
 * Return: { chip, rows }
 *   chip — string untuk item-chip (misal "2 pending", "idle")
 *   rows — array task row objects
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
        label: taskLabel + retryBadge,
        statusLabel: label,
        tone,
        runtime: t.runtimeId || "auto",
        result: t.result || null,
        retryAfter: t.retryAfter || null,
      };
    });

  return { chip, rows };
}
