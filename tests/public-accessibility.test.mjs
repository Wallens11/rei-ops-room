import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const indexUrl = new URL("../public/index.html", import.meta.url);
const stylesUrl = new URL("../public/styles.css", import.meta.url);
const appUrl = new URL("../public/app.js", import.meta.url);
const gitignoreUrl = new URL("../.gitignore", import.meta.url);
const dockerignoreUrl = new URL("../.dockerignore", import.meta.url);
const dockerfileUrl = new URL("../Dockerfile", import.meta.url);
const readmeUrl = new URL("../README.md", import.meta.url);
const dockerWorkflowUrl = new URL("../.github/workflows/docker.yml", import.meta.url);
const testWorkflowUrl = new URL("../.github/workflows/test.yml", import.meta.url);

test("public controls have explicit labels and visible keyboard focus", async () => {
  const [html, css] = await Promise.all([
    fs.readFile(indexUrl, "utf8"),
    fs.readFile(stylesUrl, "utf8")
  ]);

  for (const id of [
    "task-queue-input",
    "task-queue-runtime",
    "brain-memory-search",
    "rei-chat-input"
  ]) {
    assert.match(html, new RegExp(`<label[^>]+for="${id}"`));
  }
  assert.match(css, /:focus-visible/);
});

test("public demo explains its isolation and touch targets meet the 44px baseline", async () => {
  const [html, css] = await Promise.all([
    fs.readFile(indexUrl, "utf8"),
    fs.readFile(stylesUrl, "utf8")
  ]);

  assert.match(html, /Safe Demo/);
  assert.match(html, /Local reads and writes are blocked/);
  assert.match(
    css,
    /@media \(hover: none\) and \(pointer: coarse\)[\s\S]+min-height:\s*44px/
  );
});

test("direct task failures have an announced inline status and preserve failed input", async () => {
  const [html, app] = await Promise.all([
    fs.readFile(indexUrl, "utf8"),
    fs.readFile(appUrl, "utf8")
  ]);

  assert.match(
    html,
    /id="task-queue-status"[^>]+role="status"[^>]+aria-live="polite"/
  );
  assert.match(app, /const result = await submitDirectTaskRequest\(/);
  assert.match(app, /if \(!result\.ok\)[\s\S]+taskQueueStatus\.textContent = result\.message/);
  assert.match(app, /if \(elements\.taskQueueInput\) elements\.taskQueueInput\.value = ""/);
});

test("public repository ignores local environment files", async () => {
  const gitignore = await fs.readFile(gitignoreUrl, "utf8");

  assert.match(gitignore, /^\.env$/m);
  assert.match(gitignore, /^\.env\.\*$/m);
  assert.match(gitignore, /^!\.env\.example$/m);
});

test("Docker build context excludes operator secrets and local agent state", async () => {
  const dockerignore = await fs.readFile(dockerignoreUrl, "utf8");

  for (const pattern of [
    ".env",
    ".env.*",
    "rei.config.json",
    ".rei-runtimes.json",
    ".rei-memory/",
    ".rei-costs.jsonl",
    ".rei-chat.jsonl",
    ".rei-narration.jsonl",
    ".claude/",
    ".impeccable/live/",
    ".execute-wake.trigger",
    ".execute-queue.lock",
    "docs/",
    ".DS_Store",
    "public/demo.gif",
    "AGENTS.md"
  ]) {
    assert.ok(
      dockerignore.split("\n").includes(pattern),
      `Expected .dockerignore to include ${pattern}`
    );
  }
});

test("Docker quick start uses the branch tag published by the workflow", async () => {
  const [readme, workflow] = await Promise.all([
    fs.readFile(readmeUrl, "utf8"),
    fs.readFile(dockerWorkflowUrl, "utf8")
  ]);

  assert.match(workflow, /type=ref,event=branch/);
  assert.match(readme, /ghcr\.io\/wallens11\/rei-ops-room:main/);
});

test("Docker image declares a non-root runtime user", async () => {
  const dockerfile = await fs.readFile(dockerfileUrl, "utf8");
  const userInstructions = dockerfile.match(/^USER\s+\S+$/gm) || [];
  const userIndex = dockerfile.lastIndexOf("USER node");
  const commandIndex = dockerfile.indexOf('CMD ["node", "server.mjs"]');

  assert.deepEqual(userInstructions, ["USER node"]);
  assert.ok(commandIndex > userIndex, "Expected USER node before the runtime command");
  assert.match(dockerfile, /^RUN chown node:node \/app$/m);
  assert.match(dockerfile, /^COPY --chown=node:node \. \.$/m);
});

test("Docker workflow builds amd64 and arm64 images", async () => {
  const workflow = await fs.readFile(dockerWorkflowUrl, "utf8");

  assert.match(workflow, /uses: docker\/setup-qemu-action@v4/);
  assert.match(workflow, /uses: docker\/setup-buildx-action@v4/);
  assert.match(workflow, /platforms:\s*linux\/amd64,linux\/arm64/);
});

test("Docker workflow uses the maintained Node 24 action majors", async () => {
  const workflow = await fs.readFile(dockerWorkflowUrl, "utf8");

  for (const action of [
    "actions/checkout@v7",
    "docker/setup-qemu-action@v4",
    "docker/setup-buildx-action@v4",
    "docker/login-action@v4",
    "docker/metadata-action@v6",
    "docker/build-push-action@v7"
  ]) {
    assert.match(workflow, new RegExp(`uses: ${action.replace("/", "\\/")}`));
  }
});

test("test workflow uses the maintained Node 24 action majors", async () => {
  const workflow = await fs.readFile(testWorkflowUrl, "utf8");

  assert.match(workflow, /uses: actions\/checkout@v7/);
  assert.match(workflow, /uses: actions\/setup-node@v7/);
});
