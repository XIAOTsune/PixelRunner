import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseRunningHubProgress, normalizeRunningHubStep, extractRunningHubTaskCostTime } from "../src/shared/runninghub-progress.js";
import { getRunningHubSafeError } from "../src/shared/runninghub-error-hints.js";
import { observeRunningHubProgress, readRunningHubProgress, stopRunningHubProgress, isRunningHubWssUrl } from "../src/host/runninghub-progress.js";
import { submitRunningHubTask, pollRunningHubTask, fetchRunningHubTaskStatus, cancelRunningHubTask } from "../src/host/runninghub.js";
import { createBridgeResponse } from "../src/host/bridge.js";

const secret = "PRIVATE_WORKFLOW_7469";
const url = `wss://www.runninghub.cn:443/ws/c_instance?Rh-Comfy-Auth=${secret}&clientId=private-client`;
const privateFields = { node: secret, nodes: [secret], node_name: secret, node_id: secret,
  current_inputs: secret, outputs: secret, traceback: secret, promptTips: secret,
  outputs_to_execute: [secret], node_errors: { [secret]: secret }, netWssUrl: url };
function noPrivate(value) {
  assert.doesNotMatch(JSON.stringify(value), /PRIVATE_WORKFLOW|private-client|Rh-Comfy-Auth|netWssUrl|promptTips|outputs_to_execute|node_errors|node_name|node_id|traceback|current_inputs/);
}
let groups = 0;
async function check(name, run) { await run(); groups++; console.log(`PASS ${name}`); }
const original = { fetch: globalThis.fetch, WebSocket: globalThis.WebSocket, now: Date.now, setTimeout: globalThis.setTimeout };
const logs = [];
const realConsole = { log: console.log, warn: console.warn, error: console.error, info: console.info };
class FakeSocket {
  static instances = [];
  constructor(address) { this.address = address; this.closed = false; FakeSocket.instances.push(this); }
  open() { this.onopen?.(); }
  sendEvent(event) { this.onmessage?.({ data: JSON.stringify(event) }); }
  close() { this.closed = true; }
}
const payload = { apiKey: "isolated-test-key", appId: "isolated-app", region: "cn", app: { inputs: [] }, inputs: {}, settings: { timeout: 10, pollInterval: 1 } };
const response = (data, status = 200) => ({ ok: status < 400, status, text: async () => JSON.stringify(data) });
let sequence = 0;
const id = () => `privacy-task-${++sequence}`;
const snapshot = taskId => readRunningHubProgress([[{ taskId, region: "cn" }]])[0];

try {
  await check("value/max validation, clamping and event projection", () => {
    for (const [value, max, expected] of [[0, 10, { value: 0, max: 10 }], ["5", "10", { value: 5, max: 10 }],
      [50, 10, { value: 10, max: 10 }], [1.5, 2, { value: 1.5, max: 2 }]]) {
      assert.deepEqual(normalizeRunningHubStep(value, max), expected);
    }
    for (const [value, max] of [[-1, 10], [1, 0], [1, -2], [null, 2], [true, 2], ["", 2], ["NaN", 10],
      [Infinity, 2], [1, Infinity], [1, "0x10"], [{}, 2], [[], 2], [Number.MAX_VALUE, 2], [1, "1e3"]]) {
      assert.equal(normalizeRunningHubStep(value, max), null);
    }
    const parsed = parseRunningHubProgress(JSON.stringify({ type: "progress", data: { ...privateFields, value: 5, max: 10 } }));
    assert.deepEqual(parsed, { phase: "running", step: { value: 5, max: 10 } }); noPrivate(parsed);
    for (const type of ["executing", "execution_start", "execution_cached", "execution_success"]) {
      const event = parseRunningHubProgress(JSON.stringify({ type, data: privateFields }));
      assert.deepEqual(event, { phase: "running", step: null }); noPrivate(event);
    }
    for (const invalid of ["{", "null", "[]", new ArrayBuffer(8), "x".repeat(65537), JSON.stringify({ type: "execution_error", data: privateFields })]) {
      assert.equal(parseRunningHubProgress(invalid), null);
    }
  });

  await check("V1/V2 platform duration: no coercion, addition or child-task approximation", () => {
    assert.equal(extractRunningHubTaskCostTime({ usage: { taskCostTime: "12.5" } }), 12.5);
    assert.equal(extractRunningHubTaskCostTime({ data: { usage: { taskCostTime: 0 } } }), 0);
    assert.equal(extractRunningHubTaskCostTime({ code: 0, data: [{ taskCostTime: "83" }, { taskCostTime: "83" }] }), 83);
    for (const invalid of [null, {}, { usage: { taskCostTime: -1 } }, { usage: { taskCostTime: "12s" } },
      { usage: { taskCostTime: true } }, { usage: { taskCostTime: "Infinity" } }, [{ taskCostTime: "83" }, {}],
      [{ taskCostTime: "83" }, { taskCostTime: "84" }], { taskUsageList: [{ usage: { taskCostTime: "12" } }] }]) {
      assert.equal(extractRunningHubTaskCostTime(invalid), null);
    }
  });

  await check("WSS regional permission boundary, reset, expiry, late events and cleanup", () => {
    globalThis.WebSocket = FakeSocket;
    assert.equal(isRunningHubWssUrl(url, "cn"), true);
    assert.equal(isRunningHubWssUrl(url.replace(".cn", ".ai"), "global"), true);
    for (const invalid of [url.replace("wss:", "ws:"), url.replace("wss:", "https:"), url.replace(".cn", ".cn.evil.test"),
      url.replace(":443", ":8443"), url.replace("www.", "user@www."), url + "#fragment", url.replace("/ws/c_instance", "/other")]) {
      assert.equal(isRunningHubWssUrl(invalid, "cn"), false);
    }
    assert.equal(isRunningHubWssUrl(url, "global"), false);
    const taskId = id(); observeRunningHubProgress(taskId, "cn", { data: privateFields }, "running");
    const socket = FakeSocket.instances.at(-1); socket.open();
    socket.sendEvent({ type: "progress", data: { ...privateFields, value: 3, max: 4 } });
    assert.deepEqual(snapshot(taskId).step, { value: 3, max: 4 }); noPrivate(snapshot(taskId));
    socket.sendEvent({ type: "executing", data: privateFields }); assert.equal(snapshot(taskId).step, null);
    socket.sendEvent({ type: "progress", data: { value: 4, max: 4 } });
    const now = Date.now(); Date.now = () => now + 11000;
    assert.equal(snapshot(taskId).step, null); Date.now = original.now;
    socket.sendEvent({ type: "progress", data: { value: 2, max: 4 } });
    socket.onerror({ message: url }); assert.equal(snapshot(taskId).step, null); assert.equal(snapshot(taskId).channel, "unavailable");
    assert.equal(socket.closed, true); stopRunningHubProgress(taskId, "cn");
    assert.equal(snapshot(taskId).phase, "");
  });

  await check("connection timeout and idle expiry are executable without a live service", () => {
    let connectTimeout; let idleTimeout;
    globalThis.setTimeout = (callback, delay, ...args) => {
      if (delay === 8000) { connectTimeout = callback; return { unref() {} }; }
      if (delay === 300000) { idleTimeout = callback; return { unref() {} }; }
      return original.setTimeout(callback, delay, ...args);
    };
    const taskId = id(); observeRunningHubProgress(taskId, "cn", { data: { netWssUrl: url } });
    assert.equal(snapshot(taskId).channel, "connecting"); connectTimeout();
    assert.equal(snapshot(taskId).channel, "unavailable");
    idleTimeout(); assert.equal(snapshot(taskId).phase, "");
    globalThis.setTimeout = original.setTimeout;
  });

  // Compress only poll sleeps. The 8-second WSS and HTTP timeout logic is tested separately.
  globalThis.setTimeout = (fn, ms, ...args) => original.setTimeout(fn, ms === 1000 ? 0 : ms, ...args);
  for (const mode of ["unsupported", "constructor-error", "disconnect", "socket-success-before-rest"]) {
    await check(`REST completion continues with WSS ${mode}`, async () => {
      const taskId = id(); let queries = 0;
      globalThis.WebSocket = mode === "unsupported" ? undefined : mode === "constructor-error"
        ? class { constructor() { throw new Error(url); } } : FakeSocket;
      for (const key of Object.keys(realConsole)) console[key] = (...args) => logs.push(args);
      globalThis.fetch = async address => {
        if (String(address).endsWith("/ai-app/run")) return response({ code: 0, data: { ...privateFields, taskId, taskStatus: "RUNNING" } });
        assert.match(String(address), /\/openapi\/v2\/query$/);
        queries++;
        if (queries === 1 && ["disconnect", "socket-success-before-rest"].includes(mode)) {
          const socket = FakeSocket.instances.at(-1); socket.open();
          if (mode === "disconnect") socket.onclose({ reason: url });
          else socket.sendEvent({ type: "execution_success", data: privateFields });
        }
        return response({ data: { ...privateFields, status: queries === 1 ? "RUNNING" : "SUCCESS",
          results: [{ url: "https://example.test/result.png" }], usage: { taskCostTime: "12", settleMode: "POINT", chargedPoint: "1.28" } } });
      };
      const submitted = await submitRunningHubTask([payload]); noPrivate(submitted);
      assert.deepEqual(Object.keys(submitted).sort(), ["ok", "region", "status", "taskId"]);
      const result = await pollRunningHubTask([{ ...payload, taskId }]); noPrivate(result);
      assert.equal(queries, 2, "WSS success and a REST preview must not complete the task");
      assert.equal(result.status, "SUCCEEDED"); assert.equal(result.taskCostTime, 12); assert.equal(result.pointsCharge, 1.28);
      assert.equal(snapshot(taskId).phase, "", "terminal REST success disposes the socket");
      for (const key of Object.keys(realConsole)) console[key] = realConsole[key];
    });
  }

  await check("804/813 including HTTP errors remain running/queued, never failed", async () => {
    for (const code of [804, 813, "APIKEY_TASK_IS_RUNNING", "APIKEY_TASK_IS_QUEUED"]) {
      const taskId = id(); let queries = 0;
      globalThis.fetch = async address => {
        assert.match(String(address), /\/openapi\/v2\/query$/);
        queries++;
        return response({ code, msg: "API error " + secret, data: { status: "FAILED", ...privateFields } }, 400);
      };
      const result = await fetchRunningHubTaskStatus([{ ...payload, taskId }]);
      assert.equal(queries, 1, "pending codes must not trigger V1 fallback");
      assert.equal(result.failed, false); assert.equal(result.stillRunning, true);
      assert.equal(result.status, [813, "APIKEY_TASK_IS_QUEUED"].includes(code) ? "QUEUED" : "RUNNING");
      assert.equal(result.outputUrl, ""); noPrivate(result); stopRunningHubProgress(taskId, "cn");
    }
  });

  await check("transient REST errors and unknown statuses cannot become final success", async () => {
    globalThis.WebSocket = undefined;
    const taskId = id(); let queries = 0;
    globalThis.fetch = async address => {
      assert.match(String(address), /\/openapi\/v2\/query$/);
      queries++;
      if (queries === 1) return response({ message: `network unavailable ${secret}` }, 503);
      if (queries === 2) return response({ data: { status: secret, results: [{ url: "https://example.test/preview.png" }] } });
      return response({ data: { status: "SUCCESS", usage: { taskCostTime: "invalid" }, results: [{ url: "https://example.test/final.png" }] } });
    };
    const result = await pollRunningHubTask([{ ...payload, taskId }]);
    assert.equal(queries, 3); assert.equal(result.status, "SUCCEEDED"); assert.equal(result.taskCostTime, null); noPrivate(result);
  });

  await check("V1 failure, error text, bridge errors and logs contain only safe diagnostics", async () => {
    const taskId = id();
    globalThis.fetch = async address => String(address).endsWith("/openapi/v2/query")
      ? response({ message: "endpoint not found" }, 404)
      : response({ code: 805, msg: "API_TASK_STATUS_ERROR", data: { failedReason: { ...privateFields, exception_message: secret } } });
    const failed = await pollRunningHubTask([{ ...payload, taskId }]);
    assert.equal(failed.failed, true); assert.equal(failed.errorCode, 805); noPrivate(failed);
    for (const message of [JSON.stringify(privateFields), `insufficient balance; node_name=${secret}`, `中文错误 ${secret} traceback`,
      `RunningHub 任务执行失败 ${secret}`, `ValueError in ${secret}`, `wss://example.test?token=${secret}`]) {
      noPrivate(getRunningHubSafeError(message, 416)); noPrivate(getRunningHubSafeError(message));
      const error = Object.assign(new Error(message), { errorCode: 416, errorMessage: message, raw: privateFields });
      noPrivate(createBridgeResponse({ id: "isolated", method: "runninghub.submitTask" }, null, error));
    }
    noPrivate(logs);
  });

  await check("V1 late WSS and task duration preserve repeated-output point settlement", async () => {
    const taskId = id(); let calls = 0; globalThis.WebSocket = FakeSocket;
    globalThis.fetch = async address => {
      assert.match(String(address), /\/task\/openapi\/outputs$/);
      calls++;
      return response(calls === 1 ? { code: 804, data: { ...privateFields } }
        : { code: 0, data: [1, 2].map(nodeId => ({ ...privateFields, nodeId, fileUrl: "https://example.test/v1.png", fileType: "png", taskCostTime: "83", settleMode: "POINT", chargedPoint: "1.28" })) });
    };
    const result = await pollRunningHubTask([{ ...payload, taskId }]);
    assert.equal(calls, 2); assert.equal(result.taskCostTime, 83); assert.equal(result.pointsCharge, 1.28); noPrivate(result);
  });

  await check("cancellation closes host monitor and does not expose cancel response", async () => {
    const taskId = id(); observeRunningHubProgress(taskId, "cn", { data: privateFields });
    const socket = FakeSocket.instances.at(-1);
    globalThis.fetch = async () => response({ code: 0, data: privateFields });
    noPrivate(await cancelRunningHubTask([{ ...payload, taskId }]));
    assert.equal(socket.closed, true); assert.equal(snapshot(taskId).phase, "");
  });

  await check("UI state, rendering, optional-channel failure and late replies", async () => {
    globalThis.window = { setInterval: () => 1, clearInterval() {}, setTimeout: () => 1, clearTimeout() {},
      PixelRunnerModules: { runtime: { escapeHtml: value => String(value).replaceAll("<", "&lt;"), getById: () => null, isPluginRuntime: () => true },
        state: { state: { runningTasks: [], settings: { maxConcurrentTasks: 3 } }, DEFAULT_SETTINGS: { maxConcurrentTasks: 3 },
          RUNNINGHUB_REGIONS: { CN: "cn", GLOBAL: "global" }, normalizeRunningHubRegion: value => value === "global" ? "global" : "cn" } } };
    globalThis.document = { querySelectorAll: () => [] };
    await import("../src/webview/workspace.js");
    const modules = window.PixelRunnerModules; const workspace = modules.workspace;
    const taskId = id(); workspace.upsertRunningTask({ taskId, status: "running", region: "cn" });
    modules.runtime.callHost = async () => [{ ...privateFields, taskId, region: "cn", phase: "running", step: { ...privateFields, value: 4, max: 8 }, channel: "connected" }];
    await workspace.refreshRunningHubProgress();
    let task = modules.state.state.runningTasks[0]; noPrivate(task);
    assert.match(workspace.renderRunningTaskList([task]), /当前步骤进度 50%（非任务总进度）/);
    noPrivate(workspace.renderRunningTaskList([task]));
    modules.runtime.callHost = async () => { throw new Error(url); };
    await workspace.refreshRunningHubProgress();
    task = modules.state.state.runningTasks[0]; assert.equal(task.status, "remote-running"); assert.equal(task.stepProgress, null);
    assert.match(workspace.getRunningHubProgressMarkup(task), /is-indeterminate/);
    assert.match(workspace.getRunningHubProgressMarkup(task), /状态轮询继续/);
    let cardWrites = 0;
    const taskList = {};
    Object.defineProperty(taskList, "innerHTML", { set() { cardWrites++; } });
    const savedTasks = modules.state.state.runningTasks;
    modules.state.state.runningTasks = [task];
    modules.runtime.getById = name => name === "runningTaskList" ? taskList : null;
    workspace.updateRunButtonState();
    workspace.updateRunButtonState();
    assert.equal(cardWrites, 1, "an unchanged timer tick must preserve card DOM and its animation");
    modules.runtime.getById = () => null;
    modules.state.state.runningTasks = savedTasks;
    for (const status of ["queued", "downloading", "placing"]) {
      const markup = workspace.getRunningHubProgressMarkup({ ...task, status, stepProgress: { value: 1, max: 2 } });
      assert.match(markup, /is-indeterminate/); assert.doesNotMatch(markup, /aria-valuenow|50%/);
    }
    for (const status of ["succeeded", "downloading", "placing", "placement-failed"]) {
      const markup = workspace.renderRunningTaskList([{ taskId: id(), provider: "runninghub", status, taskCostTime: "83" }]);
      assert.doesNotMatch(markup, /总耗时|平台生成耗时/);
    }
    const safeTask = workspace.upsertRunningTask({ taskId: id(), status: "failed", errorCode: 805, errorMessage: JSON.stringify(privateFields), platformErrorMessage: secret, platformErrorRaw: privateFields, ...privateFields });
    noPrivate(safeTask); noPrivate(workspace.renderRunningTaskList([safeTask]));
    let resolve; modules.runtime.callHost = () => new Promise(done => { resolve = done; });
    const pending = workspace.refreshRunningHubProgress();
    workspace.upsertRunningTask({ taskId, status: "placing", taskCostTime: 83 });
    resolve([{ taskId, region: "cn", phase: "running", step: { value: 5, max: 10 } }]);
    await pending; assert.equal(modules.state.state.runningTasks.find(item => item.taskId === taskId).status, "placing");
  });

  await check("generative-fill cards share safe progress without replacing the prompt editor", async () => {
    const modules = window.PixelRunnerModules;
    await import("../src/webview/generative-fill.js");
    const list = { innerHTML: "" };
    const surface = { querySelector: selector => selector === ".generative-fill-task-list" ? list : null };
    Object.defineProperty(surface, "innerHTML", { set() { assert.fail("progress refresh must not replace the prompt editor"); } });
    modules.runtime.getById = name => name === "generativeFillSurface" ? surface : null;
    modules.state.state.workspaceMode = "generative-fill";
    const taskId = id();
    modules.state.state.runningTasks.push({ taskId, status: "remote-running", kind: "generative-fill", region: "cn" });
    modules.workspace.upsertRunningTask({ taskId, stepProgress: { value: 2, max: 4 }, progressChannel: "connected" });
    assert.match(list.innerHTML, /当前步骤进度 50%（非任务总进度）/); noPrivate(list.innerHTML);
    const taskMarkup = modules.generativeFill.renderTaskList([{ taskId, status: "succeeded", taskCostTime: 83 }]);
    assert.doesNotMatch(taskMarkup, /总耗时|平台生成耗时|00:/);
    modules.runtime.getById = () => null;
    modules.state.state.workspaceMode = "workspace";
  });

  await check("workspace backups exclude monitoring secrets and keep configured application inputs", async () => {
    let saved;
    globalThis.localStorage = { setItem: (_, value) => { saved = value; } };
    window.PixelRunnerModules.state.STORAGE_KEYS = { WORKSPACE_BACKUP: "isolated-backup" };
    delete window.uxp; delete window.uxpHost;
    await import("../src/webview/runtime.js");
    await window.PixelRunnerModules.runtime.saveWorkspaceBackup({ apps: [{ id: "app", ...privateFields, inputs: [{ nodeId: "configured-input", fieldName: "image" }], monitoringUrl: url }], templates: [] });
    // Only fields belonging to monitoring responses are excluded; submission inputs are user data.
    const app = JSON.parse(saved).apps[0];
    for (const key of ["netWssUrl", "clientId", "promptTips", "outputs_to_execute", "node_errors", "platformErrorRaw"]) assert.equal(Object.hasOwn(app, key), false);
    assert.equal(app.monitoringUrl, ""); assert.equal(app.inputs[0].nodeId, "configured-input");
  });

  await check("manifest WSS grants are explicit and scoped to host; no workflow progress API", async () => {
    const manifest = JSON.parse(await readFile(new URL("../manifest.json", import.meta.url), "utf8"));
    for (const suffix of ["cn", "ai"]) assert.ok(manifest.requiredPermissions.network.domains.includes(`wss://www.runninghub.${suffix}`));
    assert.ok(!manifest.requiredPermissions.webview.domains.some(domain => domain.startsWith("wss:")));
    for (const name of ["host/runninghub-progress.js", "shared/runninghub-progress.js"]) {
      const source = await readFile(new URL(`../src/${name}`, import.meta.url), "utf8");
      assert.doesNotMatch(source, /getJsonApiFormat|get_node_id_name_map|parseRunningHubApp/);
    }
  });
} finally {
  Object.assign(globalThis, { fetch: original.fetch, WebSocket: original.WebSocket, setTimeout: original.setTimeout });
  Date.now = original.now;
  Object.assign(console, realConsole);
  for (let i = 1; i <= sequence; i++) stopRunningHubProgress(`privacy-task-${i}`, "cn");
}
console.log(`RunningHub privacy/progress: ${groups} scenario groups passed.`);
