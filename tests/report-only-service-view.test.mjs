import test from "node:test";
import assert from "node:assert/strict";

import {
  buildReportOnlyServiceViewModel,
  createEmptyReportOnlyServiceState
} from "../public/report-only-service-view.js";

test("buildReportOnlyServiceViewModel shows a running local service clearly", () => {
  const model = buildReportOnlyServiceViewModel({
    running: true,
    pid: 55297,
    source: "pid",
    detail: "report-only worker running (pid 55297)"
  });

  assert.equal(model.title, "Service Running");
  assert.equal(model.detail, "report-only worker running (pid 55297)");
  assert.match(model.note, /pid 55297/i);
  assert.equal(model.tone, "ready");
});

test("buildReportOnlyServiceViewModel warns when the pid file is stale", () => {
  const model = buildReportOnlyServiceViewModel({
    running: false,
    pid: null,
    source: "stale_pid",
    detail: "report-only worker is not running (stale pid file)"
  });

  assert.equal(model.title, "Service Warning");
  assert.match(model.note, /stale pid/i);
  assert.equal(model.tone, "done");
});

test("createEmptyReportOnlyServiceState yields a checking placeholder", () => {
  const model = buildReportOnlyServiceViewModel(createEmptyReportOnlyServiceState());

  assert.equal(model.title, "Service Checking");
  assert.equal(model.tone, "loading");
});
