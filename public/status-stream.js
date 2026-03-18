export const STATUS_POLL_FALLBACK_MS = 3000;
export const STATUS_STREAM_GRACE_MS = 3500;

function defaultTimers() {
  return {
    setInterval: globalThis.setInterval.bind(globalThis),
    clearInterval: globalThis.clearInterval.bind(globalThis),
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis)
  };
}

export function createStatusTransport({
  streamUrl = "/api/status/stream",
  statusUrl = "/api/status",
  EventSourceCtor = globalThis.EventSource,
  fetchImpl = globalThis.fetch?.bind(globalThis),
  timers = defaultTimers(),
  pollIntervalMs = STATUS_POLL_FALLBACK_MS,
  streamGraceMs = STATUS_STREAM_GRACE_MS,
  onStatus = () => {},
  onModeChange = () => {},
  onTransportError = () => {}
} = {}) {
  let source = null;
  let pollHandle = null;
  let connectTimeout = null;
  let mode = "connecting";
  let stopped = false;

  function toTransportError(errorLike) {
    if (errorLike instanceof Error) {
      return errorLike;
    }

    if (typeof errorLike?.data === "string") {
      try {
        const payload = JSON.parse(errorLike.data);
        return new Error(payload.detail || payload.error || "status stream failed");
      } catch {
        return new Error(errorLike.data);
      }
    }

    return new Error("status stream failed");
  }

  function setMode(nextMode) {
    if (mode === nextMode) {
      return;
    }

    mode = nextMode;
    onModeChange(mode);
  }

  async function fetchStatusOnce() {
    if (typeof fetchImpl !== "function") {
      throw new Error("fetch is not available");
    }

    const response = await fetchImpl(statusUrl, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const status = await response.json();
    onStatus(status);
    return status;
  }

  function clearConnectTimeout() {
    if (connectTimeout) {
      timers.clearTimeout(connectTimeout);
      connectTimeout = null;
    }
  }

  function stopPolling() {
    if (!pollHandle) {
      return;
    }

    timers.clearInterval(pollHandle);
    pollHandle = null;
  }

  function startPolling() {
    if (stopped || pollHandle) {
      return;
    }

    setMode("polling");
    void fetchStatusOnce().catch(onTransportError);
    pollHandle = timers.setInterval(() => {
      void fetchStatusOnce().catch(onTransportError);
    }, pollIntervalMs);
  }

  function onStreamOpen() {
    if (stopped) {
      return;
    }

    clearConnectTimeout();
    stopPolling();
    setMode("stream");
  }

  function onStreamStatus(event) {
    if (stopped) {
      return;
    }

    onStreamOpen();

    try {
      onStatus(JSON.parse(event.data));
    } catch (error) {
      onTransportError(error);
    }
  }

  function onStreamError(event) {
    if (stopped) {
      return;
    }

    onTransportError(toTransportError(event));
    startPolling();
  }

  function bindEventSourceListeners(instance) {
    if (typeof instance.addEventListener === "function") {
      instance.addEventListener("open", onStreamOpen);
      instance.addEventListener("status", onStreamStatus);
      instance.addEventListener("status_error", onStreamError);
      instance.addEventListener("error", onStreamError);
      return;
    }

    instance.onopen = onStreamOpen;
    instance.onmessage = onStreamStatus;
    instance.onerror = onStreamError;
  }

  function connectStream() {
    if (typeof EventSourceCtor !== "function") {
      startPolling();
      return;
    }

    try {
      source = new EventSourceCtor(streamUrl);
      bindEventSourceListeners(source);

      connectTimeout = timers.setTimeout(() => {
        startPolling();
      }, streamGraceMs);
    } catch (error) {
      onTransportError(error);
      startPolling();
    }
  }

  return {
    async start() {
      stopped = false;
      connectStream();
    },
    stop() {
      stopped = true;
      clearConnectTimeout();
      stopPolling();
      if (source) {
        source.close?.();
        source = null;
      }
      setMode("stopped");
    },
    getMode() {
      return mode;
    }
  };
}
