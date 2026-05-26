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

export async function fetchBinary(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download result (HTTP ${response.status})`);
  }
  return response.arrayBuffer();
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
