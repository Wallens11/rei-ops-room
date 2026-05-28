/**
 * rei-brain-panel.js — Brain panel showing Rei's memory + cost stats.
 *
 * Polls /api/rei/memory (recent N) and /api/rei/costs every 30s.
 * Lets you search memory by typing in the search box.
 * Self-contained, no external deps.
 */

const POLL_MS = 30_000;

const costSummaryEl     = document.getElementById("brain-cost-summary");
const costTotalEl       = document.getElementById("brain-cost-total");
const memorySearchEl    = document.getElementById("brain-memory-search");
const memoryListEl      = document.getElementById("brain-memory-list");
const memoryCountEl     = document.getElementById("brain-memory-count");

const TYPE_LABEL = {
  fact:     { icon: "📌", color: "#65e4ff" },
  pattern:  { icon: "🔁", color: "#b8a2ff" },
  decision: { icon: "🧭", color: "#ffcc66" },
  warning:  { icon: "⚠️", color: "#ff907c" },
  solution: { icon: "🛠️", color: "#7cffba" }
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

export async function pollRei() {
  await Promise.all([pollCosts(), searchMemory(memorySearchEl?.value || "")]);
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
