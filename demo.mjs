#!/usr/bin/env node
/**
 * demo.mjs — Rei Ops Room demo mode entry point.
 *
 * Starts the ops room with fully simulated data — no GitHub auth,
 * no Claude/Codex runtime needed. Great for trying Rei instantly.
 *
 * Usage:
 *   npm run demo
 *   node demo.mjs
 *   node demo.mjs --port 8080
 */

import { createDemoServer } from "./tools/demo-server.mjs";

let port = Number(process.env.PORT || 4317);

for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] === "--port" && process.argv[i + 1]) {
    port = Number(process.argv[i + 1]);
  }
}

const server = createDemoServer();
server.listen(port, () => {
  process.stdout.write(`\n`);
  process.stdout.write(`  🎭 Rei Ops Room — Demo Mode\n`);
  process.stdout.write(`  ─────────────────────────────────────────\n`);
  process.stdout.write(`  → http://localhost:${port}\n`);
  process.stdout.write(`\n`);
  process.stdout.write(`  All data is simulated. No setup required.\n`);
  process.stdout.write(`  Press Ctrl+C to stop.\n`);
  process.stdout.write(`\n`);
});
