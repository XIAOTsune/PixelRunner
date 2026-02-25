const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createSettingsCollapseTabController
} = require("../../../src/controllers/settings/settings-collapse-tab-controller");

function createClassList(initial = []) {
  const classes = new Set(initial);
  return {
    add: (className) => {
      classes.add(String(className || ""));
    },
    remove: (className) => {
      classes.delete(String(className || ""));
    },
    contains: (className) => classes.has(String(className || ""))
  };
}

function createSectionElement(initialClasses = []) {
  return {
    classList: createClassList(initialClasses)
  };
}

function createToggleElement() {
  return {
    textContent: ""
  };
}

test("settings collapse tab controller initializes section collapse defaults", () => {
  const advancedSection = createSectionElement();
  const envDiagnosticsSection = createSectionElement();
  const advancedToggle = createToggleElement();
  const envDiagnosticsToggle = createToggleElement();
  const controller = createSettingsCollapseTabController({
    dom: {
      advancedSettingsSection: advancedSection,
      advancedSettingsToggle: advancedToggle,
      envDiagnosticsSection,
      envDiagnosticsToggle
    }
  });

  controller.initializeSectionCollapseState();

  assert.equal(advancedSection.classList.contains("is-collapsed"), true);
  assert.equal(envDiagnosticsSection.classList.contains("is-collapsed"), true);
  assert.equal(advancedToggle.textContent, "展开");
  assert.equal(envDiagnosticsToggle.textContent, "展开");
});

test("settings collapse tab controller toggle handlers delegate to section toggle view", () => {
  const advancedSection = createSectionElement(["is-collapsed"]);
  const envDiagnosticsSection = createSectionElement(["is-collapsed"]);
  const advancedToggle = createToggleElement();
  const envDiagnosticsToggle = createToggleElement();
  const toggleCalls = [];
  const controller = createSettingsCollapseTabController({
    dom: {
      advancedSettingsSection: advancedSection,
      advancedSettingsToggle: advancedToggle,
      envDiagnosticsSection,
      envDiagnosticsToggle
    },
    toggleSectionCollapse: (section, toggle, options) => {
      toggleCalls.push({ section, toggle, options });
      return true;
    }
  });

  controller.onAdvancedSettingsToggleClick();
  controller.onEnvDiagnosticsToggleClick();

  assert.equal(toggleCalls.length, 2);
  assert.equal(toggleCalls[0].section, advancedSection);
  assert.equal(toggleCalls[0].toggle, advancedToggle);
  assert.deepEqual(toggleCalls[0].options, {
    collapsedClass: "is-collapsed",
    expandText: "展开",
    collapseText: "收起"
  });
  assert.equal(toggleCalls[1].section, envDiagnosticsSection);
  assert.equal(toggleCalls[1].toggle, envDiagnosticsToggle);
});

test("settings collapse tab controller binds collapse and tab sync events", () => {
  const bindings = [];
  const toggleCalls = [];
  const byIdCalls = [];
  let syncCalls = 0;
  const dom = {
    advancedSettingsHeader: { id: "advanced-header" },
    advancedSettingsSection: createSectionElement(),
    advancedSettingsToggle: createToggleElement(),
    envDiagnosticsHeader: { id: "env-header" },
    envDiagnosticsSection: createSectionElement(),
    envDiagnosticsToggle: createToggleElement()
  };
  const tabSettings = { id: "tab-settings" };
  const controller = createSettingsCollapseTabController({
    dom,
    byId: (id) => {
      byIdCalls.push(String(id || ""));
      return id === "tabSettings" ? tabSettings : null;
    },
    rebindEvent: (target, eventName, handler) => {
      bindings.push({ target, eventName, handler });
    },
    toggleSectionCollapse: (section, toggle) => {
      toggleCalls.push({ section, toggle });
    },
    syncSettingsLists: () => {
      syncCalls += 1;
    }
  });

  controller.bindCollapseAndTabSyncEvents();

  assert.deepEqual(byIdCalls, ["tabSettings"]);
  assert.equal(bindings.length, 3);

  const advancedHeaderBinding = bindings.find(
    (binding) => binding.target === dom.advancedSettingsHeader && binding.eventName === "click"
  );
  const envHeaderBinding = bindings.find(
    (binding) => binding.target === dom.envDiagnosticsHeader && binding.eventName === "click"
  );
  const tabBinding = bindings.find(
    (binding) => binding.target === tabSettings && binding.eventName === "click"
  );

  assert.equal(typeof advancedHeaderBinding.handler, "function");
  assert.equal(typeof envHeaderBinding.handler, "function");
  assert.equal(typeof tabBinding.handler, "function");

  advancedHeaderBinding.handler();
  envHeaderBinding.handler();
  tabBinding.handler();

  assert.equal(toggleCalls.length, 2);
  assert.equal(toggleCalls[0].section, dom.advancedSettingsSection);
  assert.equal(toggleCalls[0].toggle, dom.advancedSettingsToggle);
  assert.equal(toggleCalls[1].section, dom.envDiagnosticsSection);
  assert.equal(toggleCalls[1].toggle, dom.envDiagnosticsToggle);
  assert.equal(syncCalls, 1);
});
