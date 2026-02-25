const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createWorkspaceResetBeforeInitParams,
  createWorkspaceResetController
} = require("../../../src/controllers/workspace/workspace-reset-controller");

test("workspace reset params builder maps state, run guard and controller refs", () => {
  const state = { runButtonPhase: "IDLE" };
  const runGuard = { reset: () => {} };
  const runButtonPhaseEnum = { IDLE: "IDLE" };
  const controllers = {
    runButtonPhaseController: { id: "phase" },
    runStatusController: { id: "status" },
    runWorkflowController: { id: "workflow" },
    appPickerController: { id: "app-picker" },
    templatePickerController: { id: "template-picker" },
    workspaceSettingsController: { id: "settings" },
    workspaceInitController: { id: "init" },
    workspaceLogController: { id: "log" }
  };

  assert.deepEqual(
    createWorkspaceResetBeforeInitParams({
      state,
      runGuard,
      runButtonPhaseEnum,
      controllers
    }),
    {
      state,
      runGuard,
      runButtonPhaseEnum,
      runButtonPhaseController: controllers.runButtonPhaseController,
      runStatusController: controllers.runStatusController,
      runWorkflowController: controllers.runWorkflowController,
      appPickerController: controllers.appPickerController,
      templatePickerController: controllers.templatePickerController,
      workspaceSettingsController: controllers.workspaceSettingsController,
      workspaceInitController: controllers.workspaceInitController,
      workspaceLogController: controllers.workspaceLogController
    }
  );
});

test("workspace reset controller disposes active controllers and clears init state", () => {
  const calls = {
    clearInterval: [],
    runGuardReset: 0,
    disposed: []
  };
  const state = {
    runButtonTimerId: 123,
    taskSummaryHintText: "busy",
    taskSummaryHintType: "warn",
    taskSummaryHintUntil: 888,
    taskSummaryHintTimerId: 456,
    taskSummaryTimerId: "task-timer",
    runButtonPhase: "SUBMITTING_GUARD"
  };
  const controller = createWorkspaceResetController({
    clearInterval: (timerId) => {
      calls.clearInterval.push(timerId);
    }
  });

  const nextControllers = controller.resetBeforeInit({
    state,
    runGuard: {
      reset: () => {
        calls.runGuardReset += 1;
      }
    },
    runButtonPhaseEnum: {
      IDLE: "IDLE"
    },
    runButtonPhaseController: {
      dispose: () => {
        calls.disposed.push("run-button-phase");
      }
    },
    runStatusController: {
      dispose: () => {
        calls.disposed.push("run-status");
      }
    },
    runWorkflowController: {
      dispose: () => {
        calls.disposed.push("run-workflow");
      }
    }
  });

  assert.deepEqual(calls.clearInterval, ["task-timer"]);
  assert.equal(calls.runGuardReset, 1);
  assert.deepEqual(calls.disposed, ["run-button-phase", "run-status", "run-workflow"]);
  assert.equal(state.runButtonTimerId, null);
  assert.equal(state.taskSummaryHintText, "");
  assert.equal(state.taskSummaryHintType, "info");
  assert.equal(state.taskSummaryHintUntil, 0);
  assert.equal(state.taskSummaryHintTimerId, null);
  assert.equal(state.taskSummaryTimerId, null);
  assert.equal(state.runButtonPhase, "IDLE");
  assert.deepEqual(nextControllers, {
    runButtonPhaseController: null,
    runStatusController: null,
    runWorkflowController: null,
    appPickerController: null,
    templatePickerController: null,
    workspaceSettingsController: null,
    workspaceInitController: null,
    workspaceLogController: null
  });
});

test("workspace reset controller keeps working when optional dependencies are absent", () => {
  const state = {
    runButtonTimerId: 1,
    taskSummaryTimerId: null,
    runButtonPhase: "SUBMITTED_ACK"
  };
  const controller = createWorkspaceResetController({
    clearInterval: () => {
      throw new Error("clearInterval should not run when timer id is missing");
    }
  });

  const nextControllers = controller.resetBeforeInit({
    state,
    runButtonPhaseEnum: {
      IDLE: "IDLE"
    }
  });

  assert.equal(state.runButtonTimerId, null);
  assert.equal(state.runButtonPhase, "IDLE");
  assert.equal(state.taskSummaryHintText, "");
  assert.equal(state.taskSummaryHintType, "info");
  assert.equal(state.taskSummaryHintUntil, 0);
  assert.equal(state.taskSummaryHintTimerId, null);
  assert.deepEqual(nextControllers, {
    runButtonPhaseController: null,
    runStatusController: null,
    runWorkflowController: null,
    appPickerController: null,
    templatePickerController: null,
    workspaceSettingsController: null,
    workspaceInitController: null,
    workspaceLogController: null
  });
});
