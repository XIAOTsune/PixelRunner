import { cp, mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const releaseRoot = path.join(rootDir, "release");

async function readManifestVersion() {
  const manifestPath = path.join(rootDir, "manifest.json");
  const manifestText = await readFile(manifestPath, "utf8");
  const manifest = JSON.parse(manifestText);
  return String(manifest.version || "0.0.0");
}

function getBuildChannel() {
  return process.argv.includes("--release") ? "release" : "test";
}

function getIncludedEntries(version, channel) {
  return {
    packageDirName: channel === "release" ? `PixelRunnerV${version}` : `PixelRunnerV${version}-test`,
    entries: [
      "manifest.json",
      "LICENSE",
      "index.html",
      "app.html",
      "sound-player.html",
      "style.css",
      "app.css",
      "dist",
      "icons",
      "assets",
      "pages",
      "video"
    ]
  };
}

async function main() {
  const version = await readManifestVersion();
  const channel = getBuildChannel();
  const { packageDirName, entries } = getIncludedEntries(version, channel);
  const packageDir = path.join(releaseRoot, packageDirName);
  const packageDocs = [
    "README.md",
    "README.txt",
    "README-RELEASE-PACKAGE.txt",
    "README-TEST-PACKAGE.txt"
  ];

  await mkdir(releaseRoot, { recursive: true });
  await rm(packageDir, { recursive: true, force: true });
  await mkdir(packageDir, { recursive: true });

  for (const entry of entries) {
    const sourcePath = path.join(rootDir, entry);
    const targetPath = path.join(packageDir, entry);
    await cp(sourcePath, targetPath, { recursive: true });
  }

  for (const docName of packageDocs) {
    await rm(path.join(packageDir, docName), { force: true });
    await rm(path.join(packageDir, "assets", "space-fx", docName), { force: true });
  }

  console.log(`PixelRunner ${channel} package created at: ${packageDir}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
