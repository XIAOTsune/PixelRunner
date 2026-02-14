const store = require("../services/store");
const runninghub = require("../services/runninghub");
const { normalizeAppId, escapeHtml } = require("../utils");

const dom = {};
function byId(id) { return document.getElementById(id); }
function log(msg) { console.log(`[Settings] ${msg}`); }

const state = {
    manualParams: [],
    parsedAppData: null,
    currentEditingAppId: null
};

// === 1. 基础设置与 API Key ===
function saveApiKeyAndSettings() {
    const apiKey = String(dom.apiKeyInput.value || "").trim();
    // 高级设置
    const pollInterval = Number(dom.pollIntervalInput.value) || 2;
    const timeout = Number(dom.timeoutInput.value) || 90;
    
    store.saveApiKey(apiKey);
    store.saveSettings({ pollInterval, timeout });
    alert("设置已保存");
}

async function testApiKey() {
    const apiKey = String(dom.apiKeyInput.value || "").trim();
    if (!apiKey) return alert("请输入 API Key");
    
    dom.btnTestApiKey.textContent = "测试中...";
    try {
        const result = await runninghub.testApiKey(apiKey);
        alert(result.message);
    } catch (e) {
        alert("测试出错: " + e.message);
    } finally {
        dom.btnTestApiKey.textContent = "测试连接";
    }
}

// === 2. 应用解析逻辑 ===
async function parseApp() {
    const apiKey = store.getApiKey();
    const appId = normalizeAppId(dom.appIdInput.value);
    
    if (!appId) return alert("请输入有效的应用 ID 或 URL");
    if (!apiKey) return alert("请先保存 API Key");

    dom.btnParseApp.disabled = true;
    dom.btnParseApp.textContent = "解析中...";

    try {
        dom.appIdInput.value = appId;
        const data = await runninghub.fetchAppInfo(appId, apiKey, { log });
        
        state.parsedAppData = {
            appId,
            name: dom.appNameInput.value.trim() || data.name || "未命名应用",
            description: data.description || "",
            inputs: data.inputs
        };
        renderParseResult(state.parsedAppData);
    } catch (e) {
        console.error(e);
        showManualConfig(e.message);
    } finally {
        dom.btnParseApp.disabled = false;
        dom.btnParseApp.textContent = "解析";
    }
}

function renderParseResult(data) {
    const html = (data.inputs || []).map(input => `
        <div class="parse-result-item" style="margin-bottom:2px; font-size:10px; color:#aaa;">
            • ${escapeHtml(input.label || input.name)} (${input.key})
        </div>
    `).join("");

    dom.parseResultContainer.innerHTML = `
        <div style="background:#2a2a2a; padding:8px; border-radius:4px; margin-top:8px;">
            <div style="color:#4caf50; font-weight:bold; font-size:11px; margin-bottom:4px;">✓ 解析成功: ${escapeHtml(data.name)}</div>
            <div style="max-height:80px; overflow-y:auto; margin-bottom:8px;">${html}</div>
            <button id="btnSaveParsedApp" class="main-btn main-btn-primary">保存到工作台</button>
        </div>
    `;
    
    byId("btnSaveParsedApp").onclick = saveParsedApp;
    dom.manualConfigArea.style.display = "none";
}

function saveParsedApp() {
    if (!state.parsedAppData) return;
    store.addAiApp(state.parsedAppData);
    alert("应用已保存");
    clearAppEditorUI();
    renderSavedAppsList();
}

function showManualConfig(msg) {
    dom.parseResultContainer.innerHTML = `<div style="color:#ff6b6b; font-size:11px; margin:8px 0;">解析失败: ${msg}</div>`;
    dom.manualConfigArea.style.display = "block";
}

function renderSavedAppsList() {
    const apps = store.getAiApps();
    dom.savedAppsList.innerHTML = apps.map(app => `
        <div class="saved-item" style="background:#2a2a2a; border:1px solid #333; padding:8px; margin-bottom:6px; border-radius:4px; display:flex; justify-content:space-between; align-items:center;">
            <div>
                <div style="font-weight:bold;">${escapeHtml(app.name)}</div>
                <div style="font-size:10px; color:#777;">ID: ${app.appId}</div>
            </div>
            <button class="tiny-btn" onclick="window.deleteApp('${app.id}')">删除</button>
        </div>
    `).join("");
}

// === 3. 提示词模板逻辑 (新增) ===
function saveTemplate() {
    const title = dom.templateTitleInput.value.trim();
    const content = dom.templateContentInput.value.trim();
    if (!title || !content) return alert("标题和内容不能为空");
    
    store.addPromptTemplate({ title, content });
    dom.templateTitleInput.value = "";
    dom.templateContentInput.value = "";
    renderSavedTemplates();
}

function renderSavedTemplates() {
    const list = store.getPromptTemplates();
    dom.savedTemplatesList.innerHTML = list.map(t => `
        <div class="saved-item" style="background:#2a2a2a; border:1px solid #333; padding:6px; margin-top:4px; border-radius:3px; display:flex; justify-content:space-between;">
            <span style="font-weight:bold;">${escapeHtml(t.title)}</span>
            <button class="tiny-btn" onclick="window.deleteTemplate('${t.id}')">删除</button>
        </div>
    `).join("");
}

// === 4. UI 辅助 ===
function clearAppEditorUI() {
    dom.appIdInput.value = "";
    dom.appNameInput.value = "";
    dom.parseResultContainer.innerHTML = "";
    dom.manualConfigArea.style.display = "none";
    state.parsedAppData = null;
}

// 全局暴露删除函数
window.deleteApp = (id) => { if(confirm("删除此应用？")) { store.deleteAiApp(id); renderSavedAppsList(); } };
window.deleteTemplate = (id) => { if(confirm("删除此模板？")) { store.deletePromptTemplate(id); renderSavedTemplates(); } };

function initSettingsController() {
    // 绑定所有需要的 DOM ID
    const ids = [
        "apiKeyInput", "pollIntervalInput", "timeoutInput", "toggleApiKey",
        "btnSaveApiKey", "btnTestApiKey", 
        "appIdInput", "appNameInput", "btnParseApp", "parseResultContainer",
        "manualConfigArea", "btnSaveManualApp", "savedAppsList",
        "templateTitleInput", "templateContentInput", "btnSaveTemplate", "savedTemplatesList",
        "advancedSettingsHeader", "advancedSettingsToggle", "advancedSettingsSection"
    ];
    ids.forEach(id => dom[id] = byId(id));

    // 回填数据
    dom.apiKeyInput.value = store.getApiKey();
    const settings = store.getSettings();
    dom.pollIntervalInput.value = settings.pollInterval;
    dom.timeoutInput.value = settings.timeout;

    // 事件监听
    dom.btnSaveApiKey.addEventListener("click", saveApiKeyAndSettings);
    dom.btnTestApiKey.addEventListener("click", testApiKey);
    dom.btnParseApp.addEventListener("click", parseApp);
    dom.toggleApiKey.addEventListener("click", () => {
        dom.apiKeyInput.type = dom.apiKeyInput.type === "password" ? "text" : "password";
    });
    
    // 模板相关事件
    if (dom.btnSaveTemplate) dom.btnSaveTemplate.addEventListener("click", saveTemplate);
    
    // 高级设置折叠
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

    // 初始列表渲染
    renderSavedAppsList();
    renderSavedTemplates();
}

module.exports = { initSettingsController };