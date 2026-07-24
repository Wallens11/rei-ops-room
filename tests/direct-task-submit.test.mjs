import test from "node:test";
import assert from "node:assert/strict";

import * as taskQueuePanel from "../public/execute-queue-panel.js";

test("direct task submission returns the server message when Safe Demo rejects writes", async () => {
  assert.equal(
    typeof taskQueuePanel.submitDirectTaskRequest,
    "function",
    "expected the task queue module to expose a testable submit boundary"
  );

  const requests = [];
  const result = await taskQueuePanel.submitDirectTaskRequest({
    task: "Keep this task in the input",
    runtimeId: "codex",
    request: async (url, options) => {
      requests.push({ url, options });
      return {
        ok: false,
        status: 403,
        async json() {
          return {
            error: "This local-data action is disabled in demo mode.",
            detail: "Demo mode is read-only and never reads or writes operator data.",
            demo: true
          };
        }
      };
    }
  });

  assert.deepEqual(result, {
    ok: false,
    status: 403,
    message: "This local-data action is disabled in demo mode.",
    demo: true
  });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "/api/execute/submit");
  assert.deepEqual(JSON.parse(requests[0].options.body), {
    task: "Keep this task in the input",
    runtimeId: "codex"
  });
});
