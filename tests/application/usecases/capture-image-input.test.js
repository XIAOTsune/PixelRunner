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
        selectionBounds: { left: 1, top: 2, right: 3, bottom: 4 }
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
  assert.deepEqual(result.selectionBounds, { left: 1, top: 2, right: 3, bottom: 4 });
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
