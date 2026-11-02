import assert from "node:assert/strict";
import {
  chooseImageTileExportFolderWithStorage,
  openImageFileWithStorage,
  openTextFileWithStorage,
  releaseImageTileExportFolder,
  saveTextFileWithStorage,
  writeImageTileWithStorage
} from "../src/host/files.js";

async function assertBundleExportWithoutTextarea() {
  const modules = {
    runtime: {
      getById() { return null; },
      createId(prefix) { return `${prefix}-test`; }
    },
    state: {
      RUNNINGHUB_REGIONS: { CN: "cn", GLOBAL: "global" },
      normalizeRunningHubRegion(value) { return value === "global" ? "global" : "cn"; },
      normalizeAppList(apps) { return Array.isArray(apps) ? apps : []; },
      normalizeTemplateRecord(template) { return template; },
      state: {
        apps: [{ id: "app-test", appId: "100", region: "cn", name: "测试应用", inputs: [] }],
        templateCategories: [{ id: "default", name: "默认分类" }],
        templates: [{ id: "tpl-test", title: "测试模板", content: "测试内容", categoryId: "default" }],
        quickEntries: []
      }
    },
    quickEntries: {
      normalizeQuickEntryList(entries) { return Array.isArray(entries) ? entries : []; }
    }
  };
  globalThis.window = { PixelRunnerModules: modules };
  await import("../src/webview/templates.js");

  const text = modules.templates.exportTemplatesToTextarea();
  const bundle = JSON.parse(text);
  assert.ok(text.length > 0);
  assert.equal(bundle.schema, "pixelrunner.bundle");
  assert.equal(bundle.version, 3);
  assert.equal(bundle.apps.length, 1);
  assert.equal(bundle.templates.length, 1);
  delete globalThis.window;
}

function createStorage(entryOverrides = {}) {
  let persisted = "";
  const entry = {
    name: "pixelrunner_bundle.json",
    nativePath: "C:\\exports\\pixelrunner_bundle.json",
    async write(content, options) {
      assert.deepEqual(options, { format: "utf8" });
      persisted = String(content);
    },
    async read(options) {
      assert.deepEqual(options, { format: "utf8" });
      return persisted;
    },
    ...entryOverrides
  };
  return {
    entry,
    storage: {
      formats: { utf8: "utf8" },
      localFileSystem: {
        async getFileForSaving() {
          return entry;
        },
        async getFileForOpening() {
          return entry;
        }
      }
    }
  };
}

const largeBundleText = JSON.stringify({
  schema: "pixelrunner.bundle",
  version: 2,
  templates: [{ title: "大资料包", content: "像素起子".repeat(25000) }]
}, null, 2);

await assertBundleExportWithoutTextarea();

{
  const { storage } = createStorage();
  const result = await saveTextFileWithStorage({
    filename: "pixelrunner_bundle.json",
    extension: ".json",
    content: largeBundleText
  }, storage);
  assert.equal(result.outcome, "saved");
  assert.ok(result.byteLength > 100000);
}

{
  const { storage } = createStorage({
    async write() {},
    async read() { return ""; }
  });
  await assert.rejects(
    saveTextFileWithStorage({ filename: "empty.json", extension: ".json", content: largeBundleText }, storage),
    /写入校验失败/
  );
}

{
  const { storage } = createStorage({
    async read(options) {
      assert.deepEqual(options, { format: "utf8" });
      return largeBundleText;
    }
  });
  const result = await openTextFileWithStorage({ extension: ".json" }, storage);
  assert.equal(result.outcome, "loaded");
  assert.equal(result.text, largeBundleText);
  assert.ok(result.byteLength > 100000);
}

{
  let pickerOptions = null;
  const imageBytes = Uint8Array.from([137, 80, 78, 71]);
  const storage = {
    formats: { binary: "binary" },
    localFileSystem: {
      async getFileForOpening(options) {
        pickerOptions = options;
        return {
          name: "reference.png",
          async read(options) {
            assert.deepEqual(options, { format: "binary" });
            return imageBytes.buffer;
          }
        };
      }
    }
  };
  const result = await openImageFileWithStorage(storage);
  assert.equal(pickerOptions.allowMultiple, false);
  assert.ok(pickerOptions.types.includes("png"));
  assert.equal(result.outcome, "loaded");
  assert.equal(result.name, "reference.png");
  assert.equal(result.mimeType, "image/png");
  assert.equal(result.dataUrl, `data:image/png;base64,${Buffer.from(imageBytes).toString("base64")}`);
}

{
  const result = await openImageFileWithStorage({
    formats: { binary: "binary" },
    localFileSystem: { async getFileForOpening() { return null; } }
  });
  assert.equal(result.outcome, "cancelled");
  assert.equal(result.dataUrl, "");
}

{
  const files = new Map();
  const folder = {
    name: "social-posts",
    async getEntries() { return [{ name: "cover-001.jpg" }]; },
    async createFile(filename, options) {
      assert.equal(options.overwrite, false);
      if (files.has(filename)) throw new Error("already exists");
      return {
        name: filename,
        nativePath: `C:\\social-posts\\${filename}`,
        async write(buffer, writeOptions) {
          assert.deepEqual(writeOptions, { format: "binary" });
          files.set(filename, new Uint8Array(buffer));
        },
        async read(readOptions) {
          assert.deepEqual(readOptions, { format: "binary" });
          return files.get(filename).buffer;
        }
      };
    }
  };
  const storage = {
    formats: { binary: "binary" },
    localFileSystem: { async getFolder() { return folder; } }
  };
  const selected = await chooseImageTileExportFolderWithStorage({ filenames: ["cover-001.jpg", "cover-002.jpg"] }, storage);
  assert.equal(selected.outcome, "selected");
  assert.equal(selected.folderName, "social-posts");
  assert.deepEqual(selected.filenames, ["cover-2-001.jpg", "cover-2-002.jpg"]);
  const written = await writeImageTileWithStorage({
    folderToken: selected.folderToken,
    filename: selected.filenames[0],
    base64: Buffer.from([1, 2, 3, 4]).toString("base64")
  }, storage);
  assert.equal(written.outcome, "saved");
  assert.equal(written.byteLength, 4);
  assert.deepEqual(Array.from(files.get(selected.filenames[0])), [1, 2, 3, 4]);
  assert.equal(releaseImageTileExportFolder({ folderToken: selected.folderToken }).released, true);
  await assert.rejects(
    writeImageTileWithStorage({ folderToken: selected.folderToken, filename: selected.filenames[1], base64: "AQ==" }, storage),
    /会话已失效/
  );
}

{
  const result = await chooseImageTileExportFolderWithStorage({ filenames: ["cancel-001.png"] }, {
    localFileSystem: { async getFolder() { return null; } }
  });
  assert.equal(result.outcome, "cancelled");
}

console.log("File transfer tests passed.");
