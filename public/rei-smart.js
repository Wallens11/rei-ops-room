/**
 * rei-smart.js — the "smart layer" on top of the ops room.
 *
 * Self-contained, no dependencies. Adds:
 *   1. Tabs        — Mission / Brain / Activity panel groups, persisted,
 *                    with attention badges (todo issues, running tasks).
 *   2. Digest      — one human sentence synthesized from status, metrics,
 *                    costs and the GitHub inbox. Refreshes every 30s.
 *   3. Palette     — ⌘K / Ctrl+K command palette: jump, act, open issues.
 *   4. Toasts      — in-page (and optional desktop) notifications when an
 *                    execute run finishes or fails.
 *   5. Shortcuts   — 1/2/3 tabs, t task input, / chat, ? help overlay.
 */

const REFRESH_MS = 30_000;
const QUEUE_POLL_MS = 10_000;

function $(id) {
  return document.getElementById(id);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

async function fetchJson(url) {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function isTypingTarget(target) {
  if (!target) return false;
  const tag = (target.tagName || "").toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || target.isContentEditable;
}

/* ═══ 1. Tabs ═══════════════════════════════════════════════════════════════ */

const TAB_KEY = "rei-active-tab";
const panelGrid = document.querySelector(".panel-grid");
const tabButtons = Array.from(document.querySelectorAll(".ops-tab"));

function setTab(name, { persist = true } = {}) {
  if (!panelGrid || !["mission", "brain", "activity"].includes(name)) return;
  panelGrid.dataset.activeTab = name;
  tabButtons.forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.tabTarget === name);
  });
  if (persist) {
    try { localStorage.setItem(TAB_KEY, name); } catch { /* private mode */ }
  }
}

tabButtons.forEach((btn) => {
  btn.addEventListener("click", () => setTab(btn.dataset.tabTarget));
});

try {
  const saved = localStorage.getItem(TAB_KEY);
  if (saved) setTab(saved, { persist: false });
} catch { /* private mode */ }

function setTabBadge(name, count) {
  const badge = document.querySelector(`[data-tab-badge="${name}"]`);
  if (!badge) return;
  if (count > 0) {
    badge.textContent = String(count);
    badge.hidden = false;
  } else {
    badge.hidden = true;
  }
}

/* ═══ 2. Digest ═════════════════════════════════════════════════════════════ */

const digestText = $("smart-digest-text");
const digestSync = $("smart-digest-sync");

let issueCache = [];
const digestState = {
  status: null,
  metrics: null,
  costs: null,
  issues: null,
  queue: []
};

function plural(n, word) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function composeDigest({ status, metrics, costs, issues, queue }) {
  const bits = [];

  const phase = status?.phase?.title || status?.phase || null;
  const task = status?.task?.title || null;
  if (task && phase && String(phase).toLowerCase() !== "standby") {
    bits.push(`Rei is on <strong>${escapeHtml(String(task).slice(0, 80))}</strong>`);
  } else if (phase && String(phase).toLowerCase() !== "standby") {
    bits.push(`Rei is in <strong>${escapeHtml(String(phase))}</strong>`);
  } else {
    bits.push("Rei is <strong>watching</strong> — quiet room");
  }

  const running = (queue || []).filter((t) => t.status === "running" || t.status === "launching").length;
  const queued = (queue || []).filter((t) => t.status === "queued").length;
  if (running > 0) bits.push(`${plural(running, "run")} live`);
  if (queued > 0) bits.push(`${queued} queued`);

  const todo = issues?.summary?.todo ?? 0;
  const blocked = issues?.summary?.blocked ?? 0;
  if (todo > 0) bits.push(`<strong>${plural(todo, "issue")}</strong> waiting`);
  if (blocked > 0) bits.push(`${blocked} blocked`);

  if (metrics?.totalRuns > 0) {
    const pct = Math.round((metrics.successRate ?? 0) * 100);
    bits.push(`${pct}% success over ${plural(metrics.totalRuns, "run")}`);
  }

  const totalCost = costs?.total?.cost;
  if (typeof totalCost === "number" && totalCost > 0) {
    bits.push(`$${totalCost.toFixed(2)} all-time`);
  }

  return bits.join(" · ") + ".";
}

function renderDigest({ markSynced = false } = {}) {
  if (digestText) {
    digestText.innerHTML = composeDigest(digestState);
  }
  if (markSynced && digestSync) {
    digestSync.textContent = `synced ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  }

  setTabBadge(
    "mission",
    (digestState.issues?.summary?.todo ?? 0) + (digestState.issues?.summary?.blocked ?? 0)
  );
  setTabBadge(
    "activity",
    digestState.queue.filter((task) => task.status === "running").length
  );
}

async function refreshDigest() {
  const [status, metrics, costs, issues, queueData] = await Promise.all([
    fetchJson("/api/status"),
    fetchJson("/api/execute/metrics"),
    fetchJson("/api/rei/costs"),
    fetchJson("/api/github/issues"),
    fetchJson("/api/execute/queue")
  ]);

  const queue = queueData?.tasks || [];
  if (Array.isArray(issues?.issues)) issueCache = issues.issues;

  digestState.status = status;
  digestState.metrics = metrics;
  digestState.costs = costs;
  digestState.issues = issues;
  digestState.queue = queue;
  renderDigest({ markSynced: true });
}

window.addEventListener("rei-status-updated", (event) => {
  if (!event.detail) return;
  digestState.status = event.detail;
  renderDigest();
});

refreshDigest();
setInterval(refreshDigest, REFRESH_MS);

/* ═══ 3. Command palette ════════════════════════════════════════════════════ */

let paletteEl = null;
let paletteItems = [];
let paletteSelected = 0;

function focusElement(el) {
  if (!el) return;
  el.scrollIntoView({ block: "center", behavior: "smooth" });
  setTimeout(() => el.focus(), 250);
}

function clickElement(el) {
  if (el && !el.disabled) el.click();
}

function baseActions() {
  return [
    { icon: "🛰", label: "Go to Mission tab", hint: "1", run: () => setTab("mission") },
    { icon: "🧠", label: "Go to Brain tab", hint: "2", run: () => setTab("brain") },
    { icon: "📡", label: "Go to Activity tab", hint: "3", run: () => setTab("activity") },
    { icon: "✏️", label: "New direct task for Rei", hint: "t", run: () => { setTab("mission"); focusElement($("task-queue-input")); } },
    { icon: "💬", label: "Chat with Rei", hint: "/", run: () => {
        const panel = $("rei-chat-panel");
        if (panel) panel.classList.remove("collapsed");
        focusElement($("rei-chat-input"));
      } },
    { icon: "🔍", label: "Search Rei's memory", run: () => { setTab("brain"); focusElement($("brain-memory-search")); } },
    { icon: "📋", label: "Generate handoff recap", run: () => { setTab("mission"); clickElement($("handoff-generate-button")); } },
    { icon: "🤖", label: "Toggle autopilot", run: () => clickElement($("github-autopilot-button")) },
    { icon: "🛠", label: "Toggle layout editor", run: () => clickElement($("editor-toggle")) },
    { icon: "🪟", label: "Switch room / widget view", run: () => {
        const next = document.body.classList.contains("widget-mode") ? "room" : "widget";
        const btn = document.querySelector(`.view-button[data-mode="${next}"]`);
        clickElement(btn);
      } },
    { icon: "🔔", label: "Enable desktop notifications", run: () => {
        if ("Notification" in window) Notification.requestPermission();
      } },
    ...issueCache.slice(0, 12).map((issue) => ({
      icon: "⬡",
      label: `Open #${issue.number} — ${issue.title}`,
      hint: "github",
      run: () => { if (issue.url) window.open(issue.url, "_blank", "noopener"); }
    }))
  ];
}

function fuzzyMatch(query, text) {
  const q = query.toLowerCase().trim();
  if (!q) return true;
  const t = text.toLowerCase();
  if (t.includes(q)) return true;
  // subsequence match: "gha" → "Generate handoff"
  let i = 0;
  for (const ch of t) {
    if (ch === q[i]) i += 1;
    if (i === q.length) return true;
  }
  return false;
}

function buildPalette() {
  paletteEl = document.createElement("div");
  paletteEl.className = "palette-overlay";
  paletteEl.hidden = true;
  paletteEl.innerHTML = `
    <div class="palette-box" role="dialog" aria-label="Command palette">
      <input class="palette-input" type="text" placeholder="Type a command or search issues…" />
      <ul class="palette-list"></ul>
      <div class="palette-foot">
        <span>↑↓ navigate</span><span>↵ run</span><span>esc close</span>
      </div>
    </div>`;
  document.body.appendChild(paletteEl);

  const input = paletteEl.querySelector(".palette-input");
  const list = paletteEl.querySelector(".palette-list");

  function renderList() {
    const query = input.value;
    paletteItems = baseActions().filter((a) => fuzzyMatch(query, a.label));
    paletteSelected = Math.min(paletteSelected, Math.max(paletteItems.length - 1, 0));

    if (paletteItems.length === 0) {
      list.innerHTML = `<div class="palette-empty">nothing matches “${escapeHtml(query)}”</div>`;
      return;
    }

    list.innerHTML = paletteItems.map((a, i) => `
      <li class="palette-item ${i === paletteSelected ? "is-selected" : ""}" data-index="${i}">
        <span class="palette-item-icon">${a.icon}</span>
        <span>${escapeHtml(a.label)}</span>
        ${a.hint ? `<span class="mono">${escapeHtml(a.hint)}</span>` : ""}
      </li>`).join("");

    list.querySelectorAll(".palette-item").forEach((el) => {
      el.addEventListener("click", () => {
        const action = paletteItems[Number(el.dataset.index)];
        closePalette();
        action?.run();
      });
      el.addEventListener("mousemove", () => {
        paletteSelected = Number(el.dataset.index);
        list.querySelectorAll(".palette-item").forEach((other) => {
          other.classList.toggle("is-selected", other === el);
        });
      });
    });
  }

  input.addEventListener("input", () => {
    paletteSelected = 0;
    renderList();
  });

  input.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      paletteSelected = Math.min(paletteSelected + 1, paletteItems.length - 1);
      renderList();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      paletteSelected = Math.max(paletteSelected - 1, 0);
      renderList();
    } else if (event.key === "Enter") {
      event.preventDefault();
      const action = paletteItems[paletteSelected];
      closePalette();
      action?.run();
    } else if (event.key === "Escape") {
      closePalette();
    }
  });

  paletteEl.addEventListener("click", (event) => {
    if (event.target === paletteEl) closePalette();
  });

  paletteEl._render = renderList;
}

function openPalette() {
  if (!paletteEl) buildPalette();
  paletteEl.hidden = false;
  const input = paletteEl.querySelector(".palette-input");
  input.value = "";
  paletteSelected = 0;
  paletteEl._render();
  input.focus();
}

function closePalette() {
  if (paletteEl) paletteEl.hidden = true;
}

$("palette-open")?.addEventListener("click", openPalette);

/* ═══ 4. Toasts + desktop notifications ═════════════════════════════════════ */

let toastStack = null;

function showToast(message, { tone = "info", meta = "" } = {}) {
  if (!toastStack) {
    toastStack = document.createElement("div");
    toastStack.className = "toast-stack";
    document.body.appendChild(toastStack);
  }

  const toast = document.createElement("div");
  toast.className = `toast ${tone === "ok" ? "is-ok" : tone === "bad" ? "is-bad" : ""}`;
  toast.innerHTML = `<div>${escapeHtml(message)}${meta ? `<span class="mono">${escapeHtml(meta)}</span>` : ""}</div>`;
  toastStack.appendChild(toast);

  setTimeout(() => {
    toast.classList.add("is-leaving");
    toast.addEventListener("animationend", () => toast.remove(), { once: true });
  }, 6000);

  while (toastStack.children.length > 4) {
    toastStack.firstChild.remove();
  }
}

function notifyDesktop(title, body) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  if (document.visibilityState === "visible") return; // toast is enough
  try {
    new Notification(title, { body, icon: "/favicon.svg" });
  } catch { /* not critical */ }
}

const seenTaskStatus = new Map();
let queuePrimed = false;

// Diff a queue snapshot against what we last saw and toast on transitions.
// Driven by both the live SSE stream (instant) and the poll fallback below.
function diffQueueForToasts(tasks) {
  if (!Array.isArray(tasks)) return;

  for (const task of tasks) {
    const prev = seenTaskStatus.get(task.id);
    seenTaskStatus.set(task.id, task.status);
    if (!queuePrimed || prev === task.status) continue;

    const label = (task.prompt || task.title || task.id || "task").slice(0, 70);
    if (task.status === "done") {
      showToast(`✓ Rei finished: ${label}`, { tone: "ok", meta: task.runtimeId || "" });
      notifyDesktop("Rei finished a task", label);
    } else if (task.status === "failed") {
      showToast(`✕ Run failed: ${label}`, { tone: "bad", meta: task.runtimeId || "" });
      notifyDesktop("Rei run failed", label);
    } else if (task.status === "running" && (prev === "queued" || prev === "launching")) {
      showToast(`▶ Rei picked up: ${label}`, { meta: task.runtimeId || "" });
    }
  }
  queuePrimed = true;
}

async function pollQueueForToasts() {
  const data = await fetchJson("/api/execute/queue");
  if (data && Array.isArray(data.tasks)) diffQueueForToasts(data.tasks);
}

// Instant path: the live stream pushes queue changes the moment they happen,
// so toasts fire without waiting for the poll tick. It also refreshes the
// activity-tab badge live.
window.addEventListener("rei-live:panels", (event) => {
  const tasks = event.detail?.queue?.tasks;
  if (Array.isArray(tasks)) {
    diffQueueForToasts(tasks);
    setTabBadge("activity", tasks.filter((task) => task.status === "running").length);
  }
});

pollQueueForToasts();
setInterval(pollQueueForToasts, QUEUE_POLL_MS);

/* ═══ 5. Shortcuts + help overlay ═══════════════════════════════════════════ */

let helpEl = null;

const SHORTCUTS = [
  ["⌘K / Ctrl+K", "command palette"],
  ["1 / 2 / 3", "mission · brain · activity"],
  ["t", "new direct task"],
  ["/", "chat with rei"],
  ["?", "this help"],
  ["esc", "close overlays"]
];

function toggleHelp(force) {
  if (!helpEl) {
    helpEl = document.createElement("div");
    helpEl.className = "help-overlay";
    helpEl.hidden = true;
    helpEl.innerHTML = `
      <div class="help-box" role="dialog" aria-label="Keyboard shortcuts">
        <h3>keyboard shortcuts</h3>
        ${SHORTCUTS.map(([keys, desc]) => `
          <div class="help-row"><span>${escapeHtml(desc)}</span><span class="kbd">${escapeHtml(keys)}</span></div>
        `).join("")}
      </div>`;
    helpEl.addEventListener("click", (event) => {
      if (event.target === helpEl) helpEl.hidden = true;
    });
    document.body.appendChild(helpEl);
  }
  helpEl.hidden = force !== undefined ? !force : !helpEl.hidden;
}

document.addEventListener("keydown", (event) => {
  // Palette opens from anywhere, even while typing
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    if (paletteEl && !paletteEl.hidden) closePalette();
    else openPalette();
    return;
  }

  if (event.key === "Escape") {
    closePalette();
    if (helpEl) helpEl.hidden = true;
    return;
  }

  if (isTypingTarget(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;

  switch (event.key) {
    case "1": setTab("mission"); break;
    case "2": setTab("brain"); break;
    case "3": setTab("activity"); break;
    case "t":
      event.preventDefault();
      setTab("mission");
      focusElement($("task-queue-input"));
      break;
    case "/":
      event.preventDefault();
      $("rei-chat-panel")?.classList.remove("collapsed");
      focusElement($("rei-chat-input"));
      break;
    case "?": toggleHelp(); break;
  }
});
