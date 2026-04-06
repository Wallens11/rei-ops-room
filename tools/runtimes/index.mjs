/**
 * Runtime registry untuk execute-worker.mjs.
 *
 * Tiap runtime adalah module yang export:
 *   RUNTIME_ID     — string identifier ("codex", "claude-code", ...)
 *   RUNTIME_LABEL  — human-readable label
 *   resolveCommand({ env, fallback }) — async, return path ke binary
 *   buildInvocation({ command, repoCwd, outputLastMessageFile }) — return invocation object
 *
 * Nambah runtime baru: import di sini, masukkan ke RUNTIME_LIST,
 * dan set preferensinya di RUNTIME_PREFERENCES.
 *
 * Cross-session note (buat LLM lain yang lanjut):
 *   - Item 4 di docs/improvement-plan.md punya detail lengkap.
 *   - Untuk tambah runtime baru (misalnya Gemini): buat tools/runtimes/gemini.mjs
 *     dengan interface yang sama, lalu register di sini.
 */

import fs from "node:fs/promises";
import path from "node:path";

import * as codex from "./codex.mjs";
import * as claudeCode from "./claude-code.mjs";

// ─── Registry ────────────────────────────────────────────────────────────────

const RUNTIME_LIST = [codex, claudeCode];

export const RUNTIME_MAP = new Map(RUNTIME_LIST.map((r) => [r.RUNTIME_ID, r]));

// ─── Routing: specialist profile → runtime preference ────────────────────────
//
// List diurutkan dari yang paling diinginkan.
// selectRuntime() akan ambil runtime pertama yang tersedia di sistem.
//
// Reasoning:
//   scraping / frontend — butuh ~/.codex/skills (Playwright, frontend-design)
//   backend / docs      — reasoning-heavy → Claude Code lebih tepat
//   general             — default ke Codex

export const RUNTIME_PREFERENCES = {
  scraping:  ["codex"],
  frontend:  ["codex"],
  backend:   ["claude-code", "codex"],
  docs:      ["claude-code", "codex"],
  general:   ["codex"]
};

// ─── Probe ───────────────────────────────────────────────────────────────────

/**
 * Cek runtime mana yang tersedia di sistem.
 * - Jika resolveCommand() return absolute path → verify file exists.
 * - Jika return relative name ("codex", "claude") → trust PATH, anggap available.
 *
 * Return: array of RUNTIME_ID string yang available.
 */
export async function probeAvailableRuntimes(env = process.env) {
  const available = [];

  for (const runtime of RUNTIME_LIST) {
    try {
      const cmd = await runtime.resolveCommand({ env });
      if (path.isAbsolute(cmd)) {
        await fs.access(cmd); // throws jika tidak ada
      }
      available.push(runtime.RUNTIME_ID);
    } catch {
      // binary tidak ditemukan — skip
    }
  }

  return available;
}

// ─── Selection ───────────────────────────────────────────────────────────────

/**
 * Pilih runtime terbaik untuk specialist profile tertentu.
 * Dari RUNTIME_PREFERENCES, ambil yang pertama ada di availableRuntimes.
 * Fallback: "codex" kalau tidak ada yang cocok.
 */
export function selectRuntime(profileId, availableRuntimes = []) {
  const preferred = RUNTIME_PREFERENCES[profileId] ?? ["codex"];
  return preferred.find((r) => availableRuntimes.includes(r)) ?? "codex";
}

/**
 * Get runtime module by ID.
 * Fallback ke codex kalau ID tidak dikenal.
 */
export function getRuntime(runtimeId) {
  return RUNTIME_MAP.get(runtimeId) ?? codex;
}
