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

function getIncludedEntries(version) {
  return {
    packageDirName: `PixelRunnerV${version}-test`,
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

function buildReadme(version, packageDirName, entries) {
  const fileList = entries.map((entry) => `- ${entry}`).join("\n");
  return `# PixelRunner Test Package

Version: ${version}
Folder: ${packageDirName}

This test package contains only the runtime files required by the Photoshop UXP plugin shell and the bundled WebView UI.

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
  const { packageDirName, entries } = getIncludedEntries(version);
  const packageDir = path.join(releaseRoot, packageDirName);

  await mkdir(releaseRoot, { recursive: true });
  await rm(packageDir, { recursive: true, force: true });
  await mkdir(packageDir, { recursive: true });

  for (const entry of entries) {
    const sourcePath = path.join(rootDir, entry);
    const targetPath = path.join(packageDir, entry);
    await cp(sourcePath, targetPath, { recursive: true });
  }

  await writeFile(
    path.join(packageDir, "README-TEST-PACKAGE.txt"),
    buildReadme(version, packageDirName, entries),
    "utf8"
  );

  console.log(`PixelRunner test package created at: ${packageDir}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
