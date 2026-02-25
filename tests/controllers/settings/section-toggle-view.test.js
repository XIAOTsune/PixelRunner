const test = require("node:test");
const assert = require("node:assert/strict");
const { toggleSectionCollapse } = require("../../../src/controllers/settings/section-toggle-view");

function createSectionWithClass(initialClasses = []) {
  const set = new Set(initialClasses);
  return {
    classList: {
      contains(cls) {
        return set.has(cls);
      },
      add(cls) {
        set.add(cls);
      },
      remove(cls) {
        set.delete(cls);
      }
    },
    _set: set
  };
}

test("toggleSectionCollapse expands when currently collapsed", () => {
  const section = createSectionWithClass(["is-collapsed"]);
  const toggle = { textContent: "" };

  const expanded = toggleSectionCollapse(section, toggle, {
    collapsedClass: "is-collapsed",
    expandText: "展开",
    collapseText: "收起"
  });

  assert.equal(expanded, true);
  assert.equal(section._set.has("is-collapsed"), false);
  assert.equal(toggle.textContent, "收起");
});

test("toggleSectionCollapse collapses when currently expanded", () => {
  const section = createSectionWithClass([]);
  const toggle = { textContent: "" };

  const expanded = toggleSectionCollapse(section, toggle, {
    collapsedClass: "is-collapsed",
    expandText: "展开",
    collapseText: "收起"
  });

  assert.equal(expanded, false);
  assert.equal(section._set.has("is-collapsed"), true);
  assert.equal(toggle.textContent, "展开");
});

test("toggleSectionCollapse returns false for invalid elements", () => {
  assert.equal(toggleSectionCollapse(null, { textContent: "" }), false);
  assert.equal(toggleSectionCollapse(createSectionWithClass(["is-collapsed"]), null), false);
});
