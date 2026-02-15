const store = require("../services/store");
const runninghub = require("../services/runninghub");
const { normalizeAppId, escapeHtml } = require("../utils");
const { APP_EVENTS, emitAppEvent } = require("../events");
const { runPsEnvironmentDoctor, DIAGNOSTIC_STORAGE_KEY } = require("../diagnostics/ps-env-doctor");

const dom = {};

function byId(id) {
    return document.getElementById(id);
}

function findClosestByClass(startNode, className) {
    let node = startNode;
    while (node && node !== document) {
        if (node.classList && node.classList.contains(className)) return node;
        node = node.parentNode;
    }
    return null;
}

function findClosestButtonWithAction(startNode) {
    let node = startNode;
    while (node && node !== document) {
        const isButton = node.tagName && String(node.tagName).toLowerCase() === "button";
        if (isButton && node.dataset && node.dataset.action) return node;
        node = node.parentNode;
    }
    return null;
}

function log(msg) {
    console.log(`[Settings] ${msg}`);
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
    if (!report || typeof report !== "object") return "诊断报告不可用";
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
        setEnvDoctorOutput("未找到最近报告。请先点击“运行环境检测”。");
        return;
    }

    setEnvDoctorOutput(summarizeDiagnostic(report));
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

function encodeDataId(id) {
    return encodeURIComponent(String(id || ""));
}

function decodeDataId(encodedId) {
    if (!encodedId) return "";
    try {
        return decodeURIComponent(encodedId);
    } catch (_) {
        return String(encodedId || "");
    }
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
    const timeout = Number(dom.timeoutInput.value) || 90;

    store.saveApiKey(apiKey);
    store.saveSettings({ pollInterval, timeout });
    emitAppEvent(APP_EVENTS.SETTINGS_CHANGED, { apiKeyChanged: true, settingsChanged: true });
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
    } catch (e) {
        alert(`测试出错: ${e.message}`);
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
        const data = await runninghub.fetchAppInfo(appId, apiKey, { log });

        state.parsedAppData = {
            appId,
            name: dom.appNameInput.value.trim() || data.name || "未命名应用",
            description: data.description || "",
            inputs: data.inputs || []
        };

        renderParseResult(state.parsedAppData);
    } catch (e) {
        console.error(e);
        showManualConfig(e.message || "未知错误");
    } finally {
        dom.btnParseApp.disabled = false;
        dom.btnParseApp.textContent = "解析";
    }
}

function renderParseResult(data) {
    const html = (data.inputs || []).map((input) => `
        <div class="parse-result-item" style="margin-bottom:2px; font-size:10px; color:#aaa;">
            - ${escapeHtml(input.label || input.name || input.key || "未命名参数")} (${escapeHtml(input.key || "-")})
        </div>
    `).join("");

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

    store.addAiApp(state.parsedAppData);
    emitAppEvent(APP_EVENTS.APPS_CHANGED, { reason: "saved" });
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

    dom.savedAppsList.innerHTML = apps.map((app, idx) => {
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
                <button class="tiny-btn" type="button" data-action="delete-app" data-id="${encodedRawId}" ${rawId ? "" : "disabled"}>删除</button>
            </div>
        `;
    }).join("");
}

function saveTemplate() {
    const title = String(dom.templateTitleInput.value || "").trim();
    const content = String(dom.templateContentInput.value || "").trim();

    if (!title || !content) {
        alert("标题和内容不能为空");
        return;
    }

    store.addPromptTemplate({ title, content });
    emitAppEvent(APP_EVENTS.TEMPLATES_CHANGED, { reason: "saved" });
    dom.templateTitleInput.value = "";
    dom.templateContentInput.value = "";
    renderSavedTemplates();
}

function renderSavedTemplates() {
    const templates = store.getPromptTemplates();
    const duplicateMeta = getDuplicateMeta(templates);

    if (!templates.length) {
        dom.savedTemplatesList.innerHTML = `<div class="empty-state" style="padding:8px; font-size:11px; color:#777;">暂无模板</div>`;
        return;
    }

    dom.savedTemplatesList.innerHTML = templates.map((template, idx) => {
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
                <button class="tiny-btn" type="button" data-action="delete-template" data-id="${encodedRawId}" ${rawId ? "" : "disabled"}>删除</button>
            </div>
        `;
    }).join("");
}

function onSavedAppsListClick(event) {
    const button = findClosestButtonWithAction(event.target);
    if (!button || button.dataset.action !== "delete-app") return;
    if (!dom.savedAppsList.contains(button)) return;

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
    const button = findClosestButtonWithAction(event.target);
    if (!button || button.dataset.action !== "delete-template") return;
    if (!dom.savedTemplatesList.contains(button)) return;

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

function initSettingsController() {
    const ids = [
        "apiKeyInput",
        "pollIntervalInput",
        "timeoutInput",
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
        "savedTemplatesList",
        "btnRunEnvDoctor",
        "btnLoadLatestDiag",
        "envDoctorOutput",
        "advancedSettingsHeader",
        "advancedSettingsToggle",
        "advancedSettingsSection"
    ];

    ids.forEach((id) => {
        dom[id] = byId(id);
    });

    dom.apiKeyInput.value = store.getApiKey();
    const settings = store.getSettings();
    dom.pollIntervalInput.value = settings.pollInterval;
    dom.timeoutInput.value = settings.timeout;

    dom.btnSaveApiKey.addEventListener("click", saveApiKeyAndSettings);
    dom.btnTestApiKey.addEventListener("click", testApiKey);
    dom.btnParseApp.addEventListener("click", parseApp);

    dom.toggleApiKey.addEventListener("click", () => {
        dom.apiKeyInput.type = dom.apiKeyInput.type === "password" ? "text" : "password";
    });

    if (dom.btnSaveTemplate) {
        dom.btnSaveTemplate.addEventListener("click", saveTemplate);
    }
    if (dom.btnRunEnvDoctor) {
        dom.btnRunEnvDoctor.addEventListener("click", runEnvironmentDoctorManual);
    }
    if (dom.btnLoadLatestDiag) {
        dom.btnLoadLatestDiag.addEventListener("click", loadLatestDiagnosticReport);
    }

    if (dom.savedAppsList) {
        dom.savedAppsList.removeEventListener("click", onSavedAppsListClick);
        dom.savedAppsList.addEventListener("click", onSavedAppsListClick);
    }

    if (dom.savedTemplatesList) {
        dom.savedTemplatesList.removeEventListener("click", onSavedTemplatesListClick);
        dom.savedTemplatesList.addEventListener("click", onSavedTemplatesListClick);
    }

    document.removeEventListener(APP_EVENTS.APPS_CHANGED, onAppsChanged);
    document.addEventListener(APP_EVENTS.APPS_CHANGED, onAppsChanged);
    document.removeEventListener(APP_EVENTS.TEMPLATES_CHANGED, onTemplatesChanged);
    document.addEventListener(APP_EVENTS.TEMPLATES_CHANGED, onTemplatesChanged);

    const tabSettings = byId("tabSettings");
    if (tabSettings) {
        tabSettings.removeEventListener("click", syncSettingsLists);
        tabSettings.addEventListener("click", syncSettingsLists);
    }

    if (dom.advancedSettingsHeader) {
        dom.advancedSettingsHeader.addEventListener("click", () => {
            const section = dom.advancedSettingsSection;
            const btn = dom.advancedSettingsToggle;
            const isCollapsed = section.classList.contains("is-collapsed");

            if (isCollapsed) {
                section.classList.remove("is-collapsed");
                btn.textContent = "收起";
            } else {
                section.classList.add("is-collapsed");
                btn.textContent = "展开";
            }
        });
    }

    syncSettingsLists();
    loadLatestDiagnosticReport();
}

module.exports = { initSettingsController };
