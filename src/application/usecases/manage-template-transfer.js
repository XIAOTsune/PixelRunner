const { buildTemplateExportUsecase, importTemplatesUsecase } = require("./manage-templates");

function resolvePickedEntry(picked) {
  if (!picked) return null;
  if (Array.isArray(picked)) return picked[0] || null;
  return picked;
}

function normalizeReadText(value) {
  if (typeof value === "string") return value;
  if (value instanceof ArrayBuffer) {
    try {
      return new TextDecoder("utf-8").decode(new Uint8Array(value));
    } catch (_) {
      return "";
    }
  }
  if (ArrayBuffer.isView(value)) {
    try {
      const view = value;
      return new TextDecoder("utf-8").decode(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
    } catch (_) {
      return "";
    }
  }
  return String(value == null ? "" : value);
}

async function exportTemplatesJsonUsecase(options = {}) {
  const localFileSystem = options.localFileSystem;
  if (!localFileSystem || typeof localFileSystem.getFileForSaving !== "function") {
    return {
      outcome: "unsupported"
    };
  }

  const buildTemplateExport =
    typeof options.buildTemplateExport === "function" ? options.buildTemplateExport : buildTemplateExportUsecase;
  const exportResult = buildTemplateExport({
    store: options.store,
    filenamePrefix: options.filenamePrefix,
    now: options.now
  });
  const bundle = exportResult.bundle;
  const defaultName = exportResult.defaultName;
  const targetFile = await localFileSystem.getFileForSaving(defaultName);
  if (!targetFile) {
    return {
      outcome: "cancelled"
    };
  }

  await targetFile.write(JSON.stringify(bundle, null, 2));
  const savedPath = targetFile.nativePath || targetFile.name || defaultName;
  const total = Array.isArray(bundle && bundle.templates) ? bundle.templates.length : 0;

  return {
    outcome: "exported",
    savedPath: String(savedPath || defaultName || ""),
    total
  };
}

async function importTemplatesJsonUsecase(options = {}) {
  const localFileSystem = options.localFileSystem;
  if (!localFileSystem || typeof localFileSystem.getFileForOpening !== "function") {
    return {
      outcome: "unsupported"
    };
  }

  const importTemplates = typeof options.importTemplates === "function" ? options.importTemplates : importTemplatesUsecase;
  const picked = await localFileSystem.getFileForOpening({ allowMultiple: false, types: ["json"] });
  const entry = resolvePickedEntry(picked);
  if (!entry) {
    return {
      outcome: "cancelled"
    };
  }

  const rawText = normalizeReadText(await entry.read());
  const importResult = importTemplates({
    store: options.store,
    payload: rawText
  });

  return {
    outcome: "imported",
    reason: importResult.reason,
    added: Number(importResult.added) || 0,
    replaced: Number(importResult.replaced) || 0,
    total: Number(importResult.total) || 0
  };
}

module.exports = {
  resolvePickedEntry,
  normalizeReadText,
  exportTemplatesJsonUsecase,
  importTemplatesJsonUsecase
};
