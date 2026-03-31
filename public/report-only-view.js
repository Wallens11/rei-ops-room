export function createEmptyReportOnlyState() {
  return {
    status: "loading",
    canComment: false,
    target: null,
    detail: "Checking the report-only bridge."
  };
}

function formatTarget(target) {
  if (!target) {
    return "No active report-only issue.";
  }

  return `#${target.number} ${target.title}`;
}

export function buildReportOnlyViewModel(state = createEmptyReportOnlyState()) {
  if (state.status === "ready") {
    return {
      title: "Report-only Ready",
      detail: formatTarget(state.target),
      note: state.detail || "Report-only bridge is ready for the active issue.",
      buttonLabel: "Post Plan Comment",
      buttonDisabled: false,
      tone: "ready"
    };
  }

  if (state.status === "comment_posted" || state.status === "already_commented") {
    return {
      title: "Report-only Synced",
      detail: formatTarget(state.target),
      note: state.detail || "A report-only comment is already present for the active issue.",
      buttonLabel: "Already Posted",
      buttonDisabled: true,
      tone: "done"
    };
  }

  if (state.status === "no_target") {
    return {
      title: "Report-only Idle",
      detail: "No active report-only issue.",
      note: state.detail || "Move an `agent:rei` issue into `status:in_progress` first.",
      buttonLabel: "Nothing Active",
      buttonDisabled: true,
      tone: "idle"
    };
  }

  return {
    title: "Report-only Bridge",
    detail: "Checking the active queue.",
    note: state.detail || "Waiting for the local preview bridge.",
    buttonLabel: "Checking...",
    buttonDisabled: true,
    tone: "loading"
  };
}
