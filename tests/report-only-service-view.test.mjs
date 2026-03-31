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
  assert.equal(model.buttonLabel, "Stop Service");
  assert.equal(model.action, "stop");
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
  assert.equal(model.buttonLabel, "Start Service");
  assert.equal(model.action, "start");
});

test("createEmptyReportOnlyServiceState yields a checking placeholder", () => {
  const model = buildReportOnlyServiceViewModel(createEmptyReportOnlyServiceState());

  assert.equal(model.title, "Service Checking");
  assert.equal(model.tone, "loading");
  assert.equal(model.buttonDisabled, true);
});

test("buildReportOnlyServiceViewModel offers a start button when the service is idle", () => {
  const model = buildReportOnlyServiceViewModel({
    status: "idle",
    running: false,
    pid: null,
    source: "none",
    detail: "report-only worker is not running"
  });

  assert.equal(model.title, "Service Idle");
  assert.equal(model.buttonLabel, "Start Service");
  assert.equal(model.buttonDisabled, false);
  assert.equal(model.action, "start");
});

test("buildReportOnlyServiceViewModel surfaces a failed start action clearly", () => {
  const model = buildReportOnlyServiceViewModel({
    status: "error",
    running: false,
    pid: null,
    source: "control_error",
    action: "start",
    detail: "report-only worker failed to start"
  });

  assert.equal(model.title, "Service Action Failed");
  assert.equal(model.detail, "report-only worker failed to start");
  assert.match(model.note, /start/i);
  assert.equal(model.tone, "error");
  assert.equal(model.buttonLabel, "Retry Start");
  assert.equal(model.buttonDisabled, false);
  assert.equal(model.action, "start");
});
