/**
 * rei-chat-panel.js — Bottom-fixed chat panel for talking to Rei live.
 *
 * Polls /api/rei/chat every 3s (cheap), POSTs new messages to /api/rei/chat.
 * Slash commands (/pause, /focus …) are sent verbatim — the server interprets
 * them and writes the resulting system message back to the log.
 *
 * Mood-driven accent colour on Rei's bubbles comes from window.reiPersonality
 * which the brain panel keeps fresh.
 */

const POLL_MS = 3_000;

const panelEl    = document.getElementById("rei-chat-panel");
const toggleEl   = document.getElementById("rei-chat-toggle");
const listEl     = document.getElementById("rei-chat-list");
const formEl     = document.getElementById("rei-chat-form");
const inputEl    = document.getElementById("rei-chat-input");
const hintEl     = document.getElementById("rei-chat-hint");
const unreadDot  = document.getElementById("rei-chat-unread");

if (!panelEl) {
  // Page didn't ship the chat panel markup; do nothing.
} else {
  let lastTimestamp = null;
  let collapsed = localStorage.getItem("rei-chat-collapsed") === "true";
  let unread = 0;
  applyCollapsed();

  function applyCollapsed() {
    if (collapsed) {
      panelEl.classList.add("collapsed");
    } else {
      panelEl.classList.remove("collapsed");
      unread = 0;
      if (unreadDot) unreadDot.hidden = true;
    }
  }

  toggleEl?.addEventListener("click", () => {
    collapsed = !collapsed;
    localStorage.setItem("rei-chat-collapsed", String(collapsed));
    applyCollapsed();
    if (!collapsed) void scrollToBottom();
  });

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function timeAgo(iso) {
    if (!iso) return "";
    const diff = Date.now() - new Date(iso).getTime();
    if (diff < 60_000) return "just now";
    const m = Math.floor(diff / 60_000);
    if (m < 60) return `${m}m ago`;
    return `${Math.floor(m / 60)}h ago`;
  }

  function bubbleClass(role) {
    return role === "user" ? "rei-chat-msg-user"
         : role === "rei"  ? "rei-chat-msg-rei"
         :                   "rei-chat-msg-system";
  }

  function renderMessages(messages, append = false) {
    if (!listEl) return;
    const html = messages.map((m) => {
      const accent = m.role === "rei"
        ? (window.reiPersonality?.voice?.color || "#65e4ff")
        : null;
      const style = accent ? `style="border-left-color:${accent};"` : "";
      const label = m.role === "user" ? "you"
                  : m.role === "rei"  ? "rei"
                  :                     "sys";
      return `
        <div class="rei-chat-msg ${bubbleClass(m.role)}" ${style}>
          <div class="rei-chat-msg-head">
            <span class="rei-chat-msg-label">${label}</span>
            <span class="rei-chat-msg-time">${timeAgo(m.timestamp)}</span>
          </div>
          <div class="rei-chat-msg-body">${escapeHtml(m.text)}</div>
        </div>`;
    }).join("");

    if (append) {
      listEl.insertAdjacentHTML("beforeend", html);
    } else {
      listEl.innerHTML = html;
    }
  }

  async function scrollToBottom() {
    requestAnimationFrame(() => {
      if (listEl) listEl.scrollTop = listEl.scrollHeight;
    });
  }

  async function fullRefresh() {
    try {
      const res = await fetch("/api/rei/chat?limit=60");
      if (!res.ok) return;
      const data = await res.json();
      const msgs = data.messages || [];
      renderMessages(msgs);
      if (msgs.length > 0) {
        lastTimestamp = msgs[msgs.length - 1].timestamp;
      }
      await scrollToBottom();
    } catch { /* network blip */ }
  }

  async function pollTail() {
    if (!lastTimestamp) return fullRefresh();
    try {
      const res = await fetch(`/api/rei/chat?after=${encodeURIComponent(lastTimestamp)}&limit=20`);
      if (!res.ok) return;
      const data = await res.json();
      const fresh = data.messages || [];
      if (fresh.length === 0) return;
      renderMessages(fresh, true);
      lastTimestamp = fresh[fresh.length - 1].timestamp;
      await scrollToBottom();
      if (collapsed) {
        unread += fresh.filter((m) => m.role !== "user").length;
        if (unread > 0 && unreadDot) unreadDot.hidden = false;
      }
    } catch {}
  }

  formEl?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const text = (inputEl?.value || "").trim();
    if (!text) return;
    inputEl.value = "";
    if (hintEl) hintEl.textContent = "sending…";

    try {
      const res = await fetch("/api/rei/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text })
      });
      if (!res.ok) {
        if (hintEl) hintEl.textContent = `error: HTTP ${res.status}`;
        return;
      }
      // Immediately reflect the user message + any replies
      await pollTail();
      if (hintEl) hintEl.textContent = "";
    } catch (error) {
      if (hintEl) hintEl.textContent = `error: ${error.message || error}`;
    }
  });

  inputEl?.addEventListener("keydown", (event) => {
    // Submit on Enter (no shift) — keep textarea-friendly UX
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      formEl?.requestSubmit();
    }
  });

  void fullRefresh();
  setInterval(pollTail, POLL_MS);
}
