const test = require("node:test");
const assert = require("node:assert/strict");
const { saveSettingsUsecase } = require("../../../src/application/usecases/manage-settings");

test("saveSettingsUsecase saves api key and settings payload", () => {
  const calls = [];
  const store = {
    getSettings: () => ({ pollInterval: 2, timeout: 180 }),
    saveApiKey: (value) => calls.push(["saveApiKey", value]),
    saveSettings: (value) => calls.push(["saveSettings", value])
  };

  const result = saveSettingsUsecase({
    store,
    apiKey: "  key-123  ",
    pollInterval: 5,
    timeout: 240,
    uploadMaxEdge: 2048,
    pasteStrategy: "smart"
  });

  assert.deepEqual(result, { apiKeyChanged: true, settingsChanged: true });
  assert.deepEqual(calls[0], ["saveApiKey", "key-123"]);
  assert.deepEqual(calls[1], [
    "saveSettings",
    {
      pollInterval: 5,
      timeout: 240,
      uploadMaxEdge: 2048,
      pasteStrategy: "smart"
    }
  ]);
});

test("saveSettingsUsecase falls back to defaults for invalid values", () => {
  let payload = null;
  const store = {
    getSettings: () => ({}),
    saveApiKey: () => {},
    saveSettings: (value) => {
      payload = value;
    }
  };

  saveSettingsUsecase({
    store,
    apiKey: "",
    pollInterval: "invalid",
    timeout: null,
    uploadMaxEdge: undefined,
    pasteStrategy: ""
  });

  assert.deepEqual(payload, {
    pollInterval: 2,
    timeout: 180,
    uploadMaxEdge: 0,
    pasteStrategy: ""
  });
});
