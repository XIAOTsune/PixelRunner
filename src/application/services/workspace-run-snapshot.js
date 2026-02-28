const {
  normalizeUploadMaxEdge,
  normalizePasteStrategy,
  normalizeUploadRetryCount
} = require("../../domain/policies/run-settings-policy");

function cloneArrayBuffer(value) {
  if (value instanceof ArrayBuffer) return value.slice(0);
  if (ArrayBuffer.isView(value)) {
    return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
  }
  return null;
}

function cloneDeepValue(value, depth = 0) {
  if (value == null) return value;
  if (typeof value !== "object") return value;

  const binary = cloneArrayBuffer(value);
  if (binary) return binary;
  if (depth >= 8) return value;
  if (Array.isArray(value)) return value.map((item) => cloneDeepValue(item, depth + 1));

  const out = {};
  Object.keys(value).forEach((key) => {
    out[key] = cloneDeepValue(value[key], depth + 1);
  });
  return out;
}

function cloneInputValues(values) {
  const source = values && typeof values === "object" ? values : {};
  const out = {};
  Object.keys(source).forEach((key) => {
    out[key] = cloneDeepValue(source[key]);
  });
  return out;
}

function cloneBounds(bounds) {
  if (!bounds || typeof bounds !== "object") return null;
  return {
    left: Number(bounds.left),
    top: Number(bounds.top),
    right: Number(bounds.right),
    bottom: Number(bounds.bottom)
  };
}

function clonePlacementTarget(value) {
  if (!value || typeof value !== "object") return null;
  const documentId = Number(value.documentId);
  if (!Number.isFinite(documentId) || documentId <= 0) return null;
  return {
    documentId: Math.floor(documentId),
    sourceInputKey: String(value.sourceInputKey || ""),
    capturedAt: Number(value.capturedAt) || 0
  };
}

function buildPollSettings(settings = {}) {
  const source = settings && typeof settings === "object" ? settings : {};
  return {
    pollInterval: Number(source.pollInterval) || 2,
    timeout: Number(source.timeout) || 180
  };
}

function buildWorkspaceRunSnapshot(options = {}) {
  const settings = options.settings && typeof options.settings === "object" ? options.settings : {};
  return {
    appItem: cloneDeepValue(options.appItem),
    inputValues: cloneInputValues(options.inputValues),
    targetBounds: cloneBounds(options.targetBounds),
    sourceBuffer: cloneArrayBuffer(options.sourceBuffer),
    placementTarget: clonePlacementTarget(options.placementTarget),
    pollSettings: buildPollSettings(settings),
    uploadMaxEdge: normalizeUploadMaxEdge(settings.uploadMaxEdge),
    uploadRetryCount: normalizeUploadRetryCount(settings.uploadRetryCount),
    pasteStrategy: normalizePasteStrategy(settings.pasteStrategy)
  };
}

module.exports = {
  cloneArrayBuffer,
  cloneDeepValue,
  cloneInputValues,
  cloneBounds,
  clonePlacementTarget,
  buildPollSettings,
  buildWorkspaceRunSnapshot
};
