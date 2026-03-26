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
