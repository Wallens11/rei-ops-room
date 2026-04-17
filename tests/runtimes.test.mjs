import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import * as codex from "../tools/runtimes/codex.mjs";
import * as claudeCode from "../tools/runtimes/claude-code.mjs";
import {
  RUNTIME_MAP,
  RUNTIME_PREFERENCES,
  getFallbackRuntime,
  getRuntime,
  isRateLimitError,
  loadRuntimePreferences,
  probeAvailableRuntimes,
  selectRuntime,
  selectRuntimeAdaptive
} from "../tools/runtimes/index.mjs";

// ─── codex.mjs ───────────────────────────────────────────────────────────────

describe("codex runtime", () => {
  it("exports RUNTIME_ID dan RUNTIME_LABEL", () => {
    assert.equal(codex.RUNTIME_ID, "codex");
    assert.equal(typeof codex.RUNTIME_LABEL, "string");
    assert.ok(codex.RUNTIME_LABEL.length > 0);
  });

  it("resolveCommand: pakai CODEX_BIN kalau di-set", async () => {
    const cmd = await codex.resolveCommand({ env: { CODEX_BIN: "/custom/codex" } });
    assert.equal(cmd, "/custom/codex");
  });

  it("resolveCommand: fallback ke 'codex' kalau tidak ada CODEX_BIN", async () => {
    const cmd = await codex.resolveCommand({ env: {} });
    // bisa return default candidate atau "codex" — tergantung apakah file ada di sistem
    assert.equal(typeof cmd, "string");
    assert.ok(cmd.length > 0);
  });

  it("buildInvocation: output via --output-last-message file", () => {
    const inv = codex.buildInvocation({
      command: "codex",
      repoCwd: "/repo",
      outputLastMessageFile: "/run/last-message.md"
    });
    assert.equal(inv.command, "codex");
    assert.equal(inv.outputMode, "file");
    assert.ok(inv.args.includes("--output-last-message"));
    assert.ok(inv.args.includes("/run/last-message.md"));
    assert.ok(inv.args.includes("-C"));
    assert.ok(inv.args.includes("/repo"));
  });

  it("buildInvocation: stdin mode prompt (ada '-' di akhir args)", () => {
    const inv = codex.buildInvocation({
      command: "codex",
      repoCwd: "/repo",
      outputLastMessageFile: "/run/last-message.md"
    });
    assert.equal(inv.args[inv.args.length - 1], "-");
  });
});

// ─── claude-code.mjs ─────────────────────────────────────────────────────────

describe("claude-code runtime", () => {
  it("exports RUNTIME_ID dan RUNTIME_LABEL", () => {
    assert.equal(claudeCode.RUNTIME_ID, "claude-code");
    assert.equal(typeof claudeCode.RUNTIME_LABEL, "string");
    assert.ok(claudeCode.RUNTIME_LABEL.length > 0);
  });

  it("resolveCommand: pakai CLAUDE_BIN kalau di-set", async () => {
    const cmd = await claudeCode.resolveCommand({ env: { CLAUDE_BIN: "/usr/local/bin/claude" } });
    assert.equal(cmd, "/usr/local/bin/claude");
  });

  it("resolveCommand: fallback ke 'claude' kalau tidak ada CLAUDE_BIN", async () => {
    const cmd = await claudeCode.resolveCommand({ env: {} });
    assert.equal(cmd, "claude");
  });

  it("buildInvocation: output via stdout", () => {
    const inv = claudeCode.buildInvocation({ command: "claude", repoCwd: "/repo" });
    assert.equal(inv.command, "claude");
    assert.equal(inv.outputMode, "stdout");
    assert.ok(inv.args.includes("--print"));
    assert.ok(inv.args.includes("--dangerously-skip-permissions"));
  });

  it("buildInvocation: cwd di-set ke repoCwd", () => {
    const inv = claudeCode.buildInvocation({ command: "claude", repoCwd: "/myrepo" });
    assert.equal(inv.cwd, "/myrepo");
  });
});

// ─── index.mjs ───────────────────────────────────────────────────────────────

describe("runtime registry", () => {
  it("RUNTIME_MAP berisi codex dan claude-code", () => {
    assert.ok(RUNTIME_MAP.has("codex"));
    assert.ok(RUNTIME_MAP.has("claude-code"));
  });

  it("getRuntime: return runtime yang benar", () => {
    const r = getRuntime("codex");
    assert.equal(r.RUNTIME_ID, "codex");
    const c = getRuntime("claude-code");
    assert.equal(c.RUNTIME_ID, "claude-code");
  });

  it("getRuntime: fallback ke codex untuk ID tidak dikenal", () => {
    const r = getRuntime("unknown-llm");
    assert.equal(r.RUNTIME_ID, "codex");
  });
});

// ─── selectRuntime ───────────────────────────────────────────────────────────

describe("selectRuntime", () => {
  it("pilih claude-code untuk backend kalau tersedia", () => {
    const result = selectRuntime("backend", ["codex", "claude-code"]);
    assert.equal(result, "claude-code");
  });

  it("pilih claude-code untuk docs kalau tersedia", () => {
    const result = selectRuntime("docs", ["codex", "claude-code"]);
    assert.equal(result, "claude-code");
  });

  it("fallback ke codex untuk backend kalau claude-code tidak tersedia", () => {
    const result = selectRuntime("backend", ["codex"]);
    assert.equal(result, "codex");
  });

  it("pilih codex untuk scraping", () => {
    const result = selectRuntime("scraping", ["codex", "claude-code"]);
    assert.equal(result, "codex");
  });

  it("pilih codex untuk frontend", () => {
    const result = selectRuntime("frontend", ["codex", "claude-code"]);
    assert.equal(result, "codex");
  });

  it("fallback ke codex kalau profile tidak dikenal dan codex tersedia", () => {
    const result = selectRuntime("unknown-profile", ["codex", "claude-code"]);
    assert.equal(result, "codex");
  });

  it("fallback ke 'codex' string kalau availableRuntimes kosong", () => {
    const result = selectRuntime("backend", []);
    assert.equal(result, "codex");
  });
});

// ─── RUNTIME_PREFERENCES ─────────────────────────────────────────────────────

describe("RUNTIME_PREFERENCES", () => {
  it("semua profile preference adalah array of string", () => {
    for (const [profile, prefs] of Object.entries(RUNTIME_PREFERENCES)) {
      assert.ok(Array.isArray(prefs), `${profile} harus array`);
      assert.ok(prefs.length > 0, `${profile} tidak boleh kosong`);
      for (const p of prefs) {
        assert.equal(typeof p, "string");
      }
    }
  });

  it("semua runtime ID di preferences terdaftar di RUNTIME_MAP", () => {
    for (const [profile, prefs] of Object.entries(RUNTIME_PREFERENCES)) {
      for (const rId of prefs) {
        assert.ok(
          RUNTIME_MAP.has(rId),
          `${rId} di preferences[${profile}] tidak ada di RUNTIME_MAP`
        );
      }
    }
  });
});

// ─── probeAvailableRuntimes ───────────────────────────────────────────────────

describe("probeAvailableRuntimes", () => {
  it("return array of string", async () => {
    const result = await probeAvailableRuntimes(process.env);
    assert.ok(Array.isArray(result));
    for (const id of result) {
      assert.equal(typeof id, "string");
    }
  });

  it("codex pakai CODEX_BIN absolute path yang tidak ada → tidak masuk available", async () => {
    const result = await probeAvailableRuntimes({
      CODEX_BIN: "/nonexistent/codex-binary-xyz"
    });
    assert.ok(!result.includes("codex"), "codex tidak boleh available kalau binary tidak ada");
  });

  it("claude-code selalu available kalau CLAUDE_BIN tidak set (relative, trust PATH)", async () => {
    // resolveCommand claude-code return "claude" (relative) → trust PATH → masuk available
    const result = await probeAvailableRuntimes({});
    assert.ok(result.includes("claude-code"));
  });
});

// ─── isRateLimitError ────────────────────────────────────────────────────────

describe("isRateLimitError", () => {
  it("deteksi 'rate limit' dalam pesan error", () => {
    assert.ok(isRateLimitError("Error: rate limit exceeded, please try later"));
  });

  it("deteksi 'overloaded' dalam pesan error", () => {
    assert.ok(isRateLimitError("API is currently overloaded with requests"));
  });

  it("deteksi '529' dalam pesan error", () => {
    assert.ok(isRateLimitError("HTTP 529 error from API"));
  });

  it("return false untuk error biasa (bukan rate limit)", () => {
    assert.ok(!isRateLimitError("SyntaxError: Unexpected token '}' at line 42"));
  });

  it("return false untuk string kosong", () => {
    assert.ok(!isRateLimitError(""));
    assert.ok(!isRateLimitError(null));
  });
});

// ─── getFallbackRuntime ───────────────────────────────────────────────────────

describe("getFallbackRuntime", () => {
  const prefs = { frontend: ["claude-code", "codex"], backend: ["codex", "claude-code"] };

  it("return runtime berikutnya kalau primary gagal", () => {
    const fallback = getFallbackRuntime("frontend", "claude-code", ["codex"], prefs);
    assert.equal(fallback, "codex");
  });

  it("return null kalau tidak ada runtime berikutnya yang tersedia", () => {
    const fallback = getFallbackRuntime("frontend", "codex", ["codex"], prefs);
    assert.equal(fallback, null);
  });

  it("return null kalau currentRuntimeId tidak ada di preferences", () => {
    const fallback = getFallbackRuntime("frontend", "gemini", ["codex"], prefs);
    assert.equal(fallback, null);
  });

  it("hanya return runtime yang ada di availableRuntimes", () => {
    // codex tersedia, tapi backend pref = [codex, claude-code]. claude-code fallback tidak tersedia
    const fallback = getFallbackRuntime("backend", "codex", ["codex"], prefs);
    assert.equal(fallback, null); // claude-code tidak di availableRuntimes
  });
});

// ─── loadRuntimePreferences ──────────────────────────────────────────────────

describe("loadRuntimePreferences", () => {
  it("return defaults kalau file tidak ada", async () => {
    const result = await loadRuntimePreferences("/nonexistent/.rei-runtimes.json");
    assert.deepEqual(result.preferences, RUNTIME_PREFERENCES);
    assert.equal(result.rateLimitFallback, true);
  });

  it("merge config dengan default — key yang ada override, yang tidak ada tetap default", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rei-rt-"));
    const configPath = path.join(tmpDir, ".rei-runtimes.json");
    await fs.writeFile(configPath, JSON.stringify({
      preferences: { frontend: ["claude-code"] }
    }), "utf8");

    const result = await loadRuntimePreferences(configPath);
    assert.deepEqual(result.preferences.frontend, ["claude-code"]);
    // backend tidak di-override → ambil default
    assert.deepEqual(result.preferences.backend, RUNTIME_PREFERENCES.backend);
    await fs.rm(tmpDir, { recursive: true });
  });

  it("abaikan preferences dengan runtime ID tidak dikenal", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rei-rt-"));
    const configPath = path.join(tmpDir, ".rei-runtimes.json");
    await fs.writeFile(configPath, JSON.stringify({
      preferences: { frontend: ["gemini-pro"] }  // tidak terdaftar di RUNTIME_MAP
    }), "utf8");

    const result = await loadRuntimePreferences(configPath);
    // frontend tidak di-override karena gemini-pro tidak valid
    assert.deepEqual(result.preferences.frontend, RUNTIME_PREFERENCES.frontend);
    await fs.rm(tmpDir, { recursive: true });
  });

  it("rateLimitFallback: false kalau di-set di config", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rei-rt-"));
    const configPath = path.join(tmpDir, ".rei-runtimes.json");
    await fs.writeFile(configPath, JSON.stringify({ rateLimitFallback: false }), "utf8");

    const result = await loadRuntimePreferences(configPath);
    assert.equal(result.rateLimitFallback, false);
    await fs.rm(tmpDir, { recursive: true });
  });
});

// ─── selectRuntimeAdaptive ───────────────────────────────────────────────────

describe("selectRuntimeAdaptive", () => {
  const prefs = {
    frontend: ["claude-code", "codex"],
    backend:  ["codex", "claude-code"]
  };

  it("pakai urutan preferensi kalau belum ada learning data", () => {
    const r = selectRuntimeAdaptive("frontend", ["claude-code", "codex"], [], prefs);
    assert.equal(r, "claude-code");
  });

  it("pakai urutan preferensi kalau sample terlalu sedikit (< 3)", () => {
    const entries = [
      { profileId: "frontend", runtimeId: "codex", outcome: "completed" },
      { profileId: "frontend", runtimeId: "claude-code", outcome: "failed" }
    ];
    const r = selectRuntimeAdaptive("frontend", ["claude-code", "codex"], entries, prefs);
    assert.equal(r, "claude-code"); // tetap default, sample < 3
  });

  it("pilih runtime dengan success rate lebih tinggi kalau cukup sample", () => {
    // codex: 3 completed, claude-code: 0 completed 3 failed → pilih codex
    const entries = [
      { profileId: "frontend", runtimeId: "codex", outcome: "completed" },
      { profileId: "frontend", runtimeId: "codex", outcome: "completed" },
      { profileId: "frontend", runtimeId: "codex", outcome: "completed" },
      { profileId: "frontend", runtimeId: "claude-code", outcome: "failed" },
      { profileId: "frontend", runtimeId: "claude-code", outcome: "failed" },
      { profileId: "frontend", runtimeId: "claude-code", outcome: "failed" }
    ];
    const r = selectRuntimeAdaptive("frontend", ["claude-code", "codex"], entries, prefs);
    assert.equal(r, "codex"); // codex menang dengan 100% success rate
  });

  it("abaikan entries dari profile lain", () => {
    // Hanya backend entries, tidak pengaruhi frontend selection
    const entries = [
      { profileId: "backend", runtimeId: "codex", outcome: "completed" },
      { profileId: "backend", runtimeId: "codex", outcome: "completed" },
      { profileId: "backend", runtimeId: "codex", outcome: "completed" },
      { profileId: "backend", runtimeId: "claude-code", outcome: "failed" },
      { profileId: "backend", runtimeId: "claude-code", outcome: "failed" },
      { profileId: "backend", runtimeId: "claude-code", outcome: "failed" }
    ];
    const r = selectRuntimeAdaptive("frontend", ["claude-code", "codex"], entries, prefs);
    assert.equal(r, "claude-code"); // frontend tetap pakai preferensi default
  });

  it("fallback ke codex kalau tidak ada runtime tersedia", () => {
    const r = selectRuntimeAdaptive("frontend", [], [], prefs);
    assert.equal(r, "codex");
  });
});
