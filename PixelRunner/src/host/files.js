function getUxpStorage() {
  if (typeof require !== "function") {
    throw new Error("UXP 文件系统不可用");
  }
  const uxp = require("uxp");
  if (!uxp || !uxp.storage || !uxp.storage.localFileSystem) {
    throw new Error("UXP 文件系统不可用");
  }
  return uxp.storage;
}

function normalizeRequest(args) {
  const source = Array.isArray(args) ? args[0] : args;
  return source && typeof source === "object" ? source : {};
}

function normalizeExtension(value) {
  return String(value || "txt").trim().replace(/^\./, "") || "txt";
}

function getUtf8ByteLength(value) {
  let length = 0;
  for (const character of String(value == null ? "" : value)) {
    const codePoint = character.codePointAt(0);
    if (codePoint <= 0x7f) length += 1;
    else if (codePoint <= 0x7ff) length += 2;
    else if (codePoint <= 0xffff) length += 3;
    else length += 4;
  }
  return length;
}

function getUtf8Options(storage) {
  const utf8 = storage && storage.formats && storage.formats.utf8;
  if (!utf8) throw new Error("当前 UXP 版本未提供 UTF-8 文件格式");
  return { format: utf8 };
}

function arrayBufferToBase64(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function getImageMimeType(filename) {
  const extension = String(filename || "").split(".").pop().toLowerCase();
  return ({
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    gif: "image/gif",
    bmp: "image/bmp",
    tif: "image/tiff",
    tiff: "image/tiff"
  })[extension] || "application/octet-stream";
}

function base64ToArrayBuffer(base64) {
  const binary = atob(String(base64 || ""));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}

const imageTileExportFolders = new Map();

function assertSafeTileFilename(filename) {
  if (!filename || filename === "." || filename === ".." || /[\\/:*?"<>|\u0000-\u001f]/.test(filename)) {
    throw new Error("切片文件名包含无效字符");
  }
}

function addBatchSuffix(filename, suffix) {
  const match = String(filename || "").match(/^(.*?)(-\d+)(\.[^.]+)$/);
  return match ? `${match[1]}-${suffix}${match[2]}${match[3]}` : `${filename}-${suffix}`;
}

export async function chooseImageTileExportFolderWithStorage(request, storage) {
  const source = request && typeof request === "object" ? request : {};
  const filenames = Array.isArray(source.filenames) ? source.filenames.map((name) => String(name || "").trim()).filter(Boolean) : [];
  if (!filenames.length) throw new Error("没有可导出的切片文件名");
  filenames.forEach(assertSafeTileFilename);
  if (new Set(filenames.map((filename) => filename.toLowerCase())).size !== filenames.length) throw new Error("切片文件名重复");
  const fileSystem = storage && storage.localFileSystem;
  if (!fileSystem || typeof fileSystem.getFolder !== "function") throw new Error("UXP 导出文件夹接口不可用");
  const folder = await fileSystem.getFolder();
  if (!folder) return { outcome: "cancelled", folderToken: "", folderName: "", filenames: [] };
  const existingEntries = typeof folder.getEntries === "function" ? await folder.getEntries() : [];
  const existingNames = new Set((Array.isArray(existingEntries) ? existingEntries : []).map((entry) => String(entry && entry.name || "").toLowerCase()));
  let resolvedFilenames = filenames;
  let suffix = 1;
  while (resolvedFilenames.some((filename) => existingNames.has(filename.toLowerCase()))) {
    suffix += 1;
    if (suffix > 9999) throw new Error("所选文件夹中的切片名称冲突过多");
    resolvedFilenames = filenames.map((filename) => addBatchSuffix(filename, suffix));
  }
  const folderToken = `tile-export-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  imageTileExportFolders.set(folderToken, { folder, filenames: new Set(resolvedFilenames) });
  return {
    outcome: "selected",
    folderToken,
    folderName: String(folder.name || folder.nativePath || "导出文件夹"),
    filenames: resolvedFilenames
  };
}

export async function writeImageTileWithStorage(request, storage) {
  const source = request && typeof request === "object" ? request : {};
  const folderToken = String(source.folderToken || "");
  const session = imageTileExportFolders.get(folderToken);
  if (!session) throw new Error("导出文件夹会话已失效，请重新选择文件夹");
  const filename = String(source.filename || "").trim();
  const base64 = String(source.base64 || "").trim();
  if (!filename || !base64 || !session.filenames.has(filename)) throw new Error("切片文件内容或目标名称无效");
  assertSafeTileFilename(filename);
  const binary = storage && storage.formats && storage.formats.binary;
  if (!binary) throw new Error("当前 UXP 版本未提供二进制文件格式");
  const entry = await session.folder.createFile(filename, { overwrite: false });
  const buffer = base64ToArrayBuffer(base64);
  try {
    await entry.write(buffer, { format: binary });
    const persisted = typeof entry.read === "function" ? await entry.read({ format: binary }) : null;
    const persistedLength = persisted instanceof ArrayBuffer
      ? persisted.byteLength
      : ArrayBuffer.isView(persisted)
        ? persisted.byteLength
        : -1;
    if (persistedLength >= 0 && persistedLength !== buffer.byteLength) {
      throw new Error(`切片写入校验失败：${filename}`);
    }
  } catch (error) {
    try { if (entry && typeof entry.delete === "function") await entry.delete(); } catch (_) {}
    throw error;
  }
  return { outcome: "saved", filename, savedPath: String(entry.nativePath || entry.name || filename), byteLength: buffer.byteLength };
}

export function releaseImageTileExportFolder(request) {
  const source = request && typeof request === "object" ? request : {};
  return { released: imageTileExportFolders.delete(String(source.folderToken || "")) };
}

export async function saveTextFileWithStorage(request, storage) {
  const source = request && typeof request === "object" ? request : {};
  const filename = String(source.filename || "export.txt").trim() || "export.txt";
  const content = String(source.content == null ? "" : source.content);
  if (!content) throw new Error("没有可导出的文件内容");

  const fileSystem = storage && storage.localFileSystem;
  if (!fileSystem || typeof fileSystem.getFileForSaving !== "function") {
    throw new Error("UXP 保存文件接口不可用");
  }

  const entry = await fileSystem.getFileForSaving(filename, {
    types: [normalizeExtension(source.extension)]
  });
  if (!entry) return { outcome: "cancelled", savedPath: "", byteLength: 0 };
  if (typeof entry.write !== "function" || typeof entry.read !== "function") {
    throw new Error("UXP 文件读写接口不可用");
  }

  const utf8Options = getUtf8Options(storage);
  await entry.write(content, utf8Options);
  const persisted = String(await entry.read(utf8Options));
  if (persisted !== content) {
    throw new Error(
      `资料包写入校验失败：预计 ${getUtf8ByteLength(content)} 字节，实际 ${getUtf8ByteLength(persisted)} 字节`
    );
  }

  return {
    outcome: "saved",
    savedPath: String(entry.nativePath || entry.name || filename),
    byteLength: getUtf8ByteLength(persisted),
    charLength: persisted.length
  };
}

export async function openTextFileWithStorage(request, storage) {
  const source = request && typeof request === "object" ? request : {};
  const fileSystem = storage && storage.localFileSystem;
  if (!fileSystem || typeof fileSystem.getFileForOpening !== "function") {
    throw new Error("UXP 打开文件接口不可用");
  }

  const picked = await fileSystem.getFileForOpening({
    allowMultiple: false,
    types: [normalizeExtension(source.extension)]
  });
  const entry = Array.isArray(picked) ? picked[0] : picked;
  if (!entry) return { outcome: "cancelled", name: "", text: "", byteLength: 0 };
  if (typeof entry.read !== "function") throw new Error("UXP 文件读取接口不可用");

  const text = String(await entry.read(getUtf8Options(storage)));
  return {
    outcome: "loaded",
    name: String(entry.name || ""),
    text,
    byteLength: getUtf8ByteLength(text)
  };
}

export async function openImageFileWithStorage(storage) {
  const fileSystem = storage && storage.localFileSystem;
  if (!fileSystem || typeof fileSystem.getFileForOpening !== "function") {
    throw new Error("UXP 打开图片接口不可用");
  }

  const picked = await fileSystem.getFileForOpening({
    allowMultiple: false,
    types: ["jpg", "jpeg", "png", "webp", "gif", "bmp", "tif", "tiff"]
  });
  const entry = Array.isArray(picked) ? picked[0] : picked;
  if (!entry) return { outcome: "cancelled", name: "", dataUrl: "" };
  if (typeof entry.read !== "function") throw new Error("UXP 图片读取接口不可用");

  const binary = storage && storage.formats && storage.formats.binary;
  if (!binary) throw new Error("当前 UXP 版本未提供二进制文件读取格式");
  const name = String(entry.name || "image");
  const mimeType = getImageMimeType(name);
  if (!mimeType.startsWith("image/")) throw new Error("请选择 JPG、PNG、WebP、GIF、BMP 或 TIFF 图片");
  const bytes = await entry.read({ format: binary });
  return {
    outcome: "loaded",
    name,
    mimeType,
    dataUrl: `data:${mimeType};base64,${arrayBufferToBase64(bytes)}`
  };
}

export function saveTextFile(args = []) {
  return saveTextFileWithStorage(normalizeRequest(args), getUxpStorage());
}

export function openTextFile(args = []) {
  return openTextFileWithStorage(normalizeRequest(args), getUxpStorage());
}

export function openImageFile() {
  return openImageFileWithStorage(getUxpStorage());
}

export function chooseImageTileExportFolder(args = []) {
  return chooseImageTileExportFolderWithStorage(normalizeRequest(args), getUxpStorage());
}

export function writeImageTile(args = []) {
  return writeImageTileWithStorage(normalizeRequest(args), getUxpStorage());
}
