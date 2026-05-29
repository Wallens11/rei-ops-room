# Contributing to Rei Ops Room

Thanks for your interest in contributing. This guide covers everything you need to go from zero to a merged pull request.

---

## Table of Contents

- [Dev setup](#dev-setup)
- [Project structure](#project-structure)
- [Running tests](#running-tests)
- [Making changes](#making-changes)
- [Submitting a PR](#submitting-a-pr)
- [Reporting bugs](#reporting-bugs)
- [Code style](#code-style)
- [Questions](#questions)

---

## Dev setup

```bash
git clone https://github.com/<your-fork>/rei-ops-room
cd rei-ops-room
npm install

# Copy the example config and edit it
cp rei.config.json.example rei.config.json
```

**Optional — connect a GitHub token** for real issue data:

```bash
export GITHUB_TOKEN=ghp_...
```

**Try it without any credentials** using demo mode:

```bash
DEMO_MODE=true npm start
# open http://localhost:4317
```

Node.js ≥ 22 is required. No other build step needed — everything is plain ESM.

---

## Project structure

```
server.mjs              HTTP server + API endpoints
tools/
  execute-bridge.mjs    Prompt builder + GitHub issue planner
  execute-worker.mjs    Long-running agent loop
  execute-queue.mjs     Direct task queue + worker registry
  execute-learning.mjs  Run outcome tracker (learning log)
  rei-memory.mjs        Persistent BM25 memory bank
  rei-cost-tracker.mjs  Token / USD accounting
  rei-self-review.mjs   Diff sanity gate
  rei-personality.mjs   Mood + energy derivation
  rei-narration.mjs     Agent thought stream
  rei-chat.mjs          Bidirectional operator chat
  rei-codebase-graph.mjs  Repo symbol + import indexer
  rei-prompt.mjs        Professional system prompt composer
  rei-webhooks.mjs      Slack / Discord / generic notifications
  runtimes/             Claude Code + Codex runtime adapters
public/
  index.html            UI shell
  app.js                Canvas renderer (pixel art scene)
  styles.css            All styles
  rei-brain-panel.js    Memory / cost / mood panel
  rei-chat-panel.js     Live chat widget
tests/
  *.test.mjs            All unit tests (Node built-in test runner)
```

### How memory works

Rei stores persistent memory in `.rei-memory/knowledge.jsonl`.
That file is append-only during normal writes, with one JSON entry per line.
Memory search uses BM25-style keyword scoring: no embeddings and no API key.
Entries are typed as `fact`, `pattern`, `decision`, `warning`, or `solution`.
When the file grows past 1000 entries, Rei auto-compacts it.
Compaction keeps the most important and recent entries so retrieval stays fast.

---

## Running tests

```bash
npm test
```

The test suite uses Node's built-in test runner — no extra packages needed. All 494 tests should be green before you open a PR.

**Running a single test file:**

```bash
node --test tests/execute-bridge.test.mjs
```

**Writing new tests** — add a `tests/<module>.test.mjs` file. Follow the existing pattern:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { myFunction } from "../tools/my-module.mjs";

test("description of what it does", () => {
  assert.equal(myFunction(input), expected);
});
```

---

## Making changes

Before starting work on something non-trivial, open an issue first so we can align on approach. Saves everyone time.

**Good contributions:**

- Bug fixes with a failing test that proves the fix
- New runtime adapters (see `tools/runtimes/` for the shape)
- Additional webhook platforms (see `tools/rei-webhooks.mjs`)
- UI improvements to the canvas scene or panels
- Better memory extraction heuristics in `rei-memory.mjs`
- Docs and README improvements

**Out of scope (for this repo):**

- Switching to TypeScript (by design — plain ESM keeps the install lightweight)
- Framework dependencies (React, Vue, etc.) in the UI
- Anything that requires a cloud service to run in basic mode

**When editing the prompt** (`tools/rei-prompt.mjs`):
The core principles are the agent's operating contract. Changes there affect every run. Please include at least one test that verifies the new behaviour and a note in the PR explaining the reasoning.

---

## Submitting a PR

1. Fork the repo and create a branch: `git checkout -b feat/my-thing`
2. Make your changes
3. Run `npm test` — all tests must pass
4. Run `node --check <files you changed>` to catch syntax errors
5. Open a PR against `main` with a short description of what and why

**PR checklist:**

- [ ] `npm test` passes (494+ tests green)
- [ ] New behaviour is covered by at least one test
- [ ] No new external `npm` dependencies added without discussion
- [ ] Commit messages are descriptive (`feat:`, `fix:`, `refactor:` prefix)
- [ ] No secrets, API keys, or personal paths left in the code

---

## Reporting bugs

Open an issue with:

- What you expected to happen
- What actually happened
- Minimal reproduction steps (command + config if relevant)
- Node.js version (`node --version`)
- OS

---

## Code style

- **ESM only** — `import`/`export`, no `require()`
- **No build step** — files are run directly by Node
- **`node:` prefix** on all built-in imports (`import fs from "node:fs/promises"`)
- **Comments explain *why***, not *what*
- **Best-effort** for async errors that shouldn't crash the worker — use `.catch(() => {})` sparingly and only when truly non-fatal
- **No `console.log`** left in production paths — use `narrate()` for agent thoughts, the worker's log stream for debug output

---

## Questions

Open a GitHub Discussion or drop a comment on any relevant issue. We're happy to help orient you.
