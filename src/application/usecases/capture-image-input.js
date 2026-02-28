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

async function captureImageInput(options = {}) {
  const ps = options.ps;
  const log = options.log;
  const previousValue = options.previousValue;
  const revokePreviewUrl = typeof options.revokePreviewUrl === "function" ? options.revokePreviewUrl : null;
  const createPreviewUrlFromBuffer = options.createPreviewUrlFromBuffer;

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
    return {
      ok: true,
      value: {
        arrayBuffer: capture.arrayBuffer,
        previewUrl,
        captureContext: normalizeCaptureContext(capture.captureContext)
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
