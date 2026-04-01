import test from "node:test";
import assert from "node:assert/strict";

import {
  buildDailyHandoffViewModel,
  createEmptyDailyHandoffState
} from "../public/handoff-view.js";

test("buildDailyHandoffViewModel exposes the latest recap sections for the panel", () => {
  const model = buildDailyHandoffViewModel({
    status: "ready",
    date: "2026-04-01",
    sections: [
      {
        title: "Today At A Glance",
        items: ["Pixel room handoff panel wired", "Visa sync recap available"]
      },
      {
        title: "First Notes To Open Next",
        items: ["references/visa-bulk-mgmt.md", "references/daily-device-handoff.md"]
      }
    ]
  });

  assert.equal(model.title, "Today Handoff");
  assert.equal(model.meta, "2026-04-01");
  assert.equal(model.rows.length, 2);
  assert.deepEqual(model.rows[0], {
    id: "section-0",
    title: "Today At A Glance",
    detail: "Pixel room handoff panel wired",
    note: "Visa sync recap available",
    tone: "ready"
  });
});

test("createEmptyDailyHandoffState yields a loading placeholder", () => {
  const model = buildDailyHandoffViewModel(createEmptyDailyHandoffState());

  assert.equal(model.title, "Today Handoff");
  assert.equal(model.meta, "checking latest recap");
  assert.equal(model.rows[0].title, "Loading handoff...");
  assert.equal(model.rows[0].tone, "loading");
});
