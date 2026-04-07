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
  const { photoshop } = await ensureDeps();
  const app = photoshop.app;
  const imaging = photoshop.imaging;
  const doc = app && app.activeDocument;
  if (!doc) throw new Error("No active Photoshop document");

  if (!imaging || typeof imaging.getPixels !== "function" || typeof imaging.encodeImageData !== "function") {
    throw new Error("Photoshop imaging API is unavailable");
  }

  const docInfo = getDocumentInfo(doc);
  const maxDimension = Math.max(256, Math.min(4096, Math.floor(Number(options.maxDimension) || 1536)));
  const quality = Math.max(20, Math.min(100, Math.floor(Number(options.quality) || 82)));
  const selectionBounds = normalizeBounds(docInfo.selectionBounds);
  const sourceWidth = selectionBounds
    ? Math.max(1, Number(selectionBounds.right) - Number(selectionBounds.left))
    : Math.max(1, Number(docInfo.width) || 1);
  const sourceHeight = selectionBounds
    ? Math.max(1, Number(selectionBounds.bottom) - Number(selectionBounds.top))
    : Math.max(1, Number(docInfo.height) || 1);
  const width = sourceWidth;
  const height = sourceHeight;
  const ratio = Math.min(1, maxDimension / Math.max(width, height));
  const targetWidth = Math.max(1, Math.round(width * ratio));
  const targetHeight = Math.max(1, Math.round(height * ratio));

  let pixels = null;
  try {
    pixels = await imaging.getPixels({
      documentID: Number(doc.id),
      sourceBounds: selectionBounds || undefined,
      targetSize: { width: targetWidth, height: targetHeight },
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
    return {
      ok: true,
      kind: "captured-document-image",
      source: "photoshop-document",
      document: docInfo,
      documentId: docInfo.documentId,
      selectionBounds,
      capturedFromSelection: Boolean(selectionBounds),
      width: targetWidth,
      height: targetHeight,
      originalWidth: width,
      originalHeight: height,
      mimeType: "image/jpeg",
      quality,
      maxDimension,
      base64,
      dataUrl: buildDataUrl("image/jpeg", base64)
    };
  } finally {
    try {
      pixels && pixels.imageData && typeof pixels.imageData.dispose === "function" && pixels.imageData.dispose();
    } catch (_) {}
  }
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
