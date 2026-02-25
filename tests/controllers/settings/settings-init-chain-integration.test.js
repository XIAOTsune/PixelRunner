const test = require("node:test");
const assert = require("node:assert/strict");
const {
  SETTINGS_DOM_IDS,
  createSettingsInitController
} = require("../../../src/controllers/settings/settings-init-controller");
const {
  createSettingsCollapseTabController
} = require("../../../src/controllers/settings/settings-collapse-tab-controller");
const {
  createSettingsSubcontrollersRegistry
} = require("../../../src/controllers/settings/settings-subcontrollers-registry");

function createClassList(initial = []) {
  const values = new Set(initial);
  return {
    add: (className) => {
      values.add(String(className || ""));
    },
    remove: (className) => {
      values.delete(String(className || ""));
    },
    contains: (className) => values.has(String(className || ""))
  };
}

function createEventTarget(id) {
  const listeners = new Map();
  return {
    id,
    value: "",
    textContent: "",
    innerHTML: "",
    type: "text",
    style: {},
    dataset: {},
    disabled: false,
    scrollTop: 0,
    scrollHeight: 0,
    classList: createClassList(),
    addEventListener: (eventName, handler) => {
      listeners.set(String(eventName || ""), handler);
    },
    removeEventListener: (eventName, handler) => {
      const key = String(eventName || "");
      if (listeners.get(key) === handler) {
        listeners.delete(key);
      }
    },
    trigger: (eventName, payload = {}) => {
      const key = String(eventName || "");
      const handler = listeners.get(key);
      if (typeof handler !== "function") return;
      const eventPayload = Object.assign(
        {
          target: payload.target || null,
          currentTarget: payload.currentTarget || null,
          preventDefault: () => {}
        },
        payload
      );
      handler(eventPayload);
    }
  };
}

function createMockDocument(elementMap) {
  const listeners = new Map();
  return {
    getElementById: (id) => elementMap[id] || null,
    addEventListener: (eventName, handler) => {
      listeners.set(String(eventName || ""), handler);
    },
    removeEventListener: (eventName, handler) => {
      const key = String(eventName || "");
      if (listeners.get(key) === handler) {
        listeners.delete(key);
      }
    },
    trigger: (eventName, payload = {}) => {
      const key = String(eventName || "");
      const handler = listeners.get(key);
      if (typeof handler !== "function") return;
      handler(payload);
    }
  };
}

function createElementMap() {
  const map = SETTINGS_DOM_IDS.reduce((acc, id) => {
    acc[id] = createEventTarget(id);
    return acc;
  }, {});
  map.tabSettings = createEventTarget("tabSettings");
  return map;
}

test("settings init chain integration wires init -> bind -> subcontrollers", () => {
  const originalDocument = global.document;
  const elementMap = createElementMap();
  const mockDocument = createMockDocument(elementMap);
  global.document = mockDocument;

  const calls = {
    syncSnapshot: 0,
    syncLists: 0,
    updateHint: 0,
    loadDiagnosticsSummary: 0,
    toggleSectionCollapse: 0,
    saveApiKeyAndSettings: 0,
    testApiKey: 0,
    parseApp: 0,
    saveTemplate: 0,
    exportTemplatesJson: 0,
    importTemplatesJson: 0,
    onTemplateContentPaste: 0,
    onSavedAppsListClick: 0,
    onSavedTemplatesListClick: 0,
    onAppsChanged: 0,
    onTemplatesChanged: 0
  };

  let registry = null;
  const delegates = {
    saveApiKeyAndSettings: () => {
      registry.getSettingsEditorController().saveApiKeyAndSettings();
    },
    testApiKey: () => {
      registry.getSettingsEditorController().testApiKey();
    },
    parseApp: () => {
      registry.getSettingsParseController().parseApp();
    },
    onToggleApiKey: () => {
      elementMap.apiKeyInput.type = elementMap.apiKeyInput.type === "password" ? "text" : "password";
    },
    saveTemplate: () => {
      registry.getSettingsEditorController().saveTemplate();
    },
    exportTemplatesJson: () => {
      registry.getSettingsDiagnosticsTransferController().exportTemplatesJson();
    },
    importTemplatesJson: () => {
      registry.getSettingsDiagnosticsTransferController().importTemplatesJson();
    },
    loadDiagnosticsSummary: () => {
      registry.getSettingsDiagnosticsTransferController().loadDiagnosticsSummary();
    },
    updateTemplateLengthHint: () => {
      registry.getSettingsEditorController().updateTemplateLengthHint();
    },
    onTemplateContentPaste: (event) => {
      registry.getSettingsEditorController().onTemplateContentPaste(event);
    },
    onSavedAppsListClick: (event) => {
      registry.getSettingsListsController().onSavedAppsListClick(event);
    },
    onSavedTemplatesListClick: (event) => {
      registry.getSettingsListsController().onSavedTemplatesListClick(event);
    },
    onAppsChanged: () => {
      registry.getSettingsListsController().onAppsChanged();
    },
    onTemplatesChanged: () => {
      registry.getSettingsListsController().onTemplatesChanged();
    },
    renderSavedTemplates: () => {
      registry.getSettingsListsController().renderSavedTemplates();
    },
    renderSavedAppsList: () => {
      registry.getSettingsListsController().renderSavedAppsList();
    },
    syncSettingsLists: () => {
      registry.getSettingsListsController().syncSettingsLists();
    }
  };

  registry = createSettingsSubcontrollersRegistry({
    dom: {},
    getStore: () => ({ tag: "store" }),
    appEvents: {
      APPS_CHANGED: "apps_changed",
      TEMPLATES_CHANGED: "templates_changed"
    },
    byId: (id) => mockDocument.getElementById(id),
    rebindEvent: (target, eventName, handler) => {
      if (!target || typeof target.addEventListener !== "function") return;
      target.removeEventListener(eventName, handler);
      target.addEventListener(eventName, handler);
    },
    toggleSectionCollapse: () => {
      calls.toggleSectionCollapse += 1;
      return true;
    },
    createSettingsInitController,
    createSettingsCollapseTabController,
    createSettingsListsController: () => ({
      syncSettingsLists: () => {
        calls.syncLists += 1;
      },
      renderSavedAppsList: () => {},
      renderSavedTemplates: () => {},
      onSavedAppsListClick: () => {
        calls.onSavedAppsListClick += 1;
      },
      onSavedTemplatesListClick: () => {
        calls.onSavedTemplatesListClick += 1;
      },
      onAppsChanged: () => {
        calls.onAppsChanged += 1;
      },
      onTemplatesChanged: () => {
        calls.onTemplatesChanged += 1;
      }
    }),
    createSettingsDiagnosticsTransferController: () => ({
      loadDiagnosticsSummary: () => {
        calls.loadDiagnosticsSummary += 1;
      },
      exportTemplatesJson: () => {
        calls.exportTemplatesJson += 1;
      },
      importTemplatesJson: () => {
        calls.importTemplatesJson += 1;
      }
    }),
    createSettingsParseController: () => ({
      parseApp: () => {
        calls.parseApp += 1;
      }
    }),
    createSettingsEditorController: () => ({
      syncSettingsSnapshot: () => {
        calls.syncSnapshot += 1;
      },
      updateTemplateLengthHint: () => {
        calls.updateHint += 1;
      },
      onTemplateContentPaste: () => {
        calls.onTemplateContentPaste += 1;
      },
      saveApiKeyAndSettings: () => {
        calls.saveApiKeyAndSettings += 1;
      },
      testApiKey: () => {
        calls.testApiKey += 1;
      },
      saveTemplate: () => {
        calls.saveTemplate += 1;
      }
    }),
    delegates
  });

  try {
    registry.getSettingsInitController().initialize();

    assert.equal(calls.syncSnapshot, 1);
    assert.equal(calls.syncLists, 1);
    assert.equal(calls.updateHint, 1);
    assert.equal(calls.loadDiagnosticsSummary, 1);
    assert.equal(elementMap.advancedSettingsToggle.textContent, "展开");
    assert.equal(elementMap.envDiagnosticsToggle.textContent, "展开");

    elementMap.btnSaveApiKey.trigger("click");
    elementMap.btnTestApiKey.trigger("click");
    elementMap.btnParseApp.trigger("click");
    elementMap.btnSaveTemplate.trigger("click");
    elementMap.btnExportTemplatesJson.trigger("click");
    elementMap.btnImportTemplatesJson.trigger("click");
    elementMap.btnLoadDiagnosticsSummary.trigger("click");
    elementMap.templateContentInput.trigger("input");
    elementMap.templateContentInput.trigger("paste");
    elementMap.savedAppsList.trigger("click");
    elementMap.savedTemplatesList.trigger("click");
    elementMap.advancedSettingsHeader.trigger("click");
    elementMap.envDiagnosticsHeader.trigger("click");
    elementMap.tabSettings.trigger("click");
    mockDocument.trigger("apps_changed");
    mockDocument.trigger("templates_changed");

    assert.equal(calls.saveApiKeyAndSettings, 1);
    assert.equal(calls.testApiKey, 1);
    assert.equal(calls.parseApp, 1);
    assert.equal(calls.saveTemplate, 1);
    assert.equal(calls.exportTemplatesJson, 1);
    assert.equal(calls.importTemplatesJson, 1);
    assert.equal(calls.loadDiagnosticsSummary, 2);
    assert.equal(calls.updateHint, 2);
    assert.equal(calls.onTemplateContentPaste, 1);
    assert.equal(calls.onSavedAppsListClick, 1);
    assert.equal(calls.onSavedTemplatesListClick, 1);
    assert.equal(calls.onAppsChanged, 1);
    assert.equal(calls.onTemplatesChanged, 1);
    assert.equal(calls.toggleSectionCollapse, 2);
    assert.equal(calls.syncLists, 2);
  } finally {
    global.document = originalDocument;
  }
});
