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

## Item 5 — Taiou: Direct Task Queue + Webhook + Multi-Worker

**Status**: ✅ Done (+ cross-platform patch — see Item 5a below)

**Motivasi**: Rei sebelumnya pure pull-based (polling GitHub 60s).
Item ini menambah kemampuan Rei untuk di-"taiou" — menerima task dari luar tanpa perlu buat GitHub issue,
dan bereaksi secara real-time via webhook.

### File yang dibuat/diubah

| File | Perubahan |
|---|---|
| `tools/execute-queue.mjs` | NEW — task queue + workers registry (file-persisted) |
| `server.mjs` | NEW routes: POST /api/execute/submit, GET /api/execute/queue, GET /api/execute/workers, POST /api/github/webhook |
| `tools/execute-worker.mjs` | Poll direct queue sebelum GitHub, register worker, SIGUSR1 wake-up |
| `tools/execute-bridge.mjs` | `buildDirectTaskPrompt()` untuk non-GitHub tasks |
| `tests/execute-queue.test.mjs` | NEW — 21 tests |

### Cara kirim task langsung ke Rei

```bash
curl -X POST http://localhost:4317/api/execute/submit \
  -H "Content-Type: application/json" \
  -d '{"task": "review auth.js dan cari potensi bug", "runtimeId": "claude-code"}'
```

Response:
```json
{ "status": "queued", "task": { "id": "...", "status": "queued" }, "workerWoken": true }
```

Worker langsung terbangun dan proses task tanpa tunggu 60s interval.

### GitHub Webhook

```
POST /api/github/webhook
Header: X-Hub-Signature-256: sha256=<hmac>  (optional, set GITHUB_WEBHOOK_SECRET)
Header: X-GitHub-Event: issues
```

Saat issue di-label `agent:rei` atau `mode:execute` → worker di-wake.

### Multi-worker registry

Tiap worker instance register ke `.execute-workers.json`:
```json
{ "workers": [{ "workerId": "a1b2c3d4", "pid": 12345, "runtimeId": "codex", "currentTaskId": null }] }
```

`GET /api/execute/workers` — baca dari UI atau tools lain.

### Queue priority

```
Loop tiap 60s (atau langsung kalau di-wake):
  1. Cek .execute-queue.json (direct tasks) — priority tinggi
  2. Cek GitHub issues (mode:execute) — priority normal
```

### Prompt untuk lanjut di session baru

```
Lanjut dari docs/improvement-plan.md di repo rei-ops-room.
Item 1–5 sudah selesai. Yang belum: Item 6 (post-run learning loop).
Jalankan test dulu: node --test tests/*.test.mjs
```

---

## Item 6 — Post-run Learning Loop

**Status**: ✅ Done — commit berikut setelah ini

**Motivasi**: Setelah tiap run, Rei "lupa" apa yang baru dikerjakan.
Run berikutnya mulai dari nol — tidak ada konteks "kemarin issue #38 gagal karena anti-bot".
Item ini bikin Rei makin pinter tiap sesi.

### File yang dibuat/diubah

| File | Perubahan |
|---|---|
| `tools/execute-learning.mjs` | NEW — learning log (record, format, getLearningContext) |
| `tools/execute-worker.mjs` | `recordRunInsight()` setelah tiap GitHub issue run + direct task |
| `tools/execute-bridge.mjs` | `getLearningContext()` di `prepareExecuteAction`, inject ke semua `buildExecutePrompt` calls + `buildDirectTaskPrompt` |
| `tests/execute-learning.test.mjs` | NEW — 20 tests |
| `.gitignore` | tambah `.execute-queue.json`, `.execute-workers.json`, `.execute-learning.json` |

### Yang dicatat per run

```js
{
  date, recordedAt,
  issueNumber,       // null untuk direct task
  taskTitle,
  runtimeId,         // "codex" | "claude-code"
  outcome,           // "completed" | "review_needed" | "failed" | "aborted"
  filesChanged,      // array path relatif
  keySummary         // baris pertama substantif dari last message
}
```

### Yang di-inject ke prompt

```
Recent run history (use to avoid repeating past mistakes):
- [2026-04-07] completed #42 "fix auth bug" (claude-code) — changed: auth.js, auth.test.js
    ↳ Fixed JWT expiry issue in middleware.
- [2026-04-06] review_needed #38 "scrape target" (codex) — no file changes
```

Max 50 entries, auto-trim yang paling lama. 5 entries terbaru di-inject ke prompt.

### Prompt untuk lanjut di session baru

```
Semua item di docs/improvement-plan.md sudah selesai (Item 1–6).
Jalankan test: node --test tests/*.test.mjs
Kalau mau lanjut, cek bagian "What's missing" di overview untuk ide berikutnya.
```

---

## Item 5a — Cross-platform Wake-up Fix (Windows support)

**Status**: ✅ Done

**Motivasi**: SIGUSR1 tidak tersedia di Windows (`process.kill(pid, 'SIGUSR1')` throw).
Mekanisme wake-up sebelumnya hanya pakai SIGUSR1 → worker tidak bisa di-wake di Windows.

### Solusi: Dual-mechanism

```
signalWorkerWake():
  1. Tulis .execute-wake.trigger (cross-platform, SELALU jalan)
  2. Kirim SIGUSR1 ke worker PID (fast-path Unix — error diabaikan di Windows)

sleepWithSignal(ms, signal):
  Loop tiap 2s:
    a. Cek AbortSignal → throw AbortError
    b. Cek .execute-wake.trigger → kalau ada, hapus dan return (bangun)
    c. await Promise dengan timer 2s, bisa di-interrupt SIGUSR1 (Unix fast-path)
```

### File yang diubah

| File | Perubahan |
|---|---|
| `tools/execute-queue.mjs` | `signalWorkerWake()` → tulis trigger file dulu; `checkAndClearWakeTrigger()` NEW |
| `tools/execute-worker.mjs` | `sleepWithSignal()` → polling loop 2s + cek trigger file; `wakeResolve` dipindah ke sebelum fungsi |
| `.gitignore` | tambah `.execute-wake.trigger` |
| `tests/execute-queue.test.mjs` | +5 tests: trigger file create/check/clear/idempotent |

### Trigger file path

`.execute-wake.trigger` — di project root, excluded dari git.

---

*Last updated: 2026-04-06 — Item 1–6 + 5a (cross-platform fix) ✅*
