(function initAppsModule(global) {
  const modules = (global.PixelRunnerModules = global.PixelRunnerModules || {});

  async function persistCurrentAppId(appId) {
    await modules.runtime.storageSetItem(modules.state.STORAGE_KEYS.CURRENT_APP_ID, String(appId || ""));
  }

  function parseAppInputsText(text) {
    const marker = String(text || "").trim();
    if (!marker) return [];

    const parsed = JSON.parse(marker);
    if (!Array.isArray(parsed)) {
      throw new Error("输入 schema 必须是 JSON 数组");
    }

    return modules.state.normalizeAppInputs(parsed);
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
      updatedAt: Date.now()
    }));

    await modules.runtime.storageSetItem(modules.state.STORAGE_KEYS.APPS, JSON.stringify(normalizedApps));
    modules.state.state.apps = normalizedApps;
    await hydrateCurrentApp({ quiet: true });
    renderSavedAppsList();
    modules.workspace.renderWorkspace();
    renderAppPickerList();
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
      : state.apps.filter((item) => {
          const marker = `${modules.state.getAppDisplayName(item)} ${modules.state.getAppDisplayId(item)}`.toLowerCase();
          return marker.includes(keyword);
        });

    if (statsEl) statsEl.textContent = `${visibleApps.length} / ${state.apps.length}`;

    if (visibleApps.length === 0) {
      listEl.innerHTML = state.apps.length === 0
        ? `<div class="picker-empty"><strong>还没有已保存应用</strong><p>请先到 Settings 中新建或导入应用。</p></div>`
        : `<div class="picker-empty"><strong>没有匹配项</strong><p>换个关键词再试试。</p></div>`;
      return;
    }

    listEl.innerHTML = visibleApps.map((app) => {
      const isActive = state.currentApp && String(state.currentApp.id) === String(app.id);
      return `
        <button class="picker-item ${isActive ? "active" : ""}" type="button" value="${runtime.escapeHtml(String(app.id || ""))}">
          <span class="picker-item-title">${runtime.escapeHtml(modules.state.getAppDisplayName(app))}</span>
          <span class="picker-item-meta">
            <span>App ID: ${runtime.escapeHtml(modules.state.getAppDisplayId(app))}</span>
            <span>输入项：${runtime.escapeHtml(String(modules.state.getAppInputCount(app)))}</span>
          </span>
        </button>
      `;
    }).join("");
  }

  function renderSavedAppsList() {
    const runtime = modules.runtime;
    const state = modules.state.state;
    const listEl = runtime.getById("savedAppsList");
    const summaryEl = runtime.getById("savedAppsSummary");
    const transferInput = runtime.getById("appTransferInput");
    if (!listEl || !summaryEl) return;

    runtime.setSummaryStatus(summaryEl, `已保存应用：${state.apps.length} 个`, "info");

    if (transferInput && !transferInput.dataset.userEdited && state.apps.length > 0) {
      transferInput.value = JSON.stringify(state.apps, null, 2);
    }

    if (state.apps.length === 0) {
      listEl.innerHTML = `
        <div class="picker-empty">
          <strong>还没有已保存应用</strong>
          <p>可以手动新建一个应用，或把旧版本导出的 JSON 粘贴到下方后导入。</p>
        </div>
      `;
      return;
    }

    listEl.innerHTML = state.apps.map((app) => {
      const isActive = state.currentApp && String(state.currentApp.id) === String(app.id);
      return `
        <article class="list-item saved-app-item ${isActive ? "is-active" : ""}" data-app-id="${runtime.escapeHtml(String(app.id))}">
          <div class="saved-app-main">
            <strong>${runtime.escapeHtml(modules.state.getAppDisplayName(app))}</strong>
            <span>App ID: ${runtime.escapeHtml(modules.state.getAppDisplayId(app))}</span>
            <span>输入项：${runtime.escapeHtml(String(modules.state.getAppInputCount(app)))}</span>
          </div>
          <div class="inline-actions">
            <button class="mini-btn" type="button" data-action="select-app" data-app-id="${runtime.escapeHtml(String(app.id))}">设为当前</button>
            <button class="mini-btn" type="button" data-action="edit-app" data-app-id="${runtime.escapeHtml(String(app.id))}">编辑</button>
            <button class="mini-btn" type="button" data-action="delete-app" data-app-id="${runtime.escapeHtml(String(app.id))}">删除</button>
          </div>
        </article>
      `;
    }).join("");
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

    if (!options.quiet) {
      modules.ui.logToWorkspace(`已选择应用：${modules.state.getAppDisplayName(nextApp)}`);
    }

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
    if (state.apps[0]) {
      await setCurrentAppById(state.apps[0].id, { quiet: true });
      return;
    }

    modules.workspace.renderWorkspace();
    if (!options.quiet) {
      modules.ui.logToWorkspace("当前还没有可用的已保存应用。", "warn");
    }
  }

  async function refreshWorkspaceApps(options = {}) {
    modules.state.state.apps = await loadAppsFromStorage();
    await hydrateCurrentApp({ quiet: true });
    renderSavedAppsList();
    renderAppPickerList();

    if (!options.quiet) {
      modules.ui.logToWorkspace(`应用列表已刷新，共读取到 ${modules.state.state.apps.length} 个应用。`);
    }
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
        modules.settings.renderSettingsDiagnostics("应用列表已从宿主存储刷新。", {
          runtime: state.hostRuntime,
          hasApiKey: Boolean(state.settings.apiKey)
        });
      });
    }

    if (closeButton) {
      closeButton.addEventListener("click", () => {
        modules.workspace.setModalOpen("appPickerModal", false);
      });
    }

    document.addEventListener("click", async (event) => {
      const closeTarget = event.target && event.target.closest("#appPickerBackdrop");
      if (closeTarget) {
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
    runtime.getById("appEditorTitle").textContent = safeApp ? `编辑应用：${modules.state.getAppDisplayName(safeApp)}` : "新建应用";
    runtime.getById("appEditorNameInput").value = safeApp ? safeApp.name || "" : "";
    runtime.getById("appEditorAppIdInput").value = safeApp ? safeApp.appId || "" : "";
    runtime.getById("appEditorDescriptionInput").value = safeApp ? safeApp.description || "" : "";
    runtime.getById("appEditorInputsInput").value = safeApp ? JSON.stringify(safeApp.inputs || [], null, 2) : "";

    const deleteButton = runtime.getById("btnDeleteEditingApp");
    if (deleteButton) deleteButton.hidden = !safeApp;
    runtime.setSummaryStatus(runtime.getById("appEditorStatus"), safeApp ? "可以继续调整应用元数据，后续也可以把解析结果直接写回这里。" : "先填写应用名称和 App ID，输入 schema JSON 可以后补。", "info");
  }

  function openAppEditor(appId = null) {
    const app = appId ? modules.state.state.apps.find((item) => String(item.id) === String(appId)) : null;
    fillAppEditor(app || null);
    modules.workspace.setModalOpen("appEditorModal", true);
  }

  function closeAppEditor() {
    modules.workspace.setModalOpen("appEditorModal", false);
  }

  function readAppEditorForm() {
    const runtime = modules.runtime;
    const appId = String(runtime.getById("appEditorAppIdInput")?.value || "").trim();
    const name = String(runtime.getById("appEditorNameInput")?.value || "").trim();
    if (!name) throw new Error("请先填写应用名称");
    if (!appId) throw new Error("请先填写 RunningHub App ID");

    return {
      id: modules.state.state.editingAppId || runtime.createId("app"),
      appId,
      name,
      description: String(runtime.getById("appEditorDescriptionInput")?.value || "").trim(),
      inputs: parseAppInputsText(runtime.getById("appEditorInputsInput")?.value || "")
    };
  }

  async function saveEditedApp() {
    const formValue = readAppEditorForm();
    const apps = modules.state.state.apps;
    const existingIndex = apps.findIndex((item) => String(item.id) === String(formValue.id));
    const now = Date.now();
    const nextApp = modules.state.normalizeAppRecord({
      ...formValue,
      createdAt: existingIndex >= 0 ? apps[existingIndex].createdAt : now,
      updatedAt: now
    });

    const nextApps = [...apps];
    if (existingIndex >= 0) nextApps[existingIndex] = nextApp;
    else nextApps.push(nextApp);

    await saveAppsToStorage(nextApps);
    await setCurrentAppById(nextApp.id, { quiet: true });
    closeAppEditor();
    modules.ui.logToWorkspace(`应用已保存：${nextApp.name}`, "success");
  }

  async function deleteAppById(appId) {
    const target = modules.state.state.apps.find((item) => String(item.id) === String(appId));
    if (!target) return;

    const nextApps = modules.state.state.apps.filter((item) => String(item.id) !== String(appId));
    await saveAppsToStorage(nextApps);

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
    if (!marker) throw new Error("请先在文本框中粘贴应用列表 JSON");

    let parsed = JSON.parse(marker);
    if (parsed && typeof parsed === "object" && Array.isArray(parsed.apps)) parsed = parsed.apps;

    const importedApps = modules.state.normalizeAppList(parsed);
    if (importedApps.length === 0) throw new Error("没有解析到可导入的应用记录");

    await saveAppsToStorage(importedApps);
    input.dataset.userEdited = "";
    input.value = JSON.stringify(importedApps, null, 2);
    modules.ui.logToWorkspace(`应用列表导入完成，共 ${importedApps.length} 个应用。`, "success");
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
    bindAppPicker,
    renderSavedAppsList,
    renderAppPickerList,
    setCurrentAppById,
    hydrateCurrentApp,
    refreshWorkspaceApps,
    openAppEditor,
    closeAppEditor,
    saveEditedApp,
    deleteAppById,
    importAppsFromTextarea,
    exportAppsToTextarea
  };
})(window);
