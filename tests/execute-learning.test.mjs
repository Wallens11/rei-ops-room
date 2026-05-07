import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  computeMetrics,
  computeTrustSignals,
  detectFailurePattern,
  extractKeySummary,
  formatLearningContext,
  getLearningEntries,
  learningLogFile,
  recordRunInsight
} from "../tools/execute-learning.mjs";

// ─── extractKeySummary ────────────────────────────────────────────────────────

describe("extractKeySummary", () => {
  it("return null untuk input kosong", () => {
    assert.equal(extractKeySummary(""), null);
    assert.equal(extractKeySummary(null), null);
    assert.equal(extractKeySummary(undefined), null);
  });

  it("skip baris markdown heading", () => {
    const msg = "# Summary\nFixed the auth bug by updating the JWT expiry logic.";
    const result = extractKeySummary(msg);
    assert.ok(result);
    assert.ok(!result.startsWith("#"));
    assert.ok(result.includes("Fixed the auth bug"));
  });

  it("skip baris separator ---", () => {
    const msg = "---\nCompleted the refactor successfully.";
    const result = extractKeySummary(msg);
    assert.ok(result);
    assert.ok(!result.startsWith("---"));
  });

  it("truncate panjang lebih dari 280 karakter", () => {
    const longLine = "a".repeat(300);
    const result = extractKeySummary(longLine);
    assert.ok(result);
    assert.ok(result.length <= 281); // 280 + ellipsis char
    assert.ok(result.endsWith("…"));
  });

  it("return null kalau semua baris terlalu pendek atau heading", () => {
    const msg = "# Title\n---\nshort";
    const result = extractKeySummary(msg);
    // "short" adalah 5 karakter, lebih pendek dari threshold 20 — return null
    assert.equal(result, null);
  });

  it("ambil baris pertama yang substantif", () => {
    const msg = "# Header\n\nFirst real sentence here that is long enough.\nSecond sentence.";
    const result = extractKeySummary(msg);
    assert.equal(result, "First real sentence here that is long enough.");
  });
});

// ─── formatLearningContext ────────────────────────────────────────────────────

describe("formatLearningContext", () => {
  const sampleEntries = [
    {
      date: "2026-04-05",
      issueNumber: 10,
      taskTitle: "fix login bug",
      runtimeId: "codex",
      outcome: "completed",
      filesChanged: ["src/auth.js", "tests/auth.test.js"],
      keySummary: "Fixed JWT expiry in middleware."
    },
    {
      date: "2026-04-06",
      issueNumber: 15,
      taskTitle: "scrape data from target",
      runtimeId: "codex",
      outcome: "review_needed",
      filesChanged: [],
      keySummary: null
    },
    {
      date: "2026-04-07",
      issueNumber: null,
      taskTitle: "review auth.js codebase",
      runtimeId: "claude-code",
      outcome: "completed",
      filesChanged: ["src/auth.js"],
      keySummary: "Identified three potential issues in token refresh."
    }
  ];

  it("return null untuk array kosong", () => {
    assert.equal(formatLearningContext([]), null);
    assert.equal(formatLearningContext(null), null);
  });

  it("return string untuk entries yang ada", () => {
    const result = formatLearningContext(sampleEntries);
    assert.equal(typeof result, "string");
    assert.ok(result.length > 0);
  });

  it("mengandung header 'Recent run history'", () => {
    const result = formatLearningContext(sampleEntries);
    assert.ok(result.includes("Recent run history"));
  });

  it("issue number ditampilkan sebagai #N", () => {
    const result = formatLearningContext(sampleEntries);
    assert.ok(result.includes("#10"));
    assert.ok(result.includes("#15"));
  });

  it("direct task ditampilkan sebagai 'direct'", () => {
    const result = formatLearningContext(sampleEntries);
    assert.ok(result.includes("direct"));
  });

  it("outcome ditampilkan", () => {
    const result = formatLearningContext(sampleEntries);
    assert.ok(result.includes("completed"));
    assert.ok(result.includes("review_needed"));
  });

  it("file changes ditampilkan", () => {
    const result = formatLearningContext(sampleEntries);
    assert.ok(result.includes("auth.js"));
  });

  it("keySummary ditampilkan kalau ada", () => {
    const result = formatLearningContext(sampleEntries);
    assert.ok(result.includes("Fixed JWT expiry"));
  });

  it("limit: ambil hanya N entries terbaru", () => {
    const result = formatLearningContext(sampleEntries, { limit: 1 });
    // Hanya entry terbaru (index 2) yang muncul
    assert.ok(result.includes("review auth.js codebase"));
    assert.ok(!result.includes("fix login bug")); // yang lama tidak muncul
  });

  it("urutan: terbaru dulu (reverse chronological)", () => {
    const result = formatLearningContext(sampleEntries, { limit: 3 });
    const idx07 = result.indexOf("2026-04-07");
    const idx05 = result.indexOf("2026-04-05");
    assert.ok(idx07 < idx05, "entry terbaru harus muncul lebih awal");
  });

  it("file lebih dari 3: tampilkan +N more", () => {
    const entryWithManyFiles = {
      date: "2026-04-07",
      issueNumber: 20,
      taskTitle: "big refactor",
      runtimeId: "codex",
      outcome: "completed",
      filesChanged: ["a.js", "b.js", "c.js", "d.js", "e.js"],
      keySummary: null
    };
    const result = formatLearningContext([entryWithManyFiles]);
    assert.ok(result.includes("+2 more"));
  });
});

// ─── buildDirectTaskPrompt dengan learningContext ─────────────────────────────

describe("buildDirectTaskPrompt: learningContext injection", async () => {
  const { buildDirectTaskPrompt } = await import("../tools/execute-bridge.mjs");

  it("inject learning context kalau ada", () => {
    const prompt = buildDirectTaskPrompt({
      task: "fix tests",
      repoCwd: "/repo",
      learningContext: "Recent run history:\n- [2026-04-07] completed #10 (fix auth)"
    });
    assert.ok(prompt.includes("Recent run history"));
    assert.ok(prompt.includes("fix auth"));
  });

  it("tidak crash kalau learningContext null", () => {
    assert.doesNotThrow(() =>
      buildDirectTaskPrompt({ task: "do something", repoCwd: "/repo", learningContext: null })
    );
  });

  it("learningContext null tidak meninggalkan 'null' literal di prompt", () => {
    const prompt = buildDirectTaskPrompt({ task: "task", repoCwd: "/repo", learningContext: null });
    assert.ok(!prompt.includes("null"));
  });
});

// ─── recordRunInsight: profileId ─────────────────────────────────────────────

describe("recordRunInsight menyimpan profileId", () => {
  // Gunakan tmp file agar tidak menyentuh .execute-learning.json asli
  async function withTmpLog(fn) {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rei-learn-"));
    const origFile = learningLogFile;
    // Monkey-patch modul path via env tidak bisa langsung — test ini mengandalkan
    // bahwa recordRunInsight menulis ke learningLogFile default.
    // Untuk isolasi, kita tulis tmp file ke path yang sama sementara.
    // Simpan isi asli kalau ada, restore setelahnya.
    let originalContent = null;
    try {
      originalContent = await fs.readFile(learningLogFile, "utf8");
    } catch {
      // file tidak ada — ok
    }
    try {
      // Reset log ke kosong untuk test ini
      await fs.writeFile(learningLogFile, JSON.stringify({ entries: [] }), "utf8");
      await fn();
    } finally {
      // Restore
      if (originalContent !== null) {
        await fs.writeFile(learningLogFile, originalContent, "utf8").catch(() => {});
      } else {
        await fs.unlink(learningLogFile).catch(() => {});
      }
      await fs.rm(tmpDir, { recursive: true }).catch(() => {});
    }
  }

  it("entry yang direkam mengandung profileId", async () => {
    await withTmpLog(async () => {
      const entry = await recordRunInsight({
        issueNumber: 42,
        taskTitle: "Test task",
        runtimeId: "claude-code",
        profileId: "frontend",
        outcome: "completed",
        filesChanged: ["src/app.js"],
        lastMessage: "Done successfully."
      });

      assert.equal(entry.profileId, "frontend");
      assert.equal(entry.runtimeId, "claude-code");
      assert.equal(entry.outcome, "completed");
    });
  });

  it("profileId default 'general' kalau tidak disediakan", async () => {
    await withTmpLog(async () => {
      const entry = await recordRunInsight({
        taskTitle: "No profile task",
        runtimeId: "codex",
        outcome: "failed"
      });

      assert.equal(entry.profileId, "general");
    });
  });

  it("getLearningEntries adalah alias readLearningLog", async () => {
    assert.equal(typeof getLearningEntries, "function");
  });
});

// ─── computeTrustSignals ──────────────────────────────────────────────────────

describe("computeTrustSignals", () => {
  const makeEntries = (overrides = []) => overrides.map((o) => ({
    profileId: "frontend",
    runtimeId: "claude-code",
    outcome: "completed",
    issueNumber: null,
    recordedAt: new Date().toISOString(),
    ...o
  }));

  it("return empty array untuk entries kosong", () => {
    assert.deepEqual(computeTrustSignals([], { profileId: "frontend" }), []);
    assert.deepEqual(computeTrustSignals(null, { profileId: "frontend" }), []);
  });

  it("return empty array kalau belum ada cukup data profile (< 2 entries)", () => {
    const entries = makeEntries([{ outcome: "completed" }]);
    const signals = computeTrustSignals(entries, { profileId: "frontend" });
    // Hanya 1 entry — tidak cukup untuk menampilkan success rate
    assert.ok(!signals.some((s) => s.includes("1/1 completed")));
  });

  it("menampilkan success rate kalau ada >= 2 entries untuk profile", () => {
    const entries = makeEntries([
      { outcome: "completed" },
      { outcome: "completed" },
      { outcome: "failed" }
    ]);
    const signals = computeTrustSignals(entries, { profileId: "frontend" });
    assert.ok(signals.some((s) => s.includes("frontend tasks:")));
    assert.ok(signals.some((s) => s.includes("2/3 completed")));
  });

  it("menampilkan best runtime kalau ada >= 2 entries untuk runtime tersebut", () => {
    const entries = makeEntries([
      { runtimeId: "codex", outcome: "completed" },
      { runtimeId: "codex", outcome: "completed" },
      { runtimeId: "claude-code", outcome: "failed" },
      { runtimeId: "claude-code", outcome: "failed" }
    ]);
    const signals = computeTrustSignals(entries, { profileId: "frontend" });
    assert.ok(signals.some((s) => s.includes("best runtime") && s.includes("codex")));
  });

  it("menampilkan riwayat issue kalau issueNumber diberikan", () => {
    const entries = makeEntries([{ issueNumber: 42, outcome: "completed" }]);
    const signals = computeTrustSignals(entries, { profileId: "frontend", issueNumber: 42 });
    assert.ok(signals.some((s) => s.includes("#42") && s.includes("completed")));
  });

  it("tidak menampilkan riwayat issue kalau issueNumber tidak cocok", () => {
    const entries = makeEntries([{ issueNumber: 99, outcome: "completed" }]);
    const signals = computeTrustSignals(entries, { profileId: "frontend", issueNumber: 42 });
    assert.ok(!signals.some((s) => s.includes("#42")));
  });

  it("max 4 signals dikembalikan", () => {
    const entries = makeEntries([
      { outcome: "completed" },
      { outcome: "completed" },
      { runtimeId: "codex", outcome: "completed" },
      { runtimeId: "codex", outcome: "completed" },
      { issueNumber: 1, outcome: "completed" }
    ]);
    const signals = computeTrustSignals(entries, { profileId: "frontend", issueNumber: 1 });
    assert.ok(signals.length <= 4);
  });
});

// ─── detectFailurePattern ─────────────────────────────────────────────────────

describe("detectFailurePattern", () => {
  const makeEntries = (overrides = []) => overrides.map((o) => ({
    profileId: "backend",
    runtimeId: "codex",
    outcome: "completed",
    issueNumber: null,
    ...o
  }));

  it("return low risk kalau tidak ada kegagalan", () => {
    const entries = makeEntries([
      { outcome: "completed" },
      { outcome: "completed" },
      { outcome: "completed" }
    ]);
    const result = detectFailurePattern(entries, { profileId: "backend" });
    assert.equal(result.hasWarning, false);
    assert.equal(result.riskLevel, "low");
    assert.deepEqual(result.patterns, []);
  });

  it("deteksi repeated_issue_failure kalau issue yang sama gagal 2+ kali", () => {
    const entries = makeEntries([
      { issueNumber: 10, outcome: "failed" },
      { issueNumber: 10, outcome: "failed" }
    ]);
    const result = detectFailurePattern(entries, { profileId: "backend", issueNumber: 10 });
    assert.equal(result.hasWarning, true);
    assert.ok(result.riskLevel === "medium" || result.riskLevel === "high");
    assert.ok(result.patterns.some((p) => p.type === "repeated_issue_failure"));
  });

  it("severity high kalau issue yang sama gagal 3+ kali", () => {
    const entries = makeEntries([
      { issueNumber: 10, outcome: "failed" },
      { issueNumber: 10, outcome: "failed" },
      { issueNumber: 10, outcome: "failed" }
    ]);
    const result = detectFailurePattern(entries, { profileId: "backend", issueNumber: 10 });
    assert.equal(result.riskLevel, "high");
    assert.ok(result.patterns.some((p) => p.severity === "high"));
  });

  it("deteksi profile_failure_streak kalau >60% gagal dalam 5 run terakhir", () => {
    const entries = makeEntries([
      { outcome: "failed" },
      { outcome: "failed" },
      { outcome: "failed" },
      { outcome: "completed" }
    ]);
    const result = detectFailurePattern(entries, { profileId: "backend" });
    assert.equal(result.hasWarning, true);
    assert.ok(result.patterns.some((p) => p.type === "profile_failure_streak"));
  });

  it("tidak trigger streak kalau failure rate < 60%", () => {
    const entries = makeEntries([
      { outcome: "failed" },
      { outcome: "completed" },
      { outcome: "completed" }
    ]);
    const result = detectFailurePattern(entries, { profileId: "backend" });
    assert.ok(!result.patterns.some((p) => p.type === "profile_failure_streak"));
  });

  it("return low risk untuk input kosong", () => {
    const result = detectFailurePattern([], { profileId: "backend" });
    assert.equal(result.hasWarning, false);
    assert.equal(result.riskLevel, "low");
  });
});

// ─── computeMetrics ───────────────────────────────────────────────────────────

describe("computeMetrics", () => {
  const sample = [
    { runtimeId: "claude-code", profileId: "frontend", outcome: "completed",     issueNumber: 1, recordedAt: "2026-05-01T10:00:00Z" },
    { runtimeId: "claude-code", profileId: "frontend", outcome: "failed",         issueNumber: 2, recordedAt: "2026-05-02T10:00:00Z" },
    { runtimeId: "codex",       profileId: "general",  outcome: "completed",     issueNumber: 3, recordedAt: "2026-05-03T10:00:00Z" },
    { runtimeId: "codex",       profileId: "general",  outcome: "aborted",       issueNumber: 4, recordedAt: "2026-05-04T10:00:00Z" },
    { runtimeId: "codex",       profileId: "general",  outcome: "review_needed", issueNumber: 5, recordedAt: "2026-05-05T10:00:00Z" }
  ];

  it("returns zero metrics for empty entries", () => {
    const m = computeMetrics([]);
    assert.equal(m.totalRuns, 0);
    assert.equal(m.successRate, 0);
    assert.deepEqual(m.byRuntime, {});
    assert.deepEqual(m.byProfile, {});
    assert.deepEqual(m.recentRuns, []);
  });

  it("handles null/undefined gracefully", () => {
    assert.equal(computeMetrics(null).totalRuns, 0);
    assert.equal(computeMetrics(undefined).totalRuns, 0);
  });

  it("computes totalRuns correctly", () => {
    assert.equal(computeMetrics(sample).totalRuns, 5);
  });

  it("computes successRate as fraction of completed outcomes", () => {
    const m = computeMetrics(sample);
    // 2 completed out of 5
    assert.ok(Math.abs(m.successRate - 0.4) < 0.001);
  });

  it("groups byRuntime with correct completed + failed counts", () => {
    const m = computeMetrics(sample);
    assert.equal(m.byRuntime["claude-code"].total, 2);
    assert.equal(m.byRuntime["claude-code"].completed, 1);
    assert.equal(m.byRuntime["claude-code"].failed, 1);
    assert.equal(m.byRuntime.codex.total, 3);
    assert.equal(m.byRuntime.codex.completed, 1);
    assert.equal(m.byRuntime.codex.failed, 1); // review_needed counts as failed
  });

  it("aborted is not counted as failed in byRuntime", () => {
    const m = computeMetrics(sample);
    // codex: 1 completed, 1 review_needed (=failed), 1 aborted (=neither) → total 3, failed 1
    assert.equal(m.byRuntime.codex.failed, 1);
  });

  it("groups byProfile correctly", () => {
    const m = computeMetrics(sample);
    assert.equal(m.byProfile.frontend.total, 2);
    assert.equal(m.byProfile.general.total, 3);
  });

  it("returns at most 10 recentRuns, most-recent first", () => {
    const many = Array.from({ length: 15 }, (_, i) => ({
      runtimeId: "codex", profileId: "general", outcome: "completed",
      issueNumber: i + 1, recordedAt: `2026-05-${String(i + 1).padStart(2, "0")}T10:00:00Z`
    }));
    const m = computeMetrics(many);
    assert.equal(m.recentRuns.length, 10);
    assert.equal(m.recentRuns[0].issueNumber, 15); // most recent first
  });

  it("recentRuns only contains the required 5 fields", () => {
    const m = computeMetrics(sample);
    const keys = Object.keys(m.recentRuns[0]).sort();
    assert.deepEqual(keys, ["issueNumber", "outcome", "profileId", "recordedAt", "runtimeId"]);
  });
});
