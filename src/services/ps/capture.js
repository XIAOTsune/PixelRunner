const { app, core, action } = require("photoshop");
const { storage } = require("uxp");
const { toPixelNumber, getDocSizePx } = require("./shared");
const {
  DEFAULT_COMPRESSION_QUALITY_STEPS,
  DEFAULT_COMPRESSION_EDGE_STEPS,
  DEFAULT_COMPRESSION_MAX_ATTEMPTS,
  DEFAULT_COMPRESSION_DURATION_MS,
  normalizeQualitySteps,
  buildCompressionEdgeSteps,
  runCompressionAttempts
} = require("./compression-strategy");

const fs = storage.localFileSystem;
const formats = storage.formats;

function parseRawBounds(rawBounds) {
  if (!rawBounds) return null;
  if (Array.isArray(rawBounds) && rawBounds.length >= 4) {
    return {
      left: toPixelNumber(rawBounds[0], 0),
      top: toPixelNumber(rawBounds[1], 0),
      right: toPixelNumber(rawBounds[2], 0),
      bottom: toPixelNumber(rawBounds[3], 0)
    };
  }
  if (typeof rawBounds === "object") {
    return {
      left: toPixelNumber(rawBounds.left, 0),
      top: toPixelNumber(rawBounds.top, 0),
      right: toPixelNumber(rawBounds.right, 0),
      bottom: toPixelNumber(rawBounds.bottom, 0)
    };
  }
  return null;
}

function buildCropBounds(rawBounds, doc) {
  const size = getDocSizePx(doc);
  const parsed = parseRawBounds(rawBounds);
  if (!parsed) return { left: 0, top: 0, right: size.width, bottom: size.height };

  const left = Math.max(0, Math.min(size.width - 1, Math.round(parsed.left)));
  const top = Math.max(0, Math.min(size.height - 1, Math.round(parsed.top)));
  const right = Math.max(left + 1, Math.min(size.width, Math.round(parsed.right)));
  const bottom = Math.max(top + 1, Math.min(size.height, Math.round(parsed.bottom)));
  return { left, top, right, bottom };
}

function normalizeBitDepth(rawBitDepth) {
  if (typeof rawBitDepth === "number" && Number.isFinite(rawBitDepth)) {
    return Math.max(1, Math.floor(rawBitDepth));
  }
  if (typeof rawBitDepth === "string") {
    const matched = rawBitDepth.match(/(\d+)/);
    if (matched) return Math.max(1, Number(matched[1]) || 0);
    return null;
  }
  if (rawBitDepth && typeof rawBitDepth === "object") {
    if (typeof rawBitDepth.value === "number" && Number.isFinite(rawBitDepth.value)) {
      return Math.max(1, Math.floor(rawBitDepth.value));
    }
    if (typeof rawBitDepth._value === "number" && Number.isFinite(rawBitDepth._value)) {
      return Math.max(1, Math.floor(rawBitDepth._value));
    }
  }
  return null;
}

function buildCaptureContext(doc) {
  if (!doc || typeof doc !== "object") return null;
  const documentId = Number(doc.id);
  if (!Number.isFinite(documentId) || documentId <= 0) return null;
  return {
    documentId: Math.floor(documentId),
    documentTitle: String(doc.title || doc.name || ""),
    capturedAt: Date.now()
  };
}

function normalizeExportFormat(format) {
  const marker = String(format || "png").trim().toLowerCase();
  if (marker === "jpeg" || marker === "jpg") return "jpeg";
  return "png";
}

function normalizeExportOptions(options = {}) {
  const source = options && typeof options === "object" ? options : {};
  const format = normalizeExportFormat(source.format);
  const qualityNum = Number(source.quality);
  const maxEdgeNum = Number(source.maxEdge);
  return {
    format,
    quality: Number.isFinite(qualityNum) ? Math.max(1, Math.min(12, Math.floor(qualityNum))) : 8,
    maxEdge: Number.isFinite(maxEdgeNum) && maxEdgeNum > 0 ? Math.floor(maxEdgeNum) : null
  };
}

function mimeByFormat(format) {
  return normalizeExportFormat(format) === "jpeg" ? "image/jpeg" : "image/png";
}

function extensionByFormat(format) {
  return normalizeExportFormat(format) === "jpeg" ? "jpg" : "png";
}

function jpegDescriptor(quality) {
  return {
    _obj: "JPEG",
    extendedQuality: Math.max(1, Math.min(12, Math.floor(Number(quality) || 8))),
    matteColor: { _enum: "matteColor", _value: "none" }
  };
}

function pngDescriptor() {
  return {
    _obj: "PNGFormat",
    method: { _enum: "PNGMethod", _value: "quick" }
  };
}

async function closeDocNoSave(docRef) {
  if (!docRef) return;
  if (typeof docRef.closeWithoutSaving === "function") {
    await docRef.closeWithoutSaving();
    return;
  }
  await action.batchPlay([{
    _obj: "close",
    _target: [{ _ref: "document", _id: docRef.id }],
    saving: { _enum: "yesNo", _value: "no" }
  }], {});
}

async function resizeDocToLongEdge(docRef, maxEdge) {
  const edge = Number(maxEdge);
  if (!Number.isFinite(edge) || edge <= 0) return getDocSizePx(docRef);

  const size = getDocSizePx(docRef);
  const longEdge = Math.max(size.width, size.height);
  if (longEdge <= edge) return size;

  const scale = edge / longEdge;
  const targetWidth = Math.max(1, Math.round(size.width * scale));
  const targetHeight = Math.max(1, Math.round(size.height * scale));

  if (typeof docRef.resizeImage === "function") {
    await docRef.resizeImage(targetWidth, targetHeight);
    return getDocSizePx(docRef);
  }

  await action.batchPlay([{
    _obj: "imageSize",
    _target: [{ _ref: "document", _id: docRef.id }],
    width: { _unit: "pixelsUnit", _value: targetWidth },
    height: { _unit: "pixelsUnit", _value: targetHeight },
    constrainProportions: true,
    interfaceIconFrameDimmed: { _enum: "interpolationType", _value: "automaticInterpolation" }
  }], {});

  return getDocSizePx(docRef);
}

async function exportDocToArrayBuffer(docRef, exportOptions, filePrefix = "capture") {
  const options = normalizeExportOptions(exportOptions);
  const tempFolder = await fs.getTemporaryFolder();
  const ext = extensionByFormat(options.format);
  const tempFile = await tempFolder.createFile(`${filePrefix}_${Date.now()}.${ext}`, { overwrite: true });
  const sessionToken = await fs.createSessionToken(tempFile);

  const asDescriptor = options.format === "jpeg" ? jpegDescriptor(options.quality) : pngDescriptor();

  await action.batchPlay([{
    _obj: "save",
    as: asDescriptor,
    in: { _path: sessionToken, _kind: "local" },
    documentID: docRef.id,
    copy: true,
    lowerCase: true,
    saveStage: { _enum: "saveStageType", _value: "saveStageOS" }
  }], {});

  const arrayBuffer = await tempFile.read({ format: formats.binary });
  const size = getDocSizePx(docRef);
  return {
    arrayBuffer,
    bytes: arrayBuffer.byteLength,
    mime: mimeByFormat(options.format),
    width: size.width,
    height: size.height,
    bitDepth: normalizeBitDepth(docRef.bitsPerChannel)
  };
}

function isNearlyFullBounds(bounds, doc) {
  if (!bounds || !doc) return false;
  const docSize = getDocSizePx(doc);
  const clamped = buildCropBounds(bounds, doc);
  return (
    Math.abs(clamped.left) <= 1 &&
    Math.abs(clamped.top) <= 1 &&
    Math.abs(clamped.right - docSize.width) <= 1 &&
    Math.abs(clamped.bottom - docSize.height) <= 1
  );
}

function findDocumentById(documentId) {
  const safeId = Number(documentId);
  if (!Number.isFinite(safeId) || safeId <= 0) return null;
  const activeDoc = app.activeDocument;
  if (activeDoc && Number(activeDoc.id) === safeId) return activeDoc;
  const docs = Array.isArray(app.documents) ? app.documents : [];
  for (const doc of docs) {
    if (doc && Number(doc.id) === safeId) return doc;
  }
  return null;
}

function normalizeCompressionOptions(options = {}) {
  const source = options && typeof options === "object" ? options : {};
  const qualitySteps = normalizeQualitySteps(source.qualitySteps || DEFAULT_COMPRESSION_QUALITY_STEPS);
  const maxAttempts = Math.max(1, Math.min(200, Math.floor(Number(source.maxAttempts) || DEFAULT_COMPRESSION_MAX_ATTEMPTS)));
  const maxDurationMs = Math.max(
    200,
    Math.min(120_000, Math.floor(Number(source.maxCompressionDurationMs) || DEFAULT_COMPRESSION_DURATION_MS))
  );
  const targetBytes = Math.max(1, Math.floor(Number(source.targetBytes) || 1));
  const format = normalizeExportFormat(source.format || "jpeg");
  return {
    qualitySteps,
    maxEdgeSteps: source.maxEdgeSteps || DEFAULT_COMPRESSION_EDGE_STEPS,
    maxAttempts,
    maxDurationMs,
    targetBytes,
    format
  };
}

function buildSourceMetaFromExport(exported, fallback = {}) {
  return {
    mime: String((exported && exported.mime) || (fallback && fallback.mime) || "image/png"),
    bytes: Math.max(0, Number((exported && exported.bytes) || (fallback && fallback.bytes) || 0)),
    width: Math.max(1, Number((exported && exported.width) || (fallback && fallback.width) || 1)),
    height: Math.max(1, Number((exported && exported.height) || (fallback && fallback.height) || 1)),
    bitDepth: normalizeBitDepth((exported && exported.bitDepth) || (fallback && fallback.bitDepth))
  };
}

async function captureSelection(options = {}) {
  const log = options.log || (() => {});
  const exportOptions = normalizeExportOptions(options.exportOptions || {});
  try {
    const doc = app.activeDocument;
    if (!doc) {
      log("Capture failed: no active Photoshop document.", "error");
      return null;
    }

    let capturedResult = null;
    let selectionBounds = null;
    let originalSelectionBounds = null;
    try {
      originalSelectionBounds = doc.selection && doc.selection.bounds;
    } catch (_) {}

    await core.executeAsModal(async () => {
      const rawSelection = parseRawBounds(originalSelectionBounds);
      const useFullDocFastPath = !rawSelection || isNearlyFullBounds(rawSelection, doc);
      const useDirectExport = useFullDocFastPath && !exportOptions.maxEdge && exportOptions.format === "png";

      if (useDirectExport) {
        selectionBounds = buildCropBounds(null, doc);
        capturedResult = await exportDocToArrayBuffer(doc, exportOptions, "capture_full");
        return;
      }

      let tempDoc = null;
      try {
        tempDoc = await doc.duplicate("rh_capture_temp");
        try {
          await tempDoc.flatten();
        } catch (_) {}

        const cropBounds = buildCropBounds(useFullDocFastPath ? null : originalSelectionBounds, tempDoc);
        selectionBounds = { ...cropBounds };
        if (!useFullDocFastPath) {
          await tempDoc.crop(cropBounds);
        }
        if (exportOptions.maxEdge) {
          await resizeDocToLongEdge(tempDoc, exportOptions.maxEdge);
        }

        capturedResult = await exportDocToArrayBuffer(tempDoc, exportOptions, "capture_selection");
      } finally {
        await closeDocNoSave(tempDoc);
      }
    }, { commandName: "Capture Selection" });

    if (!capturedResult || !capturedResult.arrayBuffer) return null;
    const sourceMeta = buildSourceMetaFromExport(capturedResult, {
      bitDepth: normalizeBitDepth(doc.bitsPerChannel)
    });
    return {
      arrayBuffer: capturedResult.arrayBuffer,
      selectionBounds,
      captureContext: buildCaptureContext(doc),
      sourceMeta,
      uploadMeta: { ...sourceMeta }
    };
  } catch (error) {
    log(`Capture failed: ${error.message}`, "error");
    return null;
  }
}

async function compressCapturedSelection(options = {}) {
  const log = typeof options.log === "function" ? options.log : () => {};
  const captureContext = options.captureContext && typeof options.captureContext === "object" ? options.captureContext : null;
  if (!captureContext || !captureContext.documentId) {
    throw new Error("compressCapturedSelection requires captureContext.documentId");
  }

  const sourceDoc = findDocumentById(captureContext.documentId);
  if (!sourceDoc) {
    throw new Error("Source document for compression is not available");
  }

  const compressionOptions = normalizeCompressionOptions(options);
  const sourceMeta = buildSourceMetaFromExport(options.sourceMeta, {
    bitDepth: normalizeBitDepth(sourceDoc.bitsPerChannel)
  });

  if (sourceMeta.bytes > 0 && sourceMeta.bytes <= compressionOptions.targetBytes) {
    return {
      applied: false,
      arrayBuffer: null,
      sourceMeta,
      uploadMeta: { ...sourceMeta },
      compressionTrace: {
        applied: false,
        format: compressionOptions.format,
        quality: null,
        maxEdge: null,
        attempts: 0,
        durationMs: 0,
        beforeBytes: sourceMeta.bytes,
        afterBytes: sourceMeta.bytes,
        outcome: "already-safe"
      }
    };
  }

  let compressionResult = null;
  const selectionBounds = options.selectionBounds || null;

  await core.executeAsModal(async () => {
    let baseDoc = null;
    try {
      baseDoc = await sourceDoc.duplicate("rh_compress_base");
      try {
        await baseDoc.flatten();
      } catch (_) {}

      const rawSelection = parseRawBounds(selectionBounds);
      const useFullDoc = !rawSelection || isNearlyFullBounds(rawSelection, sourceDoc);
      if (!useFullDoc) {
        await baseDoc.crop(buildCropBounds(selectionBounds, baseDoc));
      }

      const baseSize = getDocSizePx(baseDoc);
      const baseLongEdge = Math.max(baseSize.width, baseSize.height);
      const edgeSteps = buildCompressionEdgeSteps(baseLongEdge, compressionOptions.maxEdgeSteps);
      const qualitySteps = compressionOptions.qualitySteps;

      compressionResult = await runCompressionAttempts({
        initialBytes: sourceMeta.bytes,
        targetBytes: compressionOptions.targetBytes,
        qualitySteps,
        edgeSteps,
        maxAttempts: compressionOptions.maxAttempts,
        maxDurationMs: compressionOptions.maxDurationMs,
        attemptExport: async ({ quality, maxEdge, attempt }) => {
          let attemptDoc = null;
          try {
            attemptDoc = await baseDoc.duplicate(`rh_compress_attempt_${attempt}`);
            await resizeDocToLongEdge(attemptDoc, maxEdge);
            const exported = await exportDocToArrayBuffer(attemptDoc, {
              format: compressionOptions.format,
              quality
            }, `compress_${attempt}`);
            return exported;
          } finally {
            await closeDocNoSave(attemptDoc);
          }
        }
      });
    } finally {
      await closeDocNoSave(baseDoc);
    }
  }, { commandName: "Compress Capture" });

  const safeResult = compressionResult && typeof compressionResult === "object" ? compressionResult : {};
  const trace = {
    applied: safeResult.outcome === "satisfied",
    format: compressionOptions.format,
    quality: safeResult.result ? safeResult.result.quality : null,
    maxEdge: safeResult.result ? safeResult.result.maxEdge : null,
    attempts: Math.max(0, Number(safeResult.attempts) || 0),
    durationMs: Math.max(0, Number(safeResult.durationMs) || 0),
    beforeBytes: sourceMeta.bytes,
    afterBytes: safeResult.result ? Math.max(0, Number(safeResult.result.bytes) || 0) : sourceMeta.bytes,
    outcome: String(safeResult.outcome || "unreached")
  };

  if (safeResult.outcome !== "satisfied" || !safeResult.result || !(safeResult.result.arrayBuffer instanceof ArrayBuffer)) {
    const messageByOutcome = {
      timeout: "Compression exceeded max duration",
      "max-attempts": "Compression exceeded max attempts",
      unreached: "Compression could not reach target bytes",
      "already-safe": "Compression skipped"
    };
    const error = new Error(messageByOutcome[trace.outcome] || "Compression failed");
    error.code = "COMPRESSION_FAILED";
    error.compressionTrace = trace;
    error.compressionAttempts = safeResult.trace || [];
    throw error;
  }

  const finalMeta = buildSourceMetaFromExport(safeResult.result, {
    bitDepth: sourceMeta.bitDepth
  });
  finalMeta.bitDepth = sourceMeta.bitDepth;

  log(
    `Compression success: ${sourceMeta.bytes} -> ${finalMeta.bytes} bytes (q=${trace.quality}, edge=${trace.maxEdge})`,
    "info"
  );

  return {
    applied: true,
    arrayBuffer: safeResult.result.arrayBuffer,
    sourceMeta,
    uploadMeta: finalMeta,
    compressionTrace: trace,
    compressionAttempts: safeResult.trace || []
  };
}

module.exports = {
  captureSelection,
  compressCapturedSelection
};
