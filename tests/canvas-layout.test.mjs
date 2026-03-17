import test from "node:test";
import assert from "node:assert/strict";

import { getCanvasRenderMetrics } from "../public/canvas-layout.js";

test("getCanvasRenderMetrics preserves the room aspect ratio at 1x scale", () => {
  const metrics = getCanvasRenderMetrics({
    clientWidth: 800,
    clientHeight: 525,
    devicePixelRatio: 1
  });

  assert.deepEqual(metrics, {
    logicalWidth: 640,
    logicalHeight: 420,
    pixelWidth: 800,
    pixelHeight: 525,
    scaleX: 1.25,
    scaleY: 1.25
  });
});

test("getCanvasRenderMetrics rounds cleanly for fractional Windows display scaling", () => {
  const metrics = getCanvasRenderMetrics({
    clientWidth: 799,
    clientHeight: 523,
    devicePixelRatio: 1.25
  });

  assert.equal(metrics.logicalWidth, 640);
  assert.equal(metrics.logicalHeight, 420);
  assert.equal(metrics.pixelWidth, 999);
  assert.equal(metrics.pixelHeight, 654);
  assert.equal(metrics.scaleX, 1.2484375);
  assert.equal(metrics.scaleY, 1.2452380952380953);
});
