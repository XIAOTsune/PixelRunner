const { normalizeAppId } = require("../../utils");

function requireStoreMethod(store, methodName) {
  if (!store || typeof store !== "object" || typeof store[methodName] !== "function") {
    throw new Error(`manageAppsUsecase requires store.${methodName}`);
  }
}

function toSavedParsedAppData(app) {
  const source = app && typeof app === "object" ? app : {};
  return {
    appId: source.appId || "",
    name: source.name || "",
    description: source.description || "",
    inputs: Array.isArray(source.inputs) ? source.inputs : []
  };
}

function saveParsedAppUsecase(options = {}) {
  const store = options.store;
  const parsedAppData = options.parsedAppData;
  requireStoreMethod(store, "getAiApps");
  requireStoreMethod(store, "updateAiApp");
  requireStoreMethod(store, "addAiApp");

  if (!parsedAppData || typeof parsedAppData !== "object") {
    throw new Error("saveParsedAppUsecase requires parsedAppData");
  }

  const normalizedTargetAppId = normalizeAppId(parsedAppData.appId);
  if (!normalizedTargetAppId) {
    throw new Error("saveParsedAppUsecase requires valid parsedAppData.appId");
  }

  const existing = store.getAiApps().find((item) => normalizeAppId(item && item.appId) === normalizedTargetAppId);
  let targetAppRecordId = "";
  if (existing && existing.id) {
    store.updateAiApp(existing.id, parsedAppData);
    targetAppRecordId = String(existing.id);
  } else {
    targetAppRecordId = String(store.addAiApp(parsedAppData) || "");
  }

  return {
    reason: existing ? "updated" : "saved",
    targetAppId: targetAppRecordId,
    targetWorkflowId: normalizedTargetAppId
  };
}

function loadEditableAppUsecase(options = {}) {
  const app = options.app;
  if (!app || typeof app !== "object") {
    return {
      found: false,
      appId: "",
      appName: "",
      currentEditingAppId: "",
      parsedAppData: null
    };
  }

  return {
    found: true,
    appId: String(app.appId || ""),
    appName: String(app.name || ""),
    currentEditingAppId: String(app.id || ""),
    parsedAppData: toSavedParsedAppData(app)
  };
}

function deleteAppUsecase(options = {}) {
  const store = options.store;
  requireStoreMethod(store, "deleteAiApp");
  const id = String(options.id || "").trim();
  if (!id) {
    return {
      deleted: false,
      id: ""
    };
  }
  return {
    deleted: !!store.deleteAiApp(id),
    id
  };
}

module.exports = {
  toSavedParsedAppData,
  saveParsedAppUsecase,
  loadEditableAppUsecase,
  deleteAppUsecase
};
