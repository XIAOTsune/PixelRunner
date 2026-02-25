const test = require("node:test");
const assert = require("node:assert/strict");
const { createInputRenderer } = require("../../../src/controllers/workspace/input-renderer");

function createFakeClassList(owner) {
  return {
    add(...tokens) {
      tokens.forEach((token) => owner._classes.add(token));
    },
    remove(...tokens) {
      tokens.forEach((token) => owner._classes.delete(token));
    },
    toggle(token, force) {
      if (force === undefined) {
        if (owner._classes.has(token)) {
          owner._classes.delete(token);
          return false;
        }
        owner._classes.add(token);
        return true;
      }
      if (force) owner._classes.add(token);
      else owner._classes.delete(token);
      return Boolean(force);
    },
    contains(token) {
      return owner._classes.has(token);
    }
  };
}

function createFakeElement(tagName) {
  const element = {
    tagName: String(tagName || "div").toUpperCase(),
    style: {},
    dataset: {},
    children: [],
    className: "",
    textContent: "",
    value: "",
    type: "",
    placeholder: "",
    rows: 0,
    wrap: "",
    _innerHTML: "",
    _listeners: {},
    _classes: new Set(),
    classList: null,
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    addEventListener(type, handler) {
      this._listeners[type] = handler;
    },
    querySelector() {
      return null;
    }
  };
  Object.defineProperty(element, "innerHTML", {
    get() {
      return this._innerHTML;
    },
    set(value) {
      this._innerHTML = String(value || "");
    }
  });
  element.classList = createFakeClassList(element);
  return element;
}

function withFakeDocument(run) {
  const originalDocument = global.document;
  global.document = {
    createElement: (tagName) => createFakeElement(tagName)
  };
  try {
    return run();
  } finally {
    global.document = originalDocument;
  }
}

function createRenderer(records) {
  const state = { inputValues: {} };
  return createInputRenderer({
    state,
    ps: {},
    log: () => {},
    escapeHtml: (value) => String(value || ""),
    inputPolicy: {
      resolveUiInputType: (input) => String((input && input.type) || "text"),
      isPromptLikeField: () => false,
      getInputOptionEntries: () => [],
      isLongTextInput: () => false
    },
    isEmptyValue: (value) => value === undefined || value === null || value === "",
    openTemplatePicker: () => {},
    onPromptLargeValue: () => {},
    setInputValueByKey: (key, value) => {
      records.setCalls.push([key, value]);
    },
    deleteInputValueByKey: (key) => {
      records.deleteCalls.push(key);
    },
    getInputValueByKey: () => undefined,
    clearImageInputByKey: () => {},
    applyCapturedImageByKey: () => {},
    revokePreviewUrl: () => {},
    createPreviewUrlFromBuffer: () => "blob:test"
  });
}

test("createInputField optional boolean without default keeps value unset until user selects", () =>
  withFakeDocument(() => {
    const records = { setCalls: [], deleteCalls: [] };
    const renderer = createRenderer(records);
    const wrapper = renderer.createInputField({
      key: "opt:boolean",
      type: "boolean",
      required: false
    }, 0);
    const inputEl = wrapper.children[1];

    assert.equal(inputEl.value, "");
    assert.equal(records.setCalls.length, 0);

    inputEl.value = "true";
    inputEl._listeners.change({ target: inputEl });
    assert.deepEqual(records.setCalls, [["opt:boolean", true]]);

    inputEl.value = "";
    inputEl._listeners.change({ target: inputEl });
    assert.deepEqual(records.deleteCalls, ["opt:boolean"]);
  }));

test("createInputField optional number without default keeps value unset and clears on empty input", () =>
  withFakeDocument(() => {
    const records = { setCalls: [], deleteCalls: [] };
    const renderer = createRenderer(records);
    const wrapper = renderer.createInputField({
      key: "opt:number",
      type: "number",
      required: false
    }, 0);
    const inputEl = wrapper.children[1];

    assert.equal(inputEl.value, "");
    assert.equal(records.setCalls.length, 0);

    inputEl.value = "12";
    inputEl._listeners.input({ target: inputEl });
    assert.deepEqual(records.setCalls, [["opt:number", 12]]);

    inputEl.value = "";
    inputEl._listeners.input({ target: inputEl });
    assert.deepEqual(records.deleteCalls, ["opt:number"]);
  }));

test("createInputField boolean with explicit default still initializes stored value", () =>
  withFakeDocument(() => {
    const records = { setCalls: [], deleteCalls: [] };
    const renderer = createRenderer(records);
    renderer.createInputField({
      key: "enabled",
      type: "boolean",
      required: false,
      default: false
    }, 0);

    assert.deepEqual(records.setCalls, [["enabled", false]]);
    assert.deepEqual(records.deleteCalls, []);
  }));
