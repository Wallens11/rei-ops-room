/**
 * rei-self-review.mjs — Last-mile sanity check before marking a run "done".
 *
 * Goal: Catch obvious mistakes Rei made without spending another expensive
 * agent invocation. Cheap, deterministic heuristics:
 *
 *   1. Diff sanity   — is the change empty? oversize? touching protected paths?
 *   2. Test guard    — if test files exist, do they still parse? (basic check)
 *   3. Forbidden tokens — `process.env.SECRET_HARDCODED`, `TODO: remove`, `console.log`, etc
 *   4. JSON parse-ability — any .json files we wrote are valid?
 *
 * Returns:
 *   { ok: boolean, issues: string[], notes: string[] }
 *
 * The worker uses this to either mark "done" or "review_needed".
 */

import { execFile } from "node:child_process";
import crypto from "node:crypto";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";

const execFileAsync = promisify(execFile);

/** Heuristic forbidden patterns that suggest the agent left debug junk. */
const FORBIDDEN_PATTERNS = [
  { re: /\bTODO: remove\b/i, msg: "Left a 'TODO: remove' note" },
  { re: /\bdebugger;/, msg: "Left a `debugger;` statement" },
  { re: /\bxit\(|\bxdescribe\(|\.only\(/, msg: "Left a test marker like `.only` or `xit/xdescribe`" },
  // console.log is sometimes legit, so only flag when it appears with the word "DEBUG" nearby
  { re: /console\.log\([^)]*['"]DEBUG/, msg: "Left a DEBUG console.log" }
];

const PROTECTED_PATHS = [".github/workflows/", ".env", "package-lock.json"];

const MAX_LINES_CHANGED = 1500;

async function collectProtectedFiles(cwd) {
  const files = [];

  async function walk(relativeDirectory) {
    const absoluteDirectory = path.join(cwd, relativeDirectory);
    const entries = await fs.readdir(absoluteDirectory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const relativePath = path.posix.join(relativeDirectory.replaceAll("\\", "/"), entry.name);
      if (entry.isSymbolicLink() || entry.isFile()) {
        files.push(relativePath);
      } else if (entry.isDirectory()) {
        await walk(relativePath);
      }
    }
  }

  const rootEntries = await fs.readdir(cwd, { withFileTypes: true }).catch(() => []);
  for (const entry of rootEntries) {
    if (entry.name === "package-lock.json" || entry.name.startsWith(".env")) {
      if (entry.isDirectory()) {
        await walk(entry.name);
      } else {
        files.push(entry.name);
      }
    }
  }
  await walk(".github/workflows");

  return [...new Set(files)].sort();
}

/**
 * Snapshot protected files independently from git. This catches ignored files
 * such as `.env`, while comparing before/after prevents pre-existing secrets
 * from blocking every run.
 */
export async function snapshotProtectedPaths({ cwd } = {}) {
  const snapshot = {};
  for (const relativePath of await collectProtectedFiles(cwd)) {
    const absolutePath = path.join(cwd, relativePath);
    const stat = await fs.lstat(absolutePath).catch(() => null);
    if (!stat) continue;

    const content = stat.isSymbolicLink()
      ? `symlink:${await fs.readlink(absolutePath)}`
      : await fs.readFile(absolutePath);
    snapshot[relativePath] = crypto.createHash("sha256").update(content).digest("hex");
  }
  return snapshot;
}

export function findChangedProtectedPaths(before = {}, after = {}) {
  const paths = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  return [...paths]
    .filter((relativePath) => before?.[relativePath] !== after?.[relativePath])
    .sort();
}

/**
 * Collect changed paths using `git status --porcelain` so we see ALL touched
 * files (modified + untracked + renamed) — `git diff --numstat` alone misses
 * brand-new files the agent just created.
 *
 * Returns: [{ path, added, removed, isNew }]
 */
async function getDiffStats(cwd) {
  let porcelain;
  try {
    const { stdout } = await execFileAsync("git", ["status", "--porcelain", "-z"], { cwd });
    porcelain = stdout;
  } catch {
    return [];
  }

  // -z gives NUL-separated entries; rename entries occupy two slots
  const entries = [];
  const parts = porcelain.split("\0").filter(Boolean);
  for (let i = 0; i < parts.length; i++) {
    const line = parts[i];
    const code = line.slice(0, 2);
    let p = line.slice(3);
    // Renamed: `R  old -> new` becomes two NUL-separated parts
    if (code.startsWith("R") || code.startsWith("C")) {
      i++; // skip "old name"
    }
    if (!p) continue;
    const isNew = code.includes("?") || code.includes("A");
    entries.push({ path: p, isNew });
  }

  // For line counts on tracked files use `git diff --numstat`; for untracked
  // count lines from the file content directly.
  const numstat = await execFileAsync("git", ["diff", "--numstat"], { cwd })
    .then((r) => r.stdout)
    .catch(() => "");
  const tracked = new Map();
  for (const row of numstat.split("\n").filter(Boolean)) {
    const [added, removed, ...rest] = row.split("\t");
    const p = rest.join("\t");
    tracked.set(p, { added: Number(added) || 0, removed: Number(removed) || 0 });
  }

  const stats = [];
  for (const e of entries) {
    const t = tracked.get(e.path);
    if (t) {
      stats.push({ path: e.path, added: t.added, removed: t.removed, isNew: e.isNew });
    } else if (e.isNew) {
      try {
        const content = await fs.readFile(path.join(cwd, e.path), "utf8");
        const lines = content.split("\n").length;
        stats.push({ path: e.path, added: lines, removed: 0, isNew: true });
      } catch {
        stats.push({ path: e.path, added: 0, removed: 0, isNew: true });
      }
    } else {
      stats.push({ path: e.path, added: 0, removed: 0, isNew: false });
    }
  }
  return stats;
}

/**
 * Concatenate the "added" text from all changed files for forbidden-pattern
 * scanning. For tracked files we use the diff; for new files the whole content.
 */
async function getAddedText(cwd, stats) {
  const chunks = [];
  // Diff lines for tracked changes
  try {
    const { stdout } = await execFileAsync("git", ["diff", "--unified=0"], {
      cwd,
      maxBuffer: 4 * 1024 * 1024
    });
    chunks.push(
      stdout
        .split("\n")
        .filter((l) => l.startsWith("+") && !l.startsWith("+++"))
        .map((l) => l.slice(1))
        .join("\n")
    );
  } catch { /* git not available, skip */ }

  // Full content of newly created files
  for (const s of stats) {
    if (!s.isNew) continue;
    try {
      chunks.push(await fs.readFile(path.join(cwd, s.path), "utf8"));
    } catch { /* file might already be gone */ }
  }

  return chunks.join("\n");
}

/**
 * Cheap parse check — for .json, try JSON.parse; for .mjs/.js, basic brace balance.
 * Not a real linter, just catches obvious truncation.
 */
async function fileLooksValid(cwd, relPath) {
  const ext = path.extname(relPath).toLowerCase();
  const abs = path.join(cwd, relPath);
  let content;
  try {
    content = await fs.readFile(abs, "utf8");
  } catch {
    return { ok: true, reason: "file not readable, skip" };
  }

  if (ext === ".json") {
    try {
      JSON.parse(content);
      return { ok: true };
    } catch (error) {
      return { ok: false, reason: `JSON parse failed: ${error.message.split("\n")[0]}` };
    }
  }

  if (ext === ".mjs" || ext === ".js" || ext === ".cjs" || ext === ".ts" || ext === ".tsx") {
    // Brace + paren balance — extremely shallow but catches truncated files
    let braces = 0, parens = 0, brackets = 0;
    let inString = false, stringChar = null, escape = false;
    for (const ch of content) {
      if (escape) { escape = false; continue; }
      if (ch === "\\") { escape = true; continue; }
      if (inString) {
        if (ch === stringChar) { inString = false; stringChar = null; }
        continue;
      }
      if (ch === '"' || ch === "'" || ch === "`") { inString = true; stringChar = ch; continue; }
      if (ch === "{") braces++;
      else if (ch === "}") braces--;
      else if (ch === "(") parens++;
      else if (ch === ")") parens--;
      else if (ch === "[") brackets++;
      else if (ch === "]") brackets--;
    }
    if (braces !== 0 || parens !== 0 || brackets !== 0) {
      return {
        ok: false,
        reason: `Unbalanced brackets (braces:${braces} parens:${parens} brackets:${brackets}) — possible truncation`
      };
    }
  }

  return { ok: true };
}

/**
 * Run a self-review pass over the worktree at `cwd`.
 *
 * @param {object} opts
 * @param {string} opts.cwd      - repo root with uncommitted changes
 * @param {string[]} opts.changedFiles - paths reported by worker (relative)
 * @param {boolean} opts.requireChanges - if true, an empty diff = fail
 * @returns {Promise<{ok: boolean, issues: string[], notes: string[], stats: object}>}
 */
export async function runSelfReview({
  cwd,
  changedFiles = [],
  requireChanges = true,
  protectedPathsBefore = null,
  protectedPathsAfter = null
} = {}) {
  const issues = [];
  const notes = [];

  const rawStats = await getDiffStats(cwd);
  const hasProtectedSnapshots =
    protectedPathsBefore !== null && protectedPathsAfter !== null;
  const protectedPathChanges =
    hasProtectedSnapshots
      ? findChangedProtectedPaths(protectedPathsBefore, protectedPathsAfter)
      : [];
  const stats = hasProtectedSnapshots
    ? rawStats.filter((entry) => {
        const isProtected = PROTECTED_PATHS.some((protectedPath) =>
          entry.path.startsWith(protectedPath)
        );
        return !isProtected || protectedPathChanges.includes(entry.path);
      })
    : rawStats;
  const totalAdded = stats.reduce((s, e) => s + e.added, 0);
  const totalRemoved = stats.reduce((s, e) => s + e.removed, 0);
  const totalChanged = totalAdded + totalRemoved;

  if (
    requireChanges &&
    stats.length === 0 &&
    changedFiles.length === 0 &&
    protectedPathChanges.length === 0
  ) {
    issues.push("Empty diff — no meaningful changes were produced.");
  }

  if (totalChanged > MAX_LINES_CHANGED) {
    issues.push(`Large diff: ${totalChanged} lines changed (threshold ${MAX_LINES_CHANGED}). Worth a human review.`);
  } else if (totalChanged > 0) {
    notes.push(`Diff size: ${totalChanged} lines (+${totalAdded} -${totalRemoved}) across ${stats.length} file${stats.length === 1 ? "" : "s"}.`);
  }

  // Protected paths
  for (const entry of stats) {
    if (PROTECTED_PATHS.some((p) => entry.path.startsWith(p))) {
      issues.push(`Modified protected path: ${entry.path}`);
    }
  }
  for (const relativePath of protectedPathChanges) {
    const message = `Modified protected path: ${relativePath}`;
    if (!issues.includes(message)) issues.push(message);
  }

  // Forbidden patterns across modified + new files
  const addedText = await getAddedText(cwd, stats);
  if (addedText) {
    for (const { re, msg } of FORBIDDEN_PATTERNS) {
      if (re.test(addedText)) issues.push(msg);
    }
  }

  // Cheap syntax check on changed code-ish files
  const candidates = stats.length > 0
    ? stats.map((s) => s.path)
    : [...new Set([...changedFiles, ...protectedPathChanges])];
  for (const rel of candidates) {
    if (!rel) continue;
    const result = await fileLooksValid(cwd, rel);
    if (!result.ok) issues.push(`${rel}: ${result.reason}`);
  }

  return {
    ok: issues.length === 0,
    issues,
    notes,
    stats: {
      filesChanged: stats.length,
      linesAdded: totalAdded,
      linesRemoved: totalRemoved
    }
  };
}

/** Format the review result as a markdown comment for the issue. */
export function formatSelfReview(result) {
  if (!result) return "";
  const head = result.ok
    ? "**✅ Self-review passed.**"
    : `**⚠️ Self-review found ${result.issues.length} issue${result.issues.length === 1 ? "" : "s"}:**`;

  const lines = [head];
  for (const issue of result.issues) lines.push(`- ${issue}`);
  if (result.notes.length > 0) {
    if (result.issues.length > 0) lines.push("");
    for (const note of result.notes) lines.push(`_${note}_`);
  }
  return lines.join("\n");
}
