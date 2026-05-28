import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "rei-chat-"));
process.env.REI_PROJECT_ROOT = tmp;

const {
  appendMessage,
  readMessages,
  readUnconsumedUserMessages,
  readChatCursor,
  advanceChatCursor,
  parseSlashCommand,
  renderSlashHelp,
  formatChatInjection,
  SLASH_COMMANDS,
  chatFile
} = await import("../tools/rei-chat.mjs");

test("appendMessage stores a user message", async () => {
  try { await fs.unlink(chatFile); } catch {}
  const entry = await appendMessage({ role: "user", text: "Hey Rei, focus on tests." });
  assert.ok(entry);
  assert.equal(entry.role, "user");
  assert.equal(entry.text, "Hey Rei, focus on tests.");
  const all = await readMessages();
  assert.equal(all.length, 1);
});

test("appendMessage rejects unknown role → falls back to 'user'", async () => {
  const entry = await appendMessage({ role: "ghost", text: "boo" });
  assert.equal(entry.role, "user");
});

test("appendMessage returns null for empty text", async () => {
  assert.equal(await appendMessage({ text: "   " }), null);
});

test("appendMessage truncates text at MAX_TEXT", async () => {
  try { await fs.unlink(chatFile); } catch {}
  const long = "x".repeat(3000);
  const entry = await appendMessage({ text: long });
  assert.equal(entry.text.length, 2000);
});

test("readMessages: `roles` filter narrows to a single role", async () => {
  try { await fs.unlink(chatFile); } catch {}
  await appendMessage({ role: "user", text: "do the thing" });
  await appendMessage({ role: "rei",  text: "on it" });
  await appendMessage({ role: "system", text: "worker paused" });
  const userOnly = await readMessages({ roles: ["user"] });
  assert.equal(userOnly.length, 1);
  assert.equal(userOnly[0].role, "user");
});

test("readMessages: `after` cuts off old entries", async () => {
  try { await fs.unlink(chatFile); } catch {}
  await appendMessage({ text: "first" });
  await new Promise((r) => setTimeout(r, 5));
  const cutoff = new Date().toISOString();
  await new Promise((r) => setTimeout(r, 5));
  await appendMessage({ text: "second" });
  const recent = await readMessages({ after: cutoff });
  assert.equal(recent.length, 1);
  assert.equal(recent[0].text, "second");
});

test("readUnconsumedUserMessages honors the cursor", async () => {
  try { await fs.unlink(chatFile); } catch {}
  await appendMessage({ role: "user", text: "before cursor" });
  await new Promise((r) => setTimeout(r, 5));
  const beforeCursor = new Date().toISOString();
  await advanceChatCursor(beforeCursor);
  await new Promise((r) => setTimeout(r, 5));
  await appendMessage({ role: "user", text: "after cursor" });
  await appendMessage({ role: "rei", text: "auto-ack — should be ignored by injection" });

  const unconsumed = await readUnconsumedUserMessages();
  assert.equal(unconsumed.length, 1);
  assert.equal(unconsumed[0].text, "after cursor");
});

test("advanceChatCursor + readChatCursor round-trip", async () => {
  const stamp = new Date().toISOString();
  await advanceChatCursor(stamp);
  assert.equal(await readChatCursor(), stamp);
});

test("parseSlashCommand: non-slash → null", () => {
  assert.equal(parseSlashCommand("hello there"), null);
});

test("parseSlashCommand: /pause is valid with no args", () => {
  const parsed = parseSlashCommand("/pause");
  assert.deepEqual(parsed, { command: "pause", rest: "", valid: true });
});

test("parseSlashCommand: /focus requires args", () => {
  const empty = parseSlashCommand("/focus");
  assert.equal(empty.valid, false);
  assert.match(empty.help, /requires text/);

  const filled = parseSlashCommand("/focus database migrations");
  assert.equal(filled.valid, true);
  assert.equal(filled.rest, "database migrations");
});

test("parseSlashCommand: unknown command flagged", () => {
  const parsed = parseSlashCommand("/nope arg");
  assert.equal(parsed.valid, false);
  assert.match(parsed.help, /Unknown command/);
});

test("renderSlashHelp lists every command in SLASH_COMMANDS", () => {
  const help = renderSlashHelp();
  for (const name of Object.keys(SLASH_COMMANDS)) {
    assert.match(help, new RegExp(`/${name}`));
  }
});

test("formatChatInjection returns empty string for no messages", () => {
  assert.equal(formatChatInjection([]), "");
  assert.equal(formatChatInjection(null), "");
});

test("formatChatInjection produces a prompt-ready block", () => {
  const out = formatChatInjection([
    { text: "Focus on tests first." },
    { text: "Then handle the migration." }
  ]);
  assert.match(out, /Operator messages received/);
  assert.match(out, /Focus on tests/);
  assert.match(out, /Then handle the migration/);
});

test.after(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});
