const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

function clearPsToolsModuleCache() {
  const keys = Object.keys(require.cache);
  keys.forEach((key) => {
    const normalized = String(key || "").replace(/\\/g, "/");
    if (normalized.includes("/src/services/ps/tools.js")) {
      delete require.cache[key];
    }
  });
}

async function withMockedPhotoshop(host, run) {
  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === "photoshop") return host.photoshop;
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    clearPsToolsModuleCache();
    return await run();
  } finally {
    Module._load = originalLoad;
    clearPsToolsModuleCache();
  }
}

function createHost(options = {}) {
  const hasSelection = options.hasSelection !== false;
  const menuEntries = options.menuEntries && typeof options.menuEntries === "object"
    ? options.menuEntries
    : {};
  const menuStates = options.menuStates && typeof options.menuStates === "object"
    ? options.menuStates
    : {};
  const performResult = Object.prototype.hasOwnProperty.call(options, "performResult")
    ? options.performResult
    : true;
  const performError = options.performError || null;
  const batchThrowForObjects = new Set(
    Array.isArray(options.batchThrowForObjects) ? options.batchThrowForObjects : []
  );

  const batchCalls = [];
  const menuTitleCalls = [];
  const menuStateCalls = [];
  const performCalls = [];
  const modalCalls = [];
  const app = {
    activeDocument: {
      selection: hasSelection ? { bounds: [0, 0, 10, 10] } : {}
    }
  };

  const action = {
    batchPlay: async (commands = []) => {
      commands.forEach((command) => {
        batchCalls.push(command);
        if (batchThrowForObjects.has(String(command && command._obj))) {
          throw new Error(`${String(command && command._obj)} unavailable`);
        }
      });
      return [];
    }
  };

  const core = {
    getMenuCommandTitle: async ({ commandID }) => {
      menuTitleCalls.push(commandID);
      return Object.prototype.hasOwnProperty.call(menuEntries, commandID) ? menuEntries[commandID] : "";
    },
    getMenuCommandState: async ({ commandID }) => {
      menuStateCalls.push(commandID);
      return Object.prototype.hasOwnProperty.call(menuStates, commandID) ? menuStates[commandID] : true;
    },
    performMenuCommand: async ({ commandID }) => {
      performCalls.push(commandID);
      if (performError) throw performError;
      return performResult;
    },
    executeAsModal: async (runner, optionsArg = {}) => {
      modalCalls.push(optionsArg);
      return runner();
    }
  };

  return {
    photoshop: {
      app,
      core,
      action
    },
    batchCalls,
    menuTitleCalls,
    menuStateCalls,
    performCalls,
    modalCalls
  };
}

test("runContentAwareFill opens Photoshop Content-Aware Fill menu command", async () => {
  const host = createHost({
    menuEntries: {
      901: "Gaussian Blur...",
      902: "Smart Sharpen...",
      903: "High Pass...",
      904: "内容识别填充..."
    }
  });

  await withMockedPhotoshop(host, async () => {
    const tools = require("../../../src/services/ps/tools");
    await tools.runContentAwareFill();
  });

  assert.equal(host.performCalls.length, 1);
  assert.equal(host.performCalls[0], 904);
  assert.equal(host.menuStateCalls.length, 1);
  assert.equal(host.menuStateCalls[0], 904);
  assert.equal(host.batchCalls.length, 0);
});

test("runContentAwareFill requires an active selection", async () => {
  const host = createHost({ hasSelection: false });

  await withMockedPhotoshop(host, async () => {
    const tools = require("../../../src/services/ps/tools");
    await assert.rejects(
      () => tools.runContentAwareFill(),
      /Please create a selection before running Content-Aware Fill\./
    );
  });

  assert.equal(host.menuTitleCalls.length, 0);
  assert.equal(host.performCalls.length, 0);
  assert.equal(host.batchCalls.length, 0);
});

test("runContentAwareFill wraps menu disabled failures with a readable message", async () => {
  const host = createHost({
    menuEntries: {
      901: "Gaussian Blur...",
      902: "Smart Sharpen...",
      903: "High Pass...",
      904: "Content-Aware Fill...",
      905: "Select and Mask..."
    },
    menuStates: {
      904: false
    }
  });

  await withMockedPhotoshop(host, async () => {
    const tools = require("../../../src/services/ps/tools");
    await assert.rejects(
      () => tools.runContentAwareFill(),
      /Content-Aware Fill failed: Content-Aware Fill: menu command is currently disabled\./
    );
  });
});

test("runSelectAndMask opens Photoshop Select and Mask menu command", async () => {
  const host = createHost({
    menuEntries: {
      901: "Gaussian Blur...",
      902: "Smart Sharpen...",
      903: "High Pass...",
      904: "Content-Aware Fill...",
      905: "Select and Mask..."
    }
  });

  await withMockedPhotoshop(host, async () => {
    const tools = require("../../../src/services/ps/tools");
    await tools.runSelectAndMask();
  });

  assert.equal(host.performCalls.length, 1);
  assert.equal(host.performCalls[0], 905);
  assert.equal(host.menuStateCalls.length, 1);
  assert.equal(host.menuStateCalls[0], 905);
  assert.equal(host.batchCalls.length, 0);
});

test("runSelectAndMask can find menu command in deep scan range", async () => {
  const host = createHost({
    menuEntries: {
      901: "Gaussian Blur...",
      902: "Smart Sharpen...",
      903: "High Pass...",
      904: "Content-Aware Fill...",
      7001: "Select and Mask..."
    }
  });

  await withMockedPhotoshop(host, async () => {
    const tools = require("../../../src/services/ps/tools");
    await tools.runSelectAndMask();
  });

  assert.equal(host.performCalls.length, 1);
  assert.equal(host.performCalls[0], 7001);
  assert.equal(host.batchCalls.length, 0);
});

test("runSelectAndMask falls back to action command when menu scan misses command", async () => {
  const host = createHost({
    menuEntries: {
      901: "Gaussian Blur...",
      902: "Smart Sharpen...",
      903: "High Pass...",
      904: "Content-Aware Fill..."
    }
  });

  await withMockedPhotoshop(host, async () => {
    const tools = require("../../../src/services/ps/tools");
    await tools.runSelectAndMask();
  });

  assert.equal(host.performCalls.length, 0);
  assert.equal(host.modalCalls.length, 1);
  assert.equal(host.modalCalls[0].interactive, true);
  assert.equal(host.batchCalls.length, 1);
  assert.equal(host.batchCalls[0]._obj, "selectAndMask");
  assert.deepEqual(host.batchCalls[0]._options, { dialogOptions: "display" });
});

test("runSelectAndMask retries refineSelectionEdge when selectAndMask action is unavailable", async () => {
  const host = createHost({
    menuEntries: {
      901: "Gaussian Blur...",
      902: "Smart Sharpen...",
      903: "High Pass...",
      904: "Content-Aware Fill..."
    },
    batchThrowForObjects: ["selectAndMask"]
  });

  await withMockedPhotoshop(host, async () => {
    const tools = require("../../../src/services/ps/tools");
    await tools.runSelectAndMask();
  });

  assert.equal(host.performCalls.length, 0);
  assert.equal(host.modalCalls.length, 2);
  assert.equal(host.batchCalls.length, 2);
  assert.equal(host.batchCalls[0]._obj, "selectAndMask");
  assert.equal(host.batchCalls[1]._obj, "refineSelectionEdge");
});

test("runSelectAndMask reports disabled state when Photoshop menu is unavailable", async () => {
  const host = createHost({
    hasSelection: false,
    menuEntries: {
      905: "Select and Mask..."
    },
    menuStates: {
      905: false
    }
  });

  await withMockedPhotoshop(host, async () => {
    const tools = require("../../../src/services/ps/tools");
    await assert.rejects(
      () => tools.runSelectAndMask(),
      /Select and Mask failed: Select and Mask: menu command is currently disabled\./
    );
  });

  assert.equal(host.performCalls.length, 0);
  assert.equal(host.batchCalls.length, 0);
});
