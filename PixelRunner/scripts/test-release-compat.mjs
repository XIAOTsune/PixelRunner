import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(await readFile(path.join(rootDir, "manifest.json"), "utf8"));
const networkDomains = manifest.requiredPermissions.network.domains;
const webviewDomains = manifest.requiredPermissions.webview.domains;

assert.ok(Array.isArray(networkDomains), "release compatibility requires an explicit network domain list");
assert.deepEqual([...networkDomains].sort(), [...webviewDomains].sort(), "network and WebView domain allowlists must stay aligned");
for (let port = 17836; port <= 17845; port += 1) {
  assert.ok(networkDomains.includes(`http://127.0.0.1:${port}`), `local upscale loopback port ${port} remains allowed`);
  assert.ok(networkDomains.includes(`http://localhost:${port}`), `local upscale localhost port ${port} remains allowed`);
}
assert.ok(manifest.requiredPermissions.launchProcess.extensions.includes(".vbs"), "Windows Local AI launcher remains allowed");
assert.ok(!manifest.requiredPermissions.launchProcess.extensions.includes(".app"), "Windows-only release must not request an unavailable macOS companion");

const tempDir = await mkdtemp(path.join(os.tmpdir(), "pixelrunner-release-compat-"));
const outputDir = path.join(tempDir, "dist");

try {
  await execFileAsync(process.execPath, [
    path.join(rootDir, "scripts", "build.mjs"),
    "--release",
    "--outdir",
    outputDir
  ], { cwd: rootDir });

  for (const bundleName of ["host.bundle.js", "app.bundle.js"]) {
    const bundlePath = path.join(outputDir, bundleName);
    const bundle = await readFile(bundlePath, "utf8");
    assert.ok(bundle.length > 0, `${bundleName} is generated`);
    assert.doesNotMatch(bundle, /\b_0x[\da-f]+\b/i, `${bundleName} is not obfuscated in the compatibility release`);
    await execFileAsync(process.execPath, ["--check", bundlePath]);
  }
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

console.log("Release compatibility checks passed.");
