import fs from "node:fs/promises";
import path from "node:path";

import * as codex from "./codex.mjs";
import * as claudeCode from "./claude-code.mjs";

const RUNTIME_LIST = [codex, claudeCode];

export const RUNTIME_MAP = new Map(RUNTIME_LIST.map((runtime) => [runtime.RUNTIME_ID, runtime]));

export const DEFAULT_RUNTIME_PREFERENCES = Object.freeze({
  frontend: Object.freeze(["claude-code", "codex"]),
  backend: Object.freeze(["codex", "claude-code"]),
  scraping: Object.freeze(["codex"]),
  docs: Object.freeze(["claude-code", "codex"]),
  general: Object.freeze(["codex", "claude-code"])
});

export const RUNTIME_PREFERENCES = DEFAULT_RUNTIME_PREFERENCES;

export const DEFAULT_RUNTIME_CONFIG = Object.freeze({
  preferences: DEFAULT_RUNTIME_PREFERENCES,
  rateLimitFallback: true
});

const KNOWN_RUNTIME_IDS = new Set(RUNTIME_LIST.map((runtime) => runtime.RUNTIME_ID));

function uniqueRuntimeIds(runtimeIds = []) {
  const seen = new Set();
  const normalized = [];

  for (const runtimeId of runtimeIds) {
    const value = String(runtimeId || "").trim();
    if (!value || seen.has(value) || !KNOWN_RUNTIME_IDS.has(value)) {
      continue;
    }

    seen.add(value);
    normalized.push(value);
  }

  return normalized;
}

function sanitizePreferenceOverride(override, fallback) {
  const normalized = uniqueRuntimeIds(Array.isArray(override) ? override : []);
  return normalized.length > 0 ? normalized : [...fallback];
}

export function mergeRuntimePreferences(preferences = {}, defaults = DEFAULT_RUNTIME_PREFERENCES) {
  return Object.fromEntries(
    Object.entries(defaults).map(([taskType, fallback]) => [
      taskType,
      sanitizePreferenceOverride(preferences?.[taskType], fallback)
    ])
  );
}

export async function loadRuntimePreferences({
  cwd = process.cwd(),
  configPath = path.join(cwd, ".rei-runtimes.json"),
  readFile = fs.readFile
} = {}) {
  try {
    const text = await readFile(configPath, "utf8");
    const parsed = JSON.parse(text);

    return {
      sourcePath: configPath,
      exists: true,
      preferences: mergeRuntimePreferences(parsed?.preferences || {}),
      rateLimitFallback:
        typeof parsed?.rateLimitFallback === "boolean"
          ? parsed.rateLimitFallback
          : DEFAULT_RUNTIME_CONFIG.rateLimitFallback
    };
  } catch (error) {
    if (error?.code === "ENOENT") {
      return {
        sourcePath: configPath,
        exists: false,
        preferences: mergeRuntimePreferences(),
        rateLimitFallback: DEFAULT_RUNTIME_CONFIG.rateLimitFallback
      };
    }

    throw error;
  }
}

export async function probeAvailableRuntimes(env = process.env) {
  const available = [];

  for (const runtime of RUNTIME_LIST) {
    try {
      const command = await runtime.resolveCommand({ env });
      if (path.isAbsolute(command)) {
        await fs.access(command);
      }
      available.push(runtime.RUNTIME_ID);
    } catch {
      // binary tidak ditemukan
    }
  }

  return available;
}

export function resolveRuntimeOrder({
  taskType = "general",
  preferences = DEFAULT_RUNTIME_PREFERENCES,
  availableRuntimeIds = []
} = {}) {
  const available = uniqueRuntimeIds(availableRuntimeIds);
  const preferenceMap = mergeRuntimePreferences(preferences, DEFAULT_RUNTIME_PREFERENCES);
  const requestedOrder = preferenceMap[taskType] || preferenceMap.general || DEFAULT_RUNTIME_PREFERENCES.general;

  if (available.length === 0) {
    return [...requestedOrder];
  }

  const requestedAvailable = requestedOrder.filter((runtimeId) => available.includes(runtimeId));
  if (requestedAvailable.length > 0) {
    return requestedAvailable;
  }

  if (taskType !== "general") {
    const generalOrder = preferenceMap.general || DEFAULT_RUNTIME_PREFERENCES.general;
    const generalAvailable = generalOrder.filter((runtimeId) => available.includes(runtimeId));
    if (generalAvailable.length > 0) {
      return generalAvailable;
    }
  }

  return available;
}

export function selectRuntime(profileId, availableRuntimes = [], preferences = DEFAULT_RUNTIME_PREFERENCES) {
  return resolveRuntimeOrder({
    taskType: profileId,
    preferences,
    availableRuntimeIds: availableRuntimes
  })[0] ?? "codex";
}

export function getRuntime(runtimeId) {
  return RUNTIME_MAP.get(runtimeId) ?? codex;
}

export function buildRuntimeStartupSummary({
  config = DEFAULT_RUNTIME_CONFIG,
  availableRuntimeIds = []
} = {}) {
  const available = uniqueRuntimeIds(availableRuntimeIds);
  const preferences = mergeRuntimePreferences(config?.preferences || {}, DEFAULT_RUNTIME_PREFERENCES);
  const routing = Object.keys(DEFAULT_RUNTIME_PREFERENCES).map((taskType) => {
    const activeRuntime =
      resolveRuntimeOrder({
        taskType,
        preferences,
        availableRuntimeIds: available
      })[0] || "none";

    return `${taskType}→${activeRuntime}`;
  });

  return {
    availableLine: `runtimes available: ${available.length > 0 ? available.join(", ") : "none"}`,
    routingLine: `routing: ${routing.join(", ")}`,
    fallbackLine: `rate-limit fallback: ${config?.rateLimitFallback === false ? "disabled" : "enabled"}`
  };
}

// ─── Rate limit detection ─────────────────────────────────────────────────────

const RATE_LIMIT_PATTERNS = [
  "rate limit", "rate_limit", "ratelimit",
  "overloaded", "quota exceeded",
  "too many requests", " 529", "503 service", "capacity"
];

/**
 * Deteksi apakah output dari runtime mengandung indikasi rate limit / overload.
 * Exported untuk testing dan reuse di worker.
 */
export function isRateLimitError(text = "") {
  const lower = String(text || "").toLowerCase();
  return RATE_LIMIT_PATTERNS.some((p) => lower.includes(p));
}

// ─── Fallback runtime ─────────────────────────────────────────────────────────

/**
 * Cari runtime berikutnya dalam preference list setelah `currentRuntimeId` gagal.
 * Return: runtime ID string, atau null kalau tidak ada fallback yang tersedia.
 */
export function getFallbackRuntime(
  profileId,
  currentRuntimeId,
  availableRuntimes = [],
  preferences = DEFAULT_RUNTIME_PREFERENCES
) {
  // Pakai full preference list (tanpa availability filter) untuk cari posisi current.
  // Lalu cari runtime berikutnya yang benar-benar tersedia.
  const prefMap = mergeRuntimePreferences(
    typeof preferences === "object" && !Array.isArray(preferences) ? preferences : {},
    DEFAULT_RUNTIME_PREFERENCES
  );
  const fullOrder = prefMap[profileId] ?? prefMap.general ?? [...DEFAULT_RUNTIME_PREFERENCES.general];
  const currentIdx = fullOrder.indexOf(currentRuntimeId);
  if (currentIdx === -1) return null;
  // Cari runtime berikutnya setelah current yang ada di availableRuntimes
  return fullOrder.slice(currentIdx + 1).find((r) => availableRuntimes.includes(r)) ?? null;
}

// ─── Adaptive selection ───────────────────────────────────────────────────────

/**
 * Pilih runtime terbaik berdasarkan preference + histori sukses dari learning log.
 * Kalau belum ada cukup data (< MIN_SAMPLES), pakai urutan preference biasa.
 * Kalau sudah ada data, runtime dengan success rate lebih tinggi diprioritaskan.
 */
export function selectRuntimeAdaptive(
  profileId,
  availableRuntimes = [],
  learningEntries = [],
  preferences = DEFAULT_RUNTIME_PREFERENCES
) {
  const MIN_SAMPLES = 3;
  const ordered = resolveRuntimeOrder({ taskType: profileId, preferences, availableRuntimeIds: availableRuntimes });

  if (ordered.length <= 1) return ordered[0] ?? "codex";

  // Hitung statistik per runtime untuk profile ini
  const stats = {};
  for (const entry of learningEntries) {
    if (entry.profileId !== profileId) continue;
    const r = entry.runtimeId;
    if (!ordered.includes(r)) continue;
    if (!stats[r]) stats[r] = { ok: 0, fail: 0 };
    if (entry.outcome === "completed") stats[r].ok++;
    else if (entry.outcome === "failed") stats[r].fail++;
  }

  // Hanya reorder kalau semua candidate punya cukup sample
  const allHaveSamples = ordered.every((r) => {
    const s = stats[r] ?? { ok: 0, fail: 0 };
    return s.ok + s.fail >= MIN_SAMPLES;
  });

  if (!allHaveSamples) return ordered[0];

  // Sort by success rate descending; tie → urutan preferensi
  return [...ordered].sort((a, b) => {
    const sa = stats[a] ?? { ok: 0, fail: 0 };
    const sb = stats[b] ?? { ok: 0, fail: 0 };
    return (sb.ok / Math.max(sb.ok + sb.fail, 1)) - (sa.ok / Math.max(sa.ok + sa.fail, 1));
  })[0];
}
