import test from "node:test";
import assert from "node:assert/strict";

import {
  buildExecuteAgentViewModel,
  createEmptyExecutePreviewState,
  createEmptyExecuteServiceState
} from "../public/execute-agent-view.js";

test("buildExecuteAgentViewModel offers Start Agent when execute work is queued", () => {
  const model = buildExecuteAgentViewModel({
    preview: {
      status: "ready",
      target: {
        number: 21,
        title: "Queue-driven execute service MVP"
      },
      detail: "Ready to run the next execute issue."
    },
    service: {
      status: "idle",
      running: false,
      pid: null,
      source: "none",
      detail: "execute worker is not running"
    }
  });

  assert.equal(model.title, "Execute Ready");
  assert.equal(model.detail, "#21 Queue-driven execute service MVP");
  assert.equal(model.buttonLabel, "Start Agent");
  assert.equal(model.action, "start");
  assert.equal(model.tone, "ready");
});

test("buildExecuteAgentViewModel shows the active mission while the executor is running", () => {
  const model = buildExecuteAgentViewModel({
    preview: {
      status: "ready",
      target: {
        number: 22,
        title: "Executor should claim and run the active issue"
      },
      detail: "Ready to run the next execute issue."
    },
    service: {
      status: "running",
      running: true,
      pid: 60123,
      source: "pid",
      detail: "execute worker running (pid 60123)",
      currentTarget: {
        number: 22,
        title: "Executor should claim and run the active issue"
      }
    }
  });

  assert.equal(model.title, "Agent Running");
  assert.equal(model.detail, "#22 Executor should claim and run the active issue");
  assert.match(model.note, /pid 60123/i);
  assert.equal(model.buttonLabel, "Stop Agent");
  assert.equal(model.action, "stop");
});

test("buildExecuteAgentViewModel keeps the queue idle when no execute issue is available", () => {
  const model = buildExecuteAgentViewModel({
    preview: {
      ...createEmptyExecutePreviewState(),
      status: "no_target",
      detail: "Move an `agent:rei` issue into `mode:execute` + `status:todo` first."
    },
    service: {
      ...createEmptyExecuteServiceState(),
      status: "idle",
      source: "none",
      detail: "execute worker is not running"
    }
  });

  assert.equal(model.title, "Execute Idle");
  assert.match(model.note, /mode:execute/i);
  assert.equal(model.buttonLabel, "Nothing Queued");
  assert.equal(model.buttonDisabled, true);
});

test("buildExecuteAgentViewModel surfaces a failed start request clearly", () => {
  const model = buildExecuteAgentViewModel({
    preview: {
      status: "ready",
      target: {
        number: 23,
        title: "Start executor from the ops room"
      },
      detail: "Ready to run the next execute issue."
    },
    service: {
      status: "error",
      running: false,
      pid: null,
      source: "control_error",
      action: "start",
      detail: "execute worker failed to start"
    }
  });

  assert.equal(model.title, "Agent Action Failed");
  assert.equal(model.buttonLabel, "Retry Start");
  assert.equal(model.action, "start");
  assert.equal(model.tone, "error");
});
