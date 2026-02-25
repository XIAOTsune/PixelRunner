const { RUNNINGHUB_ERROR_CODES } = require("../runninghub-error-codes");

const REQUEST_TIMEOUT_MS = 45000;

function createRunCancelledError(message = "Run cancelled") {
  const err = new Error(message);
  err.code = RUNNINGHUB_ERROR_CODES.RUN_CANCELLED;
  return err;
}

function createRequestTimeoutError(timeoutMs = REQUEST_TIMEOUT_MS) {
  const msRaw = Number(timeoutMs);
  const ms = Number.isFinite(msRaw) && msRaw > 0 ? Math.round(msRaw) : REQUEST_TIMEOUT_MS;
  const err = new Error(`Request timeout after ${ms}ms`);
  err.code = RUNNINGHUB_ERROR_CODES.REQUEST_TIMEOUT;
  err.name = "TimeoutError";
  return err;
}

async function fetchWithTimeout(fetchImpl, url, init = {}, options = {}) {
  const safeFetch = typeof fetchImpl === "function" ? fetchImpl : fetch;
  const timeoutRaw = Number(options.timeoutMs);
  const timeoutMs = Number.isFinite(timeoutRaw) && timeoutRaw > 0 ? timeoutRaw : REQUEST_TIMEOUT_MS;
  const externalSignal = init && init.signal ? init.signal : null;

  if (typeof AbortController === "undefined") {
    return safeFetch(url, init);
  }

  const controller = new AbortController();
  let timerId = null;
  let abortCause = "";

  const onExternalAbort = () => {
    abortCause = "cancelled";
    try {
      controller.abort();
    } catch (_) {}
  };

  if (externalSignal && externalSignal.aborted) {
    throw createRunCancelledError("Run cancelled");
  }
  if (externalSignal && typeof externalSignal.addEventListener === "function") {
    externalSignal.addEventListener("abort", onExternalAbort, { once: true });
  }

  if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
    timerId = setTimeout(() => {
      abortCause = "timeout";
      try {
        controller.abort();
      } catch (_) {}
    }, timeoutMs);
  }

  try {
    const requestInit = {
      ...(init && typeof init === "object" ? init : {}),
      signal: controller.signal
    };
    return await safeFetch(url, requestInit);
  } catch (error) {
    if (abortCause === "cancelled" || (externalSignal && externalSignal.aborted)) {
      throw createRunCancelledError("Run cancelled");
    }
    if (abortCause === "timeout") {
      throw createRequestTimeoutError(timeoutMs);
    }
    throw error;
  } finally {
    if (timerId) {
      clearTimeout(timerId);
      timerId = null;
    }
    if (externalSignal && typeof externalSignal.removeEventListener === "function") {
      externalSignal.removeEventListener("abort", onExternalAbort);
    }
  }
}

module.exports = {
  createRunCancelledError,
  createRequestTimeoutError,
  fetchWithTimeout
};
