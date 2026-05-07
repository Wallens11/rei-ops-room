/**
 * execute-artifacts-panel.js — Artifact panel for visual-explainer HTML outputs.
 *
 * Polls /api/execute/artifacts every 30s and renders clickable links.
 * Clicking an artifact opens it in a new tab via /api/execute/artifacts/:filename.
 */

const POLL_INTERVAL_MS = 30_000;

const titleEl = document.getElementById("artifacts-title");
const chipEl = document.getElementById("artifacts-chip");
const emptyEl = document.getElementById("artifacts-empty");
const listEl = document.getElementById("artifacts-list");

let knownFilenames = new Set();

function renderArtifacts(artifacts) {
  if (!artifacts || artifacts.length === 0) {
    chipEl.hidden = true;
    emptyEl.hidden = false;
    listEl.innerHTML = "";
    return;
  }

  emptyEl.hidden = true;
  chipEl.hidden = false;
  chipEl.textContent = String(artifacts.length);

  // Only re-render if something changed
  const incoming = new Set(artifacts.map(a => a.filename));
  const changed =
    incoming.size !== knownFilenames.size ||
    [...incoming].some(f => !knownFilenames.has(f));

  if (!changed) return;
  knownFilenames = incoming;

  listEl.innerHTML = "";

  // Most recent first
  const sorted = [...artifacts].sort(
    (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
  );

  for (const artifact of sorted) {
    const li = document.createElement("li");
    li.className = "stack-item";
    li.style.cssText = "display:flex;justify-content:space-between;align-items:center;gap:8px;";

    const name = document.createElement("span");
    name.style.cssText = "font-family:monospace;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;";
    name.textContent = artifact.filename.replace(/\.html$/, "");
    name.title = artifact.filename;

    const meta = document.createElement("span");
    meta.style.cssText = "font-size:10px;color:var(--text-dim,rgba(255,255,255,0.45));white-space:nowrap;";
    const ts = new Date(artifact.createdAt);
    meta.textContent = ts.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    if (artifact.issueNumber) {
      meta.textContent = `#${artifact.issueNumber} · ${meta.textContent}`;
    }

    const btn = document.createElement("a");
    btn.href = `/api/execute/artifacts/${encodeURIComponent(artifact.filename)}`;
    btn.target = "_blank";
    btn.rel = "noopener noreferrer";
    btn.style.cssText =
      "font-size:10px;padding:2px 8px;border-radius:6px;background:rgba(255,255,255,0.1);color:inherit;text-decoration:none;white-space:nowrap;";
    btn.textContent = "Open";

    li.append(name, meta, btn);
    listEl.append(li);
  }
}

async function pollArtifacts() {
  try {
    const res = await fetch("/api/execute/artifacts");
    if (!res.ok) return;
    const data = await res.json();
    renderArtifacts(data.artifacts ?? []);
  } catch {
    // Network error — silently skip
  }
}

// Initial load + periodic refresh
pollArtifacts();
setInterval(pollArtifacts, POLL_INTERVAL_MS);

// Export so app.js can call pollArtifacts after a completed run
export { pollArtifacts };
