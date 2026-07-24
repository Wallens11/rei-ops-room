import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const indexUrl = new URL("../public/index.html", import.meta.url);
const stylesUrl = new URL("../public/styles.css", import.meta.url);
const appUrl = new URL("../public/app.js", import.meta.url);
const gitignoreUrl = new URL("../.gitignore", import.meta.url);
const dockerignoreUrl = new URL("../.dockerignore", import.meta.url);

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
    "AGENTS.md"
  ]) {
    assert.ok(
      dockerignore.split("\n").includes(pattern),
      `Expected .dockerignore to include ${pattern}`
    );
  }
});
