export const DEMO_STORYBOARD = Object.freeze([
  { action: "hold", durationMs: 1_300 },
  { action: "scroll", target: ".panel-grid", durationMs: 1_400 },
  { action: "hold", durationMs: 900 },
  { action: "scroll", target: "top", durationMs: 1_200 },
  { action: "click", target: '[data-mode="widget"]', durationMs: 800 },
  { action: "hold", durationMs: 1_400 },
  { action: "click", target: '[data-mode="room"]', durationMs: 600 },
  { action: "hold", durationMs: 1_000 }
]);

export function getDemoDurationMs(storyboard = DEMO_STORYBOARD) {
  return storyboard.reduce((total, step) => total + step.durationMs, 0);
}

export function getDemoTrimSeconds({
  storyboardStartOffsetSeconds,
  rawDurationSeconds,
  captureDurationSeconds
}) {
  const maxTrimSeconds = Math.max(0, rawDurationSeconds - captureDurationSeconds);
  const trimSeconds = Math.min(
    Math.max(0, storyboardStartOffsetSeconds),
    maxTrimSeconds
  );
  return Math.round(trimSeconds * 1_000) / 1_000;
}
