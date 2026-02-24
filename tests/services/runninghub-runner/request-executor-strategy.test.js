const test = require("node:test");
const assert = require("node:assert/strict");
const {
  resolveRunnerHelpers,
  postJsonRequest
} = require("../../../src/services/runninghub-runner/request-executor-strategy");

test("resolveRunnerHelpers uses provided helpers", async () => {
  const calls = { cancelled: 0 };
  const helpers = resolveRunnerHelpers({
    fetchImpl: async () => ({ ok: true, payload: { code: 0 } }),
    parseJsonResponse: async (response) => response.payload,
    toMessage: () => "custom",
    throwIfCancelled: () => {
      calls.cancelled += 1;
    }
  });

  assert.equal(typeof helpers.safeFetch, "function");
  assert.equal(typeof helpers.safeParseJsonResponse, "function");
  assert.equal(helpers.safeToMessage({}, "fallback"), "custom");
  helpers.safeThrowIfCancelled({});
  assert.equal(calls.cancelled, 1);
});

test("postJsonRequest posts json with bearer token and parses result", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return {
      ok: true,
      status: 200,
      payload: { code: 0, data: { id: "task-1" } },
      json: async function json() {
        return this.payload;
      }
    };
  };
  const helperContext = resolveRunnerHelpers({
    fetchImpl,
    parseJsonResponse: async (response) => response.payload
  });

  const { response, result } = await postJsonRequest({
    apiKey: "api-key",
    url: "https://example.test/run",
    body: { appId: "1" },
    options: { requestTimeoutMs: 1234 },
    helperContext
  });

  assert.equal(response.status, 200);
  assert.equal(result.code, 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://example.test/run");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers.Authorization, "Bearer api-key");
  assert.equal(calls[0].init.headers["Content-Type"], "application/json");
  assert.equal(calls[0].init.body, JSON.stringify({ appId: "1" }));
});

test("postJsonRequest checks cancellation before sending request", async () => {
  const helperContext = resolveRunnerHelpers({
    fetchImpl: async () => {
      throw new Error("should not be called");
    },
    throwIfCancelled: () => {
      throw new Error("cancelled");
    }
  });

  await assert.rejects(
    () =>
      postJsonRequest({
        apiKey: "api-key",
        url: "https://example.test/run",
        body: {},
        options: {},
        helperContext
      }),
    /cancelled/
  );
});
