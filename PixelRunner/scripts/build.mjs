import { build, context } from "esbuild";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const watchMode = process.argv.includes("--watch");
const releaseMode = process.argv.includes("--release");

function readArgValue(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  return process.argv[index + 1] || null;
}

const distDir = path.resolve(rootDir, readArgValue("--outdir") || "dist");

const sharedOptions = {
  bundle: true,
  sourcemap: !releaseMode,
  minify: releaseMode,
  charset: "utf8",
  target: ["chrome114"],
  logLevel: "info",
  legalComments: releaseMode ? "none" : "eof"
};

const webviewConfig = {
  ...sharedOptions,
  entryPoints: [path.join(rootDir, "src", "webview-entry.js")],
  outfile: path.join(distDir, "app.bundle.js"),
  format: "iife",
  globalName: "PixelRunnerWebviewBundle"
};

const hostConfig = {
  ...sharedOptions,
  entryPoints: [path.join(rootDir, "src", "host-entry.js")],
  outfile: path.join(distDir, "host.bundle.js"),
  format: "iife",
  globalName: "PixelRunnerHostBundle",
  platform: "browser",
  external: ["photoshop", "uxp"]
};

async function cleanBundleArtifacts() {
  await Promise.all([
    rm(path.join(distDir, "app.bundle.js"), { force: true }),
    rm(path.join(distDir, "app.bundle.js.map"), { force: true }),
    rm(path.join(distDir, "host.bundle.js"), { force: true }),
    rm(path.join(distDir, "host.bundle.js.map"), { force: true })
  ]);
}

async function runBuild() {
  await mkdir(distDir, { recursive: true });

  if (watchMode) {
    const webviewContext = await context(webviewConfig);
    const hostContext = await context(hostConfig);
    await webviewContext.watch();
    await hostContext.watch();
    console.log("Watching PixelRunner bundles...");
    return;
  }

  await cleanBundleArtifacts();
  await build(webviewConfig);
  await build(hostConfig);
  if (releaseMode) {
    // Obfuscation is a release-only friction layer. It does not encrypt code
    // and is intentionally kept out of development and hot runtime paths.
    const { obfuscateReleaseBundle } = await import("./release-obfuscation.mjs");
    await obfuscateReleaseBundle(webviewConfig.outfile, "webview");
    await obfuscateReleaseBundle(hostConfig.outfile, "host");
  }
  console.log(`PixelRunner ${releaseMode ? "release" : "development"} bundles built successfully.`);
}

runBuild().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
