import { parseRunningHubProgress } from "../shared/runninghub-progress.js";

const monitors = new Map();
const IDLE_MS = 5 * 60 * 1000;
const STEP_FRESH_MS = 10000;
const CONNECT_TIMEOUT_MS = 8000;
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 15000;

export function isRunningHubWssUrl(value, region) {
  // UXP hosts need not provide URL. Accept only official regional WSS hosts,
  // default TLS port and the documented endpoint, with no userinfo or fragment.
  const suffix = region === "global" ? "ai" : "cn";
  return typeof value === "string" && value.length <= 16384 &&
    new RegExp(`^wss://(?:[a-z0-9-]+\\.)*runninghub\\.${suffix}(?::443)?/ws/c_instance\\?[^#\\s]+$`, "i").test(value);
}

export function stopRunningHubProgress(taskId, region) {
  const key = `${region}:${taskId}`;
  const monitor = monitors.get(key);
  if (!monitor) return;
  monitors.delete(key);
  monitor.dispose();
}

function createMonitor(taskId, region) {
  let socket = null;
  let timer = null;
  let connectTimer = null;
  let retryTimer = null;
  let reconnectAttempts = 0;
  let socketUrl = "";
  const monitor = { taskId, region, phase: "queued", step: null, updatedAt: 0, channel: "unavailable",
    touch() {
      clearTimeout(timer);
      timer = setTimeout(() => stopRunningHubProgress(taskId, region), IDLE_MS);
      timer?.unref?.();
    },
    closeSocket() {
      clearTimeout(connectTimer);
      connectTimer = null;
      const activeSocket = socket;
      socket = null;
      if (activeSocket) {
        activeSocket.onmessage = activeSocket.onopen = activeSocket.onerror = activeSocket.onclose = null;
        try { activeSocket.close(); } catch (_) {}
      }
    },
    dispose() {
      clearTimeout(timer);
      clearTimeout(retryTimer);
      retryTimer = null;
      monitor.closeSocket();
      socketUrl = "";
      monitor.step = null;
    },
    connect(url) {
      if (typeof globalThis.WebSocket !== "function") {
        monitor.channel = "unsupported";
        return;
      }
      if (url) {
        if (!isRunningHubWssUrl(url, region)) {
          if (!socketUrl) monitor.channel = "invalid-url";
          return;
        }
        socketUrl = url;
      } else if (!socketUrl) {
        monitor.channel = "missing-url";
        return;
      }
      if (socket || retryTimer) return;

      const scheduleReconnect = () => {
        if (!socketUrl || retryTimer || monitors.get(`${region}:${taskId}`) !== monitor) return;
        const delay = Math.min(RECONNECT_BASE_MS * (2 ** Math.min(reconnectAttempts, 4)), RECONNECT_MAX_MS);
        reconnectAttempts += 1;
        retryTimer = setTimeout(() => {
          retryTimer = null;
          monitor.connect();
        }, delay);
        retryTimer?.unref?.();
      };
      const disconnect = (reason, expectedSocket = null) => {
        if (expectedSocket && socket !== expectedSocket) return;
        monitor.closeSocket();
        monitor.channel = reason;
        monitor.step = null;
        monitor.touch();
        scheduleReconnect();
      };

      // The URL stays inside the host while reconnects are possible.
      try {
        const activeSocket = new globalThis.WebSocket(socketUrl);
        socket = activeSocket;
        monitor.channel = "connecting";
        connectTimer = setTimeout(() => disconnect("timeout", activeSocket), CONNECT_TIMEOUT_MS);
        connectTimer?.unref?.();
        activeSocket.onopen = () => {
          if (socket !== activeSocket) return;
          clearTimeout(connectTimer);
          connectTimer = null;
          monitor.channel = "connected";
          monitor.touch();
        };
        activeSocket.onmessage = event => {
          if (socket !== activeSocket) return;
          const safe = parseRunningHubProgress(event.data);
          if (!safe) return;
          reconnectAttempts = 0;
          monitor.phase = safe.phase;
          monitor.step = safe.step;
          monitor.updatedAt = Date.now();
        };
        // Never log a socket error, close reason, URL, or event payload.
        activeSocket.onerror = () => disconnect("error", activeSocket);
        activeSocket.onclose = () => disconnect("closed", activeSocket);
      } catch (_) { disconnect("error"); }
    }
  };
  return monitor;
}

export function observeRunningHubProgress(taskId, region, response, phase = "") {
  const key = `${region}:${taskId}`;
  let monitor = monitors.get(key);
  if (!monitor) {
    if (monitors.size >= 100) {
      const oldest = monitors.values().next().value;
      stopRunningHubProgress(oldest.taskId, oldest.region);
    }
    monitor = createMonitor(taskId, region);
    monitors.set(key, monitor);
  }
  monitor.touch();
  if (phase === "queued" || phase === "running") {
    monitor.phase = phase;
    if (phase === "queued") monitor.step = null;
  }
  const data = response && (response.data || response.result || response);
  monitor.connect(data && data.netWssUrl);
}

export function readRunningHubProgress(args = []) {
  return (Array.isArray(args[0]) ? args[0] : []).slice(0, 100).map(task => {
    const taskId = String(task?.taskId || "");
    const region = task?.region === "global" ? "global" : "cn";
    const monitor = monitors.get(`${region}:${taskId}`);
    if (!monitor) return { taskId, region, phase: "", step: null, channel: "unavailable" };
    monitor.touch();
    const step = monitor.channel === "connected" && Date.now() - monitor.updatedAt <= STEP_FRESH_MS ? monitor.step : null;
    return { taskId, region, phase: monitor.phase, step: step ? { value: step.value, max: step.max } : null, channel: monitor.channel };
  });
}
