import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  classifyExecuteMissionResult,
  buildCodexExecInvocation,
  detectRateLimitFailure,
  executeNextIssue,
  findNewMeaningfulWorktreeChanges,
  listMeaningfulWorktreePaths,
  recoverStuckTasks,
  resolveCodexCommand
} from "../tools/execute-worker.mjs";

test("resolveCodexCommand prefers CODEX_BIN when provided", async () => {
  const command = await resolveCodexCommand({
    env: {
      CODEX_BIN: "/tmp/custom-codex"
    },
    fileExists: async () => false
  });

  assert.equal(command, "/tmp/custom-codex");
});

test("resolveCodexCommand falls back to the app bundle binary when it exists", async () => {
  const command = await resolveCodexCommand({
    env: {},
    fileExists: async (candidate) =>
      candidate === "/Applications/Codex.app/Contents/Resources/codex"
  });

  assert.equal(command, "/Applications/Codex.app/Contents/Resources/codex");
});

test("resolveCodexCommand falls back to plain codex when no absolute binary is available", async () => {
  const command = await resolveCodexCommand({
    env: {},
    fileExists: async () => false
  });

  assert.equal(command, "codex");
});

test("buildCodexExecInvocation places global flags before the exec subcommand", () => {
  const invocation = buildCodexExecInvocation({
    codexCommand: "/Applications/Codex.app/Contents/Resources/codex",
    repoCwd: "/Users/funtoco/workSpace/codex-pixel-agent",
    outputLastMessageFile: "/tmp/last-message.md"
  });

  assert.equal(invocation.command, "/Applications/Codex.app/Contents/Resources/codex");
  assert.deepEqual(invocation.args.slice(0, 6), [
    "-a",
    "never",
    "-s",
    "workspace-write",
    "exec",
    "-C"
  ]);
});

test("listMeaningfulWorktreePaths ignores execute runtime artifacts", async () => {
  const paths = await listMeaningfulWorktreePaths({
    cwd: "/Users/funtoco/workSpace/codex-pixel-agent",
    runner: async () => ({
      stdout: [
        " M README.md",
        "?? .execute-worker.log",
        "?? .execute-worker.pid",
        "?? .execute-worker-state.json",
        "?? .execute-runs/run-1/events.jsonl",
        "?? public/app.js",
        "R  tools/old.mjs -> tools/new.mjs"
      ].join("\n")
    })
  });

  assert.deepEqual(paths, ["README.md", "public/app.js", "tools/new.mjs"]);
});

test("findNewMeaningfulWorktreeChanges keeps only new repo changes", () => {
  const changes = findNewMeaningfulWorktreeChanges({
    beforePaths: ["README.md", "tools/existing.mjs"],
    afterPaths: ["README.md", "tools/existing.mjs", "public/app.js", ".execute-worker.log"]
  });

  assert.deepEqual(changes, ["public/app.js"]);
});

test("classifyExecuteMissionResult requires meaningful changes before auto-close", () => {
  assert.equal(
    classifyExecuteMissionResult({
      mission: {
        exitCode: 0,
        aborted: false
      },
      newChanges: []
    }),
    "review_needed"
  );

  assert.equal(
    classifyExecuteMissionResult({
      mission: {
        exitCode: 0,
        aborted: false
      },
      newChanges: ["public/app.js"]
    }),
    "completed"
  );
});

test("detectRateLimitFailure matches common provider overload messages", () => {
  assert.equal(
    detectRateLimitFailure({
      exitCode: 1,
      stderrText: "HTTP 529 overloaded, please retry later"
    }),
    true
  );

  assert.equal(
    detectRateLimitFailure({
      exitCode: 1,
      stdoutText: "quota exceeded"
    }),
    true
  );

  assert.equal(
    detectRateLimitFailure({
      exitCode: 1,
      stderrText: "syntax error"
    }),
    false
  );
});

test("executeNextIssue retries with the next runtime when the primary one is rate limited", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "rei-execute-fallback-"));
  const attemptedRuntimes = [];
  const stateChanges = [];
  const transitions = [];
  const comments = [];

  try {
    const result = await executeNextIssue({
      cwd: tempDir,
      repo: "Wallens11/rei-ops-room",
      availableRuntimes: ["claude-code", "codex"],
      previewAction: async () => ({
        repo: "Wallens11/rei-ops-room",
        status: "ready",
        target: {
          number: 26,
          title: "smart runtime routing",
          url: "https://github.com/Wallens11/rei-ops-room/issues/26",
          status: "todo"
        },
        issue: {
          number: 26,
          title: "smart runtime routing",
          body: "Route frontend-heavy work to Claude first, then fall back to Codex on rate limits.",
          url: "https://github.com/Wallens11/rei-ops-room/issues/26",
          labels: ["agent:rei", "mode:execute", "status:todo"]
        },
        skillProfile: {
          id: "frontend",
          label: "Frontend specialist"
        },
        prompt: "Implement smart runtime routing."
      }),
      listWorktreePaths: async ({ stage }) => (stage === "before" ? [] : ["public/app.js"]),
      loadRuntimeConfig: async () => ({
        preferences: {
          frontend: ["claude-code", "codex"],
          backend: ["codex", "claude-code"],
          scraping: ["codex"],
          docs: ["claude-code", "codex"],
          general: ["codex", "claude-code"]
        },
        rateLimitFallback: true
      }),
      runMission: async ({ runtimeId, runDir }) => {
        attemptedRuntimes.push(runtimeId);
        await fs.mkdir(runDir, { recursive: true });
        const outputLastMessageFile = path.join(runDir, "last-message.md");

        if (runtimeId === "claude-code") {
          await fs.writeFile(outputLastMessageFile, "Claude hit a rate limit.", "utf8");
          return {
            runtimeId,
            exitCode: 1,
            aborted: false,
            outputLastMessageFile,
            stderrText: "HTTP 529 overloaded"
          };
        }

        await fs.writeFile(outputLastMessageFile, "Codex implemented the runtime fallback flow.", "utf8");
        return {
          runtimeId,
          exitCode: 0,
          aborted: false,
          outputLastMessageFile,
          stdoutText: "Implemented runtime fallback."
        };
      },
      transitionIssueToInProgress: async ({ issueNumber }) => {
        transitions.push(`in_progress:${issueNumber}`);
      },
      transitionIssueToDone: async ({ issueNumber }) => {
        transitions.push(`done:${issueNumber}`);
      },
      transitionIssueToBlocked: async ({ issueNumber }) => {
        transitions.push(`blocked:${issueNumber}`);
      },
      postIssueComment: async ({ body }) => {
        comments.push(body);
      },
      onStateChange: async (nextState) => {
        stateChanges.push(nextState);
      }
    });

    assert.equal(result.status, "completed");
    assert.equal(result.runtimeId, "codex");
    assert.deepEqual(attemptedRuntimes, ["claude-code", "codex"]);
    assert.deepEqual(transitions, ["in_progress:26", "done:26"]);
    assert.ok(comments.some((body) => /Runtime plan: `claude-code` → `codex`/i.test(body)));
    assert.ok(comments.some((body) => /Runtime used: `codex`/i.test(body)));
    assert.ok(stateChanges.some((state) => /retrying with codex/i.test(state.detail || "")));
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("recoverStuckTasks is callable without throwing in a clean environment", async () => {
  const lines = [];
  const mockStdout = {
    write(line) {
      lines.push(line);
    }
  };

  await assert.doesNotReject(recoverStuckTasks({ stdout: mockStdout }));
  const warnLines = lines.filter((line) => line.includes("[warn]"));
  assert.equal(Array.isArray(warnLines), true);
});
