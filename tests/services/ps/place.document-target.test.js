const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

function clearPsModuleCache() {
  const keys = Object.keys(require.cache);
  keys.forEach((key) => {
    const normalized = String(key || "").replace(/\\/g, "/");
    if (normalized.includes("/src/services/ps/place.js") || normalized.includes("/src/services/ps/alignment.js")) {
      delete require.cache[key];
    }
  });
}

async function withMockedPsHostModules(host, run) {
  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === "photoshop") return host.photoshop;
    if (request === "uxp") return host.uxp;
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    clearPsModuleCache();
    return await run();
  } finally {
    Module._load = originalLoad;
    clearPsModuleCache();
  }
}

function createMockHost() {
  const documents = [];
  let activeDocument = null;
  const batchCalls = [];

  const app = {
    get activeDocument() {
      return activeDocument;
    },
    set activeDocument(next) {
      activeDocument = next;
    },
    get documents() {
      return documents;
    }
  };

  const action = {
    batchPlay: async (commands = []) => {
      commands.forEach((command) => {
        batchCalls.push(command);
      });
      commands.forEach((command) => {
        if (!command || command._obj !== "select") return;
        const target = command._target && command._target[0];
        const targetId = Number(target && target._id);
        const doc = documents.find((item) => Number(item && item.id) === targetId);
        if (doc) activeDocument = doc;
      });
      return [];
    }
  };

  const core = {
    executeAsModal: async (runner) => runner()
  };

  const tempFile = {
    write: async () => {}
  };
  const tempFolder = {
    createFile: async () => tempFile
  };
  const localFileSystem = {
    getTemporaryFolder: async () => tempFolder,
    createSessionToken: async () => "session-token"
  };

  return {
    batchCalls,
    app,
    action,
    core,
    photoshop: {
      app,
      action,
      core
    },
    uxp: {
      storage: {
        localFileSystem,
        formats: {
          binary: "binary"
        }
      }
    }
  };
}

test("placeImage activates placement target document before placeEvent", async () => {
  const host = createMockHost();
  const docA = { id: 1, title: "Doc-A" };
  const docB = {
    id: 2,
    title: "Doc-B",
    activate: async () => {
      host.app.activeDocument = docB;
    }
  };
  host.app.documents.push(docA, docB);
  host.app.activeDocument = docA;

  await withMockedPsHostModules(host, async () => {
    const { placeImage } = require("../../../src/services/ps/place");
    await placeImage(new Uint8Array([1, 2, 3]).buffer, {
      placementTarget: {
        documentId: 2,
        sourceInputKey: "image:main",
        capturedAt: 1700000000000
      }
    });
  });

  assert.equal(host.app.activeDocument, docB);
  assert.equal(host.batchCalls.filter((command) => command && command._obj === "select").length, 0);
  assert.equal(host.batchCalls.filter((command) => command && command._obj === "placeEvent").length, 1);
});

test("placeImage falls back to current active document when placement target is unavailable", async () => {
  const host = createMockHost();
  const docA = { id: 1, title: "Doc-A" };
  host.app.documents.push(docA);
  host.app.activeDocument = docA;
  const logs = [];

  await withMockedPsHostModules(host, async () => {
    const { placeImage } = require("../../../src/services/ps/place");
    await placeImage(new Uint8Array([1, 2, 3]).buffer, {
      placementTarget: {
        documentId: 99,
        sourceInputKey: "image:main",
        capturedAt: 1700000000001
      },
      log: (message, type) => {
        logs.push({ message: String(message || ""), type: String(type || "info") });
      }
    });
  });

  assert.equal(host.batchCalls.filter((command) => command && command._obj === "placeEvent").length, 1);
  assert.equal(host.app.activeDocument, docA);
  assert.equal(
    logs.some(
      (item) =>
        item.type === "error" &&
        /placement target activation failed, fallback to active document/.test(item.message)
    ),
    true
  );
});

test("placeImage keeps current active document when placementTarget is missing", async () => {
  const host = createMockHost();
  const docA = { id: 1, title: "Doc-A" };
  const docB = { id: 2, title: "Doc-B" };
  host.app.documents.push(docA, docB);
  host.app.activeDocument = docB;

  await withMockedPsHostModules(host, async () => {
    const { placeImage } = require("../../../src/services/ps/place");
    await placeImage(new Uint8Array([1, 2, 3]).buffer, {});
  });

  assert.equal(host.app.activeDocument, docB);
  assert.equal(host.batchCalls.filter((command) => command && command._obj === "placeEvent").length, 1);
});
