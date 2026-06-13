/**
 * rei-brain-panel.js — Brain panel showing Rei's memory + cost stats.
 *
 * Polls /api/rei/memory (recent N) and /api/rei/costs every 30s.
 * Lets you search memory by typing in the search box.
 * Self-contained, no external deps.
 */

const POLL_MS = 10_000;

const costSummaryEl     = document.getElementById("brain-cost-summary");
const costTotalEl       = document.getElementById("brain-cost-total");
const memorySearchEl    = document.getElementById("brain-memory-search");
const memoryListEl      = document.getElementById("brain-memory-list");
const memoryCountEl     = document.getElementById("brain-memory-count");
const moodBadgeEl       = document.getElementById("brain-mood-badge");
const moodTaglineEl     = document.getElementById("brain-mood-tagline");
const thoughtsListEl    = document.getElementById("brain-thoughts-list");

const TYPE_LABEL = {
  fact:     { icon: "📌", color: "var(--cyan)" },
  pattern:  { icon: "🔁", color: "var(--violet)" },
  decision: { icon: "🧭", color: "var(--amber)" },
  warning:  { icon: "⚠️", color: "var(--rose)" },
  solution: { icon: "🛠️", color: "var(--mint)" }
};

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function timeAgo(iso) {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function renderMemory(entries) {
  if (!memoryListEl) return;
  if (!entries || entries.length === 0) {
    memoryListEl.innerHTML = '<span style="font-size:11px;opacity:.5;">No memory entries yet. Rei will start learning as she runs.</span>';
    if (memoryCountEl) memoryCountEl.textContent = "0";
    return;
  }
  if (memoryCountEl) memoryCountEl.textContent = String(entries.length);
  memoryListEl.innerHTML = entries.map((e) => {
    const meta = TYPE_LABEL[e.type] || TYPE_LABEL.fact;
    const topic = e.topic ? `<span style="color:${meta.color};font-weight:600;">${escapeHtml(e.topic)}</span> — ` : "";
    const content = escapeHtml(e.content || "").slice(0, 220);
    const scoreChip = e.score ? `<span style="font-size:9px;opacity:.5;margin-left:4px;">score ${e.score}</span>` : "";
    return `
      <div style="padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.06);font-size:11px;line-height:1.4;">
        <span style="margin-right:4px;">${meta.icon}</span>${topic}${content}
        <div style="margin-top:2px;font-size:9px;opacity:.45;">
          ${e.type}${e.source ? ` · ${escapeHtml(e.source)}` : ""} · ${timeAgo(e.createdAt)}${scoreChip}
        </div>
      </div>`;
  }).join("");
}

function renderCosts(data) {
  if (!data) return;
  if (costSummaryEl) costSummaryEl.textContent = data.summary || "no runs yet";
  if (costTotalEl) {
    const t = data.total || { cost: 0, runs: 0, tokens: 0 };
    costTotalEl.textContent = `all-time: $${t.cost.toFixed(3)} (${t.runs} runs, ${(t.tokens || 0).toLocaleString()} tok)`;
  }
}

let searchDebounce = null;
async function searchMemory(query) {
  try {
    const url = query
      ? `/api/rei/memory?q=${encodeURIComponent(query)}&limit=12`
      : `/api/rei/memory?limit=12`;
    const res = await fetch(url);
    if (!res.ok) return;
    const data = await res.json();
    renderMemory(data.entries || []);
  } catch {
    // network error — keep previous render
  }
}

async function pollCosts() {
  try {
    const res = await fetch("/api/rei/costs");
    if (!res.ok) return;
    renderCosts(await res.json());
  } catch {}
}

const PHASE_COLOR = {
  start:   "var(--cyan)",
  plan:    "var(--violet)",
  explore: "var(--cyan)",
  edit:    "var(--amber)",
  verify:  "var(--mint)",
  memory:  "var(--violet)",
  summary: "var(--cyan)",
  info:    "var(--muted)",
  error:   "var(--rose)"
};

function renderThoughts(entries, phaseIcons = {}) {
  if (!thoughtsListEl) return;
  if (!entries || entries.length === 0) {
    thoughtsListEl.innerHTML = '<span style="font-size:11px;opacity:.5;">Rei hasn’t said anything yet.</span>';
    return;
  }
  thoughtsListEl.innerHTML = entries.slice().reverse().map((e) => {
    const icon = e.icon || phaseIcons[e.phase] || "•";
    const color = PHASE_COLOR[e.phase] || "var(--muted)";
    const ref = e.issueRef ? `<span style="opacity:.5;margin-left:6px;">${escapeHtml(e.issueRef)}</span>` : "";
    return `
      <div style="padding:5px 0;border-bottom:1px solid rgba(255,255,255,0.06);font-size:11px;line-height:1.4;">
        <span style="color:${color};margin-right:5px;">${icon}</span>${escapeHtml(e.text)}${ref}
        <div style="font-size:9px;opacity:.45;margin-top:2px;">${timeAgo(e.timestamp)} · ${e.phase}</div>
      </div>`;
  }).join("");
}

async function pollThoughts() {
  try {
    const res = await fetch("/api/rei/narration?limit=8");
    if (!res.ok) return;
    const data = await res.json();
    renderThoughts(data.entries || [], data.phaseIcons || {});
  } catch {}
}

let lastMoodSeen = null;
async function pollPersonality() {
  try {
    const res = await fetch("/api/rei/personality");
    if (!res.ok) return;
    const p = await res.json();
    const icon = p.voice?.icon || "•";
    const color = p.voice?.color || "var(--ink)";
    if (moodBadgeEl) {
      moodBadgeEl.innerHTML = `<span style="color:${color};">${icon}</span>&nbsp;${p.mood}`;
      moodBadgeEl.style.color = color;
    }
    if (moodTaglineEl) {
      moodTaglineEl.textContent = p.tagline || p.voice?.tagline || "";
    }
    // Expose on window for the canvas day/night + animation density
    if (typeof window !== "undefined") {
      window.reiPersonality = p;
      // Trigger a one-off thought puff burst when mood shifts to playful
      if (p.mood !== lastMoodSeen && p.mood === "playful" && typeof window.reiSpawnBurst === "function") {
        // Burst near a default position; canvas chooses actor when available
        window.reiSpawnBurst("thought", 320, 200, 4);
      }
      lastMoodSeen = p.mood;
    }
  } catch {}
}

export async function pollRei() {
  await Promise.all([
    pollCosts(),
    searchMemory(memorySearchEl?.value || ""),
    pollThoughts(),
    pollPersonality()
  ]);
}

if (memorySearchEl) {
  memorySearchEl.addEventListener("input", (event) => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => {
      void searchMemory(event.target.value || "");
    }, 220);
  });
}

pollRei();
setInterval(pollRei, POLL_MS);

// Real-time cost updates pushed from the live stream (rei-live.js). The 10s
// poll above still drives memory / thoughts / personality; this just makes the
// cost ledger update the instant a run records spend.
window.addEventListener("rei-live:panels", (event) => {
  const costs = event.detail?.costs;
  if (costs) renderCosts(costs);
});
