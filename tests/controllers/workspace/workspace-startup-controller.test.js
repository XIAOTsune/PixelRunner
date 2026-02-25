const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createWorkspaceStartupController,
  createWorkspaceStartupControllerOptions
} = require("../../../src/controllers/workspace/workspace-startup-controller");

test("workspace startup controller runs init sequence in stable order", () => {
  const calls = [];
  const controller = createWorkspaceStartupController({
    cacheDomRefs: () => calls.push("cacheDomRefs"),
    ensureRunButtonPhaseController: () => calls.push("ensureRunButtonPhaseController"),
    resetTemplatePicker: () => calls.push("resetTemplatePicker"),
    syncPasteStrategySelect: () => calls.push("syncPasteStrategySelect"),
    resetWorkspaceInputs: () => calls.push("resetWorkspaceInputs"),
    bindWorkspaceEvents: () => calls.push("bindWorkspaceEvents"),
    updateAccountStatus: () => calls.push("updateAccountStatus"),
    syncWorkspaceApps: (options) => calls.push(`syncWorkspaceApps:${JSON.stringify(options)}`),
    updateRunButtonUI: () => calls.push("updateRunButtonUI"),
    updateTaskStatusSummary: () => calls.push("updateTaskStatusSummary")
  });

  controller.runInitSequence();

  assert.deepEqual(calls, [
    "cacheDomRefs",
    "ensureRunButtonPhaseController",
    "resetTemplatePicker",
    "syncPasteStrategySelect",
    "resetWorkspaceInputs",
    "bindWorkspaceEvents",
    "updateAccountStatus",
    "syncWorkspaceApps:{\"forceRerender\":true}",
    "updateRunButtonUI",
    "updateTaskStatusSummary"
  ]);
});

test("workspace startup controller tolerates missing handlers", () => {
  const controller = createWorkspaceStartupController();
  assert.doesNotThrow(() => {
    controller.runInitSequence();
  });
});

test("workspace startup options builder assembles stable init handlers from getters", () => {
  const calls = [];
  const delegates = { marker: "event-delegates" };
  const initController = {
    collectDomRefs: () => calls.push("cacheDomRefs"),
    bindWorkspaceEventsFromDelegates: (payload) => calls.push(`bindWorkspaceEvents:${payload.marker}`)
  };
  const templatePickerController = {
    reset: () => calls.push("resetTemplatePicker")
  };
  const settingsController = {
    syncPasteStrategySelect: () => calls.push("syncPasteStrategySelect")
  };

  const controller = createWorkspaceStartupController(
    createWorkspaceStartupControllerOptions({
      getWorkspaceInitController: () => initController,
      ensureRunButtonPhaseController: () => calls.push("ensureRunButtonPhaseController"),
      getTemplatePickerController: () => templatePickerController,
      getWorkspaceSettingsController: () => settingsController,
      resetWorkspaceInputs: () => calls.push("resetWorkspaceInputs"),
      getWorkspaceEventDelegates: () => delegates,
      updateAccountStatus: () => calls.push("updateAccountStatus"),
      syncWorkspaceApps: (options) => calls.push(`syncWorkspaceApps:${JSON.stringify(options)}`),
      updateRunButtonUI: () => calls.push("updateRunButtonUI"),
      updateTaskStatusSummary: () => calls.push("updateTaskStatusSummary")
    })
  );

  controller.runInitSequence();

  assert.deepEqual(calls, [
    "cacheDomRefs",
    "ensureRunButtonPhaseController",
    "resetTemplatePicker",
    "syncPasteStrategySelect",
    "resetWorkspaceInputs",
    "bindWorkspaceEvents:event-delegates",
    "updateAccountStatus",
    "syncWorkspaceApps:{\"forceRerender\":true}",
    "updateRunButtonUI",
    "updateTaskStatusSummary"
  ]);
});
