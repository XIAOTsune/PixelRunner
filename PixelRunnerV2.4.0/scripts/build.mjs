import { build, context } from "esbuild";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const distDir = path.join(rootDir, "dist");
const watchMode = process.argv.includes("--watch");

const sharedOptions = {
  bundle: true,
  sourcemap: true,
  charset: "utf8",
  target: ["chrome114"],
  logLevel: "info"
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

  await build(webviewConfig);
  await build(hostConfig);
  console.log("PixelRunner bundles built successfully.");
}

runBuild().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
