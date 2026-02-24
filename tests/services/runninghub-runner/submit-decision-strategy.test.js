const test = require("node:test");
const assert = require("node:assert/strict");
const {
  hasAiPayload,
  hasLegacyPayload,
  submitTaskWithAiFallback
} = require("../../../src/services/runninghub-runner/submit-decision-strategy");

test("hasAiPayload and hasLegacyPayload detect submit channels", () => {
  assert.equal(hasAiPayload([]), false);
  assert.equal(hasAiPayload([{ nodeId: "1" }]), true);
  assert.equal(hasLegacyPayload({}), false);
  assert.equal(hasLegacyPayload({ prompt: "hello" }), true);
});

test("submitTaskWithAiFallback prefers AI channel when AI succeeds", async () => {
  let aiCalls = 0;
  let legacyCalls = 0;
  const taskId = await submitTaskWithAiFallback({
    nodeInfoList: [{ nodeId: "1", fieldName: "prompt", fieldValue: "cat" }],
    nodeParams: { prompt: "cat" },
    appId: "app-1",
    apiKey: "k",
    createAiAppTask: async () => {
      aiCalls += 1;
      return "task-ai";
    },
    createLegacyTask: async () => {
      legacyCalls += 1;
      return "task-legacy";
    }
  });

  assert.equal(taskId, "task-ai");
  assert.equal(aiCalls, 1);
  assert.equal(legacyCalls, 0);
});

test("submitTaskWithAiFallback falls back to legacy for retryable AI errors", async () => {
  const logs = [];
  let legacyCalls = 0;
  const taskId = await submitTaskWithAiFallback({
    nodeInfoList: [{ nodeId: "1", fieldName: "prompt", fieldValue: "cat" }],
    nodeParams: { prompt: "cat" },
    appId: "app-1",
    apiKey: "k",
    log: (line, level) => logs.push({ line, level }),
    createAiAppTask: async () => {
      throw new Error("ai temporary failed");
    },
    createLegacyTask: async () => {
      legacyCalls += 1;
      return "task-legacy";
    }
  });

  assert.equal(taskId, "task-legacy");
  assert.equal(legacyCalls, 1);
  assert.ok(logs.some((item) => item.level === "warn" && /fallback to legacy/.test(item.line)));
});

test("submitTaskWithAiFallback rethrows terminal AI errors", async () => {
  await assert.rejects(
    () =>
      submitTaskWithAiFallback({
        nodeInfoList: [{ nodeId: "1", fieldName: "prompt", fieldValue: "cat" }],
        nodeParams: { prompt: "cat" },
        appId: "app-1",
        apiKey: "k",
        createAiAppTask: async () => {
          const err = new Error("rejected");
          err.code = "AI_APP_REJECTED";
          throw err;
        },
        createLegacyTask: async () => "task-legacy"
      }),
    (error) => error && error.code === "AI_APP_REJECTED"
  );

  await assert.rejects(
    () =>
      submitTaskWithAiFallback({
        nodeInfoList: [{ nodeId: "1", fieldName: "prompt", fieldValue: "cat" }],
        nodeParams: { prompt: "cat" },
        appId: "app-1",
        apiKey: "k",
        createAiAppTask: async () => {
          const err = new Error("cancelled");
          err.code = "RUN_CANCELLED";
          throw err;
        },
        createLegacyTask: async () => "task-legacy"
      }),
    (error) => error && error.code === "RUN_CANCELLED"
  );
});

test("submitTaskWithAiFallback returns empty when no channel has payload", async () => {
  const taskId = await submitTaskWithAiFallback({
    nodeInfoList: [],
    nodeParams: {},
    appId: "app-1",
    apiKey: "k",
    createAiAppTask: async () => "task-ai",
    createLegacyTask: async () => "task-legacy"
  });
  assert.equal(taskId, "");
});
