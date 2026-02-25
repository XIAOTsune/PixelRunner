const test = require("node:test");
const assert = require("node:assert/strict");
const { buildAppPickerViewModel } = require("../../../src/application/services/app-picker");
const { createAppPickerController } = require("../../../src/controllers/workspace/app-picker-controller");

function createClassList(initial = []) {
  const classes = new Set(initial);
  return {
    add: (className) => classes.add(className),
    remove: (className) => classes.delete(className),
    contains: (className) => classes.has(className)
  };
}

function createFixture(options = {}) {
  const state = {
    currentApp: options.currentApp || null,
    appPickerKeyword: String(options.keyword || "")
  };
  const apps = Array.isArray(options.apps)
    ? options.apps
    : [
      { id: "app-1", name: "Portrait", appId: "100", inputs: [{ key: "a" }] },
      { id: "app-2", name: "Anime", appId: "200", inputs: [] }
    ];
  let containsFn = () => false;
  const dom = {
    appPickerModal: {
      classList: createClassList()
    },
    appPickerSearchInput: {
      value: String(options.searchInputValue || "")
    },
    appPickerStats: {
      textContent: ""
    },
    appPickerList: {
      innerHTML: "",
      contains: (node) => containsFn(node)
    }
  };
  const calls = {
    renderDynamicInputs: [],
    updateCurrentAppMeta: 0,
    updateRunButtonUI: 0,
    refreshModalOpenState: 0,
    renderViewModels: []
  };
  const alerts = [];
  const tabSettings = {
    clickCount: 0,
    click() {
      this.clickCount += 1;
    }
  };

  const controller = createAppPickerController({
    state,
    dom,
    store: {
      getAiApps: () => apps
    },
    byId: (id) => (id === "tabSettings" ? tabSettings : null),
    decodeDataId: (value) => String(value || "").replace(/^enc:/, ""),
    escapeHtml: (value) => String(value || ""),
    encodeDataId: (value) => `enc:${String(value || "")}`,
    renderAppPickerListHtml: (viewModel) => {
      calls.renderViewModels.push(viewModel);
      if (viewModel.empty) {
        return `empty:${viewModel.emptyState && viewModel.emptyState.kind}`;
      }
      return viewModel.items.map((item) => item.id).join(",");
    },
    buildAppPickerViewModel,
    renderDynamicInputs: (app) => {
      calls.renderDynamicInputs.push(app);
      if (options.throwOnRenderDynamicInputs) {
        throw new Error(options.throwOnRenderDynamicInputs);
      }
      state.currentApp = app || null;
    },
    updateCurrentAppMeta: () => {
      calls.updateCurrentAppMeta += 1;
    },
    updateRunButtonUI: () => {
      calls.updateRunButtonUI += 1;
    },
    refreshModalOpenState: () => {
      calls.refreshModalOpenState += 1;
    },
    alert: (message) => {
      alerts.push(String(message || ""));
    }
  });

  return {
    controller,
    state,
    dom,
    calls,
    alerts,
    tabSettings,
    setListContains: (fn) => {
      containsFn = fn;
    }
  };
}

function createListClickEvent(options = {}) {
  return {
    target: {
      closest: (selector) => {
        if (selector === "button[data-action='goto-settings']") return options.gotoSettings ? {} : null;
        if (selector === ".app-picker-item[data-id]") return options.item || null;
        return null;
      }
    }
  };
}

test("app picker controller open resets keyword and search text, then supports search render", () => {
  const fixture = createFixture({
    keyword: "old",
    searchInputValue: "before-open"
  });
  const { controller, state, dom, calls } = fixture;

  controller.open();

  assert.equal(state.appPickerKeyword, "");
  assert.equal(dom.appPickerSearchInput.value, "");
  assert.equal(dom.appPickerModal.classList.contains("active"), true);
  assert.equal(dom.appPickerStats.textContent, "2 / 2");
  assert.equal(dom.appPickerList.innerHTML, "app-1,app-2");
  assert.equal(calls.refreshModalOpenState, 1);

  dom.appPickerSearchInput.value = "anime";
  controller.onSearchInput();

  assert.equal(state.appPickerKeyword, "anime");
  assert.equal(dom.appPickerStats.textContent, "1 / 2");
  assert.equal(dom.appPickerList.innerHTML, "app-2");
});

test("app picker controller sync with empty apps keeps current view untouched and refreshes meta/button", () => {
  const fixture = createFixture({
    apps: [],
    currentApp: null
  });
  const { controller, calls, dom } = fixture;

  controller.sync({ forceRerender: false });

  assert.equal(calls.renderDynamicInputs.length, 0);
  assert.equal(calls.updateCurrentAppMeta, 1);
  assert.equal(calls.updateRunButtonUI, 1);
  assert.equal(dom.appPickerList.innerHTML, "empty:no_apps");
});

test("app picker controller sync selects first app when current app is missing", () => {
  const fixture = createFixture({
    currentApp: { id: "missing", name: "Missing app" }
  });
  const { controller, state, calls, dom } = fixture;

  controller.sync({ forceRerender: false });

  assert.equal(calls.renderDynamicInputs.length, 1);
  assert.equal(calls.renderDynamicInputs[0].id, "app-1");
  assert.equal(state.currentApp && state.currentApp.id, "app-1");
  assert.equal(dom.appPickerStats.textContent, "2 / 2");
});

test("app picker controller goto-settings action closes modal and switches tab", () => {
  const fixture = createFixture();
  const { controller, dom, tabSettings, calls } = fixture;

  controller.open();
  controller.handleListClick(createListClickEvent({ gotoSettings: true }));

  assert.equal(tabSettings.clickCount, 1);
  assert.equal(dom.appPickerModal.classList.contains("active"), false);
  assert.equal(calls.refreshModalOpenState, 2);
});

test("app picker controller selects app from list click and closes modal", () => {
  const fixture = createFixture();
  const { controller, setListContains, calls, alerts, dom } = fixture;
  const item = {
    dataset: {
      id: "enc:app-2"
    }
  };
  setListContains((node) => node === item);

  controller.open();
  controller.handleListClick(createListClickEvent({ item }));

  assert.equal(calls.renderDynamicInputs.length, 1);
  assert.equal(calls.renderDynamicInputs[0].id, "app-2");
  assert.equal(dom.appPickerModal.classList.contains("active"), false);
  assert.equal(alerts.length, 0);
});

test("app picker controller select reports missing app and render failure", () => {
  const missingAppFixture = createFixture();
  const missingResult = missingAppFixture.controller.select("unknown-app-id");
  assert.equal(missingResult, false);
  assert.equal(missingAppFixture.alerts.length, 1);
  assert.match(missingAppFixture.alerts[0], /应用不存在/);

  const failingFixture = createFixture({
    throwOnRenderDynamicInputs: "boom"
  });
  const originalConsoleError = console.error;
  let failingResult;
  try {
    console.error = () => {};
    failingResult = failingFixture.controller.select("app-1");
  } finally {
    console.error = originalConsoleError;
  }
  assert.equal(failingResult, false);
  assert.equal(failingFixture.alerts.length, 1);
  assert.match(failingFixture.alerts[0], /加载应用失败: boom/);
});
