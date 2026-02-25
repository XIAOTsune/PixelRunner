const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createSettingsDiagnosticsTransferController
} = require("../../../src/controllers/settings/settings-diagnostics-transfer-controller");

function createFixture(options = {}) {
  const dom = {
    btnRunEnvDoctor: {
      disabled: false,
      textContent: "run"
    },
    envDoctorOutput: {
      value: ""
    }
  };
  const store =
    options.store ||
    {
      getStorage: () => ({ tag: "storage" })
    };
  const reportsByKey = Object.assign(
    {
      "diag-key": options.diagnosticReport,
      "parse-key": options.parseDebugReport
    },
    options.reportsByKey || {}
  );
  const calls = {
    runDoctorArgs: [],
    setOutput: [],
    appendOutput: [],
    loadStored: [],
    alerts: [],
    exportArgs: null,
    importArgs: null,
    emitted: [],
    renderSavedTemplates: 0
  };
  const importTemplatesUsecase =
    typeof options.importTemplatesUsecase === "function" ? options.importTemplatesUsecase : () => ({});
  const messages = Object.assign(
    {
      envDoctorRunning: "env running",
      envDoctorBusyText: "busy",
      envDoctorActionText: "run",
      envDoctorFailedPrefix: "env failed: ",
      noLatestDiagnosticReport: "no latest",
      noParseDebugReport: "no parse debug",
      unsupportedExport: "export unsupported",
      unsupportedImport: "import unsupported"
    },
    options.messages || {}
  );
  const controller = createSettingsDiagnosticsTransferController({
    dom,
    getStore: () => store,
    runPsEnvironmentDoctor: async (args) => {
      calls.runDoctorArgs.push(args);
      if (options.runDoctorError) throw options.runDoctorError;
      return options.runDoctorReport || { runId: "diag-1" };
    },
    summarizeDiagnosticReport: (report) => `diag:${report && report.runId ? report.runId : "none"}`,
    summarizeParseDebugReport: (report) => `parse:${report && report.id ? report.id : "none"}`,
    loadStoredJsonReport: (storage, key) => {
      calls.loadStored.push({ storage, key });
      return Object.prototype.hasOwnProperty.call(reportsByKey, key) ? reportsByKey[key] : null;
    },
    diagnosticStorageKey: "diag-key",
    parseDebugStorageKey: "parse-key",
    setEnvDoctorOutput: (_target, text) => {
      calls.setOutput.push(String(text || ""));
    },
    appendEnvDoctorOutput: (_target, text) => {
      calls.appendOutput.push(String(text || ""));
    },
    exportTemplatesJsonUsecase: async (args) => {
      calls.exportArgs = args;
      if (options.exportError) throw options.exportError;
      return options.exportResult || { outcome: "success", savedPath: "C:/tmp/templates.json", total: 3 };
    },
    importTemplatesJsonUsecase: async (args) => {
      calls.importArgs = args;
      if (options.importError) throw options.importError;
      return options.importResult || { outcome: "success", reason: "imported", added: 2, replaced: 1, total: 3 };
    },
    importTemplatesUsecase,
    localFileSystem: { tag: "lfs" },
    filenamePrefix: "pixelrunner_prompt_templates",
    emitTemplatesChanged: (payload) => {
      calls.emitted.push(payload);
    },
    renderSavedTemplates: () => {
      calls.renderSavedTemplates += 1;
    },
    alert: (message) => {
      calls.alerts.push(String(message || ""));
    },
    messages
  });

  return {
    controller,
    dom,
    store,
    calls,
    importTemplatesUsecase
  };
}

test("settings diagnostics transfer controller runs env doctor and restores button state", async () => {
  const fixture = createFixture({
    runDoctorReport: { runId: "diag-42" }
  });
  const { controller, dom, calls } = fixture;

  await controller.runEnvironmentDoctorManual();

  assert.deepEqual(calls.runDoctorArgs, [{ stage: "manual-settings" }]);
  assert.deepEqual(calls.setOutput, ["env running", "diag:diag-42"]);
  assert.equal(dom.btnRunEnvDoctor.disabled, false);
  assert.equal(dom.btnRunEnvDoctor.textContent, "run");
});

test("settings diagnostics transfer controller writes env doctor failure output", async () => {
  const fixture = createFixture({
    runDoctorError: new Error("doctor failed")
  });
  const { controller, dom, calls } = fixture;

  await controller.runEnvironmentDoctorManual();

  assert.equal(calls.setOutput[calls.setOutput.length - 1], "env failed: doctor failed");
  assert.equal(dom.btnRunEnvDoctor.disabled, false);
  assert.equal(dom.btnRunEnvDoctor.textContent, "run");
});

test("settings diagnostics transfer controller loads latest report fallback text", () => {
  const fixture = createFixture({
    diagnosticReport: null
  });
  const { controller, calls, store } = fixture;

  controller.loadLatestDiagnosticReport();

  assert.equal(calls.loadStored.length, 1);
  assert.equal(calls.loadStored[0].key, "diag-key");
  assert.deepEqual(calls.loadStored[0].storage, store.getStorage());
  assert.deepEqual(calls.setOutput, ["no latest"]);
});

test("settings diagnostics transfer controller loads parse debug summary", () => {
  const fixture = createFixture({
    parseDebugReport: { id: "parse-7" }
  });
  const { controller, calls } = fixture;

  controller.loadParseDebugReport();

  assert.equal(calls.loadStored.length, 1);
  assert.equal(calls.loadStored[0].key, "parse-key");
  assert.deepEqual(calls.setOutput, ["parse:parse-7"]);
});

test("settings diagnostics transfer controller exports templates and writes success feedback", async () => {
  const fixture = createFixture({
    exportResult: {
      outcome: "success",
      savedPath: "C:/tmp/snapshot.json",
      total: 5
    }
  });
  const { controller, calls, store } = fixture;

  await controller.exportTemplatesJson();

  assert.equal(calls.exportArgs.store, store);
  assert.equal(calls.exportArgs.filenamePrefix, "pixelrunner_prompt_templates");
  assert.deepEqual(calls.appendOutput, ["Template export success: C:/tmp/snapshot.json"]);
  assert.deepEqual(calls.alerts, ["Template export completed: 5 template(s)"]);
});

test("settings diagnostics transfer controller handles unsupported and failed template export", async () => {
  const unsupportedFixture = createFixture({
    exportResult: {
      outcome: "unsupported"
    }
  });
  await unsupportedFixture.controller.exportTemplatesJson();
  assert.deepEqual(unsupportedFixture.calls.appendOutput, []);
  assert.deepEqual(unsupportedFixture.calls.alerts, ["export unsupported"]);

  const failedFixture = createFixture({
    exportError: new Error("disk full")
  });
  await failedFixture.controller.exportTemplatesJson();
  assert.deepEqual(failedFixture.calls.appendOutput, ["Template export failed: disk full"]);
  assert.deepEqual(failedFixture.calls.alerts, ["Template export failed: disk full"]);
});

test("settings diagnostics transfer controller imports templates and emits change event", async () => {
  const fixture = createFixture({
    importResult: {
      outcome: "success",
      reason: "merged",
      added: 3,
      replaced: 2,
      total: 5
    }
  });
  const { controller, calls, store, importTemplatesUsecase } = fixture;

  await controller.importTemplatesJson();

  assert.equal(calls.importArgs.store, store);
  assert.equal(calls.importArgs.importTemplates, importTemplatesUsecase);
  assert.deepEqual(calls.emitted, [{ reason: "merged", added: 3, replaced: 2, total: 5 }]);
  assert.equal(calls.renderSavedTemplates, 1);
  assert.deepEqual(calls.appendOutput, ["Template import success: total=5, added=3, replaced=2"]);
  assert.deepEqual(calls.alerts, ["Template import completed: added 3, replaced 2, total 5"]);
});

test("settings diagnostics transfer controller handles unsupported and failed template import", async () => {
  const unsupportedFixture = createFixture({
    importResult: {
      outcome: "unsupported"
    }
  });
  await unsupportedFixture.controller.importTemplatesJson();
  assert.equal(unsupportedFixture.calls.renderSavedTemplates, 0);
  assert.equal(unsupportedFixture.calls.emitted.length, 0);
  assert.deepEqual(unsupportedFixture.calls.appendOutput, []);
  assert.deepEqual(unsupportedFixture.calls.alerts, ["import unsupported"]);

  const failedFixture = createFixture({
    importError: new Error("bad json")
  });
  await failedFixture.controller.importTemplatesJson();
  assert.equal(failedFixture.calls.renderSavedTemplates, 0);
  assert.equal(failedFixture.calls.emitted.length, 0);
  assert.deepEqual(failedFixture.calls.appendOutput, ["Template import failed: bad json"]);
  assert.deepEqual(failedFixture.calls.alerts, ["Template import failed: bad json"]);
});
