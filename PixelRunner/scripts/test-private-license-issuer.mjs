import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { generateKeyPairSync } from "node:crypto";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tempDir = await mkdtemp(path.join(os.tmpdir(), "pixelrunner-private-issuer-"));
const privateKeyFile = path.join(tempDir, "test-ed25519-private.pem");
const outputFile = path.join(tempDir, "issuer.html");

try {
  const { privateKey } = generateKeyPairSync("ed25519");
  await writeFile(privateKeyFile, privateKey.export({ format: "pem", type: "pkcs8" }), { encoding: "utf8", mode: 0o600 });
  await execFileAsync(process.execPath, [
    path.join(rootDir, "scripts", "build-private-license-issuer.mjs"),
    "--private-key-file", privateKeyFile,
    "--out", outputFile
  ], { cwd: rootDir });

  const html = await readFile(outputFile, "utf8");
  assert.match(html, /id="issuerDeviceCode"/, "personal issuer keeps only the device-code input");
  assert.match(html, /id="btnGenerateActivationCode"/, "personal issuer includes generation control");
  assert.match(html, /id="btnCopyActivationCode"/, "personal issuer includes copy control");
  assert.doesNotMatch(html, /issuerPrivateKey|issuerLicenseId|issuerIssuedAt|issuerKeyId/, "personal issuer has no key or license metadata inputs");
  assert.doesNotMatch(html, /src="license-issuer\.bundle\.js"/, "personal issuer is self-contained");
  assert.doesNotMatch(html, /__PIXELRUNNER_ISSUER_(?:BUNDLE|PRIVATE_PEM_BASE64)__/, "all build placeholders are replaced");
} finally {
  await rm(tempDir, { force: true, recursive: true });
}

console.log("Personal offline license issuer build tests passed.");
