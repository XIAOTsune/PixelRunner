const test = require("node:test");
const assert = require("node:assert/strict");
const {
  SETTINGS_DOM_IDS,
  createSettingsInitController
} = require("../../../src/controllers/settings/settings-init-controller");

function createHandlers() {
  return {
    onSaveApiKeyAndSettings: () => {},
    onTestApiKey: () => {},
    onParseApp: () => {},
    onToggleApiKey: () => {},
    onSaveTemplate: () => {},
    onExportTemplatesJson: () => {},
    onImportTemplatesJson: () => {},
    onLoadDiagnosticsSummary: () => {},
    onUpdateTemplateLengthHint: () => {},
    onTemplateContentPaste: () => {},
    onSavedAppsListClick: () => {},
    onSavedTemplatesListClick: () => {},
    onAppsChanged: () => {},
    onTemplatesChanged: () => {}
  };
}

function createDomMap() {
  return SETTINGS_DOM_IDS.reduce((acc, id) => {
    acc[id] = { id };
    return acc;
  }, {});
}

test("settings init controller collectDomRefs maps all configured dom ids", () => {
  const dom = {};
  const elementMap = createDomMap();
  const calls = [];
  const controller = createSettingsInitController({
    dom,
    byId: (id) => {
      calls.push(String(id || ""));
      return elementMap[id] || null;
    }
  });

  controller.collectDomRefs();

  assert.deepEqual(calls, SETTINGS_DOM_IDS);
  assert.equal(Object.keys(dom).length, SETTINGS_DOM_IDS.length);
  SETTINGS_DOM_IDS.forEach((id) => {
    assert.equal(dom[id], elementMap[id]);
  });
});

test("settings init controller bindCoreEvents rebinds core listeners and collapse-tab sync hooks", () => {
  const dom = createDomMap();
  const handlers = createHandlers();
  const appEvents = {
    APPS_CHANGED: "apps_changed",
    TEMPLATES_CHANGED: "templates_changed"
  };
  const documentRef = { id: "document" };
  const bindings = [];
  let collapseTabBindCalls = 0;
  const controller = createSettingsInitController({
    dom,
    handlers,
    appEvents,
    documentRef,
    rebindEvent: (target, eventName, handler) => {
      bindings.push({ target, eventName, handler });
    },
    bindCollapseAndTabSyncEvents: () => {
      collapseTabBindCalls += 1;
    }
  });

  controller.bindCoreEvents();

  assert.equal(bindings.length, 15);
  assert.equal(collapseTabBindCalls, 1);
  assert.deepEqual(
    bindings.map((item) => [item.target && item.target.id, item.eventName]),
    [
      ["btnSaveApiKey", "click"],
      ["btnTestApiKey", "click"],
      ["btnParseApp", "click"],
      ["toggleApiKey", "click"],
      ["btnSaveTemplate", "click"],
      ["btnExportTemplatesJson", "click"],
      ["btnImportTemplatesJson", "click"],
      ["btnLoadDiagnosticsSummary", "click"],
      ["templateTitleInput", "input"],
      ["templateContentInput", "input"],
      ["templateContentInput", "paste"],
      ["savedAppsList", "click"],
      ["savedTemplatesList", "click"],
      ["document", "apps_changed"],
      ["document", "templates_changed"]
    ]
  );
  assert.equal(bindings[0].handler, handlers.onSaveApiKeyAndSettings);
  assert.equal(bindings[8].handler, handlers.onUpdateTemplateLengthHint);
  assert.equal(bindings[10].handler, handlers.onTemplateContentPaste);
});

test("settings init controller initialize keeps expected setup sequence", () => {
  const dom = {};
  const elementMap = createDomMap();
  const order = [];
  const controller = createSettingsInitController({
    dom,
    byId: (id) => elementMap[id] || null,
    handlers: createHandlers(),
    appEvents: {
      APPS_CHANGED: "apps_changed",
      TEMPLATES_CHANGED: "templates_changed"
    },
    documentRef: { id: "document" },
    rebindEvent: () => {
      order.push("bind_event");
    },
    initializeCollapseState: () => {
      order.push("init_collapse");
    },
    bindCollapseAndTabSyncEvents: () => {
      order.push("bind_collapse_tab");
    },
    syncSettingsSnapshot: () => {
      order.push("sync_snapshot");
    },
    syncSettingsLists: () => {
      order.push("sync_lists");
    },
    updateTemplateLengthHint: () => {
      order.push("update_hint");
    },
    loadDiagnosticsSummary: () => {
      order.push("load_diag_summary");
    }
  });

  controller.initialize();

  assert.equal(dom.apiKeyInput, elementMap.apiKeyInput);
  assert.equal(order[0], "init_collapse");
  assert.equal(order[1], "sync_snapshot");
  assert.equal(order[order.length - 3], "sync_lists");
  assert.equal(order[order.length - 2], "update_hint");
  assert.equal(order[order.length - 1], "load_diag_summary");
  assert.equal(order.filter((item) => item === "bind_event").length, 15);
  assert.equal(order.includes("bind_collapse_tab"), true);
});
