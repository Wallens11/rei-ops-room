#!/usr/bin/env node
/**
 * Capture a real Safe Demo browser session for the public README.
 *
 * The recording uses only simulated data. It starts the demo server on
 * 127.0.0.1, records actual scrolling and Room/Widget interactions, then emits:
 *
 *   public/rei-ops-room-demo.mp4  — full interaction video
 *   public/rei-ops-room-demo.gif  — lightweight autoplay preview
 *   public/safe-demo.jpg          — static fallback
 *
 * Playwright and ffmpeg are authoring tools, not runtime dependencies.
 *
 * Setup:
 *   npm install --no-save --package-lock=false playwright
 *   npx playwright install chromium
 *
 * Usage:
 *   node tools/capture-demo.mjs
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { createDemoServer } from "./demo-server.mjs";
import {
  DEMO_STORYBOARD,
  getDemoDurationMs,
  getDemoTrimSeconds
} from "./demo-storyboard.mjs";

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = path.join(projectRoot, "public");
const outputVideo = path.join(publicDir, "rei-ops-room-demo.mp4");
const outputGif = path.join(publicDir, "rei-ops-room-demo.gif");
const outputScreenshot = path.join(publicDir, "safe-demo.jpg");
const captureDurationSeconds = getDemoDurationMs() / 1_000;

let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  throw new Error(
    "Playwright is required only to author demo media. Run: " +
    "npm install --no-save --package-lock=false playwright"
  );
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Safe Demo server did not expose a TCP port");
  }
  return `http://127.0.0.1:${address.port}`;
}

async function closeServer(server) {
  if (!server.listening) return;
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

async function smoothScroll(page, target, durationMs) {
  await page.evaluate(
    ({ selector, duration }) => new Promise((resolve) => {
      const startY = window.scrollY;
      const targetY = selector === "top"
        ? 0
        : Math.max(
            0,
            window.scrollY +
              document.querySelector(selector).getBoundingClientRect().top -
              20
          );
      const startedAt = performance.now();

      function tick(now) {
        const progress = Math.min(1, (now - startedAt) / duration);
        const eased = 1 - Math.pow(1 - progress, 3);
        window.scrollTo(0, startY + (targetY - startY) * eased);
        if (progress < 1) requestAnimationFrame(tick);
        else resolve();
      }

      requestAnimationFrame(tick);
    }),
    { selector: target, duration: durationMs }
  );
}

async function playStoryboard(page) {
  for (const step of DEMO_STORYBOARD) {
    if (step.action === "hold") {
      await page.waitForTimeout(step.durationMs);
      continue;
    }
    if (step.action === "scroll") {
      await smoothScroll(page, step.target, step.durationMs);
      continue;
    }
    if (step.action === "click") {
      await page.locator(step.target).click();
      await page.waitForTimeout(step.durationMs);
      continue;
    }
    throw new Error(`Unknown demo storyboard action: ${step.action}`);
  }
}

async function renderMedia(rawVideo, tempDir, storyboardStartOffsetSeconds) {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    rawVideo
  ]);
  const rawDurationSeconds = Number(stdout.trim());
  if (!Number.isFinite(rawDurationSeconds)) {
    throw new Error("ffprobe did not return a valid raw recording duration");
  }
  const trimSeconds = getDemoTrimSeconds({
    storyboardStartOffsetSeconds,
    rawDurationSeconds,
    captureDurationSeconds
  });
  const commonInput = [
    "-y",
    "-ss", String(trimSeconds),
    "-i", rawVideo,
    "-t", String(captureDurationSeconds)
  ];

  await execFileAsync("ffmpeg", [
    ...commonInput,
    "-an",
    "-vf", "scale=960:-2:flags=lanczos",
    "-c:v", "libx264",
    "-preset", "slow",
    "-crf", "24",
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    outputVideo
  ]);

  const palette = path.join(tempDir, "demo-palette.png");
  const gifFilter = "fps=5,scale=720:-2:flags=lanczos";
  await execFileAsync("ffmpeg", [
    ...commonInput,
    "-vf", `${gifFilter},palettegen=stats_mode=diff:max_colors=160`,
    palette
  ]);
  await execFileAsync("ffmpeg", [
    ...commonInput,
    "-i", palette,
    "-filter_complex",
    `${gifFilter}[frame];[frame][1:v]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`,
    "-t", String(captureDurationSeconds),
    outputGif
  ]);
}

async function assertMediaBudget(file, maxBytes) {
  const stat = await fs.stat(file);
  if (stat.size >= maxBytes) {
    throw new Error(`${path.basename(file)} exceeds ${Math.round(maxBytes / 1024 / 1024)} MB`);
  }
  return stat.size;
}

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "rei-demo-capture-"));
const server = createDemoServer();
let browser;

try {
  const baseUrl = await listen(server);
  browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    recordVideo: {
      dir: tempDir,
      size: { width: 1280, height: 720 }
    }
  });
  await context.addInitScript(() => {
    localStorage.setItem("rei-chat-collapsed", "true");
    localStorage.setItem("codex-pixel-agent-mode", "room");
  });

  const recordingStartedAt = Date.now();
  const page = await context.newPage();
  await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 15_000 });
  await page.locator("#demo-banner:not([hidden])").waitFor({ state: "visible" });
  await page.locator("#room-canvas").waitFor({ state: "visible" });
  await page.waitForTimeout(800);

  await page.screenshot({
    path: outputScreenshot,
    type: "jpeg",
    quality: 88
  });
  const storyboardStartOffsetSeconds = Math.max(
    0,
    (Date.now() - recordingStartedAt) / 1_000 - 0.15
  );
  await playStoryboard(page);

  const video = page.video();
  await context.close();
  const rawVideo = await video.path();
  await renderMedia(rawVideo, tempDir, storyboardStartOffsetSeconds);

  const [videoBytes, gifBytes] = await Promise.all([
    assertMediaBudget(outputVideo, 5 * 1024 * 1024),
    assertMediaBudget(outputGif, 3 * 1024 * 1024)
  ]);
  process.stdout.write(
    `Captured real Safe Demo interaction: ` +
    `${Math.round(videoBytes / 1024)} KB MP4, ${Math.round(gifBytes / 1024)} KB GIF\n`
  );
} finally {
  await browser?.close();
  await closeServer(server);
  await fs.rm(tempDir, { recursive: true, force: true });
}
