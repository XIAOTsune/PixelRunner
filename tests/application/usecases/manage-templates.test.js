const test = require("node:test");
const assert = require("node:assert/strict");
const {
  getTemplateTitleKey,
  saveTemplateUsecase,
  importTemplatesUsecase,
  buildTemplateExportUsecase
} = require("../../../src/application/usecases/manage-templates");

test("getTemplateTitleKey trims and lower-cases title", () => {
  assert.equal(getTemplateTitleKey("  Hello World  "), "hello world");
  assert.equal(getTemplateTitleKey(""), "");
});

test("saveTemplateUsecase saves new template", () => {
  const calls = [];
  const store = {
    getPromptTemplates: () => [],
    deletePromptTemplate: (id) => calls.push(["deletePromptTemplate", id]),
    addPromptTemplate: (payload) => calls.push(["addPromptTemplate", payload])
  };

  const result = saveTemplateUsecase({
    store,
    title: "  New Template ",
    content: "prompt body"
  });

  assert.deepEqual(result, { reason: "saved" });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], [
    "addPromptTemplate",
    {
      title: "New Template",
      content: "prompt body"
    }
  ]);
});

test("saveTemplateUsecase replaces same-title template", () => {
  const calls = [];
  const store = {
    getPromptTemplates: () => [{ id: "old-1", title: "Portrait", content: "old" }],
    deletePromptTemplate: (id) => calls.push(["deletePromptTemplate", id]),
    addPromptTemplate: (payload) => calls.push(["addPromptTemplate", payload])
  };

  const result = saveTemplateUsecase({
    store,
    title: "  portrait ",
    content: "new body"
  });

  assert.deepEqual(result, { reason: "updated" });
  assert.deepEqual(calls[0], ["deletePromptTemplate", "old-1"]);
  assert.deepEqual(calls[1], [
    "addPromptTemplate",
    {
      title: "portrait",
      content: "new body"
    }
  ]);
});

test("saveTemplateUsecase validates required fields", () => {
  const store = {
    getPromptTemplates: () => [],
    deletePromptTemplate: () => {},
    addPromptTemplate: () => {}
  };

  assert.throws(
    () => saveTemplateUsecase({ store, title: "", content: "x" }),
    /Template title and content are required/
  );
  assert.throws(
    () => saveTemplateUsecase({ store, title: "x", content: "   " }),
    /Template title and content are required/
  );
});

test("importTemplatesUsecase merges and preserves existing id/createdAt", () => {
  let savedList = null;
  const store = {
    getPromptTemplates: () => [
      { id: "old-1", title: "Portrait", content: "old body", createdAt: 111 },
      { id: "old-2", title: "Landscape", content: "old 2", createdAt: 222 }
    ],
    savePromptTemplates: (list) => {
      savedList = list;
    },
    parsePromptTemplatesBundle: () => [
      { id: "new-a", title: "portrait", content: "new body", createdAt: 999 },
      { id: "new-b", title: "Anime", content: "anime body", createdAt: 333 }
    ]
  };

  const result = importTemplatesUsecase({
    store,
    payload: "raw-json"
  });

  assert.deepEqual(result, {
    reason: "imported",
    added: 1,
    replaced: 1,
    total: 3
  });
  assert.equal(savedList.length, 3);
  assert.deepEqual(savedList[0], {
    id: "old-1",
    title: "portrait",
    content: "new body",
    createdAt: 111
  });
  assert.deepEqual(savedList[2], {
    id: "new-b",
    title: "Anime",
    content: "anime body",
    createdAt: 333
  });
});

test("buildTemplateExportUsecase returns bundle and deterministic filename", () => {
  const store = {
    buildPromptTemplatesBundle: () => ({ templates: [{ id: "1" }] })
  };

  const result = buildTemplateExportUsecase({
    store,
    filenamePrefix: "my_templates",
    now: new Date("2026-02-24T12:00:00.000Z")
  });

  assert.deepEqual(result, {
    bundle: { templates: [{ id: "1" }] },
    defaultName: "my_templates_2026-02-24.json"
  });
});
