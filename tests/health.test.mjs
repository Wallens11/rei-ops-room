import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

import { buildHealthPayload } from "../tools/health.mjs";

test("package and lockfile metadata stay aligned", async () => {
  const [packageJson, packageLock] = await Promise.all([
    fs.readFile(new URL("../package.json", import.meta.url), "utf8").then(JSON.parse),
    fs.readFile(new URL("../package-lock.json", import.meta.url), "utf8").then(JSON.parse)
  ]);

  assert.equal(packageLock.name, packageJson.name);
  assert.equal(packageLock.version, packageJson.version);
  assert.equal(packageLock.packages[""].name, packageJson.name);
  assert.equal(packageLock.packages[""].version, packageJson.version);
});

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
