const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

function clearModuleCache(patterns) {
  const keys = Object.keys(require.cache);
  keys.forEach((key) => {
    const normalized = String(key || "").replace(/\\/g, "/");
    if (patterns.some((pattern) => normalized.includes(pattern))) {
      delete require.cache[key];
    }
  });
}

async function withMockedHostModules(run) {
  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === "photoshop") {
      return {
        app: {},
        core: {},
        action: {}
      };
    }
    if (request === "uxp") {
      return {
        storage: {
          localFileSystem: {},
          formats: {}
        }
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    clearModuleCache([
      "/src/controllers/tools-controller.js",
      "/src/infrastructure/gateways/workspace-gateway.js"
    ]);
    return await run();
  } finally {
    Module._load = originalLoad;
    clearModuleCache([
      "/src/controllers/tools-controller.js",
      "/src/infrastructure/gateways/workspace-gateway.js"
    ]);
  }
}

function createMockButton() {
  const listeners = new Map();
  return {
    blurCalls: 0,
    addEventListener: (eventName, handler) => {
      listeners.set(eventName, handler);
    },
    removeEventListener: (eventName, handler) => {
      if (listeners.get(eventName) === handler) {
        listeners.delete(eventName);
      }
    },
    blur: function blur() {
      this.blurCalls += 1;
    },
    trigger: (eventName, payload = {}) => {
      const handler = listeners.get(eventName);
      if (!handler) return undefined;
      return handler(payload);
    }
  };
}

function createToolsDocument(buttonMap) {
  return {
    getElementById: (id) => buttonMap[id] || null
  };
}

test("initToolsController uses injected gateway for click handlers", async () => {
  await withMockedHostModules(async () => {
    const originalDocument = global.document;
    const buttonMap = {
      btnNeutralGray: createMockButton()
    };
    global.document = createToolsDocument(buttonMap);

    const calls = {
      createNeutralGrayLayer: 0
    };
    const injectedGateway = {
      photoshop: {
        createNeutralGrayLayer: async () => {
          calls.createNeutralGrayLayer += 1;
        }
      }
    };

    try {
      const { initToolsController } = require("../../src/controllers/tools-controller");
      const resolvedGateway = initToolsController({ gateway: injectedGateway });

      assert.equal(resolvedGateway, injectedGateway);
      await buttonMap.btnNeutralGray.trigger("click", { currentTarget: buttonMap.btnNeutralGray });
      assert.equal(calls.createNeutralGrayLayer, 1);
      assert.equal(buttonMap.btnNeutralGray.blurCalls, 1);
    } finally {
      global.document = originalDocument;
    }
  });
});

test("initToolsController keeps default gateway path when no injection provided", async () => {
  await withMockedHostModules(() => {
    const originalDocument = global.document;
    global.document = createToolsDocument({});

    try {
      const { initToolsController } = require("../../src/controllers/tools-controller");
      const resolvedGateway = initToolsController();

      assert.equal(typeof resolvedGateway, "object");
      assert.equal(typeof resolvedGateway.photoshop, "object");
    } finally {
      global.document = originalDocument;
    }
  });
});
