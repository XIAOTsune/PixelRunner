import { spawn } from "node:child_process";
import { access, cp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deflateRawSync } from "node:zlib";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const releaseRoot = path.join(rootDir, "release");
export const RELEASE_PRODUCT_NAME = "像素起子";

async function readManifestVersion() {
  const manifestPath = path.join(rootDir, "manifest.json");
  const manifestText = await readFile(manifestPath, "utf8");
  const manifest = JSON.parse(manifestText);
  return String(manifest.version || "0.0.0");
}

function getBuildChannel() {
  return process.argv.includes("--release") ? "release" : "test";
}

export function getReleasePackageNames(version) {
  const packageDirName = `${RELEASE_PRODUCT_NAME}V${version}`;
  return { packageDirName, packageZipName: `${packageDirName}.zip` };
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
    ...getReleasePackageNames(version),
    entries
  };
}

const ZIP_UTF8_FLAG = 0x0800;
const ZIP_DEFLATE_METHOD = 8;
const ZIP32_MAX_VALUE = 0xffffffff;
const CRC32_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  return value >>> 0;
});

function calculateCrc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function getDosDateTime(value) {
  const date = value instanceof Date && Number.isFinite(value.getTime()) ? value : new Date(1980, 0, 1);
  const year = Math.max(1980, Math.min(2107, date.getFullYear()));
  return {
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2)
  };
}

async function collectZipFiles(directory, rootDirectory = directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectZipFiles(entryPath, rootDirectory));
      continue;
    }
    if (!entry.isFile()) continue;
    const fileStats = await stat(entryPath);
    files.push({
      name: path.relative(rootDirectory, entryPath).split(path.sep).join("/"),
      bytes: await readFile(entryPath),
      modifiedAt: fileStats.mtime
    });
  }
  return files.sort((left, right) => left.name.localeCompare(right.name, "en"));
}

function createZipArchive(files) {
  if (files.length > 0xffff) throw new Error("发布包文件数量超过 ZIP32 上限");
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const file of files) {
    const name = Buffer.from(file.name, "utf8");
    const compressed = deflateRawSync(file.bytes, { level: 9 });
    const crc32 = calculateCrc32(file.bytes);
    const { date, time } = getDosDateTime(file.modifiedAt);
    if (name.length > 0xffff || file.bytes.length > ZIP32_MAX_VALUE || compressed.length > ZIP32_MAX_VALUE || offset > ZIP32_MAX_VALUE) {
      throw new Error(`发布包文件超出 ZIP32 限制：${file.name}`);
    }

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(ZIP_UTF8_FLAG, 6);
    localHeader.writeUInt16LE(ZIP_DEFLATE_METHOD, 8);
    localHeader.writeUInt16LE(time, 10);
    localHeader.writeUInt16LE(date, 12);
    localHeader.writeUInt32LE(crc32, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(file.bytes.length, 22);
    localHeader.writeUInt16LE(name.length, 26);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(ZIP_UTF8_FLAG, 8);
    centralHeader.writeUInt16LE(ZIP_DEFLATE_METHOD, 10);
    centralHeader.writeUInt16LE(time, 12);
    centralHeader.writeUInt16LE(date, 14);
    centralHeader.writeUInt32LE(crc32, 16);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(file.bytes.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt32LE(offset, 42);

    localParts.push(localHeader, name, compressed);
    centralParts.push(centralHeader, name);
    offset += localHeader.length + name.length + compressed.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  if (offset > ZIP32_MAX_VALUE || centralDirectory.length > ZIP32_MAX_VALUE) {
    throw new Error("发布包超出 ZIP32 总大小限制");
  }
  const endRecord = Buffer.alloc(22);
  endRecord.writeUInt32LE(0x06054b50, 0);
  endRecord.writeUInt16LE(files.length, 8);
  endRecord.writeUInt16LE(files.length, 10);
  endRecord.writeUInt32LE(centralDirectory.length, 12);
  endRecord.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, centralDirectory, endRecord]);
}

async function createReleaseArchive(packageDir, archivePath) {
  const temporaryArchivePath = `${archivePath}.tmp`;
  await rm(temporaryArchivePath, { force: true });
  await writeFile(temporaryArchivePath, createZipArchive(await collectZipFiles(packageDir)));
  await rm(archivePath, { force: true });
  await rename(temporaryArchivePath, archivePath);
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
  const { packageDirName, packageZipName, entries } = getIncludedEntries(version, channel);
  const packageDir = path.join(releaseRoot, packageDirName);
  const packageZip = path.join(releaseRoot, packageZipName);
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

  if (channel === "release") {
    await createReleaseArchive(packageDir, packageZip);
    console.log(`${RELEASE_PRODUCT_NAME} release package created at: ${packageDir}`);
    console.log(`${RELEASE_PRODUCT_NAME} release archive created at: ${packageZip}`);
    return;
  }
  console.log(`${RELEASE_PRODUCT_NAME} ${channel} package created at: ${packageDir}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
