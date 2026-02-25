const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { WORKSPACE_DOM_IDS } = require("../../../src/controllers/workspace/workspace-init-controller");

const INDEX_HTML_PATH = path.resolve(__dirname, "../../../index.html");

function readIndexHtml() {
  return fs.readFileSync(INDEX_HTML_PATH, "utf8");
}

function escapeRegex(raw) {
  return String(raw || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasElementId(html, id) {
  const pattern = new RegExp(`\\bid\\s*=\\s*["']${escapeRegex(id)}["']`);
  return pattern.test(html);
}

function findOpeningTagById(html, id) {
  const pattern = new RegExp(
    `<([a-zA-Z][\\w:-]*)\\b[^>]*\\bid\\s*=\\s*["']${escapeRegex(id)}["'][^>]*>`,
    "i"
  );
  const matched = html.match(pattern);
  if (!matched) return null;
  return {
    tagName: String(matched[1] || "").toLowerCase(),
    openingTag: matched[0]
  };
}

function collectIdCounts(html) {
  const counts = Object.create(null);
  const idPattern = /\bid\s*=\s*["']([^"']+)["']/g;
  let matched = idPattern.exec(html);
  while (matched) {
    const id = String(matched[1] || "");
    counts[id] = (counts[id] || 0) + 1;
    matched = idPattern.exec(html);
  }
  return counts;
}

test("workspace dom contract keeps all controller ids in index.html", () => {
  const html = readIndexHtml();
  const missingIds = WORKSPACE_DOM_IDS.filter((id) => !hasElementId(html, id));
  assert.deepEqual(missingIds, []);
});

test("workspace dom contract keeps unique ids for workspace bindings", () => {
  const html = readIndexHtml();
  const idCounts = collectIdCounts(html);
  const duplicatedIds = WORKSPACE_DOM_IDS.filter((id) => Number(idCounts[id] || 0) > 1);
  assert.deepEqual(duplicatedIds, []);
});

test("workspace dom contract keeps critical element tags and modal hooks", () => {
  const html = readIndexHtml();
  const criticalTags = [
    { id: "btnRun", allowedTagNames: ["button", "sp-button"] },
    { id: "btnOpenAppPicker", allowedTagNames: ["button", "sp-button"] },
    { id: "btnRefreshWorkspaceApps", allowedTagNames: ["button", "sp-button"] },
    { id: "btnClearLog", allowedTagNames: ["button", "sp-button"] },
    { id: "btnApplyTemplateSelection", allowedTagNames: ["button", "sp-button"] },
    { id: "appPickerModalClose", allowedTagNames: ["button", "sp-button"] },
    { id: "templateModalClose", allowedTagNames: ["button", "sp-button"] },
    { id: "appPickerSearchInput", allowedTagNames: ["input"] },
    { id: "logWindow", allowedTagNames: ["textarea", "div"] }
  ];

  criticalTags.forEach((item) => {
    const matched = findOpeningTagById(html, item.id);
    assert.ok(matched, `Missing opening tag for #${item.id}`);
    assert.equal(item.allowedTagNames.includes(matched.tagName), true, `Unexpected tag for #${item.id}`);
  });

  const templateModal = findOpeningTagById(html, "templateModal");
  const appPickerModal = findOpeningTagById(html, "appPickerModal");
  assert.ok(templateModal, "Missing #templateModal");
  assert.ok(appPickerModal, "Missing #appPickerModal");
  assert.match(templateModal.openingTag, /\bclass\s*=\s*["'][^"']*\bmodal-overlay\b/i);
  assert.match(appPickerModal.openingTag, /\bclass\s*=\s*["'][^"']*\bmodal-overlay\b/i);
});
