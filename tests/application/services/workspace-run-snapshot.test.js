const test = require("node:test");
const assert = require("node:assert/strict");
const {
  cloneArrayBuffer,
  cloneDeepValue,
  cloneInputValues,
  cloneBounds,
  clonePlacementTarget,
  buildPollSettings,
  buildWorkspaceRunSnapshot
} = require("../../../src/application/services/workspace-run-snapshot");

test("cloneArrayBuffer clones ArrayBuffer and typed array views", () => {
  const direct = new ArrayBuffer(4);
  const directClone = cloneArrayBuffer(direct);
  assert.notEqual(directClone, direct);
  assert.deepEqual(Array.from(new Uint8Array(directClone)), Array.from(new Uint8Array(direct)));

  const sourceView = new Uint8Array([10, 20, 30, 40]).subarray(1, 3);
  const viewClone = cloneArrayBuffer(sourceView);
  assert.deepEqual(Array.from(new Uint8Array(viewClone)), [20, 30]);
});

test("cloneDeepValue and cloneInputValues deep clone object payloads", () => {
  const source = {
    text: "hello",
    nested: { value: 1 },
    list: [1, { key: "v" }],
    binary: new Uint8Array([1, 2, 3])
  };

  const deepCloned = cloneDeepValue(source);
  assert.notEqual(deepCloned, source);
  assert.notEqual(deepCloned.nested, source.nested);
  assert.notEqual(deepCloned.list, source.list);
  assert.deepEqual(Array.from(new Uint8Array(deepCloned.binary)), [1, 2, 3]);

  const inputValues = cloneInputValues(source);
  assert.notEqual(inputValues, source);
  assert.deepEqual(inputValues.text, "hello");
  assert.deepEqual(inputValues.nested, { value: 1 });
});

test("cloneBounds normalizes numeric coordinates and returns null for invalid input", () => {
  assert.deepEqual(
    cloneBounds({
      left: "1",
      top: 2,
      right: "3.5",
      bottom: "4"
    }),
    {
      left: 1,
      top: 2,
      right: 3.5,
      bottom: 4
    }
  );
  assert.equal(cloneBounds(null), null);
});

test("clonePlacementTarget normalizes payload and ignores invalid document ids", () => {
  assert.deepEqual(
    clonePlacementTarget({
      documentId: "15",
      sourceInputKey: "image:main",
      capturedAt: "1700000000000"
    }),
    {
      documentId: 15,
      sourceInputKey: "image:main",
      capturedAt: 1700000000000
    }
  );
  assert.equal(clonePlacementTarget({ documentId: 0 }), null);
});

test("buildPollSettings applies numeric defaults", () => {
  assert.deepEqual(buildPollSettings({ pollInterval: "5", timeout: "240" }), {
    pollInterval: 5,
    timeout: 240
  });
  assert.deepEqual(buildPollSettings({ pollInterval: 0, timeout: null }), {
    pollInterval: 2,
    timeout: 180
  });
});

test("buildWorkspaceRunSnapshot builds normalized, cloned run payload", () => {
  const sourceBuffer = new Uint8Array([7, 8, 9]).buffer;
  const appItem = {
    id: "app-1",
    inputs: [{ key: "prompt" }],
    meta: { owner: "test" }
  };
  const inputValues = {
    prompt: "hello",
    nested: { value: "x" },
    source: new Uint8Array([1, 2])
  };

  const snapshot = buildWorkspaceRunSnapshot({
    appItem,
    inputValues,
    targetBounds: { left: "10", top: "20", right: "30", bottom: "40" },
    sourceBuffer,
    placementTarget: {
      documentId: 88,
      sourceInputKey: "image",
      capturedAt: 1700000000001
    },
    settings: {
      pollInterval: "4",
      timeout: "150",
      uploadMaxEdge: "123",
      pasteStrategy: "edgeAuto"
    }
  });

  assert.notEqual(snapshot.appItem, appItem);
  assert.notEqual(snapshot.inputValues, inputValues);
  assert.deepEqual(snapshot.targetBounds, {
    left: 10,
    top: 20,
    right: 30,
    bottom: 40
  });
  assert.notEqual(snapshot.sourceBuffer, sourceBuffer);
  assert.deepEqual(Array.from(new Uint8Array(snapshot.sourceBuffer)), [7, 8, 9]);
  assert.deepEqual(snapshot.placementTarget, {
    documentId: 88,
    sourceInputKey: "image",
    capturedAt: 1700000000001
  });
  assert.deepEqual(snapshot.pollSettings, { pollInterval: 4, timeout: 150 });
  assert.equal(snapshot.uploadMaxEdge, 0);
  assert.equal(snapshot.pasteStrategy, "smart");
});
