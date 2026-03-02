const test = require("node:test");
const assert = require("node:assert/strict");
const { captureImageInput } = require("../../../src/application/usecases/capture-image-input");

test("captureImageInput returns image payload on success", async () => {
  const previousValue = { previewUrl: "blob:old" };
  const called = {
    revoke: 0
  };
  const buffer = new Uint8Array([1, 2, 3]).buffer;

  const result = await captureImageInput({
    ps: {
      captureSelection: async () => ({
        arrayBuffer: buffer,
        selectionBounds: { left: 1, top: 2, right: 3, bottom: 4 },
        captureContext: {
          documentId: 77,
          documentTitle: "Doc-A",
          capturedAt: 1700000000000
        }
      })
    },
    log: () => {},
    previousValue,
    revokePreviewUrl: (value) => {
      assert.equal(value, previousValue);
      called.revoke += 1;
    },
    createPreviewUrlFromBuffer: (nextBuffer) => {
      assert.equal(nextBuffer, buffer);
      return "blob:new";
    }
  });

  assert.equal(called.revoke, 1);
  assert.equal(result.ok, true);
  assert.equal(result.value.previewUrl, "blob:new");
  assert.deepEqual(result.value.sourceMeta, {
    mime: "image/png",
    bytes: 3,
    width: 1,
    height: 1,
    bitDepth: null
  });
  assert.deepEqual(result.value.uploadMeta, {
    mime: "image/png",
    bytes: 3,
    width: 1,
    height: 1,
    bitDepth: null,
    risk: "safe"
  });
  assert.equal(result.value.compressionTrace.applied, false);
  assert.deepEqual(result.value.captureContext, {
    documentId: 77,
    documentTitle: "Doc-A",
    capturedAt: 1700000000000
  });
  assert.deepEqual(result.selectionBounds, { left: 1, top: 2, right: 3, bottom: 4 });
});

test("captureImageInput computes risk by configured target/hard-limit bytes", async () => {
  const buffer = new Uint8Array(9_500_000).buffer;
  const result = await captureImageInput({
    ps: {
      captureSelection: async () => ({
        arrayBuffer: buffer,
        sourceMeta: {
          mime: "image/png",
          bytes: buffer.byteLength,
          width: 100,
          height: 100,
          bitDepth: 16
        }
      })
    },
    createPreviewUrlFromBuffer: () => "blob:new",
    getUploadSettings: () => ({
      uploadTargetBytes: 9_000_000,
      uploadHardLimitBytes: 10_000_000
    })
  });

  assert.equal(result.ok, true);
  assert.equal(result.value.uploadMeta.risk, "risky");
  assert.match(result.value.bitDepthHint, /16-bit/);
});

test("captureImageInput returns empty when capture has no binary", async () => {
  const result = await captureImageInput({
    ps: {
      captureSelection: async () => null
    },
    createPreviewUrlFromBuffer: () => "unused"
  });

  assert.deepEqual(result, { ok: false, reason: "empty" });
});

test("captureImageInput returns error payload when capture throws", async () => {
  const result = await captureImageInput({
    ps: {
      captureSelection: async () => {
        throw new Error("boom");
      }
    },
    createPreviewUrlFromBuffer: () => "unused"
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "error");
  assert.match(result.message, /boom/);
});
