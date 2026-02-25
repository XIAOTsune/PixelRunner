const test = require("node:test");
const assert = require("node:assert/strict");
const { fetchAppInfoCore } = require("../../../src/services/runninghub-parser");

test("fetchAppInfoCore throws structured PARSE_APP_FAILED when all requests fail", async () => {
  const fetchImpl = async () => ({
    ok: false,
    status: 500,
    payload: { message: "server error" },
    json: async function json() {
      return this.payload;
    }
  });
  const parseJsonResponse = async (response) => response.payload;
  const toMessage = (result, fallback = "request failed") =>
    (result && result.message) || fallback;

  await assert.rejects(
    () =>
      fetchAppInfoCore({
        appId: "123456",
        apiKey: "api-key",
        helpers: {
          fetchImpl,
          parseJsonResponse,
          toMessage
        }
      }),
    (error) => {
      assert.equal(error && error.code, "PARSE_APP_FAILED");
      assert.equal(error && error.appId, "123456");
      assert.equal(error && error.retryable, true);
      assert.ok(Array.isArray(error && error.reasons));
      assert.ok((error && error.reasons && error.reasons.length) > 0);
      return true;
    }
  );
});
