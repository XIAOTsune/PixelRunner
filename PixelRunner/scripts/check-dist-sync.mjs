import { build } from "esbuild";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

const sharedOptions = {
  bundle: true,
  sourcemap: true,
  charset: "utf8",
  target: ["chrome114"],
  logLevel: "silent"
};

function normalizeBundleText(text) {
  return text.replace(/\r\n/g, "\n");
}

async function readNormalized(filePath) {
  return normalizeBundleText(await readFile(filePath, "utf8"));
}

async function assertBundleMatches({ name, entryPoint, outfile, buildOptions }) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pixelrunner-dist-sync-"));
  const tempOutfile = path.join(tempDir, path.basename(outfile));

  try {
    await build({
      ...sharedOptions,
      ...buildOptions,
      entryPoints: [entryPoint],
      outfile: tempOutfile
    });

    const currentText = await readNormalized(outfile);
    const generatedText = await readNormalized(tempOutfile);

    if (currentText !== generatedText) {
      throw new Error(
        `${name} is out of sync. Update source files under src/ and run npm run build before packaging.`
      );
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function main() {
  await assertBundleMatches({
    name: "dist/app.bundle.js",
    entryPoint: path.join(rootDir, "src", "webview-entry.js"),
    outfile: path.join(rootDir, "dist", "app.bundle.js"),
    buildOptions: {
      format: "iife",
      globalName: "PixelRunnerWebviewBundle"
    }
  });

  await assertBundleMatches({
    name: "dist/host.bundle.js",
    entryPoint: path.join(rootDir, "src", "host-entry.js"),
    outfile: path.join(rootDir, "dist", "host.bundle.js"),
    buildOptions: {
      format: "iife",
      globalName: "PixelRunnerHostBundle",
      platform: "browser",
      external: ["photoshop", "uxp"]
    }
  });

  console.log("PixelRunner dist bundles are in sync with src.");
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
