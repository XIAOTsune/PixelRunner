const WORKSPACE_DOM_IDS = [
  "btnRun",
  "btnOpenAppPicker",
  "btnRefreshWorkspaceApps",
  "pasteStrategySelect",
  "btnClearLog",
  "taskStatusSummary",
  "appPickerMeta",
  "dynamicInputContainer",
  "imageInputContainer",
  "logWindow",
  "appPickerModal",
  "appPickerModalClose",
  "appPickerSearchInput",
  "appPickerStats",
  "appPickerList",
  "templateModal",
  "templateModalTitle",
  "templateList",
  "templateModalActions",
  "templateModalSelectionInfo",
  "btnApplyTemplateSelection",
  "templateModalClose",
  "accountSummary",
  "accountBalanceValue",
  "accountCoinsValue"
];

function createWorkspaceInitController(options = {}) {
  const dom = options.dom || {};
  const byId = typeof options.byId === "function" ? options.byId : () => null;
  const rebindEvent = typeof options.rebindEvent === "function" ? options.rebindEvent : () => {};
  const appEvents = options.appEvents && typeof options.appEvents === "object" ? options.appEvents : {};
  const documentRef = options.documentRef || (typeof document !== "undefined" ? document : null);
  const consoleWarn = typeof options.consoleWarn === "function" ? options.consoleWarn : console.warn;

  function collectDomRefs() {
    const missingIds = [];
    WORKSPACE_DOM_IDS.forEach((id) => {
      dom[id] = byId(id);
      if (!dom[id]) {
        missingIds.push(id);
      }
    });
    if (missingIds.length > 0) {
      consoleWarn(`[WorkspaceInit] Missing DOM refs: ${missingIds.join(", ")}`);
    }
    return missingIds;
  }

  function bindWorkspaceEvents(handlers = {}) {
    rebindEvent(dom.btnRun, "click", handlers.onRun);
    rebindEvent(dom.btnOpenAppPicker, "click", handlers.onOpenAppPickerModal);
    rebindEvent(dom.appPickerModalClose, "click", handlers.onCloseAppPickerModal);
    rebindEvent(dom.appPickerModal, "click", handlers.onAppPickerModalClick);
    rebindEvent(dom.appPickerList, "click", handlers.onAppPickerListClick);
    rebindEvent(dom.appPickerSearchInput, "input", handlers.onAppPickerSearchInput);
    rebindEvent(dom.btnRefreshWorkspaceApps, "click", handlers.onRefreshWorkspaceClick);
    rebindEvent(dom.pasteStrategySelect, "change", handlers.onPasteStrategyChange);
    rebindEvent(dom.templateModalClose, "click", handlers.onCloseTemplatePicker);
    rebindEvent(dom.templateModal, "click", handlers.onTemplateModalClick);
    rebindEvent(dom.templateList, "click", handlers.onTemplateListClick);
    rebindEvent(dom.btnApplyTemplateSelection, "click", handlers.onApplyTemplateSelectionClick);
    rebindEvent(dom.btnClearLog, "click", handlers.onClearLogClick);

    if (!documentRef) return;
    if (appEvents.APPS_CHANGED) {
      rebindEvent(documentRef, appEvents.APPS_CHANGED, handlers.onAppsChanged);
    }
    if (appEvents.TEMPLATES_CHANGED) {
      rebindEvent(documentRef, appEvents.TEMPLATES_CHANGED, handlers.onTemplatesChanged);
    }
    if (appEvents.SETTINGS_CHANGED) {
      rebindEvent(documentRef, appEvents.SETTINGS_CHANGED, handlers.onSettingsChanged);
    }
  }

  function bindWorkspaceEventsFromDelegates(delegates = {}) {
    bindWorkspaceEvents({
      onRun: delegates.handleRun,
      onOpenAppPickerModal: delegates.openAppPickerModal,
      onCloseAppPickerModal: delegates.closeAppPickerModal,
      onAppPickerModalClick: delegates.onAppPickerModalClick,
      onAppPickerListClick: delegates.handleAppPickerListClick,
      onAppPickerSearchInput: delegates.onAppPickerSearchInput,
      onRefreshWorkspaceClick: delegates.onRefreshWorkspaceClick,
      onPasteStrategyChange: delegates.onPasteStrategyChange,
      onCloseTemplatePicker: delegates.closeTemplatePicker,
      onTemplateModalClick: delegates.onTemplateModalClick,
      onTemplateListClick: delegates.handleTemplateListClick,
      onApplyTemplateSelectionClick: delegates.onApplyTemplateSelectionClick,
      onClearLogClick: delegates.onClearLogClick,
      onAppsChanged: delegates.onAppsChanged,
      onTemplatesChanged: delegates.onTemplatesChanged,
      onSettingsChanged: delegates.onSettingsChanged
    });
  }

  return {
    collectDomRefs,
    bindWorkspaceEvents,
    bindWorkspaceEventsFromDelegates
  };
}

module.exports = {
  WORKSPACE_DOM_IDS,
  createWorkspaceInitController
};
