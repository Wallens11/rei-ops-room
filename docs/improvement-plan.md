# Rei Ops Room — Improvement Plan

Dokumen ini menyimpan rencana peningkatan bertahap supaya bisa dilanjut lintas session dan lintas platform.

---

## Status

| # | Area | Status | Notes |
|---|---|---|---|
| 0 | Brush up: security, perf, bug fixes | ✅ Done | commit `846fde5` |
| 1 | `room-state.js` inference upgrade | ✅ Done | commit berikut setelah ini |
| 2 | `execute-bridge.mjs` logic upgrade | ✅ Done | commit berikut setelah ini |
| 3 | Skill & handoff docs upgrade | ✅ Done | commit berikut setelah ini |

---

## Item 1 — Upgrade `room-state.js` Inference Logic

**File**: `public/room-state.js` (2651 baris)

### Masalah Saat Ini

Semua inference zone dan phase menggunakan **plain string `includes()` matching** terhadap array keyword.
Ini rapuh karena:

1. **Order sensitivity** — `humanizeSummary()` adalah if/else chain panjang (~120 baris), urutan blok menentukan hasil. Keyword yang muncul lebih awal selalu menang, bukan yang paling relevan.
2. **No scoring di `humanizeSummary`** — berbeda dengan `baseSignals()` yang pakai scoring, `humanizeSummary` tidak ada bobot, langsung return di match pertama.
3. **`runtimeZoneHints()` hardcoded magic numbers** — skor seperti `6`, `4.8`, `4.5`, `4.2`, `5.2`, `4.4` tidak punya dasar yang jelas, sulit di-tune.
4. **`inferZoneFromText()` hanya pakai `zone.keywords`** — tidak mempertimbangkan cwd, branch, atau file path yang sedang aktif.
5. **Phase inference terlalu sederhana** — `planning_huddle` trigger hanya dari keyword list di `PLANNING_TERMS`, tidak ada bobot antar source (title vs log vs activity).
6. **Confidence calculation tidak konsisten** — formula di `inferOrchestration()` campur antara raw score dan magic threshold (`0.82`, `0.72`, `1.2`).
7. **`countMatches()` bonus hanya dari `term.length >= 7`** — tidak ada konteks apakah term muncul di judul (high signal) vs log noise (low signal).

### Rencana Perbaikan

#### 1a. Refactor `humanizeSummary` → tabel data-driven

Ganti if/else chain dengan lookup table:

```js
const SUMMARY_RULES = [
  { terms: ["wait_agent", "result returned", "worker results"], label: "result return", priority: 10 },
  { terms: ["spawn_agent", "subagent", "parallel"], label: "squad split", priority: 9 },
  { terms: ["review", "wrap", "summary", "handoff"], label: "review wrap", priority: 8 },
  { terms: ["npm test", "node --test", "playwright", "verification"], label: "verification pass", priority: 7 },
  { terms: ["layout", "css", "style", "canvas", "widget"], label: "layout check", priority: 6 },
  { terms: ["server", "api", "runtime", "orchestration"], label: "runtime mapping", priority: 5 },
  { terms: ["sqlite", "logs", "trace", "query"], label: "trace reading", priority: 4 },
  { terms: ["debug", "fix", "error", "fail"], label: "debug pass", priority: 3 },
];
```

Evaluasi semua rules, ambil yang priority tertinggi dengan hits terbanyak.
Kalau tie, ambil yang lebih banyak term cocok.

#### 1b. Weighted multi-source zone inference

Saat ini `inferZoneFromText()` hanya terima satu string. Upgrade supaya terima object:

```js
inferZoneFromSources({
  title,      // weight: 3.0 — high signal
  cwd,        // weight: 2.5 — very high signal (file sedang diedit)
  branch,     // weight: 2.0 — medium-high signal
  activity,   // weight: 1.5 — medium signal
  logs,       // weight: 0.8 — noisy, low signal
})
```

CWD path breakdown khusus — extract folder/file name aktif dan map ke zone:
- `public/` → frontend
- `tools/`, `server` → backend
- `tests/` → backend
- `.sqlite`, `logs` → database
- `docs/`, `README` → review

#### 1c. Normalize confidence formula

Hapus magic numbers. Buat threshold sebagai named constants:

```js
const ZONE_CONFIDENCE_STRONG = 1.8;   // sebelumnya: 1.2 (terlalu rendah)
const ZONE_CONFIDENCE_WEAK = 0.8;
const PHASE_CONFIDENCE_THRESHOLD = 0.72;
const PLANNING_OVERRIDE_THRESHOLD = 0.82;
```

Formula confidence dibuat linear dan predictable:
```js
confidence = clamp(topScore / (topScore + secondScore + 0.5), 0.2, 0.99)
```

#### 1d. Improve `runtimeZoneHints()` — named weights

Ganti magic number dengan named constants dan dokumentasinya:

```js
const HINT_WEIGHTS = {
  RUNTIME_COMMAND: 6.0,  // "npm start", "node server.mjs" — hampir pasti backend
  SESSION_LOOP: 4.8,     // internal codex log — backend signal kuat
  VERIFICATION: 4.5,     // test runner — backend/review
  UI_FILE: 4.2,          // public/ path — frontend
  DB_COMMAND: 5.2,       // sqlite3, .sqlite — database
  OPS_HANDOFF: 4.4,      // gh issue, review request — review
};
```

#### 1e. Phase scoring (bukan binary keyword check)

Saat ini `planning_huddle` trigger kalau ANY planning term ada. Upgrade ke scoring:

```js
function inferPhaseScore(signals, sources) {
  return {
    planning: scoreTerms(sources, PLANNING_TERMS) * 1.5 + (signals.new_request ? 2 : 0),
    delegation: scoreTerms(sources, DELEGATION_TERMS) * 2.0,
    review: scoreTerms(sources, REVIEW_TERMS) * 1.3 + (signals.result_returning ? 3 : 0),
    headsDown: confidence * 2.5,  // kalau confidence zone tinggi → heads down
  };
  // ambil phase dengan score tertinggi
}
```

### File yang Disentuh

- `public/room-state.js` — utama, hampir semua perubahan di sini
- `tests/room-state.test.mjs` — perlu update/tambah test buat coverage baru
- `public/room-schema.js` — mungkin tambah HINT_WEIGHTS dan SUMMARY_RULES di sini biar terpisah

### Test Strategy

Sebelum mulai, catat baseline behavior dari test suite yang ada (177 tests pass).
Setiap sub-item (1a, 1b, 1c, 1d, 1e) dikerjakan dan di-test secara terpisah.
Commit per sub-item supaya mudah rollback kalau ada regresi.

### Prompt buat Lanjut di Session Baru

```
Lanjut improvement item 1 dari docs/improvement-plan.md di repo rei-ops-room.
Mulai dari sub-item yang belum done.
Cek status di tabel di atas dulu sebelum mulai.
Jalankan test dulu: PATH="/opt/homebrew/bin:$PATH" node --test tests/*.test.mjs
```

---

## Item 2 — Upgrade `execute-bridge.mjs`

**File**: `tools/execute-bridge.mjs` (19KB)

Detail akan diisi setelah Item 1 selesai.

Gambaran awal:
- Logic claim issue terlalu greedy, perlu cooldown check
- Tidak ada retry backoff kalau run gagal
- Specialist profile selection masih sederhana

---

## Item 3 — Skill & Handoff Docs

**Path**: `raffi-agent-skill/references/daily-device-handoff.md` (di luar repo ini)

Detail akan diisi setelah Item 2 selesai.

Gambaran awal:
- Handoff format perlu lebih structured supaya DB Rei bisa parse lebih akurat
- Tambah section "blockers" dan "next_focus_zone" yang explicit
- Pertimbangkan format YAML front-matter buat machine-readable bagian atas

---

---

## Item 4 — Multi-LLM Runtime Abstraction

**Status**: ✅ Done — commit berikut setelah ini

**Motivasi**: execute-worker.mjs sebelumnya hardcode `codex exec` sebagai satu-satunya runtime.
Supaya Rei bisa pakai Claude Code CLI (atau runtime lain di masa depan), kita butuh abstraction layer.

### File yang dibuat/diubah

| File | Perubahan |
|---|---|
| `tools/runtimes/codex.mjs` | NEW — Codex runtime adapter |
| `tools/runtimes/claude-code.mjs` | NEW — Claude Code CLI runtime adapter |
| `tools/runtimes/index.mjs` | NEW — Registry, probe, select |
| `tools/execute-worker.mjs` | Tambah import runtimes, `runMission()` runtime-aware, `runExecuteWorker` probe di startup |
| `tools/execute-bridge.mjs` | `buildExecuteStartComment` terima `runtimeLabel`, tambah `selectRuntimeForProfile()` |
| `tests/runtimes.test.mjs` | NEW — full test coverage runtime layer |

### Runtime Interface

Tiap runtime adalah module yang export:

```js
export const RUNTIME_ID    = "codex";           // identifier unik
export const RUNTIME_LABEL = "Codex";           // human-readable
export async function resolveCommand({ env, fallback }) { ... }  // → path string
export function buildInvocation({ command, repoCwd, outputLastMessageFile }) { ... }
// buildInvocation return: { command, args, outputMode, stdinMode, cwd? }
// outputMode: "file" (Codex --output-last-message) | "stdout" (Claude Code)
```

### Routing Logic

```
RUNTIME_PREFERENCES = {
  scraping:  ["codex"],                   // butuh ~/.codex/skills (Playwright)
  frontend:  ["codex"],                   // butuh frontend-design skills
  backend:   ["claude-code", "codex"],    // reasoning-heavy → Claude Code lebih tepat
  docs:      ["claude-code", "codex"],    // writing-heavy → Claude Code lebih tepat
  general:   ["codex"],                   // default
}
```

`selectRuntime(profileId, availableRuntimes)` — ambil runtime pertama yang tersedia.
`probeAvailableRuntimes(env)` — cek binary. Absolute path → `fs.access`. Relative → trust PATH.

### Cara tambah runtime baru (misalnya Gemini)

1. Buat `tools/runtimes/gemini.mjs` dengan interface yang sama
2. Import dan masukkan ke `RUNTIME_LIST` di `tools/runtimes/index.mjs`
3. Tambah ke `RUNTIME_PREFERENCES` untuk profile yang cocok
4. Set env `GEMINI_BIN` kalau binary tidak di PATH

### Env overrides

| Env var | Runtime | Fungsi |
|---|---|---|
| `CODEX_BIN` | codex | Custom path ke Codex binary |
| `CLAUDE_BIN` | claude-code | Custom path ke `claude` binary |

### Prompt untuk lanjut di session baru

```
Lanjut dari docs/improvement-plan.md Item 4 di repo rei-ops-room.
Item 4 sudah selesai (multi-LLM runtime abstraction).
Yang belum:
- Item 5: Multi-worker coordinator (beberapa Rei jalan paralel, shared state)
- Item 6: Post-run learning loop (hasil run balik ke daily handoff)
Cek status tabel di atas dulu, lalu jalankan test:
node --test tests/runtimes.test.mjs
node --test tests/execute-worker.test.mjs
```

---

## Item 5 — Multi-Worker Coordinator (planned)

Memungkinkan beberapa `execute-worker` instance jalan paralel tanpa double-claim.

Gambaran:
- Shared state file `.execute-workers.json` berisi array worker aktif
- Tiap worker register `{ workerId, issueNumber, runtimeId, startedAt }`
- Room visualization baca file ini → tampilkan berapa Rei aktif
- Atomic claim pakai file lock atau staggered startup

---

## Item 6 — Post-run Learning Loop (planned)

Setelah tiap execute run selesai, extract otomatis:
- File apa yang disentuh
- Apa yang berhasil / gagal
- Hasilnya masuk ke daily handoff berikutnya

Ini yang bikin Rei makin pinter tiap sesi — bukan reset dari nol.

---

*Last updated: 2026-04-07 — Item 4 selesai ✅, Item 5 & 6 planned*
