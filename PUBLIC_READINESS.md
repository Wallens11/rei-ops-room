# Public Readiness Audit

Audit date: 2026-07-25

## Verdict

Rei Ops Room is ready for a public safe demo and local-first evaluation. It is
not a remotely exposed multi-user service: the API has no user authentication,
and live execution still requires each operator to configure GitHub, an AI
runtime, workspace permissions, and the explicit approval gate.

## What Was Verified

| Area | Result | Evidence |
|---|---|---|
| Safe Demo boot | Pass | Local server and Docker image both returned healthy demo state |
| Demo isolation | Pass | Status and live streams use injected demo data; codebase and write routes are blocked |
| Server exposure | Pass | Local and standalone demo servers bind to `127.0.0.1` by default |
| Configuration | Pass | Canonical config, legacy aliases, environment overrides, server, and worker CLIs agree |
| UI flows | Pass | Room/Widget, Layout Edit, Mission/Brain/Activity, command palette, and Safe Demo task rejection exercised in-browser |
| Responsive UI | Pass | 360px and 414px views had no horizontal overflow and no visible controls below 44px |
| Accessibility baseline | Pass with limits | Explicit labels, visible focus, reduced motion, touch targets, and canvas text equivalents |
| Worker self-review | Pass | Ignored protected files such as `.env` are detected by before/after hashing |
| Supply chain | Pass | Zero runtime npm dependencies and `npm audit --omit=dev` reported zero vulnerabilities |
| Test suite | Pass | 536 tests pass locally; CI runs the suite on Node.js 22 and 24 |
| Container | Pass | Public image runs as UID 1000, publishes `amd64`/`arm64` manifests, returns healthy demo state, and blocks protected reads |
| Public distribution | Pass | Repository visibility is public; secret scanning and push protection are enabled |

## Critical Findings Resolved

1. The HTTP server listened on all interfaces even though it announced a local
   URL. It now defaults to loopback; wider binding is explicit.
2. Demo SSE streams used live local readers and could expose real repository
   activity. Each stream now uses the data source injected into its server.
3. Demo endpoints could read local memory, chat, codebase, and run data. Safe
   fixtures now cover public read panels and sensitive reads/writes are blocked.
4. Setup, server, and workers disagreed on config keys. They now share one
   canonical contract with backward-compatible aliases.
5. Git and Docker build contexts did not fully exclude `.env` and operator state.
   Both ignore policies now cover those files.
6. The self-review gate relied on Git status, which misses ignored `.env` files.
   Protected paths now use before/after content hashes without flagging an
   unchanged pre-existing secret.
7. Direct Task submission treated Safe Demo's `403` response as success, cleared
   the user's input, and showed no feedback. It now preserves failed input and
   announces the server's read-only message inline.

## Product/UI Health

Impeccable score: **17/20 — Good**

| Dimension | Score | Notes |
|---|---:|---|
| Accessibility | 3/4 | Strong baseline; the interactive canvas is not a complete semantic scene |
| Performance | 3/4 | No build step or runtime dependencies; large monolithic UI/server files remain |
| Responsiveness | 3/4 | Desktop and phone flows verified; broader device matrix remains useful |
| Theming | 4/4 | Distinct night-studio visual system and consistent tokens |
| Anti-patterns | 4/4 | Avoids generic SaaS cards, fake swarms, glass effects, and decorative noise |

## Remaining Risks

- Live GitHub/runtime execution was not run end-to-end during this audit because
  it would mutate external issues and a real worktree. Unit and integration
  coverage passed, but each operator should run one approved low-risk issue
  before trusting unattended use.
- Binding beyond loopback without an authenticated reverse proxy is unsupported
  and unsafe.
- Google Fonts remain an external request. Self-hosting the licensed fonts is a
  reasonable offline/privacy improvement, but it is not required for the MVP.
- The interactive canvas has surrounding text equivalents, but full keyboard
  navigation for every scene hotspot remains backlog.
- Public visibility increases supply-chain and social-engineering exposure.
  Maintainers should keep releases review-gated, avoid running unreviewed
  contributor scripts, and continue monitoring secret-scanning alerts.

## Release Gate

Before publishing a release:

1. Run `npm test`, syntax checks, `npm audit --omit=dev`, and `git diff --check`.
2. Start Safe Demo and verify desktop plus 360px browser flows.
3. Build the Docker image and confirm `/api/health` and demo isolation.
4. Inspect the staged diff for tokens, personal paths, config, memory, chat, and
   runtime output.
5. Do not expose the API beyond loopback without authentication.
