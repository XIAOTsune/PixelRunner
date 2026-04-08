import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
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
      "index.html",
      "app.html",
      "sound-player.html",
      "style.css",
      "app.css",
      "dist",
      "icons",
      "pages",
      "video"
    ]
  };
}

function buildReadme(version, packageDirName, entries, channel) {
  const fileList = entries.map((entry) => `- ${entry}`).join("\n");
  const packageLabel = channel === "release" ? "Release" : "Test";
  return `# PixelRunner ${packageLabel} Package

Version: ${version}
Folder: ${packageDirName}

This package contains only the runtime files required by the Photoshop UXP plugin shell and the bundled WebView UI.

Included:
${fileList}

Not included:
- docs/
- legacy/
- scripts/
- src/
- node_modules/
- package.json
- package-lock.json

Why:
- The plugin runtime loads \`index.html\` as the panel entry.
- \`index.html\` and \`app.html\` both load bundled files from \`dist/\`.
- Icons and \`manifest.json\` are required for UXP installation and display.
`;
}

async function main() {
  const version = await readManifestVersion();
  const channel = getBuildChannel();
  const { packageDirName, entries } = getIncludedEntries(version, channel);
  const packageDir = path.join(releaseRoot, packageDirName);
  const readmeFileName = channel === "release" ? "README-RELEASE-PACKAGE.txt" : "README-TEST-PACKAGE.txt";

  await mkdir(releaseRoot, { recursive: true });
  await rm(packageDir, { recursive: true, force: true });
  await mkdir(packageDir, { recursive: true });

  for (const entry of entries) {
    const sourcePath = path.join(rootDir, entry);
    const targetPath = path.join(packageDir, entry);
    await cp(sourcePath, targetPath, { recursive: true });
  }

  await writeFile(
    path.join(packageDir, readmeFileName),
    buildReadme(version, packageDirName, entries, channel),
    "utf8"
  );

  console.log(`PixelRunner ${channel} package created at: ${packageDir}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
