import assert from "node:assert/strict";
import {
  openTextFileWithStorage,
  saveTextFileWithStorage
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

console.log("File transfer tests passed.");
