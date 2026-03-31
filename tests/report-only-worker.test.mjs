import test from "node:test";
import assert from "node:assert/strict";

import {
  createWorkerResultSignature,
  formatWorkerResultLine,
  runReportOnlyWorker
} from "../tools/report-only-worker.mjs";

test("createWorkerResultSignature keys worker state by status and target issue", () => {
  assert.equal(
    createWorkerResultSignature({
      status: "already_commented",
      target: {
        number: 7
      }
    }),
    "already_commented:7"
  );

  assert.equal(
    createWorkerResultSignature({
      status: "no_target",
      target: null
    }),
    "no_target:0"
  );
});

test("formatWorkerResultLine produces readable worker logs", () => {
  const line = formatWorkerResultLine({
    status: "comment_posted",
    detail: "Posted report-only comment to issue #7.",
    target: {
      number: 7,
      title: "Background report-only worker for GitHub issue pickup"
    }
  });

  assert.match(line, /comment_posted/i);
  assert.match(line, /#7/);
  assert.match(line, /Background report-only worker/);
});

test("runReportOnlyWorker executes once and exits cleanly in once mode", async () => {
  const lines = [];
  let runs = 0;

  const code = await runReportOnlyWorker({
    once: true,
    intervalMs: 50,
    stdout: {
      write(chunk) {
        lines.push(String(chunk).trim());
      }
    },
    executeAction: async () => {
      runs += 1;
      return {
        status: "no_target",
        detail: "No active report-only issue found.",
        target: null
      };
    }
  });

  assert.equal(code, 0);
  assert.equal(runs, 1);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /no_target/i);
});

test("runReportOnlyWorker suppresses duplicate skip logs across polling cycles", async () => {
  const lines = [];
  let runs = 0;

  const code = await runReportOnlyWorker({
    intervalMs: 1,
    maxRuns: 3,
    stdout: {
      write(chunk) {
        lines.push(String(chunk).trim());
      }
    },
    sleep: async () => {},
    executeAction: async () => {
      runs += 1;
      return {
        status: "already_commented",
        detail: "Report-only comment already exists for issue #7.",
        target: {
          number: 7,
          title: "Background report-only worker for GitHub issue pickup"
        }
      };
    }
  });

  assert.equal(code, 0);
  assert.equal(runs, 3);
  assert.equal(lines.length, 2);
  assert.match(lines[0], /watching/i);
  assert.match(lines[1], /already_commented/i);
});
