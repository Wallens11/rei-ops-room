function formatTarget(target) {
  if (!target?.number) {
    return "No execute issue queued.";
  }

  return `#${target.number} ${target.title || "Untitled issue"}`;
}

export function createEmptyExecutePreviewState() {
  return {
    status: "loading",
    target: null,
    detail: "Checking the execute queue."
  };
}

export function createEmptyExecuteServiceState() {
  return {
    status: "loading",
    running: false,
    pid: null,
    source: "unknown",
    detail: "Checking the local execute service.",
    currentTarget: null
  };
}

export function buildExecuteAgentViewModel({
  preview = createEmptyExecutePreviewState(),
  service = createEmptyExecuteServiceState()
} = {}) {
  if (service.pendingAction === "start" || service.pendingAction === "stop") {
    const verb = service.pendingAction === "start" ? "Starting" : "Stopping";
    return {
      title: "Agent Updating",
      detail: `${verb} the local execute agent...`,
      note: "Waiting for the local executor control request to finish.",
      tone: "loading",
      buttonLabel: `${verb}...`,
      buttonDisabled: true,
      action: service.pendingAction
    };
  }

  if (service.status === "error" || service.source === "control_error" || service.source === "status_error") {
    const actionLabel = service.action === "stop" ? "Stop" : "Start";

    return {
      title: "Agent Action Failed",
      detail: service.detail || "The local execute service is unavailable.",
      note: "The last control request failed on this device. No hidden retry was attempted.",
      tone: "error",
      buttonLabel: `Retry ${actionLabel}`,
      buttonDisabled: false,
      action: service.action || "start"
    };
  }

  if (service.running) {
    return {
      title: "Agent Running",
      detail: formatTarget(service.currentTarget || preview.target),
      note:
        service.pid && service.currentTarget?.number
          ? `Local execute service is active on this device (pid ${service.pid}).`
          : service.detail || "The execute agent is currently running.",
      tone: "ready",
      buttonLabel: "Stop Agent",
      buttonDisabled: false,
      action: "stop"
    };
  }

  if (preview.status === "roadmap_blocked" && preview.target?.number) {
    return {
      title: "Roadmap Blocked",
      detail: formatTarget(preview.target),
      note: preview.detail || "The roadmap queue is halted on a blocked child issue.",
      tone: "error",
      buttonLabel: "Blocked",
      buttonDisabled: true,
      action: "status"
    };
  }

  if (preview.status === "roadmap_ready" && preview.target?.number) {
    return {
      title: "Roadmap Ready",
      detail: formatTarget(preview.target),
      note: preview.detail || "A roadmap parent selected the next child issue automatically.",
      tone: "ready",
      buttonLabel: "Start Agent",
      buttonDisabled: false,
      action: "start"
    };
  }

  if (preview.status === "ready" && preview.target?.number) {
    return {
      title: "Execute Ready",
      detail: formatTarget(preview.target),
      note: preview.detail || "The next mode:execute issue is ready to run.",
      tone: "ready",
      buttonLabel: "Start Agent",
      buttonDisabled: false,
      action: "start"
    };
  }

  if (preview.status === "loading" || service.status === "loading") {
    return {
      title: "Execute Checking",
      detail: "Checking the queue and local service.",
      note: preview.detail || service.detail || "Waiting for the local executor state.",
      tone: "loading",
      buttonLabel: "Checking...",
      buttonDisabled: true,
      action: "status"
    };
  }

  return {
    title: "Execute Idle",
    detail: "No execute issue queued.",
    note: preview.detail || "Move an `agent:rei` issue into `mode:execute` + `status:todo` first.",
    tone: "idle",
    buttonLabel: "Nothing Queued",
    buttonDisabled: true,
    action: "status"
  };
}
