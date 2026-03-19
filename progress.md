Original prompt: Day 1 movement overhaul for Rei Ops Room so the squad feels like a living mini office instead of agents only orbiting their desks.

## 2026-03-19

Status: Day 1 core movement pass complete.

### Completed
- Added hallway-aware routing in [/Users/funtoco/workSpace/codex-pixel-agent/public/room-engine.js](/Users/funtoco/workSpace/codex-pixel-agent/public/room-engine.js) so split routes and scout handoffs travel through shared room space instead of direct desk-to-desk arcs.
- Added wider observation loops for idle support agents, so `idle_observe` actors roam through hallway anchors instead of pacing inside tiny desk circles.
- Added explicit seat metadata per desk plus seat-return behavior, so workers and observers now have a concrete desk seat to settle back into.
- Added lightweight actor movement grammar in [/Users/funtoco/workSpace/codex-pixel-agent/public/room-engine.js](/Users/funtoco/workSpace/codex-pixel-agent/public/room-engine.js):
  - `HUDDLE`
  - `WALK`
  - `SEATED`
  - `WANDER`
  - `RETURN`
  - `REST`
- Added actor pose output (`walk`, `sit`, `type`, `read`, `carry`) and used it in [/Users/funtoco/workSpace/codex-pixel-agent/public/app.js](/Users/funtoco/workSpace/codex-pixel-agent/public/app.js) so settled desk work reads more like seated typing/reading than generic standing sprites.
- Fixed phase inference in [/Users/funtoco/workSpace/codex-pixel-agent/public/room-state.js](/Users/funtoco/workSpace/codex-pixel-agent/public/room-state.js) so real runtime activity can break the room out of `planning_huddle`.
- Added server fallback logic in [/Users/funtoco/workSpace/codex-pixel-agent/server.mjs](/Users/funtoco/workSpace/codex-pixel-agent/server.mjs) to use recent global runtime logs when thread-scoped logs are mostly noise.
- Split runtime truth from scene storytelling more clearly:
  - `room.focus_zone` remains the inferred owner lane
  - `scene.active_zone` drives the visible scene emphasis
  - `scene.assignment_hint` gives a planning-only next desk hint
- Fixed workspace dock semantics in [/Users/funtoco/workSpace/codex-pixel-agent/public/room-state.js](/Users/funtoco/workSpace/codex-pixel-agent/public/room-state.js):
  - workspace-like repo names are normalized consistently
  - stale dormant repo rooms no longer stay pinned as `Active Room`
  - when the room is `standby/idle`, the dock falls back to `Workspace Hub` and old repos move into `Sleeping Room`

### Verification
- `npm test` -> 68/68 passing
- `node --check public/room-engine.js`
- `node --check public/app.js`
- Live smoke test on `http://localhost:4317/?mode=room`

### What Still Feels Off
- Live viewer truth is still easy to contaminate with QA commands from the active Codex session, so `Current Objective` and `Last Finished` can reflect my verification steps instead of the higher-level task.
- Focus inference can still lean too hard on stale thread history when current commands are generic.
- Poses are now better than before, but they are still sprite-block approximations; if we want stronger readability later, sprite sheets or richer chair/desk props are the next step.

### Next Best Moves
- Filter or de-prioritize self-QA commands from objective/runtime cards so the room shows the user's task more often than my verification plumbing.
- Deepen the movement grammar from route-based states into timed micro-behaviors:
  - `look around`
  - `pause at screen`
  - `stand up`
  - `switch desk side`
  - `handoff linger`
- Move layout primitives into JSON schema so we can grow toward an office editor without hardcoding every coordinate.
- Evaluate sprite-sheet support after the current movement grammar feels stable in daily use.
