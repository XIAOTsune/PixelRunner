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
        uploadRetryCount: 4,
        uploadTargetBytes: 8_800_000,
        uploadHardLimitBytes: 9_900_000,
        uploadAutoCompressEnabled: false,
        uploadCompressFormat: "jpeg",
        pasteStrategy: "smart",
        cloudConcurrentJobs: 8
      })
    }
  });

  assert.deepEqual(result, {
    apiKey: "abc",
    pollInterval: 3,
    timeout: 210,
    uploadRetryCount: 4,
    uploadTargetBytes: 8_800_000,
    uploadHardLimitBytes: 9_900_000,
    uploadAutoCompressEnabled: false,
    uploadCompressFormat: "jpeg",
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
    uploadRetryCount: 3,
    uploadTargetBytes: 8_000_000,
    uploadHardLimitBytes: 9_000_000,
    uploadAutoCompressEnabled: true,
    uploadCompressFormat: "jpeg",
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
      uploadRetryCount: 3,
      uploadTargetBytes: 8_000_000,
      uploadHardLimitBytes: 9_000_000,
      uploadAutoCompressEnabled: true,
      uploadCompressFormat: "jpeg",
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
    uploadRetryCount: "oops",
    uploadTargetBytes: "oops",
    uploadHardLimitBytes: 100,
    uploadAutoCompressEnabled: "no",
    uploadCompressFormat: "png",
    pasteStrategy: "",
    cloudConcurrentJobs: "oops"
  });

  assert.deepEqual(payload, {
    pollInterval: 2,
    timeout: 180,
    uploadRetryCount: 2,
    uploadTargetBytes: 9000000,
    uploadHardLimitBytes: 9000000,
    uploadAutoCompressEnabled: false,
    uploadCompressFormat: "jpeg",
    pasteStrategy: "",
    cloudConcurrentJobs: 2
  });
});
