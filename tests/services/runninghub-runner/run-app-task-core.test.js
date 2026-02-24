const test = require("node:test");
const assert = require("node:assert/strict");
const { runAppTaskCore } = require("../../../src/services/runninghub-runner");
const { RUNNINGHUB_ERROR_CODES } = require("../../../src/services/runninghub-error-codes");

test("runAppTaskCore throws local validation error when app has no submit params", async () => {
  await assert.rejects(
    () =>
      runAppTaskCore({
        apiKey: "api-key",
        appItem: { appId: "1", inputs: [] },
        inputValues: {},
        options: {},
        helpers: {}
      }),
    (error) => {
      assert.equal(error && error.code, "NO_PARAMETERS_TO_SUBMIT");
      assert.equal(error && error.localValidation, true);
      return true;
    }
  );
});

test("runAppTaskCore maps legacy create-task failure to structured error", async () => {
  const fetchImpl = async (_url, _init) => ({
    ok: false,
    status: 500,
    payload: { message: "server error" },
    json: async function json() {
      return this.payload;
    }
  });
  const parseJsonResponse = async (response) => response.payload;

  await assert.rejects(
    () =>
      runAppTaskCore({
        apiKey: "api-key",
        appItem: {
          appId: "1",
          inputs: [{ key: "prompt", type: "text", required: true, label: "Prompt" }]
        },
        inputValues: { prompt: "hello" },
        options: {},
        helpers: {
          fetchImpl,
          parseJsonResponse
        }
      }),
    (error) => {
      assert.equal(error && error.code, RUNNINGHUB_ERROR_CODES.LEGACY_TASK_CREATE_FAILED);
      assert.equal(error && error.channel, "legacy");
      assert.equal(error && error.responseStatus, 500);
      assert.equal(error && error.retryable, true);
      return true;
    }
  );
});

test("runAppTaskCore rethrows AI_APP_REJECTED without falling back to legacy", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return {
      ok: false,
      status: 400,
      payload: { message: "workflow disabled" },
      json: async function json() {
        return this.payload;
      }
    };
  };
  const parseJsonResponse = async (response) => response.payload;

  await assert.rejects(
    () =>
      runAppTaskCore({
        apiKey: "api-key",
        appItem: {
          appId: "1",
          inputs: [
            {
              key: "n1:prompt",
              type: "text",
              required: true,
              label: "Prompt",
              nodeId: "n1",
              fieldName: "prompt"
            }
          ]
        },
        inputValues: { "n1:prompt": "hello" },
        options: {},
        helpers: {
          fetchImpl,
          parseJsonResponse
        }
      }),
    (error) => {
      assert.equal(error && error.code, RUNNINGHUB_ERROR_CODES.AI_APP_REJECTED);
      return true;
    }
  );

  assert.equal(calls, 1);
});

test("runAppTaskCore rethrows RUN_CANCELLED from throwIfCancelled chain", async () => {
  const cancelled = new Error("cancelled");
  cancelled.code = RUNNINGHUB_ERROR_CODES.RUN_CANCELLED;

  await assert.rejects(
    () =>
      runAppTaskCore({
        apiKey: "api-key",
        appItem: {
          appId: "1",
          inputs: [{ key: "prompt", type: "text", required: true, label: "Prompt" }]
        },
        inputValues: { prompt: "hello" },
        options: {},
        helpers: {
          throwIfCancelled: () => {
            throw cancelled;
          }
        }
      }),
    (error) => {
      assert.equal(error, cancelled);
      return true;
    }
  );
});

test("runAppTaskCore does not retry upload-edge fallback on local validation errors", async () => {
  const logs = [];

  await assert.rejects(
    () =>
      runAppTaskCore({
        apiKey: "api-key",
        appItem: {
          appId: "1",
          inputs: [
            { key: "prompt", type: "text", required: true, label: "Prompt" },
            { key: "image", type: "image", required: false, label: "Image" }
          ]
        },
        inputValues: {},
        options: {
          uploadMaxEdge: 1024,
          log: (line, level) => logs.push({ line, level })
        },
        helpers: {}
      }),
    (error) => {
      assert.equal(error && error.code, RUNNINGHUB_ERROR_CODES.MISSING_REQUIRED_PARAMETER);
      return true;
    }
  );

  const retryLog = logs.find((item) => /Retrying task submission with relaxed upload limit/.test(item.line));
  assert.equal(Boolean(retryLog), false);
});
