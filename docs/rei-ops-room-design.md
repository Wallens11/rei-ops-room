# Rei Ops Room Design

## Goal

Bangun `pixel room` yang menunjukkan:

1. Rei lagi ngerjain apa
2. Rei lagi kerja di repo / area mana
3. apakah Rei kerja solo atau lagi kebagi ke beberapa sub-agent
4. progress visual yang enak dilihat, bukan sekadar dashboard statis

Visual harus terasa seperti `mini squad di ruang kerja`, bukan panel admin yang ditempeli pixel art.

## Core Idea

Ada satu `Ops Room` berisi beberapa mini-Rei. Mereka tidak cuma idle muter terus, tapi punya `phase` kerja yang jelas:

1. `planning_huddle`
   Semua agent kumpul di meja tengah. Ini dipakai saat request baru masuk, saat masih mikir strategi, atau saat scope belum jelas.
2. `squad_split`
   Lead Rei memecah tugas. Agent mulai bergerak ke meja masing-masing.
3. `heads_down`
   Agent fokus stay di meja kerja area masing-masing. Animasi kecil tetap ada, tapi tidak keliling tanpa alasan.
4. `review_wrap`
   Semua hasil dikumpulkan, dicek, lalu room masuk mode selesai / standby.

## Agent Roster

### 1. Lead Rei

- Role: coordinator / planner / integrator
- Zone default: `lab`
- Tugas:
  - baca intent user
  - tentukan perlu solo work atau `spawn_agent`
  - pilih focus zone utama
  - pecah tugas ke agent lain
  - gabungkan hasil
  - ubah phase room

### 2. UI Rei

- Role: frontend / design / interaction worker
- Zone default: `frontend`
- Tugas:
  - layout
  - animation
  - room visuals
  - widget mode
  - interaction polish

### 3. API Rei

- Role: backend / tooling / orchestration worker
- Zone default: `backend`
- Tugas:
  - server
  - logs parsing
  - data aggregation
  - CLI activation
  - process / session mapping

### 4. DB Rei

- Role: data / storage / timeline worker
- Zone default: `database`
- Tugas:
  - Codex state DB parsing
  - logs DB parsing
  - thread / job / activity mapping
  - heuristics untuk focus zone dan phase

### 5. Docs Rei

- Role: review / docs / handoff worker
- Zone default: `review`
- Tugas:
  - summarize activity
  - clean labels
  - review states
  - human-readable explanations
  - handoff docs for user / ChatGPT

### 6. Scout Rei

- Role: messenger / observer / context courier
- Zone default: `lab`
- Tugas:
  - bawa context dari briefing table ke desk aktif
  - visual bridge antar phase
  - muncul saat sub-agent aktif
  - bantu bikin room terasa hidup

## Recommended Spawn Policy

### Solo Mode

Pakai Lead Rei saja kalau:

- task kecil
- cuma satu domain
- tidak butuh parallel work

### Multi-Agent Mode

Pakai `spawn_agent` kalau:

- user request jelas butuh frontend + backend
- ada implementasi + review
- ada eksplorasi + implementasi paralel
- ada beberapa repo atau beberapa concern berbeda

### Mapping Spawn ke Room

- tidak ada spawn: cuma Lead Rei / focus agent aktif
- 1 worker spawn: focus agent + Scout Rei aktif
- 2-3 worker spawn: room masuk `squad_split`, beberapa agent benar-benar bergerak ke desk mereka
- selesai integrasi: semua kembali ke `review_wrap`

## Agent Responsibilities by Phase

### planning_huddle

- Lead Rei: aktif bicara di meja tengah
- UI Rei: hadir di meeting
- API Rei: hadir di meeting
- DB Rei: hadir di meeting
- Docs Rei: hadir di meeting
- Scout Rei: standby di tengah

Visual:

- semua agent kumpul
- ada bubble seperti `planning`, `briefing`, `scope check`
- belum ada desk yang benar-benar disorot

### squad_split

- Lead Rei: assign work
- focus agent: bergerak duluan ke desk target
- agent lain: mulai pindah ke desk masing-masing
- Scout Rei: antar context ke desk aktif

Visual:

- room terasa transisi
- ada movement antar meja
- label phase jelas

### heads_down

- focus agent: stay di desk, animasi kerja kecil
- agent lain: idle di desk masing-masing
- Scout Rei: hanya bergerak jika ada handoff / tool activity / spawned worker
- Lead Rei: bisa balik ke lab atau muncul sebagai observer

Visual:

- kalau `db`, DB Rei beneran stay di meja DB
- kalau `frontend`, UI Rei stay di meja frontend
- jangan semua muter terus

### review_wrap

- Docs Rei jadi lebih aktif
- Lead Rei kumpulkan hasil
- semua agent bisa kembali mendekat ke meja tengah

Visual:

- room lebih calm
- bubble seperti `review`, `merge`, `handoff`

## System Prompt Per Agent

### Lead Rei System Prompt

```text
You are Lead Rei, the coordinator for the Rei Ops Room.
Your job is to read the user's request, classify the work, decide whether the task should stay solo or split into sub-agents, assign focus zones, and integrate final results.
You optimize for clarity, momentum, and believable visual state transitions in the room.
When the task is unclear, keep the room in planning_huddle.
When work is split, move the room into squad_split.
When a concrete owner is known, move to heads_down and keep the owner at the correct desk.
```

### UI Rei System Prompt

```text
You are UI Rei, responsible for frontend, visuals, layout, animation, interaction polish, and widget presentation.
You own anything related to the room scene, canvas drawing, motion language, labels on screen, and how the visualization feels.
You should prefer expressive but readable visuals over generic dashboard UI.
```

### API Rei System Prompt

```text
You are API Rei, responsible for orchestration code, server behavior, CLI activation, process control, and event wiring.
You translate system activity into structured room state.
You focus on reliability, activation ergonomics, and the connection between the viewer and Codex runtime signals.
```

### DB Rei System Prompt

```text
You are DB Rei, responsible for state extraction and interpretation from local Codex databases and logs.
You read threads, logs, timing, repo paths, and activity traces to infer focus, confidence, and phase transitions.
You prefer deterministic rules first and heuristics second.
```

### Docs Rei System Prompt

```text
You are Docs Rei, responsible for review, copy, labels, summaries, handoff text, and human-readable explanations.
You rewrite technical states into short labels that feel intentional and easy to understand.
You prevent the room from sounding generic, stiff, or dashboard-like.
```

### Scout Rei System Prompt

```text
You are Scout Rei, the visual messenger of the Rei Ops Room.
Your job is not to own the main implementation but to make coordination visible.
You move between the planning table and active desks, carry context, and signal when work has been delegated or handed off.
You exist to make the room feel alive and understandable at a glance.
```

## Workflow / Sequence

### Sequence A: Normal Solo Task

1. user sends request
2. Lead Rei reads intent
3. room enters `planning_huddle`
4. Lead Rei chooses one focus zone
5. room enters `heads_down`
6. focus agent stays at desk and works
7. room enters `review_wrap`
8. back to standby

### Sequence B: Multi-Agent Task

1. user sends request
2. Lead Rei reads request and decides split is useful
3. room enters `planning_huddle`
4. Lead Rei allocates work to UI Rei / API Rei / DB Rei / Docs Rei
5. room enters `squad_split`
6. agents move to desks
7. active workers stay there during `heads_down`
8. Scout Rei moves between active desks when handoff happens
9. Lead Rei integrates results
10. room enters `review_wrap`

### Sequence C: Spawn-Agent Visualization

1. `spawn_agent` or parallel worker pattern detected
2. phase becomes `squad_split`
3. matching desk agents wake up
4. if one worker becomes dominant, that desk is the active focus
5. once sub-agent work settles, room becomes `heads_down`
6. after integration, room moves to `review_wrap`

## State Inference Rules

### Focus Zone Heuristic

Input signals:

- thread title
- current cwd
- branch
- activity summary
- recent logs
- recent repo context

Output:

- `frontend`
- `backend`
- `database`
- `review`
- `lab`

### Phase Heuristic

#### planning_huddle

Trigger if:

- intent still broad
- low confidence focus
- thread title / activity contains `plan`, `brief`, `outline`, `brainstorm`, `spec`

#### squad_split

Trigger if:

- `spawn_agent`
- `subagent`
- `parallel`
- `worker`
- delegation / multi-thread pattern detected

#### heads_down

Trigger if:

- focus zone confidence is medium/high
- no clear delegation event right now
- one dominant desk owner is known

#### review_wrap

Trigger if:

- task integration / summary / verification phase
- recent activity contains review-ish patterns

## Visual Rules

### Required

- active focus agent should stop wandering and actually work at the desk
- meeting phase should visually gather everyone in the middle
- split phase should visibly move agents to desks
- Scout Rei should be the only one allowed to move cross-zone often

### Avoid

- everyone looping forever with no meaning
- dashboard panels dominating the room
- overly generic labels
- title/copy that sounds like placeholder product UI

## Better Naming Direction

Avoid:

- `Pixel room yang nunjukin squad kecilku lagi kerja di mana`

Prefer:

- `Rei Ops Room`
- `Lihat Rei lagi ngerjain apa`
- `Repo, task, dan squad yang lagi aktif`
- `Rei lagi fokus di mana`

Suggested headline:

`Lihat Rei lagi ngerjain apa, di repo mana, dan siapa yang lagi bantu.`

## Suggested Data Model

```yaml
room:
  title: "Rei Ops Room"
  phases:
    - planning_huddle
    - squad_split
    - heads_down
    - review_wrap
  focus_zone: frontend
  phase: heads_down
  status: busy

agents:
  - id: lead
    display_name: "Lead Rei"
    zone: lab
    role: coordinator
    state: planning
  - id: frontend
    display_name: "UI Rei"
    zone: frontend
    role: frontend_worker
    state: active
  - id: backend
    display_name: "API Rei"
    zone: backend
    role: backend_worker
    state: idle
  - id: database
    display_name: "DB Rei"
    zone: database
    role: data_worker
    state: idle
  - id: review
    display_name: "Docs Rei"
    zone: review
    role: review_worker
    state: idle
  - id: scout
    display_name: "Scout Rei"
    zone: lab
    role: courier
    state: moving

events:
  - trigger: "new_user_request"
    next_phase: planning_huddle
  - trigger: "spawn_agent_detected"
    next_phase: squad_split
  - trigger: "focus_confident"
    next_phase: heads_down
  - trigger: "integration_detected"
    next_phase: review_wrap
```

## Brush-Up Request for ChatGPT

Kalau file ini mau dilempar ke ChatGPT lain, minta dia fokus ke:

1. bikin room terasa lebih cinematic dan less dashboard-like
2. bikin phase transition lebih jelas dan satisfying
3. mapping `spawn_agent` ke visual agent yang lebih nyata
4. usul naming / copy yang lebih cool
5. usul arsitektur event-driven supaya state room lebih akurat

Prompt singkat yang bisa dipakai:

```text
Please improve this Rei Ops Room design.
The goal is a pixel-art operations room that shows what Rei is working on, which repo/area is active, whether work is split across sub-agents, and what phase the squad is in.
I want the visualization to feel alive and cinematic, not like a dashboard with pixel art on top.
Please improve:
1) agent roster and responsibilities,
2) system prompts,
3) room phases and transitions,
4) event/state architecture,
5) visual storytelling.
Keep the idea of planning_huddle -> squad_split -> heads_down -> review_wrap.
```
