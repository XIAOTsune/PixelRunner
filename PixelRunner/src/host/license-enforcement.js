import {
  ACTIVATION_STORAGE_KEY,
  LICENSE_FEATURES,
  deriveDeviceCode,
  ensureInstallationId,
  isFeatureUnlocked,
  verifyActivationCode
} from "../shared/license-core.js";
import { LICENSE_PUBLIC_KEYS } from "../shared/license-public-keys.js";

const TOOL_ACTION_FEATURES = Object.freeze({
  glow: "glow",
  glowPreviewStart: "glow",
  glowPreviewUpdate: "glow",
  glowPreviewCommit: "glow",
  blendMatch: "blendMatch",
  blendMatchPreview: "blendMatch",
  blendMatchPreviewSamples: "blendMatch",
  blendMatchPreviewPlan: "blendMatch"
});

const METHOD_FEATURES = Object.freeze({
  "photoshop.captureLicensedGlowPreview": "glow",
  "photoshop.placeLicensedGlowResult": "glow",
  "photoshop.captureLicensedSpaceFxPreview": "spaceFx",
  "photoshop.captureLicensedSpaceFxSource": "spaceFx",
  "photoshop.placeLicensedSpaceFxResult": "spaceFx",
  "photoshop.captureLicensedPostFxPreview": "postFx",
  "photoshop.captureLicensedPostFxSource": "postFx",
  "photoshop.placeLicensedPostFxResult": "postFx",
  "photoshop.placeResultWithBlendMatch": "blendMatch",
  "localUpscale.getHealth": "localUpscale",
  "localUpscale.startEngine": "localUpscale",
  "localUpscale.submitJob": "localUpscale",
  "localUpscale.getJob": "localUpscale",
  "localUpscale.recordPlacement": "localUpscale",
  "photoshop.captureLocalUpscaleSource": "localUpscale",
  "photoshop.openLocalUpscaleResult": "localUpscale",
  "photoshop.placeLocalUpscaleResult": "localUpscale"
});

export function getRequiredLicenseFeature(message) {
  const method = String(message && message.method || "");
  if (method === "photoshop.runToolAction") {
    const payload = message && Array.isArray(message.args) ? message.args[0] : null;
    return TOOL_ACTION_FEATURES[String(payload && payload.action || "")] || "";
  }
  return METHOD_FEATURES[method] || "";
}

export class LicenseFeatureError extends Error {
  constructor(feature, reason) {
    super(`“${LICENSE_FEATURES[feature] || "该功能"}”需要此设备的有效授权。请复制设备代码后联系插件开发者小T。`);
    this.name = "LicenseFeatureError";
    this.code = "LICENSE_REQUIRED";
    this.feature = feature;
    this.reason = reason;
  }
}

export function createHostLicenseEnforcer({ storage, keyring = LICENSE_PUBLIC_KEYS, randomValues } = {}) {
  if (!storage || typeof storage.getItem !== "function" || typeof storage.setItem !== "function") {
    throw new Error("Host 授权存储不可用");
  }

  function getVerification() {
    const installationId = ensureInstallationId(storage, { randomValues });
    const deviceCode = deriveDeviceCode(installationId);
    return verifyActivationCode(storage.getItem(ACTIVATION_STORAGE_KEY), { deviceCode, keyring });
  }

  function requireFeature(feature) {
    const verification = getVerification();
    if (!isFeatureUnlocked(verification, feature)) {
      throw new LicenseFeatureError(feature, verification.reason);
    }
    return verification;
  }

  function assertBridgeRequest(message) {
    const feature = getRequiredLicenseFeature(message);
    return feature ? requireFeature(feature) : null;
  }

  return Object.freeze({ getVerification, requireFeature, assertBridgeRequest });
}
