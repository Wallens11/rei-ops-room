/**
 * github-api.mjs — thin GitHub REST API client.
 *
 * Replaces `gh` CLI calls with native fetch so Rei can run without the
 * GitHub CLI installed. Authentication via GITHUB_TOKEN env var.
 *
 * Design:
 *   - All functions accept an optional { token, fetchFn } for testability.
 *   - createGithubRunner() returns an execFileAsync-compatible runner that
 *     routes `gh` commands to REST calls — drop-in for existing WithRunner fns.
 *
 * GitHub REST API docs: https://docs.github.com/en/rest
 */

const GITHUB_API = "https://api.github.com";

// ── Low-level client ───────────────────────────────────────────────────────

/**
 * Make a GitHub REST API request.
 * @param {string} method - HTTP method
 * @param {string} endpoint - path like "/repos/owner/repo/issues"
 * @param {object} [body] - request body (for POST/PATCH)
 * @param {{ token?: string, fetchFn?: Function }} [opts]
 */
export async function githubRequest(method, endpoint, body, { token, fetchFn = fetch } = {}) {
  const resolvedToken = token ?? process.env.GITHUB_TOKEN;
  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "rei-ops-room/0.2"
  };
  if (resolvedToken) headers["Authorization"] = `Bearer ${resolvedToken}`;

  const response = await fetchFn(`${GITHUB_API}${endpoint}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {})
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    const err = new Error(`GitHub API ${method} ${endpoint} → ${response.status}: ${text.slice(0, 200)}`);
    err.statusCode = response.status;
    throw err;
  }

  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

// ── Issue operations ───────────────────────────────────────────────────────

/**
 * List issues for a repo (matches `gh issue list --json` output shape).
 */
export async function listIssues(repo, {
  state = "open",
  labels = [],
  limit = 20,
  token,
  fetchFn
} = {}) {
  const [owner, repoName] = repo.split("/");
  const params = new URLSearchParams({
    state,
    per_page: String(Math.min(limit, 100)),
    page: "1"
  });
  if (labels.length > 0) params.set("labels", labels.join(","));

  const issues = await githubRequest("GET", `/repos/${owner}/${repoName}/issues?${params}`, undefined, { token, fetchFn });
  return (issues || []).map(normalizeRestIssue);
}

/**
 * Get a single issue (matches `gh issue view --json number,title,body,url,labels,comments`).
 */
export async function getIssue(repo, issueNumber, { token, fetchFn } = {}) {
  const [owner, repoName] = repo.split("/");
  const [issue, comments] = await Promise.all([
    githubRequest("GET", `/repos/${owner}/${repoName}/issues/${issueNumber}`, undefined, { token, fetchFn }),
    githubRequest("GET", `/repos/${owner}/${repoName}/issues/${issueNumber}/comments`, undefined, { token, fetchFn })
  ]);
  return {
    number: issue.number,
    title: issue.title,
    body: issue.body ?? "",
    url: issue.html_url,
    labels: (issue.labels ?? []).map((l) => (typeof l === "string" ? l : l.name)),
    comments: (comments ?? []).map((c) => ({ body: c.body, author: { login: c.user?.login ?? "" } }))
  };
}

/**
 * Add or remove labels on an issue.
 * Matches `gh issue edit --add-label X --remove-label Y` behaviour.
 */
export async function editIssueLabels(repo, issueNumber, { addLabels = [], removeLabels = [], token, fetchFn } = {}) {
  const [owner, repoName] = repo.split("/");

  // Fetch current labels first
  const issue = await githubRequest("GET", `/repos/${owner}/${repoName}/issues/${issueNumber}`, undefined, { token, fetchFn });
  const current = new Set((issue.labels ?? []).map((l) => (typeof l === "string" ? l : l.name)));

  for (const l of addLabels) current.add(l);
  for (const l of removeLabels) current.delete(l);

  await githubRequest("PATCH", `/repos/${owner}/${repoName}/issues/${issueNumber}`, {
    labels: [...current]
  }, { token, fetchFn });
}

/**
 * Post a comment on an issue.
 * Matches `gh issue comment --body-file` behaviour.
 */
export async function addComment(repo, issueNumber, body, { token, fetchFn } = {}) {
  const [owner, repoName] = repo.split("/");
  await githubRequest("POST", `/repos/${owner}/${repoName}/issues/${issueNumber}/comments`, {
    body
  }, { token, fetchFn });
}

/**
 * Close an issue.
 * Matches `gh issue close --reason completed/not-planned` behaviour.
 */
export async function closeIssue(repo, issueNumber, { reason = "completed", token, fetchFn } = {}) {
  const [owner, repoName] = repo.split("/");
  // GitHub REST API doesn't have a close reason — "not_planned" is state_reason
  const stateReason = reason === "not-planned" || reason === "not_planned" ? "not_planned" : "completed";
  await githubRequest("PATCH", `/repos/${owner}/${repoName}/issues/${issueNumber}`, {
    state: "closed",
    state_reason: stateReason
  }, { token, fetchFn });
}

/**
 * Create a new issue. Returns the issue URL.
 */
export async function createIssue(repo, { title, body = "", labels = [], token, fetchFn } = {}) {
  const [owner, repoName] = repo.split("/");
  const issue = await githubRequest("POST", `/repos/${owner}/${repoName}/issues`, {
    title,
    body,
    labels
  }, { token, fetchFn });
  return issue?.html_url ?? "";
}

// ── Shape normalisation ────────────────────────────────────────────────────

/**
 * Normalise a GitHub REST API issue to match the `gh issue list --json` shape.
 * The existing normalizeGithubIssue() in server.mjs expects this shape.
 */
export function normalizeRestIssue(issue) {
  return {
    number: issue.number,
    title: issue.title,
    state: issue.state,
    createdAt: issue.created_at,
    updatedAt: issue.updated_at,
    url: issue.html_url,
    labels: (issue.labels ?? []).map((l) => ({ id: l.id, name: l.name, color: l.color })),
    assignees: (issue.assignees ?? []).map((a) => ({ login: a.login })),
    author: { login: issue.user?.login ?? "" }
  };
}

// ── execFileAsync-compatible runner ───────────────────────────────────────

/**
 * Returns a runner compatible with the existing *WithRunner() functions.
 * When GITHUB_TOKEN is set, routes `gh` subcommands to the REST API.
 * Falls back to the real execFileAsync for any non-gh command (e.g. `git`).
 *
 * @param {{ token?: string, fetchFn?: Function, fallbackRunner?: Function }} [opts]
 */
export function createGithubRunner({ token, fetchFn, fallbackRunner } = {}) {
  const resolvedToken = token ?? process.env.GITHUB_TOKEN;

  return async function githubRunner(cmd, args, options = {}) {
    // Only intercept `gh` commands when a token is available
    if (cmd !== "gh" || !resolvedToken) {
      if (!fallbackRunner) throw new Error(`No fallback runner for command: ${cmd}`);
      return fallbackRunner(cmd, args, options);
    }

    const sub = args[0]; // "issue", "auth", etc.
    const sub2 = args[1]; // "list", "view", "edit", "comment", "close", "create"

    if (sub !== "issue") {
      if (!fallbackRunner) throw new Error(`Unsupported gh subcommand: ${sub}`);
      return fallbackRunner(cmd, args, options);
    }

    const repoIdx = args.indexOf("--repo");
    const repo = repoIdx !== -1 ? args[repoIdx + 1] : null;

    // gh issue list --repo X --state Y --label Z --limit N --json fields
    if (sub2 === "list") {
      const stateIdx = args.indexOf("--state");
      const state = stateIdx !== -1 ? args[stateIdx + 1] : "open";
      const labelArgs = [];
      for (let i = 0; i < args.length; i++) {
        if (args[i] === "--label" && args[i + 1]) labelArgs.push(args[++i]);
      }
      const limitIdx = args.indexOf("--limit");
      const limit = limitIdx !== -1 ? Number(args[limitIdx + 1]) : 20;

      const issues = await listIssues(repo, { state, labels: labelArgs, limit, token: resolvedToken, fetchFn });
      return { stdout: JSON.stringify(issues), stderr: "" };
    }

    // gh issue view N --repo X --json fields
    if (sub2 === "view") {
      const issueNumber = Number(args[2]);
      const issue = await getIssue(repo, issueNumber, { token: resolvedToken, fetchFn });
      return { stdout: JSON.stringify(issue), stderr: "" };
    }

    // gh issue edit N --repo X --add-label L --remove-label L
    if (sub2 === "edit") {
      const issueNumber = Number(args[2]);
      const addLabels = [], removeLabels = [];
      for (let i = 0; i < args.length; i++) {
        if (args[i] === "--add-label" && args[i + 1]) addLabels.push(args[++i]);
        if (args[i] === "--remove-label" && args[i + 1]) removeLabels.push(args[++i]);
      }
      await editIssueLabels(repo, issueNumber, { addLabels, removeLabels, token: resolvedToken, fetchFn });
      return { stdout: "", stderr: "" };
    }

    // gh issue comment N --repo X --body-file /path
    if (sub2 === "comment") {
      const issueNumber = Number(args[2]);
      const bodyFileIdx = args.indexOf("--body-file");
      if (bodyFileIdx === -1) throw new Error("gh issue comment: --body-file required");
      const { readFile } = await import("node:fs/promises");
      const body = await readFile(args[bodyFileIdx + 1], "utf8");
      await addComment(repo, issueNumber, body, { token: resolvedToken, fetchFn });
      return { stdout: "", stderr: "" };
    }

    // gh issue close N --repo X --reason R
    if (sub2 === "close") {
      const issueNumber = Number(args[2]);
      const reasonIdx = args.indexOf("--reason");
      const reason = reasonIdx !== -1 ? args[reasonIdx + 1] : "completed";
      await closeIssue(repo, issueNumber, { reason, token: resolvedToken, fetchFn });
      return { stdout: "", stderr: "" };
    }

    // gh issue create --title T --body B --label L --repo R
    if (sub2 === "create") {
      const titleIdx = args.indexOf("--title");
      const bodyIdx = args.indexOf("--body");
      const title = titleIdx !== -1 ? args[titleIdx + 1] : "Untitled";
      const body = bodyIdx !== -1 ? args[bodyIdx + 1] : "";
      const labelArgs = [];
      for (let i = 0; i < args.length; i++) {
        if (args[i] === "--label" && args[i + 1]) labelArgs.push(args[++i]);
      }
      const url = await createIssue(repo, { title, body, labels: labelArgs, token: resolvedToken, fetchFn });
      return { stdout: url + "\n", stderr: "" };
    }

    throw new Error(`Unsupported gh issue subcommand: ${sub2}`);
  };
}
