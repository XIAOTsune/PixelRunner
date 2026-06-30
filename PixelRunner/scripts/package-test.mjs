import { spawn } from "node:child_process";
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
  const entries = [
    "manifest.json",
    "LICENSE",
    "index.html",
    "app.html",
    "sound-player.html",
    "style.css",
    "app.css",
    "icons",
    "assets",
    "pages",
    "video"
  ];

  if (channel !== "release") {
    entries.push("dist");
  }

  return {
    packageDirName: `PixelRunnerV${version}`,
    entries
  };
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd || rootDir,
      stdio: "inherit",
      windowsHide: true
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command} ${args.join(" ")} failed with exit code ${code}`));
    });
  });
}

async function buildReleaseDist(packageDir) {
  await runCommand(process.execPath, [
    path.join(rootDir, "scripts", "build.mjs"),
    "--release",
    "--outdir",
    path.join(packageDir, "dist")
  ]);
}

async function hardenReleasePackage(packageDir) {
  const indexPath = path.join(packageDir, "index.html");
  const indexText = await readFile(indexPath, "utf8");
  await writeFile(indexPath, indexText.replace(/\s+uxpAllowInspector="true"/g, ""), "utf8");
}

async function createReleaseZip(packageDirName) {
  const packageDir = path.join(releaseRoot, packageDirName);
  const zipPath = path.join(releaseRoot, `${packageDirName}.zip`);
  await rm(zipPath, { force: true });

  if (process.platform === "win32") {
    const tarPath = path.join(
      process.env.SystemRoot || "C:\\Windows",
      "System32",
      "tar.exe"
    );

    await runCommand(tarPath, ["-a", "-cf", zipPath, "-C", releaseRoot, packageDirName]);
  } else {
    await runCommand("zip", ["-r", zipPath, packageDirName], { cwd: releaseRoot });
  }

  console.log(`PixelRunner release zip created at: ${zipPath}`);
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

  if (channel === "release") {
    await buildReleaseDist(packageDir);
    await hardenReleasePackage(packageDir);
  }

  for (const docName of packageDocs) {
    await rm(path.join(packageDir, docName), { force: true });
    await rm(path.join(packageDir, "assets", "space-fx", docName), { force: true });
  }

  console.log(`PixelRunner ${channel} package created at: ${packageDir}`);

  if (channel === "release") {
    await createReleaseZip(packageDirName);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
