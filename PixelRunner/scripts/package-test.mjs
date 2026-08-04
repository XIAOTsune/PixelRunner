import { spawn } from "node:child_process";
import { access, cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
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
    "local-ai",
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

async function assertBundledLocalAiRuntime(packageDir) {
  const localAiDir = path.join(packageDir, "local-ai");
  const runtimeDir = path.join(localAiDir, "runtime");
  const modelsDir = path.join(localAiDir, "engine", "models");
  const runtimeManifest = JSON.parse(await readFile(path.join(localAiDir, "runtime.json"), "utf8"));
  if (runtimeManifest.runtime !== "CPython" || runtimeManifest.distribution !== "embeddable") {
    throw new Error("The packaged Local AI runtime manifest is invalid");
  }
  for (const name of ["python.exe", "pythonw.exe", "python312.dll", "python312.zip", "python312._pth", "LICENSE.txt"]) {
    const runtimeFile = path.join(runtimeDir, name);
    await access(runtimeFile);
    if ((await stat(runtimeFile)).size <= 0) throw new Error(`The packaged Local AI runtime file is empty: ${name}`);
  }
  const expectedModels = ["realesrgan-x4plus.bin", "realesrgan-x4plus.param"];
  const packagedModels = (await readdir(modelsDir))
    .filter((name) => /\.(?:bin|param)$/i.test(name))
    .sort();
  if (JSON.stringify(packagedModels) !== JSON.stringify(expectedModels)) {
    throw new Error(`The packaged Local AI models must contain x4plus only: ${packagedModels.join(", ")}`);
  }
  for (const name of expectedModels) {
    if ((await stat(path.join(modelsDir, name))).size <= 0) {
      throw new Error(`The packaged Local AI model file is empty: ${name}`);
    }
  }
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
  await rm(path.join(packageDir, "local-ai", "__pycache__"), { recursive: true, force: true });
  await rm(path.join(packageDir, "local-ai", "python-3.12.10-embed-amd64.zip"), { force: true });
  await assertBundledLocalAiRuntime(packageDir);

  console.log(`PixelRunner ${channel} package created at: ${packageDir}`);

}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
