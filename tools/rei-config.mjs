/**
 * rei-config.mjs — Central configuration for Rei Ops Room.
 *
 * Priority (highest first):
 *   1. Environment variables
 *   2. rei.config.json in project root (gitignored)
 *   3. Built-in defaults
 *
 * OSS users: copy rei.config.json.example → rei.config.json and fill in your values.
 * Existing env-var setups are unaffected — env vars always win.
 */

import fs from "node:fs/promises";
import path from "node:path";

import { projectRoot } from "./execute-worker-state.mjs";

export const REI_CONFIG_FILE = path.join(projectRoot, "rei.config.json");

export const DEFAULT_REI_CONFIG = Object.freeze({
  repo: null,                   // GitHub repo slug: "owner/repo"
  workspacePath: null,          // Absolute path to workspace root
  port: 4317,
  codexHome: null,              // Path to ~/.codex (default: OS homedir)
  codexBin: null,               // Path to codex binary
  claudeBin: null,              // Path to claude binary
  dailyHandoffPath: null,       // Path to daily-device-handoff.md
  githubWebhookSecret: "",
  statusStreamIntervalMs: 2000
});

/**
 * Load config merged from rei.config.json + env vars.
 * Never throws for a missing config file (ENOENT → use defaults).
 *
 * @param configPath — override config file path (default: projectRoot/rei.config.json)
 * @param env        — process.env or test substitute
 */
export async function loadReiConfig({
  configPath = REI_CONFIG_FILE,
  env = process.env
} = {}) {
  let fileConfig = {};

  try {
    const text = await fs.readFile(configPath, "utf8");
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      fileConfig = parsed;
    }
  } catch (err) {
    if (err?.code !== "ENOENT") throw err;
    // File missing → fall through to defaults
  }

  return {
    repo:                 env.GITHUB_REPO                || fileConfig.repo                || DEFAULT_REI_CONFIG.repo,
    workspacePath:        env.WORKSPACE_ROOT             || fileConfig.workspacePath        || DEFAULT_REI_CONFIG.workspacePath,
    port:                 Number(env.PORT                || fileConfig.port                || DEFAULT_REI_CONFIG.port) || DEFAULT_REI_CONFIG.port,
    codexHome:            env.CODEX_HOME                 || fileConfig.codexHome            || null,
    codexBin:             env.CODEX_BIN                  || fileConfig.codexBin             || null,
    claudeBin:            env.CLAUDE_BIN                 || fileConfig.claudeBin            || null,
    dailyHandoffPath:     env.DAILY_DEVICE_HANDOFF_PATH  || fileConfig.dailyHandoffPath     || null,
    githubWebhookSecret:  env.GITHUB_WEBHOOK_SECRET      || fileConfig.githubWebhookSecret  || "",
    statusStreamIntervalMs: Number(env.STATUS_STREAM_INTERVAL_MS || fileConfig.statusStreamIntervalMs || DEFAULT_REI_CONFIG.statusStreamIntervalMs) || DEFAULT_REI_CONFIG.statusStreamIntervalMs
  };
}
