import test from "node:test";
import assert from "node:assert/strict";

import { buildReportOnlyViewModel, createEmptyReportOnlyState } from "../public/report-only-view.js";

test("buildReportOnlyViewModel exposes a ready manual trigger state", () => {
  const model = buildReportOnlyViewModel({
    status: "ready",
    canComment: true,
    target: {
      number: 5,
      title: "Viewer report-only preview and manual trigger",
      url: "https://github.com/example-org/my-project/issues/5"
    },
    detail: "Report-only action is ready for issue #5."
  });

  assert.equal(model.title, "Report-only Ready");
  assert.equal(model.detail, "#5 Viewer report-only preview and manual trigger");
  assert.equal(model.buttonLabel, "Post Plan Comment");
  assert.equal(model.buttonDisabled, false);
  assert.equal(model.tone, "ready");
});

test("buildReportOnlyViewModel disables the action when the comment already exists", () => {
  const model = buildReportOnlyViewModel({
    status: "already_commented",
    canComment: false,
    target: {
      number: 5,
      title: "Viewer report-only preview and manual trigger",
      url: "https://github.com/example-org/my-project/issues/5"
    },
    detail: "Report-only comment already exists for issue #5."
  });

  assert.equal(model.title, "Report-only Synced");
  assert.equal(model.buttonDisabled, true);
  assert.equal(model.buttonLabel, "Already Posted");
  assert.equal(model.tone, "done");
});

test("createEmptyReportOnlyState yields an idle placeholder model", () => {
  const model = buildReportOnlyViewModel(createEmptyReportOnlyState());

  assert.equal(model.title, "Report-only Bridge");
  assert.equal(model.buttonDisabled, true);
  assert.equal(model.buttonLabel, "Checking...");
});
