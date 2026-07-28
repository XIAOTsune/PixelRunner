import assert from "node:assert/strict";
import { createHostLicenseStorage } from "../src/host/license-storage.js";

class MemoryStorage {
  constructor() {
    this.values = new Map();
  }

  getItem(key) {
    return this.values.has(key) ? this.values.get(key) : null;
  }

  setItem(key, value) {
    this.values.set(key, String(value));
  }
}

class SilentWriteFailureStorage {
  getItem() {
    return null;
  }

  setItem() {}
}

const durableStorage = createHostLicenseStorage(() => new MemoryStorage());
assert.equal(durableStorage.setItem("pixelrunner.license.test", "stored"), true);

const unavailableStorage = createHostLicenseStorage(() => null);
assert.throws(() => unavailableStorage.getItem("pixelrunner.license.test"), /Host 未提供可用的授权存储/);
assert.throws(() => unavailableStorage.setItem("pixelrunner.license.test", "value"), /Host 未提供可用的授权存储/);

const silentWriteStorage = createHostLicenseStorage(() => new SilentWriteFailureStorage());
assert.throws(
  () => silentWriteStorage.setItem("pixelrunner.license.test", "value"),
  /Host 授权存储写入后校验失败/,
  "silent Host write failures must not be reported as saved"
);

const listeners = new Map();
let bridgeResponse = { result: false };
let browserWriteCount = 0;
globalThis.window = {
  PixelRunnerModules: {},
  addEventListener(type, listener) {
    listeners.set(type, listener);
  },
  localStorage: {
    getItem() { return null; },
    setItem() { browserWriteCount += 1; }
  },
  uxpHost: {
    postMessage(message) {
      queueMicrotask(() => {
        listeners.get("message")({ data: { id: message.id, ...bridgeResponse } });
      });
    }
  }
};

await import(`../src/webview/runtime.js?license-storage-test=${Date.now()}`);
const runtime = globalThis.window.PixelRunnerModules.runtime;
await assert.rejects(
  runtime.storageSetItem("pixelrunner.license.test", "value", { requireHost: true }),
  /宿主授权存储未确认写入/,
  "license storage must reject a Host false acknowledgement"
);
assert.equal(browserWriteCount, 0, "license storage must not fall back to WebView localStorage");

bridgeResponse = { result: true };
assert.equal(await runtime.storageSetItem("pixelrunner.license.test", "value", { requireHost: true }), true);

console.log("Host and WebView license storage tests passed.");
