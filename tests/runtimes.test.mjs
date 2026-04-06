import assert from "node:assert/strict";
import { describe, it } from "node:test";

import * as codex from "../tools/runtimes/codex.mjs";
import * as claudeCode from "../tools/runtimes/claude-code.mjs";
import {
  RUNTIME_MAP,
  RUNTIME_PREFERENCES,
  getRuntime,
  probeAvailableRuntimes,
  selectRuntime
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
