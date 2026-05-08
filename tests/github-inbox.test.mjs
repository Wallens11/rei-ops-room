import test from "node:test";
import assert from "node:assert/strict";

import {
  buildGithubInboxViewModel,
  createEmptyGithubInboxState,
  createGithubInboxErrorState,
  normalizeGithubInboxPayload
} from "../public/github-inbox.js";

test("normalizeGithubInboxPayload shapes GitHub issue data for the viewer panel", () => {
  const inbox = normalizeGithubInboxPayload(
    {
      repo: "example-org/my-project",
      filters: {
        state: "open",
        labels: ["agent:rei"],
        limit: 20
      },
      summary: {
        total: 2,
        todo: 1,
        inProgress: 1,
        blocked: 0
      },
      issues: [
        {
          number: 2,
          title: "GitHub issue-driven assistant workflow for cross-device task handling",
          state: "OPEN",
          updatedAt: "2026-03-31T01:20:00Z",
          url: "https://github.com/example-org/my-project/issues/2",
          labels: ["agent:rei", "status:todo"]
        },
        {
          number: 3,
          title: "Viewer inbox panel",
          state: "OPEN",
          updatedAt: "2026-03-31T02:00:00Z",
          url: "https://github.com/example-org/my-project/issues/3",
          labels: ["agent:rei", "status:in_progress"]
        }
      ]
    },
    "2026-03-31T02:10:00Z"
  );

  assert.equal(inbox.status, "ready");
  assert.equal(inbox.repo, "example-org/my-project");
  assert.equal(inbox.syncedAt, "2026-03-31T02:10:00Z");
  assert.deepEqual(inbox.summary, {
    total: 2,
    todo: 1,
    inProgress: 1,
    blocked: 0
  });
  assert.deepEqual(inbox.issues[1], {
    number: 3,
    title: "Viewer inbox panel",
    state: "OPEN",
    updatedAt: "2026-03-31T02:00:00Z",
    url: "https://github.com/example-org/my-project/issues/3",
    labels: ["agent:rei", "status:in_progress"],
    status: "in_progress"
  });
});

test("buildGithubInboxViewModel exposes summary and issue rows for the panel", () => {
  const model = buildGithubInboxViewModel(
    normalizeGithubInboxPayload(
      {
        repo: "example-org/my-project",
        filters: {
          state: "open",
          labels: ["agent:rei"],
          limit: 20
        },
        summary: {
          total: 2,
          todo: 1,
          inProgress: 1,
          blocked: 0
        },
        planner: {
          status: "active",
          activeCount: 1,
          blockedCount: 0,
          activeIssue: {
            number: 3,
            title: "Viewer inbox panel",
            updatedAt: "2026-03-31T02:00:00Z",
            status: "in_progress",
            url: "https://github.com/example-org/my-project/issues/3"
          },
          suggestedIssue: {
            number: 2,
            title: "GitHub issue-driven assistant workflow for cross-device task handling",
            updatedAt: "2026-03-31T01:20:00Z",
            status: "todo",
            url: "https://github.com/example-org/my-project/issues/2"
          }
        },
        issues: [
          {
            number: 2,
            title: "GitHub issue-driven assistant workflow for cross-device task handling",
            state: "OPEN",
            updatedAt: "2026-03-31T01:20:00Z",
            url: "https://github.com/example-org/my-project/issues/2",
            labels: ["agent:rei", "status:todo"]
          },
          {
            number: 3,
            title: "Viewer inbox panel",
            state: "OPEN",
            updatedAt: "2026-03-31T02:00:00Z",
            url: "https://github.com/example-org/my-project/issues/3",
            labels: ["agent:rei", "status:in_progress"]
          }
        ]
      },
      "2026-03-31T02:10:00Z"
    )
  );

  assert.equal(model.title, "example-org/my-project");
  assert.equal(model.chip, "2 open");
  assert.equal(model.queueTitle, "Active Queue: #3 Viewer inbox panel");
  assert.equal(
    model.queueDetail,
    "Next: #2 GitHub issue-driven assistant workflow for cross-device task handling"
  );
  assert.match(model.meta, /1 todo/i);
  assert.match(model.meta, /1 in progress/i);
  assert.equal(model.rows.length, 2);
  assert.deepEqual(model.rows[0], {
    id: "issue-2",
    title: "#2 GitHub issue-driven assistant workflow for cross-device task handling",
    href: "https://github.com/example-org/my-project/issues/2",
    detail: "status:todo | agent:rei",
    meta: "updated 2026-03-31 01:20 UTC",
    tone: "todo"
  });
});

test("buildGithubInboxViewModel falls back to a suggested queue when nothing is in progress", () => {
  const model = buildGithubInboxViewModel(
    normalizeGithubInboxPayload(
      {
        repo: "example-org/my-project",
        filters: {
          state: "open",
          labels: ["agent:rei"],
          limit: 20
        },
        summary: {
          total: 1,
          todo: 1,
          inProgress: 0,
          blocked: 0
        },
        planner: {
          status: "queued",
          activeCount: 0,
          blockedCount: 0,
          activeIssue: null,
          suggestedIssue: {
            number: 2,
            title: "GitHub issue-driven assistant workflow for cross-device task handling",
            updatedAt: "2026-03-31T01:20:00Z",
            status: "todo",
            url: "https://github.com/example-org/my-project/issues/2"
          }
        },
        issues: [
          {
            number: 2,
            title: "GitHub issue-driven assistant workflow for cross-device task handling",
            state: "OPEN",
            updatedAt: "2026-03-31T01:20:00Z",
            url: "https://github.com/example-org/my-project/issues/2",
            labels: ["agent:rei", "status:todo"]
          }
        ]
      },
      "2026-03-31T02:10:00Z"
    )
  );

  assert.equal(model.queueTitle, "Suggested Next: #2 GitHub issue-driven assistant workflow for cross-device task handling");
  assert.equal(model.queueDetail, "Queue idle, safe to pick the first todo item.");
});

test("createGithubInboxErrorState keeps the last inbox snapshot visible during failures", () => {
  const previous = normalizeGithubInboxPayload(
    {
      repo: "example-org/my-project",
      filters: {
        state: "open",
        labels: ["agent:rei"],
        limit: 20
      },
      summary: {
        total: 1,
        todo: 1,
        inProgress: 0,
        blocked: 0
      },
      issues: [
        {
          number: 2,
          title: "GitHub issue-driven assistant workflow for cross-device task handling",
          state: "OPEN",
          updatedAt: "2026-03-31T01:20:00Z",
          url: "https://github.com/example-org/my-project/issues/2",
          labels: ["agent:rei", "status:todo"]
        }
      ]
    },
    "2026-03-31T02:10:00Z"
  );

  const errored = createGithubInboxErrorState(
    previous,
    new Error("GitHub inbox temporarily unavailable"),
    "2026-03-31T02:30:00Z"
  );
  const model = buildGithubInboxViewModel(errored);

  assert.equal(errored.status, "error");
  assert.equal(errored.syncedAt, "2026-03-31T02:30:00Z");
  assert.equal(errored.issues.length, 1);
  assert.equal(model.chip, "offline");
  assert.match(model.meta, /temporarily unavailable/i);
  assert.equal(model.rows[0].title, "#2 GitHub issue-driven assistant workflow for cross-device task handling");
});

test("buildGithubInboxViewModel shows an empty-state message when no issues match", () => {
  const model = buildGithubInboxViewModel(createEmptyGithubInboxState());

  assert.equal(model.chip, "idle");
  assert.equal(model.rows.length, 1);
  assert.match(model.rows[0].title, /No matching issues/i);
});
