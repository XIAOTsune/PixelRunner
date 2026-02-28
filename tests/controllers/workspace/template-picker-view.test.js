const test = require("node:test");
const assert = require("node:assert/strict");
const { renderTemplatePickerListHtml } = require("../../../src/controllers/workspace/template-picker-view");

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

test("renderTemplatePickerListHtml renders empty-state html", () => {
  const html = renderTemplatePickerListHtml(
    {
      empty: true,
      emptyState: {
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
  assert.match(html, /&lt;none&gt;/);
  assert.match(html, /Go &gt;/);
});

test("renderTemplatePickerListHtml renders item list with encoded id and selected class", () => {
  const html = renderTemplatePickerListHtml(
    {
      empty: false,
      items: [
        { id: "a/1", title: "A", content: "AA", actionLabel: "Select", selected: false },
        { id: "b/2", title: "B", content: "BB", actionLabel: "Selected", selected: true }
      ]
    },
    {
      escapeHtml,
      encodeDataId: (id) => `enc-${id}`
    }
  );

  assert.match(html, /data-template-id="enc-a\/1"/);
  assert.match(html, /data-template-id="enc-b\/2"/);
  assert.match(html, /app-picker-item active/);
  assert.match(html, /app-picker-item-label/);
  assert.match(html, />A</);
  assert.match(html, />B</);
  assert.doesNotMatch(html, /Selected/);
  assert.doesNotMatch(html, />AA</);
  assert.doesNotMatch(html, />BB</);
});
