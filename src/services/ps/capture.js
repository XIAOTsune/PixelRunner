const { app, core, action } = require("photoshop");
const { storage } = require("uxp");
const {
  toPixelNumber,
  getDocSizePx
} = require("./shared");

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

async function exportDocPngToArrayBuffer(docId, fileName = "capture.png") {
  const tempFolder = await fs.getTemporaryFolder();
  const tempFile = await tempFolder.createFile(fileName, { overwrite: true });
  const sessionToken = await fs.createSessionToken(tempFile);

  await action.batchPlay([{
    _obj: "save",
    as: { _obj: "PNGFormat", method: { _enum: "PNGMethod", _value: "quick" } },
    in: { _path: sessionToken, _kind: "local" },
    documentID: docId,
    copy: true,
    lowerCase: true,
    saveStage: { _enum: "saveStageType", _value: "saveStageOS" }
  }], {});

  return tempFile.read({ format: formats.binary });
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

async function captureSelection(options = {}) {
  const log = options.log || (() => {});
  try {
    const doc = app.activeDocument;
    if (!doc) {
      log("璇峰厛鍦?Photoshop 涓墦寮€鏂囨。", "error");
      return null;
    }

    let capturedBuffer = null;
    let selectionBounds = null;
    let originalSelectionBounds = null;
    try {
      originalSelectionBounds = doc.selection && doc.selection.bounds;
    } catch (_) {}

    await core.executeAsModal(async () => {
      const rawSelection = parseRawBounds(originalSelectionBounds);
      const useFullDocFastPath = !rawSelection || isNearlyFullBounds(rawSelection, doc);
      if (useFullDocFastPath) {
        selectionBounds = buildCropBounds(null, doc);
        capturedBuffer = await exportDocPngToArrayBuffer(doc.id, "capture_full.png");
        return;
      }

      let tempDoc = null;
      try {
        tempDoc = await doc.duplicate("rh_capture_temp");
        try {
          await tempDoc.flatten();
        } catch (_) {}

        let tempSelectionBounds = null;
        try {
          tempSelectionBounds = tempDoc.selection && tempDoc.selection.bounds;
        } catch (_) {}

        const cropBounds = buildCropBounds(originalSelectionBounds || tempSelectionBounds, tempDoc);
        selectionBounds = { ...cropBounds };
        await tempDoc.crop(cropBounds);
        capturedBuffer = await exportDocPngToArrayBuffer(tempDoc.id, "capture_selection.png");
      } finally {
        await closeDocNoSave(tempDoc);
      }
    }, { commandName: "Capture Selection" });

    if (!capturedBuffer) return null;
    return {
      arrayBuffer: capturedBuffer,
      selectionBounds,
      captureContext: buildCaptureContext(doc)
    };
  } catch (e) {
    log(`鎹曡幏閫夊尯澶辫触: ${e.message}`, "error");
    return null;
  }
}

module.exports = {
  captureSelection
};
