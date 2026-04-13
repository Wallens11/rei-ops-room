import test from "node:test";
import assert from "node:assert/strict";

import {
  buildExecutePrompt,
  selectExecuteSkillProfile,
  prepareExecuteAction,
  readRepoDesignProfile,
  selectExecuteTarget,
  approveExecuteIssue,
  countExecuteAttempts,
  getLastExecuteAttemptMs,
  isBlockedIssueRetryEligible
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

test("readRepoDesignProfile reads the local repo DESIGN.md when present", () => {
  const profile = readRepoDesignProfile("/Users/funtoco/workSpace/codex-pixel-agent");

  assert.equal(profile.brand, "Cursor");
  assert.match(profile.title, /Cursor/i);
  assert.match(profile.path, /DESIGN\.md$/);
});

test("selectExecuteSkillProfile chooses a frontend specialist bundle for UI-heavy issues", () => {
  const profile = selectExecuteSkillProfile({
    title: "Polish the Execute Agent panel layout",
    body: "Improve the viewer UI, spacing, button states, responsive layout, and styling for the room panel."
  });

  assert.equal(profile.id, "frontend");
  assert.match(profile.label, /frontend/i);
  assert.ok(profile.skills.some((skill) => skill.id === "frontend-design"));
  assert.ok(profile.skills.some((skill) => skill.id === "arrange"));
});

test("selectExecuteSkillProfile chooses a scraping specialist bundle for scraping issues", () => {
  const profile = selectExecuteSkillProfile({
    title: "Scrape inquiry pages through the bridge",
    body: "Use browser automation or scraping to extract page data and keep a fallback when anti-bot protection appears."
  });

  assert.equal(profile.id, "scraping");
  assert.ok(profile.skills.some((skill) => skill.id === "scrapling-official"));
  assert.ok(profile.skills.some((skill) => skill.id === "playwright"));
});

test("selectExecuteSkillProfile prefers backend specialist when integration keywords dominate", () => {
  const profile = selectExecuteSkillProfile({
    title: "Realtime GitHub intake and queue refresh bridge",
    body: "Add a webhook bridge, update the queue when issue labels change, keep the polling fallback, and preserve the server-side workflow."
  });

  assert.equal(profile.id, "backend");
  assert.ok(profile.skills.some((skill) => skill.id === "systematic-debugging"));
});

test("buildExecutePrompt includes the recommended specialist profile and skills", () => {
  const prompt = buildExecutePrompt({
    repo: "Wallens11/rei-ops-room",
    repoCwd: "/Users/funtoco/workSpace/codex-pixel-agent",
    issue: {
      number: 19,
      title: "Polish the Execute Agent panel layout",
      body: "Improve the viewer UI, spacing, button states, responsive layout, and styling for the room panel.",
      url: "https://github.com/Wallens11/rei-ops-room/issues/19",
      labels: ["agent:rei", "mode:execute", "status:todo"]
    },
    handoff: {
      date: "2026-04-02",
      sections: []
    }
  });

  assert.match(prompt, /Suggested specialist profile/i);
  assert.match(prompt, /frontend/i);
  assert.match(prompt, /frontend-design/i);
  assert.match(prompt, /arrange/i);
  assert.match(prompt, /Active design guidance/i);
  assert.match(prompt, /Cursor inspired DESIGN\.md/i);
});

test("prepareExecuteAction returns the next execute issue with a launch prompt when status:approved", async () => {
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
              labels: [{ name: "agent:rei" }, { name: "status:approved" }, { name: "mode:execute" }],
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
            labels: [{ name: "agent:rei" }, { name: "status:approved" }, { name: "mode:execute" }],
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

test("prepareExecuteAction returns awaiting_approval when issue has mode:execute but no status:approved", async () => {
  const preview = await prepareExecuteAction({
    repo: "Wallens11/rei-ops-room",
    handoff: { date: "2026-04-02", sections: [] },
    runner: async (file, args) => {
      if (file === "gh" && args[0] === "issue" && args[1] === "list") {
        return {
          stdout: JSON.stringify([
            {
              number: 17,
              title: "Issue needing approval",
              state: "OPEN",
              createdAt: "2026-04-02T02:00:00Z",
              updatedAt: "2026-04-02T02:00:00Z",
              url: "https://github.com/Wallens11/rei-ops-room/issues/17",
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
            number: 17,
            title: "Issue needing approval",
            body: "## Scope\n- needs approval first",
            url: "https://github.com/Wallens11/rei-ops-room/issues/17",
            labels: [{ name: "agent:rei" }, { name: "status:todo" }, { name: "mode:execute" }],
            comments: []
          })
        };
      }

      throw new Error(`Unexpected call: ${file} ${args.join(" ")}`);
    }
  });

  assert.equal(preview.status, "awaiting_approval");
  assert.equal(preview.target.number, 17);
  assert.equal(preview.prompt, null);
  assert.match(preview.detail, /needs explicit approval/i);
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

test("selectExecuteTarget skips an in_progress issue updated within the claim cooldown window", () => {
  const recentMs = Date.now() - 5000; // 5 detik lalu — dalam cooldown
  const recentIso = new Date(recentMs).toISOString();

  const target = selectExecuteTarget(
    {
      issues: [
        {
          number: 20,
          title: "Active execute issue just claimed by another process",
          createdAt: "2026-04-02T01:00:00Z",
          updatedAt: recentIso,
          url: "https://github.com/Wallens11/rei-ops-room/issues/20",
          labels: ["agent:rei", "status:in_progress", "mode:execute"]
        },
        {
          number: 21,
          title: "Next todo execute issue",
          createdAt: "2026-04-02T02:00:00Z",
          updatedAt: "2026-04-02T02:00:00Z",
          url: "https://github.com/Wallens11/rei-ops-room/issues/21",
          labels: ["agent:rei", "status:todo", "mode:execute"]
        }
      ]
    },
    { nowMs: Date.now() }
  );

  // issue 20 di-skip karena cooldown, fallback ke issue 21 (awaiting_approval karena belum ada status:approved)
  assert.equal(target.status, "awaiting_approval");
  assert.equal(target.issue.number, 21);
});

test("selectExecuteTarget picks an in_progress issue that is outside the claim cooldown window", () => {
  const oldMs = Date.now() - 120_000; // 2 menit lalu — aman
  const oldIso = new Date(oldMs).toISOString();

  const target = selectExecuteTarget(
    {
      issues: [
        {
          number: 22,
          title: "Ongoing execute work, safe to resume",
          createdAt: "2026-04-02T01:00:00Z",
          updatedAt: oldIso,
          url: "https://github.com/Wallens11/rei-ops-room/issues/22",
          labels: ["agent:rei", "status:in_progress", "mode:execute"]
        }
      ]
    },
    { nowMs: Date.now() }
  );

  assert.equal(target.status, "in_progress");
  assert.equal(target.issue.number, 22);
});

test("countExecuteAttempts counts rei:execute started markers in comments", () => {
  const comments = [
    { body: "<!-- rei:execute issue=10 state=started -->\nRei picked up issue.", createdAt: "2026-04-01T10:00:00Z" },
    { body: "Some unrelated comment." },
    { body: "<!-- rei:execute issue=10 state=started -->\nRetrying.", createdAt: "2026-04-01T11:00:00Z" }
  ];
  assert.equal(countExecuteAttempts(comments), 2);
});

test("countExecuteAttempts returns 0 if no started markers exist", () => {
  const comments = [
    { body: "<!-- rei:execute issue=10 state=completed -->\nDone." },
    { body: "Planning notes" }
  ];
  assert.equal(countExecuteAttempts(comments), 0);
});

test("getLastExecuteAttemptMs returns the most recent started comment timestamp", () => {
  const t1 = "2026-04-01T10:00:00Z";
  const t2 = "2026-04-01T12:00:00Z";
  const comments = [
    { body: "<!-- rei:execute issue=10 state=started -->\nFirst try.", createdAt: t1 },
    { body: "Some other comment.", createdAt: "2026-04-01T11:00:00Z" },
    { body: "<!-- rei:execute issue=10 state=started -->\nSecond try.", createdAt: t2 }
  ];
  assert.equal(getLastExecuteAttemptMs(comments), Date.parse(t2));
});

test("isBlockedIssueRetryEligible returns true for a blocked issue with no prior attempts", () => {
  const issue = {
    number: 30,
    labels: ["agent:rei", "mode:execute", "status:blocked"]
  };
  const eligible = isBlockedIssueRetryEligible(issue, []);
  assert.equal(eligible, true);
});

test("isBlockedIssueRetryEligible returns false when max retries is reached", () => {
  const issue = {
    number: 31,
    labels: ["agent:rei", "mode:execute", "status:blocked"]
  };
  const comments = [
    { body: "<!-- rei:execute issue=31 state=started -->", createdAt: "2026-04-01T10:00:00Z" },
    { body: "<!-- rei:execute issue=31 state=started -->", createdAt: "2026-04-01T11:00:00Z" }
  ];
  const eligible = isBlockedIssueRetryEligible(issue, comments, { maxRetries: 2 });
  assert.equal(eligible, false);
});

test("isBlockedIssueRetryEligible returns false when backoff window has not passed", () => {
  const issue = {
    number: 32,
    labels: ["agent:rei", "mode:execute", "status:blocked"]
  };
  const recentMs = Date.now() - 60_000; // 1 menit lalu
  const comments = [
    { body: "<!-- rei:execute issue=32 state=started -->", createdAt: new Date(recentMs).toISOString() }
  ];
  // backoff pertama = 5 menit, belum lewat
  const eligible = isBlockedIssueRetryEligible(issue, comments, {
    maxRetries: 2,
    backoffMinutes: [5, 30],
    nowMs: Date.now()
  });
  assert.equal(eligible, false);
});

test("isBlockedIssueRetryEligible returns true when backoff window has passed", () => {
  const issue = {
    number: 33,
    labels: ["agent:rei", "mode:execute", "status:blocked"]
  };
  const oldMs = Date.now() - 10 * 60_000; // 10 menit lalu
  const comments = [
    { body: "<!-- rei:execute issue=33 state=started -->", createdAt: new Date(oldMs).toISOString() }
  ];
  // backoff pertama = 5 menit, sudah lewat
  const eligible = isBlockedIssueRetryEligible(issue, comments, {
    maxRetries: 2,
    backoffMinutes: [5, 30],
    nowMs: Date.now()
  });
  assert.equal(eligible, true);
});

test("selectExecuteSkillProfile weights title keywords more heavily than body keywords", () => {
  // "api" dan "server" ada di body tapi bukan title — frontend ada di title
  const profile = selectExecuteSkillProfile({
    title: "Fix the frontend layout panel widget",
    body: "There are some api and server calls involved but the main task is a UI fix."
  });
  assert.equal(profile.id, "frontend");
});

test("prepareExecuteAction retries a blocked execute issue after backoff has passed", async () => {
  const oldMs = Date.now() - 10 * 60_000; // 10 menit lalu — lewat backoff 5m

  const preview = await prepareExecuteAction({
    repo: "Wallens11/rei-ops-room",
    handoff: { date: "2026-04-06", sections: [] },
    runner: async (file, args) => {
      if (file === "gh" && args[0] === "issue" && args[1] === "list") {
        return {
          stdout: JSON.stringify([
            {
              number: 40,
              title: "Blocked execute issue eligible for retry",
              state: "OPEN",
              createdAt: "2026-04-01T01:00:00Z",
              updatedAt: "2026-04-01T02:00:00Z",
              url: "https://github.com/Wallens11/rei-ops-room/issues/40",
              labels: [{ name: "agent:rei" }, { name: "status:blocked" }, { name: "mode:execute" }],
              assignees: [],
              author: { login: "Wallens11" }
            }
          ])
        };
      }

      if (file === "gh" && args[0] === "issue" && args[1] === "view") {
        return {
          stdout: JSON.stringify({
            number: 40,
            title: "Blocked execute issue eligible for retry",
            body: "## Scope\n- Fix the broken worker flow",
            url: "https://github.com/Wallens11/rei-ops-room/issues/40",
            labels: [{ name: "agent:rei" }, { name: "status:blocked" }, { name: "mode:execute" }],
            comments: [
              {
                body: "<!-- rei:execute issue=40 state=started -->\nFirst attempt.",
                createdAt: new Date(oldMs).toISOString()
              }
            ]
          })
        };
      }

      throw new Error(`Unexpected call: ${file} ${args.join(" ")}`);
    }
  });

  assert.equal(preview.status, "retry");
  assert.equal(preview.target.number, 40);
  assert.match(preview.detail, /retry/i);
  assert.match(preview.detail, /40/);
  assert.ok(preview.prompt);
});

// ─── Approval gate ────────────────────────────────────────────────────────────

test("selectExecuteTarget returns 'approved' status for mode:execute + status:approved issue", () => {
  const target = selectExecuteTarget({
    issues: [
      {
        number: 30,
        title: "Explicitly approved execute issue",
        createdAt: "2026-04-07T01:00:00Z",
        updatedAt: "2026-04-07T01:00:00Z",
        url: "https://github.com/Wallens11/rei-ops-room/issues/30",
        labels: ["agent:rei", "status:approved", "mode:execute"]
      }
    ]
  });

  assert.equal(target.status, "approved");
  assert.equal(target.issue.number, 30);
});

test("selectExecuteTarget returns 'awaiting_approval' for mode:execute + status:todo without status:approved", () => {
  const target = selectExecuteTarget({
    issues: [
      {
        number: 31,
        title: "Issue pending approval",
        createdAt: "2026-04-07T01:00:00Z",
        updatedAt: "2026-04-07T01:00:00Z",
        url: "https://github.com/Wallens11/rei-ops-room/issues/31",
        labels: ["agent:rei", "status:todo", "mode:execute"]
      }
    ]
  });

  assert.equal(target.status, "awaiting_approval");
  assert.equal(target.issue.number, 31);
});

test("selectExecuteTarget prefers status:approved over status:todo (awaiting_approval)", () => {
  const target = selectExecuteTarget({
    issues: [
      {
        number: 32,
        title: "Pending approval issue",
        createdAt: "2026-04-07T01:00:00Z",
        updatedAt: "2026-04-07T01:00:00Z",
        url: "https://github.com/Wallens11/rei-ops-room/issues/32",
        labels: ["agent:rei", "status:todo", "mode:execute"]
      },
      {
        number: 33,
        title: "Explicitly approved issue",
        createdAt: "2026-04-07T01:01:00Z",
        updatedAt: "2026-04-07T01:01:00Z",
        url: "https://github.com/Wallens11/rei-ops-room/issues/33",
        labels: ["agent:rei", "status:approved", "mode:execute"]
      }
    ]
  });

  assert.equal(target.status, "approved");
  assert.equal(target.issue.number, 33);
});

test("selectExecuteTarget returns null when no execute issues exist", () => {
  const target = selectExecuteTarget({ issues: [] });
  assert.equal(target, null);
});

test("approveExecuteIssue adds status:approved and mode:execute labels", async () => {
  const calls = [];

  await approveExecuteIssue({
    repo: "Wallens11/rei-ops-room",
    issueNumber: 35,
    runner: async (file, args) => {
      calls.push({ file, args });
      return { stdout: "" };
    }
  });

  assert.equal(calls.length, 1);
  const ghArgs = calls[0].args;
  assert.ok(ghArgs.includes("edit"), "should call gh issue edit");
  assert.ok(ghArgs.includes("35") || ghArgs.includes(35), "should target issue 35");
  // Should add status:approved
  const addIdx = ghArgs.indexOf("--add-label");
  assert.ok(addIdx >= 0, "should have --add-label flag");
  const addValue = ghArgs[addIdx + 1] || "";
  assert.ok(addValue.includes("status:approved"), `--add-label should include status:approved, got: ${addValue}`);
});
