const store = require("../services/store");
const runninghub = require("../services/runninghub");
const ps = require("../services/ps");
// 再次确认这里引入了 isPromptLikeInput，如果没有 utils.js 里没导出也会报错
const { inferInputType, escapeHtml, isPromptLikeInput, isEmptyValue } = require("../utils");

const dom = {};
const state = {
    currentApp: null,
    inputValues: {},
    imageBounds: {},
    isRunning: false,
    abortController: null,
    timerId: null
};

function byId(id) { return document.getElementById(id); }

function revokePreviewUrl(value) {
    if (!value || typeof value !== "object") return;
    const url = String(value.previewUrl || "");
    if (url.startsWith("blob:")) {
        try { URL.revokeObjectURL(url); } catch (_) {}
    }
}

function createPreviewUrlFromBuffer(arrayBuffer) {
    try {
        const blob = new Blob([arrayBuffer], { type: "image/png" });
        return URL.createObjectURL(blob);
    } catch (_) {
        try {
            let binary = "";
            const bytes = new Uint8Array(arrayBuffer);
            const chunkSize = 0x8000;
            for (let i = 0; i < bytes.byteLength; i += chunkSize) {
                const chunk = bytes.subarray(i, i + chunkSize);
                binary += String.fromCharCode(...chunk);
            }
            return `data:image/png;base64,${btoa(binary)}`;
        } catch (_) {
            return "";
        }
    }
}

// 日志辅助
function log(msg, type = "info") {
    console.log(`[Workspace][${type}] ${msg}`);
    const logDiv = byId("logWindow");
    // 兼容旧版日志窗口，如果有的话
    if (logDiv) {
        // 如果是清空指令
        if (msg === "CLEAR") {
            logDiv.innerHTML = "";
            return;
        }
        const time = new Date().toLocaleTimeString();
        const color = type === "error" ? "#ff6b6b" : (type === "success" ? "#4caf50" : "#bbb");
        logDiv.innerHTML += `<div style="color:${color}; margin-top:4px;">[${time}] ${msg}</div>`;
        // 自动滚动到底部
        logDiv.scrollTop = logDiv.scrollHeight;
    }
}

// === 1. 账户信息逻辑 ===
async function updateAccountStatus() {
    const apiKey = store.getApiKey();
    const balanceEl = byId("accountBalanceValue");
    const coinsEl = byId("accountCoinsValue");
    const summaryEl = byId("accountSummary");

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
    } catch (e) {
        console.error("获取账户信息失败", e);
        // 不弹窗打扰用户，只在控制台显示
    }
}

// === 2. 动态参数渲染 (核心修复) ===
function renderDynamicInputs(appItem) {
    Object.values(state.inputValues || {}).forEach(revokePreviewUrl);
    state.currentApp = appItem;
    state.inputValues = {};
    state.imageBounds = {};
    
    // 获取 DOM 元素
    const container = byId("dynamicInputContainer");
    const imgContainer = byId("imageInputContainer");
    const btnRun = byId("btnRun");
    const metaEl = byId("appPickerMeta");

    // 更新顶部元数据
    if (metaEl) {
        if (appItem) {
            // 直接显示应用名称，不再显示 "当前：" 前缀，显得更简洁
            metaEl.innerHTML = escapeHtml(appItem.name);
            metaEl.title = appItem.name; // 鼠标悬停显示全名
        } else {
            metaEl.innerHTML = `<span class="placeholder-text">请选择应用</span>`;
        }
    }

    // 清空旧内容
    if (container) container.innerHTML = "";
    if (imgContainer) {
        imgContainer.innerHTML = "";
        imgContainer.style.display = "none";
    }

    // === 关键修复：解锁按钮 ===
    if (!appItem) {
        if (container) container.innerHTML = `<div class="empty-state">请点击上方“切换”选择应用</div>`;
        if (btnRun) {
            btnRun.disabled = true; // 没选应用时禁用
            btnRun.textContent = "开始运行";
        }
        return;
    }

    // 既然选了应用，就启用按钮
    if (btnRun) {
        btnRun.disabled = false;
        btnRun.textContent = `运行: ${appItem.name}`;
    }

    const inputs = appItem.inputs || [];
    
    // 分类参数
    const imageInputs = inputs.filter(i => inferInputType(i.type) === "image");
    const otherInputs = inputs.filter(i => inferInputType(i.type) !== "image");

    // 渲染图片参数
    if (imageInputs.length > 0 && imgContainer) {
        imgContainer.style.display = "block";
        imageInputs.forEach((input, idx) => {
            const field = createInputField(input, idx);
            imgContainer.appendChild(field);
        });
    }

    // 渲染普通参数
    if (otherInputs.length > 0 && container) {
        const grid = document.createElement("div");
        grid.className = "input-grid"; // 使用 style.css 里的 grid
        
        otherInputs.forEach((input, idx) => {
            const field = createInputField(input, idx);
            const type = inferInputType(input.type);
            const isLong = type === "text" && (!input.options || input.options.length === 0);
            
            // 安全检查 isPromptLikeInput
            let isPrompt = false;
            try { isPrompt = isPromptLikeInput(input); } catch(e) { console.warn("utils.isPromptLikeInput missing?"); }

            if (isLong || isPrompt) {
                field.classList.add("full-width");
                field.style.gridColumn = "span 2"; 
            }
            grid.appendChild(field);
        });
        container.appendChild(grid);
    } else if (imageInputs.length === 0 && container) {
        container.innerHTML = `<div class="empty-state" style="padding:10px; font-size:12px;">该应用没有可配置参数，请直接运行</div>`;
    }
}

function createInputField(input, idx) {
    const key = input.key || `param_${idx}`;
    const type = inferInputType(input.type);
    const label = input.label || input.name || key;
    
    // 注意：原来的 wrapper 只是个 div，现在如果是图片，我们不用 dynamic-input-field 类
    // 而是单独处理
    
    if (type === "image") {
        //创建外层容器（包括label和wrapper）
        const container = document.createElement("div");
        container.style.marginBottom = "12px";

        // 1. 创建 Label (显示在图片框上方)
        const labelEl = document.createElement("div");
        labelEl.className = "dynamic-input-label";
        labelEl.innerHTML = `${escapeHtml(label)} ${input.required ? '<span class="dynamic-input-required">*</span>' : ''}`;
        
        // 2. 创建图片点击区域 wrapper
        const wrapper = document.createElement("div");
        wrapper.className = "image-input-wrapper";
        
        // 我们直接用 innerHTML 来构建结构，比 createElment 更直观
        wrapper.innerHTML = `
            <img class="image-preview" alt="Preview" />
            <div class="image-input-overlay-content">
                <div class="image-input-icon">📸</div>
                <div class="image-input-text">点击从 PS 选区获取</div>
            </div>
        `;

        // 绑定点击事件到整个 wrapper（大方框）
        wrapper.onclick = async () => {
            const statusText = wrapper.querySelector(".image-input-text");
            const previewImg = wrapper.querySelector(".image-preview");
            if (!statusText || !previewImg) return;
            
            // 简单防抖，防止连点
            if(statusText.textContent === "获取中...") return;
            
            statusText.textContent = "获取中...";
            
            try {
                // 调用 PS 服务
                const capture = await ps.captureSelection({ log });
                
                if (capture && capture.arrayBuffer) {
                    revokePreviewUrl(state.inputValues[key]);
                    const previewUrl = createPreviewUrlFromBuffer(capture.arrayBuffer);
                    
                    state.inputValues[key] = { arrayBuffer: capture.arrayBuffer, previewUrl };
                    if (capture.selectionBounds) {
                        state.imageBounds[key] = capture.selectionBounds;
                    }
                    
                    // 更新 UI 状态
                    previewImg.src = previewUrl;
                    previewImg.classList.add("has-image"); // 显示图片
                    wrapper.classList.add("has-image");    // 改变容器样式
                    
                    statusText.textContent = "✅ 点击可重新获取";
                    statusText.style.color = "#4caf50";
                } else {
                    statusText.textContent = "⚠️ 未获取到图片";
                    statusText.style.color = "#ff6b6b";
                    setTimeout(() => {
                        statusText.textContent = "点击从 PS 选区获取";
                        statusText.style.color = "#ccc";
                    }, 2000);
                }
            } catch (e) {
                console.error(e);
                statusText.textContent = "❌ 获取失败";
            }
        };
        
        // 如果需要加标签（Label），可以在 wrapper 外面再包一层，
        // 但既然你想要大图效果，标签可以是图片上方的一个小标题，或者利用 tooltip
        // 这里为了配合你的 grid 布局，我建议直接返回 wrapper
        // 如果你的 createDynamicInputs 里有 labelEl 的逻辑，记得那里可能要调整
        // 按照你之前的逻辑，wrapper 里面包含了 labelEl。
        // 为了布局美观，我们可以把 label 放在 wrapper 外部上方
    
        container.appendChild(labelEl);
        container.appendChild(wrapper);
        
        return container;
    } 

    // === 以下是其他类型的输入框 (Select, Text, etc.)，保持原样或微调 ===
    const wrapper = document.createElement("div");
    wrapper.className = "dynamic-input-field"; 

    const labelEl = document.createElement("div");
    labelEl.className = "dynamic-input-label";
    labelEl.innerHTML = `${escapeHtml(label)} ${input.required ? '<span class="dynamic-input-required">*</span>' : ''}`;
    wrapper.appendChild(labelEl);

    let inputEl;
    // ... (后续 select / boolean / text 逻辑保持原来的代码不变) ...
    // ... 这里把原来代码里 else if (type === "select") 及其后面的部分粘回来即可 ...
    
    // 为了代码完整性，这里简写示意，你需要保留原来的其他输入框逻辑
    if (type === "select") { 
        /* 原有代码 */ 
        inputEl = document.createElement("select");
        (input.options || []).forEach(opt => {
            const option = document.createElement("option");
            option.value = opt;
            option.textContent = opt;
            inputEl.appendChild(option);
        });
        const defVal = input.default || (input.options && input.options[0]);
        if (defVal) {
            inputEl.value = defVal;
            state.inputValues[key] = defVal;
        }
        inputEl.onchange = (e) => state.inputValues[key] = e.target.value;
    } 
    else if (type === "boolean") { /* 原有代码 */ 
        inputEl = document.createElement("select");
        inputEl.innerHTML = `<option value="true">是 (True)</option><option value="false">否 (False)</option>`;
        inputEl.value = String(input.default) === "true" ? "true" : "false";
        state.inputValues[key] = inputEl.value === "true";
        inputEl.onchange = (e) => state.inputValues[key] = e.target.value === "true";
    }
    else { /* 原有代码 */ 
        inputEl = input.type === "text" ? document.createElement("textarea") : document.createElement("input");
        if (input.type !== "text") inputEl.type = type === "number" ? "number" : "text";
        inputEl.placeholder = input.default || "";
        inputEl.value = input.default || "";
        state.inputValues[key] = inputEl.value;
        try { if (isPromptLikeInput(input)) { inputEl.placeholder = "在此输入提示词..."; inputEl.rows = 2; } } catch(e) {}
        inputEl.oninput = (e) => state.inputValues[key] = e.target.value;
    }

    wrapper.appendChild(inputEl);
    return wrapper;
}

// === 3. 运行任务逻辑 ===
// 辅助函数：格式化时间 (0.00s)
function formatTime(startTime) {
    const now = Date.now();
    const seconds = (now - startTime) / 1000;
    return seconds.toFixed(2) + "s";
}

function resolveTargetBounds() {
    if (!state.currentApp) return null;
    const inputs = Array.isArray(state.currentApp.inputs) ? state.currentApp.inputs : [];
    for (const input of inputs) {
        const type = inferInputType(input.type || input.fieldType);
        if (type !== "image") continue;
        const key = String(input.key || "").trim();
        if (!key) continue;
        if (isEmptyValue(state.inputValues[key])) continue;
        if (state.imageBounds[key]) return state.imageBounds[key];
    }
    return null;
}

async function handleRun() {
    const btn = byId("btnRun");

    // === 逻辑 A: 如果正在运行，点击按钮意味着“中止” ===
    if (state.isRunning) {
        if (state.abortController) {
            state.abortController.abort(); // 发送中止信号
            log("🛑 用户请求中止任务...", "warn");
        }
        return;
    }
    
    // === 逻辑 B: 开始新任务 ===
    const apiKey = store.getApiKey();
    if (!apiKey) return alert("请先在设置页配置 API Key");
    if (!state.currentApp) return alert("请先选择一个应用");

    // 1. 初始化状态
    state.isRunning = true;
    state.abortController = new AbortController(); // 创建控制器
    const signal = state.abortController.signal;   // 获取信号对象
    
    // 2. 启动计时器
    const startTime = Date.now();
    btn.classList.add("running"); // 可以去 css 加个红色样式
    
    state.timerId = setInterval(() => {
        btn.textContent = `⏹ 中止 (${formatTime(startTime)})`;
    }, 50); // 每50ms刷新一次 UI

    // 清空日志
    log("CLEAR");
    log("🚀 开始任务...", "info");

    try {
        // 注意：我们需要把 signal 传给 service 层
        const runOptions = { log, signal };

        // 1. 提交任务
        const taskId = await runninghub.runAppTask(apiKey, state.currentApp, state.inputValues, runOptions);
        log(`✅ 任务提交 ID: ${taskId}`, "success");
        
        // 2. 轮询结果
        const settings = store.getSettings();
        const resultUrl = await runninghub.pollTaskOutput(apiKey, taskId, settings, runOptions);
        log("📥 任务完成，下载中...", "info");

        // 3. 下载并回贴
        // 获取回贴坐标（结合第一步的代码）
        const targetBounds = resolveTargetBounds();

        // 此时不再需要检查 signal，因为 fetch 内部会处理，但最好在下载前判断一下
        if (signal.aborted) throw new Error("用户中止");

        const buffer = await runninghub.downloadResultBinary(resultUrl, runOptions);
        await ps.placeImage(buffer, { log, targetBounds });
        
        log(`✨ 全部完成，耗时 ${formatTime(startTime)}`, "success");
        updateAccountStatus();

    } catch (e) {
        // 判断是否是用户主动取消
        if (e.name === 'AbortError' || (e.message && e.message.includes("用户中止"))) {
            log("🛑 任务已中止", "warn");
        } else {
            console.error(e);
            log(`❌ 运行失败: ${e.message}`, "error");
            alert("运行失败: " + e.message);
        }
    } finally {
        // === 清理工作 ===
        state.isRunning = false;
        state.abortController = null;
        if (state.timerId) clearInterval(state.timerId);
        
        // 恢复按钮状态
        btn.classList.remove("running");
        btn.textContent = `运行: ${state.currentApp.name}`;
        btn.disabled = false;
    }
}

// === 4. App Picker 交互 ===
function setupAppPicker() {
    const btn = byId("btnOpenAppPicker");
    const modal = byId("appPickerModal");
    const closeBtn = byId("appPickerModalClose");
    const list = byId("appPickerList");

    if (!btn || !modal) return;

    btn.onclick = () => {
        const list = byId("appPickerList");
        const apps = store.getAiApps();
        
        modal.classList.add("active");

        if (apps.length === 0) {
            list.innerHTML = `<div class="empty-state">
                <div style="margin-bottom:10px;">暂无已保存的应用</div>
                <button class="main-btn" onclick="document.getElementById('appPickerModalClose').click(); document.getElementById('tabSettings').click();">去设置页解析</button>
            </div>`;
            return;
        }

        list.innerHTML = apps.map(app => `
            <div class="app-picker-item" data-id="${app.id}">
                <div>
                    <div style="font-weight:bold; font-size:12px;">${escapeHtml(app.name)}</div>
                    <div style="font-size:10px; opacity:0.6">${app.appId}</div>
                </div>
                <div style="font-size:16px; color:#aaa;">›</div>
            </div>
        `).join("");
    };

    if (closeBtn) closeBtn.onclick = () => modal.classList.remove("active");

    // --- 新增：事件委托监听列表点击 ---
    // 类似于 Python GUI 里的 bind event
    list.onclick = (e) => {
        // 向上寻找最近的 .app-picker-item 元素
        const item = e.target.closest(".app-picker-item");
        if (item) {
            const appId = item.dataset.id; // 获取 data-id
            selectAppInternal(appId);      // 调用内部函数
        }
    };
}

// === 5. 全局选择函数 (关键修复：增加 try-catch 防止报错卡死弹窗) ===
// 把原来的 window.selectApp 改名为内部函数 selectAppInternal
// 并不再挂载到 window 上，避免全局污染
function selectAppInternal(id) {
    try {
        console.log("正在选择应用:", id);
        const app = store.getAiApps().find(a => a.id === id);
        if (app) {
            renderDynamicInputs(app);
            // 关闭弹窗
            const modal = byId("appPickerModal");
            if (modal) modal.classList.remove("active");
        } else {
            alert("应用不存在，请刷新");
        }
    } catch (e) {
        console.error(e);
        alert("加载应用失败: " + e.message);
    }
}

// === 6. 初始化入口 ===
function initWorkspaceController() {
    setupAppPicker();
    
    const btnRun = byId("btnRun");
    if (btnRun) btnRun.addEventListener("click", handleRun);
    
    const btnRefresh = byId("btnRefreshWorkspaceApps");
    if (btnRefresh) {
        btnRefresh.onclick = () => {
            updateAccountStatus();
            alert("余额已刷新");
        };
    }

    updateAccountStatus();
    
    // 自动加载第一个应用
    const apps = store.getAiApps();
    if (apps.length > 0) {
        selectAppInternal(apps[0].id);
    }
}

module.exports = { initWorkspaceController };
