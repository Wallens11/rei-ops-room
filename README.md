# Rei Ops Room

Autonomous agent ops room built on vanilla Node.js. Rei watches your GitHub issues, picks the right AI runtime, executes tasks, and reports back — all visible through a real-time web UI.

No framework. No heavy dependencies. Pure ESM.

![Rei Ops Room](public/demo.png)

```bash
# Try it instantly — no setup needed
DEMO_MODE=true npm start
# → http://localhost:4317
```

---

## What Rei Does

- **Picks up GitHub issues** labeled `agent:rei` + `mode:execute` and runs them autonomously
- **Routes to the right runtime** — Claude Code for frontend/docs, Codex for backend/scraping — configurable per task type
- **Falls back automatically** when a runtime hits rate limits
- **Resumes sessions** after crashes using Claude Code's `--resume` flag
- **Learns from history** — adaptive runtime selection based on actual success rates
- **Reacts to human corrections** — comments on an issue mid-run get injected into the next prompt
- **Generates visual artifacts** — HTML diagrams via the visual-explainer skill, surfaced in the UI
- **Wakes up instantly** on GitHub webhook events instead of waiting for the poll interval

---

## Quick Start

```bash
# 1. Clone and run the setup wizard
git clone https://github.com/Wallens11/rei-ops-room
cd rei-ops-room
./rei init       # interactive setup: config, GitHub labels, test connection

# 2. Start the ops room server
npm start
# → http://localhost:4317

# 3. Start the execute worker (in another terminal)
npm run execute-service -- start
```

### Launcher shortcuts

```bash
./rei room     # open ops room in browser
./rei status   # check if the server is running
./rei stop     # stop the server
./rei init     # run setup wizard again
```

### Docker

```bash
# Demo mode — no setup needed
docker run -p 4317:4317 -e DEMO_MODE=true ghcr.io/wallens11/rei-ops-room

# Live mode
docker run -p 4317:4317 \
  -e GITHUB_TOKEN=ghp_xxx \
  -e REI_REPO=owner/repo \
  ghcr.io/wallens11/rei-ops-room
```

---

## Requirements

- Node.js 20+
- GitHub access — either:
  - `GITHUB_TOKEN` env var (recommended, works in Docker / CI)
  - or `gh` CLI authenticated (`gh auth login`)
- At least one AI runtime:
  - [Claude Code](https://github.com/anthropics/claude-code) (`claude` in PATH)
  - [Codex](https://github.com/openai/codex) (`codex` in PATH or via `CODEX_BIN`)

---

## Configuration

Copy the example config and edit:

```bash
cp rei.config.json.example rei.config.json
```

`rei.config.json` (gitignored — see `rei.config.json.example` for all options):

```json
{
  "githubRepo": "your-org/your-repo",
  "workspaceRoot": "/path/to/your/workspace",
  "runtimes": ["claude-code", "codex"],
  "port": 4317,
  "githubWebhookSecret": "",
  "webhooks": {
    "slack": "",
    "discord": "",
    "events": "completed,failed,blocked"
  }
}
```

All fields can also be set via environment variables — env vars take priority over the config file.

### Runtime Routing

Create `.rei-runtimes.json` in the repo root to configure which runtime handles which task type:

```json
{
  "preferences": {
    "frontend": ["claude-code", "codex"],
    "backend":  ["codex", "claude-code"],
    "scraping": ["codex"],
    "docs":     ["claude-code", "codex"],
    "general":  ["codex", "claude-code"]
  },
  "rateLimitFallback": true
}
```

If the file is absent, the defaults above are used.

---

## GitHub Webhook (optional)

Point your GitHub repo's webhook to `http://your-server:4317/api/github/webhook`.

Set `githubWebhookSecret` in `rei.config.json` (or `GITHUB_WEBHOOK_SECRET` env var) to the same secret you set in GitHub. Leave it empty to skip signature verification in dev.

Rei wakes up the worker immediately on:
- Issue labeled with `agent:rei` or `mode:*`
- Issue assigned / unlabeled
- Issue comment created
- Any push
- Pull request merged

---

## Outbound Webhooks (Slack / Discord / generic)

Get pinged when Rei finishes (or fails) a run. Set any of these env vars:

```bash
export REI_SLACK_WEBHOOK_URL=https://hooks.slack.com/services/…
export REI_DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/…
export REI_WEBHOOK_URL=https://example.com/your-relay     # raw JSON POST
export REI_WEBHOOK_EVENTS=completed,failed,blocked        # default
```

Or put them under `webhooks:` in `rei.config.json`:

```json
{
  "webhooks": {
    "slack": "https://hooks.slack.com/services/…",
    "discord": "https://discord.com/api/webhooks/…",
    "events": "completed,failed,review_needed"
  }
}
```

Supported event kinds: `started`, `completed`, `failed`, `blocked`,
`review_needed`, `aborted`. Failures are swallowed — Rei never crashes
because Slack is down.

---

## GitHub Labels

Rei uses these labels to manage issue state:

| Label | Meaning |
|---|---|
| `agent:rei` | Issue belongs to Rei |
| `mode:execute` | Run code autonomously |
| `mode:report_only` | Post a plan comment only |
| `status:todo` | Queued, waiting to run |
| `status:in_progress` | Currently running |
| `status:blocked` | Run completed but needs human review |
| `status:done` | Completed successfully |

Run the setup wizard to create these labels automatically:

```bash
node setup.mjs
```

---

## Execute Service

```bash
npm run execute-service -- start    # start background worker
npm run execute-service -- status   # check worker status
npm run execute-service -- stop     # stop worker
```

The worker:
- polls GitHub every 60s (or wakes immediately on webhook events)
- claims the next `status:todo` issue, transitions it to `status:in_progress`
- launches Claude Code or Codex with the issue body + daily handoff as context
- posts a completion comment and transitions the label when done
- falls back to the next runtime if rate-limited
- resumes the last Claude Code session on the same issue after a crash

State files (all gitignored):
- `.execute-worker-state.json` — current worker state
- `.execute-queue.json` — task queue
- `.execute-learning.json` — run history for adaptive selection
- `.execute-sessions.json` — Claude Code session pins for crash recovery
- `.execute-runs/` — per-run artifacts (prompt, events, last message)

---

## Report-Only Service

For issues that should get a plan comment but not run code:

```bash
npm run report-only-service -- start
npm run report-only-service -- status
npm run report-only-service -- stop
```

---

## Visual Artifacts

When Claude Code uses the bundled `visual-explainer` skill, it generates self-contained HTML files in `~/.agent/diagrams/`. Rei scans for these after each run and surfaces them in the **Visual Outputs** panel in the UI.

Access directly:
```
GET /api/execute/artifacts
GET /api/execute/artifacts/:filename.html
```

---

## API Reference

| Endpoint | Description |
|---|---|
| `GET /api/status` | Server health |
| `GET /api/github/issues` | GitHub inbox |
| `GET /api/github/execute` | Execute queue preview |
| `GET /api/github/execute/service` | Worker status |
| `POST /api/github/execute/service` | Start / stop worker |
| `GET /api/execute/queue` | Direct task queue |
| `POST /api/execute/submit` | Submit a direct task |
| `GET /api/execute/metrics` | Agent performance metrics |
| `GET /api/execute/artifacts` | List HTML artifacts |
| `GET /api/execute/artifacts/:file` | Serve artifact HTML |
| `POST /api/github/webhook` | GitHub webhook receiver |
| `POST /api/inquiry/intake` | External inquiry intake |

---

## Architecture

```
rei-ops-room/
├── server.mjs              # HTTP server (all routes)
├── setup.mjs               # Interactive setup wizard
├── rei                     # Bash launcher (start/stop/status)
├── public/                 # Frontend (vanilla JS, no bundler)
│   ├── app.js
│   ├── execute-agent-view.js
│   ├── execute-metrics-panel.js
│   ├── execute-artifacts-panel.js
│   └── ...
├── tools/
│   ├── execute-worker.mjs      # Core execution loop
│   ├── execute-bridge.mjs      # GitHub → prompt builder
│   ├── execute-queue.mjs       # Multi-worker queue
│   ├── execute-learning.mjs    # Adaptive learning + metrics
│   ├── execute-sessions.mjs    # Claude session pinning
│   ├── execute-artifacts.mjs   # HTML artifact scanner
│   ├── inject-skills.mjs       # Skill installer for Claude Code
│   ├── rei-cli.mjs             # Server start/stop/status CLI
│   ├── rei-config.mjs          # Centralized config loader
│   ├── runtimes/               # Runtime adapters (claude-code, codex)
│   └── skills/                 # Bundled Claude Code skills
│       └── visual-explainer/
└── tests/                  # Node built-in test runner (409 tests)
```

---

## Development

```bash
# Run tests
npm test

# Run tests in watch mode (Node 22+)
node --test --watch tests/*.test.mjs
```

No build step. No transpilation. Edit and reload.
