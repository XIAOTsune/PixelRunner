const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createSettingsDiagnosticsTransferController
} = require("../../../src/controllers/settings/settings-diagnostics-transfer-controller");

function createFixture(options = {}) {
  const dom = {
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
      latestDiagnosticTitle: "=== Latest Environment Diagnostic ===",
      parseDebugTitle: "=== Parse Debug ===",
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

test("settings diagnostics transfer controller merges latest diagnostic and parse debug summary", () => {
  const fixture = createFixture({
    diagnosticReport: { runId: "diag-42" },
    parseDebugReport: { id: "parse-7" }
  });
  const { controller, calls, store } = fixture;

  controller.loadDiagnosticsSummary();

  assert.equal(calls.loadStored.length, 2);
  assert.equal(calls.loadStored[0].key, "diag-key");
  assert.equal(calls.loadStored[1].key, "parse-key");
  assert.deepEqual(calls.loadStored[0].storage, store.getStorage());
  assert.deepEqual(calls.loadStored[1].storage, store.getStorage());
  assert.equal(calls.setOutput.length, 1);
  assert.match(calls.setOutput[0], /Latest Environment Diagnostic/);
  assert.match(calls.setOutput[0], /diag:diag-42/);
  assert.match(calls.setOutput[0], /Parse Debug/);
  assert.match(calls.setOutput[0], /parse:parse-7/);
});

test("settings diagnostics transfer controller writes fallback text when reports are missing", () => {
  const fixture = createFixture({
    diagnosticReport: null,
    parseDebugReport: null
  });
  const { controller, calls } = fixture;

  controller.loadDiagnosticsSummary();

  assert.equal(calls.loadStored.length, 2);
  assert.deepEqual(calls.setOutput, ["no latest\n\nno parse debug"]);
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
