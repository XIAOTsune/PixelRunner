import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import nacl from "tweetnacl";
import {
  base64UrlEncode,
  canonicalizeLicensePayload,
  createActivationCode,
  createLicensePayload,
  deriveDeviceCode,
  deriveDeviceCodeHash,
  verifyActivationCode
} from "../src/shared/license-core.js";
import { decodeUnencryptedPkcs8Pem, extractEd25519SeedFromPkcs8 } from "../src/shared/license-private-key.js";

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const privateDer = privateKey.export({ format: "der", type: "pkcs8" });
const seed = extractEd25519SeedFromPkcs8(privateDer);
const browserKeyPair = nacl.sign.keyPair.fromSeed(seed);
const publicJwk = publicKey.export({ format: "jwk" });

assert.equal(base64UrlEncode(browserKeyPair.publicKey), publicJwk.x, "browser importer derives the matching Ed25519 public key");
const pem = privateKey.export({ format: "pem", type: "pkcs8" });
assert.deepEqual(decodeUnencryptedPkcs8Pem(pem), new Uint8Array(privateDer), "browser importer accepts generator PKCS#8 PEM");
assert.throws(() => decodeUnencryptedPkcs8Pem("-----BEGIN ENCRYPTED PRIVATE KEY-----\ninvalid\n-----END ENCRYPTED PRIVATE KEY-----"));

const installationId = base64UrlEncode(new Uint8Array(32).fill(21));
const deviceCode = deriveDeviceCode(installationId);
const payload = createLicensePayload({
  licenseId: "PR-ISSUER-TEST-0001",
  deviceCodeHash: deriveDeviceCodeHash(deviceCode),
  features: ["blendMatch", "glow", "localUpscale", "postFx", "spaceFx"],
  issuedAt: "2026-07-28T00:00:00.000Z",
  keyId: "issuer-test"
});
const browserSignature = nacl.sign.detached(new TextEncoder().encode(canonicalizeLicensePayload(payload)), browserKeyPair.secretKey);
const activationCode = createActivationCode(payload, browserSignature);
const verification = verifyActivationCode(activationCode, { deviceCode, keyring: { "issuer-test": publicJwk.x } });
assert.equal(verification.active, true, "offline browser signature verifies in the plugin license core");

const nodeSignature = sign(null, Buffer.from(canonicalizeLicensePayload(payload), "utf8"), privateKey);
assert.equal(createActivationCode(payload, nodeSignature), activationCode, "browser and Node signing produce the same deterministic Ed25519 activation code");

seed.fill(0);
browserKeyPair.secretKey.fill(0);
console.log("Offline license issuer tests passed.");
