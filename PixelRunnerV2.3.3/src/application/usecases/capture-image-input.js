const {
  normalizeUploadTargetBytes,
  normalizeUploadHardLimitBytes,
  classifyUploadRiskByBytes,
  normalizeUploadCompressFormat
} = require("../../domain/policies/run-settings-policy");

function toMessage(error) {
  return error && error.message ? error.message : String(error || "unknown error");
}

function normalizeCaptureContext(value) {
  if (!value || typeof value !== "object") return null;
  const documentId = Number(value.documentId);
  if (!Number.isFinite(documentId) || documentId <= 0) return null;
  return {
    documentId: Math.floor(documentId),
    documentTitle: String(value.documentTitle || ""),
    capturedAt: Number(value.capturedAt) || Date.now()
  };
}

function normalizeBitDepth(value) {
  const num = Number(value);
  if (Number.isFinite(num) && num > 0) return Math.floor(num);
  const marker = String(value || "");
  const matched = marker.match(/(\d+)/);
  if (matched) return Math.floor(Number(matched[1]) || 0) || null;
  return null;
}

function normalizeSourceMeta(capture) {
  const meta = capture && capture.sourceMeta && typeof capture.sourceMeta === "object" ? capture.sourceMeta : {};
  const bytes = Math.max(
    0,
    Number(meta.bytes) ||
      (capture && capture.arrayBuffer instanceof ArrayBuffer ? capture.arrayBuffer.byteLength : 0) ||
      0
  );
  return {
    mime: String(meta.mime || "image/png"),
    bytes,
    width: Math.max(1, Number(meta.width) || 1),
    height: Math.max(1, Number(meta.height) || 1),
    bitDepth: normalizeBitDepth(meta.bitDepth)
  };
}

function resolveUploadLimits(settings = {}) {
  const source = settings && typeof settings === "object" ? settings : {};
  const targetBytes = normalizeUploadTargetBytes(source.uploadTargetBytes, 9_000_000);
  const hardLimitBytes = normalizeUploadHardLimitBytes(source.uploadHardLimitBytes, 10_000_000, targetBytes);
  return { targetBytes, hardLimitBytes };
}

function buildUploadMeta(sourceMeta, settings = {}) {
  const { targetBytes, hardLimitBytes } = resolveUploadLimits(settings);
  const bytes = Math.max(0, Number(sourceMeta && sourceMeta.bytes) || 0);
  return {
    mime: String((sourceMeta && sourceMeta.mime) || "image/png"),
    bytes,
    width: Math.max(1, Number((sourceMeta && sourceMeta.width) || 1)),
    height: Math.max(1, Number((sourceMeta && sourceMeta.height) || 1)),
    bitDepth: normalizeBitDepth(sourceMeta && sourceMeta.bitDepth),
    risk: classifyUploadRiskByBytes(bytes, targetBytes, hardLimitBytes)
  };
}

function buildBitDepthHint(bitDepth) {
  const normalized = normalizeBitDepth(bitDepth);
  if (!normalized) return "";
  if (normalized > 8) return `当前图像位深为 ${normalized}-bit，可能影响上传成功率。`;
  return `当前图像位深为 ${normalized}-bit。`;
}

async function captureImageInput(options = {}) {
  const ps = options.ps;
  const log = options.log;
  const previousValue = options.previousValue;
  const revokePreviewUrl = typeof options.revokePreviewUrl === "function" ? options.revokePreviewUrl : null;
  const createPreviewUrlFromBuffer = options.createPreviewUrlFromBuffer;
  const getUploadSettings =
    typeof options.getUploadSettings === "function"
      ? options.getUploadSettings
      : () => options.uploadSettings || {};

  if (!ps || typeof ps.captureSelection !== "function") {
    throw new Error("captureImageInput requires ps.captureSelection");
  }
  if (typeof createPreviewUrlFromBuffer !== "function") {
    throw new Error("captureImageInput requires createPreviewUrlFromBuffer");
  }

  try {
    const capture = await ps.captureSelection({ log });
    if (!capture || !capture.arrayBuffer) {
      return {
        ok: false,
        reason: "empty"
      };
    }

    if (revokePreviewUrl) revokePreviewUrl(previousValue);
    const previewUrl = createPreviewUrlFromBuffer(capture.arrayBuffer);
    const uploadSettings = getUploadSettings() || {};
    const sourceMeta = normalizeSourceMeta(capture);
    const uploadMeta = buildUploadMeta(sourceMeta, uploadSettings);
    const compressionFormat = normalizeUploadCompressFormat(uploadSettings.uploadCompressFormat, "jpeg");
    return {
      ok: true,
      value: {
        arrayBuffer: capture.arrayBuffer,
        previewUrl,
        captureContext: normalizeCaptureContext(capture.captureContext),
        sourceMeta,
        uploadMeta,
        bitDepthHint: buildBitDepthHint(sourceMeta.bitDepth),
        compressionTrace: {
          applied: false,
          format: compressionFormat,
          quality: null,
          maxEdge: null,
          attempts: 0,
          durationMs: 0,
          beforeBytes: sourceMeta.bytes,
          afterBytes: sourceMeta.bytes,
          outcome: "not-applied"
        }
      },
      selectionBounds: capture.selectionBounds || null
    };
  } catch (error) {
    return {
      ok: false,
      reason: "error",
      message: toMessage(error)
    };
  }
}

module.exports = {
  captureImageInput
};
