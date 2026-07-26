import test from "node:test";
import assert from "node:assert/strict";

import {
  DEMO_STORYBOARD,
  getDemoDurationMs,
  getDemoTrimSeconds
} from "../tools/demo-storyboard.mjs";

test("demo storyboard records real room interactions instead of a screenshot zoom", () => {
  const actions = new Set(DEMO_STORYBOARD.map((step) => step.action));
  const durationMs = getDemoDurationMs(DEMO_STORYBOARD);

  assert.ok(actions.has("hold"));
  assert.ok(actions.has("scroll"));
  assert.ok(actions.has("click"));
  assert.ok(
    DEMO_STORYBOARD.some((step) => step.target === '[data-mode="widget"]'),
    "Expected the capture to show Widget mode"
  );
  assert.ok(
    DEMO_STORYBOARD.some((step) => step.target === '[data-mode="room"]'),
    "Expected the capture to return to Room mode"
  );
  assert.ok(
    DEMO_STORYBOARD.some((step) => step.target === ".panel-grid"),
    "Expected the capture to reveal the operational panels"
  );
  assert.ok(durationMs >= 8_000 && durationMs <= 15_000);
});

test("demo trim follows the measured storyboard start and preserves full duration", () => {
  assert.equal(getDemoTrimSeconds({
    storyboardStartOffsetSeconds: 1.2,
    rawDurationSeconds: 10.4,
    captureDurationSeconds: 8.6
  }), 1.2);
  assert.equal(getDemoTrimSeconds({
    storyboardStartOffsetSeconds: 2,
    rawDurationSeconds: 10,
    captureDurationSeconds: 8.6
  }), 1.4);
  assert.equal(getDemoTrimSeconds({
    storyboardStartOffsetSeconds: 0.5,
    rawDurationSeconds: 8.1,
    captureDurationSeconds: 8.6
  }), 0);
});
