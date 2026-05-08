import test from "node:test";
import assert from "node:assert/strict";

import {
  buildReportOnlyComment,
  executeReportOnlyAction,
  hasExistingReportOnlyComment,
  prepareReportOnlyAction,
  selectReportOnlyTarget
} from "../tools/report-only-bridge.mjs";

test("selectReportOnlyTarget picks the active in-progress report-only issue", () => {
  const target = selectReportOnlyTarget({
    planner: {
      activeIssue: {
        number: 3
      }
    },
    issues: [
      {
        number: 3,
        title: "Report-only GitHub issue comment bridge",
        url: "https://github.com/example-org/my-project/issues/3",
        labels: ["agent:rei", "status:in_progress", "mode:report_only"]
      },
      {
        number: 2,
        title: "GitHub issue-driven assistant workflow for cross-device task handling",
        url: "https://github.com/example-org/my-project/issues/2",
        labels: ["agent:rei", "status:todo", "mode:report_only"]
      }
    ]
  });

  assert.deepEqual(target, {
    number: 3,
    title: "Report-only GitHub issue comment bridge",
    url: "https://github.com/example-org/my-project/issues/3",
    labels: ["agent:rei", "status:in_progress", "mode:report_only"]
  });
});

test("hasExistingReportOnlyComment detects the bridge marker for the same issue", () => {
  assert.equal(
    hasExistingReportOnlyComment(
      [
        {
          body: "<!-- rei:report-only issue=3 -->\nRei report-only pickup for #3."
        }
      ],
      3
    ),
    true
  );
  assert.equal(
    hasExistingReportOnlyComment(
      [
        {
          body: "<!-- rei:report-only issue=4 -->\nRei report-only pickup for #4."
        }
      ],
      3
    ),
    false
  );
});

test("buildReportOnlyComment drafts a conservative plan from the issue body", () => {
  const comment = buildReportOnlyComment({
    issue: {
      number: 3,
      title: "Report-only GitHub issue comment bridge",
      body: `## Goal

Create a report-only bridge that can:

- detect the active \`status:in_progress\` issue
- summarize what it intends to do
- leave a short GitHub comment

## Scope

- only for issues tagged \`agent:rei\`
- only for \`mode:report_only\`
- duplicate comments should be avoided`,
      url: "https://github.com/example-org/my-project/issues/3"
    }
  });

  assert.match(comment, /<!-- rei:report-only issue=3 -->/);
  assert.match(comment, /Rei report-only pickup for #3/);
  assert.match(comment, /only for issues tagged `agent:rei`/);
  assert.match(comment, /duplicate comments should be avoided/);
  assert.match(comment, /Proposed next steps:/);
  assert.match(comment, /I will stay in report-only mode/);
});

test("prepareReportOnlyAction returns a ready preview when the active issue has no bridge comment yet", async () => {
  const preview = await prepareReportOnlyAction({
    repo: "example-org/my-project",
    runner: async (file, args) => {
      if (file === "gh" && args[0] === "issue" && args[1] === "list") {
        return {
          stdout: JSON.stringify([
            {
              number: 5,
              title: "Viewer report-only preview and manual trigger",
              state: "OPEN",
              createdAt: "2026-03-31T02:30:00Z",
              updatedAt: "2026-03-31T02:30:00Z",
              url: "https://github.com/example-org/my-project/issues/5",
              labels: [
                { name: "agent:rei" },
                { name: "status:in_progress" },
                { name: "mode:report_only" }
              ],
              assignees: [],
              author: { login: "example-user" }
            }
          ])
        };
      }

      if (file === "gh" && args[0] === "issue" && args[1] === "view") {
        return {
          stdout: JSON.stringify({
            number: 5,
            title: "Viewer report-only preview and manual trigger",
            body: "## Scope\n- show the active target in the viewer\n- preserve dedupe",
            url: "https://github.com/example-org/my-project/issues/5",
            labels: [{ name: "agent:rei" }, { name: "status:in_progress" }, { name: "mode:report_only" }],
            comments: []
          })
        };
      }

      throw new Error(`Unexpected call: ${file} ${args.join(" ")}`);
    }
  });

  assert.equal(preview.status, "ready");
  assert.equal(preview.canComment, true);
  assert.equal(preview.target.number, 5);
  assert.match(preview.draft, /Rei report-only pickup for #5/);
});

test("executeReportOnlyAction posts once and returns a posted result", async () => {
  const calls = [];
  const result = await executeReportOnlyAction({
    repo: "example-org/my-project",
    runner: async (file, args) => {
      calls.push({ file, args });

      if (file === "gh" && args[0] === "issue" && args[1] === "list") {
        return {
          stdout: JSON.stringify([
            {
              number: 5,
              title: "Viewer report-only preview and manual trigger",
              state: "OPEN",
              createdAt: "2026-03-31T02:30:00Z",
              updatedAt: "2026-03-31T02:30:00Z",
              url: "https://github.com/example-org/my-project/issues/5",
              labels: [
                { name: "agent:rei" },
                { name: "status:in_progress" },
                { name: "mode:report_only" }
              ],
              assignees: [],
              author: { login: "example-user" }
            }
          ])
        };
      }

      if (file === "gh" && args[0] === "issue" && args[1] === "view") {
        return {
          stdout: JSON.stringify({
            number: 5,
            title: "Viewer report-only preview and manual trigger",
            body: "## Scope\n- show the active target in the viewer\n- preserve dedupe",
            url: "https://github.com/example-org/my-project/issues/5",
            labels: [{ name: "agent:rei" }, { name: "status:in_progress" }, { name: "mode:report_only" }],
            comments: []
          })
        };
      }

      if (file === "gh" && args[0] === "issue" && args[1] === "comment") {
        return {
          stdout: ""
        };
      }

      throw new Error(`Unexpected call: ${file} ${args.join(" ")}`);
    }
  });

  assert.equal(result.status, "comment_posted");
  assert.equal(result.target.number, 5);
  assert.equal(
    calls.some(
      (call) => call.file === "gh" && call.args[0] === "issue" && call.args[1] === "comment"
    ),
    true
  );
});
