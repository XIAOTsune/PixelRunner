export async function ensureDeps() {
  if (typeof require !== "function") {
    throw new Error("Photoshop host dependencies are unavailable");
  }

  const photoshop = require("photoshop");
  const uxp = require("uxp");
  if (!photoshop || !uxp || !uxp.storage) {
    throw new Error("Photoshop or UXP storage module is unavailable");
  }

  return {
    photoshop,
    storage: uxp.storage
  };
}

function getResponseMimeType(response) {
  try {
    return String(response && response.headers && response.headers.get("content-type") || "")
      .split(";", 1)[0]
      .trim()
      .toLowerCase();
  } catch (_) {
    return "";
  }
}

export async function fetchBinaryWithMetadata(url, options = {}) {
  const timeoutMs = Math.max(5000, Number(options.timeoutMs) || 120000);
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  let timedOut = false;
  const timer = controller
    ? setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs)
    : 0;

  try {
    const response = await fetch(url, controller ? { signal: controller.signal } : undefined);
    if (!response.ok) {
      throw new Error(`Failed to download result (HTTP ${response.status})`);
    }
    return {
      buffer: await response.arrayBuffer(),
      mimeType: getResponseMimeType(response),
      responseUrl: String(response.url || url || "").trim()
    };
  } catch (error) {
    if (timedOut) {
      throw new Error(`Failed to download result (timeout after ${Math.round(timeoutMs / 1000)}s)`);
    }
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function fetchBinary(url) {
  const result = await fetchBinaryWithMetadata(url);
  return result.buffer;
}

const IMAGE_FILE_TYPES = {
  png: { extension: "png", mimeType: "image/png" },
  jpg: { extension: "jpg", mimeType: "image/jpeg" },
  webp: { extension: "webp", mimeType: "image/webp" },
  gif: { extension: "gif", mimeType: "image/gif" },
  bmp: { extension: "bmp", mimeType: "image/bmp" },
  tif: { extension: "tif", mimeType: "image/tiff" },
  avif: { extension: "avif", mimeType: "image/avif" },
  heic: { extension: "heic", mimeType: "image/heic" }
};

function bytesEqual(bytes, offset, values) {
  return values.every((value, index) => bytes[offset + index] === value);
}

function asciiAt(bytes, offset, length) {
  if (offset < 0 || offset + length > bytes.length) return "";
  let text = "";
  for (let index = offset; index < offset + length; index += 1) {
    text += String.fromCharCode(bytes[index]);
  }
  return text;
}

function detectMagicImageType(bytes) {
  if (bytesEqual(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (bytesEqual(bytes, 0, [0xff, 0xd8, 0xff])) return "jpg";
  if (asciiAt(bytes, 0, 4) === "RIFF" && asciiAt(bytes, 8, 4) === "WEBP") return "webp";
  if (["GIF87a", "GIF89a"].includes(asciiAt(bytes, 0, 6))) return "gif";
  if (asciiAt(bytes, 0, 2) === "BM") return "bmp";
  if (
    bytesEqual(bytes, 0, [0x49, 0x49, 0x2a, 0x00]) ||
    bytesEqual(bytes, 0, [0x4d, 0x4d, 0x00, 0x2a])
  ) return "tif";
  if (asciiAt(bytes, 4, 4) === "ftyp") {
    const brand = asciiAt(bytes, 8, 4).toLowerCase();
    if (["avif", "avis"].includes(brand)) return "avif";
    if (["heic", "heix", "hevc", "hevx", "mif1", "msf1"].includes(brand)) return "heic";
  }
  return "";
}

function looksLikeErrorText(bytes) {
  const sample = asciiAt(bytes, 0, Math.min(bytes.length, 256))
    .replace(/^\u00ef\u00bb\u00bf/, "")
    .trimStart()
    .toLowerCase();
  return /^(?:<!doctype|<html|<\?xml|<error|\{|\[)/.test(sample);
}

function getImageTypeFromMimeType(value) {
  const mimeType = String(value || "").split(";", 1)[0].trim().toLowerCase();
  if (["image/jpeg", "image/jpg", "image/pjpeg"].includes(mimeType)) return "jpg";
  if (["image/tiff", "image/tif"].includes(mimeType)) return "tif";
  return Object.keys(IMAGE_FILE_TYPES).find((key) => IMAGE_FILE_TYPES[key].mimeType === mimeType) || "";
}

function getImageTypeFromUrl(value) {
  const match = String(value || "").match(/\.([a-z0-9]+)(?:[?#]|$)/i);
  if (!match) return "";
  const extension = match[1].toLowerCase();
  if (["jpg", "jpeg", "jpe", "jfif"].includes(extension)) return "jpg";
  if (["tif", "tiff"].includes(extension)) return "tif";
  return Object.prototype.hasOwnProperty.call(IMAGE_FILE_TYPES, extension) ? extension : "";
}

export function detectImageFileType(buffer, hints = {}) {
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 4) return null;
  const bytes = new Uint8Array(buffer);
  const magicType = detectMagicImageType(bytes);
  if (magicType) return { ...IMAGE_FILE_TYPES[magicType], detectedBy: "signature" };
  if (looksLikeErrorText(bytes)) return null;

  const mimeType = String(hints.mimeType || "").trim().toLowerCase();
  if (mimeType && !mimeType.startsWith("image/") && mimeType !== "application/octet-stream") return null;
  const hintedType =
    getImageTypeFromMimeType(mimeType) ||
    getImageTypeFromUrl(hints.responseUrl) ||
    getImageTypeFromUrl(hints.sourceUrl);
  return hintedType ? { ...IMAGE_FILE_TYPES[hintedType], detectedBy: "metadata" } : null;
}

function normalizeBase64Text(base64) {
  return String(base64 || "").trim().replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
}

export function parseDataUrl(dataUrl) {
  const match = String(dataUrl || "").trim().match(/^data:([^;,]+)?;base64,(.+)$/i);
  if (!match) return null;
  return {
    mimeType: String(match[1] || "application/octet-stream"),
    base64: String(match[2] || "")
  };
}

export function base64ToArrayBuffer(base64) {
  const normalized = normalizeBase64Text(base64);
  if (!normalized) throw new Error("Base64 payload is empty");
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}
