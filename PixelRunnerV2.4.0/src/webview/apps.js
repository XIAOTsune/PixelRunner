(function initAppsModule(global) {
  const modules = (global.PixelRunnerModules = global.PixelRunnerModules || {});

  function normalizeAppId(rawValue) {
    const text = String(rawValue || "").trim();
    if (!text) return "";
    if (/^\d+$/.test(text)) return text;

    try {
      const decoded = decodeURIComponent(text);
      const url = new URL(decoded);
      const queryKeys = ["appId", "webappId", "id", "workflowId", "code"];
      for (const key of queryKeys) {
        const value = url.searchParams.get(key);
        if (value && value.trim()) return value.trim();
      }
      const pathMatch = decoded.match(/\/(\d+)(?:[/?#]|$)/);
      if (pathMatch) return pathMatch[1];
    } catch (_) {
      const queryMatch = text.match(/[?&](?:appId|webappId|id|workflowId|code)=([^&#]+)/i);
      if (queryMatch) return decodeURIComponent(queryMatch[1]).trim();
      const pathMatch = text.match(/\/(\d+)(?:[/?#]|$)/);
      if (pathMatch) return pathMatch[1];
    }

    return text;
  }

  function getAppEditorDraft() {
    const runtime = modules.runtime;
    return JSON.stringify({
      id: modules.state.state.editingAppId || "",
      name: String(runtime.getById("appEditorNameInput")?.value || "").trim(),
      appId: normalizeAppId(runtime.getById("appEditorAppIdInput")?.value || ""),
      description: String(runtime.getById("appEditorDescriptionInput")?.value || "").trim(),
      inputsText: String(runtime.getById("appEditorInputsInput")?.value || "").trim()
    });
  }

  function markAppEditorPristine() {
    modules.state.state.appEditorSnapshot = getAppEditorDraft();
  }

  function isAppEditorDirty() {
    return getAppEditorDraft() !== String(modules.state.state.appEditorSnapshot || "");
  }

  function confirmDiscardAppEditorChanges() {
    if (!isAppEditorDirty()) return true;
    return global.confirm("当前应用编辑区里有未保存修改，确定放弃这些内容吗？");
  }

  async function persistCurrentAppId(appId) {
    await modules.runtime.storageSetItem(modules.state.STORAGE_KEYS.CURRENT_APP_ID, String(appId || ""));
  }

  function analyzeAppInputsText(text) {
    const marker = String(text || "").trim();
    if (!marker) return { normalized: [], summary: "当前应用还没有输入结构。", status: "info" };

    const parsed = JSON.parse(marker);
    if (!Array.isArray(parsed)) throw new Error("输入结构必须是 JSON 数组");

    const normalized = modules.state.normalizeAppInputs(parsed);
    const imageCount = normalized.filter((item) => item.type === "image" || item.type === "file").length;
    const promptCount = normalized.filter((item) => modules.state.isPromptLikeInput(item)).length;
    const requiredCount = normalized.filter((item) => item.required).length;
    const optionalCount = Math.max(0, normalized.length - requiredCount);
    const selectCount = normalized.filter((item) => item.type === "select" || item.type === "enum").length;
    const booleanCount = normalized.filter((item) => ["boolean", "switch", "checkbox"].includes(String(item.type || "").toLowerCase())).length;
    const previewKeys = normalized
      .slice(0, 5)
      .map((item) => item.label || item.name || item.key)
      .filter(Boolean)
      .join("、");

    return {
      normalized,
      summary:
        normalized.length > 0
          ? `已识别 ${normalized.length} 个输入项，其中必填 ${requiredCount} 个、选填 ${optionalCount} 个、图像 ${imageCount} 个、提示词 ${promptCount} 个、选项 ${selectCount} 个、布尔 ${booleanCount} 个。${previewKeys ? `字段预览：${previewKeys}${normalized.length > 5 ? "等" : ""}。` : ""}`
          : "已解析输入结构，但暂未识别到可用字段。",
      status: normalized.length > 0 ? "success" : "info"
    };
  }

  function summarizeParsedApp(result) {
    const inputs = Array.isArray(result && result.inputs) ? result.inputs : [];
    const analysis = analyzeAppInputsText(JSON.stringify(inputs));
    const summary = String(analysis.summary || "").replace(/^已识别\s*/, "");
    return {
      name: String((result && (result.name || result.appId)) || "未命名应用"),
      inputCount: inputs.length,
      summary
    };
  }

  function renderAppInputsSummary(text) {
    const summaryEl = modules.runtime.getById("appEditorSchemaSummary");
    if (!summaryEl) return;

    try {
      const result = analyzeAppInputsText(text);
      summaryEl.classList.remove("is-hidden");
      modules.runtime.setSummaryStatus(summaryEl, result.summary, result.status);
    } catch (error) {
      summaryEl.classList.remove("is-hidden");
      modules.runtime.setSummaryStatus(summaryEl, `输入结构格式错误：${error.message}`, "error");
    }
  }

  function parseAppInputsText(text) {
    return analyzeAppInputsText(text).normalized;
  }

  async function loadAppsFromStorage() {
    const runtime = modules.runtime;
    const keys = modules.state.STORAGE_KEYS;
    const primaryRaw = await runtime.storageGetItem(keys.APPS);
    const primaryApps = modules.state.normalizeAppList(runtime.readJsonText(primaryRaw, []));
    if (primaryApps.length > 0) return primaryApps;

    for (const legacyKey of keys.LEGACY_APPS) {
      const legacyRaw = await runtime.storageGetItem(legacyKey);
      const legacyApps = modules.state.normalizeAppList(runtime.readJsonText(legacyRaw, []));
      if (legacyApps.length > 0) return legacyApps;
    }

    return [];
  }

  async function saveAppsToStorage(apps) {
    const normalizedApps = modules.state.normalizeAppList(apps).map((item) => ({
      id: item.id,
      appId: item.appId,
      name: item.name,
      description: item.description,
      inputs: item.inputs,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt || Date.now()
    }));

    await modules.runtime.storageSetItem(modules.state.STORAGE_KEYS.APPS, JSON.stringify(normalizedApps));
    modules.state.state.apps = normalizedApps;
    await hydrateCurrentApp({ quiet: true });
    renderSavedAppsList();
    modules.workspace.renderWorkspace();
    renderAppPickerList();
  }

  function getVisibleApps() {
    const state = modules.state.state;
    const keyword = String(state.appManagerKeyword || "").trim().toLowerCase();
    const list = !keyword
      ? [...state.apps]
      : state.apps.filter((item) => {
          const marker = `${modules.state.getAppDisplayName(item)} ${modules.state.getAppDisplayId(item)} ${item.description || ""}`.toLowerCase();
          return marker.includes(keyword);
        });

    const sortMode = String(state.appManagerSort || "updated_desc");
    list.sort((a, b) => {
      if (sortMode === "name_asc") return modules.state.getAppDisplayName(a).localeCompare(modules.state.getAppDisplayName(b), "zh-CN");
      if (sortMode === "name_desc") return modules.state.getAppDisplayName(b).localeCompare(modules.state.getAppDisplayName(a), "zh-CN");
      if (sortMode === "created_desc") return Number(b.createdAt || 0) - Number(a.createdAt || 0);
      return Number(b.updatedAt || 0) - Number(a.updatedAt || 0);
    });
    return list;
  }

  function renderAppPickerList() {
    const runtime = modules.runtime;
    const state = modules.state.state;
    const listEl = runtime.getById("appPickerList");
    const statsEl = runtime.getById("appPickerStats");
    if (!listEl) return;

    const keyword = String(state.appPickerKeyword || "").trim().toLowerCase();
    const visibleApps = !keyword
      ? state.apps
      : state.apps.filter((item) => `${modules.state.getAppDisplayName(item)} ${modules.state.getAppDisplayId(item)}`.toLowerCase().includes(keyword));

    if (statsEl) statsEl.textContent = `${visibleApps.length} / ${state.apps.length}`;
    if (visibleApps.length === 0) {
      listEl.innerHTML =
        state.apps.length === 0
          ? `<div class="picker-empty"><strong>还没有已保存应用</strong><p>请先在设置页添加应用。</p></div>`
          : `<div class="picker-empty"><strong>没有匹配结果</strong><p>换个关键词再试试。</p></div>`;
      return;
    }

    listEl.innerHTML = visibleApps
      .map((app) => {
        const isActive = state.currentApp && String(state.currentApp.id) === String(app.id);
        return `<button class="picker-item ${isActive ? "active" : ""}" type="button" value="${runtime.escapeHtml(String(app.id || ""))}"><span class="picker-item-title">${runtime.escapeHtml(modules.state.getAppDisplayName(app))}</span><span class="picker-item-meta"><span>应用 ID：${runtime.escapeHtml(modules.state.getAppDisplayId(app))}</span><span>输入项：${runtime.escapeHtml(String(modules.state.getAppInputCount(app)))}</span></span></button>`;
      })
      .join("");
  }

  function renderSavedAppsList() {
    const runtime = modules.runtime;
    const state = modules.state.state;
    const listEl = runtime.getById("savedAppsList");
    const summaryEl = runtime.getById("savedAppsSummary");
    if (!listEl || !summaryEl) return;

    const visibleApps = getVisibleApps();
    const keyword = String(state.appManagerKeyword || "").trim();
    runtime.setSummaryStatus(summaryEl, keyword ? `已保存应用：${visibleApps.length} / ${state.apps.length} 个` : `已保存应用：${state.apps.length} 个`, "info");

    if (visibleApps.length === 0) {
      listEl.innerHTML =
        state.apps.length === 0
          ? `<div class="picker-empty"><strong>还没有已保存应用</strong><p>输入应用 ID 或链接后解析并保存。</p></div>`
          : `<div class="picker-empty"><strong>没有匹配到应用</strong><p>调整搜索词后再试一次。</p></div>`;
      return;
    }

    listEl.innerHTML = visibleApps
      .map((app) => {
        const isEditing = String(modules.state.state.editingAppId || "") === String(app.id);
        const isCurrent = state.currentApp && String(state.currentApp.id) === String(app.id);
        const description = String(app.description || "").trim();
        return `<article class="list-item saved-app-item compact-card ${isEditing ? "is-editing" : ""}" data-app-id="${runtime.escapeHtml(String(app.id))}"><div class="saved-app-main compact-card-main"><strong>${runtime.escapeHtml(modules.state.getAppDisplayName(app))}</strong><span>应用 ID：${runtime.escapeHtml(modules.state.getAppDisplayId(app))}</span><span>输入项：${runtime.escapeHtml(String(modules.state.getAppInputCount(app)))}${isCurrent ? " · 当前使用" : ""}${isEditing ? " · 正在编辑" : ""}</span>${description ? `<span>${runtime.escapeHtml(description)}</span>` : ""}</div><div class="inline-actions compact-card-actions"><button class="mini-btn" type="button" data-action="edit-app" data-app-id="${runtime.escapeHtml(String(app.id))}">修改</button><button class="mini-btn" type="button" data-action="delete-app" data-app-id="${runtime.escapeHtml(String(app.id))}">删除</button></div></article>`;
      })
      .join("");
  }

  async function setCurrentAppById(appId, options = {}) {
    const state = modules.state.state;
    const nextApp = state.apps.find((item) => String(item.id) === String(appId));
    if (!nextApp) return false;

    state.currentApp = nextApp;
    state.formValues = modules.state.buildDefaultFormValues(nextApp);
    await persistCurrentAppId(nextApp.id || "");
    modules.workspace.renderWorkspace();
    renderSavedAppsList();
    renderAppPickerList();
    if (!options.quiet) modules.ui.logToWorkspace(`已选择应用：${modules.state.getAppDisplayName(nextApp)}`);
    return true;
  }

  async function hydrateCurrentApp(options = {}) {
    const state = modules.state.state;
    const currentId = state.currentApp && state.currentApp.id;
    if (currentId && (await setCurrentAppById(currentId, { quiet: true }))) return;

    const persistedId = await modules.runtime.storageGetItem(modules.state.STORAGE_KEYS.CURRENT_APP_ID);
    if (persistedId && (await setCurrentAppById(persistedId, { quiet: true }))) return;

    state.currentApp = null;
    state.formValues = {};
    if (state.apps[0]) return setCurrentAppById(state.apps[0].id, { quiet: true });

    modules.workspace.renderWorkspace();
    if (!options.quiet) modules.ui.logToWorkspace("当前还没有可用的已保存应用。", "warn");
  }

  async function refreshWorkspaceApps(options = {}) {
    modules.state.state.apps = await loadAppsFromStorage();
    await hydrateCurrentApp({ quiet: true });
    renderSavedAppsList();
    renderAppPickerList();
    if (!options.quiet) modules.ui.logToWorkspace(`应用列表已刷新，共 ${modules.state.state.apps.length} 个应用。`);
  }

  function bindAppPicker() {
    const runtime = modules.runtime;
    const state = modules.state.state;
    const openButton = runtime.getById("btnOpenAppPicker");
    const refreshButton = runtime.getById("btnRefreshWorkspaceApps");
    const closeButton = runtime.getById("appPickerModalClose");
    const searchInput = runtime.getById("appPickerSearchInput");
    const listEl = runtime.getById("appPickerList");

    if (openButton) {
      openButton.addEventListener("click", () => {
        state.appPickerKeyword = "";
        if (searchInput) searchInput.value = "";
        renderAppPickerList();
        modules.workspace.setModalOpen("appPickerModal", true);
      });
    }

    if (refreshButton) {
      refreshButton.addEventListener("click", async () => {
        await refreshWorkspaceApps();
        modules.settings.renderSettingsDiagnostics("应用列表已从宿主本地存储刷新。", {
          runtime: state.hostRuntime,
          hasApiKey: Boolean(state.settings.apiKey)
        });
      });
    }

    if (closeButton) closeButton.addEventListener("click", () => modules.workspace.setModalOpen("appPickerModal", false));

    document.addEventListener("click", async (event) => {
      if (event.target && event.target.closest("#appPickerBackdrop")) {
        modules.workspace.setModalOpen("appPickerModal", false);
        return;
      }

      const item = event.target && event.target.closest(".picker-item");
      if (!item || !listEl || !listEl.contains(item)) return;

      const appId = item.getAttribute("value");
      if (!appId) return;
      if (await setCurrentAppById(appId)) {
        renderAppPickerList();
        modules.workspace.setModalOpen("appPickerModal", false);
      }
    });

    if (searchInput) {
      searchInput.addEventListener("input", () => {
        state.appPickerKeyword = searchInput.value || "";
        renderAppPickerList();
      });
    }
  }

  function fillAppEditor(app) {
    const runtime = modules.runtime;
    const safeApp = app && typeof app === "object" ? app : null;
    modules.state.state.editingAppId = safeApp ? String(safeApp.id) : null;

    if (runtime.getById("appEditorNameInput")) runtime.getById("appEditorNameInput").value = safeApp ? safeApp.name || "" : "";
    if (runtime.getById("appEditorAppIdInput")) runtime.getById("appEditorAppIdInput").value = safeApp ? safeApp.appId || "" : "";
    if (runtime.getById("appEditorDescriptionInput")) runtime.getById("appEditorDescriptionInput").value = safeApp ? safeApp.description || "" : "";
    if (runtime.getById("appEditorInputsInput")) runtime.getById("appEditorInputsInput").value = safeApp ? JSON.stringify(safeApp.inputs || [], null, 2) : "[]";

    renderAppInputsSummary(runtime.getById("appEditorInputsInput")?.value || "[]");

    const deleteButton = runtime.getById("btnDeleteEditingApp");
    if (deleteButton) deleteButton.hidden = !safeApp;

    modules.runtime.setSummaryStatus(runtime.getById("appEditorStatus"), safeApp ? `正在编辑应用：${modules.state.getAppDisplayName(safeApp)}` : "输入应用 ID 或链接后解析，确认名称后保存。", "info");
    markAppEditorPristine();
    renderSavedAppsList();
  }

  function openAppEditor(appId = null, options = {}) {
    if (!options.force && !confirmDiscardAppEditorChanges()) return false;
    const app = appId ? modules.state.state.apps.find((item) => String(item.id) === String(appId)) : null;
    fillAppEditor(app || null);
    modules.runtime.getById("appEditorAppIdInput")?.focus();
    modules.runtime.getById("appEditorAppIdInput")?.scrollIntoView({ block: "center", behavior: "smooth" });
    return true;
  }

  function closeAppEditor(options = {}) {
    if (!options.force && !confirmDiscardAppEditorChanges()) return false;
    modules.state.state.editingAppId = null;
    modules.state.state.appEditorSnapshot = "";
    fillAppEditor(null);
    return true;
  }

  async function parseAppReference() {
    const runtime = modules.runtime;
    const inputEl = runtime.getById("appEditorAppIdInput");
    const nameEl = runtime.getById("appEditorNameInput");
    const descriptionEl = runtime.getById("appEditorDescriptionInput");
    const inputsEl = runtime.getById("appEditorInputsInput");
    const normalizedAppId = normalizeAppId(inputEl?.value || "");
    if (!normalizedAppId) throw new Error("请先输入有效的应用 ID 或 URL");

    if (inputEl) inputEl.value = normalizedAppId;

    const preferredName = String(nameEl?.value || "").trim();
    const apiKey = String(modules.state.state.settings.apiKey || "").trim();
    const statusEl = runtime.getById("appEditorStatus");
    runtime.setSummaryStatus(statusEl, `正在解析应用 ${normalizedAppId}...`, "info");

    if (!modules.runtime.isPluginRuntime()) {
      runtime.setSummaryStatus(statusEl, `当前是浏览器预览模式，已提取应用 ID：${normalizedAppId}。完整解析请在 UXP 插件内测试。`, "warn");
      return { ok: true, appId: normalizedAppId, name: preferredName || "", description: "", inputs: [] };
    }

    const result = await modules.runtime.callHost("runninghub.parseApp", [{ appId: normalizedAppId, apiKey, preferredName }], { timeoutMs: 45000 });

    if (nameEl) nameEl.value = result && result.name ? result.name : preferredName;
    if (descriptionEl) descriptionEl.value = result && result.description ? result.description : "";
    if (inputsEl) inputsEl.value = JSON.stringify((result && result.inputs) || [], null, 2);
    renderAppInputsSummary(inputsEl?.value || "[]");

    const parsedSummary = summarizeParsedApp(result);
    runtime.setSummaryStatus(statusEl, `解析成功：${parsedSummary.name}。${parsedSummary.summary} 请确认名称和输入结构后保存。`, "success");
    modules.ui.logToWorkspace(`应用解析成功：${parsedSummary.name}。${parsedSummary.summary}`, "success");
    return result;
  }

  function readAppEditorForm() {
    const runtime = modules.runtime;
    const appId = normalizeAppId(runtime.getById("appEditorAppIdInput")?.value || "");
    const name = String(runtime.getById("appEditorNameInput")?.value || "").trim();
    if (!appId) throw new Error("请先填写应用 ID");
    if (!name) throw new Error("请先填写应用名称");

    return {
      id: modules.state.state.editingAppId || runtime.createId("app"),
      appId,
      name,
      description: String(runtime.getById("appEditorDescriptionInput")?.value || "").trim(),
      inputs: parseAppInputsText(runtime.getById("appEditorInputsInput")?.value || "[]")
    };
  }

  async function saveEditedApp() {
    const formValue = readAppEditorForm();
    const apps = modules.state.state.apps;
    const existingIndex = apps.findIndex((item) => String(item.id) === String(formValue.id));
    const duplicateIndex = apps.findIndex((item) => String(item.appId) === String(formValue.appId) && String(item.id) !== String(formValue.id));
    const now = Date.now();

    const nextApp = modules.state.normalizeAppRecord({
      ...formValue,
      id: duplicateIndex >= 0 ? apps[duplicateIndex].id : formValue.id,
      createdAt: existingIndex >= 0 ? apps[existingIndex].createdAt : duplicateIndex >= 0 ? apps[duplicateIndex].createdAt : now,
      updatedAt: now
    });

    const nextApps = [...apps];
    if (existingIndex >= 0) nextApps[existingIndex] = nextApp;
    else if (duplicateIndex >= 0) nextApps[duplicateIndex] = nextApp;
    else nextApps.unshift(nextApp);

    await saveAppsToStorage(nextApps);
    await setCurrentAppById(nextApp.id, { quiet: true });
    modules.runtime.setSummaryStatus(modules.runtime.getById("appEditorStatus"), `应用已保存：${nextApp.name}`, "success");
    modules.ui.logToWorkspace(`应用已保存：${nextApp.name}`, "success");
    fillAppEditor(null);
  }

  async function deleteAppById(appId) {
    const target = modules.state.state.apps.find((item) => String(item.id) === String(appId));
    if (!target) return;

    const nextApps = modules.state.state.apps.filter((item) => String(item.id) !== String(appId));
    await saveAppsToStorage(nextApps);

    if (String(modules.state.state.editingAppId || "") === String(appId)) {
      modules.state.state.editingAppId = null;
      modules.state.state.appEditorSnapshot = "";
      fillAppEditor(null);
    }

    if (modules.state.state.currentApp && String(modules.state.state.currentApp.id) === String(appId)) {
      if (nextApps[0]) await setCurrentAppById(nextApps[0].id, { quiet: true });
      else {
        modules.state.state.currentApp = null;
        modules.state.state.formValues = {};
        await persistCurrentAppId("");
        modules.workspace.renderWorkspace();
        renderSavedAppsList();
        renderAppPickerList();
      }
    }

    modules.ui.logToWorkspace(`应用已删除：${target.name}`, "warn");
  }

  async function importAppsFromTextarea() {
    const input = modules.runtime.getById("appTransferInput");
    if (!input) return;
    const marker = String(input.value || "").trim();
    if (!marker) throw new Error("请先粘贴应用列表 JSON");

    let parsed = JSON.parse(marker);
    if (parsed && typeof parsed === "object" && Array.isArray(parsed.apps)) parsed = parsed.apps;
    const importedApps = modules.state.normalizeAppList(parsed);
    if (importedApps.length === 0) throw new Error("没有解析到可导入的应用记录");

    await saveAppsToStorage(importedApps);
    input.dataset.userEdited = "";
    input.value = JSON.stringify(importedApps, null, 2);
  }

  function exportAppsToTextarea() {
    const input = modules.runtime.getById("appTransferInput");
    if (!input) return;
    input.dataset.userEdited = "";
    input.value = JSON.stringify(modules.state.state.apps, null, 2);
  }

  modules.apps = {
    loadAppsFromStorage,
    saveAppsToStorage,
    renderAppInputsSummary,
    bindAppPicker,
    renderSavedAppsList,
    renderAppPickerList,
    setCurrentAppById,
    hydrateCurrentApp,
    refreshWorkspaceApps,
    openAppEditor,
    closeAppEditor,
    fillAppEditor,
    parseAppReference,
    saveEditedApp,
    deleteAppById,
    importAppsFromTextarea,
    exportAppsToTextarea,
    isAppEditorDirty,
    confirmDiscardAppEditorChanges,
    markAppEditorPristine
  };
})(window);
