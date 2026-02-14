// 引用服务和工具
const store = require("../services/store"); // 注意路径是 ../
const runninghub = require("../services/runninghub");
const { normalizeAppId, escapeHtml, inferInputType } = require("../utils");

// 定义 DOM 元素缓存
const dom = {};

function byId(id) { return document.getElementById(id); }

// 简单的日志工具 (因为 Settings 不常看日志，这里简化处理或复用全局日志)
function log(msg, type = "info") {
    console.log(`[Settings][${type}] ${msg}`);
    // 如果你想在设置页也显示 Toast，可以引入 toast 工具
    // showToast(msg);
}

// 状态管理
const state = {
    manualParams: [],
    parsedAppData: null,
    currentEditingAppId: null,
    currentEditingTemplateId: null
};

// === 核心逻辑 ===

// 1. 保存 API Key
function saveApiKeyAndSettings() {
    const apiKey = String(dom.apiKeyInput.value || "").trim();
    const pollInterval = Number(dom.pollIntervalInput.value) || 2;
    const timeout = Number(dom.timeoutInput.value) || 90;
    
    store.saveApiKey(apiKey);
    store.saveSettings({ pollInterval, timeout });
    
    alert("设置已保存"); // 简单反馈
}

// 2. 测试 API Key
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

// 3. 解析应用 (Parsing Logic)
async function parseApp() {
    const apiKey = store.getApiKey();
    const appId = normalizeAppId(dom.appIdInput.value);
    
    if (!appId) return alert("请输入有效的应用 ID 或 URL");
    if (!apiKey) return alert("请先保存 API Key");

    dom.btnParseApp.disabled = true;
    dom.btnParseApp.textContent = "解析中...";

    try {
        dom.appIdInput.value = appId; // 修正显示
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
        showManualConfig(e.message); // 解析失败转手动
    } finally {
        dom.btnParseApp.disabled = false;
        dom.btnParseApp.textContent = "解析";
    }
}

// 渲染解析结果
function renderParseResult(data) {
    const html = (data.inputs || []).map((input, idx) => `
        <div class="parse-result-item" style="margin-bottom:4px; font-size:11px;">
            <span style="color:#aaa;">${escapeHtml(input.key)} (${input.type})</span>
        </div>
    `).join("");

    dom.parseResultContainer.innerHTML = `
        <div style="background:#2a2a2a; padding:10px; border-radius:4px; margin-top:10px;">
            <div style="color:#4caf50; font-weight:bold; margin-bottom:5px;">✓ 解析成功: ${escapeHtml(data.name)}</div>
            <div style="max-height:100px; overflow-y:auto;">${html}</div>
            <button id="btnSaveParsedApp" class="main-btn main-btn-primary" style="margin-top:8px;">保存应用</button>
        </div>
    `;
    
    byId("btnSaveParsedApp").addEventListener("click", saveParsedApp);
    dom.manualConfigArea.style.display = "none";
}

// 保存解析后的应用
function saveParsedApp() {
    if (!state.parsedAppData) return;
    
    if (state.currentEditingAppId) {
        store.updateAiApp(state.currentEditingAppId, state.parsedAppData);
    } else {
        store.addAiApp(state.parsedAppData);
    }
    
    alert("应用已保存到工作台");
    clearAppEditorUI();
    renderSavedAppsList();
}

// 手动配置 (当解析失败时)
function showManualConfig(msg) {
    dom.parseResultContainer.innerHTML = `<div style="color:#ff6b6b; margin:10px 0;">解析失败: ${msg} <br>请手动添加参数:</div>`;
    dom.manualConfigArea.style.display = "block";
    state.manualParams = [];
    renderManualParams();
}

function renderManualParams() {
    // 简化版手动参数渲染，实际逻辑可从原文件复制更复杂的
    dom.manualParamsList.innerHTML = state.manualParams.map((p, i) => `
        <div class="input-grid" style="margin-bottom:4px;">
            <input type="text" value="${p.label}" placeholder="名称" onchange="window.updateManualParam(${i}, 'label', this.value)">
            <input type="text" value="${p.key}" placeholder="Key" onchange="window.updateManualParam(${i}, 'key', this.value)">
        </div>
    `).join("");
}

// 渲染已保存的应用列表
function renderSavedAppsList() {
    const apps = store.getAiApps();
    dom.savedAppsList.innerHTML = apps.map(app => `
        <div class="saved-item" style="border:1px solid #333; padding:8px; margin-bottom:5px; display:flex; justify-content:space-between; align-items:center;">
            <div>
                <div style="font-weight:bold;">${escapeHtml(app.name)}</div>
                <div style="font-size:10px; color:#777;">ID: ${app.appId}</div>
            </div>
            <div>
                <button class="tiny-btn" onclick="window.deleteApp('${app.id}')">删除</button>
            </div>
        </div>
    `).join("");
}

// 清理 UI
function clearAppEditorUI() {
    dom.appIdInput.value = "";
    dom.appNameInput.value = "";
    dom.parseResultContainer.innerHTML = "";
    dom.manualConfigArea.style.display = "none";
    state.parsedAppData = null;
    state.currentEditingAppId = null;
}

// === 全局暴露给 HTML onclick 使用的函数 (为了简化事件绑定) ===
window.deleteApp = (id) => {
    if(confirm("确定删除吗？")) {
        store.deleteAiApp(id);
        renderSavedAppsList();
    }
};

// 初始化
function initSettingsController() {
    // 绑定 DOM
    const ids = [
        "apiKeyInput", "pollIntervalInput", "timeoutInput", "toggleApiKey",
        "btnSaveApiKey", "btnTestApiKey", 
        "appIdInput", "appNameInput", "btnParseApp", "parseResultContainer",
        "manualConfigArea", "manualParamsList", "btnAddParam", "btnSaveManualApp", "savedAppsList"
    ];
    ids.forEach(id => dom[id] = byId(id));

    // 加载数据
    dom.apiKeyInput.value = store.getApiKey();
    const settings = store.getSettings();
    dom.pollIntervalInput.value = settings.pollInterval;
    dom.timeoutInput.value = settings.timeout;

    // 绑定事件
    dom.btnSaveApiKey.addEventListener("click", saveApiKeyAndSettings);
    dom.btnTestApiKey.addEventListener("click", testApiKey);
    dom.btnParseApp.addEventListener("click", parseApp);
    
    dom.toggleApiKey.addEventListener("click", () => {
        dom.apiKeyInput.type = dom.apiKeyInput.type === "password" ? "text" : "password";
    });

    // 初始渲染
    renderSavedAppsList();
}

module.exports = { initSettingsController };