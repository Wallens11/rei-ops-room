import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

import {
  runSelfReview,
  formatSelfReview,
  snapshotProtectedPaths
} from "../tools/rei-self-review.mjs";

async function makeGitRepo() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rei-review-"));
  await execFileAsync("git", ["init", "-q"], { cwd: dir });
  await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  await execFileAsync("git", ["config", "user.name", "Test"], { cwd: dir });
  await fs.writeFile(path.join(dir, "README.md"), "# Test\n", "utf8");
  await execFileAsync("git", ["add", "."], { cwd: dir });
  await execFileAsync("git", ["commit", "-q", "-m", "init"], { cwd: dir });
  return dir;
}

test("runSelfReview: empty diff with requireChanges → fails", async () => {
  const cwd = await makeGitRepo();
  try {
    const res = await runSelfReview({ cwd, changedFiles: [], requireChanges: true });
    assert.equal(res.ok, false);
    assert.match(res.issues.join("\n"), /Empty diff/);
  } finally {
    await fs.rm(cwd, { recursive: true, force: true });
  }
});

test("runSelfReview: clean small change → passes", async () => {
  const cwd = await makeGitRepo();
  try {
    await fs.writeFile(path.join(cwd, "tools.mjs"), "export const x = 1;\n", "utf8");
    const res = await runSelfReview({ cwd });
    assert.equal(res.ok, true, JSON.stringify(res));
    assert.ok(res.notes.some((n) => /Diff size/.test(n)));
  } finally {
    await fs.rm(cwd, { recursive: true, force: true });
  }
});

test("runSelfReview: catches a `debugger;` left in code", async () => {
  const cwd = await makeGitRepo();
  try {
    await fs.writeFile(
      path.join(cwd, "buggy.mjs"),
      "export function go() {\n  debugger;\n  return 42;\n}\n",
      "utf8"
    );
    const res = await runSelfReview({ cwd });
    assert.equal(res.ok, false);
    assert.match(res.issues.join("\n"), /debugger/);
  } finally {
    await fs.rm(cwd, { recursive: true, force: true });
  }
});

test("runSelfReview: catches a `TODO: remove` left in code", async () => {
  const cwd = await makeGitRepo();
  try {
    await fs.writeFile(
      path.join(cwd, "todo.mjs"),
      "// TODO: remove this hack before shipping\nexport const x = 1;\n",
      "utf8"
    );
    const res = await runSelfReview({ cwd });
    assert.equal(res.ok, false);
    assert.match(res.issues.join("\n"), /TODO: remove/i);
  } finally {
    await fs.rm(cwd, { recursive: true, force: true });
  }
});

test("runSelfReview: flags protected path edits", async () => {
  const cwd = await makeGitRepo();
  try {
    const protectedPathsBefore = await snapshotProtectedPaths({ cwd });
    await fs.writeFile(path.join(cwd, ".env"), "SECRET=lol\n", "utf8");
    const protectedPathsAfter = await snapshotProtectedPaths({ cwd });
    const res = await runSelfReview({
      cwd,
      protectedPathsBefore,
      protectedPathsAfter
    });
    assert.equal(res.ok, false);
    assert.match(res.issues.join("\n"), /protected path/);
  } finally {
    await fs.rm(cwd, { recursive: true, force: true });
  }
});

test("runSelfReview: ignores an unchanged pre-existing protected path", async () => {
  const cwd = await makeGitRepo();
  try {
    const emptyExcludes = path.join(cwd, ".git", "empty-excludes");
    await fs.writeFile(emptyExcludes, "", "utf8");
    await execFileAsync("git", ["config", "core.excludesFile", emptyExcludes], { cwd });
    await fs.writeFile(path.join(cwd, ".env"), "SECRET=existing\n", "utf8");
    const protectedPathsBefore = await snapshotProtectedPaths({ cwd });
    await fs.writeFile(path.join(cwd, "safe.mjs"), "export const safe = true;\n", "utf8");
    const protectedPathsAfter = await snapshotProtectedPaths({ cwd });
    const res = await runSelfReview({
      cwd,
      protectedPathsBefore,
      protectedPathsAfter
    });
    assert.equal(res.ok, true, JSON.stringify(res));
  } finally {
    await fs.rm(cwd, { recursive: true, force: true });
  }
});

test("runSelfReview: catches broken JSON", async () => {
  const cwd = await makeGitRepo();
  try {
    await fs.writeFile(path.join(cwd, "data.json"), '{\n  "key": "value"', "utf8"); // truncated
    const res = await runSelfReview({ cwd });
    assert.equal(res.ok, false);
    assert.match(res.issues.join("\n"), /JSON parse/);
  } finally {
    await fs.rm(cwd, { recursive: true, force: true });
  }
});

test("runSelfReview: catches truncated JS (unbalanced braces)", async () => {
  const cwd = await makeGitRepo();
  try {
    await fs.writeFile(
      path.join(cwd, "broken.mjs"),
      "export function go() {\n  return {\n    x: 1\n  ;\n", // missing closing braces
      "utf8"
    );
    const res = await runSelfReview({ cwd });
    assert.equal(res.ok, false);
    assert.match(res.issues.join("\n"), /Unbalanced brackets/);
  } finally {
    await fs.rm(cwd, { recursive: true, force: true });
  }
});

test("formatSelfReview: passing review renders cleanly", () => {
  const out = formatSelfReview({ ok: true, issues: [], notes: ["Diff size: 3 lines (+2 -1)"], stats: {} });
  assert.match(out, /Self-review passed/);
  assert.match(out, /Diff size/);
});

test("formatSelfReview: failing review lists issues", () => {
  const out = formatSelfReview({
    ok: false,
    issues: ["Left a `debugger;` statement", "Modified protected path: .env"],
    notes: [],
    stats: {}
  });
  assert.match(out, /2 issues/);
  assert.match(out, /debugger/);
  assert.match(out, /protected path/);
});
