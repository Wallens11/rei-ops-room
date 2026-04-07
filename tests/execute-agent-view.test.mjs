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

test("buildExecuteAgentViewModel explains when a roadmap child was auto-selected", () => {
  const model = buildExecuteAgentViewModel({
    preview: {
      status: "roadmap_ready",
      target: {
        number: 15,
        title: "Approval-gated execution lane beyond report-only",
        roadmap: {
          number: 13,
          title: "Roadmap: Paperclip-lite gap map for Rei Ops Room"
        }
      },
      detail: "Roadmap #13 selected #15 as the next unresolved child issue."
    },
    service: {
      status: "idle",
      running: false,
      pid: null,
      source: "none",
      detail: "execute worker is not running"
    }
  });

  assert.equal(model.title, "Roadmap Ready");
  assert.equal(model.detail, "#15 Approval-gated execution lane beyond report-only");
  assert.match(model.note, /roadmap #13/i);
  assert.equal(model.buttonLabel, "Start Agent");
});

test("buildExecuteAgentViewModel blocks start when the roadmap queue is halted on a blocked child", () => {
  const model = buildExecuteAgentViewModel({
    preview: {
      status: "roadmap_blocked",
      target: {
        number: 15,
        title: "Approval-gated execution lane beyond report-only",
        roadmap: {
          number: 13,
          title: "Roadmap: Paperclip-lite gap map for Rei Ops Room"
        }
      },
      detail: "Roadmap #13 is halted because #15 is blocked."
    },
    service: {
      status: "idle",
      running: false,
      pid: null,
      source: "none",
      detail: "execute worker is not running"
    }
  });

  assert.equal(model.title, "Roadmap Blocked");
  assert.match(model.note, /blocked/i);
  assert.equal(model.buttonLabel, "Blocked");
  assert.equal(model.buttonDisabled, true);
});

test("buildExecuteAgentViewModel shows Awaiting Approval when issue needs explicit approval", () => {
  const model = buildExecuteAgentViewModel({
    preview: {
      status: "awaiting_approval",
      target: {
        number: 23,
        title: "Feature needing approval"
      },
      detail: "Issue #23 has mode:execute but needs explicit approval before running."
    },
    service: {
      status: "idle",
      running: false,
      pid: null,
      source: "none",
      detail: "execute worker is not running"
    }
  });

  assert.equal(model.title, "Awaiting Approval");
  assert.equal(model.detail, "#23 Feature needing approval");
  assert.equal(model.buttonLabel, "Approve for Execution");
  assert.equal(model.action, "approve");
  assert.equal(model.tone, "idle");
  assert.equal(model.buttonDisabled, false);
});
