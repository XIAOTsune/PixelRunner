const DEFAULT_COLLAPSED_CLASS = "is-collapsed";
const DEFAULT_EXPAND_TEXT = "展开";
const DEFAULT_COLLAPSE_TEXT = "收起";

function createSettingsCollapseTabController(options = {}) {
  const dom = options.dom || {};
  const byId = typeof options.byId === "function" ? options.byId : () => null;
  const rebindEvent = typeof options.rebindEvent === "function" ? options.rebindEvent : () => {};
  const toggleSectionCollapse =
    typeof options.toggleSectionCollapse === "function" ? options.toggleSectionCollapse : () => false;
  const syncSettingsLists =
    typeof options.syncSettingsLists === "function" ? options.syncSettingsLists : () => {};

  function setCollapsedByDefault(sectionEl, toggleEl) {
    if (sectionEl && sectionEl.classList && typeof sectionEl.classList.add === "function") {
      sectionEl.classList.add(DEFAULT_COLLAPSED_CLASS);
    }
    if (toggleEl) {
      toggleEl.textContent = DEFAULT_EXPAND_TEXT;
    }
  }

  function onAdvancedSettingsToggleClick() {
    toggleSectionCollapse(dom.advancedSettingsSection, dom.advancedSettingsToggle, {
      collapsedClass: DEFAULT_COLLAPSED_CLASS,
      expandText: DEFAULT_EXPAND_TEXT,
      collapseText: DEFAULT_COLLAPSE_TEXT
    });
  }

  function onEnvDiagnosticsToggleClick() {
    toggleSectionCollapse(dom.envDiagnosticsSection, dom.envDiagnosticsToggle, {
      collapsedClass: DEFAULT_COLLAPSED_CLASS,
      expandText: DEFAULT_EXPAND_TEXT,
      collapseText: DEFAULT_COLLAPSE_TEXT
    });
  }

  function onSettingsTabClick() {
    syncSettingsLists();
  }

  function initializeSectionCollapseState() {
    setCollapsedByDefault(dom.advancedSettingsSection, dom.advancedSettingsToggle);
    setCollapsedByDefault(dom.envDiagnosticsSection, dom.envDiagnosticsToggle);
  }

  function bindCollapseAndTabSyncEvents() {
    rebindEvent(dom.advancedSettingsHeader, "click", onAdvancedSettingsToggleClick);
    rebindEvent(dom.envDiagnosticsHeader, "click", onEnvDiagnosticsToggleClick);
    rebindEvent(byId("tabSettings"), "click", onSettingsTabClick);
  }

  return {
    initializeSectionCollapseState,
    bindCollapseAndTabSyncEvents,
    onAdvancedSettingsToggleClick,
    onEnvDiagnosticsToggleClick
  };
}

module.exports = {
  createSettingsCollapseTabController
};
