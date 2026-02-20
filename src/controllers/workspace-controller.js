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
  templateSelectCallback: null,
  templatePickerMode: "single",
  templatePickerMaxSelection: 1,
  templatePickerSelectedIds: []
};
const UPLOAD_MAX_EDGE_CHOICES = [0, 4096, 2048, 1024];
const UPLOAD_MAX_EDGE_LABELS = {
  0: "无限制",
  4096: "4k",
  2048: "2k",
  1024: "1k"
};
const PASTE_STRATEGY_CHOICES = ["normal", "smart"];
const PASTE_STRATEGY_LABELS = {
  normal: "普通（居中填满）",
  smart: "智能（主体对齐）"
};
const LEGACY_PASTE_STRATEGY_MAP = {
  stretch: "normal",
  contain: "normal",
  cover: "normal",
  alphaTrim: "smart",
  edgeAuto: "smart"
};
const MAX_TEMPLATE_COMBINE_COUNT = 5;
const RH_PROMPT_MAX_CHARS = 4000;

let workspaceInputs = null;

function normalizeUploadMaxEdge(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return UPLOAD_MAX_EDGE_CHOICES.includes(num) ? num : 0;
}

function normalizePasteStrategy(value) {
  const marker = String(value || "").trim();
  if (!marker) return "normal";
  const legacy = LEGACY_PASTE_STRATEGY_MAP[marker];
  const normalized = legacy || marker;
  return PASTE_STRATEGY_CHOICES.includes(normalized) ? normalized : "normal";
}

function syncUploadMaxEdgeSelect() {
  const select = dom.uploadMaxEdgeSelect || byId("uploadMaxEdgeSelect");
  if (!select) return;
  const settings = store.getSettings();
  const uploadMaxEdge = normalizeUploadMaxEdge(settings.uploadMaxEdge);
  const nextValue = String(uploadMaxEdge);
  if (select.value !== nextValue) select.value = nextValue;
}

function syncPasteStrategySelect() {
  const select = dom.pasteStrategySelect || byId("pasteStrategySelect");
  if (!select) return;
  const settings = store.getSettings();
  const pasteStrategy = normalizePasteStrategy(settings.pasteStrategy);
  const nextValue = String(pasteStrategy);
  if (select.value !== nextValue) select.value = nextValue;
}

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

function getLogText(logDiv) {
  if (!logDiv) return "";
  if (typeof logDiv.value === "string") return String(logDiv.value || "");
  return String(logDiv.textContent || "");
}

function setLogText(logDiv, text) {
  if (!logDiv) return;
  const nextText = String(text || "");
  if (typeof logDiv.value === "string") {
    logDiv.value = nextText;
    return;
  }
  logDiv.textContent = nextText;
}

function isNearLogBottom(logDiv, threshold = 12) {
  if (!logDiv) return true;
  const maxScrollTop = Math.max(0, logDiv.scrollHeight - logDiv.clientHeight);
  return maxScrollTop - logDiv.scrollTop <= threshold;
}

function log(msg, type = "info") {
  console.log(`[Workspace][${type}] ${msg}`);
  const logDiv = dom.logWindow || byId("logWindow");
  if (!logDiv) return;
  if (msg === "CLEAR") {
    setLogText(logDiv, "");
    return;
  }
  const time = new Date().toLocaleTimeString();
  const level = String(type || "info").toUpperCase();
  const line = `[${time}] [${level}] ${String(msg || "")}`;
  const stickToBottom = isNearLogBottom(logDiv);
  const current = getLogText(logDiv);
  setLogText(logDiv, current ? `${current}\n${line}` : line);
  if (stickToBottom) {
    logDiv.scrollTop = logDiv.scrollHeight;
  }
}

async function onCopyLogClick() {
  const logDiv = dom.logWindow || byId("logWindow");
  if (!logDiv) return;
  const text = getLogText(logDiv).trim();
  if (!text) {
    log("日志为空，无可复制内容", "warn");
    return;
  }

  try {
    if (typeof navigator !== "undefined" && navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      await navigator.clipboard.writeText(text);
      log("日志已复制到剪贴板", "success");
      return;
    }
  } catch (_) {}

  try {
    if (typeof logDiv.focus === "function") logDiv.focus();
    if (typeof logDiv.select === "function") logDiv.select();
    if (typeof document.execCommand === "function" && document.execCommand("copy")) {
      log("日志已复制到剪贴板", "success");
      return;
    }
  } catch (_) {}

  log("复制失败，请手动全选后复制", "error");
}

function onClearLogClick() {
  log("CLEAR");
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

function resolveSourceImageBuffer() {
  return getWorkspaceInputs().resolveSourceImageBuffer();
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
    const settings = store.getSettings();
    const uploadMaxEdge = normalizeUploadMaxEdge(settings.uploadMaxEdge);
    const pasteStrategy = normalizePasteStrategy(settings.pasteStrategy);
    const runOptions = { log, signal, uploadMaxEdge };
    const taskId = await runninghub.runAppTask(apiKey, state.currentApp, state.inputValues, runOptions);
    log(`任务已提交: ${taskId}`, "success");

    const resultUrl = await runninghub.pollTaskOutput(apiKey, taskId, settings, runOptions);
    log("任务完成，下载结果中", "info");

    if (signal.aborted) throw new Error("用户中止");
    const targetBounds = resolveTargetBounds();
    const sourceBuffer = resolveSourceImageBuffer();
    const buffer = await runninghub.downloadResultBinary(resultUrl, runOptions);
    await ps.placeImage(buffer, { log, signal, targetBounds, pasteStrategy, sourceBuffer });

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
  refreshModalOpenState();
}

function openAppPickerModal() {
  state.appPickerKeyword = "";
  if (dom.appPickerSearchInput) dom.appPickerSearchInput.value = "";
  renderAppPickerList();
  if (dom.appPickerModal) dom.appPickerModal.classList.add("active");
  refreshModalOpenState();
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

function getTextLength(value) {
  return Array.from(String(value == null ? "" : value)).length;
}

function isTemplatePickerMultipleMode() {
  return state.templatePickerMode === "multiple";
}

function updateTemplateSelectionInfo() {
  if (!dom.templateModalSelectionInfo) return;
  if (!isTemplatePickerMultipleMode()) {
    dom.templateModalSelectionInfo.textContent = "";
    if (dom.btnApplyTemplateSelection) dom.btnApplyTemplateSelection.disabled = true;
    return;
  }
  const current = state.templatePickerSelectedIds.length;
  const limit = state.templatePickerMaxSelection;
  dom.templateModalSelectionInfo.textContent = `已选择 ${current} / ${limit}`;
  if (dom.btnApplyTemplateSelection) dom.btnApplyTemplateSelection.disabled = current === 0;
}

function syncTemplatePickerUiState() {
  if (dom.templateModalTitle) {
    dom.templateModalTitle.textContent = isTemplatePickerMultipleMode() ? "选择提示词模板（可组合）" : "选择提示词模板";
  }
  if (dom.templateModalActions) {
    dom.templateModalActions.style.display = isTemplatePickerMultipleMode() ? "flex" : "none";
  }
  updateTemplateSelectionInfo();
}

function renderTemplatePickerList() {
  if (!dom.templateList) return;
  const templates = store.getPromptTemplates();
  const selectedSet = new Set(state.templatePickerSelectedIds.map((id) => String(id)));
  const multipleMode = isTemplatePickerMultipleMode();

  if (!templates.length) {
    dom.templateList.innerHTML = `
      <div class="empty-state">
        暂无模板，请前往设置页添加
        <br><button class="tiny-btn" style="margin-top:8px" type="button" data-action="goto-settings">去添加</button>
      </div>
    `;
    updateTemplateSelectionInfo();
    return;
  }

  dom.templateList.innerHTML = templates
    .map((template) => {
      const templateId = String(template.id || "");
      const selected = selectedSet.has(templateId);
      const selectedClass = selected ? "active" : "";
      const actionLabel = multipleMode ? (selected ? "已选" : "选择") : "选择";
      return `
        <button type="button" class="app-picker-item ${selectedClass}" data-template-id="${encodeDataId(templateId)}">
          <div>
            <div style="font-weight:bold;font-size:12px">${escapeHtml(template.title)}</div>
            <div style="font-size:10px;color:#777; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:200px;">${escapeHtml(template.content)}</div>
          </div>
          <div style="font-size:12px;color:var(--accent-color)">${actionLabel}</div>
        </button>
      `;
    })
    .join("");
  updateTemplateSelectionInfo();
}

function closeTemplatePicker() {
  if (dom.templateModal) dom.templateModal.classList.remove("active");
  state.templateSelectCallback = null;
  state.templatePickerMode = "single";
  state.templatePickerMaxSelection = 1;
  state.templatePickerSelectedIds = [];
  syncTemplatePickerUiState();
  refreshModalOpenState();
}

function openTemplatePicker(config = {}) {
  const options =
    typeof config === "function"
      ? { onApply: config, mode: "single", maxSelection: 1 }
      : config && typeof config === "object"
      ? config
      : {};
  const mode = options.mode === "multiple" ? "multiple" : "single";
  const rawMaxSelection = Number(options.maxSelection);
  const maxSelection = mode === "multiple"
    ? Math.max(1, Math.min(MAX_TEMPLATE_COMBINE_COUNT, Number.isFinite(rawMaxSelection) ? Math.floor(rawMaxSelection) : MAX_TEMPLATE_COMBINE_COUNT))
    : 1;

  state.templateSelectCallback = typeof options.onApply === "function" ? options.onApply : null;
  state.templatePickerMode = mode;
  state.templatePickerMaxSelection = maxSelection;
  state.templatePickerSelectedIds = [];
  syncTemplatePickerUiState();
  renderTemplatePickerList();
  if (dom.templateModal) dom.templateModal.classList.add("active");
  refreshModalOpenState();
}

function refreshModalOpenState() {
  const isOpen = Boolean(document.querySelector(".modal-overlay.active"));
  document.body.classList.toggle("modal-open", isOpen);
}

function toggleTemplateSelection(id) {
  const marker = String(id || "");
  if (!marker) return;
  const selected = state.templatePickerSelectedIds.map((item) => String(item));
  const index = selected.indexOf(marker);
  if (index >= 0) {
    selected.splice(index, 1);
    state.templatePickerSelectedIds = selected;
    renderTemplatePickerList();
    return;
  }

  if (selected.length >= state.templatePickerMaxSelection) {
    alert(`最多可选择 ${state.templatePickerMaxSelection} 个模板`);
    return;
  }
  selected.push(marker);
  state.templatePickerSelectedIds = selected;
  renderTemplatePickerList();
}

function applyTemplateSelection() {
  if (!isTemplatePickerMultipleMode()) return;
  if (state.templatePickerSelectedIds.length === 0) {
    alert("请至少选择一个模板");
    return;
  }

  const templates = store.getPromptTemplates();
  const selectedTemplates = state.templatePickerSelectedIds
    .map((id) => templates.find((template) => String(template.id) === String(id)))
    .filter(Boolean);
  if (selectedTemplates.length === 0) {
    alert("未找到已选择模板，请重试");
    return;
  }

  const combinedContent = selectedTemplates.map((template) => String(template.content || "")).join("\n");
  const combinedLength = getTextLength(combinedContent);
  if (combinedLength > RH_PROMPT_MAX_CHARS) {
    alert(`组合后长度为 ${combinedLength}，超过 ${RH_PROMPT_MAX_CHARS} 字符上限，请减少选择数量`);
    return;
  }

  if (state.templateSelectCallback) {
    state.templateSelectCallback({
      mode: "multiple",
      templates: selectedTemplates,
      content: combinedContent,
      length: combinedLength,
      limit: RH_PROMPT_MAX_CHARS
    });
  }
  closeTemplatePicker();
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

  if (isTemplatePickerMultipleMode()) {
    toggleTemplateSelection(id);
    return;
  }

  const content = String(template.content || "");
  if (state.templateSelectCallback) {
    state.templateSelectCallback({
      mode: "single",
      templates: [template],
      content,
      length: getTextLength(content),
      limit: RH_PROMPT_MAX_CHARS
    });
  }
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

function onApplyTemplateSelectionClick() {
  applyTemplateSelection();
}

function onRefreshWorkspaceClick() {
  syncWorkspaceApps({ forceRerender: false });
  updateAccountStatus();
  log("应用列表已刷新", "info");
}

function onUploadMaxEdgeChange(event) {
  const nextUploadMaxEdge = normalizeUploadMaxEdge(event && event.target ? event.target.value : 0);
  const settings = store.getSettings();
  const pasteStrategy = normalizePasteStrategy(settings.pasteStrategy);
  store.saveSettings({
    pollInterval: settings.pollInterval,
    timeout: settings.timeout,
    uploadMaxEdge: nextUploadMaxEdge,
    pasteStrategy
  });
  const marker = UPLOAD_MAX_EDGE_LABELS[nextUploadMaxEdge] || "无限制";
  log(`上传分辨率策略已切换: ${marker}`, "info");
}

function onPasteStrategyChange(event) {
  const nextPasteStrategy = normalizePasteStrategy(event && event.target ? event.target.value : "");
  const settings = store.getSettings();
  const uploadMaxEdge = normalizeUploadMaxEdge(settings.uploadMaxEdge);
  store.saveSettings({
    pollInterval: settings.pollInterval,
    timeout: settings.timeout,
    uploadMaxEdge,
    pasteStrategy: nextPasteStrategy
  });
  const marker = PASTE_STRATEGY_LABELS[nextPasteStrategy] || nextPasteStrategy;
  log(`回贴策略已切换: ${marker}`, "info");
}

function bindWorkspaceEvents() {
  rebindEvent(dom.btnRun, "click", handleRun);
  rebindEvent(dom.btnOpenAppPicker, "click", openAppPickerModal);
  rebindEvent(dom.appPickerModalClose, "click", closeAppPickerModal);
  rebindEvent(dom.appPickerModal, "click", onAppPickerModalClick);
  rebindEvent(dom.appPickerList, "click", handleAppPickerListClick);
  rebindEvent(dom.appPickerSearchInput, "input", onAppPickerSearchInput);
  rebindEvent(dom.btnRefreshWorkspaceApps, "click", onRefreshWorkspaceClick);
  rebindEvent(dom.uploadMaxEdgeSelect, "change", onUploadMaxEdgeChange);
  rebindEvent(dom.pasteStrategySelect, "change", onPasteStrategyChange);
  rebindEvent(dom.templateModalClose, "click", closeTemplatePicker);
  rebindEvent(dom.templateModal, "click", onTemplateModalClick);
  rebindEvent(dom.templateList, "click", handleTemplateListClick);
  rebindEvent(dom.btnApplyTemplateSelection, "click", onApplyTemplateSelectionClick);
  rebindEvent(dom.btnCopyLog, "click", onCopyLogClick);
  rebindEvent(dom.btnClearLog, "click", onClearLogClick);

  rebindEvent(document, APP_EVENTS.APPS_CHANGED, onAppsChanged);
  rebindEvent(document, APP_EVENTS.TEMPLATES_CHANGED, onTemplatesChanged);
  rebindEvent(document, APP_EVENTS.SETTINGS_CHANGED, onSettingsChanged);
}

function onAppsChanged() {
  syncWorkspaceApps({ forceRerender: false });
}

function onTemplatesChanged() {
  if (dom.templateModal && dom.templateModal.classList.contains("active")) {
    const currentIds = new Set(store.getPromptTemplates().map((template) => String(template.id || "")));
    state.templatePickerSelectedIds = state.templatePickerSelectedIds.filter((id) => currentIds.has(String(id)));
    renderTemplatePickerList();
  }
}

function onSettingsChanged() {
  updateAccountStatus();
  syncUploadMaxEdgeSelect();
  syncPasteStrategySelect();
}

function cacheDomRefs() {
  const ids = [
    "btnRun",
    "btnOpenAppPicker",
    "btnRefreshWorkspaceApps",
    "uploadMaxEdgeSelect",
    "pasteStrategySelect",
    "btnCopyLog",
    "btnClearLog",
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
    "templateModalTitle",
    "templateList",
    "templateModalActions",
    "templateModalSelectionInfo",
    "btnApplyTemplateSelection",
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
  state.templatePickerMode = "single";
  state.templatePickerMaxSelection = 1;
  state.templatePickerSelectedIds = [];
  syncTemplatePickerUiState();
  syncUploadMaxEdgeSelect();
  syncPasteStrategySelect();
  workspaceInputs = null;
  getWorkspaceInputs();
  bindWorkspaceEvents();
  updateAccountStatus();
  syncWorkspaceApps({ forceRerender: true });
  updateRunButtonUI();
}

module.exports = { initWorkspaceController };
