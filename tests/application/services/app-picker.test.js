const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeAppPickerKeyword, buildAppPickerViewModel } = require("../../../src/application/services/app-picker");

test("normalizeAppPickerKeyword trims and lower-cases keyword", () => {
  assert.equal(normalizeAppPickerKeyword("  HeLLo "), "hello");
  assert.equal(normalizeAppPickerKeyword(""), "");
});

test("buildAppPickerViewModel filters by keyword and marks active app", () => {
  const viewModel = buildAppPickerViewModel({
    apps: [
      { id: "a", name: "Portrait Pro", appId: "100", inputs: [{}, {}] },
      { id: "b", name: "Anime Tool", appId: "200", inputs: [] }
    ],
    keyword: "portrait",
    currentAppId: "a"
  });

  assert.equal(viewModel.totalCount, 2);
  assert.equal(viewModel.visibleCount, 1);
  assert.equal(viewModel.empty, false);
  assert.equal(viewModel.items.length, 1);
  assert.deepEqual(viewModel.items[0], {
    id: "a",
    name: "Portrait Pro",
    appId: "100",
    inputCount: 2,
    active: true
  });
});

test("buildAppPickerViewModel returns no_apps empty state", () => {
  const viewModel = buildAppPickerViewModel({
    apps: [],
    keyword: "",
    currentAppId: ""
  });

  assert.equal(viewModel.empty, true);
  assert.equal(viewModel.emptyState.kind, "no_apps");
  assert.equal(viewModel.emptyState.actionLabel, "Go to Settings");
});

test("buildAppPickerViewModel returns no_matches empty state", () => {
  const viewModel = buildAppPickerViewModel({
    apps: [{ id: "a", name: "Portrait Pro", appId: "100", inputs: [] }],
    keyword: "anime",
    currentAppId: ""
  });

  assert.equal(viewModel.empty, true);
  assert.equal(viewModel.emptyState.kind, "no_matches");
  assert.equal(viewModel.emptyState.message, "No matching apps.");
});
