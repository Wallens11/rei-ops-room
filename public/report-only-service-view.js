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
  if (state.running) {
    return {
      title: "Service Running",
      detail: state.detail || "report-only worker running",
      note: `Background pickup is active on this device (pid ${state.pid || "?"}).`,
      tone: "ready"
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
      tone: "done"
    };
  }

  if (state.status === "idle" || state.source === "none") {
    return {
      title: "Service Idle",
      detail: state.detail || "report-only worker is not running",
      note: "Background pickup is currently off on this device.",
      tone: "idle"
    };
  }

  return {
    title: "Service Checking",
    detail: "Checking the local report-only service.",
    note: state.detail || "Waiting for the local service status endpoint.",
    tone: "loading"
  };
}
