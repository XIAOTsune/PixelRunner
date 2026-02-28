const test = require("node:test");
const assert = require("node:assert/strict");
const { renderAppPickerListHtml } = require("../../../src/controllers/workspace/app-picker-view");

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

test("renderAppPickerListHtml renders no_apps empty-state with action button", () => {
  const html = renderAppPickerListHtml(
    {
      empty: true,
      emptyState: {
        kind: "no_apps",
        message: "<none>",
        actionLabel: "Go >"
      }
    },
    {
      escapeHtml,
      encodeDataId: (id) => String(id || "")
    }
  );

  assert.match(html, /empty-state/);
  assert.match(html, /data-action="goto-settings"/);
  assert.match(html, /&lt;none&gt;/);
  assert.match(html, /Go &gt;/);
});

test("renderAppPickerListHtml renders app items with encoded ids and active class", () => {
  const html = renderAppPickerListHtml(
    {
      empty: false,
      items: [
        { id: "a/1", name: "A", appId: "100", inputCount: 2, active: false },
        { id: "b/2", name: "B", appId: "200", inputCount: 5, active: true }
      ]
    },
    {
      escapeHtml,
      encodeDataId: (id) => `enc-${id}`
    }
  );

  assert.match(html, /data-id="enc-a\/1"/);
  assert.match(html, /data-id="enc-b\/2"/);
  assert.match(html, /app-picker-item active/);
  assert.match(html, /app-picker-item-label/);
  assert.match(html, />A</);
  assert.match(html, />B</);
  assert.doesNotMatch(html, /inputCount/);
  assert.doesNotMatch(html, /appId/);
});
