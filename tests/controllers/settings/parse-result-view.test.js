const test = require("node:test");
const assert = require("node:assert/strict");
const { renderParseSuccessHtml, renderParseFailureHtml } = require("../../../src/controllers/settings/parse-result-view");

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
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

test("renderParseFailureHtml renders structured parse error meta", () => {
  const html = renderParseFailureHtml(
    {
      message: "解析失败: parse failed",
      code: "PARSE_APP_FAILED",
      retryable: true,
      reasons: ["<r1>", "r2"]
    },
    { escapeHtml }
  );

  assert.match(html, /Code: PARSE_APP_FAILED/);
  assert.match(html, /Retryable: Yes/);
  assert.match(html, /1\. &lt;r1&gt;/);
  assert.match(html, /2\. r2/);
});