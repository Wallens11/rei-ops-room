# Rei Ops Room

Viewer kecil buat nampilin repo/thread Codex terbaru dengan `pixel room`, squad mini-Rei, mode room/widget, dan state kerja vs istirahat.

## Office Editor

Di mode `room`, klik `Layout Edit` buat masuk ke editor layout lokal.

- pilih desk / prop / rest corner yang mau digeser
- geser pakai tombol panah atau keyboard arrow key
- `Save Local` buat simpan layout ke browser/device itu
- `Reset` buat balik ke schema default
- `Export JSON` / `Import JSON` buat pindah layout antar device

## Jalankan

```bash
cd /Users/funtoco/workSpace/codex-pixel-agent
npm install
npm start
```

Buka `http://localhost:4317`.

Atau pakai launcher lokal di dalam repo:

```bash
cd /Users/funtoco/workSpace/codex-pixel-agent
./agent-pixel room
./agent-pixel widget
./agent-pixel status
./agent-pixel stop
```

Kalau masih pakai wrapper dari workspace root:

```bash
/Users/funtoco/workSpace/agent-pixel room
/Users/funtoco/workSpace/agent-pixel widget
/Users/funtoco/workSpace/agent-pixel status
/Users/funtoco/workSpace/agent-pixel stop
```

## Sumber data

- `~/.codex/state_5.sqlite`: thread terbaru, cwd, branch
- `~/.codex/logs_1.sqlite`: activity log terbaru buat state busy/idle

## GitHub Inbox MVP

Viewer sekarang juga punya endpoint inbox ringan buat baca issue GitHub repo ini:

```bash
curl http://localhost:4317/api/github/issues
```

Di mode `room`, panel `GitHub Inbox` juga akan poll endpoint ini otomatis setiap `30s` buat nampilin antrean issue remote langsung di viewer.

Panel inbox sekarang juga punya planner konservatif:

- `Active Queue` diambil dari issue berlabel `status:in_progress`
- `Suggested Next` fallback ke issue `status:todo` terbaru kalau belum ada yang aktif
- `Report-only Bridge` preview menampilkan issue aktif yang siap dikomentari
- `Execute Agent` menampilkan antrean `mode:execute` dan bisa start/stop executor lokal
- `Autopilot` bisa diaktifkan manual dari viewer untuk auto-post sekali per issue aktif
- `Service` menampilkan apakah background report-only worker sedang hidup di device ini

Perilaku default:

- repo diambil dari `git remote get-url origin`
- state default `open`
- label default `agent:rei`
- limit default `20`

Query yang didukung:

- `repo=owner/name`
- `state=open|closed|all`
- `labels=agent:rei,status:in_progress`
- `limit=50`

Contoh:

```bash
curl "http://localhost:4317/api/github/issues?labels=agent:rei,status:todo&limit=10"
```

Catatan:

- endpoint ini butuh `gh` CLI yang sudah login
- response sudah merangkum jumlah `todo`, `inProgress`, dan `blocked` supaya nanti gampang dipakai buat panel inbox / automation

## Report-only Bridge

Bridge konservatif buat issue aktif `status:in_progress`:

```bash
npm run report-only
```

Kalau mau langsung post comment plan ke issue aktif:

```bash
npm run report-only -- --comment
```

Perilaku default:

- hanya ambil issue aktif yang punya `agent:rei` + `mode:report_only`
- comment diberi marker dedupe supaya tidak spam issue yang sama
- output tetap berhenti di draft / report, bukan auto-eksekusi code

Di viewer:

- tombol `Post Plan Comment` akan post comment sekali lalu pindah ke state `Already Posted`
- tombol `Enable Autopilot` bersifat opt-in dan hanya auto-post untuk issue aktif yang masih `ready`
- status autopilot disimpan per session browser supaya reload tidak langsung kehilangan state device itu

## Report-only Worker

Kalau viewer lagi tidak terbuka tapi tetap mau pickup issue aktif secara konservatif:

```bash
npm run report-only-worker -- --once
```

Untuk mode background polling:

```bash
npm run report-only-worker
```

Flag yang didukung:

- `--once` untuk satu kali cek lalu keluar
- `--repo owner/name` untuk override repo target
- `--interval-seconds 90` untuk interval custom

Perilaku default:

- interval minimum dijaga konservatif (`30s`), default `60s`
- worker hanya reuse bridge `report-only` yang sama
- log hanya keluar saat status berubah, jadi skip yang sama tidak spam terus
- dedupe issue tetap ditentukan marker comment yang sudah ada

## Report-only Service

Kalau mau worker background-nya gampang dikelola lintas shell / device session:

```bash
npm run report-only-service -- start
npm run report-only-service -- status
npm run report-only-service -- stop
```

Catatan:

- service ini cuma wrapper lokal untuk `report-only-worker`
- pid disimpan di `.report-only-worker.pid`
- log append ke `.report-only-worker.log`
- `status` akan bilang kalau pid file-nya stale, jadi tidak pura-pura worker masih hidup

## Execute Agent

Mode ini buat issue yang memang boleh dijalankan agent secara lokal.

Label yang dipakai:

- `agent:rei`
- `mode:execute`
- `status:todo` untuk antrean baru
- `status:in_progress` saat sudah diklaim executor
- `status:blocked` kalau run gagal dan butuh intervensi

Perilaku default:

- execute queue hanya melihat issue `mode:execute`
- saat service hidup, issue `status:todo` berikutnya akan diklaim ke `status:in_progress`
- worker akan launch `codex exec` dari repo ini, pakai issue body + daily handoff sebagai context awal
- saat sukses, worker akan comment ringkasan hasil lalu close issue
- saat gagal, worker akan comment hasil terakhir lalu pindahkan issue ke `status:blocked`

Di viewer:

- panel `Execute Agent` akan bilang apakah queue siap jalan, lagi running, atau idle
- tombol `Start Agent` menyalakan executor lokal
- tombol `Stop Agent` menghentikan watcher lokal setelah sinyal stop dikirim ke worker aktif

## Execute Service

Kalau mau executor queue dikelola lintas shell / device session:

```bash
npm run execute-service -- start
npm run execute-service -- status
npm run execute-service -- stop
```

Catatan:

- service ini wrapper lokal untuk `execute-worker`
- pid disimpan di `.execute-worker.pid`
- log append ke `.execute-worker.log`
- state aktif disimpan di `.execute-worker-state.json`
- artifact per run ditulis ke `.execute-runs/`

## Jalan Di Laptop Lain

1. Clone repo ini.
2. Pastikan ada `node` dan CLI `sqlite3`.
3. Pastikan mesin itu juga punya folder `~/.codex/` dengan `state_5.sqlite` dan `logs_1.sqlite`.
4. Masuk ke repo lalu jalankan:

```bash
npm install
./agent-pixel room
```

Kalau file Codex kamu ada di lokasi lain, set env sebelum jalan:

```bash
CODEX_HOME=/path/to/.codex ./agent-pixel room
```

## Catatan

- Kalau workspace aktif masih root `/Users/funtoco/workSpace`, panel `Last Specific Repo` bantu nunjukin repo terakhir yang lebih spesifik.
- Zona fokus room dipilih dari thread title, cwd, branch, dan activity terbaru yang lolos filter observer.
- Office editor sekarang cuma ngubah posisi zone/prop/rest secara aman di atas schema layout; movement logic tetap ngikut anchor yang ikut bergeser.
- Tool observasi seperti Playwright viewer check tidak dihitung sebagai kerja utama.
- `Scout Rei` cuma bergerak saat ada handoff yang berarti.
- Skill Codex tidak otomatis “ter-update” dari app ini; app ini membaca runtime Codex, bukan menulis balik ke skill.
