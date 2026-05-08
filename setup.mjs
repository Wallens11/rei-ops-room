#!/usr/bin/env node
/**
 * setup.mjs — Rei Ops Room first-run setup wizard.
 *
 * Panduan interaktif untuk konfigurasi awal:
 *   1. Detect GitHub repo dari git remote
 *   2. Detect runtime yang tersedia (claude-code, codex)
 *   3. Tanya user nilai config
 *   4. Tulis rei.config.json dan .rei-runtimes.json
 *   5. Opsional: buat GitHub labels
 *
 * Jalankan: node setup.mjs
 */

import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ask(iface, question) {
  return new Promise((resolve) => iface.question(question, (ans) => resolve(ans.trim())));
}

async function runSilent(cmd, args, opts = {}) {
  try {
    const { stdout } = await execFileAsync(cmd, args, { timeout: 8000, ...opts });
    return stdout.trim();
  } catch {
    return null;
  }
}

function line(text = "") { process.stdout.write(`${text}\n`); }
function section(title) { line(`\n${"─".repeat(54)}\n  ${title}\n${"─".repeat(54)}`); }

// ─── Detection ────────────────────────────────────────────────────────────────

async function detectGitRepo() {
  const remote = await runSilent("git", ["remote", "get-url", "origin"], { cwd: __dirname });
  if (!remote) return null;
  const match = remote.match(/github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/);
  return match?.[1] || null;
}

async function detectRuntimes() {
  const found = [];

  // claude-code
  const claudeWhich = await runSilent("which", ["claude"]);
  if (claudeWhich || process.env.CLAUDE_BIN) found.push("claude-code");

  // codex
  const codexWhich = await runSilent("which", ["codex"]);
  const codexApp = "/Applications/Codex.app/Contents/Resources/codex";
  let codexAppExists = false;
  try { await fs.access(codexApp); codexAppExists = true; } catch { /* nope */ }
  if (codexWhich || codexAppExists || process.env.CODEX_BIN) found.push("codex");

  return found;
}

// ─── GitHub Labels ────────────────────────────────────────────────────────────

const REI_LABELS = [
  { name: "agent:rei",          color: "7B68EE", description: "Assigned to Rei agent" },
  { name: "mode:execute",       color: "0075ca", description: "Rei may execute code for this issue" },
  { name: "mode:report_only",   color: "cfd3d7", description: "Rei reports only, no code execution" },
  { name: "status:todo",        color: "fef2c0", description: "Ready to be picked up" },
  { name: "status:in_progress", color: "fbca04", description: "Rei is actively working on this" },
  { name: "status:approved",    color: "0e8a16", description: "Approved for autonomous execution" },
  { name: "status:blocked",     color: "ee0701", description: "Blocked — needs manual review" },
  { name: "status:done",        color: "6f42c1", description: "Completed" }
];

async function createLabels(repo) {
  line("\nCreating GitHub labels...");
  let ok = 0;
  for (const label of REI_LABELS) {
    const result = await runSilent("gh", [
      "label", "create", label.name,
      "--repo", repo,
      "--color", label.color,
      "--description", label.description,
      "--force"
    ]);
    const status = result !== null ? "✓" : "✗";
    line(`  ${status} ${label.name}`);
    if (result !== null) ok++;
  }
  line(`\n  ${ok}/${REI_LABELS.length} labels created/updated.`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  line("\n╔══════════════════════════════════════════╗");
  line("║   Rei Ops Room — Setup Wizard  v1.0     ║");
  line("╚══════════════════════════════════════════╝");
  line("\nThis creates rei.config.json and .rei-runtimes.json.");
  line("Re-run anytime to update. Ctrl+C to cancel.\n");

  const iface = readline.createInterface({ input: process.stdin, output: process.stdout });

  try {
    // ── 1. GitHub Repo ────────────────────────────────────────────────────────
    section("1 / 4  GitHub Repository");
    const detectedRepo = await detectGitRepo();
    if (detectedRepo) line(`Auto-detected: ${detectedRepo}`);
    const repoInput = await ask(iface, `GitHub repo (owner/name)${detectedRepo ? ` [${detectedRepo}]` : ""}: `);
    const repo = repoInput || detectedRepo || "";
    if (!repo.includes("/")) {
      line("⚠️  No valid repo entered. Set GITHUB_REPO env var later if needed.");
    }

    // ── 2. Workspace ──────────────────────────────────────────────────────────
    section("2 / 4  Workspace Root");
    const defaultWorkspace = path.resolve(__dirname, "..");
    line("Root directory where your code repos live.");
    line("Rei uses this to show clean relative paths in the UI.\n");
    const wsInput = await ask(iface, `Workspace path [${defaultWorkspace}]: `);
    const workspacePath = wsInput || defaultWorkspace;

    // ── 3. Runtimes ───────────────────────────────────────────────────────────
    section("3 / 4  Runtime Detection");
    const available = await detectRuntimes();

    if (available.length === 0) {
      line("⚠️  No runtimes detected on this machine.");
      line("  Install claude:  npm install -g @anthropic-ai/claude-code");
      line("  Install codex:   https://codex.com");
    } else {
      line(`Detected: ${available.join(", ")}`);
    }

    const fe = available.includes("claude-code") ? "claude-code" : (available[0] || "codex");
    const be = available.includes("codex") ? "codex" : (available[0] || "claude-code");

    const dedup = (arr) => arr.filter((v, i, a) => a.indexOf(v) === i);
    const preferences = {
      frontend: dedup([fe, be]),
      backend:  dedup([be, fe]),
      scraping: dedup(["codex", fe]),
      docs:     dedup([fe, be]),
      general:  dedup([be, fe])
    };

    line("\nRouting plan:");
    for (const [type, rts] of Object.entries(preferences)) {
      line(`  ${type.padEnd(10)} → ${rts.join(" → ")}`);
    }

    // ── 4. GitHub Labels ──────────────────────────────────────────────────────
    section("4 / 4  GitHub Labels");
    line("Rei uses GitHub labels to manage the execute queue.");
    line("Required: agent:rei, mode:execute, status:approved, etc.\n");

    let labelsCreated = false;
    if (repo.includes("/")) {
      const ans = await ask(iface, `Create/update labels in ${repo}? [Y/n]: `);
      if (!ans || ans.toLowerCase() !== "n") {
        await createLabels(repo);
        labelsCreated = true;
      }
    } else {
      line("Skipping (no repo configured).");
    }

    // ── Write config files ────────────────────────────────────────────────────
    section("Writing Config Files");

    const reiConfig = {};
    if (repo) reiConfig.repo = repo;
    if (workspacePath) reiConfig.workspacePath = workspacePath;

    await fs.writeFile(
      path.join(__dirname, "rei.config.json"),
      `${JSON.stringify(reiConfig, null, 2)}\n`,
      "utf8"
    );
    line("✓ rei.config.json");

    await fs.writeFile(
      path.join(__dirname, ".rei-runtimes.json"),
      `${JSON.stringify({ preferences, rateLimitFallback: true }, null, 2)}\n`,
      "utf8"
    );
    line("✓ .rei-runtimes.json");

    // ── Summary ───────────────────────────────────────────────────────────────
    line("\n╔══════════════════════════════════════════╗");
    line("║   Setup Complete! Ready to launch.      ║");
    line("╚══════════════════════════════════════════╝");
    line(`\n  Repo:      ${repo || "(not set — use GITHUB_REPO env var)"}`);
    line(`  Workspace: ${workspacePath}`);
    line(`  Runtimes:  ${available.join(", ") || "none detected"}`);
    line(`  Labels:    ${labelsCreated ? "created/updated" : "skipped"}`);
    line("\nNext steps:");
    line("  node server.mjs                        # start the server");
    line("  npm run execute-service -- start       # start the worker");
    line("  open http://localhost:4317             # open the UI");
    if (!available.includes("claude-code")) {
      line("\n  Install claude:  npm install -g @anthropic-ai/claude-code");
    }
    if (!available.includes("codex")) {
      line("  Install codex:   https://codex.com");
    }
    line("");
  } finally {
    iface.close();
  }
}

export default main;

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    process.stderr.write(`\nSetup error: ${err?.message || String(err)}\n`);
    process.exit(1);
  });
}
