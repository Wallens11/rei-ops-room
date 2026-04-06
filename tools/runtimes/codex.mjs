/**
 * Codex runtime adapter.
 *
 * Dipakai oleh execute-worker.mjs untuk menjalankan task via `codex exec`.
 * Interface yang sama dengan claude-code.mjs — tiap runtime export:
 *   RUNTIME_ID, RUNTIME_LABEL, resolveCommand(), buildInvocation()
 */

import fs from "node:fs/promises";

export const RUNTIME_ID = "codex";
export const RUNTIME_LABEL = "Codex";

const DEFAULT_CODEX_CANDIDATES = [
  "/Applications/Codex.app/Contents/Resources/codex"
];

async function fileExists(candidate) {
  try {
    await fs.access(candidate);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve path ke Codex binary.
 * Priority: env CODEX_BIN → known install paths → fallback "codex" (PATH).
 */
export async function resolveCommand({ env = process.env, fallback = "codex" } = {}) {
  const configured = String(env?.CODEX_BIN || "").trim();
  if (configured) return configured;

  for (const candidate of DEFAULT_CODEX_CANDIDATES) {
    if (await fileExists(candidate)) return candidate;
  }

  return fallback;
}

/**
 * Bangun invocation object untuk Codex exec.
 * - outputMode "file": Codex menulis last message ke --output-last-message path.
 * - stdinMode "prompt": prompt dikirim lewat stdin.
 */
export function buildInvocation({ command, repoCwd, outputLastMessageFile }) {
  return {
    command,
    args: [
      "-a", "never",
      "-s", "workspace-write",
      "exec",
      "-C", repoCwd,
      "--json",
      "--output-last-message", outputLastMessageFile,
      "-"
    ],
    outputMode: "file",
    stdinMode: "prompt"
  };
}
