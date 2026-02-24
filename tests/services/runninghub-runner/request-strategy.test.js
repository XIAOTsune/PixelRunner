const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createRunCancelledError,
  fetchWithTimeout
} = require("../../../src/services/runninghub-runner/request-strategy");

test("createRunCancelledError marks error with RUN_CANCELLED code", () => {
  const err = createRunCancelledError("cancelled");
  assert.equal(err.message, "cancelled");
  assert.equal(err.code, "RUN_CANCELLED");
});

test("fetchWithTimeout returns fetch result when resolved in time", async () => {
  const fetchResult = { ok: true, status: 200 };
  const result = await fetchWithTimeout(
    async () => fetchResult,
    "https://example.test",
    { method: "GET" },
    { timeoutMs: 1000 }
  );
  assert.equal(result, fetchResult);
});

test("fetchWithTimeout throws timeout error when request exceeds timeout", async () => {
  const fetchImpl = async (_url, init) => {
    await new Promise((_, reject) => {
      init.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    });
    return null;
  };

  await assert.rejects(
    () => fetchWithTimeout(fetchImpl, "https://example.test", {}, { timeoutMs: 10 }),
    (error) => {
      assert.match(String(error && error.message), /Request timeout after/);
      return true;
    }
  );
});

test("fetchWithTimeout throws RUN_CANCELLED when external signal is aborted", async () => {
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(
    () => fetchWithTimeout(async () => null, "https://example.test", { signal: controller.signal }),
    (error) => {
      assert.equal(error && error.code, "RUN_CANCELLED");
      return true;
    }
  );
});
