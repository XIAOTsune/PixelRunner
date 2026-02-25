const test = require("node:test");
const assert = require("node:assert/strict");
const { API } = require("../../../src/config");
const {
  normalizeUploadBuffer,
  detectImageMime,
  pickUploadedValue,
  uploadImage
} = require("../../../src/services/runninghub-runner/upload-strategy");

test("normalizeUploadBuffer accepts typed array and base64 wrappers", () => {
  const typed = new Uint8Array([1, 2, 3, 4]);
  const fromTyped = normalizeUploadBuffer(typed);
  assert.ok(fromTyped instanceof ArrayBuffer);
  assert.deepEqual(Array.from(new Uint8Array(fromTyped)), [1, 2, 3, 4]);

  const fromBase64 = normalizeUploadBuffer({ base64: "AQID" });
  assert.deepEqual(Array.from(new Uint8Array(fromBase64)), [1, 2, 3]);
});

test("detectImageMime identifies common image headers", () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]).buffer;
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0, 0, 0, 0, 0, 0, 0, 0, 0]).buffer;
  const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]).buffer;
  const gif = new Uint8Array([0x47, 0x49, 0x46, 0, 0, 0, 0, 0, 0, 0, 0, 0]).buffer;

  assert.equal(detectImageMime(png), "image/png");
  assert.equal(detectImageMime(jpeg), "image/jpeg");
  assert.equal(detectImageMime(webp), "image/webp");
  assert.equal(detectImageMime(gif), "image/gif");
  assert.equal(detectImageMime(new ArrayBuffer(2)), "application/octet-stream");
});

test("pickUploadedValue prefers token and falls back to url", () => {
  assert.deepEqual(
    pickUploadedValue({ fileName: "token-1", url: "https://x" }),
    { value: "token-1", token: "token-1", url: "https://x" }
  );
  assert.deepEqual(
    pickUploadedValue({ downloadUrl: "https://example/file.png" }),
    { value: "https://example/file.png", token: "", url: "https://example/file.png" }
  );
});

test("uploadImage falls back from v2 endpoint to legacy endpoint", async () => {
  const calls = [];
  const responses = [
    { ok: false, status: 500, payload: { message: "v2 down" } },
    { ok: true, status: 200, payload: { code: 0, data: { fileName: "token-123" } } }
  ];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return responses[calls.length - 1];
  };

  const result = await uploadImage(
    "api-key",
    new Uint8Array([1, 2, 3, 4]).buffer,
    { uploadMaxEdge: 0 },
    {
      fetchImpl,
      parseJsonResponse: async (response) => response.payload
    }
  );

  assert.equal(result.value, "token-123");
  assert.equal(calls.length, 2);
  assert.ok(calls[0].url.endsWith(API.ENDPOINTS.UPLOAD_V2));
  assert.ok(calls[1].url.endsWith(API.ENDPOINTS.UPLOAD_LEGACY));
});

test("uploadImage throws when all endpoints fail", async () => {
  const logs = [];
  const fetchImpl = async () => ({ ok: false, status: 500, payload: { message: "server error" } });

  await assert.rejects(
    () =>
      uploadImage(
        "api-key",
        new Uint8Array([1, 2, 3]).buffer,
        { log: (line, level) => logs.push({ line, level }) },
        {
          fetchImpl,
          parseJsonResponse: async (response) => response.payload
        }
      ),
    /Image upload failed/
  );

  const warnLine = logs.find((entry) => entry.level === "warn");
  assert.ok(warnLine);
  assert.match(warnLine.line, /HTTP 500/);
});

test("uploadImage retries network failures when uploadRetryCount is enabled", async () => {
  const calls = [];
  const logs = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (calls.length <= 2) {
      throw new Error("Network request failed");
    }
    return {
      ok: true,
      status: 200,
      payload: { code: 0, data: { fileName: "token-retried" } }
    };
  };

  const result = await uploadImage(
    "api-key",
    new Uint8Array([1, 2, 3]).buffer,
    {
      uploadRetryCount: 1,
      log: (line, level) => logs.push({ line, level })
    },
    {
      fetchImpl,
      parseJsonResponse: async (response) => response.payload
    }
  );

  assert.equal(result.value, "token-retried");
  assert.equal(calls.length, 3);
  assert.ok(logs.some((entry) => entry.level === "warn" && /retrying in/.test(entry.line)));
});

test("uploadImage does not retry for non-retryable http status", async () => {
  const calls = [];
  const fetchImpl = async () => {
    calls.push(true);
    return { ok: false, status: 400, payload: { message: "bad request" } };
  };

  await assert.rejects(
    () =>
      uploadImage(
        "api-key",
        new Uint8Array([1, 2, 3]).buffer,
        { uploadRetryCount: 3 },
        {
          fetchImpl,
          parseJsonResponse: async (response) => response.payload
        }
      ),
    /Image upload failed/
  );

  // only one round (v2 + legacy) should run
  assert.equal(calls.length, 2);
});
