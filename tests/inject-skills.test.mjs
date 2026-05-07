import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { injectSkills } from "../tools/inject-skills.mjs";

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function makeTmpDir(prefix = "test-") {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function writeFile(filePath, content = "hello") {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf8");
}

// ─── injectSkills ─────────────────────────────────────────────────────────────

test("injectSkills: returns empty result when src dir does not exist", async () => {
  const src = path.join(os.tmpdir(), "nonexistent-skills-" + Date.now());
  const dst = await makeTmpDir("dst-");

  const result = await injectSkills({ src, dst });
  assert.deepEqual(result, { installed: [], skipped: [], errors: [] });
});

test("injectSkills: installs a skill from src to dst", async () => {
  const src = await makeTmpDir("src-");
  const dst = await makeTmpDir("dst-");

  // Create a fake skill
  await writeFile(path.join(src, "my-skill", "SKILL.md"), "# My Skill");
  await writeFile(path.join(src, "my-skill", "commands", "do-thing.md"), "Do thing");

  const result = await injectSkills({ src, dst });

  assert.deepEqual(result.installed, ["my-skill"]);
  assert.deepEqual(result.skipped, []);
  assert.deepEqual(result.errors, []);

  // Verify files were copied
  const skillMd = await fs.readFile(path.join(dst, "my-skill", "SKILL.md"), "utf8");
  assert.equal(skillMd, "# My Skill");

  const cmdMd = await fs.readFile(path.join(dst, "my-skill", "commands", "do-thing.md"), "utf8");
  assert.equal(cmdMd, "Do thing");
});

test("injectSkills: skips skill if already up-to-date (identical files)", async () => {
  const src = await makeTmpDir("src-");
  const dst = await makeTmpDir("dst-");

  await writeFile(path.join(src, "skill-a", "SKILL.md"), "# Skill A");
  // Pre-install the same file at dst
  await writeFile(path.join(dst, "skill-a", "SKILL.md"), "# Skill A");

  const result = await injectSkills({ src, dst });

  assert.deepEqual(result.installed, []);
  assert.deepEqual(result.skipped, ["skill-a"]);
});

test("injectSkills: reinstalls skill if dst content differs", async () => {
  const src = await makeTmpDir("src-");
  const dst = await makeTmpDir("dst-");

  await writeFile(path.join(src, "skill-b", "SKILL.md"), "# Version 2");
  // Older version at dst
  await writeFile(path.join(dst, "skill-b", "SKILL.md"), "# Version 1");

  const result = await injectSkills({ src, dst });

  assert.deepEqual(result.installed, ["skill-b"]);
  assert.deepEqual(result.skipped, []);

  const content = await fs.readFile(path.join(dst, "skill-b", "SKILL.md"), "utf8");
  assert.equal(content, "# Version 2");
});

test("injectSkills: handles multiple skills in one call", async () => {
  const src = await makeTmpDir("src-");
  const dst = await makeTmpDir("dst-");

  await writeFile(path.join(src, "skill-x", "SKILL.md"), "X");
  await writeFile(path.join(src, "skill-y", "SKILL.md"), "Y");
  // Pre-install skill-y with same content → should skip
  await writeFile(path.join(dst, "skill-y", "SKILL.md"), "Y");

  const result = await injectSkills({ src, dst });

  assert.equal(result.installed.length, 1);
  assert.ok(result.installed.includes("skill-x"));
  assert.equal(result.skipped.length, 1);
  assert.ok(result.skipped.includes("skill-y"));
});

test("injectSkills: idempotent — second call skips everything", async () => {
  const src = await makeTmpDir("src-");
  const dst = await makeTmpDir("dst-");

  await writeFile(path.join(src, "skill-z", "SKILL.md"), "# Z");

  await injectSkills({ src, dst }); // first install
  const result2 = await injectSkills({ src, dst }); // second install

  assert.deepEqual(result2.installed, []);
  assert.deepEqual(result2.skipped, ["skill-z"]);
});
