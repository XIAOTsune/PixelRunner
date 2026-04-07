import { ensureDeps, fetchBinary } from "./deps.js";
import {
  activateDocument,
  buildDataUrl,
  ensureActiveDocument,
  getDocumentInfo,
  normalizeBounds,
  renameActiveLayer
} from "./document.js";
import { runToolActionByName } from "./tool-actions.js";

const DEFAULT_UPLOAD_TARGET_BYTES = 10_000_000;
const DEFAULT_UPLOAD_HARD_LIMIT_BYTES = 11_000_000;
const DEFAULT_UPLOAD_QUALITY_STEPS = [12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1];

function getBoundsSize(bounds) {
  return {
    width: Math.max(1, Number(bounds.right) - Number(bounds.left)),
    height: Math.max(1, Number(bounds.bottom) - Number(bounds.top))
  };
}

function getBoundsCenter(bounds) {
  return {
    x: (Number(bounds.left) + Number(bounds.right)) / 2,
    y: (Number(bounds.top) + Number(bounds.bottom)) / 2
  };
}

function arrayBufferToBase64(buffer) {
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength === 0) return "";
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function extractEncodedBase64(encoded) {
  if (!encoded) return "";
  if (typeof encoded === "string") return encoded.trim();
  if (encoded instanceof ArrayBuffer) return arrayBufferToBase64(encoded);
  if (ArrayBuffer.isView(encoded)) {
    const view = encoded;
    return arrayBufferToBase64(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength));
  }
  if (typeof encoded === "object") {
    const direct = [
      encoded.base64,
      encoded.data,
      encoded.value,
      encoded.string,
      encoded.output
    ].find((item) => typeof item === "string" && item.trim());
    if (direct) return direct.trim();

    const nestedBuffer = [encoded.arrayBuffer, encoded.buffer, encoded.dataBuffer].find(
      (item) => item instanceof ArrayBuffer || ArrayBuffer.isView(item)
    );
    if (nestedBuffer instanceof ArrayBuffer) return arrayBufferToBase64(nestedBuffer);
    if (nestedBuffer && ArrayBuffer.isView(nestedBuffer)) {
      return arrayBufferToBase64(
        nestedBuffer.buffer.slice(nestedBuffer.byteOffset, nestedBuffer.byteOffset + nestedBuffer.byteLength)
      );
    }
  }
  return "";
}

function parseLayerBounds(bounds) {
  return normalizeBounds(bounds);
}

function clampBoundsToDocument(bounds, docInfo) {
  const width = Math.max(1, Number(docInfo && docInfo.width) || 1);
  const height = Math.max(1, Number(docInfo && docInfo.height) || 1);
  if (!bounds) {
    return {
      left: 0,
      top: 0,
      right: width,
      bottom: height
    };
  }

  const left = Math.max(0, Math.min(width - 1, Math.floor(Number(bounds.left) || 0)));
  const top = Math.max(0, Math.min(height - 1, Math.floor(Number(bounds.top) || 0)));
  const right = Math.max(left + 1, Math.min(width, Math.ceil(Number(bounds.right) || width)));
  const bottom = Math.max(top + 1, Math.min(height, Math.ceil(Number(bounds.bottom) || height)));
  return { left, top, right, bottom };
}

function getPreviewTargetSize(sourceWidth, sourceHeight, maxDimension) {
  const width = Math.max(1, Number(sourceWidth) || 1);
  const height = Math.max(1, Number(sourceHeight) || 1);
  const limitedMax = Math.max(256, Math.min(4096, Math.floor(Number(maxDimension) || 1536)));
  const ratio = Math.min(1, limitedMax / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio))
  };
}

async function getPixelsWithFallback(imaging, options) {
  try {
    return await imaging.getPixels(options);
  } catch (error) {
    const fallbackOptions = { ...options };
    delete fallbackOptions.componentSize;
    return imaging.getPixels(fallbackOptions);
  }
}

async function closeDocumentWithoutSaving(action, docRef) {
  if (!docRef) return;
  if (typeof docRef.closeWithoutSaving === "function") {
    await docRef.closeWithoutSaving();
    return;
  }
  await action.batchPlay([{
    _obj: "close",
    _target: [{ _ref: "document", _id: Number(docRef.id) }],
    saving: { _enum: "yesNo", _value: "no" }
  }], {});
}

function jpegDescriptor(quality) {
  return {
    _obj: "JPEG",
    extendedQuality: Math.max(1, Math.min(12, Math.floor(Number(quality) || 8))),
    matteColor: { _enum: "matteColor", _value: "none" }
  };
}

async function deleteFileQuietly(file) {
  if (!file || typeof file.delete !== "function") return;
  try {
    await file.delete();
  } catch (_) {}
}

async function exportDocumentAsJpeg(storage, action, docRef, quality, filePrefix = "pixelrunner-capture") {
  const tempFolder = await storage.localFileSystem.getTemporaryFolder();
  const tempFile = await tempFolder.createFile(`${filePrefix}-${Date.now()}-${quality}.jpg`, { overwrite: true });
  try {
    const sessionToken = await storage.localFileSystem.createSessionToken(tempFile);
    await action.batchPlay([{
      _obj: "save",
      as: jpegDescriptor(quality),
      in: { _path: sessionToken, _kind: "local" },
      documentID: Number(docRef.id),
      copy: true,
      lowerCase: true,
      saveStage: { _enum: "saveStageType", _value: "saveStageOS" }
    }], {});

    const rawBuffer = await tempFile.read({ format: storage.formats.binary });
    const arrayBuffer = rawBuffer instanceof ArrayBuffer
      ? rawBuffer
      : ArrayBuffer.isView(rawBuffer)
        ? rawBuffer.buffer.slice(rawBuffer.byteOffset, rawBuffer.byteOffset + rawBuffer.byteLength)
        : new Uint8Array(rawBuffer || []).buffer;
    return {
      arrayBuffer,
      bytes: Math.max(0, Number(arrayBuffer && arrayBuffer.byteLength) || 0),
      mimeType: "image/jpeg"
    };
  } finally {
    await deleteFileQuietly(tempFile);
  }
}

async function buildCompressedUploadAsset(doc, docInfo, selectionBounds, compressionOptions = {}, modalDeps = null) {
  const deps = modalDeps && typeof modalDeps === "object" ? modalDeps : await ensureDeps();
  const action = deps.photoshop.action;
  const storage = deps.storage;
  const cropBounds = clampBoundsToDocument(selectionBounds, docInfo);
  const targetBytes = Math.max(1, Math.floor(Number(compressionOptions.targetBytes) || DEFAULT_UPLOAD_TARGET_BYTES));
  const hardLimitBytes = Math.max(targetBytes, Math.floor(Number(compressionOptions.hardLimitBytes) || DEFAULT_UPLOAD_HARD_LIMIT_BYTES));
  const qualitySteps = Array.isArray(compressionOptions.qualitySteps) && compressionOptions.qualitySteps.length
    ? compressionOptions.qualitySteps
    : DEFAULT_UPLOAD_QUALITY_STEPS;

  let uploadResult = null;

  let tempDoc = null;
  try {
    tempDoc = await doc.duplicate("pixelrunner_upload_capture");
    try {
      await tempDoc.flatten();
    } catch (_) {}

    const isSelectionCapture =
      selectionBounds &&
      (cropBounds.left > 0 ||
        cropBounds.top > 0 ||
        cropBounds.right < Math.max(1, Number(docInfo.width) || 1) ||
        cropBounds.bottom < Math.max(1, Number(docInfo.height) || 1));

    if (isSelectionCapture && typeof tempDoc.crop === "function") {
      await tempDoc.crop(cropBounds);
    }

    let lastAttempt = null;
    const attempts = [];
    for (const quality of qualitySteps) {
      const exported = await exportDocumentAsJpeg(storage, action, tempDoc, quality, "pixelrunner-upload");
      const attempt = {
        quality: Math.max(1, Math.min(12, Math.floor(Number(quality) || 8))),
        bytes: exported.bytes
      };
      attempts.push(attempt);
      lastAttempt = { ...exported, quality: attempt.quality };
      if (exported.bytes <= targetBytes) {
        uploadResult = {
          ...exported,
          quality: attempt.quality,
          attempts,
          targetBytes,
          hardLimitBytes
        };
        break;
      }
    }

    if (lastAttempt && lastAttempt.bytes <= hardLimitBytes) {
      if (!uploadResult) {
        uploadResult = {
          ...lastAttempt,
          attempts,
          targetBytes,
          hardLimitBytes
        };
      }
    }

    if (!uploadResult) {
      const error = new Error("图片压缩后仍超过上传限制");
      error.attempts = attempts;
      error.targetBytes = targetBytes;
      error.hardLimitBytes = hardLimitBytes;
      throw error;
    }
  } finally {
    await closeDocumentWithoutSaving(action, tempDoc);
  }

  if (!uploadResult || !(uploadResult.arrayBuffer instanceof ArrayBuffer)) {
    throw new Error("Failed to build upload asset");
  }

  const base64 = arrayBufferToBase64(uploadResult.arrayBuffer);
  const asset = {
    mimeType: uploadResult.mimeType,
    base64,
    dataUrl: buildDataUrl(uploadResult.mimeType, base64),
    bytes: uploadResult.bytes,
    quality: uploadResult.quality,
    targetBytes: uploadResult.targetBytes,
    hardLimitBytes: uploadResult.hardLimitBytes,
    attempts: uploadResult.attempts || []
  };
  console.log("[PixelRunner/Photoshop] buildCompressedUploadAsset:success", {
    bytes: asset.bytes,
    quality: asset.quality,
    targetBytes: asset.targetBytes,
    hardLimitBytes: asset.hardLimitBytes,
    hasBase64: Boolean(asset.base64)
  });
  return asset;
}

async function transformLayerScale(action, layerId, scaleXPercent, scaleYPercent) {
  await action.batchPlay([{
    _obj: "transform",
    _target: [{ _ref: "layer", _id: layerId }],
    freeTransformCenterState: { _enum: "quadCenterState", _value: "QCSAverage" },
    width: { _unit: "percentUnit", _value: scaleXPercent },
    height: { _unit: "percentUnit", _value: scaleYPercent },
    linked: false
  }], {});
}

async function transformLayerOffset(action, layerId, dx, dy) {
  await action.batchPlay([{
    _obj: "transform",
    _target: [{ _ref: "layer", _id: layerId }],
    freeTransformCenterState: { _enum: "quadCenterState", _value: "QCSAverage" },
    offset: {
      _obj: "offset",
      horizontal: { _unit: "pixelsUnit", _value: dx },
      vertical: { _unit: "pixelsUnit", _value: dy }
    }
  }], {});
}

async function createSelectionFromBounds(doc, bounds) {
  if (!doc || !bounds || !doc.selection || typeof doc.selection.select !== "function") return;
  const region = [
    [bounds.left, bounds.top],
    [bounds.right, bounds.top],
    [bounds.right, bounds.bottom],
    [bounds.left, bounds.bottom]
  ];
  await doc.selection.select(region);
}

async function applyLayerMaskFromSelection(action) {
  await action.batchPlay([{
    _obj: "make",
    new: { _class: "channel" },
    at: { _ref: "channel", _enum: "channel", _value: "mask" },
    using: { _enum: "userMaskEnabled", _value: "revealSelection" }
  }], {});
}

async function alignPlacedLayerToBounds(doc, action, targetBounds, options = {}) {
  const layer = doc && doc.activeLayers && doc.activeLayers[0];
  const bounds = parseLayerBounds(layer && layer.bounds);
  if (!layer || !bounds || !targetBounds) return;

  const currentSize = getBoundsSize(bounds);
  const targetSize = getBoundsSize(targetBounds);
  const scale = options.mode === "cover"
    ? Math.max(targetSize.width / currentSize.width, targetSize.height / currentSize.height)
    : Math.min(targetSize.width / currentSize.width, targetSize.height / currentSize.height);

  if (Number.isFinite(scale) && scale > 0 && Math.abs(scale - 1) > 0.001) {
    await transformLayerScale(action, layer.id, scale * 100, scale * 100);
  }

  const nextLayer = doc && doc.activeLayers && doc.activeLayers[0];
  const nextBounds = parseLayerBounds(nextLayer && nextLayer.bounds);
  if (!nextLayer || !nextBounds) return;

  const currentCenter = getBoundsCenter(nextBounds);
  const targetCenter = getBoundsCenter(targetBounds);
  const dx = targetCenter.x - currentCenter.x;
  const dy = targetCenter.y - currentCenter.y;
  if (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01) {
    await transformLayerOffset(action, nextLayer.id, dx, dy);
  }

  if (options.applyMask) {
    await createSelectionFromBounds(doc, targetBounds);
    await applyLayerMaskFromSelection(action);
  }
}

export async function getActiveDocumentInfo() {
  const { photoshop } = await ensureDeps();
  return getDocumentInfo(photoshop.app && photoshop.app.activeDocument);
}

export async function captureDocumentPreview(options = {}) {
  console.log("[PixelRunner/Photoshop] captureDocumentPreview:start", options);
  const deps = await ensureDeps();
  const { photoshop } = deps;
  const app = photoshop.app;
  const imaging = photoshop.imaging;
  const core = photoshop.core;
  const doc = app && app.activeDocument;
  if (!doc) throw new Error("No active Photoshop document");

  if (!imaging || typeof imaging.getPixels !== "function" || typeof imaging.encodeImageData !== "function") {
    throw new Error("Photoshop imaging API is unavailable");
  }

  const docInfo = getDocumentInfo(doc);
  const maxDimension = Math.max(256, Math.min(4096, Math.floor(Number(options.maxDimension) || 1536)));
  const quality = Math.max(20, Math.min(100, Math.floor(Number(options.quality) || 82)));
  const rawSelectionBounds = normalizeBounds(docInfo.selectionBounds);
  const selectionBounds = rawSelectionBounds ? clampBoundsToDocument(rawSelectionBounds, docInfo) : null;
  const captureBounds = clampBoundsToDocument(selectionBounds, docInfo);
  const sourceWidth = Math.max(1, Number(captureBounds.right) - Number(captureBounds.left));
  const sourceHeight = Math.max(1, Number(captureBounds.bottom) - Number(captureBounds.top));
  const targetSize = getPreviewTargetSize(sourceWidth, sourceHeight, maxDimension);
  return core.executeAsModal(async () => {
    const uploadAsset = await buildCompressedUploadAsset(doc, docInfo, selectionBounds, options, deps);

    let pixels = null;
    try {
      pixels = await getPixelsWithFallback(imaging, {
        documentID: Number(doc.id),
        sourceBounds: captureBounds,
        targetSize,
        componentSize: 8,
        applyAlpha: true
      });

      const encoded = await imaging.encodeImageData({
        imageData: pixels.imageData,
        base64: true,
        format: "jpeg",
        quality
      });

      const base64 = extractEncodedBase64(encoded);
      if (!base64) {
        throw new Error("Photoshop returned an empty capture payload");
      }
      const result = {
        ok: true,
        kind: "captured-document-image",
        source: "photoshop-document",
        document: docInfo,
        documentId: docInfo.documentId,
        selectionBounds,
        capturedFromSelection: Boolean(selectionBounds),
        width: targetSize.width,
        height: targetSize.height,
        originalWidth: sourceWidth,
        originalHeight: sourceHeight,
        mimeType: "image/jpeg",
        quality,
        maxDimension,
        base64,
        dataUrl: buildDataUrl("image/jpeg", base64),
        uploadMimeType: uploadAsset.mimeType,
        uploadBase64: uploadAsset.base64,
        uploadDataUrl: uploadAsset.dataUrl,
        uploadBytes: uploadAsset.bytes,
        uploadQuality: uploadAsset.quality,
        uploadTargetBytes: uploadAsset.targetBytes,
        uploadHardLimitBytes: uploadAsset.hardLimitBytes,
        compressionAttempts: uploadAsset.attempts
      };
      console.log("[PixelRunner/Photoshop] captureDocumentPreview:success", {
        documentId: result.documentId,
        width: result.width,
        height: result.height,
        capturedFromSelection: result.capturedFromSelection,
        hasBase64: Boolean(result.base64),
        uploadBytes: result.uploadBytes,
        uploadQuality: result.uploadQuality
      });
      return result;
    } finally {
      try {
        pixels && pixels.imageData && typeof pixels.imageData.dispose === "function" && pixels.imageData.dispose();
      } catch (_) {}
    }
  }, { commandName: "PixelRunner Capture Preview" });
}

export async function runToolAction(payload = {}) {
  const context = await ensureActiveDocument();
  return runToolActionByName(payload, context);
}

export async function placeImageFromUrl(payload) {
  const options = payload && typeof payload === "object" ? payload : {};
  const url = String(options.url || "").trim();
  if (!url) throw new Error("Result URL is missing");

  const { photoshop, storage } = await ensureDeps();
  const app = photoshop.app;
  const core = photoshop.core;
  const action = photoshop.action;

  if (!app || !app.activeDocument) throw new Error("No active Photoshop document");

  const buffer = await fetchBinary(url);
  const fs = storage.localFileSystem;
  const formats = storage.formats;
  const tempFolder = await fs.getTemporaryFolder();
  const tempFile = await tempFolder.createFile("pixelrunner-result.png", { overwrite: true });
  await tempFile.write(buffer, { format: formats.binary });
  const sessionToken = await fs.createSessionToken(tempFile);
  const targetDocumentId = Number(options.targetDocumentId || options.sourceDocumentId);
  const targetBounds = normalizeBounds(options.targetBounds);
  const placementMode = String(options.fitMode || "contain").trim().toLowerCase() === "cover" ? "cover" : "contain";
  const applyMask = options.applyMask !== false;

  await core.executeAsModal(async () => {
    const targetDocument = await activateDocument(app, action, targetDocumentId);
    await action.batchPlay([{
      _obj: "placeEvent",
      null: { _path: sessionToken, _kind: "local" },
      freeTransformCenterState: { _enum: "quadCenterState", _value: "QCSAverage" },
      offset: {
        _obj: "offset",
        horizontal: { _unit: "pixelsUnit", _value: 0 },
        vertical: { _unit: "pixelsUnit", _value: 0 }
      }
    }], {});

    if (targetBounds) {
      await alignPlacedLayerToBounds(targetDocument || app.activeDocument, action, targetBounds, {
        mode: placementMode,
        applyMask
      });
    }
  }, { commandName: "Place PixelRunner Result" });

  const layerName = await renameActiveLayer(options.layerName);
  const latestInfo = getDocumentInfo(app.activeDocument);
  return {
    ok: true,
    placed: true,
    documentId: Number(latestInfo.documentId) || 0,
    layerName: layerName || null,
    document: latestInfo,
    targetBounds
  };
}
