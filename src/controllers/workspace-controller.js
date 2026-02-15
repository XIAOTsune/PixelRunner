const store = require("../services/store");
const runninghub = require("../services/runninghub");
const ps = require("../services/ps");
const { inferInputType, escapeHtml, isPromptLikeInput, isEmptyValue } = require("../utils");
const { APP_EVENTS } = require("../events");

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

function byId(id) {
    return document.getElementById(id);
}

function revokePreviewUrl(value) {
    if (!value || typeof value !== "object") return;
    const url = String(value.previewUrl || "");
    if (!url.startsWith("blob:")) return;
    try {
        URL.revokeObjectURL(url);
    } catch (_) {}
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

function decodeDataId(encodedId) {
    if (!encodedId) return "";
    try {
        return decodeURIComponent(encodedId);
    } catch (_) {
        return String(encodedId);
    }
}

function encodeDataId(id) {
    return encodeURIComponent(String(id || ""));
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
    } catch (e) {
        console.error("获取账户信息失败", e);
    }
}

function renderDynamicInputs(appItem) {
    Object.values(state.inputValues || {}).forEach(revokePreviewUrl);
    state.currentApp = appItem || null;
    state.inputValues = {};
    state.imageBounds = {};

    const container = dom.dynamicInputContainer || byId("dynamicInputContainer");
    const imgContainer = dom.imageInputContainer || byId("imageInputContainer");

    updateCurrentAppMeta();

    if (container) container.innerHTML = "";
    if (imgContainer) {
        imgContainer.innerHTML = "";
        imgContainer.style.display = "none";
    }

    if (!appItem) {
        if (container) {
            container.innerHTML = `<div class="empty-state">请点击上方“切换”选择应用</div>`;
        }
        updateRunButtonUI();
        return;
    }

    const inputs = Array.isArray(appItem.inputs) ? appItem.inputs : [];
    const imageInputs = inputs.filter((input) => inferInputType(input.type || input.fieldType) === "image");
    const otherInputs = inputs.filter((input) => inferInputType(input.type || input.fieldType) !== "image");

    if (imageInputs.length > 0 && imgContainer) {
        imgContainer.style.display = "block";
        imageInputs.forEach((input, idx) => {
            const field = createInputField(input, idx);
            imgContainer.appendChild(field);
        });
    }

    if (otherInputs.length > 0 && container) {
        const grid = document.createElement("div");
        grid.className = "input-grid";

        otherInputs.forEach((input, idx) => {
            const field = createInputField(input, idx);
            const inputType = inferInputType(input.type || input.fieldType);
            const isLongText = inputType === "text" && (!input.options || input.options.length === 0);
            let isPrompt = false;
            try {
                isPrompt = isPromptLikeInput(input);
            } catch (_) {
                isPrompt = false;
            }
            if (isLongText || isPrompt) {
                field.classList.add("full-width");
                field.style.gridColumn = "span 2";
            }
            grid.appendChild(field);
        });

        container.appendChild(grid);
    } else if (imageInputs.length === 0 && container) {
        container.innerHTML = `<div class="empty-state" style="padding:10px; font-size:12px;">该应用没有可配置参数，请直接运行</div>`;
    }

    updateRunButtonUI();
}

function createInputField(input, idx) {
    const key = String(input.key || `param_${idx}`);
    const type = inferInputType(input.type || input.fieldType);
    const labelText = input.label || input.name || key;

    if (type === "image") {
        const container = document.createElement("div");
        container.style.marginBottom = "12px";
        container.className = "full-width";

        const labelEl = document.createElement("div");
        labelEl.className = "dynamic-input-label";
        labelEl.innerHTML = `${escapeHtml(labelText)} ${input.required ? '<span style="color:#ff6b6b">*</span>' : ""}`;

        const wrapper = document.createElement("div");
        wrapper.className = "image-input-wrapper";
        wrapper.innerHTML = `
            <img class="image-preview" />
            <div class="image-input-overlay-content">
                <div class="image-input-icon">📷</div>
                <div class="image-input-text">点击从 PS 获取</div>
            </div>
        `;

        wrapper.addEventListener("click", async () => {
            const statusText = wrapper.querySelector(".image-input-text");
            const previewImg = wrapper.querySelector(".image-preview");
            if (!statusText || !previewImg) return;

            statusText.textContent = "获取中...";
            try {
                const capture = await ps.captureSelection({ log });
                if (!capture || !capture.arrayBuffer) {
                    statusText.textContent = "获取失败";
                    return;
                }

                revokePreviewUrl(state.inputValues[key]);
                const previewUrl = createPreviewUrlFromBuffer(capture.arrayBuffer);
                state.inputValues[key] = { arrayBuffer: capture.arrayBuffer, previewUrl };
                if (capture.selectionBounds) {
                    state.imageBounds[key] = capture.selectionBounds;
                }

                previewImg.src = previewUrl;
                previewImg.classList.add("has-image");
                statusText.textContent = "已捕获，点击重新获取";
            } catch (e) {
                console.error(e);
                statusText.textContent = "获取失败";
            }
        });

        container.appendChild(labelEl);
        container.appendChild(wrapper);
        return container;
    }

    const wrapper = document.createElement("div");
    wrapper.className = "dynamic-input-field";

    const headerRow = document.createElement("div");
    headerRow.className = "input-label-row";

    const labelEl = document.createElement("span");
    labelEl.className = "dynamic-input-label";
    labelEl.innerHTML = escapeHtml(labelText);
    headerRow.appendChild(labelEl);

    const promptLike = isPromptLikeInput(input) || (type === "text" && (key.toLowerCase().includes("prompt") || String(labelText).includes("提示")));
    let inputEl;

    if (type === "select") {
        inputEl = document.createElement("select");
        (input.options || []).forEach((opt) => {
            const option = document.createElement("option");
            option.value = opt;
            option.textContent = opt;
            inputEl.appendChild(option);
        });

        const defaultValue = input.default || (Array.isArray(input.options) ? input.options[0] : "");
        if (!isEmptyValue(defaultValue)) {
            inputEl.value = defaultValue;
            state.inputValues[key] = defaultValue;
        }
        inputEl.addEventListener("change", (event) => {
            state.inputValues[key] = event.target.value;
        });
    } else if (type === "boolean") {
        inputEl = document.createElement("select");
        inputEl.innerHTML = `<option value="true">是 (True)</option><option value="false">否 (False)</option>`;
        inputEl.value = String(input.default) === "true" ? "true" : "false";
        state.inputValues[key] = inputEl.value === "true";
        inputEl.addEventListener("change", (event) => {
            state.inputValues[key] = event.target.value === "true";
        });
    } else {
        const isLongText = promptLike || (type === "text" && !input.options);
        if (isLongText) {
            inputEl = document.createElement("textarea");
            inputEl.rows = promptLike ? 3 : 1;
            inputEl.placeholder = promptLike ? "输入提示词或选择模板..." : String(input.default || "");
            wrapper.classList.add("full-width");

            if (promptLike) {
                const btnTemplate = document.createElement("button");
                btnTemplate.className = "template-btn";
                btnTemplate.type = "button";
                btnTemplate.textContent = "预设";
                btnTemplate.addEventListener("click", () => {
                    openTemplatePicker((content) => {
                        inputEl.value = content;
                        state.inputValues[key] = content;
                        inputEl.style.borderColor = "#4caf50";
                        setTimeout(() => {
                            inputEl.style.borderColor = "";
                        }, 300);
                    });
                });
                headerRow.appendChild(btnTemplate);
            }
        } else {
            inputEl = document.createElement("input");
            inputEl.type = type === "number" ? "number" : "text";
            inputEl.placeholder = String(input.default || "");
        }

        inputEl.value = String(input.default || "");
        state.inputValues[key] = inputEl.value;
        inputEl.addEventListener("input", (event) => {
            state.inputValues[key] = event.target.value;
        });
    }

    wrapper.appendChild(headerRow);
    wrapper.appendChild(inputEl);
    return wrapper;
}

function resolveTargetBounds() {
    if (!state.currentApp) return null;
    const inputs = Array.isArray(state.currentApp.inputs) ? state.currentApp.inputs : [];

    for (const input of inputs) {
        if (inferInputType(input.type || input.fieldType) !== "image") continue;
        const key = String(input.key || "").trim();
        if (!key) continue;
        if (isEmptyValue(state.inputValues[key])) continue;
        if (state.imageBounds[key]) return state.imageBounds[key];
    }

    return null;
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
    } catch (e) {
        if (e && (e.name === "AbortError" || String(e.message || "").includes("中止"))) {
            log("任务已中止", "warn");
        } else {
            console.error(e);
            log(`运行失败: ${e.message}`, "error");
            alert(`运行失败: ${e.message}`);
        }
    } finally {
        setRunState(false);
    }
}

function renderAppPickerList() {
    if (!dom.appPickerList) return;

    const apps = getApps();
    const keyword = String(state.appPickerKeyword || "").trim().toLowerCase();
    const visibleApps = keyword
        ? apps.filter((app) => String(app.name || "").toLowerCase().includes(keyword))
        : apps;

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

    dom.appPickerList.innerHTML = visibleApps.map((app) => {
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
    }).join("");
}

function closeAppPickerModal() {
    if (dom.appPickerModal) {
        dom.appPickerModal.classList.remove("active");
    }
}

function openAppPickerModal() {
    state.appPickerKeyword = "";
    if (dom.appPickerSearchInput) {
        dom.appPickerSearchInput.value = "";
    }
    renderAppPickerList();
    if (dom.appPickerModal) {
        dom.appPickerModal.classList.add("active");
    }
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
    } catch (e) {
        console.error(e);
        if (!quiet) alert(`加载应用失败: ${e.message}`);
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

    dom.templateList.innerHTML = templates.map((template) => `
        <button type="button" class="app-picker-item" data-template-id="${encodeDataId(template.id)}">
            <div>
                <div style="font-weight:bold;font-size:12px">${escapeHtml(template.title)}</div>
                <div style="font-size:10px;color:#777; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:200px;">${escapeHtml(template.content)}</div>
            </div>
            <div style="font-size:12px;color:var(--accent-color)">选择</div>
        </button>
    `).join("");
}

function closeTemplatePicker() {
    if (dom.templateModal) {
        dom.templateModal.classList.remove("active");
    }
    state.templateSelectCallback = null;
}

function openTemplatePicker(onSelectCallback) {
    state.templateSelectCallback = typeof onSelectCallback === "function" ? onSelectCallback : null;
    renderTemplatePickerList();
    if (dom.templateModal) {
        dom.templateModal.classList.add("active");
    }
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

    if (state.templateSelectCallback) {
        state.templateSelectCallback(template.content);
    }

    closeTemplatePicker();
}

function onAppPickerSearchInput() {
    state.appPickerKeyword = String(dom.appPickerSearchInput.value || "");
    renderAppPickerList();
}

function onAppPickerModalClick(event) {
    if (event.target === dom.appPickerModal) {
        closeAppPickerModal();
    }
}

function onTemplateModalClick(event) {
    if (event.target === dom.templateModal) {
        closeTemplatePicker();
    }
}

function onRefreshWorkspaceClick() {
    syncWorkspaceApps({ forceRerender: false });
    updateAccountStatus();
    log("应用列表已刷新", "info");
}

function bindWorkspaceEvents() {
    if (dom.btnRun) {
        dom.btnRun.removeEventListener("click", handleRun);
        dom.btnRun.addEventListener("click", handleRun);
    }

    if (dom.btnOpenAppPicker) {
        dom.btnOpenAppPicker.removeEventListener("click", openAppPickerModal);
        dom.btnOpenAppPicker.addEventListener("click", openAppPickerModal);
    }

    if (dom.appPickerModalClose) {
        dom.appPickerModalClose.addEventListener("click", closeAppPickerModal);
    }

    if (dom.appPickerModal) {
        dom.appPickerModal.removeEventListener("click", onAppPickerModalClick);
        dom.appPickerModal.addEventListener("click", onAppPickerModalClick);
    }

    if (dom.appPickerList) {
        dom.appPickerList.removeEventListener("click", handleAppPickerListClick);
        dom.appPickerList.addEventListener("click", handleAppPickerListClick);
    }

    if (dom.appPickerSearchInput) {
        dom.appPickerSearchInput.removeEventListener("input", onAppPickerSearchInput);
        dom.appPickerSearchInput.addEventListener("input", onAppPickerSearchInput);
    }

    if (dom.btnRefreshWorkspaceApps) {
        dom.btnRefreshWorkspaceApps.removeEventListener("click", onRefreshWorkspaceClick);
        dom.btnRefreshWorkspaceApps.addEventListener("click", onRefreshWorkspaceClick);
    }

    if (dom.templateModalClose) {
        dom.templateModalClose.addEventListener("click", closeTemplatePicker);
    }

    if (dom.templateModal) {
        dom.templateModal.removeEventListener("click", onTemplateModalClick);
        dom.templateModal.addEventListener("click", onTemplateModalClick);
    }

    if (dom.templateList) {
        dom.templateList.removeEventListener("click", handleTemplateListClick);
        dom.templateList.addEventListener("click", handleTemplateListClick);
    }

    document.removeEventListener(APP_EVENTS.APPS_CHANGED, onAppsChanged);
    document.addEventListener(APP_EVENTS.APPS_CHANGED, onAppsChanged);

    document.removeEventListener(APP_EVENTS.TEMPLATES_CHANGED, onTemplatesChanged);
    document.addEventListener(APP_EVENTS.TEMPLATES_CHANGED, onTemplatesChanged);

    document.removeEventListener(APP_EVENTS.SETTINGS_CHANGED, onSettingsChanged);
    document.addEventListener(APP_EVENTS.SETTINGS_CHANGED, onSettingsChanged);
}

function onAppsChanged() {
    syncWorkspaceApps({ forceRerender: false });
}

function onTemplatesChanged() {
    if (dom.templateModal && dom.templateModal.classList.contains("active")) {
        renderTemplatePickerList();
    }
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
    bindWorkspaceEvents();

    updateAccountStatus();
    syncWorkspaceApps({ forceRerender: true });
    updateRunButtonUI();
}

module.exports = { initWorkspaceController };
