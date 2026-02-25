const test = require("node:test");
const assert = require("node:assert/strict");
const { renderSavedTemplatesListHtml } = require("../../../src/controllers/settings/saved-templates-view");

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

test("renderSavedTemplatesListHtml renders empty state", () => {
  const html = renderSavedTemplatesListHtml(
    {
      empty: true,
      emptyText: "暂无模板"
    },
    {
      escapeHtml,
      encodeDataId: (id) => String(id || "")
    }
  );
  assert.match(html, /empty-state/);
  assert.match(html, /暂无模板/);
});

test("renderSavedTemplatesListHtml renders template rows with duplicate and actions", () => {
  const html = renderSavedTemplatesListHtml(
    {
      empty: false,
      items: [
        {
          id: "t/1",
          title: "Title <A>",
          recordId: "t/1",
          editDisabled: false,
          deleteDisabled: false,
          duplicate: { isDuplicate: true, index: 2, total: 3 }
        }
      ]
    },
    {
      escapeHtml,
      encodeDataId: (id) => `enc-${id}`
    }
  );
  assert.match(html, /data-id="enc-t\/1"/);
  assert.match(html, /Title &lt;A&gt;/);
  assert.match(html, /重复 2\/3/);
  assert.match(html, /data-action="edit-template"/);
  assert.match(html, /data-action="delete-template"/);
});
