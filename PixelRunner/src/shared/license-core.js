import nacl from "tweetnacl";

export const LICENSE_SCHEMA_VERSION = 1;
export const LICENSE_PRODUCT_ID = "com.tsune.pixelrunner";
export const LICENSE_PREFIX = "PRL2";
export const INSTALLATION_ID_STORAGE_KEY = "pixelrunner.license.installationId.v1";
export const ACTIVATION_STORAGE_KEY = "pixelrunner.license.activation.v1";

export const LICENSE_FEATURES = Object.freeze({
  glow: "辉光",
  spaceFx: "空间特效",
  blendMatch: "融合校色",
  localUpscale: "本地超分"
});

const FEATURE_IDS = new Set(Object.keys(LICENSE_FEATURES));
const PAYLOAD_FIELDS = [
  "schemaVersion",
  "productId",
  "licenseId",
  "deviceCodeHash",
  "features",
  "issuedAt",
  "permanent",
  "keyId"
];
const CROCKFORD_BASE32 = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function encodeUtf8(value) {
  return new TextEncoder().encode(String(value == null ? "" : value));
}

function bytesToBase64(bytes) {
  let binary = "";
  const source = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  for (let index = 0; index < source.length; index += 1) binary += String.fromCharCode(source[index]);
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(String(value || ""));
  const output = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) output[index] = binary.charCodeAt(index);
  return output;
}

export function base64UrlEncode(bytes) {
  return bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function base64UrlDecode(value) {
  const normalized = String(value || "").trim();
  if (!/^[A-Za-z0-9_-]+$/.test(normalized)) throw new Error("base64url 格式无效");
  const padded = `${normalized}${"=".repeat((4 - normalized.length % 4) % 4)}`.replace(/-/g, "+").replace(/_/g, "/");
  return base64ToBytes(padded);
}

export function getCryptoRandomValues(bytes) {
  const cryptoApi = typeof globalThis !== "undefined" ? globalThis.crypto : null;
  if (!cryptoApi || typeof cryptoApi.getRandomValues !== "function") {
    throw new Error("当前运行环境未提供安全随机数，无法创建安装 ID");
  }
  return cryptoApi.getRandomValues(bytes);
}

export function generateInstallationId(randomValues = getCryptoRandomValues) {
  const bytes = new Uint8Array(32);
  randomValues(bytes);
  return base64UrlEncode(bytes);
}

export function isValidInstallationId(value) {
  try {
    return base64UrlDecode(value).length === 32;
  } catch (_) {
    return false;
  }
}

export function ensureInstallationId(storage, options = {}) {
  if (!storage || typeof storage.getItem !== "function" || typeof storage.setItem !== "function") {
    throw new Error("授权存储不可用");
  }
  const existing = String(storage.getItem(INSTALLATION_ID_STORAGE_KEY) || "").trim();
  if (isValidInstallationId(existing)) return existing;
  const installationId = generateInstallationId(options.randomValues || getCryptoRandomValues);
  storage.setItem(INSTALLATION_ID_STORAGE_KEY, installationId);
  return installationId;
}

function encodeCrockford(bytes, characters) {
  let bits = "";
  for (const byte of bytes) bits += byte.toString(2).padStart(8, "0");
  let output = "";
  for (let index = 0; index < bits.length && output.length < characters; index += 5) {
    const chunk = bits.slice(index, index + 5).padEnd(5, "0");
    output += CROCKFORD_BASE32[parseInt(chunk, 2)];
  }
  return output.padEnd(characters, "A");
}

export function deriveDeviceCode(installationId) {
  if (!isValidInstallationId(installationId)) throw new Error("安装 ID 无效");
  const digest = nacl.hash(encodeUtf8(`PixelRunner/device-code/v1:${installationId}`));
  const body = encodeCrockford(digest, 20);
  return `PR2-${body.slice(0, 4)}-${body.slice(4, 8)}-${body.slice(8, 12)}-${body.slice(12, 16)}-${body.slice(16, 20)}`;
}

export function deriveDeviceCodeHash(deviceCode) {
  const normalized = String(deviceCode || "").trim().toUpperCase();
  if (!/^PR2-(?:[A-Z2-9]{4}-){4}[A-Z2-9]{4}$/.test(normalized)) {
    throw new Error("设备代码格式无效");
  }
  return base64UrlEncode(nacl.hash(encodeUtf8(`PixelRunner/device-code-hash/v1:${normalized}`)));
}

function normalizeFeatures(features) {
  if (!Array.isArray(features) || !features.length) return null;
  const normalized = features.map((feature) => String(feature || "").trim());
  if (normalized.some((feature) => !FEATURE_IDS.has(feature))) return null;
  const sorted = [...new Set(normalized)].sort();
  if (sorted.length !== normalized.length || sorted.some((feature, index) => feature !== normalized[index])) return null;
  return sorted;
}

function isIsoTimestamp(value) {
  return typeof value === "string" && value.length >= 20 && Number.isFinite(Date.parse(value));
}

export function normalizeLicensePayload(payload, options = {}) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const keys = Object.keys(payload);
  if (keys.length !== PAYLOAD_FIELDS.length || PAYLOAD_FIELDS.some((key, index) => keys[index] !== key)) return null;
  const features = normalizeFeatures(payload.features);
  const productId = String(payload.productId || "").trim();
  const licenseId = String(payload.licenseId || "").trim();
  const deviceCodeHash = String(payload.deviceCodeHash || "").trim();
  const keyId = String(payload.keyId || "").trim();
  if (
    Number(payload.schemaVersion) !== LICENSE_SCHEMA_VERSION ||
    !productId ||
    !licenseId ||
    licenseId.length > 160 ||
    !features ||
    !isIsoTimestamp(payload.issuedAt) ||
    payload.permanent !== true ||
    !keyId
  ) return null;
  try {
    if (base64UrlDecode(deviceCodeHash).length !== 64) return null;
  } catch (_) {
    return null;
  }
  if (options.productId && productId !== options.productId) return { productMismatch: true, productId };
  return {
    schemaVersion: LICENSE_SCHEMA_VERSION,
    productId,
    licenseId,
    deviceCodeHash,
    features,
    issuedAt: new Date(payload.issuedAt).toISOString(),
    permanent: true,
    keyId
  };
}

export function canonicalizeLicensePayload(payload) {
  const normalized = normalizeLicensePayload(payload);
  if (!normalized || normalized.productMismatch) throw new Error("许可证字段无效");
  return JSON.stringify(normalized);
}

export function createLicensePayload({
  productId = LICENSE_PRODUCT_ID,
  licenseId,
  deviceCodeHash,
  features,
  issuedAt,
  keyId
}) {
  const payload = {
    schemaVersion: LICENSE_SCHEMA_VERSION,
    productId: String(productId || "").trim(),
    licenseId: String(licenseId || "").trim(),
    deviceCodeHash: String(deviceCodeHash || "").trim(),
    features: Array.isArray(features) ? features.map((feature) => String(feature || "").trim()).sort() : [],
    issuedAt: String(issuedAt || "").trim(),
    permanent: true,
    keyId: String(keyId || "").trim()
  };
  canonicalizeLicensePayload(payload);
  return payload;
}

export function createActivationCode(payload, signature) {
  const signatureBytes = signature instanceof Uint8Array ? signature : new Uint8Array(signature || []);
  if (signatureBytes.length !== nacl.sign.signatureLength) throw new Error("Ed25519 签名长度无效");
  return `${LICENSE_PREFIX}.${base64UrlEncode(encodeUtf8(canonicalizeLicensePayload(payload)))}.${base64UrlEncode(signatureBytes)}`;
}

export function parseActivationCode(code) {
  const compact = String(code || "").replace(/\s+/g, "");
  const parts = compact.split(".");
  if (parts.length !== 3 || parts[0] !== LICENSE_PREFIX) return { ok: false, reason: "FORMAT_INVALID" };
  try {
    const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(parts[1])));
    const signature = base64UrlDecode(parts[2]);
    if (signature.length !== nacl.sign.signatureLength) return { ok: false, reason: "SIGNATURE_INVALID" };
    const normalized = normalizeLicensePayload(payload);
    if (!normalized || normalized.productMismatch) return { ok: false, reason: "SCHEMA_INVALID" };
    return { ok: true, payload: normalized, signature, compact };
  } catch (_) {
    return { ok: false, reason: "FORMAT_INVALID" };
  }
}

function licenseFailure(reason) {
  return { active: false, reason, license: null };
}

export function verifyActivationCode(code, { deviceCode, keyring, productId = LICENSE_PRODUCT_ID } = {}) {
  const parsed = parseActivationCode(code);
  if (!parsed.ok) return licenseFailure(parsed.reason);
  const payload = parsed.payload;
  if (payload.schemaVersion !== LICENSE_SCHEMA_VERSION) return licenseFailure("SCHEMA_INVALID");
  if (payload.productId !== productId) return licenseFailure("PRODUCT_MISMATCH");
  const keyText = keyring && keyring[payload.keyId];
  if (!keyText) return licenseFailure("KEY_UNKNOWN");
  let publicKey;
  try {
    publicKey = base64UrlDecode(keyText);
  } catch (_) {
    return licenseFailure("KEY_UNKNOWN");
  }
  if (publicKey.length !== nacl.sign.publicKeyLength) return licenseFailure("KEY_UNKNOWN");
  let expectedHash;
  try {
    expectedHash = deriveDeviceCodeHash(deviceCode);
  } catch (_) {
    return licenseFailure("DEVICE_INVALID");
  }
  if (payload.deviceCodeHash !== expectedHash) return licenseFailure("DEVICE_MISMATCH");
  const valid = nacl.sign.detached.verify(encodeUtf8(canonicalizeLicensePayload(payload)), parsed.signature, publicKey);
  if (!valid) return licenseFailure("SIGNATURE_INVALID");
  return {
    active: true,
    reason: "ACTIVE",
    license: {
      ...payload,
      signature: base64UrlEncode(parsed.signature),
      activationCode: parsed.compact
    }
  };
}

export function isFeatureUnlocked(verification, feature) {
  return Boolean(
    verification &&
    verification.active &&
    verification.license &&
    Array.isArray(verification.license.features) &&
    verification.license.features.includes(feature)
  );
}
