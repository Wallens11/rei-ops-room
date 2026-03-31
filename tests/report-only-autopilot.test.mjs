import test from "node:test";
import assert from "node:assert/strict";

import {
  buildReportOnlyAutopilotViewModel,
  createReportOnlyAutopilotState,
  shouldAutoTriggerReportOnly
} from "../public/report-only-autopilot.js";

test("shouldAutoTriggerReportOnly only fires for a fresh ready target when autopilot is enabled", () => {
  const autopilot = createReportOnlyAutopilotState({
    enabled: true
  });

  assert.equal(
    shouldAutoTriggerReportOnly({
      autopilot,
      reportOnly: {
        status: "ready",
        canComment: true,
        target: {
          number: 6,
          title: "Viewer report-only autopilot toggle and safe auto-pickup"
        }
      }
    }),
    true
  );

  assert.equal(
    shouldAutoTriggerReportOnly({
      autopilot,
      reportOnly: {
        status: "already_commented",
        canComment: false,
        target: {
          number: 6,
          title: "Viewer report-only autopilot toggle and safe auto-pickup"
        }
      }
    }),
    false
  );

  assert.equal(
    shouldAutoTriggerReportOnly({
      autopilot: createReportOnlyAutopilotState({
        enabled: true,
        lastHandledIssueNumber: 6
      }),
      reportOnly: {
        status: "ready",
        canComment: true,
        target: {
          number: 6,
          title: "Viewer report-only autopilot toggle and safe auto-pickup"
        }
      }
    }),
    false
  );
});

test("buildReportOnlyAutopilotViewModel exposes an idle off state by default", () => {
  const model = buildReportOnlyAutopilotViewModel({
    autopilot: createReportOnlyAutopilotState(),
    reportOnly: {
      status: "ready",
      canComment: true,
      target: {
        number: 6,
        title: "Viewer report-only autopilot toggle and safe auto-pickup"
      }
    }
  });

  assert.equal(model.title, "Autopilot Off");
  assert.equal(model.buttonLabel, "Enable Autopilot");
  assert.equal(model.buttonDisabled, false);
  assert.equal(model.tone, "idle");
});

test("buildReportOnlyAutopilotViewModel shows the armed active issue when enabled", () => {
  const model = buildReportOnlyAutopilotViewModel({
    autopilot: createReportOnlyAutopilotState({
      enabled: true
    }),
    reportOnly: {
      status: "ready",
      canComment: true,
      target: {
        number: 6,
        title: "Viewer report-only autopilot toggle and safe auto-pickup"
      }
    }
  });

  assert.equal(model.title, "Autopilot Armed");
  assert.equal(model.detail, "Watching #6 Viewer report-only autopilot toggle and safe auto-pickup");
  assert.equal(model.buttonLabel, "Disable Autopilot");
  assert.equal(model.buttonDisabled, false);
  assert.equal(model.tone, "ready");
});

test("buildReportOnlyAutopilotViewModel shows a synced state when the active issue is already covered", () => {
  const model = buildReportOnlyAutopilotViewModel({
    autopilot: createReportOnlyAutopilotState({
      enabled: true
    }),
    reportOnly: {
      status: "already_commented",
      canComment: false,
      target: {
        number: 6,
        title: "Viewer report-only autopilot toggle and safe auto-pickup"
      }
    }
  });

  assert.equal(model.title, "Autopilot Synced");
  assert.equal(model.buttonLabel, "Disable Autopilot");
  assert.equal(model.buttonDisabled, false);
  assert.equal(model.tone, "done");
});
