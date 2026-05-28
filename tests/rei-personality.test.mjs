import test from "node:test";
import assert from "node:assert/strict";

import { deriveMood, getPersonality, moodTagline } from "../tools/rei-personality.mjs";

test("deriveMood: long-quiet day → thoughtful", () => {
  const mood = deriveMood({ energy: 0.2, focus: 0.4, confidence: 0.5, recentRuns: 0, idleMins: 300 });
  assert.equal(mood, "thoughtful");
});

test("deriveMood: losing streak → frustrated", () => {
  const mood = deriveMood({ energy: 0.5, focus: 0.5, confidence: 0.25, recentRuns: 5, idleMins: 10 });
  assert.equal(mood, "frustrated");
});

test("deriveMood: low energy + focus → tired", () => {
  const mood = deriveMood({ energy: 0.2, focus: 0.3, confidence: 0.6, recentRuns: 2, idleMins: 5 });
  assert.equal(mood, "tired");
});

test("deriveMood: high everything → playful", () => {
  const mood = deriveMood({ energy: 0.8, focus: 0.7, confidence: 0.85, recentRuns: 4, idleMins: 1 });
  assert.equal(mood, "playful");
});

test("deriveMood: very focused → focused", () => {
  const mood = deriveMood({ energy: 0.5, focus: 0.85, confidence: 0.7, recentRuns: 2, idleMins: 2 });
  assert.equal(mood, "focused");
});

test("deriveMood: high energy, lower focus → curious", () => {
  const mood = deriveMood({ energy: 0.7, focus: 0.5, confidence: 0.5, recentRuns: 2, idleMins: 5 });
  assert.equal(mood, "curious");
});

test("getPersonality returns a complete profile with empty inputs", async () => {
  const profile = await getPersonality({ learningLog: [], workerState: null, costs: [] });
  assert.ok(profile.mood);
  assert.ok(typeof profile.energy === "number");
  assert.ok(typeof profile.focus === "number");
  assert.ok(typeof profile.confidence === "number");
  assert.ok(profile.voice && profile.voice.tagline);
  assert.equal(profile.costToday, 0);
});

test("getPersonality reflects an active worker as high-focus", async () => {
  const now = Date.now();
  const profile = await getPersonality({
    learningLog: [
      { outcome: "completed", recordedAt: new Date(now - 5 * 60 * 1000).toISOString() }
    ],
    workerState: { status: "running", updatedAt: new Date(now).toISOString() },
    costs: [],
    now
  });
  assert.ok(profile.focus >= 0.9, `expected high focus, got ${profile.focus}`);
});

test("getPersonality aggregates today's cost from the ledger", async () => {
  const now = Date.now();
  const profile = await getPersonality({
    learningLog: [],
    workerState: null,
    costs: [
      { timestamp: new Date(now - 60 * 60 * 1000).toISOString(), cost: 0.012 },
      { timestamp: new Date(now - 30 * 60 * 1000).toISOString(), cost: 0.034 }
    ],
    now
  });
  assert.equal(profile.costToday, 0.046);
});

test("moodTagline returns one of the configured lines for each mood", () => {
  for (const mood of ["focused", "curious", "playful", "tired", "frustrated", "thoughtful"]) {
    const line = moodTagline({ mood });
    assert.ok(typeof line === "string");
    assert.ok(line.length > 0);
  }
});

test("moodTagline handles null gracefully", () => {
  assert.equal(typeof moodTagline(null), "string");
});
