const store = require("../services/store");
const runninghub = require("../services/runninghub");
const ps = require("../services/ps");
const { inferInputType, escapeHtml, isPromptLikeInput } = require("../utils"); // ✅ 路径已修复

const dom = {};
const state = {
    currentApp: null,
    inputValues: {},
    isRunning: false
};

function byId(id) { return document.getElementById(id); }

// 简单的 Toast 替代日志
function log(msg, type = "info") {
    // 你可以在这里对接 style.css 里的 .toast-container
    console.log(`[Workspace][${type}] ${msg}`);
    const logDiv = byId("logWindow"); // 兼容旧 UI
    if (logDiv) logDiv.innerHTML = `[${type}] ${msg}`;
}

// 刷新工作台的应用列表（从 Store 读取）
function refreshWorkspaceApps() {
    const apps = store.getAiApps();
    const listContainer = byId("appPickerList"); // 如果你有这个 Modal
    
    // 这里简化处理：直接更新“切换”按钮的状态或弹窗内容
    // 实际项目中，这里应该渲染 App 选择列表
    console.log("加载了 " + apps.length + " 个应用");
}

// === 核心：动态渲染参数 (Grid Layout) ===
function renderDynamicInputs(appItem) {
    state.currentApp = appItem;
    state.inputValues = {};
    
    const container = byId("dynamicInputContainer");
    const imgContainer = byId("imageInputContainer");
    
    if (!container) return;
    container.innerHTML = "";
    if (imgContainer) {
        imgContainer.innerHTML = "";
        imgContainer.style.display = "none";
    }

    if (!appItem) {
        container.innerHTML = `<div class="empty-state">请先选择一个应用</div>`;
        return;
    }

    const inputs = appItem.inputs || [];
    const imageInputs = inputs.filter(i => inferInputType(i.type) === "image");
    const otherInputs = inputs.filter(i => inferInputType(i.type) !== "image");

    // 1. 渲染图片参数
    if (imageInputs.length > 0 && imgContainer) {
        imgContainer.style.display = "block";
        imageInputs.forEach((input, idx) => {
            const field = createInputField(input, idx);
            imgContainer.appendChild(field);
        });
    }

    // 2. 渲染普通参数 (Grid)
    if (otherInputs.length > 0) {
        const grid = document.createElement("div");
        grid.className = "input-grid"; // CSS Grid 类名
        
        otherInputs.forEach((input, idx) => {
            const field = createInputField(input, idx);
            // 提示词或长文本占据整行
            if (input.type === "text" && (!input.options || input.options.length === 0)) {
                field.style.gridColumn = "span 2"; 
            }
            grid.appendChild(field);
        });
        container.appendChild(grid);
    }
}

// 创建单个输入框 DOM
function createInputField(input, idx) {
    const key = input.key || `param_${idx}`;
    const type = inferInputType(input.type);
    const label = input.label || input.name || key;
    
    const wrapper = document.createElement("div");
    wrapper.className = "control-group";

    const labelEl = document.createElement("label");
    labelEl.textContent = label + (input.required ? "*" : "");
    wrapper.appendChild(labelEl);

    let inputEl;

    // === 图片输入 ===
    if (type === "image") {
        inputEl = document.createElement("button");
        inputEl.className = "main-btn main-btn-secondary";
        inputEl.textContent = "从选区获取图片";
        inputEl.onclick = async () => {
            const capture = await ps.captureSelection({ log });
            if (capture && capture.base64) {
                state.inputValues[key] = capture.base64;
                inputEl.textContent = "图片已获取 ✓";
                inputEl.style.borderColor = "#4caf50";
            }
        };
    } 
    // === 下拉选择 ===
    else if (type === "select") {
        inputEl = document.createElement("select");
        (input.options || []).forEach(opt => {
            const option = document.createElement("option");
            option.value = opt;
            option.textContent = opt;
            inputEl.appendChild(option);
        });
        inputEl.onchange = (e) => state.inputValues[key] = e.target.value;
        // 默认值
        if (input.options && input.options.length > 0) state.inputValues[key] = input.options[0];
    }
    // === 文本/数字/其他 ===
    else {
        inputEl = input.type === "text" ? document.createElement("textarea") : document.createElement("input");
        if (input.type !== "text") inputEl.type = type === "number" ? "number" : "text";
        
        inputEl.placeholder = input.default || "";
        inputEl.value = input.default || "";
        state.inputValues[key] = inputEl.value; // 初始化默认值

        // === 提示词模板功能集成 ===
        if (isPromptLikeInput(input)) {
            // 这里可以添加一个小按钮 "载入模板"，点击弹出 store.getPromptTemplates()
            // 暂时为了简洁，先保证基础功能
            inputEl.placeholder = "输入提示词...";
        }

        inputEl.oninput = (e) => state.inputValues[key] = e.target.value;
    }

    wrapper.appendChild(inputEl);
    return wrapper;
}

// === 运行任务逻辑 ===
async function handleRun() {
    if (state.isRunning) return;
    const apiKey = store.getApiKey();
    if (!apiKey) return alert("请先设置 API Key");
    if (!state.currentApp) return alert("请先选择应用");

    state.isRunning = true;
    const btn = byId("btnRun");
    btn.textContent = "运行中...";
    btn.disabled = true;

    try {
        log("开始任务...", "info");
        // 1. 提交任务
        const taskId = await runninghub.runAppTask(apiKey, state.currentApp, state.inputValues, { log });
        log(`任务ID: ${taskId}`, "success");
        
        // 2. 轮询结果
        const settings = store.getSettings();
        const resultUrl = await runninghub.pollTaskOutput(apiKey, taskId, settings, { log });
        log("任务完成，下载结果...", "info");

        // 3. 下载并回贴
        const buffer = await runninghub.downloadResultBinary(resultUrl);
        await ps.placeImage(buffer, { log });
        log("已回贴到 Photoshop", "success");

    } catch (e) {
        log(`错误: ${e.message}`, "error");
        alert("运行失败: " + e.message);
    } finally {
        state.isRunning = false;
        btn.textContent = "开始运行";
        btn.disabled = false;
    }
}

// 处理应用切换（点击“切换”按钮）
function setupAppPicker() {
    const btn = byId("btnOpenAppPicker");
    const modal = byId("appPickerModal"); // 假设你在 index.html 加回了 modal
    if (!btn || !modal) return;

    btn.onclick = () => {
        modal.classList.add("active");
        const list = byId("appPickerList");
        const apps = store.getAiApps();
        
        if (apps.length === 0) {
            list.innerHTML = `<div class="empty-state">暂无应用，请去设置页解析</div>`;
            return;
        }

        list.innerHTML = apps.map(app => `
            <div class="app-picker-item" onclick="window.selectApp('${app.id}')">
                <div style="font-weight:bold">${app.name}</div>
                <div style="font-size:10px; opacity:0.7">ID: ${app.appId}</div>
            </div>
        `).join("");
    };

    // 关闭 Modal
    const closeBtn = byId("appPickerModalClose");
    if (closeBtn) closeBtn.onclick = () => modal.classList.remove("active");
}

// 全局暴露选择函数
window.selectApp = (id) => {
    const app = store.getAiApps().find(a => a.id === id);
    if (app) {
        renderDynamicInputs(app);
        byId("appPickerModal").classList.remove("active");
        byId("btnOpenAppPicker").textContent = `切换: ${app.name}`; // 更新按钮文字
    }
};

function initWorkspaceController() {
    setupAppPicker();
    const btnRun = byId("btnRun");
    if (btnRun) btnRun.addEventListener("click", handleRun);
    
    // 尝试自动加载第一个应用
    const apps = store.getAiApps();
    if (apps.length > 0) {
        window.selectApp(apps[0].id);
    }
}

module.exports = { initWorkspaceController };