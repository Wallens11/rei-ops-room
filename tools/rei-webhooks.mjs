/**
 * rei-webhooks.mjs — Outbound notifications to Slack / Discord / generic.
 *
 * Triggers on run lifecycle events: started, completed, failed, blocked,
 * review_needed. Configured via either env vars or rei.config.json.
 *
 *   REI_SLACK_WEBHOOK_URL    — https://hooks.slack.com/services/…
 *   REI_DISCORD_WEBHOOK_URL  — https://discord.com/api/webhooks/…
 *   REI_WEBHOOK_URL          — generic POST-JSON endpoint
 *   REI_WEBHOOK_EVENTS       — comma list, defaults to: completed,failed,blocked
 *
 * Everything is best-effort: webhook errors are swallowed so the worker
 * never crashes because Slack is down.
 *
 * Each platform gets a format that looks native there. Generic webhook
 * receives the raw event payload — handy for n8n / Zapier / your own
 * tiny relay.
 */

import fs from "node:fs/promises";
import path from "node:path";

import { projectRoot } from "./execute-worker-state.mjs";

const DEFAULT_EVENTS = ["completed", "failed", "blocked", "review_needed"];

const OUTCOME_EMOJI = {
  started: "🚀",
  completed: "✅",
  failed: "❌",
  blocked: "🚧",
  review_needed: "👀",
  aborted: "⏹️"
};

const OUTCOME_COLOR = {
  // Slack attachments + Discord embeds want hex without '#'
  started: "5865F2",
  completed: "57F287",
  failed: "ED4245",
  blocked: "FEE75C",
  review_needed: "EB459E",
  aborted: "747F8D"
};

// ─── Config ────────────────────────────────────────────────────────────────

async function loadConfig() {
  const fromFile = await fs
    .readFile(path.join(projectRoot, "rei.config.json"), "utf8")
    .then((s) => {
      try { return JSON.parse(s); } catch { return {}; }
    })
    .catch(() => ({}));

  const webhooks = fromFile?.webhooks || {};

  const slack = process.env.REI_SLACK_WEBHOOK_URL || webhooks.slack || null;
  const discord = process.env.REI_DISCORD_WEBHOOK_URL || webhooks.discord || null;
  const generic = process.env.REI_WEBHOOK_URL || webhooks.generic || null;

  const events = (process.env.REI_WEBHOOK_EVENTS || webhooks.events || DEFAULT_EVENTS.join(","))
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean);

  return { slack, discord, generic, events };
}

// ─── Event payload shape ──────────────────────────────────────────────────

/**
 * Build a normalised event payload from a worker outcome.
 * Returns null if the event isn't enabled (so callers can `if (!ev) return`).
 */
export async function buildEvent({
  kind,                    // "started" | "completed" | "failed" | "blocked" | "review_needed" | "aborted"
  issueNumber,
  issueTitle,
  issueUrl,
  repo,
  runtimeId,
  profileId,
  detail = "",
  durationMs = null
}) {
  const config = await loadConfig();
  if (!config.events.includes(kind)) return null;

  return {
    kind,
    emoji: OUTCOME_EMOJI[kind] || "•",
    color: OUTCOME_COLOR[kind] || "5865F2",
    timestamp: new Date().toISOString(),
    issue: {
      number: issueNumber,
      title: issueTitle || "",
      url: issueUrl || null
    },
    repo: repo || null,
    runtime: runtimeId || null,
    profile: profileId || null,
    detail: String(detail || "").slice(0, 800),
    durationMs,
    config
  };
}

// ─── Slack ────────────────────────────────────────────────────────────────

function buildSlackPayload(ev) {
  const titleLine = `${ev.emoji} Rei — ${ev.kind} #${ev.issue.number}`;
  const subtitle = ev.issue.title ? ` — ${ev.issue.title}` : "";

  const fields = [];
  if (ev.repo)    fields.push({ title: "Repo", value: ev.repo, short: true });
  if (ev.runtime) fields.push({ title: "Runtime", value: ev.runtime, short: true });
  if (ev.profile) fields.push({ title: "Profile", value: ev.profile, short: true });
  if (ev.durationMs != null) {
    fields.push({ title: "Duration", value: humanizeMs(ev.durationMs), short: true });
  }

  return {
    text: `${titleLine}${subtitle}`,
    attachments: [
      {
        color: `#${ev.color}`,
        fields,
        text: ev.detail || "",
        ts: Math.floor(new Date(ev.timestamp).getTime() / 1000),
        actions: ev.issue.url
          ? [{ type: "button", text: "Open issue", url: ev.issue.url }]
          : undefined
      }
    ]
  };
}

// ─── Discord ──────────────────────────────────────────────────────────────

function buildDiscordPayload(ev) {
  const fields = [];
  if (ev.repo)    fields.push({ name: "Repo", value: ev.repo, inline: true });
  if (ev.runtime) fields.push({ name: "Runtime", value: ev.runtime, inline: true });
  if (ev.profile) fields.push({ name: "Profile", value: ev.profile, inline: true });
  if (ev.durationMs != null) {
    fields.push({ name: "Duration", value: humanizeMs(ev.durationMs), inline: true });
  }

  return {
    username: "Rei",
    embeds: [
      {
        title: `${ev.emoji} ${ev.kind} — #${ev.issue.number} ${ev.issue.title || ""}`.slice(0, 256),
        url: ev.issue.url || undefined,
        description: ev.detail || undefined,
        color: parseInt(ev.color, 16),
        fields,
        timestamp: ev.timestamp,
        footer: { text: "rei-ops-room" }
      }
    ]
  };
}

// ─── Dispatch ─────────────────────────────────────────────────────────────

async function postJson(url, payload, { timeoutMs = 5000 } = {}) {
  if (!url) return { ok: false, reason: "no_url" };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    return { ok: res.ok, status: res.status };
  } catch (error) {
    return { ok: false, reason: error?.message || String(error) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Send the event to every configured destination. Returns a summary
 * of which sinks fired and which were skipped. Never throws.
 */
export async function notifyRun(opts) {
  try {
    const ev = await buildEvent(opts);
    if (!ev) return { skipped: "event_not_enabled" };

    const { slack, discord, generic } = ev.config;
    const tasks = [];

    if (slack)   tasks.push(["slack",   postJson(slack,   buildSlackPayload(ev))]);
    if (discord) tasks.push(["discord", postJson(discord, buildDiscordPayload(ev))]);
    if (generic) tasks.push(["generic", postJson(generic, ev)]);

    if (tasks.length === 0) return { skipped: "no_sinks_configured" };

    const results = await Promise.all(tasks.map(async ([name, p]) => [name, await p]));
    return Object.fromEntries(results);
  } catch (error) {
    return { error: error?.message || String(error) };
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function humanizeMs(ms) {
  if (ms == null) return "—";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  if (m < 60) return rs ? `${m}m ${rs}s` : `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

export const __test__ = { buildSlackPayload, buildDiscordPayload, humanizeMs };
