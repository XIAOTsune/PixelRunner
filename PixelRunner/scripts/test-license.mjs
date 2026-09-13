import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import {
  ACTIVATION_STORAGE_KEY,
  INSTALLATION_ID_STORAGE_KEY,
  LICENSE_PREFIX,
  LICENSE_PRODUCT_ID,
  base64UrlEncode,
  canonicalizeLicensePayload,
  createActivationCode,
  createLicensePayload,
  deriveDeviceCode,
  deriveDeviceCodeHash,
  ensureInstallationId,
  isFeatureUnlocked,
  verifyActivationCode
} from "../src/shared/license-core.js";
import { LicenseFeatureError, createHostLicenseEnforcer, getRequiredLicenseFeature } from "../src/host/license-enforcement.js";

class MemoryStorage {
  constructor(values = {}) {
    this.values = new Map(Object.entries(values));
  }

  getItem(key) {
    return this.values.has(key) ? this.values.get(key) : null;
  }

  setItem(key, value) {
    this.values.set(key, String(value));
  }
}

const fixedRandomValues = (bytes) => {
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = (index * 19 + 7) & 255;
  return bytes;
};

// Test signing keys exist only in this process. No private key is checked in,
// written to a fixture, emitted to stdout, or reused by the product.
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const publicJwk = publicKey.export({ format: "jwk" });
const testKeyring = Object.freeze({ "test-2026": publicJwk.x });
const issuedAt = "2026-07-28T00:00:00.000Z";

function issueLicense({
  deviceCode,
  features = ["blendMatch", "glow", "localUpscale", "postFx", "spaceFx"],
  productId = LICENSE_PRODUCT_ID,
  keyId = "test-2026",
  licenseId = "PR-TEST-0001"
}) {
  const payload = createLicensePayload({
    productId,
    licenseId,
    deviceCodeHash: deriveDeviceCodeHash(deviceCode),
    features,
    issuedAt,
    keyId
  });
  const signature = sign(null, Buffer.from(canonicalizeLicensePayload(payload), "utf8"), privateKey);
  return createActivationCode(payload, signature);
}

const installationStorage = new MemoryStorage();
const firstInstallationId = ensureInstallationId(installationStorage, { randomValues: fixedRandomValues });
const secondInstallationId = ensureInstallationId(installationStorage, { randomValues: () => { throw new Error("must reuse stored ID"); } });
assert.equal(firstInstallationId, secondInstallationId, "installation ID persists after the first run");
assert.equal(installationStorage.getItem(INSTALLATION_ID_STORAGE_KEY), firstInstallationId);

const deviceCode = deriveDeviceCode(firstInstallationId);
assert.equal(deviceCode, deriveDeviceCode(firstInstallationId), "device code is stable for one installation ID");
assert.match(deviceCode, /^PR2-(?:[A-Z2-9]{4}-){4}[A-Z2-9]{4}$/);

const validCode = issueLicense({ deviceCode });
const validVerification = verifyActivationCode(validCode, { deviceCode, keyring: testKeyring });
assert.equal(validVerification.active, true, "valid Ed25519 license verifies locally");
assert.deepEqual(validVerification.license.features, ["blendMatch", "glow", "localUpscale", "postFx", "spaceFx"]);
assert.equal(isFeatureUnlocked(validVerification, "glow"), true);
assert.equal(isFeatureUnlocked(validVerification, "postFx"), true, "explicit postFx entitlement remains supported");

const textEncoderDescriptor = Object.getOwnPropertyDescriptor(globalThis, "TextEncoder");
const textDecoderDescriptor = Object.getOwnPropertyDescriptor(globalThis, "TextDecoder");
try {
  Object.defineProperty(globalThis, "TextEncoder", { configurable: true, value: undefined });
  Object.defineProperty(globalThis, "TextDecoder", { configurable: true, value: undefined });
  const hostCompatibleCode = issueLicense({ deviceCode, licenseId: "PR-UXP-兼容-2026" });
  const hostCompatibleVerification = verifyActivationCode(hostCompatibleCode, { deviceCode, keyring: testKeyring });
  assert.equal(hostCompatibleVerification.active, true, "UXP Host verifies licenses without TextEncoder or TextDecoder");
  assert.equal(hostCompatibleVerification.license.licenseId, "PR-UXP-兼容-2026", "manual UTF-8 codec preserves Unicode payloads");
} finally {
  if (textEncoderDescriptor) Object.defineProperty(globalThis, "TextEncoder", textEncoderDescriptor);
  else delete globalThis.TextEncoder;
  if (textDecoderDescriptor) Object.defineProperty(globalThis, "TextDecoder", textDecoderDescriptor);
  else delete globalThis.TextDecoder;
}

const splitValid = validCode.split(".");
const tamperedCode = `${splitValid[0]}.${splitValid[1]}.${splitValid[2].replace(/^./, splitValid[2][0] === "A" ? "B" : "A")}`;
assert.equal(verifyActivationCode(tamperedCode, { deviceCode, keyring: testKeyring }).reason, "SIGNATURE_INVALID", "tampering is rejected");

const invalidSchemaPayload = {
  schemaVersion: 99,
  productId: LICENSE_PRODUCT_ID,
  licenseId: "PR-TEST-BAD-SCHEMA",
  deviceCodeHash: deriveDeviceCodeHash(deviceCode),
  features: ["blendMatch", "glow", "localUpscale", "postFx", "spaceFx"],
  issuedAt,
  permanent: true,
  keyId: "test-2026"
};
const invalidSchemaCode = `${LICENSE_PREFIX}.${base64UrlEncode(new TextEncoder().encode(JSON.stringify(invalidSchemaPayload)))}.${splitValid[2]}`;
assert.equal(verifyActivationCode(invalidSchemaCode, { deviceCode, keyring: testKeyring }).reason, "SCHEMA_INVALID", "invalid schema is rejected");

const anotherInstallationId = base64UrlEncode(new Uint8Array(32).fill(99));
const otherDeviceCode = deriveDeviceCode(anotherInstallationId);
const otherDeviceLicense = issueLicense({ deviceCode: otherDeviceCode, licenseId: "PR-TEST-OTHER-DEVICE" });
assert.equal(verifyActivationCode(otherDeviceLicense, { deviceCode, keyring: testKeyring }).reason, "DEVICE_MISMATCH", "other device license is rejected");

const wrongProductLicense = issueLicense({ deviceCode, productId: "com.example.other", licenseId: "PR-TEST-WRONG-PRODUCT" });
assert.equal(verifyActivationCode(wrongProductLicense, { deviceCode, keyring: testKeyring }).reason, "PRODUCT_MISMATCH", "other product license is rejected");

const unknownKeyLicense = issueLicense({ deviceCode, keyId: "retired-key", licenseId: "PR-TEST-UNKNOWN-KEY" });
assert.equal(verifyActivationCode(unknownKeyLicense, { deviceCode, keyring: testKeyring }).reason, "KEY_UNKNOWN", "unknown key ID is rejected");

const glowOnlyLicense = issueLicense({ deviceCode, features: ["glow"], licenseId: "PR-TEST-GLOW-ONLY" });
const glowOnlyVerification = verifyActivationCode(glowOnlyLicense, { deviceCode, keyring: testKeyring });
assert.equal(glowOnlyVerification.active, true);
assert.equal(isFeatureUnlocked(glowOnlyVerification, "postFx"), true, "legacy glow license unlocks shared lens and post FX");
assert.equal(isFeatureUnlocked(glowOnlyVerification, "localUpscale"), false, "missing feature stays locked");

const hostStorage = new MemoryStorage({ [INSTALLATION_ID_STORAGE_KEY]: firstInstallationId });
const hostEnforcer = createHostLicenseEnforcer({ storage: hostStorage, keyring: testKeyring, randomValues: fixedRandomValues });
const protectedRequests = [
  { feature: "glow", counter: "glow", request: { method: "photoshop.captureLicensedGlowPreview", args: [{}] } },
  { feature: "spaceFx", counter: "spaceFx", request: { method: "photoshop.captureLicensedSpaceFxPreview", args: [{}] } },
  { feature: "spaceFx", counter: "spaceFxSource", request: { method: "photoshop.captureLicensedSpaceFxSource", args: [{}] } },
  { feature: "postFx", counter: "postFxPreview", request: { method: "photoshop.captureLicensedPostFxPreview", args: [{}] } },
  { feature: "postFx", counter: "postFxSource", request: { method: "photoshop.captureLicensedPostFxSource", args: [{}] } },
  { feature: "postFx", counter: "postFxPlacement", request: { method: "photoshop.placeLicensedPostFxResult", args: [{}] } },
  { feature: "blendMatch", counter: "blendMatchAnalysis", request: { method: "photoshop.runToolAction", args: [{ action: "blendMatchPreviewSamples" }] } },
  { feature: "localUpscale", counter: "localUpscaleRequest", request: { method: "localUpscale.startEngine", args: [] } }
];
assert.equal(
  getRequiredLicenseFeature({ method: "photoshop.placeResultWithGenerativeFillColorCorrection", args: [{}] }),
  "",
  "generative-fill color correction placement is intentionally available without blend-match authorization"
);
assert.equal(
  getRequiredLicenseFeature({ method: "photoshop.placeResultWithBlendMatch", args: [{}] }),
  "blendMatch",
  "regular blend-match placement remains protected"
);
hostStorage.setItem(ACTIVATION_STORAGE_KEY, glowOnlyLicense);
for (const request of protectedRequests.slice(3, 6)) {
  hostEnforcer.assertBridgeRequest(request.request);
}
hostStorage.setItem(ACTIVATION_STORAGE_KEY, "");
const executionCounters = { glow: 0, spaceFx: 0, spaceFxSource: 0, postFxPreview: 0, postFxSource: 0, postFxPlacement: 0, blendMatchAnalysis: 0, localUpscaleRequest: 0 };
function invokeProtectedTask(item) {
  hostEnforcer.assertBridgeRequest(item.request);
  executionCounters[item.counter] += 1;
}
for (const item of protectedRequests) {
  assert.throws(
    () => invokeProtectedTask(item),
    (error) => error instanceof LicenseFeatureError && error.feature === item.feature,
    `Host blocks ${item.feature} before its task starts`
  );
}
assert.equal(executionCounters.blendMatchAnalysis, 0, "unlicensed blend-match analysis does not run");
assert.equal(executionCounters.localUpscaleRequest, 0, "unlicensed local-upscale request does not run");

hostStorage.setItem(ACTIVATION_STORAGE_KEY, validCode);
for (const item of protectedRequests) {
  invokeProtectedTask(item);
}
assert.equal(executionCounters.glow, 1, "authorized glow enters its original Host path");
assert.equal(executionCounters.spaceFx, 1, "authorized space FX enters its original Host path");
assert.equal(executionCounters.spaceFxSource, 1, "authorized full-resolution space FX capture enters its Host path");
assert.equal(executionCounters.postFxPreview, 1, "authorized post FX preview enters its Host path");
assert.equal(executionCounters.postFxSource, 1, "authorized full-resolution post FX capture enters its Host path");
assert.equal(executionCounters.postFxPlacement, 1, "authorized post FX placement enters its Host path");
assert.equal(executionCounters.blendMatchAnalysis, 1, "authorized blend-match enters its original Host path");
assert.equal(executionCounters.localUpscaleRequest, 1, "authorized local-upscale enters its original Host path");

hostStorage.setItem(ACTIVATION_STORAGE_KEY, "");
assert.equal(hostStorage.getItem(ACTIVATION_STORAGE_KEY), "", "removing local authorization clears the saved activation code");
assert.throws(() => hostEnforcer.assertBridgeRequest(protectedRequests[0].request), LicenseFeatureError, "removed authorization locks features again");

console.log("Offline license tests passed. WebGL2 integration remains an optional stable skip in test-blend-match when Node has no WebGL2 context.");
