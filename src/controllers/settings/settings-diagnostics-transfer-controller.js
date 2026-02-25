function createSettingsDiagnosticsTransferController(options = {}) {
  const dom = options.dom || {};
  const getStore =
    typeof options.getStore === "function" ? options.getStore : () => options.store || null;
  const runPsEnvironmentDoctor =
    typeof options.runPsEnvironmentDoctor === "function"
      ? options.runPsEnvironmentDoctor
      : async () => null;
  const summarizeDiagnosticReport =
    typeof options.summarizeDiagnosticReport === "function"
      ? options.summarizeDiagnosticReport
      : (value) => String(value || "");
  const summarizeParseDebugReport =
    typeof options.summarizeParseDebugReport === "function"
      ? options.summarizeParseDebugReport
      : (value) => String(value || "");
  const loadStoredJsonReport =
    typeof options.loadStoredJsonReport === "function" ? options.loadStoredJsonReport : () => null;
  const diagnosticStorageKey = String(options.diagnosticStorageKey || "");
  const parseDebugStorageKey = String(options.parseDebugStorageKey || "");
  const setEnvDoctorOutput =
    typeof options.setEnvDoctorOutput === "function" ? options.setEnvDoctorOutput : () => {};
  const appendEnvDoctorOutput =
    typeof options.appendEnvDoctorOutput === "function" ? options.appendEnvDoctorOutput : () => {};
  const exportTemplatesJsonUsecase =
    typeof options.exportTemplatesJsonUsecase === "function"
      ? options.exportTemplatesJsonUsecase
      : async () => ({ outcome: "unsupported" });
  const importTemplatesJsonUsecase =
    typeof options.importTemplatesJsonUsecase === "function"
      ? options.importTemplatesJsonUsecase
      : async () => ({ outcome: "unsupported" });
  const importTemplatesUsecase =
    typeof options.importTemplatesUsecase === "function" ? options.importTemplatesUsecase : () => ({});
  const localFileSystem = options.localFileSystem || null;
  const filenamePrefix = String(options.filenamePrefix || "pixelrunner_prompt_templates");
  const emitTemplatesChanged =
    typeof options.emitTemplatesChanged === "function" ? options.emitTemplatesChanged : () => {};
  const renderSavedTemplates =
    typeof options.renderSavedTemplates === "function" ? options.renderSavedTemplates : () => {};
  const alertFn =
    typeof options.alert === "function"
      ? options.alert
      : typeof alert === "function"
      ? alert
      : () => {};
  const messages = Object.assign(
    {
      envDoctorRunning: "\u6b63\u5728\u6267\u884c\u73af\u5883\u68c0\u6d4b\uff0c\u8bf7\u7a0d\u5019...",
      envDoctorBusyText: "\u68c0\u6d4b\u4e2d...",
      envDoctorActionText: "\u8fd0\u884c\u73af\u5883\u68c0\u6d4b",
      envDoctorFailedPrefix: "\u73af\u5883\u68c0\u6d4b\u5931\u8d25: ",
      noLatestDiagnosticReport: "\u672a\u627e\u5230\u6700\u8fd1\u62a5\u544a\uff0c\u8bf7\u5148\u70b9\u51fb\u201c\u8fd0\u884c\u73af\u5883\u68c0\u6d4b\u201d\u3002",
      noParseDebugReport:
        "No parse debug found. Parse and save an app first, then click this button again.",
      unsupportedExport: "Current environment does not support file export",
      unsupportedImport: "Current environment does not support file import"
    },
    options.messages && typeof options.messages === "object" ? options.messages : {}
  );

  function resolveStore() {
    return getStore();
  }

  function resolveStorage() {
    const store = resolveStore();
    if (!store || typeof store.getStorage !== "function") return null;
    return store.getStorage();
  }

  async function runEnvironmentDoctorManual() {
    if (!dom.btnRunEnvDoctor) return;
    dom.btnRunEnvDoctor.disabled = true;
    dom.btnRunEnvDoctor.textContent = messages.envDoctorBusyText;
    setEnvDoctorOutput(dom.envDoctorOutput, messages.envDoctorRunning);

    try {
      const report = await runPsEnvironmentDoctor({ stage: "manual-settings" });
      setEnvDoctorOutput(dom.envDoctorOutput, summarizeDiagnosticReport(report));
    } catch (error) {
      const message = error && error.message ? error.message : String(error || "unknown");
      setEnvDoctorOutput(dom.envDoctorOutput, `${messages.envDoctorFailedPrefix}${message}`);
    } finally {
      dom.btnRunEnvDoctor.disabled = false;
      dom.btnRunEnvDoctor.textContent = messages.envDoctorActionText;
    }
  }

  function loadLatestDiagnosticReport() {
    const report = loadStoredJsonReport(resolveStorage(), diagnosticStorageKey);
    if (!report) {
      setEnvDoctorOutput(dom.envDoctorOutput, messages.noLatestDiagnosticReport);
      return;
    }
    setEnvDoctorOutput(dom.envDoctorOutput, summarizeDiagnosticReport(report));
  }

  function loadParseDebugReport() {
    const report = loadStoredJsonReport(resolveStorage(), parseDebugStorageKey);
    if (!report) {
      setEnvDoctorOutput(dom.envDoctorOutput, messages.noParseDebugReport);
      return;
    }
    setEnvDoctorOutput(dom.envDoctorOutput, summarizeParseDebugReport(report));
  }

  async function exportTemplatesJson() {
    try {
      const exportResult = await exportTemplatesJsonUsecase({
        localFileSystem,
        store: resolveStore(),
        filenamePrefix
      });
      if (exportResult.outcome === "unsupported") {
        alertFn(messages.unsupportedExport);
        return;
      }
      if (exportResult.outcome === "cancelled") return;

      appendEnvDoctorOutput(dom.envDoctorOutput, `Template export success: ${exportResult.savedPath}`);
      alertFn(`Template export completed: ${exportResult.total} template(s)`);
    } catch (error) {
      const message = error && error.message ? error.message : String(error || "unknown");
      appendEnvDoctorOutput(dom.envDoctorOutput, `Template export failed: ${message}`);
      alertFn(`Template export failed: ${message}`);
    }
  }

  async function importTemplatesJson() {
    try {
      const importResult = await importTemplatesJsonUsecase({
        localFileSystem,
        store: resolveStore(),
        importTemplates: importTemplatesUsecase
      });
      if (importResult.outcome === "unsupported") {
        alertFn(messages.unsupportedImport);
        return;
      }
      if (importResult.outcome === "cancelled") return;

      emitTemplatesChanged({
        reason: importResult.reason,
        added: importResult.added,
        replaced: importResult.replaced,
        total: importResult.total
      });
      renderSavedTemplates();
      appendEnvDoctorOutput(
        dom.envDoctorOutput,
        `Template import success: total=${importResult.total}, added=${importResult.added}, replaced=${importResult.replaced}`
      );
      alertFn(
        `Template import completed: added ${importResult.added}, replaced ${importResult.replaced}, total ${importResult.total}`
      );
    } catch (error) {
      const message = error && error.message ? error.message : String(error || "unknown");
      appendEnvDoctorOutput(dom.envDoctorOutput, `Template import failed: ${message}`);
      alertFn(`Template import failed: ${message}`);
    }
  }

  return {
    runEnvironmentDoctorManual,
    loadLatestDiagnosticReport,
    loadParseDebugReport,
    exportTemplatesJson,
    importTemplatesJson
  };
}

module.exports = {
  createSettingsDiagnosticsTransferController
};
