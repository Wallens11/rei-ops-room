/**
 * Demo server — wraps createServer() with fully fake injected dependencies.
 *
 * Usage:
 *   DEMO_MODE=true npm start
 *   npm run demo
 *
 * No GitHub auth, no Codex state DB, no AI runtime needed.
 * All data is simulated by tools/demo-data.mjs.
 */

import { createServer } from "../server.mjs";
import {
  buildDemoGithubIssues,
  buildDemoExecutePreview,
  buildDemoServiceStatus,
  buildDemoMetrics,
  buildDemoArtifacts,
  buildDemoQueue,
  buildDemoWorkers,
  buildDemoRoomStatus
} from "./demo-data.mjs";

export function createDemoServer(options = {}) {
  return createServer({
    ...options,
    demoMode: true,

    // ── Core status ────────────────────────────────────────────────────────────
    getStatus: async () => buildDemoRoomStatus(),

    // ── Daily handoff ──────────────────────────────────────────────────────────
    getDailyDeviceHandoff: async () => ({
      date: new Date().toISOString().slice(0, 10),
      todayAtAGlance: "Demo mode — simulated handoff. No real runs recorded today.",
      recentRuns: [],
      nextUp: "Issue #40: Write unit tests for auth middleware",
      generated: false
    }),

    // ── GitHub issues ──────────────────────────────────────────────────────────
    inferGithubRepoSlug: async () => "demo-user/my-app",
    listGithubIssues: async () => buildDemoGithubIssues(),

    // ── Execute preview + service ──────────────────────────────────────────────
    previewExecuteAction: async () => buildDemoExecutePreview(),

    getExecuteServiceStatus: async () => buildDemoServiceStatus(),

    controlExecuteService: async ({ action }) => ({
      ...buildDemoServiceStatus(),
      pendingAction: action,
      demo: true,
      message: `Demo mode: '${action}' simulated but not applied.`
    }),

    approveIssue: async ({ issueNumber }) => ({
      approved: false,
      issueNumber,
      repo: "demo-user/my-app",
      demo: true,
      message: "Demo mode: approval simulated but not applied."
    }),

    // ── Report-only service ────────────────────────────────────────────────────
    previewReportOnlyAction: async () => ({
      status: "no_target",
      target: null,
      demo: true
    }),

    getReportOnlyServiceStatus: async () => ({
      running: false,
      pid: null,
      source: null,
      detail: "Demo mode — report-only worker not started."
    }),

    controlReportOnlyService: async () => ({
      running: false,
      demo: true
    }),

    postReportOnlyAction: async () => ({
      posted: false,
      demo: true,
      message: "Demo mode: report-only action simulated but not posted."
    }),

    // ── Queue & workers ────────────────────────────────────────────────────────
    readQueue: async () => buildDemoQueue().tasks,
    readWorkers: async () => buildDemoWorkers(),

    removeQueueTask: async () => ({
      removed: false,
      demo: true
    }),

    // ── Runtimes ───────────────────────────────────────────────────────────────
    listRuntimes: async () => ({
      runtimes: [
        { id: "claude-code", label: "Claude Code", available: true },
        { id: "codex", label: "Codex", available: true }
      ],
      available: ["claude-code", "codex"],
      preferences: {
        frontend: ["claude-code"],
        backend: ["codex", "claude-code"],
        general: ["claude-code"]
      }
    }),

    // ── Run ledger ─────────────────────────────────────────────────────────────
    getRunLedger: async () => {
      const metrics = buildDemoMetrics();
      return {
        totalRuns: metrics.totalRuns,
        byDate: {
          [new Date().toISOString().slice(0, 10)]: { completed: 1, failed: 0, total: 1 },
          [new Date(Date.now() - 86400000).toISOString().slice(0, 10)]: { completed: 3, failed: 1, total: 4 },
          [new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10)]: { completed: 2, failed: 1, total: 3 }
        },
        byRuntime: metrics.byRuntime,
        costNote: "Demo mode — no real cost data.",
        recent: metrics.recentRuns
      };
    },

    // ── Artifacts ─────────────────────────────────────────────────────────────
    listArtifacts: async () => buildDemoArtifacts(),
    readArtifact: async () => null,

    // ── Metrics ───────────────────────────────────────────────────────────────
    getMetrics: async () => buildDemoMetrics(),
    getLivePanels: async () => ({
      generatedAt: new Date().toISOString(),
      queue: buildDemoQueue(),
      metrics: buildDemoMetrics(),
      costs: {
        total: { runs: 0, cost: 0 },
        summary: "Demo mode — no real cost data."
      }
    }),

    // ── Webhook ────────────────────────────────────────────────────────────────
    handleGithubWebhook: async () => ({
      valid: true,
      triggered: false,
      demo: true,
      message: "Demo mode: webhook received but not processed."
    })
  });
}
