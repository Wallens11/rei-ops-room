import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
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
