// @ts-check
/**
 * rei-live.js — one SSE subscription that pushes panel data in real time.
 *
 * The dashboard panels (task queue, agent metrics, cost ledger) used to each
 * poll their own endpoint every 10-30s. This module opens a single
 * `/api/live/stream` EventSource and re-dispatches every server frame as a
 * `rei-live:panels` window CustomEvent, so any panel can react the instant
 * something changes. Panels keep a slow poll as a fallback for when SSE is
 * unavailable (old browsers, proxies that strip streaming).
 *
 * Public surface: `window.reiLive`
 *   - `.latest`            most recent `{ queue, metrics, costs, generatedAt }`
 *   - `.isConnected()`     whether the stream is currently live
 *   - `.onPanels(fn)`      subscribe; replays the latest frame immediately
 */

const STREAM_URL = "/api/live/stream";

/**
 * @typedef {Object} LivePanelsPayload
 * @property {string|null} generatedAt
 * @property {{ tasks: Array<any> }|null} queue
 * @property {any} metrics
 * @property {any} costs
 */

/** @type {LivePanelsPayload} */
const latest = { generatedAt: null, queue: null, metrics: null, costs: null };

/** @type {EventSource|null} */
let source = null;
let connected = false;

/** @param {LivePanelsPayload} payload */
function ingest(payload) {
  if (payload.queue) latest.queue = payload.queue;
  if (payload.metrics) latest.metrics = payload.metrics;
  if (payload.costs) latest.costs = payload.costs;
  if (payload.generatedAt) latest.generatedAt = payload.generatedAt;
  window.dispatchEvent(new CustomEvent("rei-live:panels", { detail: { ...latest } }));
}

/** @param {MessageEvent} event */
function onPanelsFrame(event) {
  connected = true;
  try {
    ingest(JSON.parse(event.data));
  } catch {
    // malformed frame — ignore, next one will arrive shortly
  }
}

function connect() {
  if (typeof window.EventSource !== "function") {
    return; // panels fall back to their own polling
  }

  try {
    source = new EventSource(STREAM_URL);
    source.addEventListener("panels", /** @type {EventListener} */ (onPanelsFrame));
    source.addEventListener("heartbeat", () => {
      connected = true;
    });
    source.addEventListener("error", () => {
      connected = false;
      // EventSource auto-reconnects using the server's `retry:` hint.
    });
  } catch {
    connected = false;
  }
}

connect();

window.reiLive = {
  get latest() {
    return latest;
  },
  isConnected() {
    return connected;
  },
  /** @param {(detail: LivePanelsPayload) => void} fn */
  onPanels(fn) {
    window.addEventListener("rei-live:panels", (event) => {
      fn(/** @type {CustomEvent} */ (event).detail);
    });
    if (latest.generatedAt) {
      fn(latest);
    }
  }
};
