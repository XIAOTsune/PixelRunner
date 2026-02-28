const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

const EXPECTED_EXPORTS = [
  "captureSelection",
  "placeImage",
  "createNeutralGrayLayer",
  "createObserverLayer",
  "stampVisibleLayers",
  "runGaussianBlur",
  "runSharpen",
  "runHighPass",
  "runContentAwareFill",
  "runSelectAndMask"
];

function clearPsModuleCache() {
  const keys = Object.keys(require.cache);
  keys.forEach((key) => {
    const normalized = String(key || "").replace(/\\/g, "/");
    if (
      normalized.includes("/src/services/ps.js")
      || normalized.includes("/src/services/ps/")
      || normalized.includes("/src/diagnostics/ps-env-doctor.js")
    ) {
      delete require.cache[key];
    }
  });
}

function withMockedPsHostModules(run) {
  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === "photoshop") {
      return {
        app: {},
        core: {},
        action: {}
      };
    }
    if (request === "uxp") {
      return {
        storage: {
          localFileSystem: {},
          formats: {}
        }
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    clearPsModuleCache();
    return run();
  } finally {
    Module._load = originalLoad;
    clearPsModuleCache();
  }
}

test("ps facade keeps stable public exports", () => {
  withMockedPsHostModules(() => {
    const psFacade = require("../../../src/services/ps");
    const keys = Object.keys(psFacade).sort();
    assert.deepEqual(keys, [...EXPECTED_EXPORTS].sort());
    EXPECTED_EXPORTS.forEach((key) => {
      assert.equal(typeof psFacade[key], "function", `${key} should be a function`);
    });
  });
});

test("ps facade re-exports functions from split modules", () => {
  withMockedPsHostModules(() => {
    const psFacade = require("../../../src/services/ps");
    const capture = require("../../../src/services/ps/capture");
    const place = require("../../../src/services/ps/place");
    const tools = require("../../../src/services/ps/tools");

    assert.equal(psFacade.captureSelection, capture.captureSelection);
    assert.equal(psFacade.placeImage, place.placeImage);
    assert.equal(psFacade.createNeutralGrayLayer, tools.createNeutralGrayLayer);
    assert.equal(psFacade.createObserverLayer, tools.createObserverLayer);
    assert.equal(psFacade.stampVisibleLayers, tools.stampVisibleLayers);
    assert.equal(psFacade.runGaussianBlur, tools.runGaussianBlur);
    assert.equal(psFacade.runSharpen, tools.runSharpen);
    assert.equal(psFacade.runHighPass, tools.runHighPass);
    assert.equal(psFacade.runContentAwareFill, tools.runContentAwareFill);
    assert.equal(psFacade.runSelectAndMask, tools.runSelectAndMask);
  });
});

test("ps facade contract stays in sync with diagnostics export checks", () => {
  withMockedPsHostModules(() => {
    const psFacade = require("../../../src/services/ps");
    const { REQUIRED_PS_EXPORTS } = require("../../../src/diagnostics/ps-env-doctor");
    assert.deepEqual([...REQUIRED_PS_EXPORTS].sort(), Object.keys(psFacade).sort());
  });
});
