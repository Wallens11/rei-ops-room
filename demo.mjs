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

import path from "node:path";
import { fileURLToPath } from "node:url";

import { createDemoServer } from "./tools/demo-server.mjs";

export function startStandaloneDemoServer({
  port = Number(process.env.PORT || 4317),
  host = process.env.REI_HOST || "127.0.0.1",
  args = process.argv.slice(2)
} = {}) {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--port" && args[i + 1]) {
      port = Number(args[i + 1]);
    }
  }

  const server = createDemoServer();
  server.listen(port, host, () => {
    const address = server.address();
    const activePort = typeof address === "object" && address ? address.port : port;
    process.stdout.write(`\n`);
    process.stdout.write(`  🎭 Rei Ops Room — Safe Demo\n`);
    process.stdout.write(`  ─────────────────────────────────────────\n`);
    process.stdout.write(`  → http://${host}:${activePort}\n`);
    process.stdout.write(`\n`);
    process.stdout.write(`  Simulated data only. Local reads and writes are blocked.\n`);
    process.stdout.write(`  Press Ctrl+C to stop.\n`);
    process.stdout.write(`\n`);
  });
  return server;
}

const isMain =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isMain) {
  startStandaloneDemoServer();
}
