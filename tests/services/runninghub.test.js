const test = require("node:test");
const assert = require("node:assert/strict");
const { RUNNINGHUB_ERROR_CODES } = require("../../src/services/runninghub-error-codes");
const { downloadResultBinary } = require("../../src/services/runninghub");

test("downloadResultBinary enforces hard timeout and does not hang forever", async () => {
  const originalFetch = global.fetch;
  global.fetch = async (_url, init) =>
    new Promise((_, reject) => {
      if (init && init.signal && typeof init.signal.addEventListener === "function") {
        init.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      }
    });

  try {
    const outcome = await Promise.race([
      downloadResultBinary("https://example.test/result.bin", { requestTimeoutMs: 20 }).then(
        () => ({ kind: "resolved" }),
        (error) => ({ kind: "rejected", error })
      ),
      new Promise((resolve) => setTimeout(() => resolve({ kind: "hung" }), 220))
    ]);

    assert.notEqual(outcome.kind, "hung");
    assert.equal(outcome.kind, "rejected");
    assert.equal(outcome.error && outcome.error.code, RUNNINGHUB_ERROR_CODES.REQUEST_TIMEOUT);
  } finally {
    global.fetch = originalFetch;
  }
});

test("downloadResultBinary returns arrayBuffer when response is successful", async () => {
  const originalFetch = global.fetch;
  const source = new Uint8Array([1, 2, 3, 4]).buffer;
  global.fetch = async () => ({
    ok: true,
    status: 200,
    arrayBuffer: async () => source
  });

  try {
    const data = await downloadResultBinary("https://example.test/result.bin", { requestTimeoutMs: 200 });
    assert.equal(data instanceof ArrayBuffer, true);
    assert.equal(data.byteLength, 4);
  } finally {
    global.fetch = originalFetch;
  }
});
