import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeRestIssue,
  createGithubRunner
} from "../tools/github-api.mjs";

// ── normalizeRestIssue ─────────────────────────────────────────────────────

describe("normalizeRestIssue", () => {
  it("maps REST API fields to gh CLI shape", () => {
    const raw = {
      number: 42,
      title: "Fix bug",
      state: "open",
      created_at: "2024-01-01T00:00:00Z",
      updated_at: "2024-01-02T00:00:00Z",
      html_url: "https://github.com/owner/repo/issues/42",
      labels: [{ id: 1, name: "bug", color: "d73a4a" }],
      assignees: [{ login: "alice" }],
      user: { login: "bob" }
    };
    const issue = normalizeRestIssue(raw);
    assert.equal(issue.number, 42);
    assert.equal(issue.title, "Fix bug");
    assert.equal(issue.state, "open");
    assert.equal(issue.url, "https://github.com/owner/repo/issues/42");
    assert.deepEqual(issue.labels, [{ id: 1, name: "bug", color: "d73a4a" }]);
    assert.deepEqual(issue.assignees, [{ login: "alice" }]);
    assert.deepEqual(issue.author, { login: "bob" });
  });

  it("handles missing optional fields gracefully", () => {
    const issue = normalizeRestIssue({ number: 1, title: "t" });
    assert.deepEqual(issue.labels, []);
    assert.deepEqual(issue.assignees, []);
    assert.deepEqual(issue.author, { login: "" });
  });
});

// ── createGithubRunner ─────────────────────────────────────────────────────

describe("createGithubRunner", () => {
  /** Build a mock fetchFn that returns the given body as JSON. */
  function mockFetch(responses) {
    const queue = [...responses];
    return async function fakeFetch(url, opts) {
      const body = queue.shift() ?? { __default: true };
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify(body)
      };
    };
  }

  it("routes gh issue list to REST API", async () => {
    const fakeIssues = [
      {
        number: 1,
        title: "Issue 1",
        state: "open",
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-02T00:00:00Z",
        html_url: "https://github.com/o/r/issues/1",
        labels: [],
        assignees: [],
        user: { login: "alice" }
      }
    ];
    const runner = createGithubRunner({
      token: "fake-token",
      fetchFn: mockFetch([fakeIssues])
    });
    const result = await runner("gh", [
      "issue", "list",
      "--repo", "owner/repo",
      "--state", "open",
      "--limit", "10",
      "--json", "number,title"
    ]);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].number, 1);
    assert.equal(parsed[0].url, "https://github.com/o/r/issues/1");
  });

  it("routes gh issue view to REST API (fetches issue + comments)", async () => {
    const fakeIssue = {
      number: 5,
      title: "Bug",
      body: "desc",
      html_url: "https://github.com/o/r/issues/5",
      labels: [{ name: "bug" }],
      user: { login: "alice" }
    };
    const fakeComments = [
      { body: "first comment", user: { login: "bob" } }
    ];
    const runner = createGithubRunner({
      token: "fake-token",
      fetchFn: mockFetch([fakeIssue, fakeComments])
    });
    const result = await runner("gh", [
      "issue", "view", "5",
      "--repo", "owner/repo",
      "--json", "number,title,body,url,labels,comments"
    ]);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.number, 5);
    assert.deepEqual(parsed.labels, ["bug"]);
    assert.equal(parsed.comments[0].body, "first comment");
  });

  it("routes gh issue create to REST API and returns URL", async () => {
    const fakeCreated = { html_url: "https://github.com/o/r/issues/99" };
    const runner = createGithubRunner({
      token: "fake-token",
      fetchFn: mockFetch([fakeCreated])
    });
    const result = await runner("gh", [
      "issue", "create",
      "--title", "New issue",
      "--body", "body text",
      "--label", "agent:rei",
      "--repo", "owner/repo"
    ]);
    assert.equal(result.stdout.trim(), "https://github.com/o/r/issues/99");
  });

  it("falls back to fallbackRunner for non-gh commands", async () => {
    let called = null;
    const fallback = async (cmd, args) => { called = { cmd, args }; return { stdout: "main\n", stderr: "" }; };
    const runner = createGithubRunner({ token: "tok", fetchFn: mockFetch([]), fallbackRunner: fallback });
    const result = await runner("git", ["remote", "get-url", "origin"]);
    assert.equal(result.stdout, "main\n");
    assert.equal(called?.cmd, "git");
  });

  it("falls back to fallbackRunner when no token is set", async () => {
    const origToken = process.env.GITHUB_TOKEN;
    delete process.env.GITHUB_TOKEN;
    try {
      let called = false;
      const fallback = async () => { called = true; return { stdout: "ok", stderr: "" }; };
      const runner = createGithubRunner({ fetchFn: mockFetch([]), fallbackRunner: fallback });
      await runner("gh", ["issue", "list", "--repo", "o/r"]);
      assert.ok(called, "should have called fallback when no token");
    } finally {
      if (origToken !== undefined) process.env.GITHUB_TOKEN = origToken;
    }
  });
});
