export function createEmptyReportOnlyServiceState() {
  return {
    status: "loading",
    running: false,
    pid: null,
    source: "unknown",
    detail: "Checking the local report-only service."
  };
}

export function buildReportOnlyServiceViewModel(
  state = createEmptyReportOnlyServiceState()
) {
  if (state.pendingAction === "start" || state.pendingAction === "stop") {
    const verb = state.pendingAction === "start" ? "Starting" : "Stopping";
    return {
      title: "Service Updating",
      detail: `${verb} the local report-only service...`,
      note: "Waiting for the local service control request to finish.",
      tone: "loading",
      buttonLabel: `${verb}...`,
      buttonDisabled: true,
      action: state.pendingAction
    };
  }

  if (state.running) {
    return {
      title: "Service Running",
      detail: state.detail || "report-only worker running",
      note: `Background pickup is active on this device (pid ${state.pid || "?"}).`,
      tone: "ready",
      buttonLabel: "Stop Service",
      buttonDisabled: false,
      action: "stop"
    };
  }

  if (state.source === "stale_pid" || state.source === "foreign_pid") {
    return {
      title: "Service Warning",
      detail: state.detail || "report-only worker pid state needs cleanup",
      note:
        state.source === "stale_pid"
          ? "A stale pid file was found for the local worker."
          : "The worker pid file points at another live process.",
      tone: "done",
      buttonLabel: "Start Service",
      buttonDisabled: false,
      action: "start"
    };
  }

  if (state.status === "idle" || state.source === "none") {
    return {
      title: "Service Idle",
      detail: state.detail || "report-only worker is not running",
      note: "Background pickup is currently off on this device.",
      tone: "idle",
      buttonLabel: "Start Service",
      buttonDisabled: false,
      action: "start"
    };
  }

  return {
    title: "Service Checking",
    detail: "Checking the local report-only service.",
    note: state.detail || "Waiting for the local service status endpoint.",
    tone: "loading",
    buttonLabel: "Checking...",
    buttonDisabled: true,
    action: "status"
  };
}
