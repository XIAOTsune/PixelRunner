const test = require("node:test");
const assert = require("node:assert/strict");
const { renderTaskSummary } = require("../../../src/controllers/workspace/task-summary-view");

function createFakeSummaryElement() {
  const classes = new Set(["is-warning", "is-success", "is-info"]);
  return {
    textContent: "",
    title: "",
    classList: {
      remove(...tokens) {
        tokens.forEach((token) => classes.delete(token));
      },
      add(token) {
        classes.add(token);
      },
      has(token) {
        return classes.has(token);
      }
    }
  };
}

test("renderTaskSummary writes text/title and applies warning tone class", () => {
  const el = createFakeSummaryElement();
  renderTaskSummary(el, {
    text: "后台任务：运行 1",
    title: "J1 | App1",
    tone: "warning"
  });

  assert.equal(el.textContent, "后台任务：运行 1");
  assert.equal(el.title, "J1 | App1");
  assert.equal(el.classList.has("is-warning"), true);
  assert.equal(el.classList.has("is-success"), false);
  assert.equal(el.classList.has("is-info"), false);
});

test("renderTaskSummary applies default tone without status classes", () => {
  const el = createFakeSummaryElement();
  renderTaskSummary(el, {
    text: "后台任务：无",
    title: "",
    tone: "default"
  });

  assert.equal(el.textContent, "后台任务：无");
  assert.equal(el.title, "");
  assert.equal(el.classList.has("is-warning"), false);
  assert.equal(el.classList.has("is-success"), false);
  assert.equal(el.classList.has("is-info"), false);
});
