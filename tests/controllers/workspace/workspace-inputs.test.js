const test = require("node:test");
const assert = require("node:assert/strict");
const { createWorkspaceInputs } = require("../../../src/controllers/workspace/workspace-inputs");

function createFixture(stateOverrides = {}) {
  const state = {
    currentApp: {
      id: "app-1",
      inputs: []
    },
    inputValues: {},
    imageBounds: {},
    ...stateOverrides
  };

  const workspaceInputs = createWorkspaceInputs({
    state,
    dom: {},
    byId: () => null,
    ps: {},
    log: () => {},
    inputSchema: {
      resolveInputType: (input) => {
        const type = String((input && (input.type || input.fieldType)) || "").toLowerCase();
        if (type.includes("image")) return "image";
        return "text";
      }
    },
    escapeHtml: (value) => String(value || ""),
    isPromptLikeInput: () => false,
    isEmptyValue: (value) => value == null || value === "",
    updateCurrentAppMeta: () => {},
    updateRunButtonUI: () => {},
    openTemplatePicker: () => {}
  });

  return {
    state,
    workspaceInputs
  };
}

test("resolvePlacementTarget uses the first image input when context exists", () => {
  const { workspaceInputs } = createFixture({
    currentApp: {
      id: "app-1",
      inputs: [
        { key: "image:main", type: "image" },
        { key: "image:mask", type: "image" }
      ]
    },
    inputValues: {
      "image:main": {
        arrayBuffer: new ArrayBuffer(1),
        captureContext: {
          documentId: 11,
          capturedAt: 1700000000000
        }
      },
      "image:mask": {
        arrayBuffer: new ArrayBuffer(1),
        captureContext: {
          documentId: 22,
          capturedAt: 1700000000001
        }
      }
    }
  });

  assert.deepEqual(workspaceInputs.resolvePlacementTarget(), {
    documentId: 11,
    sourceInputKey: "image:main",
    capturedAt: 1700000000000
  });
});

test("resolvePlacementTarget falls back to later image inputs when first has no context", () => {
  const { workspaceInputs } = createFixture({
    currentApp: {
      id: "app-1",
      inputs: [
        { key: "image:main", type: "image" },
        { key: "image:mask", type: "image" }
      ]
    },
    inputValues: {
      "image:main": {
        arrayBuffer: new ArrayBuffer(1)
      },
      "image:mask": {
        arrayBuffer: new ArrayBuffer(1),
        captureContext: {
          documentId: 22,
          capturedAt: 1700000000001
        }
      }
    }
  });

  assert.deepEqual(workspaceInputs.resolvePlacementTarget(), {
    documentId: 22,
    sourceInputKey: "image:mask",
    capturedAt: 1700000000001
  });
});

test("resolvePlacementTarget returns null when no image capture context is available", () => {
  const { workspaceInputs } = createFixture({
    currentApp: {
      id: "app-1",
      inputs: [
        { key: "image:main", type: "image" },
        { key: "prompt", type: "text" }
      ]
    },
    inputValues: {
      "image:main": {
        arrayBuffer: new ArrayBuffer(1)
      },
      prompt: "hello"
    }
  });

  assert.equal(workspaceInputs.resolvePlacementTarget(), null);
});
