const test = require("node:test");
const assert = require("node:assert/strict");
const { renderSavedAppsListHtml } = require("../../../src/controllers/settings/saved-apps-view");

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

test("renderSavedAppsListHtml renders empty state", () => {
  const html = renderSavedAppsListHtml(
    {
      empty: true,
      emptyText: "暂无已保存应用"
    },
    {
      escapeHtml,
      encodeDataId: (id) => String(id || "")
    }
  );
  assert.match(html, /empty-state/);
  assert.match(html, /暂无已保存应用/);
});

test("renderSavedAppsListHtml renders app rows with encoded id and duplicate tag", () => {
  const html = renderSavedAppsListHtml(
    {
      empty: false,
      items: [
        {
          id: "a/1",
          name: "App <A>",
          appId: "wf-1",
          recordId: "a/1",
          editDisabled: false,
          deleteDisabled: false,
          duplicate: { isDuplicate: true, index: 1, total: 2 }
        },
        {
          id: "",
          name: "NoId",
          appId: "",
          recordId: "unknown-id",
          editDisabled: true,
          deleteDisabled: true,
          duplicate: { isDuplicate: false, index: 1, total: 1 }
        }
      ]
    },
    {
      escapeHtml,
      encodeDataId: (id) => `enc-${id}`
    }
  );
  assert.match(html, /data-id="enc-a\/1"/);
  assert.match(html, /App &lt;A&gt;/);
  assert.match(html, /重复 1\/2/);
  assert.match(html, /data-action="edit-app"/);
  assert.match(html, /data-action="delete-app"/);
  assert.match(html, /disabled/);
});
