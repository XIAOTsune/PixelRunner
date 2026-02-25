const test = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeTemplatePickerConfig,
  sanitizeTemplateSelectionIds,
  toggleTemplateSelection,
  resolveSelectedTemplates,
  buildSingleTemplateSelectionPayload,
  buildMultipleTemplateSelectionPayload,
  buildTemplatePickerUiState,
  buildTemplatePickerListViewModel
} = require("../../../src/application/services/template-picker");

test("normalizeTemplatePickerConfig handles function/object and clamps maxSelection", () => {
  const fn = () => {};
  assert.deepEqual(normalizeTemplatePickerConfig(fn, { maxCombineCount: 5 }), {
    mode: "single",
    maxSelection: 1,
    onApply: fn
  });

  const cfg = normalizeTemplatePickerConfig(
    {
      mode: "multiple",
      maxSelection: 99,
      onApply: fn
    },
    { maxCombineCount: 3 }
  );
  assert.deepEqual(cfg, {
    mode: "multiple",
    maxSelection: 3,
    onApply: fn
  });
});

test("sanitizeTemplateSelectionIds removes ids not in templates", () => {
  const templates = [{ id: "a" }, { id: "b" }];
  assert.deepEqual(sanitizeTemplateSelectionIds(["a", "x", "b"], templates), ["a", "b"]);
});

test("toggleTemplateSelection toggles and enforces limit", () => {
  const addResult = toggleTemplateSelection({
    selectedIds: ["a"],
    id: "b",
    maxSelection: 2
  });
  assert.deepEqual(addResult, {
    selectedIds: ["a", "b"],
    limitReached: false,
    changed: true
  });

  const removeResult = toggleTemplateSelection({
    selectedIds: ["a", "b"],
    id: "a",
    maxSelection: 2
  });
  assert.deepEqual(removeResult, {
    selectedIds: ["b"],
    limitReached: false,
    changed: true
  });

  const limitResult = toggleTemplateSelection({
    selectedIds: ["a", "b"],
    id: "c",
    maxSelection: 2
  });
  assert.deepEqual(limitResult, {
    selectedIds: ["a", "b"],
    limitReached: true,
    changed: false
  });
});

test("resolveSelectedTemplates keeps id order", () => {
  const templates = [
    { id: "a", content: "A" },
    { id: "b", content: "B" }
  ];
  const result = resolveSelectedTemplates({
    templates,
    selectedIds: ["b", "a", "x"]
  });
  assert.deepEqual(result, [templates[1], templates[0]]);
});

test("buildSingleTemplateSelectionPayload returns content length payload", () => {
  const payload = buildSingleTemplateSelectionPayload({
    template: { id: "a", content: "hello" },
    maxChars: 5000
  });
  assert.equal(payload.mode, "single");
  assert.equal(payload.templates.length, 1);
  assert.equal(payload.content, "hello");
  assert.equal(payload.length, 5);
  assert.equal(payload.limit, 5000);
});

test("buildMultipleTemplateSelectionPayload validates empty/missing/too_long and success", () => {
  const templates = [
    { id: "a", content: "abc" },
    { id: "b", content: "def" }
  ];

  assert.deepEqual(
    buildMultipleTemplateSelectionPayload({
      templates,
      selectedIds: [],
      maxChars: 10
    }),
    { ok: false, reason: "empty_selection" }
  );

  assert.deepEqual(
    buildMultipleTemplateSelectionPayload({
      templates,
      selectedIds: ["x"],
      maxChars: 10
    }),
    { ok: false, reason: "templates_not_found" }
  );

  const tooLong = buildMultipleTemplateSelectionPayload({
    templates,
    selectedIds: ["a", "b"],
    maxChars: 3
  });
  assert.equal(tooLong.ok, false);
  assert.equal(tooLong.reason, "too_long");
  assert.equal(tooLong.limit, 3);

  const success = buildMultipleTemplateSelectionPayload({
    templates,
    selectedIds: ["a", "b"],
    maxChars: 20
  });
  assert.equal(success.ok, true);
  assert.deepEqual(success.payload.templates, templates);
  assert.equal(success.payload.content, "abc\ndef");
  assert.equal(success.payload.length, 7);
  assert.equal(success.payload.limit, 20);
});

test("buildTemplatePickerUiState returns mode-specific ui state", () => {
  assert.deepEqual(
    buildTemplatePickerUiState({
      mode: "single",
      selectedCount: 2,
      maxSelection: 5
    }),
    {
      title: "Select Prompt Template",
      actionsDisplay: "none",
      selectionInfoText: "",
      applyDisabled: true
    }
  );

  assert.deepEqual(
    buildTemplatePickerUiState({
      mode: "multiple",
      selectedCount: 0,
      maxSelection: 3
    }),
    {
      title: "Select Prompt Templates (Combine)",
      actionsDisplay: "flex",
      selectionInfoText: "Selected 0 / 3",
      applyDisabled: true
    }
  );
});

test("buildTemplatePickerListViewModel returns empty and item view models", () => {
  const emptyVm = buildTemplatePickerListViewModel({
    templates: [],
    selectedIds: [],
    multipleMode: false
  });
  assert.equal(emptyVm.empty, true);
  assert.equal(emptyVm.items.length, 0);
  assert.equal(emptyVm.emptyState.actionLabel, "Go to Settings");

  const vm = buildTemplatePickerListViewModel({
    templates: [
      { id: "a", title: "A", content: "aaa" },
      { id: "b", title: "B", content: "bbb" }
    ],
    selectedIds: ["b"],
    multipleMode: true
  });
  assert.equal(vm.empty, false);
  assert.equal(vm.items.length, 2);
  assert.deepEqual(vm.items[0], {
    id: "a",
    title: "A",
    content: "aaa",
    selected: false,
    actionLabel: "Select"
  });
  assert.deepEqual(vm.items[1], {
    id: "b",
    title: "B",
    content: "bbb",
    selected: true,
    actionLabel: "Selected"
  });
});
