import test from "node:test";
import assert from "node:assert/strict";

import { __test__, buildEvent, notifyRun } from "../tools/rei-webhooks.mjs";

const { buildSlackPayload, buildDiscordPayload, humanizeMs } = __test__;

test("humanizeMs formats seconds, minutes, hours", () => {
  assert.equal(humanizeMs(5_000), "5s");
  assert.equal(humanizeMs(90_000), "1m 30s");
  assert.equal(humanizeMs(60_000), "1m");
  assert.equal(humanizeMs(3_660_000), "1h 1m");
  assert.equal(humanizeMs(null), "—");
});

test("buildSlackPayload includes emoji, color, fields", () => {
  const ev = {
    kind: "completed",
    emoji: "✅",
    color: "57F287",
    timestamp: "2026-05-29T10:00:00Z",
    issue: { number: 42, title: "Add dark mode", url: "https://gh.com/42" },
    repo: "demo/repo",
    runtime: "claude-code",
    profile: "frontend",
    detail: "All done.",
    durationMs: 90_000
  };
  const slack = buildSlackPayload(ev);
  assert.match(slack.text, /✅ Rei — completed #42/);
  assert.equal(slack.attachments[0].color, "#57F287");
  assert.ok(slack.attachments[0].fields.some((f) => f.value === "claude-code"));
  assert.ok(slack.attachments[0].fields.some((f) => f.value === "1m 30s"));
  assert.equal(slack.attachments[0].actions[0].url, "https://gh.com/42");
});

test("buildDiscordPayload returns embed with parsed hex color", () => {
  const ev = {
    kind: "failed",
    emoji: "❌",
    color: "ED4245",
    timestamp: "2026-05-29T10:00:00Z",
    issue: { number: 1, title: "Bug", url: null },
    repo: "x/y",
    runtime: null,
    profile: null,
    detail: "Crashed",
    durationMs: null
  };
  const discord = buildDiscordPayload(ev);
  assert.equal(discord.username, "Rei");
  assert.equal(discord.embeds[0].color, parseInt("ED4245", 16));
  assert.match(discord.embeds[0].title, /❌ failed — #1 Bug/);
});

test("buildEvent returns null when event kind is disabled", async () => {
  // Force an event filter that excludes 'started'
  const orig = process.env.REI_WEBHOOK_EVENTS;
  process.env.REI_WEBHOOK_EVENTS = "completed,failed";
  try {
    const ev = await buildEvent({
      kind: "started",
      issueNumber: 1,
      issueTitle: "t"
    });
    assert.equal(ev, null);
  } finally {
    if (orig === undefined) delete process.env.REI_WEBHOOK_EVENTS;
    else process.env.REI_WEBHOOK_EVENTS = orig;
  }
});

test("notifyRun gracefully reports when no sinks configured", async () => {
  // Make sure no webhook URLs are set
  const saved = {
    slack: process.env.REI_SLACK_WEBHOOK_URL,
    discord: process.env.REI_DISCORD_WEBHOOK_URL,
    generic: process.env.REI_WEBHOOK_URL
  };
  delete process.env.REI_SLACK_WEBHOOK_URL;
  delete process.env.REI_DISCORD_WEBHOOK_URL;
  delete process.env.REI_WEBHOOK_URL;
  try {
    const result = await notifyRun({
      kind: "completed",
      issueNumber: 1,
      issueTitle: "x"
    });
    assert.equal(result.skipped, "no_sinks_configured");
  } finally {
    if (saved.slack)   process.env.REI_SLACK_WEBHOOK_URL = saved.slack;
    if (saved.discord) process.env.REI_DISCORD_WEBHOOK_URL = saved.discord;
    if (saved.generic) process.env.REI_WEBHOOK_URL = saved.generic;
  }
});

test("notifyRun never throws on bad URL", async () => {
  process.env.REI_WEBHOOK_URL = "http://127.0.0.1:1"; // unreachable
  try {
    const result = await notifyRun({
      kind: "completed",
      issueNumber: 1,
      issueTitle: "x"
    });
    assert.equal(typeof result, "object");
    assert.ok("generic" in result);
    assert.equal(result.generic.ok, false);
  } finally {
    delete process.env.REI_WEBHOOK_URL;
  }
});
