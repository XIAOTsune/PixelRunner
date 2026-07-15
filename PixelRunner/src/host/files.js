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

export function saveTextFile(args = []) {
  return saveTextFileWithStorage(normalizeRequest(args), getUxpStorage());
}

export function openTextFile(args = []) {
  return openTextFileWithStorage(normalizeRequest(args), getUxpStorage());
}
