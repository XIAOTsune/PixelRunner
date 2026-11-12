// Only these primitive fields may cross the host/UI boundary. Never retain an event.
export function parseRunningHubNumber(value) {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && !/^\d+(?:\.\d+)?$/.test(value.trim())) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= Number.MAX_SAFE_INTEGER ? number : null;
}

export function normalizeRunningHubStep(value, max) {
  const current = parseRunningHubNumber(value);
  const total = parseRunningHubNumber(max);
  if (current === null || total === null || total <= 0) return null;
  return { value: Math.min(current, total), max: total };
}

export function parseRunningHubProgress(message) {
  try {
    // Binary previews and oversized payloads are deliberately ignored.
    if (typeof message !== "string" || message.length > 65536) return null;
    const event = JSON.parse(message);
    if (!event || typeof event !== "object") return null;
    if (event.type === "progress") {
      return { phase: "running", step: normalizeRunningHubStep(event.data?.value, event.data?.max) };
    }
    if (["executing", "execution_start", "execution_cached", "execution_success"].includes(event.type)) {
      // A WSS completion signal is only a hint; REST must confirm success.
      return { phase: "running", step: null };
    }
  } catch (_) {}
  return null;
}

export function extractRunningHubTaskCostTime(payload) {
  if (!payload || typeof payload !== "object") return null;
  const data = payload.data ?? payload.result ?? payload;
  if (!data || typeof data !== "object") return null;
  const aggregate = parseRunningHubNumber(data.usage?.taskCostTime);
  if (aggregate !== null) return aggregate;
  // V1 repeats task-wide duration on each output; never add output durations.
  if (!Array.isArray(data) || data.length === 0) return null;
  const values = data.map(item => parseRunningHubNumber(item?.taskCostTime));
  return values.every(value => value !== null && value === values[0]) ? values[0] : null;
}
