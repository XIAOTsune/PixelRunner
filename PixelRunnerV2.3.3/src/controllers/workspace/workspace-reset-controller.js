function disposeController(controller) {
  if (controller && typeof controller.dispose === "function") {
    controller.dispose();
  }
}

function createWorkspaceResetBeforeInitParams(options = {}) {
  const controllers =
    options && options.controllers && typeof options.controllers === "object" ? options.controllers : {};
  return {
    state: options.state || {},
    runGuard: options.runGuard || null,
    runButtonPhaseEnum: options.runButtonPhaseEnum || {},
    runButtonPhaseController: controllers.runButtonPhaseController,
    runStatusController: controllers.runStatusController,
    runWorkflowController: controllers.runWorkflowController,
    appPickerController: controllers.appPickerController,
    templatePickerController: controllers.templatePickerController,
    workspaceSettingsController: controllers.workspaceSettingsController,
    workspaceInitController: controllers.workspaceInitController,
    workspaceLogController: controllers.workspaceLogController
  };
}

function createWorkspaceResetController(options = {}) {
  const clearIntervalFn =
    typeof options.clearInterval === "function" ? options.clearInterval : () => {};

  function resetBeforeInit(params = {}) {
    const state = params.state || {};
    const runGuard = params.runGuard || null;
    const runButtonPhaseEnum = params.runButtonPhaseEnum || {};

    disposeController(params.runButtonPhaseController);
    disposeController(params.runStatusController);
    disposeController(params.runWorkflowController);

    state.runButtonTimerId = null;
    state.taskSummaryHintText = "";
    state.taskSummaryHintType = "info";
    state.taskSummaryHintUntil = 0;
    state.taskSummaryHintTimerId = null;
    if (state.taskSummaryTimerId) {
      clearIntervalFn(state.taskSummaryTimerId);
      state.taskSummaryTimerId = null;
    }
    if (runGuard && typeof runGuard.reset === "function") {
      runGuard.reset();
    }
    state.runButtonPhase = runButtonPhaseEnum.IDLE;

    return {
      runButtonPhaseController: null,
      runStatusController: null,
      runWorkflowController: null,
      appPickerController: null,
      templatePickerController: null,
      workspaceSettingsController: null,
      workspaceInitController: null,
      workspaceLogController: null
    };
  }

  return {
    resetBeforeInit
  };
}

module.exports = {
  createWorkspaceResetBeforeInitParams,
  createWorkspaceResetController
};
