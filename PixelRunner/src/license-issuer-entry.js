import nacl from "tweetnacl";
import {
  LICENSE_FEATURES,
  base64UrlEncode,
  canonicalizeLicensePayload,
  createActivationCode,
  createLicensePayload,
  deriveDeviceCodeHash
} from "./shared/license-core.js";
import { LICENSE_PUBLIC_KEYS } from "./shared/license-public-keys.js";
import { decodeUnencryptedPkcs8Pem, extractEd25519SeedFromPkcs8 } from "./shared/license-private-key.js";

(function initializeLicenseIssuer(global) {
  const state = {
    secretKey: null,
    keyId: ""
  };

  const getById = (id) => document.getElementById(id);

  function setStatus(message, kind = "info") {
    const status = getById("issuerStatus");
    if (!status) return;
    status.textContent = message;
    status.dataset.kind = kind;
  }

  function formatLocalDateTime(date = new Date()) {
    const pad = (value) => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function createLicenseId() {
    const bytes = new Uint8Array(4);
    if (!global.crypto || typeof global.crypto.getRandomValues !== "function") throw new Error("当前浏览器无法安全生成许可证编号");
    global.crypto.getRandomValues(bytes);
    const date = new Date();
    const compactDate = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
    return `PR-${compactDate}-${Array.from(bytes).map((value) => value.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
  }

  function selectedFeatures() {
    return Array.from(document.querySelectorAll("[data-issuer-feature]:checked"))
      .map((input) => String(input.getAttribute("data-issuer-feature") || ""))
      .sort();
  }

  function clearLoadedKey() {
    if (state.secretKey) state.secretKey.fill(0);
    state.secretKey = null;
    state.keyId = "";
    const keyFile = getById("issuerPrivateKey");
    const keyMeta = getById("issuerKeyMeta");
    if (keyFile) keyFile.value = "";
    if (keyMeta) keyMeta.textContent = "尚未加载签发私钥";
  }

  async function loadPrivateKey(file) {
    clearLoadedKey();
    if (!file) return;
    const keyId = String(getById("issuerKeyId")?.value || "");
    const expectedPublicKey = LICENSE_PUBLIC_KEYS[keyId];
    if (!expectedPublicKey) throw new Error("请选择受支持的 keyId");
    const pem = await file.text();
    const der = decodeUnencryptedPkcs8Pem(pem);
    const seed = extractEd25519SeedFromPkcs8(der);
    try {
      const keyPair = nacl.sign.keyPair.fromSeed(seed);
      const actualPublicKey = base64UrlEncode(keyPair.publicKey);
      if (actualPublicKey !== expectedPublicKey) {
        keyPair.secretKey.fill(0);
        throw new Error("所选私钥与当前 keyId 的内置公钥不匹配");
      }
      state.secretKey = keyPair.secretKey;
      state.keyId = keyId;
      const keyMeta = getById("issuerKeyMeta");
      if (keyMeta) keyMeta.textContent = `已加载：${file.name}`;
      setStatus("签发私钥已加载到当前页面内存。", "success");
    } finally {
      seed.fill(0);
      der.fill(0);
    }
  }

  function getIssuedAt() {
    const input = getById("issuerIssuedAt");
    const localValue = String(input?.value || "").trim();
    const issuedDate = localValue ? new Date(localValue) : new Date();
    if (!Number.isFinite(issuedDate.getTime())) throw new Error("签发时间无效");
    return issuedDate.toISOString();
  }

  function generateActivationCode() {
    if (!state.secretKey) throw new Error("请先选择与 keyId 匹配的私钥文件");
    const keyId = String(getById("issuerKeyId")?.value || "");
    if (keyId !== state.keyId) throw new Error("keyId 已变更，请重新加载对应私钥");
    const deviceCode = String(getById("issuerDeviceCode")?.value || "").trim().toUpperCase();
    const licenseId = String(getById("issuerLicenseId")?.value || "").trim();
    const features = selectedFeatures();
    const payload = createLicensePayload({
      licenseId,
      deviceCodeHash: deriveDeviceCodeHash(deviceCode),
      features,
      issuedAt: getIssuedAt(),
      keyId
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
      setStatus("激活码已复制。", "success");
    } catch (_) {
      setStatus("无法自动复制，请长按或手动选择激活码。", "warn");
    }
  }

  function bind() {
    const keySelect = getById("issuerKeyId");
    const keyFile = getById("issuerPrivateKey");
    const licenseId = getById("issuerLicenseId");
    const issuedAt = getById("issuerIssuedAt");
    const generateButton = getById("btnGenerateActivationCode");
    const copyButton = getById("btnCopyActivationCode");
    const clearButton = getById("btnClearIssuerKey");
    const output = getById("issuerActivationCode");

    Object.keys(LICENSE_PUBLIC_KEYS).forEach((keyId) => {
      const option = document.createElement("option");
      option.value = keyId;
      option.textContent = keyId;
      keySelect.appendChild(option);
    });
    licenseId.value = createLicenseId();
    issuedAt.value = formatLocalDateTime();

    keySelect.addEventListener("change", () => {
      clearLoadedKey();
      setStatus("keyId 已变更，请选择匹配的私钥文件。", "info");
    });
    keyFile.addEventListener("change", () => {
      void loadPrivateKey(keyFile.files && keyFile.files[0]).catch((error) => {
        clearLoadedKey();
        setStatus(error.message || "私钥加载失败。", "warn");
      });
    });
    generateButton.addEventListener("click", () => {
      try {
        output.value = generateActivationCode();
        setStatus("激活码已生成，可直接复制发送给用户。", "success");
      } catch (error) {
        setStatus(error.message || "生成激活码失败。", "warn");
      }
    });
    copyButton.addEventListener("click", () => void copyActivationCode());
    clearButton.addEventListener("click", () => {
      clearLoadedKey();
      setStatus("已清除当前页面内存中的签发私钥。", "info");
    });
    global.addEventListener("pagehide", clearLoadedKey, { once: true });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bind, { once: true });
  else bind();
})(window);
