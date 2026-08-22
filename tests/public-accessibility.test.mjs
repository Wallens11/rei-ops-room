import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const indexUrl = new URL("../public/index.html", import.meta.url);
const stylesUrl = new URL("../public/styles.css", import.meta.url);
const appUrl = new URL("../public/app.js", import.meta.url);
const petOverlayHtmlUrl = new URL("../public/pet-overlay.html", import.meta.url);
const petOverlayScriptUrl = new URL("../public/pet-overlay.js", import.meta.url);
const petOverlaySwiftUrl = new URL("../tools/reiko-pet-overlay.swift", import.meta.url);
const gitignoreUrl = new URL("../.gitignore", import.meta.url);
const dockerignoreUrl = new URL("../.dockerignore", import.meta.url);
const dockerfileUrl = new URL("../Dockerfile", import.meta.url);
const readmeUrl = new URL("../README.md", import.meta.url);
const demoGifUrl = new URL("../public/rei-ops-room-demo.gif", import.meta.url);
const demoVideoUrl = new URL("../public/rei-ops-room-demo.mp4", import.meta.url);
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

test("Agent Garden is an accessible persisted view backed by the pet atlas renderer", async () => {
  const [html, app, css] = await Promise.all([
    fs.readFile(indexUrl, "utf8"),
    fs.readFile(appUrl, "utf8"),
    fs.readFile(stylesUrl, "utf8")
  ]);

  assert.match(
    html,
    /id="pet-garden-toggle"[^>]+aria-pressed="false"[^>]*>\s*Agent Garden\s*<\/button>/
  );
  assert.match(html, /id="pet-garden-status"[^>]+aria-live="polite"/);
  assert.match(html, /id="room-canvas"[^>]+aria-describedby="pet-garden-status"/);
  assert.match(html, /id="pet-garden-roster"[^>]+aria-label="Agent Garden role and task status"/);
  assert.match(app, /PET_GARDEN_STORAGE_KEY/);
  assert.match(app, /petFrameAt\(/);
  assert.match(app, /context\.drawImage\(\s*petSprite/);
  assert.match(app, /let petSpriteFailed = false/);
  assert.match(app, /petGardenToggle\.disabled = petSpriteFailed/);
  assert.match(app, /petSpriteFailed = true/);
  assert.match(app, /function renderPetGardenRoster\(/);
  assert.match(app, /petOverlayAgents\(renderState\.statusFresh \? renderState\.data : null, VISUAL_CAST\)/);
  assert.match(app, /petGardenRenderActors\(/);
  assert.match(app, /petAgentStatusLabel\(agent/);
  assert.match(app, /petLabelBox\(/);
  assert.match(app, /context\.measureText\(label\)\.width/);
  assert.match(app, /petGardenActiveStatus\(agents,\s*\{\s*demo:/);
  assert.doesNotMatch(app, /Six animated Reiko pets/);
  assert.match(app, /workstream\.source_status \|\| workstream\.status/);
  assert.match(css, /body\.pet-garden-mode[\s\S]+#pet-garden-toggle/);
  assert.match(css, /\.pet-garden-roster/);
  assert.match(css, /\.stream-item\.failed/);
});

test("desktop pet overlay announces compact and squad states and drops stale transport state", async () => {
  const [html, script] = await Promise.all([
    fs.readFile(petOverlayHtmlUrl, "utf8"),
    fs.readFile(petOverlayScriptUrl, "utf8")
  ]);

  assert.match(html, /aria-label="Animated Reiko pet/);
  assert.match(html, /id="pet-overlay-status"[^>]+aria-live="polite"/);
  assert.match(script, /petOverlayAgents\(state\.status, VISUAL_CAST\)/);
  assert.match(script, /petLabelBox\(/);
  assert.match(script, /context\.measureText\(label\)\.width/);
  assert.match(script, /petOverlayModeForWidth\(/);
  assert.match(script, /petRoamingState\(/);
  assert.match(script, /petSpotlightAgent\(/);
  assert.match(script, /petOverlayAgents\(/);
  assert.match(script, /petVisualState\(/);
  assert.match(script, /addEventListener\("reiko-overlay-roaming"/);
  assert.match(script, /addEventListener\("reiko-overlay-react"/);
  assert.match(script, /roaming:\s*false/);
  assert.match(script, /window\.addEventListener\("resize"/);
  assert.match(script, /onTransportError\(\)\s*{\s*state\.status = null;/);
  assert.match(script, /SAFE DEMO · SIMULATED/);
  assert.match(script, /const agentKind = isDemo \? "simulated Reiko" : "live Reiko"/);
  assert.match(script, /petWorkPropForPose\(pose\)/);
  assert.match(script, /drawWorkProp\(/);
  assert.match(script, /const status = petAgentStatusLabel\(agent\)/);
  assert.doesNotMatch(script, /laptop:\s*"typing"/);
  assert.doesNotMatch(script, /coffee:\s*"paused"/);
  assert.match(script, /postMessage\("ready"\)/);
  assert.match(script, /action:\s*"setSquadCount",\s*count,\s*demo\s*\}/);
});

test("main Agent Garden marks transport failures stale instead of animating the last payload", async () => {
  const app = await fs.readFile(appUrl, "utf8");

  assert.match(app, /statusFresh:\s*false/);
  assert.match(app, /function visibleAgentStates\(/);
  assert.match(app, /renderState\.statusFresh = false/);
  assert.match(app, /Agent Garden offline\. Last live agent state was cleared\./);
});

test("native pet overlay is compact, draggable, expandable, and restores a safe position", async () => {
  const swift = await fs.readFile(petOverlaySwiftUrl, "utf8");

  assert.match(swift, /compactOverlaySize\s*=\s*NSSize\(width:\s*300,\s*height:\s*280\)/);
  assert.match(swift, /expandedOverlaySize\s*=\s*NSSize\(width:\s*840,\s*height:\s*230\)/);
  assert.match(swift, /final class DragSurfaceView:\s*NSView/);
  assert.match(swift, /window\.performDrag\(with:\s*event\)/);
  assert.match(swift, /action:\s*#selector\(toggleSquad\)/);
  assert.match(swift, /action:\s*#selector\(toggleRoaming\)/);
  assert.match(swift, /accessibilityDisplayShouldReduceMotion/);
  assert.match(swift, /clampedOverlaySize\(/);
  assert.match(swift, /animate:\s*!NSWorkspace\.shared\.accessibilityDisplayShouldReduceMotion/);
  assert.match(swift, /scheduledTimer\(withTimeInterval:\s*1\.0\s*\/\s*30\.0/);
  assert.match(swift, /private func stepRoaming\(\)/);
  assert.match(swift, /private enum RoamPhase/);
  assert.match(swift, /private func enterObserve\(/);
  assert.match(swift, /private func enterTravel\(/);
  assert.match(swift, /panel\.setFrameOrigin\(/);
  assert.match(swift, /onDragBegan/);
  assert.match(swift, /onDragEnded/);
  assert.match(swift, /onClick/);
  assert.match(swift, /reiko-overlay-roaming/);
  assert.match(swift, /reiko-overlay-react/);
  assert.match(swift, /setSquadCount/);
  assert.match(swift, /squadButton\?\.isHidden/);
  assert.match(swift, /UserDefaults\.standard/);
  assert.match(swift, /windowDidMove/);
  assert.match(swift, /NSButton/);
  assert.match(swift, /action:\s*#selector\(closeOverlay\)/);
  assert.match(swift, /accessibilityLabel:\s*"Show Reiko agents"/);
  assert.match(swift, /private var isSafeDemo = false/);
  assert.match(swift, /payload\["demo"\] as\? Bool/);
  assert.match(swift, /isSafeDemo \? "simulated" : "live"/);
  assert.match(swift, /button\.setAccessibilityLabel\(accessibilityLabel\)/);
  assert.match(swift, /didFailProvisionalNavigation/);
  assert.match(swift, /scheduledTimer\(withTimeInterval:\s*3/);
  assert.match(swift, /NSApplication\.shared\.terminate/);
  assert.doesNotMatch(swift, /collectionBehavior\s*=\s*\[[^\]]*\.stationary/);
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
  const phoneMedia = css.slice(
    css.indexOf("@media (max-width: 560px)"),
    css.indexOf("/* Tablet */")
  );
  const touchMediaStart = css.indexOf("@media (hover: none) and (pointer: coarse)");
  const touchMedia = css.slice(
    touchMediaStart,
    css.indexOf("@media (max-width: 560px)", touchMediaStart)
  );
  for (const mediaBlock of [phoneMedia, touchMedia]) {
    assert.match(mediaBlock, /\.github-issue-link\s*\{[\s\S]+min-height:\s*44px/);
    assert.match(mediaBlock, /min-inline-size:\s*44px/);
    assert.match(mediaBlock, /flex:\s*1 1 44px/);
  }
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
    "public/rei-ops-room-demo.gif",
    "public/rei-ops-room-demo.mp4",
    "public/safe-demo.jpg",
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

test("README gives visitors a truthful 60-second proof path", async () => {
  const readme = await fs.readFile(readmeUrl, "utf8");
  const proofSection = readme.match(/^## 60-Second Proof$([\s\S]*?)^---$/m)?.[1] || "";

  assert.match(readme, /^## 60-Second Proof$/m);
  assert.match(proofSection, /http:\/\/127\.0\.0\.1:4317/);
  assert.match(proofSection, /ghcr\.io\/wallens11\/rei-ops-room:0\.3\.1/);
  assert.match(proofSection, /simulated/i);
  assert.match(proofSection, /does not connect to GitHub or launch an AI runtime/i);
  assert.match(proofSection, /500\+ automated tests/i);
});

test("README describes a runtime-backed pet roster instead of a synthetic six-agent squad", async () => {
  const readme = await fs.readFile(readmeUrl, "utf8");

  assert.match(readme, /Specialist\s+pets appear only when live agent jobs exist/i);
  assert.match(readme, /squad\s+control stays hidden while Reiko is working solo/i);
  assert.doesNotMatch(readme, /full six-agent squad remains one click away/i);
});

test("README demo proof includes a lightweight preview and a real video capture", async () => {
  const [readme, demoGif, demoVideo] = await Promise.all([
    fs.readFile(readmeUrl, "utf8"),
    fs.readFile(demoGifUrl),
    fs.readFile(demoVideoUrl)
  ]);

  assert.match(readme, /!\[Rei Ops Room Safe Demo\]\(public\/rei-ops-room-demo\.gif\)/);
  assert.match(readme, /\[Watch the real interaction video\]\(public\/rei-ops-room-demo\.mp4\)/);
  assert.equal(demoGif.subarray(0, 6).toString("ascii"), "GIF89a");
  assert.ok(demoGif.byteLength < 3 * 1024 * 1024, "Expected demo GIF to stay below 3 MB");
  assert.equal(demoVideo.subarray(4, 8).toString("ascii"), "ftyp");
  assert.ok(demoVideo.byteLength < 5 * 1024 * 1024, "Expected demo video to stay below 5 MB");
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
