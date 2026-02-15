const store = require("../services/store");
const runninghub = require("../services/runninghub");
const ps = require("../services/ps");
const { escapeHtml, isPromptLikeInput, isEmptyValue } = require("../utils");
const { APP_EVENTS } = require("../events");
const { byId, encodeDataId, decodeDataId, getRenderedElementCount, rebindEvent } = require("../shared/dom-utils");
const inputSchema = require("../shared/input-schema");
const { createWorkspaceInputs } = require("./workspace/workspace-inputs");

const dom = {};
const state = {
  currentApp: null,
  inputValues: {},
  imageBounds: {},
  isRunning: false,
  abortController: null,
  timerId: null,
  runStartedAt: 0,
  appPickerKeyword: "",
  templateSelectCallback: null
};

let workspaceInputs = null;

function getWorkspaceInputs() {
  if (!workspaceInputs) {
    workspaceInputs = createWorkspaceInputs({
      state,
      dom,
      byId,
      ps,
      log,
      inputSchema,
      escapeHtml,
      isPromptLikeInput,
      isEmptyValue,
      getRenderedElementCount,
      updateCurrentAppMeta,
      updateRunButtonUI,
      openTemplatePicker
    });
  }
  return workspaceInputs;
}

function log(msg, type = "info") {
  console.log(`[Workspace][${type}] ${msg}`);
  const logDiv = dom.logWindow || byId("logWindow");
  if (!logDiv) return;
  if (msg === "CLEAR") {
    logDiv.innerHTML = "";
    return;
  }
  const time = new Date().toLocaleTimeString();
  const color = type === "error" ? "#ff6b6b" : type === "success" ? "#4caf50" : "#bbb";
  logDiv.innerHTML += `<div style="color:${color}; margin-top:4px;">[${time}] ${escapeHtml(msg)}</div>`;
  logDiv.scrollTop = logDiv.scrollHeight;
}

function getApps() {
  return store.getAiApps().filter((app) => app && typeof app === "object");
}

function updateRunButtonUI() {
  const btn = dom.btnRun || byId("btnRun");
  if (!btn) return;

  if (state.isRunning) {
    const elapsed = ((Date.now() - state.runStartedAt) / 1000).toFixed(2);
    btn.classList.add("running");
    btn.disabled = false;
    btn.textContent = `中止 (${elapsed}s)`;
    return;
  }

  btn.classList.remove("running");
  if (!state.currentApp) {
    btn.disabled = true;
    btn.textContent = "开始运行";
    return;
  }

  btn.disabled = false;
  btn.textContent = `运行: ${state.currentApp.name}`;
}

function updateCurrentAppMeta() {
  const metaEl = dom.appPickerMeta || byId("appPickerMeta");
  if (!metaEl) return;

  if (!state.currentApp) {
    metaEl.innerHTML = `<span class="placeholder-text">请选择应用</span>`;
    metaEl.title = "";
    return;
  }

  metaEl.innerHTML = escapeHtml(state.currentApp.name || "未命名应用");
  metaEl.title = String(state.currentApp.name || "");
}

async function updateAccountStatus() {
  const apiKey = store.getApiKey();
  const balanceEl = dom.accountBalanceValue || byId("accountBalanceValue");
  const coinsEl = dom.accountCoinsValue || byId("accountCoinsValue");
  const summaryEl = dom.accountSummary || byId("accountSummary");
  if (!balanceEl || !coinsEl) return;

  if (!apiKey) {
    if (summaryEl) summaryEl.classList.add("is-empty");
    balanceEl.textContent = "--";
    coinsEl.textContent = "--";
    return;
  }

  try {
    if (summaryEl) summaryEl.classList.remove("is-empty");
    balanceEl.textContent = "...";
    const status = await runninghub.fetchAccountStatus(apiKey);
    balanceEl.textContent = status.remainMoney || "0";
    coinsEl.textContent = status.remainCoins || "0";
  } catch (error) {
    console.error("获取账户信息失败", error);
  }
}

function renderDynamicInputs(appItem) {
  return getWorkspaceInputs().renderDynamicInputs(appItem);
}

function resolveTargetBounds() {
  return getWorkspaceInputs().resolveTargetBounds();
}

function setRunState(running) {
  state.isRunning = running;
  if (running) {
    state.runStartedAt = Date.now();
    if (state.timerId) clearInterval(state.timerId);
    state.timerId = setInterval(updateRunButtonUI, 100);
  } else {
    if (state.timerId) {
      clearInterval(state.timerId);
      state.timerId = null;
    }
    state.runStartedAt = 0;
    state.abortController = null;
  }
  updateRunButtonUI();
}

async function handleRun() {
  if (state.isRunning) {
    if (state.abortController) {
      state.abortController.abort();
      log("用户请求中止任务", "warn");
    }
    return;
  }

  const apiKey = store.getApiKey();
  if (!apiKey) {
    alert("请先在设置页配置 API Key");
    return;
  }
  if (!state.currentApp) {
    alert("请先选择一个应用");
    return;
  }

  state.abortController = new AbortController();
  const signal = state.abortController.signal;
  setRunState(true);

  log("CLEAR");
  log("开始执行任务", "info");

  try {
    const runOptions = { log, signal };
    const taskId = await runninghub.runAppTask(apiKey, state.currentApp, state.inputValues, runOptions);
    log(`任务已提交: ${taskId}`, "success");

    const settings = store.getSettings();
    const resultUrl = await runninghub.pollTaskOutput(apiKey, taskId, settings, runOptions);
    log("任务完成，下载结果中", "info");

    if (signal.aborted) throw new Error("用户中止");
    const targetBounds = resolveTargetBounds();
    const buffer = await runninghub.downloadResultBinary(resultUrl, runOptions);
    await ps.placeImage(buffer, { log, targetBounds });

    log("处理完成，结果已回贴", "success");
    updateAccountStatus();
  } catch (error) {
    if (error && (error.name === "AbortError" || String(error.message || "").includes("中止"))) {
      log("任务已中止", "warn");
    } else {
      console.error(error);
      log(`运行失败: ${error.message}`, "error");
      alert(`运行失败: ${error.message}`);
    }
  } finally {
    setRunState(false);
  }
}

function renderAppPickerList() {
  if (!dom.appPickerList) return;

  const apps = getApps();
  const keyword = String(state.appPickerKeyword || "").trim().toLowerCase();
  const visibleApps = keyword ? apps.filter((app) => String(app.name || "").toLowerCase().includes(keyword)) : apps;

  if (dom.appPickerStats) {
    dom.appPickerStats.textContent = `${visibleApps.length} / ${apps.length}`;
  }

  if (visibleApps.length === 0) {
    if (apps.length === 0) {
      dom.appPickerList.innerHTML = `
        <div class="empty-state">
          <div style="margin-bottom:10px;">暂无已保存应用</div>
          <button class="main-btn" type="button" data-action="goto-settings">去设置页解析</button>
        </div>
      `;
    } else {
      dom.appPickerList.innerHTML = `<div class="empty-state">没有匹配的应用</div>`;
    }
    return;
  }

  dom.appPickerList.innerHTML = visibleApps
    .map((app) => {
      const active = state.currentApp && state.currentApp.id === app.id;
      return `
        <button type="button" class="app-picker-item ${active ? "active" : ""}" data-id="${encodeDataId(app.id)}">
          <div>
            <div style="font-weight:bold; font-size:12px;">${escapeHtml(app.name || "未命名应用")}</div>
            <div style="font-size:10px; opacity:0.6;">${escapeHtml(app.appId || "-")}</div>
          </div>
          <div style="font-size:12px; color:#aaa;">${Array.isArray(app.inputs) ? app.inputs.length : 0} 参数</div>
        </button>
      `;
    })
    .join("");
}

function closeAppPickerModal() {
  if (dom.appPickerModal) dom.appPickerModal.classList.remove("active");
}

function openAppPickerModal() {
  state.appPickerKeyword = "";
  if (dom.appPickerSearchInput) dom.appPickerSearchInput.value = "";
  renderAppPickerList();
  if (dom.appPickerModal) dom.appPickerModal.classList.add("active");
}

function selectAppInternal(id, options = {}) {
  const quiet = !!options.quiet;
  const closeModal = options.closeModal !== false;
  try {
    const app = getApps().find((item) => String(item.id) === String(id));
    if (!app) {
      if (!quiet) alert("应用不存在，请刷新后重试");
      return false;
    }
    renderDynamicInputs(app);
    if (closeModal) closeAppPickerModal();
    return true;
  } catch (error) {
    console.error(error);
    if (!quiet) alert(`加载应用失败: ${error.message}`);
    return false;
  }
}

function syncWorkspaceApps(options = {}) {
  const forceRerender = !!options.forceRerender;
  const apps = getApps();

  if (apps.length === 0) {
    if (state.currentApp || forceRerender) {
      renderDynamicInputs(null);
    } else {
      updateCurrentAppMeta();
      updateRunButtonUI();
    }
    renderAppPickerList();
    return;
  }

  const currentId = state.currentApp && state.currentApp.id;
  if (!currentId) {
    selectAppInternal(apps[0].id, { quiet: true, closeModal: false });
    renderAppPickerList();
    return;
  }

  const matched = apps.find((item) => item.id === currentId);
  if (!matched) {
    selectAppInternal(apps[0].id, { quiet: true, closeModal: false });
    renderAppPickerList();
    return;
  }

  state.currentApp = matched;
  if (forceRerender) {
    renderDynamicInputs(matched);
  } else {
    updateCurrentAppMeta();
    updateRunButtonUI();
  }
  renderAppPickerList();
}

function handleAppPickerListClick(event) {
  const gotoSettingsBtn = event.target.closest("button[data-action='goto-settings']");
  if (gotoSettingsBtn) {
    closeAppPickerModal();
    const tabSettings = byId("tabSettings");
    if (tabSettings) tabSettings.click();
    return;
  }

  const item = event.target.closest(".app-picker-item[data-id]");
  if (!item || !dom.appPickerList.contains(item)) return;

  const id = decodeDataId(item.dataset.id || "");
  if (!id) return;
  selectAppInternal(id);
}

function renderTemplatePickerList() {
  if (!dom.templateList) return;
  const templates = store.getPromptTemplates();
  if (!templates.length) {
    dom.templateList.innerHTML = `
      <div class="empty-state">
        暂无模板，请前往设置页添加
        <br><button class="tiny-btn" style="margin-top:8px" type="button" data-action="goto-settings">去添加</button>
      </div>
    `;
    return;
  }

  dom.templateList.innerHTML = templates
    .map(
      (template) => `
        <button type="button" class="app-picker-item" data-template-id="${encodeDataId(template.id)}">
          <div>
            <div style="font-weight:bold;font-size:12px">${escapeHtml(template.title)}</div>
            <div style="font-size:10px;color:#777; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:200px;">${escapeHtml(template.content)}</div>
          </div>
          <div style="font-size:12px;color:var(--accent-color)">选择</div>
        </button>
      `
    )
    .join("");
}

function closeTemplatePicker() {
  if (dom.templateModal) dom.templateModal.classList.remove("active");
  state.templateSelectCallback = null;
}

function openTemplatePicker(onSelectCallback) {
  state.templateSelectCallback = typeof onSelectCallback === "function" ? onSelectCallback : null;
  renderTemplatePickerList();
  if (dom.templateModal) dom.templateModal.classList.add("active");
}

function handleTemplateListClick(event) {
  const gotoSettingsBtn = event.target.closest("button[data-action='goto-settings']");
  if (gotoSettingsBtn) {
    closeTemplatePicker();
    const tabSettings = byId("tabSettings");
    if (tabSettings) tabSettings.click();
    return;
  }

  const item = event.target.closest(".app-picker-item[data-template-id]");
  if (!item || !dom.templateList.contains(item)) return;

  const id = decodeDataId(item.dataset.templateId || "");
  if (!id) return;

  const template = store.getPromptTemplates().find((tpl) => String(tpl.id) === String(id));
  if (!template) return;
  if (state.templateSelectCallback) state.templateSelectCallback(template.content);
  closeTemplatePicker();
}

function onAppPickerSearchInput() {
  state.appPickerKeyword = String(dom.appPickerSearchInput.value || "");
  renderAppPickerList();
}

function onAppPickerModalClick(event) {
  if (event.target === dom.appPickerModal) closeAppPickerModal();
}

function onTemplateModalClick(event) {
  if (event.target === dom.templateModal) closeTemplatePicker();
}

function onRefreshWorkspaceClick() {
  syncWorkspaceApps({ forceRerender: false });
  updateAccountStatus();
  log("应用列表已刷新", "info");
}

function bindWorkspaceEvents() {
  rebindEvent(dom.btnRun, "click", handleRun);
  rebindEvent(dom.btnOpenAppPicker, "click", openAppPickerModal);
  rebindEvent(dom.appPickerModalClose, "click", closeAppPickerModal);
  rebindEvent(dom.appPickerModal, "click", onAppPickerModalClick);
  rebindEvent(dom.appPickerList, "click", handleAppPickerListClick);
  rebindEvent(dom.appPickerSearchInput, "input", onAppPickerSearchInput);
  rebindEvent(dom.btnRefreshWorkspaceApps, "click", onRefreshWorkspaceClick);
  rebindEvent(dom.templateModalClose, "click", closeTemplatePicker);
  rebindEvent(dom.templateModal, "click", onTemplateModalClick);
  rebindEvent(dom.templateList, "click", handleTemplateListClick);

  rebindEvent(document, APP_EVENTS.APPS_CHANGED, onAppsChanged);
  rebindEvent(document, APP_EVENTS.TEMPLATES_CHANGED, onTemplatesChanged);
  rebindEvent(document, APP_EVENTS.SETTINGS_CHANGED, onSettingsChanged);
}

function onAppsChanged() {
  syncWorkspaceApps({ forceRerender: false });
}

function onTemplatesChanged() {
  if (dom.templateModal && dom.templateModal.classList.contains("active")) renderTemplatePickerList();
}

function onSettingsChanged() {
  updateAccountStatus();
}

function cacheDomRefs() {
  const ids = [
    "btnRun",
    "btnOpenAppPicker",
    "btnRefreshWorkspaceApps",
    "appPickerMeta",
    "dynamicInputContainer",
    "imageInputContainer",
    "logWindow",
    "appPickerModal",
    "appPickerModalClose",
    "appPickerSearchInput",
    "appPickerStats",
    "appPickerList",
    "templateModal",
    "templateList",
    "templateModalClose",
    "accountSummary",
    "accountBalanceValue",
    "accountCoinsValue"
  ];
  ids.forEach((id) => {
    dom[id] = byId(id);
  });
}

function initWorkspaceController() {
  cacheDomRefs();
  workspaceInputs = null;
  getWorkspaceInputs();
  bindWorkspaceEvents();
  updateAccountStatus();
  syncWorkspaceApps({ forceRerender: true });
  updateRunButtonUI();
}

module.exports = { initWorkspaceController };
