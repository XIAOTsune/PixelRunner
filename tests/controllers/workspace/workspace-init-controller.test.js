const test = require("node:test");
const assert = require("node:assert/strict");
const {
  WORKSPACE_DOM_IDS,
  createWorkspaceInitController
} = require("../../../src/controllers/workspace/workspace-init-controller");

function createDomMap() {
  return WORKSPACE_DOM_IDS.reduce((acc, id) => {
    acc[id] = { id };
    return acc;
  }, {});
}

function createHandlers() {
  return {
    onRun: () => {},
    onOpenAppPickerModal: () => {},
    onCloseAppPickerModal: () => {},
    onAppPickerModalClick: () => {},
    onAppPickerListClick: () => {},
    onAppPickerSearchInput: () => {},
    onRefreshWorkspaceClick: () => {},
    onCloseTemplatePicker: () => {},
    onTemplateModalClick: () => {},
    onTemplateListClick: () => {},
    onApplyTemplateSelectionClick: () => {},
    onClearLogClick: () => {},
    onAppsChanged: () => {},
    onTemplatesChanged: () => {},
    onSettingsChanged: () => {}
  };
}

function createDelegates(handlers) {
  return {
    handleRun: handlers.onRun,
    openAppPickerModal: handlers.onOpenAppPickerModal,
    closeAppPickerModal: handlers.onCloseAppPickerModal,
    onAppPickerModalClick: handlers.onAppPickerModalClick,
    handleAppPickerListClick: handlers.onAppPickerListClick,
    onAppPickerSearchInput: handlers.onAppPickerSearchInput,
    onRefreshWorkspaceClick: handlers.onRefreshWorkspaceClick,
    closeTemplatePicker: handlers.onCloseTemplatePicker,
    onTemplateModalClick: handlers.onTemplateModalClick,
    handleTemplateListClick: handlers.onTemplateListClick,
    onApplyTemplateSelectionClick: handlers.onApplyTemplateSelectionClick,
    onClearLogClick: handlers.onClearLogClick,
    onAppsChanged: handlers.onAppsChanged,
    onTemplatesChanged: handlers.onTemplatesChanged,
    onSettingsChanged: handlers.onSettingsChanged
  };
}

test("workspace init controller collectDomRefs maps all configured dom ids", () => {
  const dom = {};
  const elementMap = createDomMap();
  const calls = [];
  const controller = createWorkspaceInitController({
    dom,
    byId: (id) => {
      calls.push(String(id || ""));
      return elementMap[id] || null;
    }
  });

  controller.collectDomRefs();

  assert.deepEqual(calls, WORKSPACE_DOM_IDS);
  assert.equal(Object.keys(dom).length, WORKSPACE_DOM_IDS.length);
  WORKSPACE_DOM_IDS.forEach((id) => {
    assert.equal(dom[id], elementMap[id]);
  });
});

test("workspace init controller collectDomRefs reports missing dom ids", () => {
  const dom = {};
  const warnings = [];
  const existingId = "btnRun";
  const controller = createWorkspaceInitController({
    dom,
    byId: (id) => (id === existingId ? { id } : null),
    consoleWarn: (message) => warnings.push(String(message || ""))
  });

  const missingIds = controller.collectDomRefs();

  assert.equal(Array.isArray(missingIds), true);
  assert.equal(missingIds.includes(existingId), false);
  assert.equal(missingIds.includes("btnOpenAppPicker"), true);
  assert.equal(missingIds.length, WORKSPACE_DOM_IDS.length - 1);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /\[WorkspaceInit\] Missing DOM refs:/);
  assert.match(warnings[0], /btnOpenAppPicker/);
});

test("workspace init controller bindWorkspaceEvents rebinds all dom and app events", () => {
  const dom = createDomMap();
  const handlers = createHandlers();
  const appEvents = {
    APPS_CHANGED: "apps_changed",
    TEMPLATES_CHANGED: "templates_changed",
    SETTINGS_CHANGED: "settings_changed"
  };
  const documentRef = { id: "document" };
  const bindings = [];
  const controller = createWorkspaceInitController({
    dom,
    appEvents,
    documentRef,
    rebindEvent: (target, eventName, handler) => {
      bindings.push({ target, eventName, handler });
    }
  });

  controller.bindWorkspaceEvents(handlers);

  assert.equal(bindings.length, 15);
  assert.deepEqual(
    bindings.map((item) => [item.target && item.target.id, item.eventName]),
    [
      ["btnRun", "click"],
      ["btnOpenAppPicker", "click"],
      ["appPickerModalClose", "click"],
      ["appPickerModal", "click"],
      ["appPickerList", "click"],
      ["appPickerSearchInput", "input"],
      ["btnRefreshWorkspaceApps", "click"],
      ["templateModalClose", "click"],
      ["templateModal", "click"],
      ["templateList", "click"],
      ["btnApplyTemplateSelection", "click"],
      ["btnClearLog", "click"],
      ["document", "apps_changed"],
      ["document", "templates_changed"],
      ["document", "settings_changed"]
    ]
  );
  assert.equal(bindings[0].handler, handlers.onRun);
  assert.equal(bindings[6].handler, handlers.onRefreshWorkspaceClick);
  assert.equal(bindings[14].handler, handlers.onSettingsChanged);
});

test("workspace init controller bindWorkspaceEventsFromDelegates maps delegates to handlers", () => {
  const dom = createDomMap();
  const handlers = createHandlers();
  const delegates = createDelegates(handlers);
  const appEvents = {
    APPS_CHANGED: "apps_changed",
    TEMPLATES_CHANGED: "templates_changed",
    SETTINGS_CHANGED: "settings_changed"
  };
  const documentRef = { id: "document" };
  const bindings = [];
  const controller = createWorkspaceInitController({
    dom,
    appEvents,
    documentRef,
    rebindEvent: (target, eventName, handler) => {
      bindings.push({ target, eventName, handler });
    }
  });

  controller.bindWorkspaceEventsFromDelegates(delegates);

  assert.equal(bindings.length, 15);
  assert.equal(bindings[0].handler, handlers.onRun);
  assert.equal(bindings[4].handler, handlers.onAppPickerListClick);
  assert.equal(bindings[9].handler, handlers.onTemplateListClick);
  assert.equal(bindings[14].handler, handlers.onSettingsChanged);
});
