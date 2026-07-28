import { readFile } from "node:fs/promises";
import { createPrivateKey, sign } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  LICENSE_FEATURES,
  LICENSE_PRODUCT_ID,
  canonicalizeLicensePayload,
  createActivationCode,
  createLicensePayload,
  deriveDeviceCodeHash
} from "../src/shared/license-core.js";

const __filename = fileURLToPath(import.meta.url);
const rootDir = path.resolve(path.dirname(__filename), "..");

function readArg(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 ? String(process.argv[index + 1] || "").trim() : fallback;
}

function assertOutsideRepository(filePath) {
  const relative = path.relative(rootDir, filePath);
  if (!relative || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
    throw new Error("拒绝从项目目录读取私钥。请使用仓库外的绝对路径或环境变量。");
  }
}

async function readPrivateKeyPem() {
  const envKey = String(process.env.PIXELRUNNER_LICENSE_PRIVATE_KEY_PEM || "").trim();
  if (envKey) return envKey.replace(/\\n/g, "\n");
  const requestedPath = readArg("--private-key-file");
  if (!requestedPath || !path.isAbsolute(requestedPath)) {
    throw new Error("必须通过 PIXELRUNNER_LICENSE_PRIVATE_KEY_PEM 或 --private-key-file <仓库外绝对路径> 提供私钥。");
  }
  const privateKeyPath = path.resolve(requestedPath);
  assertOutsideRepository(privateKeyPath);
  return readFile(privateKeyPath, "utf8");
}

function parseFeatures(value) {
  const features = String(value || "").split(",").map((item) => item.trim()).filter(Boolean).sort();
  if (!features.length || features.some((feature) => !Object.prototype.hasOwnProperty.call(LICENSE_FEATURES, feature))) {
    throw new Error(`--features 必须是以下项的逗号分隔列表：${Object.keys(LICENSE_FEATURES).join(", ")}`);
  }
  if (new Set(features).size !== features.length) throw new Error("--features 不可重复");
  return features;
}

async function main() {
  const deviceCode = readArg("--device-code").toUpperCase();
  const licenseId = readArg("--license-id");
  const keyId = readArg("--key-id");
  const issuedAt = readArg("--issued-at", new Date().toISOString());
  if (!deviceCode || !licenseId || !keyId) {
    throw new Error("需要 --device-code、--license-id 和 --key-id。");
  }
  const payload = createLicensePayload({
    productId: LICENSE_PRODUCT_ID,
    licenseId,
    deviceCodeHash: deriveDeviceCodeHash(deviceCode),
    features: parseFeatures(readArg("--features")),
    issuedAt,
    keyId
  });
  const privateKey = createPrivateKey(await readPrivateKeyPem());
  if (privateKey.asymmetricKeyType !== "ed25519") throw new Error("私钥必须是 Ed25519 PKCS#8 PEM。");
  const signature = sign(null, Buffer.from(canonicalizeLicensePayload(payload), "utf8"), privateKey);
  console.log(createActivationCode(payload, signature));
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
