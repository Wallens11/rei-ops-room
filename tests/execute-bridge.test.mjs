import test from "node:test";
import assert from "node:assert/strict";

import {
  buildExecutePrompt,
  prepareExecuteAction,
  selectExecuteTarget
} from "../tools/execute-bridge.mjs";

test("selectExecuteTarget prefers an active execute issue and ignores report-only work", () => {
  const target = selectExecuteTarget({
    issues: [
      {
        number: 10,
        title: "Viewer report-only preview and manual trigger",
        createdAt: "2026-04-02T01:00:00Z",
        updatedAt: "2026-04-02T01:05:00Z",
        url: "https://github.com/Wallens11/rei-ops-room/issues/10",
        labels: ["agent:rei", "status:in_progress", "mode:report_only"]
      },
      {
        number: 11,
        title: "Queue-driven execute service for issue mode",
        createdAt: "2026-04-02T02:00:00Z",
        updatedAt: "2026-04-02T02:10:00Z",
        url: "https://github.com/Wallens11/rei-ops-room/issues/11",
        labels: ["agent:rei", "status:todo", "mode:execute"]
      },
      {
        number: 12,
        title: "Executor should claim and run the active issue",
        createdAt: "2026-04-02T03:00:00Z",
        updatedAt: "2026-04-02T03:05:00Z",
        url: "https://github.com/Wallens11/rei-ops-room/issues/12",
        labels: ["agent:rei", "status:in_progress", "mode:execute"]
      }
    ]
  });

  assert.equal(target.status, "in_progress");
  assert.equal(target.issue.number, 12);
});

test("buildExecutePrompt folds issue scope and handoff context into one launch prompt", () => {
  const prompt = buildExecutePrompt({
    repo: "Wallens11/rei-ops-room",
    repoCwd: "/Users/funtoco/workSpace/codex-pixel-agent",
    issue: {
      number: 14,
      title: "Add execute mode to the ops room queue",
      body: "## Scope\n- claim mode:execute issues\n- launch Codex from the worker\n- report the result back to GitHub",
      url: "https://github.com/Wallens11/rei-ops-room/issues/14",
      labels: ["agent:rei", "status:todo", "mode:execute"]
    },
    handoff: {
      date: "2026-04-02",
      sections: [
        {
          title: "Today At A Glance",
          items: ["Scrapling is installed and available in Codex MCP."]
        }
      ]
    }
  });

  assert.match(prompt, /GitHub issue #14/i);
  assert.match(prompt, /claim mode:execute issues/i);
  assert.match(prompt, /Scrapling is installed and available/i);
  assert.match(prompt, /Do not push or create a PR unless explicitly asked/i);
});

test("prepareExecuteAction returns the next execute issue with a launch prompt", async () => {
  const preview = await prepareExecuteAction({
    repo: "Wallens11/rei-ops-room",
    handoff: {
      date: "2026-04-02",
      sections: [
        {
          title: "Today At A Glance",
          items: ["Cross-device handoff is the current continuity source."]
        }
      ]
    },
    runner: async (file, args) => {
      if (file === "gh" && args[0] === "issue" && args[1] === "list") {
        return {
          stdout: JSON.stringify([
            {
              number: 15,
              title: "Agent execute queue MVP",
              state: "OPEN",
              createdAt: "2026-04-02T02:00:00Z",
              updatedAt: "2026-04-02T02:00:00Z",
              url: "https://github.com/Wallens11/rei-ops-room/issues/15",
              labels: [{ name: "agent:rei" }, { name: "status:todo" }, { name: "mode:execute" }],
              assignees: [],
              author: { login: "Wallens11" }
            }
          ])
        };
      }

      if (file === "gh" && args[0] === "issue" && args[1] === "view") {
        return {
          stdout: JSON.stringify({
            number: 15,
            title: "Agent execute queue MVP",
            body: "## Scope\n- pick the next mode:execute issue\n- start Codex\n- comment the result",
            url: "https://github.com/Wallens11/rei-ops-room/issues/15",
            labels: [{ name: "agent:rei" }, { name: "status:todo" }, { name: "mode:execute" }],
            comments: []
          })
        };
      }

      throw new Error(`Unexpected call: ${file} ${args.join(" ")}`);
    }
  });

  assert.equal(preview.status, "ready");
  assert.equal(preview.target.number, 15);
  assert.match(preview.prompt, /start Codex/i);
  assert.match(preview.prompt, /Cross-device handoff is the current continuity source/i);
});

test("prepareExecuteAction can auto-pick the next roadmap child when no explicit execute issue is queued", async () => {
  const preview = await prepareExecuteAction({
    repo: "Wallens11/rei-ops-room",
    handoff: {
      date: "2026-04-02",
      sections: []
    },
    runner: async (file, args) => {
      if (file === "gh" && args[0] === "issue" && args[1] === "list") {
        return {
          stdout: JSON.stringify([
            {
              number: 13,
              title: "Roadmap: Paperclip-lite gap map for Rei Ops Room",
              state: "OPEN",
              createdAt: "2026-04-02T01:00:00Z",
              updatedAt: "2026-04-02T03:00:00Z",
              url: "https://github.com/Wallens11/rei-ops-room/issues/13",
              labels: [{ name: "agent:rei" }],
              assignees: [],
              author: { login: "Wallens11" }
            },
            {
              number: 15,
              title: "Approval-gated execution lane beyond report-only",
              state: "OPEN",
              createdAt: "2026-04-02T01:10:00Z",
              updatedAt: "2026-04-02T03:10:00Z",
              url: "https://github.com/Wallens11/rei-ops-room/issues/15",
              labels: [{ name: "agent:rei" }, { name: "status:todo" }, { name: "mode:report_only" }],
              assignees: [],
              author: { login: "Wallens11" }
            },
            {
              number: 16,
              title: "Runtime registry for Codex and Claude workers",
              state: "OPEN",
              createdAt: "2026-04-02T01:20:00Z",
              updatedAt: "2026-04-02T03:20:00Z",
              url: "https://github.com/Wallens11/rei-ops-room/issues/16",
              labels: [{ name: "agent:rei" }, { name: "status:todo" }, { name: "mode:report_only" }],
              assignees: [],
              author: { login: "Wallens11" }
            }
          ])
        };
      }

      if (file === "gh" && args[0] === "issue" && args[1] === "view" && args[2] === "13") {
        return {
          stdout: JSON.stringify({
            number: 13,
            title: "Roadmap: Paperclip-lite gap map for Rei Ops Room",
            body: "Child issues for this roadmap:\n- #14\n- #15\n- #16",
            url: "https://github.com/Wallens11/rei-ops-room/issues/13",
            labels: [{ name: "agent:rei" }],
            comments: [
              {
                body: "Recommended next pickup from home: #15"
              }
            ]
          })
        };
      }

      if (file === "gh" && args[0] === "issue" && args[1] === "view" && args[2] === "15") {
        return {
          stdout: JSON.stringify({
            number: 15,
            title: "Approval-gated execution lane beyond report-only",
            body: "## Scope\n- auto-pick the next child issue from roadmap context",
            url: "https://github.com/Wallens11/rei-ops-room/issues/15",
            labels: [{ name: "agent:rei" }, { name: "status:todo" }, { name: "mode:report_only" }],
            comments: []
          })
        };
      }

      throw new Error(`Unexpected call: ${file} ${args.join(" ")}`);
    }
  });

  assert.equal(preview.status, "roadmap_ready");
  assert.equal(preview.target.number, 15);
  assert.equal(preview.target.roadmap.number, 13);
  assert.match(preview.detail, /roadmap #13/i);
  assert.match(preview.prompt, /issue #15/i);
});

test("prepareExecuteAction halts the roadmap queue when the next child is blocked", async () => {
  const preview = await prepareExecuteAction({
    repo: "Wallens11/rei-ops-room",
    handoff: {
      date: "2026-04-02",
      sections: []
    },
    runner: async (file, args) => {
      if (file === "gh" && args[0] === "issue" && args[1] === "list") {
        return {
          stdout: JSON.stringify([
            {
              number: 13,
              title: "Roadmap: Paperclip-lite gap map for Rei Ops Room",
              state: "OPEN",
              createdAt: "2026-04-02T01:00:00Z",
              updatedAt: "2026-04-02T03:00:00Z",
              url: "https://github.com/Wallens11/rei-ops-room/issues/13",
              labels: [{ name: "agent:rei" }],
              assignees: [],
              author: { login: "Wallens11" }
            },
            {
              number: 15,
              title: "Approval-gated execution lane beyond report-only",
              state: "OPEN",
              createdAt: "2026-04-02T01:10:00Z",
              updatedAt: "2026-04-02T03:10:00Z",
              url: "https://github.com/Wallens11/rei-ops-room/issues/15",
              labels: [{ name: "agent:rei" }, { name: "status:blocked" }, { name: "mode:report_only" }],
              assignees: [],
              author: { login: "Wallens11" }
            },
            {
              number: 16,
              title: "Runtime registry for Codex and Claude workers",
              state: "OPEN",
              createdAt: "2026-04-02T01:20:00Z",
              updatedAt: "2026-04-02T03:20:00Z",
              url: "https://github.com/Wallens11/rei-ops-room/issues/16",
              labels: [{ name: "agent:rei" }, { name: "status:todo" }, { name: "mode:report_only" }],
              assignees: [],
              author: { login: "Wallens11" }
            }
          ])
        };
      }

      if (file === "gh" && args[0] === "issue" && args[1] === "view" && args[2] === "13") {
        return {
          stdout: JSON.stringify({
            number: 13,
            title: "Roadmap: Paperclip-lite gap map for Rei Ops Room",
            body: "Child issues for this roadmap:\n- #15\n- #16",
            url: "https://github.com/Wallens11/rei-ops-room/issues/13",
            labels: [{ name: "agent:rei" }],
            comments: []
          })
        };
      }

      throw new Error(`Unexpected call: ${file} ${args.join(" ")}`);
    }
  });

  assert.equal(preview.status, "roadmap_blocked");
  assert.equal(preview.target.number, 15);
  assert.equal(preview.target.roadmap.number, 13);
  assert.match(preview.detail, /blocked/i);
  assert.equal(preview.prompt, null);
});
