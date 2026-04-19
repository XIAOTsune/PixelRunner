(function initQuickEntriesModule(global) {
  const modules = (global.PixelRunnerModules = global.PixelRunnerModules || {});

  function isImageInput(input) {
    const type = String((input && input.type) || "").trim().toLowerCase();
    return type === "image" || type === "file";
  }

  function normalizeImageBindings(bindings, app = null) {
    const explicit = (Array.isArray(bindings) ? bindings : [])
      .filter((item) => item && typeof item === "object")
      .map((item) => ({
        inputKey: String(item.inputKey || item.key || "").trim(),
        source: "selectionRequired"
      }))
      .filter((item) => item.inputKey);
    if (explicit.length > 0) return explicit;

    const inputs = Array.isArray(app && app.inputs) ? app.inputs : [];
    const imageInputs = inputs.filter(isImageInput);
    const preferred = imageInputs.find((item) => item.required) || imageInputs[0] || null;
    return preferred && preferred.key ? [{ inputKey: String(preferred.key), source: "selectionRequired" }] : [];
  }

  function clonePlainValue(value) {
    if (value == null) return value;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
    if (Array.isArray(value)) return value.map(clonePlainValue);
    if (value && typeof value === "object") {
      const out = {};
      Object.keys(value).forEach((key) => {
        out[key] = clonePlainValue(value[key]);
      });
      return out;
    }
    return value;
  }

  function normalizeInputValues(values, app = null) {
    const source = values && typeof values === "object" ? values : {};
    const out = {};
    const imageKeys = new Set((Array.isArray(app && app.inputs) ? app.inputs : []).filter(isImageInput).map((item) => String(item.key || "")));
    Object.keys(source).forEach((key) => {
      if (!key || imageKeys.has(key)) return;
      const value = source[key];
      if (value && typeof value === "object") {
        const marker = `${value.dataUrl || ""}${value.base64 || ""}${value.uploadDataUrl || ""}${value.uploadBase64 || ""}`;
        if (marker) return;
      }
      out[key] = clonePlainValue(value);
    });
    return out;
  }

  function normalizeQuickEntryRecord(entry, index = 0) {
    const runtime = modules.runtime;
    const source = entry && typeof entry === "object" ? entry : {};
    const now = Date.now();
    const appRef = source.appRef && typeof source.appRef === "object" ? source.appRef : {};
    const savedAppId = String(appRef.savedAppId || source.savedAppId || "").trim();
    const appId = String(appRef.appId || source.appId || "").trim();
    const appName = String(appRef.appName || source.appName || "未命名应用").trim() || "未命名应用";
    const title = String(source.title || source.name || `快捷入口 ${index + 1}`).trim() || `快捷入口 ${index + 1}`;
    if (!savedAppId && !appId) return null;

    return {
      id: String(source.id || "").trim() || runtime.createId("quick"),
      title,
      appRef: {
        savedAppId,
        appId,
        appName
      },
      inputValues: normalizeInputValues(source.inputValues || source.values || {}),
      imageBindings: normalizeImageBindings(source.imageBindings),
      meta: {
        createdAt: Number(source.meta && source.meta.createdAt) > 0 ? Number(source.meta.createdAt) : Number(source.createdAt) || now,
        updatedAt: Number(source.meta && source.meta.updatedAt) > 0 ? Number(source.meta.updatedAt) : Number(source.updatedAt) || now,
        lastRunAt: Number(source.meta && source.meta.lastRunAt) || 0,
        runCount: Number(source.meta && source.meta.runCount) || 0
      }
    };
  }

  function normalizeQuickEntryList(entries) {
    const seenIds = new Set();
    return (Array.isArray(entries) ? entries : [])
      .map((item, index) => normalizeQuickEntryRecord(item, index))
      .filter((item) => {
        if (!item) return false;
        if (seenIds.has(item.id)) item.id = modules.runtime.createId("quick");
        seenIds.add(item.id);
        return true;
      });
  }

  async function loadQuickEntriesFromStorage() {
    const raw = await modules.runtime.storageGetItem(modules.state.STORAGE_KEYS.QUICK_ENTRIES);
    const parsed = modules.runtime.readJsonText(raw, []);
    const list = parsed && typeof parsed === "object" && Array.isArray(parsed.entries) ? parsed.entries : parsed;
    return normalizeQuickEntryList(list);
  }

  async function saveQuickEntriesToStorage(entries) {
    const normalized = normalizeQuickEntryList(entries);
    await modules.runtime.storageSetItem(modules.state.STORAGE_KEYS.QUICK_ENTRIES, JSON.stringify({ version: 1, entries: normalized }));
    modules.state.state.quickEntries = normalized;
    if (modules.apps && typeof modules.apps.renderAppPickerList === "function") modules.apps.renderAppPickerList();
    if (modules.workspace && typeof modules.workspace.renderWorkspace === "function") modules.workspace.renderWorkspace();
    return normalized;
  }

  async function loadWorkspaceModeFromStorage() {
    const mode = String(await modules.runtime.storageGetItem(modules.state.STORAGE_KEYS.WORKSPACE_MODE) || "").trim();
    modules.state.state.workspaceMode = mode === "quick" ? "quick" : "app";
    return modules.state.state.workspaceMode;
  }

  async function setWorkspaceMode(mode, options = {}) {
    modules.state.state.workspaceMode = mode === "quick" ? "quick" : "app";
    await modules.runtime.storageSetItem(modules.state.STORAGE_KEYS.WORKSPACE_MODE, modules.state.state.workspaceMode);
    if (!options.skipRender && modules.workspace && typeof modules.workspace.renderWorkspace === "function") {
      modules.workspace.renderWorkspace();
    }
    return modules.state.state.workspaceMode;
  }

  async function initializeQuickEntries() {
    const [entries] = await Promise.all([loadQuickEntriesFromStorage(), loadWorkspaceModeFromStorage()]);
    modules.state.state.quickEntries = entries;
    return entries;
  }

  function buildEntryFromCurrentApp(title) {
    const state = modules.state.state;
    const app = state.currentApp;
    if (!app) throw new Error("请先选择一个应用");
    const name = String(title || "").trim();
    if (!name) throw new Error("请先填写快捷入口名称");
    if (!modules.state.resolveAppId(app)) throw new Error("当前应用缺少有效的 RunningHub appId");

    if (modules.workspace && typeof modules.workspace.collectFormValuesFromDom === "function") {
      modules.workspace.collectFormValuesFromDom();
    }

    const now = Date.now();
    return normalizeQuickEntryRecord({
      id: modules.runtime.createId("quick"),
      title: name,
      appRef: {
        savedAppId: String(app.id || ""),
        appId: modules.state.resolveAppId(app),
        appName: modules.state.getAppDisplayName(app)
      },
      inputValues: normalizeInputValues(state.formValues, app),
      imageBindings: normalizeImageBindings([], app),
      meta: {
        createdAt: now,
        updatedAt: now,
        lastRunAt: 0,
        runCount: 0
      }
    }, 0);
  }

  async function createFromCurrentApp(title) {
    const entry = buildEntryFromCurrentApp(title);
    const next = [entry, ...(Array.isArray(modules.state.state.quickEntries) ? modules.state.state.quickEntries : [])];
    await saveQuickEntriesToStorage(next);
    return entry;
  }

  async function renameQuickEntry(entryId, title) {
    const id = String(entryId || "").trim();
    const nextTitle = String(title || "").trim();
    if (!id) throw new Error("未找到快捷入口");
    if (!nextTitle) throw new Error("快捷入口名称不能为空");
    const list = modules.state.state.quickEntries.slice();
    const index = list.findIndex((item) => String(item.id) === id);
    if (index < 0) throw new Error("未找到快捷入口");
    list[index] = {
      ...list[index],
      title: nextTitle,
      meta: {
        ...(list[index].meta || {}),
        updatedAt: Date.now()
      }
    };
    await saveQuickEntriesToStorage(list);
    return list[index];
  }

  async function deleteQuickEntry(entryId) {
    const id = String(entryId || "").trim();
    if (!id) return false;
    const list = modules.state.state.quickEntries.filter((item) => String(item.id) !== id);
    await saveQuickEntriesToStorage(list);
    return true;
  }

  async function markQuickEntryRan(entryId) {
    const id = String(entryId || "").trim();
    const list = modules.state.state.quickEntries.slice();
    const index = list.findIndex((item) => String(item.id) === id);
    if (index < 0) return null;
    list[index] = {
      ...list[index],
      meta: {
        ...(list[index].meta || {}),
        lastRunAt: Date.now(),
        runCount: Number((list[index].meta && list[index].meta.runCount) || 0) + 1
      }
    };
    await saveQuickEntriesToStorage(list);
    return list[index];
  }

  function getQuickEntryTitleKey(entry) {
    return String((entry && entry.title) || "").trim().toLowerCase();
  }

  function mergeImportedQuickEntries(entries) {
    const current = Array.isArray(modules.state.state.quickEntries) ? modules.state.state.quickEntries.slice() : [];
    const existingIds = new Set(current.map((item) => String(item.id || "")));
    const titleIndexMap = new Map();
    current.forEach((entry, index) => {
      const key = getQuickEntryTitleKey(entry);
      if (key && !titleIndexMap.has(key)) titleIndexMap.set(key, index);
    });
    let added = 0;
    let replaced = 0;
    normalizeQuickEntryList(entries).forEach((entry, index) => {
      const key = getQuickEntryTitleKey(entry);
      const previousIndex = key ? titleIndexMap.get(key) : -1;
      const previous = previousIndex >= 0 ? current[previousIndex] : null;
      const nextEntry = normalizeQuickEntryRecord({
        ...entry,
        id: previous ? previous.id : entry.id,
        meta: {
          ...(entry.meta || {}),
          createdAt: previous && previous.meta ? previous.meta.createdAt : entry.meta && entry.meta.createdAt,
          updatedAt: Date.now(),
          lastRunAt: previous && previous.meta ? previous.meta.lastRunAt : entry.meta && entry.meta.lastRunAt,
          runCount: previous && previous.meta ? previous.meta.runCount : entry.meta && entry.meta.runCount
        }
      }, index);
      if (!nextEntry) return;

      if (previous) {
        current[previousIndex] = nextEntry;
        replaced += 1;
        return;
      }

      if (!nextEntry.id || existingIds.has(nextEntry.id)) nextEntry.id = modules.runtime.createId("quick");
      existingIds.add(nextEntry.id);
      if (key) titleIndexMap.set(key, current.length);
      current.push(nextEntry);
      added += 1;
    });
    return { entries: normalizeQuickEntryList(current), added, replaced };
  }

  modules.quickEntries = {
    normalizeQuickEntryRecord,
    normalizeQuickEntryList,
    loadQuickEntriesFromStorage,
    saveQuickEntriesToStorage,
    loadWorkspaceModeFromStorage,
    setWorkspaceMode,
    initializeQuickEntries,
    createFromCurrentApp,
    renameQuickEntry,
    deleteQuickEntry,
    markQuickEntryRan,
    mergeImportedQuickEntries,
    appendImportedQuickEntries: mergeImportedQuickEntries
  };
})(window);
