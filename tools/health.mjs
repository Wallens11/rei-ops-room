import fs from "node:fs/promises";

const packageJsonUrl = new URL("../package.json", import.meta.url);

export async function readPackageVersion(source = packageJsonUrl) {
  const packageJson = JSON.parse(await fs.readFile(source, "utf8"));
  return packageJson.version;
}

export async function buildHealthPayload({
  readVersion = readPackageVersion,
  uptime = process.uptime,
  nodeVersion = process.version
} = {}) {
  return {
    status: "ok",
    uptime: uptime(),
    version: await readVersion(),
    node: nodeVersion
  };
}
