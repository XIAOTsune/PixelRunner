const test = require("node:test");
const assert = require("node:assert/strict");
const { pollTaskOutputCore } = require("../../src/services/runninghub-polling");
const { RUNNINGHUB_ERROR_CODES } = require("../../src/services/runninghub-error-codes");

function createPollingHelpers(overrides = {}) {
  return {
    fetchImpl: async () => {
      throw new Error("fetchImpl should not be called directly");
    },
    fetchWithTimeout: async () => ({ ok: true, status: 200 }),
    api: {
      BASE_URL: "https://api.runninghub.test",
      ENDPOINTS: { TASK_OUTPUTS: "/task/outputs" }
    },
    sleep: async () => {},
    throwIfCancelled: () => {},
    parseJsonResponse: async () => ({ code: 0, data: { outputUrl: "https://cdn.test/out.png" } }),
    toMessage: (_result, fallback) => fallback,
    extractOutputUrl: (payload) => payload && payload.outputUrl,
    extractTaskStatus: (payload) => payload && payload.status,
    isFailedStatus: () => false,
    isPendingStatus: () => false,
    isPendingMessage: () => false,
    ...overrides
  };
}

test("pollTaskOutputCore routes requests through fetchWithTimeout", async () => {
  let captured = null;
  const outputUrl = await pollTaskOutputCore({
    apiKey: "api-key",
    taskId: "task-1",
    settings: { pollInterval: 2, timeout: 30 },
    options: { requestTimeoutMs: 1234 },
    helpers: createPollingHelpers({
      fetchWithTimeout: async (fetchImpl, url, init, requestOptions) => {
        captured = { fetchImpl, url, init, requestOptions };
        return { ok: true, status: 200 };
      }
    })
  });

  assert.equal(outputUrl, "https://cdn.test/out.png");
  assert.equal(typeof captured && typeof captured.fetchImpl, "function");
  assert.equal(captured && captured.url, "https://api.runninghub.test/task/outputs");
  assert.equal(captured && captured.requestOptions && captured.requestOptions.timeoutMs, 1234);
});

test("pollTaskOutputCore rethrows REQUEST_TIMEOUT for timeout tracking", async () => {
  const timeoutError = new Error("Request timeout after 10ms");
  timeoutError.code = RUNNINGHUB_ERROR_CODES.REQUEST_TIMEOUT;

  await assert.rejects(
    () =>
      pollTaskOutputCore({
        apiKey: "api-key",
        taskId: "task-1",
        settings: { pollInterval: 2, timeout: 30 },
        options: { requestTimeoutMs: 10 },
        helpers: createPollingHelpers({
          fetchWithTimeout: async () => {
            throw timeoutError;
          }
        })
      }),
    (error) => {
      assert.equal(error && error.code, RUNNINGHUB_ERROR_CODES.REQUEST_TIMEOUT);
      return true;
    }
  );
});

test("pollTaskOutputCore falls back to default fetchWithTimeout when helper is missing", async () => {
  let fetchCalled = false;
  const outputUrl = await pollTaskOutputCore({
    apiKey: "api-key",
    taskId: "task-1",
    settings: { pollInterval: 2, timeout: 30 },
    options: { requestTimeoutMs: 1000 },
    helpers: createPollingHelpers({
      fetchImpl: async () => {
        fetchCalled = true;
        return { ok: true, status: 200 };
      },
      fetchWithTimeout: null
    })
  });

  assert.equal(fetchCalled, true);
  assert.equal(outputUrl, "https://cdn.test/out.png");
});
