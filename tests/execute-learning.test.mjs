import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
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
