import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tempDir = await mkdtemp(path.join(os.tmpdir(), "pixelrunner-release-hardened-"));
const outputDir = path.join(tempDir, "dist");

try {
  await execFileAsync(process.execPath, [
    path.join(rootDir, "scripts", "build.mjs"),
    "--release",
    "--obfuscate",
    "--outdir",
    outputDir
  ], { cwd: rootDir });

  const bundles = new Map();
  for (const bundleName of ["core.bundle.js", "host.bundle.js", "app.bundle.js"]) {
    const bundlePath = path.join(outputDir, bundleName);
    const bundle = await readFile(bundlePath, "utf8");
    assert.ok(bundle.length > 0, `${bundleName} is generated`);
    assert.doesNotMatch(bundle, /sourceMappingURL\s*=/i, `${bundleName} does not expose a source map`);
    await execFileAsync(process.execPath, ["--check", bundlePath]);
    bundles.set(bundleName, bundle);
  }

  assert.match(bundles.get("core.bundle.js"), /\b_0x[\da-f]+\b/i, "only the product core is obfuscated");
  assert.match(bundles.get("core.bundle.js"), /PixelRunnerCoreBundle/, "core loader global remains stable");
  assert.doesNotMatch(bundles.get("host.bundle.js"), /\b_0x[\da-f]+\b/i, "Host UXP bridge stays conventional");
  assert.doesNotMatch(bundles.get("app.bundle.js"), /\b_0x[\da-f]+\b/i, "WebView glue stays conventional");
  assert.equal((await readdir(outputDir)).filter((name) => name.endsWith(".map")).length, 0, "hardened release output has no source maps");
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

console.log("Hardened release bundle checks passed.");
