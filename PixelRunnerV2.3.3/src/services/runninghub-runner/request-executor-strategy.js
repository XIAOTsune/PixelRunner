const { fetchWithTimeout } = require("./request-strategy");
const { fallbackToMessage } = require("./task-error-strategy");

function resolveRunnerHelpers(helpers = {}) {
  const {
    fetchImpl,
    parseJsonResponse,
    toMessage,
    throwIfCancelled
  } = helpers;
  const safeFetch = typeof fetchImpl === "function" ? fetchImpl : fetch;
  const safeParseJsonResponse =
    typeof parseJsonResponse === "function"
      ? parseJsonResponse
      : async (response) => response.json().catch(() => null);
  const safeToMessage = typeof toMessage === "function" ? toMessage : fallbackToMessage;
  const safeThrowIfCancelled = typeof throwIfCancelled === "function" ? throwIfCancelled : () => {};
  return {
    safeFetch,
    safeParseJsonResponse,
    safeToMessage,
    safeThrowIfCancelled
  };
}

async function postJsonRequest(params = {}) {
  const {
    apiKey,
    url,
    body,
    options = {},
    helperContext = {}
  } = params;
  const {
    safeFetch,
    safeParseJsonResponse,
    safeThrowIfCancelled
  } = helperContext;

  safeThrowIfCancelled(options);
  const response = await fetchWithTimeout(safeFetch, url, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: options.signal
  }, {
    timeoutMs: options.requestTimeoutMs
  });
  safeThrowIfCancelled(options);
  const result = await safeParseJsonResponse(response);
  safeThrowIfCancelled(options);
  return { response, result };
}

module.exports = {
  resolveRunnerHelpers,
  postJsonRequest
};
