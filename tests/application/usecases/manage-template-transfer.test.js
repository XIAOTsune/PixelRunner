const test = require("node:test");
const assert = require("node:assert/strict");
const {
  resolvePickedEntry,
  normalizeReadText,
  exportTemplatesJsonUsecase,
  importTemplatesJsonUsecase
} = require("../../../src/application/usecases/manage-template-transfer");

test("resolvePickedEntry returns null, first array entry, or direct entry", () => {
  assert.equal(resolvePickedEntry(null), null);
  assert.deepEqual(resolvePickedEntry([{ name: "a" }, { name: "b" }]), { name: "a" });
  assert.deepEqual(resolvePickedEntry({ name: "x" }), { name: "x" });
});

test("normalizeReadText handles string, arrayBuffer and typed array", () => {
  assert.equal(normalizeReadText("hello"), "hello");
  const text = "模板";
  const bytes = new TextEncoder().encode(text);
  assert.equal(normalizeReadText(bytes.buffer), text);
  assert.equal(normalizeReadText(bytes.subarray(0, bytes.length)), text);
});

test("exportTemplatesJsonUsecase returns unsupported for missing file API", async () => {
  const result = await exportTemplatesJsonUsecase({
    localFileSystem: null,
    store: {}
  });
  assert.deepEqual(result, { outcome: "unsupported" });
});

test("exportTemplatesJsonUsecase returns cancelled when user cancels save dialog", async () => {
  const result = await exportTemplatesJsonUsecase({
    localFileSystem: {
      getFileForSaving: async () => null
    },
    store: {},
    buildTemplateExport: () => ({
      bundle: { templates: [] },
      defaultName: "templates.json"
    })
  });
  assert.deepEqual(result, { outcome: "cancelled" });
});

test("exportTemplatesJsonUsecase writes file and returns exported metadata", async () => {
  let written = "";
  const result = await exportTemplatesJsonUsecase({
    localFileSystem: {
      getFileForSaving: async () => ({
        nativePath: "C:/tmp/templates.json",
        write: async (content) => {
          written = content;
        }
      })
    },
    store: {},
    buildTemplateExport: () => ({
      bundle: { templates: [{ id: "t1" }, { id: "t2" }] },
      defaultName: "templates.json"
    })
  });
  assert.equal(result.outcome, "exported");
  assert.equal(result.savedPath, "C:/tmp/templates.json");
  assert.equal(result.total, 2);
  assert.match(written, /"templates"/);
});

test("importTemplatesJsonUsecase returns unsupported for missing file API", async () => {
  const result = await importTemplatesJsonUsecase({
    localFileSystem: null,
    store: {}
  });
  assert.deepEqual(result, { outcome: "unsupported" });
});

test("importTemplatesJsonUsecase returns cancelled when user cancels open dialog", async () => {
  const result = await importTemplatesJsonUsecase({
    localFileSystem: {
      getFileForOpening: async () => null
    },
    store: {},
    importTemplates: () => ({ reason: "imported", added: 0, replaced: 0, total: 0 })
  });
  assert.deepEqual(result, { outcome: "cancelled" });
});

test("importTemplatesJsonUsecase reads payload and returns imported result", async () => {
  const text = JSON.stringify({ version: 1, templates: [{ title: "A", content: "B" }] });
  const bytes = new TextEncoder().encode(text);
  let payload = "";

  const result = await importTemplatesJsonUsecase({
    localFileSystem: {
      getFileForOpening: async () => ({
        read: async () => bytes
      })
    },
    store: {},
    importTemplates: ({ payload: incoming }) => {
      payload = incoming;
      return { reason: "imported", added: 1, replaced: 2, total: 3 };
    }
  });

  assert.equal(payload, text);
  assert.deepEqual(result, {
    outcome: "imported",
    reason: "imported",
    added: 1,
    replaced: 2,
    total: 3
  });
});
