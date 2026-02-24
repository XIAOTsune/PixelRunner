const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildDuplicateMeta,
  buildSavedAppsListViewModel,
  buildSavedTemplatesListViewModel
} = require("../../../src/application/services/settings-lists");

test("buildDuplicateMeta marks duplicate ids and indexes", () => {
  const result = buildDuplicateMeta([{ id: "a" }, { id: "b" }, { id: "a" }]);
  assert.deepEqual(result, [
    { id: "a", isDuplicate: true, index: 1, total: 2 },
    { id: "b", isDuplicate: false, index: 1, total: 1 },
    { id: "a", isDuplicate: true, index: 2, total: 2 }
  ]);
});

test("buildSavedAppsListViewModel handles empty and duplicate app ids", () => {
  const emptyVm = buildSavedAppsListViewModel([]);
  assert.equal(emptyVm.empty, true);
  assert.equal(emptyVm.emptyText, "暂无已保存应用");

  const vm = buildSavedAppsListViewModel([
    { id: "a1", name: "App A", appId: "w1" },
    { id: "a1", name: "App A2", appId: "w1" },
    { id: "", name: "App B", appId: "" }
  ]);
  assert.equal(vm.empty, false);
  assert.equal(vm.items.length, 3);
  assert.deepEqual(vm.items[0].duplicate, { isDuplicate: true, index: 1, total: 2 });
  assert.deepEqual(vm.items[1].duplicate, { isDuplicate: true, index: 2, total: 2 });
  assert.equal(vm.items[2].editDisabled, true);
});

test("buildSavedTemplatesListViewModel handles empty and duplicate ids", () => {
  const emptyVm = buildSavedTemplatesListViewModel([]);
  assert.equal(emptyVm.empty, true);
  assert.equal(emptyVm.emptyText, "暂无模板");

  const vm = buildSavedTemplatesListViewModel([
    { id: "t1", title: "T1" },
    { id: "t2", title: "T2" },
    { id: "t1", title: "T1 copy" }
  ]);
  assert.equal(vm.empty, false);
  assert.equal(vm.items.length, 3);
  assert.deepEqual(vm.items[0].duplicate, { isDuplicate: true, index: 1, total: 2 });
  assert.deepEqual(vm.items[2].duplicate, { isDuplicate: true, index: 2, total: 2 });
});
