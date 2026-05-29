import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

import { buildHealthPayload } from "../tools/health.mjs";

test("buildHealthPayload returns the public health response shape", async () => {
  const packageJson = JSON.parse(await fs.readFile(new URL("../package.json", import.meta.url), "utf8"));
  const body = await buildHealthPayload({
    uptime: () => 12345,
    nodeVersion: "v22.20.0"
  });

  assert.deepEqual(body, {
    status: "ok",
    uptime: 12345,
    version: packageJson.version,
    node: "v22.20.0"
  });
});
