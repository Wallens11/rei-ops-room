function formatTarget(target) {
  if (!target?.number || !target?.title) {
    return "No active report-only issue.";
  }

  return `#${target.number} ${target.title}`;
}

export function createReportOnlyAutopilotState(saved = {}) {
  return {
    enabled: Boolean(saved.enabled),
    pending: Boolean(saved.pending),
    lastHandledIssueNumber: Number(saved.lastHandledIssueNumber || 0) || null
  };
}

export function shouldAutoTriggerReportOnly({
  autopilot = createReportOnlyAutopilotState(),
  reportOnly = {}
} = {}) {
  const targetNumber = Number(reportOnly?.target?.number || 0);

  return Boolean(
    autopilot.enabled &&
      !autopilot.pending &&
      reportOnly?.status === "ready" &&
      reportOnly?.canComment &&
      targetNumber > 0 &&
      autopilot.lastHandledIssueNumber !== targetNumber
  );
}

export function buildReportOnlyAutopilotViewModel({
  autopilot = createReportOnlyAutopilotState(),
  reportOnly = {}
} = {}) {
  const targetLabel = formatTarget(reportOnly?.target);

  if (!autopilot.enabled) {
    return {
      title: "Autopilot Off",
      detail: "Manual trigger only.",
      note: "Enable autopilot if you want the viewer to post one report-only pickup per active issue.",
      buttonLabel: "Enable Autopilot",
      buttonDisabled: false,
      tone: "idle"
    };
  }

  if (autopilot.pending) {
    return {
      title: "Autopilot Posting",
      detail: `Posting ${targetLabel}`,
      note: "Autopilot is posting the report-only pickup now.",
      buttonLabel: "Posting...",
      buttonDisabled: true,
      tone: "loading"
    };
  }

  if (reportOnly?.status === "ready" && reportOnly?.canComment) {
    return {
      title: "Autopilot Armed",
      detail: `Watching ${targetLabel}`,
      note: "The next refresh will auto-post once for this active issue.",
      buttonLabel: "Disable Autopilot",
      buttonDisabled: false,
      tone: "ready"
    };
  }

  if (reportOnly?.status === "already_commented" || reportOnly?.status === "comment_posted") {
    return {
      title: "Autopilot Synced",
      detail: `Covered ${targetLabel}`,
      note: "The active issue already has a report-only bridge comment.",
      buttonLabel: "Disable Autopilot",
      buttonDisabled: false,
      tone: "done"
    };
  }

  if (
    Number(reportOnly?.target?.number || 0) > 0 &&
    autopilot.lastHandledIssueNumber === Number(reportOnly?.target?.number || 0)
  ) {
    return {
      title: "Autopilot Synced",
      detail: `Handled ${targetLabel}`,
      note: "This viewer session already posted for the current active issue.",
      buttonLabel: "Disable Autopilot",
      buttonDisabled: false,
      tone: "done"
    };
  }

  return {
    title: "Autopilot Waiting",
    detail: targetLabel,
    note: "Autopilot is enabled but there is nothing ready to post yet.",
    buttonLabel: "Disable Autopilot",
    buttonDisabled: false,
    tone: "idle"
  };
}
