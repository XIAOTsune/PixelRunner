const DEFAULT_COMPRESSION_QUALITY_STEPS = [10, 8, 7, 6, 5, 4];
const DEFAULT_COMPRESSION_EDGE_STEPS = [6144, 5120, 4096, 3072, 2560, 2048];
const DEFAULT_COMPRESSION_MAX_ATTEMPTS = 18;
const DEFAULT_COMPRESSION_DURATION_MS = 12_000;

function normalizeInteger(value, fallback, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  const floored = Math.floor(num);
  if (floored < min) return min;
  if (floored > max) return max;
  return floored;
}

function parseIntegerInRange(value, min, max = Number.MAX_SAFE_INTEGER) {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  const floored = Math.floor(num);
  if (floored < min || floored > max) return null;
  return floored;
}

function normalizeQualitySteps(steps = DEFAULT_COMPRESSION_QUALITY_STEPS) {
  const source = Array.isArray(steps) ? steps : DEFAULT_COMPRESSION_QUALITY_STEPS;
  const out = [];
  source.forEach((item) => {
    const value = parseIntegerInRange(item, 1, 12);
    if (!Number.isFinite(value)) return;
    if (!out.includes(value)) out.push(value);
  });
  if (out.length === 0) return [...DEFAULT_COMPRESSION_QUALITY_STEPS];
  return out;
}

function buildCompressionEdgeSteps(originalLongEdge, steps = DEFAULT_COMPRESSION_EDGE_STEPS) {
  const baseLongEdge = parseIntegerInRange(originalLongEdge, 1) || 0;
  if (baseLongEdge <= 0) return [];
  const source = Array.isArray(steps) ? steps : DEFAULT_COMPRESSION_EDGE_STEPS;
  const out = [baseLongEdge];
  source.forEach((item) => {
    const value = parseIntegerInRange(item, 1);
    if (!Number.isFinite(value)) return;
    if (value > baseLongEdge) return;
    if (!out.includes(value)) out.push(value);
  });
  out.sort((a, b) => b - a);
  return out;
}

async function runCompressionAttempts(options = {}) {
  const now = typeof options.now === "function" ? options.now : () => Date.now();
  const attemptExport =
    typeof options.attemptExport === "function"
      ? options.attemptExport
      : async () => {
          throw new Error("attemptExport is required");
        };
  const initialBytes = Math.max(0, Number(options.initialBytes) || 0);
  const targetBytes = Math.max(1, Number(options.targetBytes) || 1);
  const maxAttempts = normalizeInteger(options.maxAttempts, DEFAULT_COMPRESSION_MAX_ATTEMPTS, 1, 200);
  const maxDurationMs = normalizeInteger(options.maxDurationMs, DEFAULT_COMPRESSION_DURATION_MS, 1, 120_000);
  const qualitySteps = normalizeQualitySteps(options.qualitySteps);
  const edgeSteps = Array.isArray(options.edgeSteps) && options.edgeSteps.length > 0 ? options.edgeSteps : [];

  if (initialBytes <= targetBytes) {
    return {
      outcome: "already-safe",
      attempts: 0,
      durationMs: 0,
      trace: [],
      result: null
    };
  }

  const startedAt = now();
  let attempts = 0;
  const trace = [];

  for (const maxEdge of edgeSteps) {
    for (const quality of qualitySteps) {
      const elapsedBeforeAttempt = now() - startedAt;
      if (attempts >= maxAttempts) {
        return {
          outcome: "max-attempts",
          attempts,
          durationMs: Math.max(0, elapsedBeforeAttempt),
          trace,
          result: null
        };
      }
      if (elapsedBeforeAttempt > maxDurationMs) {
        return {
          outcome: "timeout",
          attempts,
          durationMs: Math.max(0, elapsedBeforeAttempt),
          trace,
          result: null
        };
      }

      attempts += 1;
      const exported = await attemptExport({
        quality,
        maxEdge,
        attempt: attempts
      });
      const bytes = Math.max(0, Number(exported && exported.bytes) || 0);
      trace.push({
        attempt: attempts,
        quality,
        maxEdge,
        bytes
      });

      if (bytes <= targetBytes) {
        return {
          outcome: "satisfied",
          attempts,
          durationMs: Math.max(0, now() - startedAt),
          trace,
          result: exported ? { ...exported, quality, maxEdge, bytes } : null
        };
      }
    }
  }

  return {
    outcome: "unreached",
    attempts,
    durationMs: Math.max(0, now() - startedAt),
    trace,
    result: null
  };
}

module.exports = {
  DEFAULT_COMPRESSION_QUALITY_STEPS,
  DEFAULT_COMPRESSION_EDGE_STEPS,
  DEFAULT_COMPRESSION_MAX_ATTEMPTS,
  DEFAULT_COMPRESSION_DURATION_MS,
  normalizeQualitySteps,
  buildCompressionEdgeSteps,
  runCompressionAttempts
};
