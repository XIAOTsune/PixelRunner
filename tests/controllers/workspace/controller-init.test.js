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
      "/src/controllers/workspace-controller.js",
      "/src/infrastructure/gateways/workspace-gateway.js"
    ]);
    return await run();
  } finally {
    Module._load = originalLoad;
    clearModuleCache([
      "/src/controllers/workspace-controller.js",
      "/src/infrastructure/gateways/workspace-gateway.js"
    ]);
  }
}

function createMockDocument(elementMap = {}) {
  return {
    getElementById: (id) => elementMap[id] || null,
    addEventListener: () => {},
    removeEventListener: () => {},
    querySelector: () => null,
    body: {
      classList: {
        toggle: () => {}
      }
    }
  };
}

function createLocalStorageStub() {
  const store = new Map();
  return {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => {
      store.set(key, String(value));
    },
    removeItem: (key) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    }
  };
}

test("initWorkspaceController uses injected gateway when provided", async () => {
  await withMockedHostModules(() => {
    const originalDocument = global.document;
    const originalAlert = global.alert;
    const originalLocalStorage = global.localStorage;
    global.document = createMockDocument({
      pasteStrategySelect: { value: "" }
    });
    global.alert = () => {};
    global.localStorage = createLocalStorageStub();

    const calls = {
      getSettings: 0,
      getApiKey: 0,
      getAiApps: 0
    };
    const injectedGateway = {
      store: {
        getSettings: () => {
          calls.getSettings += 1;
          return { pollInterval: 2, timeout: 180, uploadMaxEdge: 0, pasteStrategy: "normal" };
        },
        getApiKey: () => {
          calls.getApiKey += 1;
          return "";
        },
        getAiApps: () => {
          calls.getAiApps += 1;
          return [];
        },
        getPromptTemplates: () => []
      },
      runninghub: {
        fetchAccountStatus: async () => ({ remainMoney: "0", remainCoins: "0" })
      },
      photoshop: {}
    };

    try {
      const { initWorkspaceController } = require("../../../src/controllers/workspace-controller");
      const resolvedGateway = initWorkspaceController({ gateway: injectedGateway });

      assert.equal(resolvedGateway, injectedGateway);
      assert.equal(calls.getSettings > 0, true);
      assert.equal(calls.getApiKey > 0, true);
      assert.equal(calls.getAiApps > 0, true);
    } finally {
      global.document = originalDocument;
      global.alert = originalAlert;
      global.localStorage = originalLocalStorage;
    }
  });
});

test("initWorkspaceController keeps default gateway path when no injection provided", async () => {
  await withMockedHostModules(() => {
    const originalDocument = global.document;
    const originalAlert = global.alert;
    const originalLocalStorage = global.localStorage;
    global.document = createMockDocument({
      pasteStrategySelect: { value: "" }
    });
    global.alert = () => {};
    global.localStorage = createLocalStorageStub();

    try {
      const { initWorkspaceController } = require("../../../src/controllers/workspace-controller");
      const resolvedGateway = initWorkspaceController();

      assert.equal(typeof resolvedGateway, "object");
      assert.equal(typeof resolvedGateway.store, "object");
      assert.equal(typeof resolvedGateway.runninghub, "object");
      assert.equal(typeof resolvedGateway.photoshop, "object");
    } finally {
      global.document = originalDocument;
      global.alert = originalAlert;
      global.localStorage = originalLocalStorage;
    }
  });
});
