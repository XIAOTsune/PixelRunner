const store = require("../services/store");
const runninghub = require("../services/runninghub");
const { normalizeAppId, escapeHtml } = require("../utils");
const { APP_EVENTS, emitAppEvent } = require("../events");
const { runPsEnvironmentDoctor, DIAGNOSTIC_STORAGE_KEY } = require("../diagnostics/ps-env-doctor");
const { byId, findClosestByClass, encodeDataId, decodeDataId, rebindEvent } = require("../shared/dom-utils");
const textInputPolicy = require("../domain/policies/text-input-policy");
const { saveSettingsUsecase } = require("../application/usecases/manage-settings");
const { parseRunninghubAppUsecase } = require("../application/usecases/parse-runninghub-app");
const {
  saveTemplateUsecase,
  importTemplatesUsecase,
  buildTemplateExportUsecase
} = require("../application/usecases/manage-templates");
let localFileSystem = null;
try {
  const { storage } = require("uxp");
  localFileSystem = storage && storage.localFileSystem;
} catch (_) {
  localFileSystem = null;
}

const PARSE_DEBUG_STORAGE_KEY = "rh_last_parse_debug";
const LARGE_PROMPT_WARNING_CHARS = textInputPolicy.LARGE_PROMPT_WARNING_CHARS;
const TEXT_INPUT_HARD_MAX_CHARS = textInputPolicy.TEXT_INPUT_HARD_MAX_CHARS;
const TEMPLATE_EXPORT_FILENAME_PREFIX = "pixelrunner_prompt_templates";
const UPLOAD_MAX_EDGE_CHOICES = [0, 4096, 2048, 1024];
const dom = {};

function log(msg) {
  console.log(`[Settings] ${msg}`);
}

function normalizeUploadMaxEdge(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return UPLOAD_MAX_EDGE_CHOICES.includes(num) ? num : 0;
}

const state = {
  manualParams: [],
  parsedAppData: null,
  currentEditingAppId: null
};

function toPrettyJson(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch (_) {
    return "";
  }
}

function summarizeDiagnostic(report) {
  if (!report || typeof report !== "object") return "诊断报告不可用。";
  const lines = [];
  lines.push(`Run ID: ${report.runId || "-"}`);
  lines.push(`Time: ${report.generatedAt || "-"}`);
  lines.push(`Stage: ${report.stage || "-"}`);
  lines.push("");
  lines.push(`DOM missing ids: ${(report.dom && report.dom.missingCount) || 0}`);
  lines.push(`Apps: ${(report.dataHealth && report.dataHealth.apps && report.dataHealth.apps.count) || 0}`);
  lines.push(`Empty app ids: ${(report.dataHealth && report.dataHealth.apps && report.dataHealth.apps.emptyIdCount) || 0}`);
  lines.push("");

  const persisted = report.persisted || {};
  lines.push(`Report JSON: ${persisted.jsonPath || "未写入文件"}`);
  lines.push(`Report TXT: ${persisted.textPath || "未写入文件"}`);
  if (persisted.error) lines.push(`Persist warning: ${persisted.error}`);
  lines.push("");

  lines.push("Recommendations:");
  const recommendations = Array.isArray(report.recommendations) ? report.recommendations : [];
  if (!recommendations.length) {
    lines.push("1. (none)");
  } else {
    recommendations.forEach((item, idx) => lines.push(`${idx + 1}. ${item}`));
  }

  lines.push("");
  lines.push("Raw JSON:");
  lines.push(toPrettyJson(report));
  return lines.join("\n");
}

function setEnvDoctorOutput(text) {
  if (!dom.envDoctorOutput) return;
  dom.envDoctorOutput.value = String(text || "");
  dom.envDoctorOutput.scrollTop = 0;
}

function appendEnvDoctorOutput(line) {
  if (!dom.envDoctorOutput) return;
  const current = String(dom.envDoctorOutput.value || "");
  const ts = new Date().toLocaleTimeString();
  dom.envDoctorOutput.value = `${current}${current ? "\n" : ""}[${ts}] ${line}`;
  dom.envDoctorOutput.scrollTop = dom.envDoctorOutput.scrollHeight;
}

async function runEnvironmentDoctorManual() {
  if (!dom.btnRunEnvDoctor) return;
  dom.btnRunEnvDoctor.disabled = true;
  dom.btnRunEnvDoctor.textContent = "检测中...";
  setEnvDoctorOutput("正在执行环境检测，请稍候...");

  try {
    const report = await runPsEnvironmentDoctor({ stage: "manual-settings" });
    setEnvDoctorOutput(summarizeDiagnostic(report));
  } catch (error) {
    const message = error && error.message ? error.message : String(error || "未知错误");
    setEnvDoctorOutput(`环境检测失败: ${message}`);
  } finally {
    dom.btnRunEnvDoctor.disabled = false;
    dom.btnRunEnvDoctor.textContent = "运行环境检测";
  }
}

function loadLatestDiagnosticReport() {
  let report = null;
  try {
    const raw = localStorage.getItem(DIAGNOSTIC_STORAGE_KEY);
    report = raw ? JSON.parse(raw) : null;
  } catch (_) {
    report = null;
  }

  if (!report) {
    setEnvDoctorOutput("未找到最近报告，请先点击“运行环境检测”。");
    return;
  }

  setEnvDoctorOutput(summarizeDiagnostic(report));
}

function summarizeParseDebug(debug) {
  if (!debug || typeof debug !== "object") return "Parse debug is not available.";
  const lines = [];
  lines.push(`Time: ${debug.generatedAt || "-"}`);
  lines.push(`Endpoint: ${debug.endpoint || "-"}`);
  lines.push(`App ID: ${debug.appId || "-"}`);
  lines.push("");
  lines.push(`Top-level keys: ${Array.isArray(debug.topLevelKeys) ? debug.topLevelKeys.join(", ") : "-"}`);
  lines.push(`Data keys: ${Array.isArray(debug.dataKeys) ? debug.dataKeys.join(", ") : "-"}`);
  lines.push(`Result keys: ${Array.isArray(debug.resultKeys) ? debug.resultKeys.join(", ") : "-"}`);
  lines.push("");
  lines.push(`Selected candidate: ${debug.selectedCandidatePath || "-"}`);
  lines.push(`Selected raw count: ${Number(debug.selectedRawCount) || 0}`);
  lines.push("");
  lines.push("Candidate arrays:");
  const candidates = Array.isArray(debug.candidateInputArrays) ? debug.candidateInputArrays : [];
  if (candidates.length === 0) {
    lines.push("1. (none)");
  } else {
    candidates.slice(0, 20).forEach((item, idx) => {
      lines.push(`${idx + 1}. ${item.path || "-"} | count=${Number(item.count) || 0}, inputLike=${Number(item.inputLikeCount) || 0}`);
    });
  }
  lines.push("");
  lines.push("First raw entries:");
  lines.push(toPrettyJson(Array.isArray(debug.firstRawEntries) ? debug.firstRawEntries : []));
  lines.push("");
  lines.push("Normalized inputs:");
  lines.push(toPrettyJson(Array.isArray(debug.normalizedInputs) ? debug.normalizedInputs : []));
  lines.push("");
  lines.push("Curl:");
  lines.push(toPrettyJson(debug.curl || {}));
  return lines.join("\n");
}

function loadParseDebugReport() {
  let report = null;
  try {
    const raw = localStorage.getItem(PARSE_DEBUG_STORAGE_KEY);
    report = raw ? JSON.parse(raw) : null;
  } catch (_) {
    report = null;
  }

  if (!report) {
    setEnvDoctorOutput("No parse debug found. Parse and save an app first, then click this button again.");
    return;
  }

  setEnvDoctorOutput(summarizeParseDebug(report));
}

function getDuplicateMeta(list) {
  const totals = Object.create(null);
  const occurrences = Object.create(null);

  list.forEach((item) => {
    const key = String((item && item.id) || "unknown-id");
    totals[key] = (totals[key] || 0) + 1;
  });

  return list.map((item) => {
    const key = String((item && item.id) || "unknown-id");
    occurrences[key] = (occurrences[key] || 0) + 1;
    return {
      id: key,
      isDuplicate: totals[key] > 1,
      index: occurrences[key],
      total: totals[key]
    };
  });
}

function getTextLength(value) {
  return textInputPolicy.getTextLength(value);
}

function getTailPreview(value, maxChars = 20) {
  return textInputPolicy.getTailPreview(value, maxChars);
}

function enforceLongTextCapacity(inputEl) {
  textInputPolicy.enforceLongTextCapacity(inputEl, TEXT_INPUT_HARD_MAX_CHARS);
}

function insertTextAtCursor(inputEl, rawText) {
  textInputPolicy.insertTextAtCursor(inputEl, rawText);
}

function updateTemplateLengthHint() {
  if (!dom.templateLengthHint) return;
  const titleValue = String((dom.templateTitleInput && dom.templateTitleInput.value) || "");
  const contentValue = String((dom.templateContentInput && dom.templateContentInput.value) || "");
  const titleLen = getTextLength(titleValue);
  const contentLen = getTextLength(contentValue);
  const tailPreview = getTailPreview(contentValue, 20);
  const isLarge = titleLen >= LARGE_PROMPT_WARNING_CHARS || contentLen >= LARGE_PROMPT_WARNING_CHARS;
  const baseMessage = `提示：标题 ${titleLen} / 内容 ${contentLen} 字符，末尾预览 ${tailPreview}。插件本地不会截断模板内容。`;

  if (isLarge) {
    dom.templateLengthHint.textContent = `${baseMessage} 建议控制在 4000 字符内，避免 RunningHub 侧拒绝。`;
    dom.templateLengthHint.style.color = "#ffb74d";
    return;
  }

  dom.templateLengthHint.textContent = `${baseMessage} 建议单条提示词控制在 4000 字符内。`;
  dom.templateLengthHint.style.color = "";
}

function onTemplateContentPaste(event) {
  const clipboardText =
    event &&
    event.clipboardData &&
    typeof event.clipboardData.getData === "function"
      ? event.clipboardData.getData("text/plain")
      : "";
  if (!clipboardText || !dom.templateContentInput) return;
  event.preventDefault();
  insertTextAtCursor(dom.templateContentInput, clipboardText);
  updateTemplateLengthHint();
}

function safeConfirm(message) {
  try {
    if (typeof confirm === "function") {
      return confirm(message);
    }
  } catch (error) {
    log(`confirm not available: ${error && error.message ? error.message : error}`);
  }
  // UXP 某些环境下可能没有 confirm，默认放行并继续删除。
  return true;
}

function saveApiKeyAndSettings() {
  const apiKey = String(dom.apiKeyInput.value || "").trim();
  const pollInterval = Number(dom.pollIntervalInput.value) || 2;
  const timeout = Number(dom.timeoutInput.value) || 180;
  const currentSettings = store.getSettings();
  const uploadMaxEdge = normalizeUploadMaxEdge(
    dom.uploadMaxEdgeSettingSelect ? dom.uploadMaxEdgeSettingSelect.value : currentSettings.uploadMaxEdge
  );

  const payload = saveSettingsUsecase({
    store,
    apiKey,
    pollInterval,
    timeout,
    uploadMaxEdge,
    pasteStrategy: currentSettings.pasteStrategy
  });
  emitAppEvent(APP_EVENTS.SETTINGS_CHANGED, payload);
  alert("设置已保存");
}

async function testApiKey() {
  const apiKey = String(dom.apiKeyInput.value || "").trim();
  if (!apiKey) {
    alert("请输入 API Key");
    return;
  }

  dom.btnTestApiKey.textContent = "测试中...";
  try {
    const result = await runninghub.testApiKey(apiKey);
    alert(result.message);
  } catch (error) {
    alert(`测试出错: ${error.message}`);
  } finally {
    dom.btnTestApiKey.textContent = "测试连接";
  }
}

async function parseApp() {
  const apiKey = store.getApiKey();
  const appId = normalizeAppId(dom.appIdInput.value);

  if (!appId) {
    alert("请输入有效的应用 ID 或 URL");
    return;
  }
  if (!apiKey) {
    alert("请先保存 API Key");
    return;
  }

  dom.btnParseApp.disabled = true;
  dom.btnParseApp.textContent = "解析中...";

  try {
    dom.appIdInput.value = appId;
    state.parsedAppData = await parseRunninghubAppUsecase({
      runninghub,
      appId,
      apiKey,
      preferredName: dom.appNameInput.value.trim(),
      log
    });
    renderParseResult(state.parsedAppData);
  } catch (error) {
    console.error(error);
    showManualConfig(error.message || "未知错误");
  } finally {
    dom.btnParseApp.disabled = false;
    dom.btnParseApp.textContent = "解析";
  }
}

function renderParseResult(data) {
  const html = (data.inputs || [])
    .map(
      (input) => `
        <div class="parse-result-item" style="margin-bottom:2px; font-size:10px; color:#aaa;">
            - ${escapeHtml(input.label || input.name || input.key || "未命名参数")} (${escapeHtml(input.key || "-")})
        </div>
    `
    )
    .join("");

  dom.parseResultContainer.innerHTML = `
        <div style="background:#2a2a2a; padding:8px; border-radius:4px; margin-top:8px;">
            <div style="color:#4caf50; font-weight:bold; font-size:11px; margin-bottom:4px;">解析成功: ${escapeHtml(data.name)}</div>
            <div style="max-height:80px; overflow-y:auto; margin-bottom:8px;">${html}</div>
            <button id="btnSaveParsedApp" class="main-btn main-btn-primary" type="button">保存到工作台</button>
        </div>
    `;

  const saveBtn = byId("btnSaveParsedApp");
  if (saveBtn) saveBtn.addEventListener("click", saveParsedApp);

  dom.manualConfigArea.style.display = "none";
}

function saveParsedApp() {
  if (!state.parsedAppData) return;

  const normalizedTargetAppId = normalizeAppId(state.parsedAppData.appId);
  const existing = store.getAiApps().find((item) => normalizeAppId(item && item.appId) === normalizedTargetAppId);
  let targetAppRecordId = "";

  if (existing && existing.id) {
    store.updateAiApp(existing.id, state.parsedAppData);
    targetAppRecordId = String(existing.id);
  } else {
    targetAppRecordId = store.addAiApp(state.parsedAppData);
  }

  emitAppEvent(APP_EVENTS.APPS_CHANGED, {
    reason: existing ? "updated" : "saved",
    targetAppId: targetAppRecordId,
    targetWorkflowId: normalizedTargetAppId
  });
  alert("应用已保存");

  clearAppEditorUI();
  renderSavedAppsList();
}

function showManualConfig(message) {
  dom.parseResultContainer.innerHTML = `<div style="color:#ff6b6b; font-size:11px; margin:8px 0;">解析失败: ${escapeHtml(message || "未知错误")}</div>`;
  dom.manualConfigArea.style.display = "block";
}

function renderSavedAppsList() {
  const apps = store.getAiApps();
  const duplicateMeta = getDuplicateMeta(apps);

  if (!apps.length) {
    dom.savedAppsList.innerHTML = `<div class="empty-state" style="padding:8px; font-size:11px; color:#777;">暂无已保存应用</div>`;
    return;
  }

  dom.savedAppsList.innerHTML = apps
    .map((app, idx) => {
      const meta = duplicateMeta[idx];
      const rawId = String((app && app.id) || "");
      const encodedRawId = encodeDataId(rawId);
      const duplicateTag = meta.isDuplicate
        ? `<span style="margin-left:6px; font-size:10px; color:#ffb74d;">重复 ${meta.index}/${meta.total}</span>`
        : "";

      return `
            <div class="saved-item" data-id="${encodedRawId}" style="background:#2a2a2a; border:1px solid #333; padding:8px; margin-bottom:6px; border-radius:4px; display:flex; justify-content:space-between; align-items:center;">
                <div>
                    <div style="font-weight:bold;">${escapeHtml(app.name || "未命名应用")}</div>
                    <div style="font-size:10px; color:#777;">应用ID: ${escapeHtml(app.appId || "-")}</div>
                    <div style="font-size:10px; color:#777;">记录ID: ${escapeHtml(meta.id)}${duplicateTag}</div>
                </div>
                <div style="display:flex; gap:6px;">
                    <button class="tiny-btn" type="button" data-action="edit-app" data-id="${encodedRawId}" ${rawId ? "" : "disabled"}>修改</button>
                    <button class="tiny-btn" type="button" data-action="delete-app" data-id="${encodedRawId}" ${rawId ? "" : "disabled"}>删除</button>
                </div>
            </div>
        `;
    })
    .join("");
}

function saveTemplate() {
  try {
    const result = saveTemplateUsecase({
      store,
      title: String(dom.templateTitleInput.value || ""),
      content: String(dom.templateContentInput.value || "")
    });
    emitAppEvent(APP_EVENTS.TEMPLATES_CHANGED, { reason: result.reason });
    dom.templateTitleInput.value = "";
    dom.templateContentInput.value = "";
    updateTemplateLengthHint();
    renderSavedTemplates();
  } catch (error) {
    alert(error && error.message ? error.message : String(error || "unknown"));
  }
}

function resolvePickedEntry(picked) {
  if (!picked) return null;
  if (Array.isArray(picked)) return picked[0] || null;
  return picked;
}

function normalizeReadText(value) {
  if (typeof value === "string") return value;
  if (value instanceof ArrayBuffer) {
    try {
      return new TextDecoder("utf-8").decode(new Uint8Array(value));
    } catch (_) {
      return "";
    }
  }
  if (ArrayBuffer.isView(value)) {
    try {
      const view = value;
      return new TextDecoder("utf-8").decode(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
    } catch (_) {
      return "";
    }
  }
  return String(value == null ? "" : value);
}

async function exportTemplatesJson() {
  if (!localFileSystem || typeof localFileSystem.getFileForSaving !== "function") {
    alert("Current environment does not support file export");
    return;
  }

  try {
    const exportResult = buildTemplateExportUsecase({
      store,
      filenamePrefix: TEMPLATE_EXPORT_FILENAME_PREFIX
    });
    const bundle = exportResult.bundle;
    const defaultName = exportResult.defaultName;
    const targetFile = await localFileSystem.getFileForSaving(defaultName);
    if (!targetFile) return;

    await targetFile.write(JSON.stringify(bundle, null, 2));
    const savedPath = targetFile.nativePath || targetFile.name || defaultName;
    appendEnvDoctorOutput(`Template export success: ${savedPath}`);
    const total = Array.isArray(bundle && bundle.templates) ? bundle.templates.length : 0;
    alert(`Template export completed: ${total} template(s)`);
  } catch (error) {
    const message = error && error.message ? error.message : String(error || "unknown");
    appendEnvDoctorOutput(`Template export failed: ${message}`);
    alert(`Template export failed: ${message}`);
  }
}

async function importTemplatesJson() {
  if (!localFileSystem || typeof localFileSystem.getFileForOpening !== "function") {
    alert("Current environment does not support file import");
    return;
  }

  try {
    const picked = await localFileSystem.getFileForOpening({ allowMultiple: false, types: ["json"] });
    const entry = resolvePickedEntry(picked);
    if (!entry) return;

    const rawText = normalizeReadText(await entry.read());
    const importResult = importTemplatesUsecase({
      store,
      payload: rawText
    });
    emitAppEvent(APP_EVENTS.TEMPLATES_CHANGED, {
      reason: importResult.reason,
      added: importResult.added,
      replaced: importResult.replaced,
      total: importResult.total
    });
    renderSavedTemplates();
    appendEnvDoctorOutput(
      `Template import success: total=${importResult.total}, added=${importResult.added}, replaced=${importResult.replaced}`
    );
    alert(
      `Template import completed: added ${importResult.added}, replaced ${importResult.replaced}, total ${importResult.total}`
    );
  } catch (error) {
    const message = error && error.message ? error.message : String(error || "unknown");
    appendEnvDoctorOutput(`Template import failed: ${message}`);
    alert(`Template import failed: ${message}`);
  }
}

function renderSavedTemplates() {
  const templates = store.getPromptTemplates();
  const duplicateMeta = getDuplicateMeta(templates);

  if (!templates.length) {
    dom.savedTemplatesList.innerHTML = `<div class="empty-state" style="padding:8px; font-size:11px; color:#777;">暂无模板</div>`;
    return;
  }

  dom.savedTemplatesList.innerHTML = templates
    .map((template, idx) => {
      const meta = duplicateMeta[idx];
      const rawId = String((template && template.id) || "");
      const encodedRawId = encodeDataId(rawId);
      const duplicateTag = meta.isDuplicate
        ? `<span style="margin-left:6px; font-size:10px; color:#ffb74d;">重复 ${meta.index}/${meta.total}</span>`
        : "";

      return `
            <div class="saved-item" data-id="${encodedRawId}" style="background:#2a2a2a; border:1px solid #333; padding:6px; margin-top:4px; border-radius:3px; display:flex; justify-content:space-between; align-items:center;">
                <div style="max-width:70%;">
                    <div style="font-weight:bold; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(template.title || "未命名模板")}</div>
                    <div style="font-size:10px; color:#777;">记录ID: ${escapeHtml(meta.id)}${duplicateTag}</div>
                </div>
                <div style="display:flex; gap:6px;">
                    <button class="tiny-btn" type="button" data-action="edit-template" data-id="${encodedRawId}" ${rawId ? "" : "disabled"}>修改</button>
                    <button class="tiny-btn" type="button" data-action="delete-template" data-id="${encodedRawId}" ${rawId ? "" : "disabled"}>删除</button>
                </div>
            </div>
        `;
    })
    .join("");
}

function onSavedAppsListClick(event) {
  const button = event.target && event.target.closest ? event.target.closest("button[data-action]") : null;
  if (!button) return;
  if (!dom.savedAppsList.contains(button)) return;

  if (button.dataset.action === "edit-app") {
    const row = findClosestByClass(button, "saved-item");
    const idFromButton = decodeDataId(String(button.dataset.id || "").trim());
    const idFromRow = row ? decodeDataId(String((row.dataset && row.dataset.id) || "").trim()) : "";
    const id = idFromButton || idFromRow;
    const app = store.getAiApps().find((item) => String(item.id) === String(id));
    if (!app) {
      alert("未找到应用记录");
      return;
    }
    dom.appIdInput.value = String(app.appId || "");
    dom.appNameInput.value = String(app.name || "");
    state.currentEditingAppId = String(app.id || "");
    state.parsedAppData = {
      appId: app.appId || "",
      name: app.name || "",
      description: app.description || "",
      inputs: Array.isArray(app.inputs) ? app.inputs : []
    };
    dom.parseResultContainer.innerHTML = `<div style="color:#aaa; font-size:11px; margin:6px 0;">已载入应用，点击“解析”重新拉取参数后保存。</div>`;
    dom.manualConfigArea.style.display = "none";
    return;
  }

  if (button.dataset.action !== "delete-app") return;

  const row = findClosestByClass(button, "saved-item");
  const idFromButton = decodeDataId(String(button.dataset.id || "").trim());
  const idFromRow = row ? decodeDataId(String((row.dataset && row.dataset.id) || "").trim()) : "";
  const id = idFromButton || idFromRow;
  if (!id) {
    appendEnvDoctorOutput("Delete app failed: missing app id in clicked row.");
    alert("删除失败：未找到应用 ID");
    return;
  }

  if (!safeConfirm("删除此应用？")) return;

  const deleted = store.deleteAiApp(id);
  if (!deleted) {
    appendEnvDoctorOutput(`Delete app not found: id=${id}`);
    alert("应用不存在或已被删除");
  } else {
    appendEnvDoctorOutput(`Delete app success: id=${id}`);
    emitAppEvent(APP_EVENTS.APPS_CHANGED, { reason: "deleted", id });
  }

  renderSavedAppsList();
}

function onSavedTemplatesListClick(event) {
  const button = event.target && event.target.closest ? event.target.closest("button[data-action]") : null;
  if (!button) return;
  if (!dom.savedTemplatesList.contains(button)) return;

  if (button.dataset.action === "edit-template") {
    const id = decodeDataId(String(button.dataset.id || "").trim());
    const template = store.getPromptTemplates().find((item) => String(item.id) === String(id));
    if (!template) {
      alert("未找到模板记录");
      return;
    }
    dom.templateTitleInput.value = String(template.title || "");
    dom.templateContentInput.value = String(template.content || "");
    updateTemplateLengthHint();
    return;
  }

  if (button.dataset.action !== "delete-template") return;

  const id = decodeDataId(String(button.dataset.id || "").trim());
  if (!id) {
    appendEnvDoctorOutput("Delete template failed: missing template id.");
    return;
  }

  if (!safeConfirm("删除此模板？")) return;

  const deleted = store.deletePromptTemplate(id);
  if (!deleted) {
    appendEnvDoctorOutput(`Delete template not found: id=${id}`);
    alert("模板不存在或已被删除");
  } else {
    appendEnvDoctorOutput(`Delete template success: id=${id}`);
    emitAppEvent(APP_EVENTS.TEMPLATES_CHANGED, { reason: "deleted", id });
  }

  renderSavedTemplates();
}

function clearAppEditorUI() {
  dom.appIdInput.value = "";
  dom.appNameInput.value = "";
  dom.parseResultContainer.innerHTML = "";
  dom.manualConfigArea.style.display = "none";

  state.parsedAppData = null;
  state.currentEditingAppId = null;
  state.manualParams = [];
}

function syncSettingsLists() {
  renderSavedAppsList();
  renderSavedTemplates();
}

function onAppsChanged() {
  renderSavedAppsList();
}

function onTemplatesChanged() {
  renderSavedTemplates();
}

function onToggleApiKey() {
  if (!dom.apiKeyInput) return;
  dom.apiKeyInput.type = dom.apiKeyInput.type === "password" ? "text" : "password";
}

function onAdvancedSettingsToggleClick() {
  const section = dom.advancedSettingsSection;
  const btn = dom.advancedSettingsToggle;
  if (!section || !btn) return;

  const isCollapsed = section.classList.contains("is-collapsed");
  if (isCollapsed) {
    section.classList.remove("is-collapsed");
    btn.textContent = "收起";
  } else {
    section.classList.add("is-collapsed");
    btn.textContent = "展开";
  }
}

function onEnvDiagnosticsToggleClick() {
  const section = dom.envDiagnosticsSection;
  const btn = dom.envDiagnosticsToggle;
  if (!section || !btn) return;

  const isCollapsed = section.classList.contains("is-collapsed");
  if (isCollapsed) {
    section.classList.remove("is-collapsed");
    btn.textContent = "收起";
  } else {
    section.classList.add("is-collapsed");
    btn.textContent = "展开";
  }
}

function initSettingsController() {
  const ids = [
    "apiKeyInput",
    "pollIntervalInput",
    "timeoutInput",
    "uploadMaxEdgeSettingSelect",
    "toggleApiKey",
    "btnSaveApiKey",
    "btnTestApiKey",
    "appIdInput",
    "appNameInput",
    "btnParseApp",
    "parseResultContainer",
    "manualConfigArea",
    "btnSaveManualApp",
    "savedAppsList",
    "templateTitleInput",
    "templateContentInput",
    "btnSaveTemplate",
    "btnExportTemplatesJson",
    "btnImportTemplatesJson",
    "savedTemplatesList",
    "templateLengthHint",
    "btnRunEnvDoctor",
    "btnLoadLatestDiag",
    "btnLoadParseDebug",
    "envDoctorOutput",
    "advancedSettingsHeader",
    "advancedSettingsToggle",
    "advancedSettingsSection",
    "envDiagnosticsHeader",
    "envDiagnosticsToggle",
    "envDiagnosticsSection"
  ];

  ids.forEach((id) => {
    dom[id] = byId(id);
  });

  if (dom.advancedSettingsSection) {
    dom.advancedSettingsSection.classList.add("is-collapsed");
  }
  if (dom.advancedSettingsToggle) {
    dom.advancedSettingsToggle.textContent = "展开";
  }
  if (dom.envDiagnosticsSection) {
    dom.envDiagnosticsSection.classList.add("is-collapsed");
  }
  if (dom.envDiagnosticsToggle) {
    dom.envDiagnosticsToggle.textContent = "展开";
  }

  dom.apiKeyInput.value = store.getApiKey();
  const settings = store.getSettings();
  dom.pollIntervalInput.value = settings.pollInterval;
  dom.timeoutInput.value = settings.timeout;
  if (dom.uploadMaxEdgeSettingSelect) {
    dom.uploadMaxEdgeSettingSelect.value = String(normalizeUploadMaxEdge(settings.uploadMaxEdge));
  }
  enforceLongTextCapacity(dom.templateContentInput);

  rebindEvent(dom.btnSaveApiKey, "click", saveApiKeyAndSettings);
  rebindEvent(dom.btnTestApiKey, "click", testApiKey);
  rebindEvent(dom.btnParseApp, "click", parseApp);
  rebindEvent(dom.toggleApiKey, "click", onToggleApiKey);
  rebindEvent(dom.btnSaveTemplate, "click", saveTemplate);
  rebindEvent(dom.btnExportTemplatesJson, "click", exportTemplatesJson);
  rebindEvent(dom.btnImportTemplatesJson, "click", importTemplatesJson);
  rebindEvent(dom.btnRunEnvDoctor, "click", runEnvironmentDoctorManual);
  rebindEvent(dom.btnLoadLatestDiag, "click", loadLatestDiagnosticReport);
  rebindEvent(dom.btnLoadParseDebug, "click", loadParseDebugReport);
  rebindEvent(dom.templateTitleInput, "input", updateTemplateLengthHint);
  rebindEvent(dom.templateContentInput, "input", updateTemplateLengthHint);
  rebindEvent(dom.templateContentInput, "paste", onTemplateContentPaste);
  rebindEvent(dom.savedAppsList, "click", onSavedAppsListClick);
  rebindEvent(dom.envDiagnosticsHeader, "click", onEnvDiagnosticsToggleClick);
  rebindEvent(dom.savedTemplatesList, "click", onSavedTemplatesListClick);
  rebindEvent(document, APP_EVENTS.APPS_CHANGED, onAppsChanged);
  rebindEvent(document, APP_EVENTS.TEMPLATES_CHANGED, onTemplatesChanged);

  const tabSettings = byId("tabSettings");
  rebindEvent(tabSettings, "click", syncSettingsLists);
  rebindEvent(dom.advancedSettingsHeader, "click", onAdvancedSettingsToggleClick);

  syncSettingsLists();
  updateTemplateLengthHint();
  loadLatestDiagnosticReport();
}

module.exports = { initSettingsController };
