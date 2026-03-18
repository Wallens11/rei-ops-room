import test from "node:test";
import assert from "node:assert/strict";

import { createStatusTransport } from "../public/status-stream.js";

class FakeEventSource {
  constructor(url) {
    this.url = url;
    this.closed = false;
    this.listeners = new Map();
    this.onopen = null;
    this.onmessage = null;
    this.onerror = null;
  }

  addEventListener(type, handler) {
    const handlers = this.listeners.get(type) || [];
    handlers.push(handler);
    this.listeners.set(type, handlers);
  }

  emit(type, payload = {}) {
    for (const handler of this.listeners.get(type) || []) {
      handler(payload);
    }
  }

  emitOpen() {
    this.emit("open");
    this.onopen?.();
  }

  emitMessage(data) {
    const payload = { data };
    this.emit("status", payload);
    this.onmessage?.(payload);
  }

  emitError(error = new Error("stream failed")) {
    this.emit("error", error);
    this.onerror?.(error);
  }

  close() {
    this.closed = true;
  }
}

function createFakeTimers() {
  const intervals = [];
  const timeouts = [];

  return {
    intervals,
    timeouts,
    api: {
      setInterval(fn, ms) {
        const handle = { fn, ms, cleared: false };
        intervals.push(handle);
        return handle;
      },
      clearInterval(handle) {
        if (handle) {
          handle.cleared = true;
        }
      },
      setTimeout(fn, ms) {
        const handle = { fn, ms, cleared: false };
        timeouts.push(handle);
        return handle;
      },
      clearTimeout(handle) {
        if (handle) {
          handle.cleared = true;
        }
      }
    }
  };
}

test("createStatusTransport consumes SSE messages when EventSource is available", () => {
  const source = [];
  const statuses = [];
  const modes = [];

  const transport = createStatusTransport({
    streamUrl: "/api/status/stream",
    statusUrl: "/api/status",
    EventSourceCtor: class extends FakeEventSource {
      constructor(url) {
        super(url);
        source.push(this);
      }
    },
    fetchImpl: async () => {
      throw new Error("polling should not run");
    },
    onStatus(status) {
      statuses.push(status);
    },
    onModeChange(mode) {
      modes.push(mode);
    }
  });

  transport.start();
  source[0].emitOpen();
  source[0].emitMessage(JSON.stringify({ room: { phase: "execution" } }));

  assert.equal(source[0].url, "/api/status/stream");
  assert.equal(transport.getMode(), "stream");
  assert.deepEqual(statuses, [{ room: { phase: "execution" } }]);
  assert.deepEqual(modes, ["stream"]);
});

test("createStatusTransport falls back to polling when EventSource is unavailable", async () => {
  const timers = createFakeTimers();
  const fetchCalls = [];
  const statuses = [];
  const modes = [];

  const transport = createStatusTransport({
    streamUrl: "/api/status/stream",
    statusUrl: "/api/status",
    EventSourceCtor: null,
    fetchImpl: async (url) => {
      fetchCalls.push(url);
      return {
        ok: true,
        json: async () => ({ room: { phase: "standby" } })
      };
    },
    timers: timers.api,
    onStatus(status) {
      statuses.push(status);
    },
    onModeChange(mode) {
      modes.push(mode);
    }
  });

  await transport.start();
  await Promise.resolve();

  assert.equal(transport.getMode(), "polling");
  assert.deepEqual(fetchCalls, ["/api/status"]);
  assert.deepEqual(statuses, [{ room: { phase: "standby" } }]);
  assert.deepEqual(modes, ["polling"]);
  assert.equal(timers.intervals.length, 1);

  transport.stop();
  assert.equal(timers.intervals[0].cleared, true);
});

test("createStatusTransport switches to polling after a stream error", async () => {
  const timers = createFakeTimers();
  const source = [];
  const fetchCalls = [];
  const modes = [];

  const transport = createStatusTransport({
    streamUrl: "/api/status/stream",
    statusUrl: "/api/status",
    EventSourceCtor: class extends FakeEventSource {
      constructor(url) {
        super(url);
        source.push(this);
      }
    },
    fetchImpl: async (url) => {
      fetchCalls.push(url);
      return {
        ok: true,
        json: async () => ({ room: { phase: "execution" } })
      };
    },
    timers: timers.api,
    onStatus() {},
    onModeChange(mode) {
      modes.push(mode);
    }
  });

  transport.start();
  source[0].emitError();
  await Promise.resolve();

  assert.equal(source[0].closed, false);
  assert.equal(transport.getMode(), "polling");
  assert.deepEqual(fetchCalls, ["/api/status"]);
  assert.deepEqual(modes, ["polling"]);
  assert.equal(timers.intervals.length, 1);
});
