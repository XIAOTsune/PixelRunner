const test = require("node:test");
const assert = require("node:assert/strict");
const { escapeHtml } = require("../../../src/utils");
const { encodeDataId, decodeDataId } = require("../../../src/shared/dom-utils");
const { renderTemplatePickerListHtml } = require("../../../src/controllers/workspace/template-picker-view");
const {
  normalizeTemplatePickerConfig,
  sanitizeTemplateSelectionIds,
  toggleTemplateSelection,
  buildSingleTemplateSelectionPayload,
  buildMultipleTemplateSelectionPayload,
  buildTemplatePickerUiState,
  buildTemplatePickerListViewModel
} = require("../../../src/application/services/template-picker");
const { createTemplatePickerController } = require("../../../src/controllers/workspace/template-picker-controller");

function createClassList(initial = []) {
  const set = new Set(initial);
  return {
    add: (className) => {
      set.add(className);
    },
    remove: (className) => {
      set.delete(className);
    },
    contains: (className) => set.has(className)
  };
}

function createControllerFixture(options = {}) {
  const state = {
    templateSelectCallback: null,
    templatePickerMode: "single",
    templatePickerMaxSelection: 1,
    templatePickerSelectedIds: []
  };
  const templateModal = {
    classList: createClassList()
  };
  let containsFn = () => false;
  const dom = {
    templateModal,
    templateModalTitle: { textContent: "" },
    templateModalActions: { style: { display: "" } },
    templateModalSelectionInfo: { textContent: "" },
    btnApplyTemplateSelection: { disabled: true },
    templateList: {
      innerHTML: "",
      contains: (node) => containsFn(node)
    }
  };
  const templates = Array.isArray(options.templates)
    ? options.templates
    : [
      { id: "t1", title: "T1", content: "alpha" },
      { id: "t2", title: "T2", content: "beta" }
    ];
  let modalRefreshCount = 0;
  const tabSettings = {
    clickCount: 0,
    click() {
      this.clickCount += 1;
    }
  };
  const alerts = [];

  const controller = createTemplatePickerController({
    state,
    dom,
    store: {
      getPromptTemplates: () => templates
    },
    byId: (id) => (id === "tabSettings" ? tabSettings : null),
    decodeDataId,
    escapeHtml,
    encodeDataId,
    renderTemplatePickerListHtml,
    normalizeTemplatePickerConfig,
    toggleTemplateSelectionState: toggleTemplateSelection,
    sanitizeTemplateSelectionIds,
    buildSingleTemplateSelectionPayload,
    buildMultipleTemplateSelectionPayload,
    buildTemplatePickerUiState,
    buildTemplatePickerListViewModel,
    maxTemplateCombineCount: 5,
    promptMaxChars: 4000,
    refreshModalOpenState: () => {
      modalRefreshCount += 1;
    },
    alert: (message) => {
      alerts.push(String(message || ""));
    }
  });

  return {
    controller,
    state,
    dom,
    tabSettings,
    alerts,
    setTemplateListContains: (fn) => {
      containsFn = fn;
    },
    getModalRefreshCount: () => modalRefreshCount
  };
}

function createListEvent(item) {
  return {
    target: {
      closest: (selector) => {
        if (selector === "button[data-action='goto-settings']") return null;
        if (selector === ".app-picker-item[data-template-id]") return item;
        return null;
      }
    }
  };
}

test("template picker controller supports multiple selection apply flow", () => {
  const fixture = createControllerFixture();
  const { controller, state, setTemplateListContains, dom, alerts, getModalRefreshCount } = fixture;
  let appliedPayload = null;

  controller.open({
    mode: "multiple",
    maxSelection: 2,
    onApply: (payload) => {
      appliedPayload = payload;
    }
  });

  const item1 = { dataset: { templateId: encodeDataId("t1") } };
  const item2 = { dataset: { templateId: encodeDataId("t2") } };
  setTemplateListContains((node) => node === item1 || node === item2);

  controller.handleListClick(createListEvent(item1));
  controller.handleListClick(createListEvent(item2));
  controller.onApplyButtonClick();

  assert.equal(alerts.length, 0);
  assert.equal(appliedPayload && appliedPayload.mode, "multiple");
  assert.equal(appliedPayload && appliedPayload.content, "alpha\nbeta");
  assert.deepEqual(state.templatePickerSelectedIds, []);
  assert.equal(dom.templateModal.classList.contains("active"), false);
  assert.equal(getModalRefreshCount() > 0, true);
});

test("template picker controller handles goto-settings action", () => {
  const fixture = createControllerFixture();
  const { controller, tabSettings, dom } = fixture;

  controller.open({ mode: "single" });
  assert.equal(dom.templateModal.classList.contains("active"), true);

  controller.handleListClick({
    target: {
      closest: (selector) => {
        if (selector === "button[data-action='goto-settings']") return {};
        return null;
      }
    }
  });

  assert.equal(tabSettings.clickCount, 1);
  assert.equal(dom.templateModal.classList.contains("active"), false);
});

test("template picker controller sanitizes selection on templates changed", () => {
  const fixture = createControllerFixture({
    templates: [{ id: "t1", title: "T1", content: "alpha" }]
  });
  const { controller, state, dom } = fixture;

  controller.open({ mode: "multiple", maxSelection: 3 });
  state.templatePickerSelectedIds = ["t1", "missing-id"];
  assert.equal(dom.templateModal.classList.contains("active"), true);

  controller.onTemplatesChanged();

  assert.deepEqual(state.templatePickerSelectedIds, ["t1"]);
});
