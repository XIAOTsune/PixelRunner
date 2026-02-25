const test = require("node:test");
const assert = require("node:assert/strict");
const { createWorkspaceInputStateService } = require("../../../src/application/services/workspace-input-state");

test("workspace input state service writes and reads key + alias", () => {
  const state = {
    inputValues: {},
    imageBounds: {}
  };
  const service = createWorkspaceInputStateService({ state });

  service.setInputValueByKey("group:prompt", "hello");

  assert.equal(state.inputValues["group:prompt"], "hello");
  assert.equal(state.inputValues.prompt, "hello");
  assert.equal(service.getInputValueByKey("group:prompt"), "hello");
  assert.equal(service.getInputValueByKey("prompt"), "hello");
});

test("workspace input state service deletes key + alias values", () => {
  const state = {
    inputValues: {},
    imageBounds: {}
  };
  const service = createWorkspaceInputStateService({ state });

  service.setInputValueByKey("group:prompt", "hello");
  service.deleteInputValueByKey("group:prompt");

  assert.equal(state.inputValues["group:prompt"], undefined);
  assert.equal(state.inputValues.prompt, undefined);
  assert.equal(service.getInputValueByKey("group:prompt"), undefined);
  assert.equal(service.getInputValueByKey("prompt"), undefined);
});

test("workspace input state service clears image value and alias", () => {
  const revoked = [];
  const state = {
    inputValues: {
      "group:image": { previewUrl: "blob:123" },
      image: { previewUrl: "blob:123" }
    },
    imageBounds: {
      "group:image": { left: 1 },
      image: { left: 1 }
    }
  };
  const service = createWorkspaceInputStateService({ state });

  service.clearImageInputByKey("group:image", {
    revokePreviewUrl: (value) => revoked.push(value)
  });

  assert.equal(state.inputValues["group:image"], undefined);
  assert.equal(state.inputValues.image, undefined);
  assert.equal(state.imageBounds["group:image"], undefined);
  assert.equal(state.imageBounds.image, undefined);
  assert.equal(revoked.length, 1);
});

test("workspace input state service applies capture result and resolves bounds", () => {
  const bounds = { left: 1, top: 2, right: 3, bottom: 4 };
  const value = { arrayBuffer: new ArrayBuffer(8), previewUrl: "blob:x" };
  const state = {
    inputValues: {},
    imageBounds: {}
  };
  const service = createWorkspaceInputStateService({ state });

  const ok = service.applyCapturedImageByKey("input:image", {
    value,
    selectionBounds: bounds
  });

  assert.equal(ok, true);
  assert.equal(service.getInputValueByKey("input:image"), value);
  assert.deepEqual(service.getImageBoundsByKey("input:image"), bounds);
  assert.deepEqual(service.getImageBoundsByKey("image"), bounds);
});

test("workspace input state service picks image arrayBuffer for ArrayBuffer and typed array", () => {
  const directBuffer = new ArrayBuffer(4);
  const typedView = new Uint8Array([1, 2, 3, 4]);
  const state = {
    inputValues: {
      imageA: { arrayBuffer: directBuffer },
      imageB: { arrayBuffer: typedView }
    },
    imageBounds: {}
  };
  const service = createWorkspaceInputStateService({ state });

  assert.equal(service.pickImageArrayBufferByKey("imageA"), directBuffer);
  const fromView = service.pickImageArrayBufferByKey("imageB");
  assert.equal(fromView instanceof ArrayBuffer, true);
  assert.deepEqual(Array.from(new Uint8Array(fromView)), [1, 2, 3, 4]);
});

test("workspace input state service resets runtime values and revokes each value once", () => {
  const revoked = [];
  const state = {
    inputValues: {
      a: { previewUrl: "blob:1" },
      b: { previewUrl: "blob:2" }
    },
    imageBounds: {
      a: { left: 1 }
    }
  };
  const service = createWorkspaceInputStateService({ state });

  service.resetRuntimeValues({
    revokePreviewUrl: (value) => revoked.push(value && value.previewUrl)
  });

  assert.deepEqual(state.inputValues, {});
  assert.deepEqual(state.imageBounds, {});
  assert.deepEqual(revoked.sort(), ["blob:1", "blob:2"]);
});
