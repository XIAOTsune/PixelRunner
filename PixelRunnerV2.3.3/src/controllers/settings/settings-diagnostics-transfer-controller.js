function createSettingsDiagnosticsTransferController(options = {}) {
  const dom = options.dom || {};
  const getStore =
    typeof options.getStore === "function" ? options.getStore : () => options.store || null;
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
      latestDiagnosticTitle: "=== Latest Environment Diagnostic ===",
      parseDebugTitle: "=== Parse Debug ===",
      noLatestDiagnosticReport: "No latest environment diagnostic report found.",
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

  function loadDiagnosticsSummary() {
    const storage = resolveStorage();
    const latestDiagnosticReport = loadStoredJsonReport(storage, diagnosticStorageKey);
    const parseDebugReport = loadStoredJsonReport(storage, parseDebugStorageKey);
    const sections = [];

    if (latestDiagnosticReport) {
      sections.push(messages.latestDiagnosticTitle);
      sections.push(summarizeDiagnosticReport(latestDiagnosticReport));
    } else {
      sections.push(messages.noLatestDiagnosticReport);
    }

    if (parseDebugReport) {
      if (sections.length > 0) sections.push("");
      sections.push(messages.parseDebugTitle);
      sections.push(summarizeParseDebugReport(parseDebugReport));
    } else {
      if (sections.length > 0) sections.push("");
      sections.push(messages.noParseDebugReport);
    }

    setEnvDoctorOutput(dom.envDoctorOutput, sections.join("\n"));
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
    loadDiagnosticsSummary,
    exportTemplatesJson,
    importTemplatesJson
  };
}

module.exports = {
  createSettingsDiagnosticsTransferController
};
