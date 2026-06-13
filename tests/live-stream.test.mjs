import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import http from "node:http";

import { createServer } from "../server.mjs";

// Read just the first SSE event frame off the live stream, then bail. Uses a
// real socket so it exercises the full route → attach → build → frame path.
function readFirstFrame(port, pathname, { timeoutMs = 4000 } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: "127.0.0.1", port, path: pathname }, (res) => {
      let buffer = "";
      const timer = setTimeout(() => {
        req.destroy();
        reject(new Error("timed out waiting for an SSE frame"));
      }, timeoutMs);

      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        buffer += chunk;
        // Frames are separated by a blank line. Skip the leading ": connected"
        // comment and resolve on the first real event frame.
        const frames = buffer.split("\n\n");
        for (const frame of frames) {
          if (frame.includes("event:")) {
            clearTimeout(timer);
            req.destroy();
            resolve(frame);
            return;
          }
        }
      });
      res.on("error", reject);
    });
    req.on("error", reject);
  });
}

function parseSseFrame(frame) {
  const out = { event: null, data: "" };
  for (const line of frame.split("\n")) {
    if (line.startsWith("event:")) out.event = line.slice(6).trim();
    else if (line.startsWith("data:")) out.data += line.slice(5).trim();
  }
  return out;
}

test("GET /api/live/stream pushes a panels frame with queue shape", async (t) => {
  const server = createServer();
  server.listen(0);
  await once(server, "listening");
  t.after(() => server.close());

  const { port } = server.address();
  const frame = await readFirstFrame(port, "/api/live/stream");
  const parsed = parseSseFrame(frame);

  assert.equal(parsed.event, "panels");
  const payload = JSON.parse(parsed.data);
  assert.ok(payload.generatedAt, "frame carries a generatedAt timestamp");
  assert.ok(payload.queue && Array.isArray(payload.queue.tasks), "frame carries queue.tasks[]");
});

test("the live stream sets event-stream headers", async (t) => {
  const server = createServer();
  server.listen(0);
  await once(server, "listening");
  t.after(() => server.close());

  const { port } = server.address();
  const res = await new Promise((resolve, reject) => {
    const req = http.get({ host: "127.0.0.1", port, path: "/api/live/stream" }, resolve);
    req.on("error", reject);
    setTimeout(() => req.destroy(), 2000);
  });

  assert.match(res.headers["content-type"], /text\/event-stream/);
  assert.equal(res.headers["cache-control"], "no-cache, no-transform");
  res.destroy();
});
