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
      "/src/controllers/settings-controller.js",
      "/src/infrastructure/gateways/settings-gateway.js"
    ]);
    return await run();
  } finally {
    Module._load = originalLoad;
    clearModuleCache([
      "/src/controllers/settings-controller.js",
      "/src/infrastructure/gateways/settings-gateway.js"
    ]);
  }
}

function createMockElement() {
  const listeners = new Map();
  return {
    value: "",
    textContent: "",
    innerHTML: "",
    type: "text",
    style: {},
    dataset: {},
    disabled: false,
    scrollTop: 0,
    scrollHeight: 0,
    addEventListener: (eventName, handler) => {
      listeners.set(eventName, handler);
    },
    removeEventListener: (eventName, handler) => {
      if (listeners.get(eventName) === handler) {
        listeners.delete(eventName);
      }
    },
    classList: {
      add: () => {},
      remove: () => {},
      contains: () => false
    },
    setAttribute: () => {},
    contains: () => true,
    closest: () => null,
    querySelector: () => null
  };
}

function createMockDocument(elementMap) {
  return {
    getElementById: (id) => elementMap[id] || null,
    addEventListener: () => {},
    removeEventListener: () => {}
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

function createSettingsDomMap() {
  const ids = [
    "apiKeyInput",
    "pollIntervalInput",
    "timeoutInput",
    "cloudConcurrentJobsInput",
    "uploadMaxEdgeSettingSelect",
    "toggleApiKey",
    "btnSaveApiKey",
    "btnTestApiKey",
    "appIdInput",
    "appNameInput",
    "btnParseApp",
    "parseResultContainer",
    "savedAppsList",
    "templateTitleInput",
    "templateContentInput",
    "btnSaveTemplate",
    "btnExportTemplatesJson",
    "btnImportTemplatesJson",
    "savedTemplatesList",
    "templateLengthHint",
    "btnLoadDiagnosticsSummary",
    "envDoctorOutput",
    "advancedSettingsHeader",
    "advancedSettingsToggle",
    "advancedSettingsSection",
    "envDiagnosticsHeader",
    "envDiagnosticsToggle",
    "envDiagnosticsSection",
    "tabSettings"
  ];
  return ids.reduce((acc, id) => {
    acc[id] = createMockElement();
    return acc;
  }, {});
}

test("initSettingsController uses injected gateway when provided", async () => {
  await withMockedHostModules(() => {
    const originalDocument = global.document;
    const originalAlert = global.alert;
    const originalLocalStorage = global.localStorage;

    const elementMap = createSettingsDomMap();
    global.document = createMockDocument(elementMap);
    global.alert = () => {};
    global.localStorage = createLocalStorageStub();

    const calls = {
      getApiKey: 0,
      getSettings: 0,
      getAiApps: 0,
      getPromptTemplates: 0,
      getStorage: 0
    };
    const injectedGateway = {
      getApiKey: () => {
        calls.getApiKey += 1;
        return "injected-key";
      },
      getSettings: () => {
        calls.getSettings += 1;
        return {
          pollInterval: 2,
          timeout: 180,
          uploadMaxEdge: 0,
          pasteStrategy: "normal",
          cloudConcurrentJobs: 2
        };
      },
      getAiApps: () => {
        calls.getAiApps += 1;
        return [];
      },
      getPromptTemplates: () => {
        calls.getPromptTemplates += 1;
        return [];
      },
      getStorage: () => {
        calls.getStorage += 1;
        return null;
      }
    };

    try {
      const { initSettingsController } = require("../../../src/controllers/settings-controller");
      const resolvedGateway = initSettingsController({ gateway: injectedGateway });

      assert.equal(resolvedGateway, injectedGateway);
      assert.equal(calls.getApiKey > 0, true);
      assert.equal(calls.getSettings > 0, true);
      assert.equal(calls.getAiApps > 0, true);
      assert.equal(calls.getPromptTemplates > 0, true);
      assert.equal(calls.getStorage > 0, true);
    } finally {
      global.document = originalDocument;
      global.alert = originalAlert;
      global.localStorage = originalLocalStorage;
    }
  });
});

test("initSettingsController keeps default gateway path when no injection provided", async () => {
  await withMockedHostModules(() => {
    const originalDocument = global.document;
    const originalAlert = global.alert;
    const originalLocalStorage = global.localStorage;

    const elementMap = createSettingsDomMap();
    global.document = createMockDocument(elementMap);
    global.alert = () => {};
    global.localStorage = createLocalStorageStub();

    try {
      const { initSettingsController } = require("../../../src/controllers/settings-controller");
      const resolvedGateway = initSettingsController();

      assert.equal(typeof resolvedGateway, "object");
      assert.equal(typeof resolvedGateway.getApiKey, "function");
      assert.equal(typeof resolvedGateway.getSettings, "function");
      assert.equal(typeof resolvedGateway.getAiApps, "function");
      assert.equal(typeof resolvedGateway.getPromptTemplates, "function");
      assert.equal(typeof resolvedGateway.getStorage, "function");
    } finally {
      global.document = originalDocument;
      global.alert = originalAlert;
      global.localStorage = originalLocalStorage;
    }
  });
});
