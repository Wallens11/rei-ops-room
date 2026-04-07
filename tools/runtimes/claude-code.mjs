/**
 * Claude Code CLI runtime adapter.
 *
 * Dipakai oleh execute-worker.mjs untuk menjalankan task via `claude`.
 * Interface yang sama dengan codex.mjs — tiap runtime export:
 *   RUNTIME_ID, RUNTIME_LABEL, resolveCommand(), buildInvocation()
 *
 * Cara kerja:
 *   claude --print --dangerously-skip-permissions
 *   --print = non-interactive/headless mode, output ke stdout.
 *   Prompt dikirim via stdin.
 *
 * Env overrides:
 *   CLAUDE_BIN — path custom ke claude binary (optional)
 */

export const RUNTIME_ID = "claude-code";
export const RUNTIME_LABEL = "Claude Code";

/**
 * Resolve path ke Claude Code CLI binary.
 * Priority: env CLAUDE_BIN → fallback "claude" (PATH).
 */
export async function resolveCommand({ env = process.env, fallback = "claude" } = {}) {
  const configured = String(env?.CLAUDE_BIN || "").trim();
  if (configured) return configured;
  return fallback;
}

/**
 * Bangun invocation object untuk Claude Code CLI.
 * - outputMode "stdout": output last message dibaca dari stdout child process.
 * - stdinMode "prompt": prompt dikirim lewat stdin.
 * - cwd: set ke repoCwd supaya Claude Code tau konteks working directory.
 */
export function buildInvocation({ command, repoCwd }) {
  return {
    command,
    args: ["--print", "--dangerously-skip-permissions"],
    cwd: repoCwd,
    outputMode: "stdout",
    stdinMode: "prompt"
  };
}
