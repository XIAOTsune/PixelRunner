const { API } = require("../../config");
const { normalizeUploadMaxEdge } = require("./upload-edge-strategy");
const { createRunCancelledError, fetchWithTimeout } = require("./request-strategy");

const IMAGE_RESIZE_DECODE_TIMEOUT_MS = 3500;
const IMAGE_RESIZE_ENCODE_TIMEOUT_MS = 3000;

function fallbackToMessage(result, fallback = "Request failed") {
  if (!result || typeof result !== "object") return fallback;
  return String(result.msg || result.message || fallback);
}

function base64ToArrayBuffer(base64) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i += 1) bytes[i] = binaryString.charCodeAt(i);
  return bytes.buffer;
}

function normalizeUploadBuffer(imageValue) {
  if (imageValue instanceof ArrayBuffer) return imageValue;
  if (ArrayBuffer.isView(imageValue)) {
    const view = imageValue;
    return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
  }
  if (imageValue && typeof imageValue === "object") {
    if (imageValue.arrayBuffer instanceof ArrayBuffer) return imageValue.arrayBuffer;
    if (ArrayBuffer.isView(imageValue.arrayBuffer)) {
      const view = imageValue.arrayBuffer;
      return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
    }
    if (typeof imageValue.base64 === "string" && imageValue.base64.trim()) {
      return base64ToArrayBuffer(imageValue.base64.trim());
    }
  }
  if (typeof imageValue === "string" && imageValue.trim()) {
    return base64ToArrayBuffer(imageValue.trim());
  }
  throw new Error("Image input is invalid");
}

function detectImageMime(arrayBuffer) {
  if (!(arrayBuffer instanceof ArrayBuffer) || arrayBuffer.byteLength < 12) return "application/octet-stream";
  const bytes = new Uint8Array(arrayBuffer);
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return "image/gif";
  return "application/octet-stream";
}

async function loadImageFromBuffer(arrayBuffer, options = {}) {
  if (!(arrayBuffer instanceof ArrayBuffer) || arrayBuffer.byteLength === 0) {
    throw new Error("Image buffer is empty");
  }
  if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function") {
    throw new Error("URL.createObjectURL is not available");
  }
  if (typeof Image === "undefined") {
    throw new Error("Image is not available");
  }

  const signal = options.signal || null;
  const timeoutMsRaw = Number(options.timeoutMs);
  const timeoutMs =
    Number.isFinite(timeoutMsRaw) && timeoutMsRaw > 0 ? timeoutMsRaw : IMAGE_RESIZE_DECODE_TIMEOUT_MS;
  const blob = new Blob([arrayBuffer], { type: detectImageMime(arrayBuffer) });
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    let done = false;
    let timerId = null;

    const cleanup = () => {
      if (timerId) {
        clearTimeout(timerId);
        timerId = null;
      }
      if (signal && typeof signal.removeEventListener === "function") {
        signal.removeEventListener("abort", onAbort);
      }
      img.onload = null;
      img.onerror = null;
      try {
        URL.revokeObjectURL(url);
      } catch (_) {}
    };

    const finishResolve = (value) => {
      if (done) return;
      done = true;
      cleanup();
      resolve(value);
    };

    const finishReject = (error) => {
      if (done) return;
      done = true;
      cleanup();
      reject(error);
    };

    const onAbort = () => {
      finishReject(createRunCancelledError("Run cancelled during image decode"));
    };

    if (signal && signal.aborted) {
      finishReject(createRunCancelledError("Run cancelled during image decode"));
      return;
    }
    if (signal && typeof signal.addEventListener === "function") {
      signal.addEventListener("abort", onAbort, { once: true });
    }

    timerId = setTimeout(() => {
      finishReject(new Error(`Image decode timeout after ${Math.round(timeoutMs)}ms`));
    }, timeoutMs);

    img.onload = () => {
      finishResolve(img);
    };
    img.onerror = () => {
      finishReject(new Error("Image decode failed"));
    };
    img.src = url;
  });
}

async function canvasToPngBlob(canvas, options = {}) {
  if (!canvas) return null;
  const timeoutMsRaw = Number(options.timeoutMs);
  const timeoutMs =
    Number.isFinite(timeoutMsRaw) && timeoutMsRaw > 0 ? timeoutMsRaw : IMAGE_RESIZE_ENCODE_TIMEOUT_MS;
  if (typeof canvas.toBlob === "function") {
    const blob = await new Promise((resolve) => {
      let done = false;
      const timerId = setTimeout(() => {
        if (done) return;
        done = true;
        resolve(null);
      }, timeoutMs);
      try {
        canvas.toBlob((result) => {
          if (done) return;
          done = true;
          clearTimeout(timerId);
          resolve(result || null);
        }, "image/png");
      } catch (_) {
        if (done) return;
        done = true;
        clearTimeout(timerId);
        resolve(null);
      }
    });
    if (blob) return blob;
  }

  if (typeof canvas.toDataURL === "function") {
    const dataUrl = canvas.toDataURL("image/png");
    const base64 = String(dataUrl || "").split(",")[1] || "";
    if (base64) {
      return new Blob([base64ToArrayBuffer(base64)], { type: "image/png" });
    }
  }
  return null;
}

async function resizeUploadBufferIfNeeded(buffer, uploadMaxEdge, log, options = {}) {
  const maxEdge = normalizeUploadMaxEdge(uploadMaxEdge);
  if (maxEdge <= 0) return buffer;
  if (typeof document === "undefined" || typeof Image === "undefined") return buffer;

  try {
    const img = await loadImageFromBuffer(buffer, {
      signal: options.signal,
      timeoutMs: options.resizeDecodeTimeoutMs
    });
    const sourceWidth = Number(img && (img.naturalWidth || img.width) || 0);
    const sourceHeight = Number(img && (img.naturalHeight || img.height) || 0);
    const longEdge = Math.max(sourceWidth, sourceHeight);
    if (!Number.isFinite(longEdge) || longEdge <= 0 || longEdge <= maxEdge) return buffer;

    const scale = maxEdge / longEdge;
    const targetWidth = Math.max(1, Math.round(sourceWidth * scale));
    const targetHeight = Math.max(1, Math.round(sourceHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return buffer;

    ctx.drawImage(img, 0, 0, targetWidth, targetHeight);
    const resizedBlob = await canvasToPngBlob(canvas, {
      timeoutMs: options.resizeEncodeTimeoutMs
    });
    if (!resizedBlob) return buffer;
    const resizedBuffer = await resizedBlob.arrayBuffer();
    if (!(resizedBuffer instanceof ArrayBuffer) || resizedBuffer.byteLength === 0) return buffer;

    if (typeof log === "function") {
      log(`Image resized before upload: ${sourceWidth}x${sourceHeight} -> ${targetWidth}x${targetHeight}`, "info");
    }
    return resizedBuffer;
  } catch (error) {
    if (error && error.code === "RUN_CANCELLED") throw error;
    if (typeof log === "function") {
      const message = error && error.message ? error.message : String(error || "unknown");
      log(`Image resize skipped: ${message}`, "warn");
    }
    return buffer;
  }
}

function pickUploadedValue(data) {
  const token = data.fileName || data.filename || data.fileKey || data.key || "";
  const url = data.url || data.fileUrl || data.download_url || data.downloadUrl || "";
  return { value: token || url, token: token || "", url: url || "" };
}

async function uploadImage(apiKey, imageValue, options = {}, helpers = {}) {
  const {
    fetchImpl,
    parseJsonResponse,
    toMessage,
    throwIfCancelled
  } = helpers;
  const safeFetch = typeof fetchImpl === "function" ? fetchImpl : fetch;
  const safeParseJsonResponse =
    typeof parseJsonResponse === "function"
      ? parseJsonResponse
      : async (response) => response.json().catch(() => null);
  const safeToMessage = typeof toMessage === "function" ? toMessage : fallbackToMessage;
  const safeThrowIfCancelled = typeof throwIfCancelled === "function" ? throwIfCancelled : () => {};

  const log = options.log || (() => {});
  const endpoints = [API.ENDPOINTS.UPLOAD_V2, API.ENDPOINTS.UPLOAD_LEGACY];
  const rawBuffer = normalizeUploadBuffer(imageValue);
  const buffer = await resizeUploadBufferIfNeeded(rawBuffer, options.uploadMaxEdge, log, options);
  const detectedMime = detectImageMime(buffer);
  const uploadMime = detectedMime.startsWith("image/") ? detectedMime : "image/png";
  const uploadFileName = uploadMime === "image/jpeg" ? "image.jpg" : uploadMime === "image/webp" ? "image.webp" : "image.png";
  const blob = new Blob([buffer], { type: uploadMime });
  const reasons = [];

  for (const endpoint of endpoints) {
    safeThrowIfCancelled(options);
    try {
      const formData = new FormData();
      formData.append("file", blob, uploadFileName);

      const response = await fetchWithTimeout(safeFetch, `${API.BASE_URL}${endpoint}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: formData,
        signal: options.signal
      }, {
        timeoutMs: options.requestTimeoutMs
      });
      safeThrowIfCancelled(options);
      const result = await safeParseJsonResponse(response);
      safeThrowIfCancelled(options);

      if (!response.ok) {
        reasons.push(`${endpoint}: HTTP ${response.status}`);
        continue;
      }

      const success = result && (result.code === 0 || result.success === true);
      if (!success) {
        reasons.push(`${endpoint}: ${safeToMessage(result)}`);
        continue;
      }

      const data = result.data || result.result || {};
      const picked = pickUploadedValue(data);
      if (picked.value) return picked;
      reasons.push(`${endpoint}: upload success but no usable file token/url`);
    } catch (error) {
      if (error && error.code === "RUN_CANCELLED") throw error;
      reasons.push(`${endpoint}: ${error.message}`);
    }
  }

  log(reasons.join(" | "), "warn");
  throw new Error("Image upload failed");
}

module.exports = {
  normalizeUploadBuffer,
  detectImageMime,
  pickUploadedValue,
  uploadImage
};
