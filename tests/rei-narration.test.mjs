import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "rei-narration-"));
process.env.REI_PROJECT_ROOT = tmp;

const { narrate, readNarration, narrationFile, PHASE_ICONS } = await import("../tools/rei-narration.mjs");

test("narrate writes a valid entry", async () => {
  try { await fs.unlink(narrationFile); } catch {}
  const entry = await narrate({ text: "Starting the run.", phase: "start", issueRef: "#42" });
  assert.ok(entry);
  assert.equal(entry.phase, "start");
  assert.equal(entry.issueRef, "#42");

  const all = await readNarration();
  assert.equal(all.length, 1);
  assert.equal(all[0].text, "Starting the run.");
});

test("narrate falls back to 'info' for unknown phases", async () => {
  try { await fs.unlink(narrationFile); } catch {}
  const entry = await narrate({ text: "Hmm.", phase: "blorp" });
  assert.equal(entry.phase, "info");
});

test("narrate truncates long text to 280 chars", async () => {
  try { await fs.unlink(narrationFile); } catch {}
  const long = "x".repeat(500);
  const entry = await narrate({ text: long, phase: "info" });
  assert.equal(entry.text.length, 280);
});

test("narrate returns null for empty text", async () => {
  const entry = await narrate({ text: "", phase: "info" });
  assert.equal(entry, null);
});

test("readNarration honors `limit`", async () => {
  try { await fs.unlink(narrationFile); } catch {}
  for (let i = 0; i < 5; i++) {
    await narrate({ text: `line ${i}`, phase: "info" });
  }
  const tail = await readNarration({ limit: 3 });
  assert.equal(tail.length, 3);
  assert.equal(tail[0].text, "line 2");
  assert.equal(tail[2].text, "line 4");
});

test("readNarration honors `after` filter", async () => {
  try { await fs.unlink(narrationFile); } catch {}
  await narrate({ text: "earlier", phase: "info" });
  await new Promise((r) => setTimeout(r, 5));
  const cutoff = new Date().toISOString();
  await new Promise((r) => setTimeout(r, 5));
  await narrate({ text: "later", phase: "info" });

  const after = await readNarration({ after: cutoff });
  assert.equal(after.length, 1);
  assert.equal(after[0].text, "later");
});

test("PHASE_ICONS covers all known phases", () => {
  for (const phase of ["start", "plan", "explore", "edit", "verify", "summary", "memory", "info", "error"]) {
    assert.ok(PHASE_ICONS[phase], `missing icon for phase ${phase}`);
  }
});

test.after(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});
