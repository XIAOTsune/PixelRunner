const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildRunButtonViewModel,
  createRunButtonPhaseController
} = require("../../../src/application/services/run-button");

const RUN_BUTTON_PHASE = {
  IDLE: "IDLE",
  SUBMITTING_GUARD: "SUBMITTING_GUARD",
  SUBMITTED_ACK: "SUBMITTED_ACK"
};

test("buildRunButtonViewModel returns disabled idle text when no current app", () => {
  const vm = buildRunButtonViewModel({ currentApp: null, runButtonPhase: RUN_BUTTON_PHASE.IDLE, runButtonPhaseEnum: RUN_BUTTON_PHASE });
  assert.deepEqual(vm, { busy: false, disabled: true, text: "开始运行" });
});

test("buildRunButtonViewModel returns submitting state", () => {
  const vm = buildRunButtonViewModel({ currentApp: { name: "Demo" }, runButtonPhase: RUN_BUTTON_PHASE.SUBMITTING_GUARD, runButtonPhaseEnum: RUN_BUTTON_PHASE });
  assert.equal(vm.busy, true);
  assert.equal(vm.disabled, true);
  assert.equal(vm.text, "提交中...");
});

test("buildRunButtonViewModel returns submitted ack state", () => {
  const vm = buildRunButtonViewModel({ currentApp: { name: "Demo" }, runButtonPhase: RUN_BUTTON_PHASE.SUBMITTED_ACK, runButtonPhaseEnum: RUN_BUTTON_PHASE });
  assert.equal(vm.busy, true);
  assert.equal(vm.disabled, true);
  assert.equal(vm.text, "已加入队列");
});

test("buildRunButtonViewModel returns runnable state with app name", () => {
  const vm = buildRunButtonViewModel({ currentApp: { name: "Demo" }, runButtonPhase: RUN_BUTTON_PHASE.IDLE, runButtonPhaseEnum: RUN_BUTTON_PHASE });
  assert.equal(vm.busy, false);
  assert.equal(vm.disabled, false);
  assert.equal(vm.text, "运行新任务: Demo");
});

test("buildRunButtonViewModel falls back to placeholder app name", () => {
  const vm = buildRunButtonViewModel({ currentApp: { name: "" }, runButtonPhase: RUN_BUTTON_PHASE.IDLE, runButtonPhaseEnum: RUN_BUTTON_PHASE });
  assert.equal(vm.text, "运行新任务: 未命名应用");
});

test("createRunButtonPhaseController enters submitting guard and blocks click", () => {
  const events = [];
  let phase = RUN_BUTTON_PHASE.IDLE;
  let timerId = null;
  const runGuard = {
    blockedFor: 0,
    blockClickFor(ms) {
      this.blockedFor = ms;
    },
    clearClickBlock() {},
    isClickGuardActive() {
      return false;
    }
  };

  const ctrl = createRunButtonPhaseController({
    runGuard,
    runButtonPhaseEnum: RUN_BUTTON_PHASE,
    getPhase: () => phase,
    setPhase: (next) => {
      phase = next;
    },
    getTimerId: () => timerId,
    setTimerId: (next) => {
      timerId = next;
    },
    onPhaseUpdated: () => {
      events.push(`phase:${phase}`);
    },
    doubleClickGuardMs: 450,
    submittingMinMs: 1000,
    submittedAckMs: 1000
  });

  ctrl.enterSubmittingGuard();
  assert.equal(phase, RUN_BUTTON_PHASE.SUBMITTING_GUARD);
  assert.equal(runGuard.blockedFor, 1000);
  assert.deepEqual(events, ["phase:SUBMITTING_GUARD"]);
});

test("createRunButtonPhaseController enters ack and auto-recovers to idle", () => {
  const events = [];
  const scheduled = [];
  let phase = RUN_BUTTON_PHASE.IDLE;
  let timerId = null;
  const runGuard = {
    blockedFor: 0,
    clearCount: 0,
    blockClickFor(ms) {
      this.blockedFor = ms;
    },
    clearClickBlock() {
      this.clearCount += 1;
    },
    isClickGuardActive() {
      return false;
    }
  };

  const ctrl = createRunButtonPhaseController({
    runGuard,
    runButtonPhaseEnum: RUN_BUTTON_PHASE,
    getPhase: () => phase,
    setPhase: (next) => {
      phase = next;
    },
    getTimerId: () => timerId,
    setTimerId: (next) => {
      timerId = next;
    },
    onPhaseUpdated: () => {
      events.push(`phase:${phase}`);
    },
    submittedAckMs: 800,
    setTimeoutFn: (fn, delay) => {
      const item = { fn, delay, cleared: false };
      scheduled.push(item);
      return item;
    },
    clearTimeoutFn: (item) => {
      if (item) item.cleared = true;
    }
  });

  ctrl.enterSubmittedAck();
  assert.equal(phase, RUN_BUTTON_PHASE.SUBMITTED_ACK);
  assert.equal(runGuard.blockedFor, 800);
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0].delay, 800);

  scheduled[0].fn();
  assert.equal(phase, RUN_BUTTON_PHASE.IDLE);
  assert.equal(runGuard.clearCount, 1);
  assert.deepEqual(events, ["phase:SUBMITTED_ACK", "phase:IDLE"]);
});

test("createRunButtonPhaseController recoverNow clears timer and click guard", () => {
  const scheduled = [];
  let phase = RUN_BUTTON_PHASE.IDLE;
  let timerId = null;
  const runGuard = {
    clearCount: 0,
    blockClickFor() {},
    clearClickBlock() {
      this.clearCount += 1;
    },
    isClickGuardActive() {
      return false;
    }
  };

  const ctrl = createRunButtonPhaseController({
    runGuard,
    runButtonPhaseEnum: RUN_BUTTON_PHASE,
    getPhase: () => phase,
    setPhase: (next) => {
      phase = next;
    },
    getTimerId: () => timerId,
    setTimerId: (next) => {
      timerId = next;
    },
    setTimeoutFn: (fn) => {
      const item = { fn, cleared: false };
      scheduled.push(item);
      return item;
    },
    clearTimeoutFn: (item) => {
      if (item) item.cleared = true;
    }
  });

  ctrl.scheduleRecover(100);
  assert.equal(scheduled.length, 1);
  assert.equal(timerId, scheduled[0]);

  ctrl.recoverNow();
  assert.equal(scheduled[0].cleared, true);
  assert.equal(timerId, null);
  assert.equal(phase, RUN_BUTTON_PHASE.IDLE);
  assert.equal(runGuard.clearCount, 1);
});

test("createRunButtonPhaseController waitSubmittingMinDuration waits only remaining time", async () => {
  const waitCalls = [];
  let now = 5000;
  const ctrl = createRunButtonPhaseController({
    runButtonPhaseEnum: RUN_BUTTON_PHASE,
    nowFn: () => now,
    submittingMinMs: 1000,
    waitMs: async (ms) => {
      waitCalls.push(ms);
    }
  });

  const waited = await ctrl.waitSubmittingMinDuration(4300);
  assert.equal(waited, 300);
  assert.deepEqual(waitCalls, [300]);

  now = 8000;
  const waitedAgain = await ctrl.waitSubmittingMinDuration(6000);
  assert.equal(waitedAgain, 0);
  assert.deepEqual(waitCalls, [300]);
});

test("createRunButtonPhaseController isClickGuardActive delegates to runGuard", () => {
  const runGuard = {
    isClickGuardActive(now) {
      return now < 200;
    }
  };

  const ctrl = createRunButtonPhaseController({
    runGuard,
    runButtonPhaseEnum: RUN_BUTTON_PHASE
  });

  assert.equal(ctrl.isClickGuardActive(100), true);
  assert.equal(ctrl.isClickGuardActive(300), false);
});

