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
import { fileURLToPath } from "node:url";

import * as codex from "./codex.mjs";
import * as claudeCode from "./claude-code.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_CONFIG_PATH = path.resolve(__dirname, "../../.rei-runtimes.json");

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

// ─── Config: .rei-runtimes.json ──────────────────────────────────────────────

/**
 * Muat preferensi runtime dari file config .rei-runtimes.json (opsional).
 * Merge dengan RUNTIME_PREFERENCES default — key yang ada di file override default,
 * key yang tidak ada tetap pakai default.
 *
 * File format:
 *   {
 *     "preferences": { "frontend": ["claude-code"], "backend": ["codex", "claude-code"] },
 *     "rateLimitFallback": true
 *   }
 *
 * Return: { preferences, rateLimitFallback }
 * Kalau file tidak ada atau tidak valid → return default (backward compat).
 */
export async function loadRuntimePreferences(configPath = DEFAULT_CONFIG_PATH) {
  try {
    const raw = await fs.readFile(configPath, "utf8");
    const config = JSON.parse(raw);
    const merged = { ...RUNTIME_PREFERENCES };
    if (config.preferences && typeof config.preferences === "object") {
      for (const [k, v] of Object.entries(config.preferences)) {
        // Validasi: harus array of known runtime IDs
        if (Array.isArray(v) && v.length > 0 && v.every((r) => RUNTIME_MAP.has(r))) {
          merged[k] = v;
        }
      }
    }
    return {
      preferences: merged,
      rateLimitFallback: config.rateLimitFallback !== false // default true
    };
  } catch {
    // File tidak ada atau parse error — pakai default
    return { preferences: RUNTIME_PREFERENCES, rateLimitFallback: true };
  }
}

// ─── Rate limit detection ─────────────────────────────────────────────────────

const RATE_LIMIT_PATTERNS = [
  "rate limit",
  "rate_limit",
  "ratelimit",
  "overloaded",
  "quota exceeded",
  "too many requests",
  " 529",
  "503 service",
  "capacity"
];

/**
 * Deteksi apakah output dari runtime mengandung indikasi rate limit / overload.
 * Dipakai untuk memutuskan apakah perlu fallback ke runtime lain.
 */
export function isRateLimitError(text = "") {
  const lower = String(text || "").toLowerCase();
  return RATE_LIMIT_PATTERNS.some((p) => lower.includes(p));
}

// ─── Fallback runtime ─────────────────────────────────────────────────────────

/**
 * Cari runtime berikutnya dalam daftar preferensi untuk suatu profile,
 * setelah runtime `currentRuntimeId` gagal (biasanya kena rate limit).
 *
 * Return: runtime ID string, atau null kalau tidak ada fallback yang tersedia.
 *
 * Contoh:
 *   getFallbackRuntime("frontend", "claude-code", ["codex"], { frontend: ["claude-code", "codex"] })
 *   → "codex"
 */
export function getFallbackRuntime(
  profileId,
  currentRuntimeId,
  availableRuntimes = [],
  preferences = RUNTIME_PREFERENCES
) {
  const prefs = preferences[profileId] ?? ["codex"];
  const currentIdx = prefs.indexOf(currentRuntimeId);
  if (currentIdx === -1) return null;
  return prefs.slice(currentIdx + 1).find((r) => availableRuntimes.includes(r)) ?? null;
}

// ─── Adaptive selection ───────────────────────────────────────────────────────

/**
 * Pilih runtime terbaik berdasarkan preferensi + histori sukses/gagal dari learning log.
 *
 * Kalau belum ada cukup data (< MIN_SAMPLES per runtime), pakai urutan preferensi biasa.
 * Kalau sudah ada data, runtime dengan success rate lebih tinggi diprioritaskan.
 *
 * @param profileId       — specialist profile ("frontend", "backend", ...)
 * @param availableRuntimes — array runtime ID yang ada di sistem
 * @param learningEntries — entries dari .execute-learning.json
 * @param preferences     — preference map (default RUNTIME_PREFERENCES)
 */
export function selectRuntimeAdaptive(
  profileId,
  availableRuntimes = [],
  learningEntries = [],
  preferences = RUNTIME_PREFERENCES
) {
  const MIN_SAMPLES = 3;

  // Filter ke runtime yang tersedia
  const prefs = (preferences[profileId] ?? ["codex"]).filter((r) =>
    availableRuntimes.includes(r)
  );

  if (prefs.length === 0) return "codex";
  if (prefs.length === 1) return prefs[0];

  // Hitung statistik sukses/gagal per runtime untuk profile ini
  const stats = {};
  for (const entry of learningEntries) {
    if (entry.profileId !== profileId) continue;
    const r = entry.runtimeId;
    if (!prefs.includes(r)) continue;
    if (!stats[r]) stats[r] = { ok: 0, fail: 0 };
    if (entry.outcome === "completed") stats[r].ok++;
    else if (entry.outcome === "failed") stats[r].fail++;
  }

  // Hanya reorder kalau semua candidate punya cukup sample
  const allHaveSamples = prefs.every((r) => {
    const s = stats[r] ?? { ok: 0, fail: 0 };
    return s.ok + s.fail >= MIN_SAMPLES;
  });

  if (!allHaveSamples) {
    // Belum cukup data — pakai urutan preferensi biasa (pertama yang tersedia)
    return prefs[0];
  }

  // Sort by success rate descending; tie → urutan preferensi (stable sort-like)
  const scored = prefs.map((r, idx) => {
    const s = stats[r] ?? { ok: 0, fail: 0 };
    const rate = s.ok / Math.max(s.ok + s.fail, 1);
    return { r, rate, idx };
  });
  scored.sort((a, b) => b.rate - a.rate || a.idx - b.idx);

  return scored[0].r;
}
