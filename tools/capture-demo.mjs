/**
 * capture-demo.mjs — capture screenshots of the demo UI for README GIF.
 *
 * Usage:
 *   DEMO_MODE=true node server.mjs &
 *   node tools/capture-demo.mjs
 *
 * Outputs PNGs to ./demo-frames/ then writes a GIF-ready sprite sheet.
 * Requires: npx playwright (chromium headless shell must be installed)
 */

// Playwright is not a project dependency — resolve from npx cache or local workspace
let chromium;
try {
  const mod = await import("playwright");
  chromium = mod.chromium ?? (mod.default || mod["module.exports"])?.chromium;
} catch { /* fall through */ }

if (!chromium) {
  const candidates = [
    "/Users/funtoco/.npm/_npx/2334a3ea0ef73d73/node_modules/playwright/index.js",
    "/Users/funtoco/workSpace/fun-growth-loadmap/node_modules/playwright/index.js",
  ];
  for (const c of candidates) {
    try {
      const mod = await import(c);
      chromium = mod.chromium ?? (mod.default || mod["module.exports"])?.chromium;
      if (chromium) break;
    } catch { /* try next */ }
  }
}
if (!chromium) throw new Error("playwright not found — run: npm install -D playwright");
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const framesDir = path.join(projectRoot, "demo-frames");
const PORT = process.env.PORT ?? 4317;
const BASE = `http://localhost:${PORT}`;

await fs.mkdir(framesDir, { recursive: true });

console.log("Launching browser...");

const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-setuid-sandbox"]
});
const page = await browser.newPage();
await page.setViewportSize({ width: 1440, height: 900 });

console.log(`Navigating to ${BASE} ...`);
await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 15000 });

// Let polling kick in (demo data updates every few seconds on the frontend)
await page.waitForTimeout(1500);

async function shot(name, fn) {
  if (fn) await fn();
  await page.waitForTimeout(400);
  const file = path.join(framesDir, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  console.log(`  captured: ${name}.png`);
  return file;
}

// ── Frames ─────────────────────────────────────────────────────────────────

// 1. Full room overview
await shot("01-overview");

// 2. Scroll to inspector area
await shot("02-inspector", async () => {
  await page.evaluate(() => {
    document.querySelector(".inspector")?.scrollIntoView({ behavior: "instant" });
  });
});

// 3. Back to top, hover over canvas to show scene detail
await shot("03-canvas-hover", async () => {
  await page.evaluate(() => window.scrollTo(0, 0));
  const canvas = await page.$("#room-canvas");
  if (canvas) {
    const box = await canvas.boundingBox();
    if (box) {
      await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.55);
    }
  }
});

// 4. Scroll to panel-grid (GitHub Inbox, Execute Agent, Task Queue…)
await shot("04-panels", async () => {
  await page.evaluate(() => {
    document.querySelector(".panel-grid")?.scrollIntoView({ behavior: "instant" });
  });
});

// 5. Scroll to bottom panels (Metrics, Artifacts)
await shot("05-metrics", async () => {
  await page.evaluate(() => window.scrollBy(0, 400));
});

// 6. Switch to Widget mode
await shot("06-widget-mode", async () => {
  await page.evaluate(() => window.scrollTo(0, 0));
  const widgetBtn = await page.$('[data-mode="widget"]');
  if (widgetBtn) await widgetBtn.click();
  await page.waitForTimeout(500);
});

// 7. Back to Room mode
await shot("07-room-mode", async () => {
  const roomBtn = await page.$('[data-mode="room"]');
  if (roomBtn) await roomBtn.click();
  await page.waitForTimeout(500);
});

// 8. Demo banner visible (confirm demo mode)
await shot("08-demo-banner", async () => {
  await page.evaluate(() => window.scrollTo(0, 0));
});

await browser.close();
console.log(`\nAll frames saved to: ${framesDir}/`);
console.log("Frames list:");
const files = (await fs.readdir(framesDir))
  .filter((f) => f.endsWith(".png"))
  .sort();
for (const f of files) console.log(`  ${f}`);
console.log("\nNext: run tools/frames-to-gif.mjs to generate the GIF.");
