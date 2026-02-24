const test = require("node:test");
const assert = require("node:assert/strict");
const { parseRunninghubAppUsecase } = require("../../../src/application/usecases/parse-runninghub-app");

test("parseRunninghubAppUsecase returns normalized parsed app data", async () => {
  const result = await parseRunninghubAppUsecase({
    runninghub: {
      fetchAppInfo: async () => ({
        name: "Remote Name",
        description: "desc",
        inputs: [{ key: "prompt", type: "text" }]
      })
    },
    appId: "app-1",
    apiKey: "key",
    preferredName: "Local Name",
    log: () => {}
  });

  assert.deepEqual(result, {
    appId: "app-1",
    name: "Local Name",
    description: "desc",
    inputs: [{ key: "prompt", type: "text" }]
  });
});

test("parseRunninghubAppUsecase throws when inputs are empty", async () => {
  await assert.rejects(
    () =>
      parseRunninghubAppUsecase({
        runninghub: {
          fetchAppInfo: async () => ({ inputs: [] })
        },
        appId: "app-2",
        apiKey: "key"
      }),
    /未识别到可用输入参数/
  );
});

test("parseRunninghubAppUsecase validates required args", async () => {
  await assert.rejects(
    () =>
      parseRunninghubAppUsecase({
        runninghub: {
          fetchAppInfo: async () => ({ inputs: [{ key: "a" }] })
        },
        appId: "",
        apiKey: "key"
      }),
    /应用 ID/
  );

  await assert.rejects(
    () =>
      parseRunninghubAppUsecase({
        runninghub: {
          fetchAppInfo: async () => ({ inputs: [{ key: "a" }] })
        },
        appId: "app-3",
        apiKey: ""
      }),
    /API Key/
  );
});
