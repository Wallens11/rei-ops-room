/**
 * execute-metrics-panel.js — Agent performance metrics dashboard panel.
 *
 * Polls /api/execute/metrics every 60s.
 * Renders:
 *   - Success-rate percentage badge
 *   - Runtime comparison (inline SVG bar chart, no external CDN)
 *   - Last 10 runs as coloured dots with tooltips
 *
 * Self-contained — no external dependencies.
 */

const POLL_MS = 60_000;

const badgeEl   = document.getElementById("metrics-success-badge");
const totalEl   = document.getElementById("metrics-total-runs");
const barsEl    = document.getElementById("metrics-runtime-bars");
const dotsEl    = document.getElementById("metrics-recent-dots");

// ── Outcome → colour ─────────────────────────────────────────────────────────
const OUTCOME_COLOR = {
  completed:     "var(--mint)",
  failed:        "var(--rose)",
  review_needed: "var(--rose)",
  aborted:       "var(--muted)"
};
function outcomeColor(outcome) {
  return OUTCOME_COLOR[outcome] ?? "var(--muted)";
}

// ── SVG bar chart (runtime comparison) ───────────────────────────────────────
function buildRuntimeBars(byRuntime) {
  const entries = Object.entries(byRuntime ?? {});
  if (entries.length === 0) {
    return '<span style="font-size:11px;opacity:.5;">No runtime data yet.</span>';
  }

  const BAR_W  = 140;
  const ROW_H  = 16;
  const GAP    = 8;
  const LABEL_W = 82;
  const maxTotal = Math.max(...entries.map(([, s]) => s.total), 1);
  const svgH = entries.length * (ROW_H + GAP) - GAP;

  const rows = entries.map(([id, s], i) => {
    const y  = i * (ROW_H + GAP);
    const cW = Math.round((s.completed / maxTotal) * BAR_W);
    const fW = Math.round((s.failed    / maxTotal) * BAR_W);
    const pct = s.total > 0 ? Math.round((s.completed / s.total) * 100) : 0;
    return `
      <text x="0" y="${y + ROW_H - 3}" font-size="10" fill="currentColor" font-family="monospace" opacity=".8">${id}</text>
      <rect x="${LABEL_W}" y="${y}" width="${Math.max(cW, 0)}" height="${ROW_H}" fill="var(--mint)" rx="3"/>
      <rect x="${LABEL_W + cW}" y="${y}" width="${Math.max(fW, 0)}" height="${ROW_H}" fill="var(--rose)" rx="3"/>
      <text x="${LABEL_W + cW + fW + 5}" y="${y + ROW_H - 3}" font-size="10" fill="currentColor" font-family="monospace" opacity=".55">${pct}%</text>
    `;
  });

  return `<svg width="${LABEL_W + BAR_W + 45}" height="${svgH}" style="overflow:visible;display:block;max-width:100%">${rows.join("")}</svg>`;
}

// ── Dot row (last 10 runs) ────────────────────────────────────────────────────
function buildRecentDots(recentRuns) {
  if (!recentRuns || recentRuns.length === 0) {
    return '<span style="font-size:11px;opacity:.5;">No runs yet.</span>';
  }
  return recentRuns.map((run) => {
    const color = outcomeColor(run.outcome);
    const label = run.issueNumber ? `#${run.issueNumber}` : "direct";
    const rt    = run.runtimeId ?? "?";
    const ts    = run.recordedAt
      ? new Date(run.recordedAt).toLocaleString([], { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })
      : "";
    const title = `${run.outcome} · ${rt} · ${label} · ${ts}`;
    return `<span title="${title}" style="display:inline-block;width:11px;height:11px;border-radius:50%;background:${color};margin-right:3px;cursor:default;flex-shrink:0;" aria-label="${title}"></span>`;
  }).join("");
}

// ── Render ────────────────────────────────────────────────────────────────────
function render(data) {
  if (!data) return;

  // Badge
  const pct = Math.round((data.successRate ?? 0) * 100);
  if (badgeEl) {
    badgeEl.textContent = `${pct}%`;
    badgeEl.style.color = pct >= 70 ? "var(--mint)" : pct >= 40 ? "var(--amber)" : "var(--rose)";
  }

  // Total runs subtitle
  if (totalEl) {
    totalEl.textContent = `${data.totalRuns ?? 0} total run${data.totalRuns === 1 ? "" : "s"}`;
  }

  // Runtime bars
  if (barsEl) barsEl.innerHTML = buildRuntimeBars(data.byRuntime ?? {});

  // Recent dots
  if (dotsEl) dotsEl.innerHTML = buildRecentDots(data.recentRuns ?? []);
}

// ── Poll ──────────────────────────────────────────────────────────────────────
export async function pollMetrics() {
  try {
    const res = await fetch("/api/execute/metrics");
    if (!res.ok) return;
    render(await res.json());
  } catch {
    // Network error — silently skip
  }
}

pollMetrics();
setInterval(pollMetrics, POLL_MS);

// Real-time push from the live stream (rei-live.js). The poll above stays as a
// fallback for when SSE is unavailable.
window.addEventListener("rei-live:panels", (event) => {
  const metrics = event.detail?.metrics;
  if (metrics) render(metrics);
});
