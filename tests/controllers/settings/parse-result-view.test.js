const test = require("node:test");
const assert = require("node:assert/strict");
const { renderParseSuccessHtml, renderParseFailureHtml } = require("../../../src/controllers/settings/parse-result-view");

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

test("renderParseSuccessHtml renders title, inputs and save button", () => {
  const html = renderParseSuccessHtml(
    {
      title: "解析成功: <App>",
      actionLabel: "保存到工作台",
      items: [
        { label: "Prompt", key: "prompt" },
        { label: "<Image>", key: "image" }
      ]
    },
    { escapeHtml }
  );

  assert.match(html, /解析成功: &lt;App&gt;/);
  assert.match(html, /Prompt/);
  assert.match(html, /&lt;Image&gt;/);
  assert.match(html, /id="btnSaveParsedApp"/);
  assert.match(html, /保存到工作台/);
});

test("renderParseFailureHtml renders escaped error text", () => {
  const html = renderParseFailureHtml(
    {
      message: "解析失败: <error>"
    },
    { escapeHtml }
  );
  assert.match(html, /解析失败: &lt;error&gt;/);
});
