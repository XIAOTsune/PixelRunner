import nacl from "tweetnacl";
import {
  LICENSE_FEATURES,
  base64UrlEncode,
  canonicalizeLicensePayload,
  createActivationCode,
  createLicensePayload,
  deriveDeviceCodeHash
} from "./shared/license-core.js";
import { ACTIVE_LICENSE_KEY_ID, LICENSE_PUBLIC_KEYS } from "./shared/license-public-keys.js";
import { decodeUnencryptedPkcs8Pem, extractEd25519SeedFromPkcs8 } from "./shared/license-private-key.js";

// Replaced only while generating the personal signing HTML. This source file
// deliberately contains no private key material.
const EMBEDDED_PRIVATE_KEY_PEM_BASE64 = __PIXELRUNNER_ISSUER_PRIVATE_PEM_BASE64__;
const UNLOCKED_FEATURES = Object.freeze(Object.keys(LICENSE_FEATURES).sort());

(function initializePersonalLicenseIssuer(global) {
  const state = { secretKey: null };
  const getById = (id) => document.getElementById(id);

  function setStatus(message, kind = "info") {
    const status = getById("issuerStatus");
    if (!status) return;
    status.textContent = message;
    status.dataset.kind = kind;
  }

  function decodeEmbeddedPem() {
    const binary = global.atob(EMBEDDED_PRIVATE_KEY_PEM_BASE64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return new TextDecoder().decode(bytes);
  }

  function loadEmbeddedPrivateKey() {
    const expectedPublicKey = LICENSE_PUBLIC_KEYS[ACTIVE_LICENSE_KEY_ID];
    if (!expectedPublicKey) throw new Error("未配置可用的签发公钥");
    const pem = decodeEmbeddedPem();
    const der = decodeUnencryptedPkcs8Pem(pem);
    const seed = extractEd25519SeedFromPkcs8(der);
    try {
      const keyPair = nacl.sign.keyPair.fromSeed(seed);
      if (base64UrlEncode(keyPair.publicKey) !== expectedPublicKey) {
        keyPair.secretKey.fill(0);
        throw new Error("内置签发私钥与插件公钥不匹配");
      }
      state.secretKey = keyPair.secretKey;
    } finally {
      seed.fill(0);
      der.fill(0);
    }
  }

  function createLicenseId() {
    if (!global.crypto || typeof global.crypto.getRandomValues !== "function") {
      throw new Error("当前浏览器无法安全生成许可证编号");
    }
    const bytes = new Uint8Array(4);
    global.crypto.getRandomValues(bytes);
    const date = new Date();
    const compactDate = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
    const random = Array.from(bytes).map((value) => value.toString(16).padStart(2, "0")).join("").toUpperCase();
    return `PR-${compactDate}-${random}`;
  }

  function generateActivationCode() {
    if (!state.secretKey) throw new Error("签发密钥尚未准备好");
    const deviceCode = String(getById("issuerDeviceCode")?.value || "").trim().toUpperCase();
    const payload = createLicensePayload({
      licenseId: createLicenseId(),
      deviceCodeHash: deriveDeviceCodeHash(deviceCode),
      features: UNLOCKED_FEATURES,
      issuedAt: new Date().toISOString(),
      keyId: ACTIVE_LICENSE_KEY_ID
    });
    const signature = nacl.sign.detached(new TextEncoder().encode(canonicalizeLicensePayload(payload)), state.secretKey);
    return createActivationCode(payload, signature);
  }

  async function copyActivationCode() {
    const output = getById("issuerActivationCode");
    const value = String(output?.value || "").trim();
    if (!value) {
      setStatus("请先生成激活码。", "warn");
      return;
    }
    try {
      if (global.navigator?.clipboard?.writeText) await global.navigator.clipboard.writeText(value);
      else {
        output.focus();
        output.select();
        if (!document.execCommand("copy")) throw new Error("copy unavailable");
      }
      setStatus("激活码已复制，可直接发送给用户。", "success");
    } catch (_) {
      setStatus("无法自动复制，请长按或手动选择激活码。", "warn");
    }
  }

  function clearRuntimeKey() {
    if (state.secretKey) state.secretKey.fill(0);
    state.secretKey = null;
  }

  function bind() {
    const deviceCode = getById("issuerDeviceCode");
    const output = getById("issuerActivationCode");
    getById("btnGenerateActivationCode").addEventListener("click", () => {
      try {
        output.value = generateActivationCode();
      setStatus("激活码已生成。它已固定解锁镜头与后期、辉光、空间特效、对齐与校色和本地超分。", "success");
      } catch (error) {
        setStatus(error.message || "生成激活码失败，请检查设备代码。", "warn");
      }
    });
    getById("btnCopyActivationCode").addEventListener("click", () => void copyActivationCode());
    deviceCode.addEventListener("input", () => { output.value = ""; });
    global.addEventListener("pagehide", clearRuntimeKey, { once: true });
  }

  try {
    loadEmbeddedPrivateKey();
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bind, { once: true });
    else bind();
  } catch (error) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => setStatus(error.message || "签发工具初始化失败。", "warn"), { once: true });
    } else setStatus(error.message || "签发工具初始化失败。", "warn");
  }
})(window);
