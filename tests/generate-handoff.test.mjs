import test from "node:test";
import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  buildHandoffPayload,
  formatHandoffSection,
  writeHandoffSection
} from "../tools/generate-handoff.mjs";

// ─── formatHandoffSection ─────────────────────────────────────────────────────

test("formatHandoffSection includes date as ## header", () => {
  const section = formatHandoffSection({
    date: "2026-04-07",
    todayAtAGlance: "3 runs today.",
    sections: { runs: null, learning: null, queue: null },
    activeIssues: null,
    blockers: null
  });

  assert.ok(section.includes("## 2026-04-07"), `Expected ## 2026-04-07 in: ${section}`);
  assert.ok(section.includes("3 runs today."));
});

test("formatHandoffSection includes learning summary when provided", () => {
  const section = formatHandoffSection({
    date: "2026-04-07",
    todayAtAGlance: "OK.",
    sections: {
      runs: null,
      learning: "- completed #19 fix auth",
      queue: null
    },
    activeIssues: null,
    blockers: null
  });

  assert.ok(section.includes("Run Outcomes"));
  assert.ok(section.includes("completed #19 fix auth"));
});

test("formatHandoffSection includes queue summary when provided", () => {
  const section = formatHandoffSection({
    date: "2026-04-07",
    todayAtAGlance: "OK.",
    sections: {
      runs: null,
      learning: null,
      queue: "- ✓ [codex] write tests"
    },
    activeIssues: null,
    blockers: null
  });

  assert.ok(section.includes("Tasks Completed Today"));
  assert.ok(section.includes("write tests"));
});

test("formatHandoffSection includes active issues when provided", () => {
  const section = formatHandoffSection({
    date: "2026-04-07",
    todayAtAGlance: "OK.",
    sections: { runs: null, learning: null, queue: null },
    activeIssues: "- queued: fix bug",
    blockers: null
  });

  assert.ok(section.includes("Active Issues"));
  assert.ok(section.includes("fix bug"));
});

// ─── writeHandoffSection ──────────────────────────────────────────────────────

describe("generate-handoff: writeHandoffSection", async () => {
  let tmpDir;

  before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rei-handoff-test-"));
  });
  after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("creates file if it does not exist", async () => {
    const outputPath = path.join(tmpDir, "new-handoff.md");
    const section = "## 2026-04-07\n\n### Today At A Glance\nAll good.\n";

    const result = await writeHandoffSection(section, [outputPath]);
    assert.equal(result.written, true);
    assert.equal(result.path, outputPath);

    const content = await fs.readFile(outputPath, "utf8");
    assert.ok(content.includes("## 2026-04-07"));
  });

  it("appends section to existing file", async () => {
    const outputPath = path.join(tmpDir, "existing-handoff.md");
    await fs.writeFile(outputPath, "# Daily Device Handoff\n\n## 2026-04-06\n\nOld content.\n", "utf8");

    const section = "## 2026-04-07\n\n### Today At A Glance\nNew content.\n";
    await writeHandoffSection(section, [outputPath]);

    const content = await fs.readFile(outputPath, "utf8");
    assert.ok(content.includes("## 2026-04-06"), "Old section harus tetap ada");
    assert.ok(content.includes("## 2026-04-07"), "New section harus ada");
  });

  it("replaces existing section for the same date", async () => {
    const outputPath = path.join(tmpDir, "replace-handoff.md");
    await fs.writeFile(
      outputPath,
      "## 2026-04-07\n\n### Today At A Glance\nOld content.\n\n## 2026-04-06\n\nPrev day.\n",
      "utf8"
    );

    const newSection = "## 2026-04-07\n\n### Today At A Glance\nUpdated content.\n\n";
    await writeHandoffSection(newSection, [outputPath]);

    const content = await fs.readFile(outputPath, "utf8");
    assert.ok(!content.includes("Old content."), "Old content harus sudah di-replace");
    assert.ok(content.includes("Updated content."), "New content harus ada");
    assert.ok(content.includes("## 2026-04-06"), "Other sections harus tetap ada");
  });

  it("tries next path if first is not writable", async () => {
    const badPath = "/root/no-permission/handoff.md";
    const goodPath = path.join(tmpDir, "fallback-handoff.md");

    const section = "## 2026-04-07\n\nFallback content.\n";
    const result = await writeHandoffSection(section, [badPath, goodPath]);

    assert.equal(result.written, true);
    assert.equal(result.path, goodPath);
  });

  it("returns written=false if all paths fail", async () => {
    const result = await writeHandoffSection("## test\n", ["/root/no/access/a.md", "/root/no/access/b.md"]);
    assert.equal(result.written, false);
  });
});

// ─── buildHandoffPayload ──────────────────────────────────────────────────────

test("buildHandoffPayload returns object with date and todayAtAGlance", async () => {
  const payload = await buildHandoffPayload();
  assert.ok(typeof payload.date === "string" && payload.date.match(/^\d{4}-\d{2}-\d{2}$/));
  assert.ok(typeof payload.todayAtAGlance === "string" && payload.todayAtAGlance.length > 0);
  assert.ok(payload.sections && typeof payload.sections === "object");
});
