const test = require("node:test");
const assert = require("node:assert/strict");
const { createSettingsListsController } = require("../../../src/controllers/settings/settings-lists-controller");

function createFixture(options = {}) {
  const state = {
    parsedAppData: null,
    currentEditingAppId: null
  };
  const apps = Array.isArray(options.apps)
    ? options.apps
    : [
      { id: "app-1", appId: "1001", name: "Portrait", inputs: [{ key: "a" }] },
      { id: "app-2", appId: "1002", name: "Anime", inputs: [] }
    ];
  const templates = Array.isArray(options.templates)
    ? options.templates
    : [
      { id: "tpl-1", title: "A", content: "alpha" },
      { id: "tpl-2", title: "B", content: "beta" }
    ];
  const dom = {
    savedAppsList: {
      innerHTML: ""
    },
    savedTemplatesList: {
      innerHTML: ""
    },
    appIdInput: { value: "" },
    appNameInput: { value: "" },
    parseResultContainer: { innerHTML: "" },
    templateTitleInput: { value: "" },
    templateContentInput: { value: "" },
    envDoctorOutput: { value: "" }
  };
  const calls = {
    emitEvents: [],
    appends: [],
    alerts: [],
    updateTemplateLengthHint: 0,
    deleteTemplateCalls: 0
  };
  let nextSavedAppsAction = { kind: "none", id: "" };
  let nextSavedTemplatesAction = { kind: "none", id: "" };

  const controller = createSettingsListsController({
    state,
    dom,
    getStore: () => ({ tag: "store" }),
    appEvents: {
      APPS_CHANGED: "apps_changed",
      TEMPLATES_CHANGED: "templates_changed"
    },
    emitAppEvent: (eventName, payload) => {
      calls.emitEvents.push({ eventName, payload });
    },
    buildSavedAppsListViewModel: (items) => ({
      empty: !items.length,
      items
    }),
    buildSavedTemplatesListViewModel: (items) => ({
      empty: !items.length,
      items
    }),
    listSavedAppsUsecase: () => apps.slice(),
    findSavedAppByIdUsecase: ({ id }) => apps.find((item) => item.id === id) || null,
    loadEditableAppUsecase: ({ app }) =>
      app
        ? {
            found: true,
            appId: app.appId,
            appName: app.name,
            currentEditingAppId: app.id,
            parsedAppData: { id: app.id }
          }
        : {
            found: false
          },
    deleteAppUsecase: ({ id }) => {
      const index = apps.findIndex((item) => item.id === id);
      if (index < 0) return { deleted: false };
      apps.splice(index, 1);
      return { deleted: true };
    },
    listSavedTemplatesUsecase: () => templates.slice(),
    findSavedTemplateByIdUsecase: ({ id }) => templates.find((item) => item.id === id) || null,
    loadEditableTemplateUsecase: ({ template }) =>
      template
        ? {
            found: true,
            title: template.title,
            content: template.content
          }
        : {
            found: false
          },
    deleteTemplateUsecase: ({ id }) => {
      calls.deleteTemplateCalls += 1;
      const index = templates.findIndex((item) => item.id === id);
      if (index < 0) return { deleted: false };
      templates.splice(index, 1);
      return { deleted: true };
    },
    renderSavedAppsListHtml: (viewModel) => `apps:${viewModel.items.length}`,
    renderSavedTemplatesListHtml: (viewModel) => `templates:${viewModel.items.length}`,
    resolveSavedAppsListAction: () => nextSavedAppsAction,
    resolveSavedTemplatesListAction: () => nextSavedTemplatesAction,
    findClosestByClass: () => null,
    decodeDataId: (value) => String(value || ""),
    escapeHtml: (value) => String(value || ""),
    encodeDataId: (value) => String(value || ""),
    appendEnvDoctorOutput: (_target, line) => {
      calls.appends.push(String(line || ""));
    },
    updateTemplateLengthHint: () => {
      calls.updateTemplateLengthHint += 1;
    },
    safeConfirm: () => false,
    log: () => {},
    alert: (message) => {
      calls.alerts.push(String(message || ""));
    }
  });

  return {
    controller,
    state,
    dom,
    calls,
    setSavedAppsAction: (action) => {
      nextSavedAppsAction = action;
    },
    setSavedTemplatesAction: (action) => {
      nextSavedTemplatesAction = action;
    }
  };
}

test("settings lists controller sync renders both saved lists", () => {
  const fixture = createFixture();
  const { controller, dom } = fixture;

  controller.syncSettingsLists();

  assert.equal(dom.savedAppsList.innerHTML, "apps:2");
  assert.equal(dom.savedTemplatesList.innerHTML, "templates:2");
});

test("settings lists controller edit app action loads editable data into editor fields", () => {
  const fixture = createFixture();
  const { controller, state, dom, setSavedAppsAction } = fixture;
  setSavedAppsAction({ kind: "edit-app", id: "app-2" });

  controller.onSavedAppsListClick({});

  assert.equal(dom.appIdInput.value, "1002");
  assert.equal(dom.appNameInput.value, "Anime");
  assert.equal(state.currentEditingAppId, "app-2");
  assert.deepEqual(state.parsedAppData, { id: "app-2" });
  assert.equal(dom.parseResultContainer.innerHTML.length > 0, true);
});

test("settings lists controller delete app action emits APPS_CHANGED and rerenders list", () => {
  const fixture = createFixture();
  const { controller, dom, calls, setSavedAppsAction } = fixture;
  setSavedAppsAction({ kind: "delete-app", id: "app-1" });

  controller.onSavedAppsListClick({});

  assert.equal(calls.emitEvents.length, 1);
  assert.equal(calls.emitEvents[0].eventName, "apps_changed");
  assert.equal(calls.emitEvents[0].payload.id, "app-1");
  assert.equal(dom.savedAppsList.innerHTML, "apps:1");
  assert.equal(calls.alerts.length, 0);
});

test("settings lists controller edit template action updates editor and length hint", () => {
  const fixture = createFixture();
  const { controller, dom, calls, setSavedTemplatesAction } = fixture;
  setSavedTemplatesAction({ kind: "edit-template", id: "tpl-1" });

  controller.onSavedTemplatesListClick({});

  assert.equal(dom.templateTitleInput.value, "A");
  assert.equal(dom.templateContentInput.value, "alpha");
  assert.equal(calls.updateTemplateLengthHint, 1);
});

test("settings lists controller delete template action deletes immediately without confirm", () => {
  const fixture = createFixture();
  const { controller, dom, calls, setSavedTemplatesAction } = fixture;
  setSavedTemplatesAction({ kind: "delete-template", id: "tpl-2" });

  controller.onSavedTemplatesListClick({});

  assert.equal(calls.deleteTemplateCalls, 1);
  assert.equal(calls.emitEvents.length, 1);
  assert.equal(calls.emitEvents[0].eventName, "templates_changed");
  assert.equal(calls.emitEvents[0].payload.id, "tpl-2");
  assert.equal(dom.savedTemplatesList.innerHTML, "templates:1");
});
