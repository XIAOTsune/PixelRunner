const test = require("node:test");
const assert = require("node:assert/strict");
const {
  loadSettingsSnapshotUsecase,
  getSavedApiKeyUsecase,
  testApiKeyUsecase,
  saveSettingsUsecase
} = require("../../../src/application/usecases/manage-settings");

test("loadSettingsSnapshotUsecase reads api key and settings", () => {
  const result = loadSettingsSnapshotUsecase({
    store: {
      getApiKey: () => "abc",
      getSettings: () => ({
        pollInterval: 3,
        timeout: 210,
        uploadMaxEdge: 2048,
        pasteStrategy: "smart",
        cloudConcurrentJobs: 8
      })
    }
  });

  assert.deepEqual(result, {
    apiKey: "abc",
    pollInterval: 3,
    timeout: 210,
    uploadMaxEdge: 2048,
    pasteStrategy: "smart",
    cloudConcurrentJobs: 8
  });
});

test("getSavedApiKeyUsecase trims api key", () => {
  const result = getSavedApiKeyUsecase({
    store: {
      getApiKey: () => "  key-1  "
    }
  });
  assert.equal(result, "key-1");
});

test("testApiKeyUsecase validates and delegates to runninghub", async () => {
  await assert.rejects(
    () =>
      testApiKeyUsecase({
        runninghub: {
          testApiKey: async () => ({ message: "ok" })
        },
        apiKey: " "
      }),
    /API Key/
  );

  const result = await testApiKeyUsecase({
    runninghub: {
      testApiKey: async (apiKey) => ({ ok: true, apiKey })
    },
    apiKey: "  hello "
  });
  assert.deepEqual(result, { ok: true, apiKey: "hello" });
});

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
    pasteStrategy: "smart",
    cloudConcurrentJobs: 6
  });

  assert.deepEqual(result, { apiKeyChanged: true, settingsChanged: true });
  assert.deepEqual(calls[0], ["saveApiKey", "key-123"]);
  assert.deepEqual(calls[1], [
    "saveSettings",
    {
      pollInterval: 5,
      timeout: 240,
      uploadMaxEdge: 2048,
      pasteStrategy: "smart",
      cloudConcurrentJobs: 6
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
    pasteStrategy: "",
    cloudConcurrentJobs: "oops"
  });

  assert.deepEqual(payload, {
    pollInterval: 2,
    timeout: 180,
    uploadMaxEdge: 0,
    pasteStrategy: "",
    cloudConcurrentJobs: 2
  });
});
