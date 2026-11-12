import { parseRunningHubProgress } from "../shared/runninghub-progress.js";

const monitors = new Map();
const IDLE_MS = 5 * 60 * 1000;
const STEP_FRESH_MS = 10000;

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
  const monitor = { taskId, region, phase: "queued", step: null, updatedAt: 0, channel: "unavailable", attempted: false,
    touch() {
      clearTimeout(timer);
      timer = setTimeout(() => stopRunningHubProgress(taskId, region), IDLE_MS);
      timer?.unref?.();
    },
    dispose() {
      clearTimeout(timer);
      clearTimeout(connectTimer);
      if (socket) {
        socket.onmessage = socket.onopen = socket.onerror = socket.onclose = null;
        try { socket.close(); } catch (_) {}
        socket = null;
      }
      monitor.step = null;
    },
    connect(url) {
      if (monitor.attempted || !isRunningHubWssUrl(url, region)) return;
      monitor.attempted = true;
      // No fallback via WebView: task credentials stay exclusively in the host.
      if (typeof globalThis.WebSocket !== "function") return;
      const disconnect = () => {
        monitor.channel = "unavailable";
        monitor.step = null;
        monitor.dispose();
        monitor.touch();
      };
      try {
        socket = new globalThis.WebSocket(url);
        url = null;
        monitor.channel = "connecting";
        connectTimer = setTimeout(disconnect, 8000);
        connectTimer?.unref?.();
        socket.onopen = () => { clearTimeout(connectTimer); monitor.channel = "connected"; };
        socket.onmessage = event => {
          const safe = parseRunningHubProgress(event.data);
          if (!safe) return;
          monitor.phase = safe.phase;
          monitor.step = safe.step;
          monitor.updatedAt = Date.now();
        };
        // Never log a socket error, close reason, URL, or event payload.
        socket.onerror = socket.onclose = disconnect;
      } catch (_) { disconnect(); }
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
