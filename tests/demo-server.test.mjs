import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";

import { startStandaloneDemoServer } from "../demo.mjs";

test("standalone demo server binds to loopback by default", async (t) => {
  const server = startStandaloneDemoServer({ port: 0 });
  await once(server, "listening");
  t.after(() => server.close());

  assert.equal(server.address().address, "127.0.0.1");
});
