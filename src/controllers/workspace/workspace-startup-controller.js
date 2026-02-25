function asCallable(candidate) {
  return typeof candidate === "function" ? candidate : () => {};
}

function invokeControllerMethod(getController, methodName, ...args) {
  if (typeof getController !== "function") return;
  const controller = getController();
  if (!controller || typeof controller[methodName] !== "function") return;
  controller[methodName](...args);
}

function createWorkspaceStartupControllerOptions(options = {}) {
  const getWorkspaceInitController =
    typeof options.getWorkspaceInitController === "function" ? options.getWorkspaceInitController : () => null;
  const getTemplatePickerController =
    typeof options.getTemplatePickerController === "function" ? options.getTemplatePickerController : () => null;
  const getWorkspaceSettingsController =
    typeof options.getWorkspaceSettingsController === "function" ? options.getWorkspaceSettingsController : () => null;
  const ensureRunButtonPhaseController = asCallable(options.ensureRunButtonPhaseController);
  const resetWorkspaceInputs = asCallable(options.resetWorkspaceInputs);
  const getWorkspaceEventDelegates =
    typeof options.getWorkspaceEventDelegates === "function" ? options.getWorkspaceEventDelegates : () => ({});
  const updateAccountStatus = asCallable(options.updateAccountStatus);
  const syncWorkspaceApps = asCallable(options.syncWorkspaceApps);
  const updateRunButtonUI = asCallable(options.updateRunButtonUI);
  const updateTaskStatusSummary = asCallable(options.updateTaskStatusSummary);

  return {
    cacheDomRefs: () => {
      invokeControllerMethod(getWorkspaceInitController, "collectDomRefs");
    },
    ensureRunButtonPhaseController,
    resetTemplatePicker: () => {
      invokeControllerMethod(getTemplatePickerController, "reset");
    },
    syncPasteStrategySelect: () => {
      invokeControllerMethod(getWorkspaceSettingsController, "syncPasteStrategySelect");
    },
    resetWorkspaceInputs,
    bindWorkspaceEvents: () => {
      invokeControllerMethod(
        getWorkspaceInitController,
        "bindWorkspaceEventsFromDelegates",
        getWorkspaceEventDelegates() || {}
      );
    },
    updateAccountStatus,
    syncWorkspaceApps,
    updateRunButtonUI,
    updateTaskStatusSummary
  };
}

function createWorkspaceStartupController(options = {}) {
  const cacheDomRefs = asCallable(options.cacheDomRefs);
  const ensureRunButtonPhaseController = asCallable(options.ensureRunButtonPhaseController);
  const resetTemplatePicker = asCallable(options.resetTemplatePicker);
  const syncPasteStrategySelect = asCallable(options.syncPasteStrategySelect);
  const resetWorkspaceInputs = asCallable(options.resetWorkspaceInputs);
  const bindWorkspaceEvents = asCallable(options.bindWorkspaceEvents);
  const updateAccountStatus = asCallable(options.updateAccountStatus);
  const syncWorkspaceApps = asCallable(options.syncWorkspaceApps);
  const updateRunButtonUI = asCallable(options.updateRunButtonUI);
  const updateTaskStatusSummary = asCallable(options.updateTaskStatusSummary);

  function runInitSequence() {
    cacheDomRefs();
    ensureRunButtonPhaseController();
    resetTemplatePicker();
    syncPasteStrategySelect();
    resetWorkspaceInputs();
    bindWorkspaceEvents();
    updateAccountStatus();
    syncWorkspaceApps({ forceRerender: true });
    updateRunButtonUI();
    updateTaskStatusSummary();
  }

  return {
    runInitSequence
  };
}

module.exports = {
  createWorkspaceStartupControllerOptions,
  createWorkspaceStartupController
};
