(function initWorkspaceModule(global) {
  const modules = (global.PixelRunnerModules = global.PixelRunnerModules || {});

  function setModalOpen(modalId, open) {
    const modal = modules.runtime.getById(modalId);
    if (!modal) return;
    modal.classList.toggle("is-open", open);
    document.body.classList.toggle("modal-open", open);
  }

  function isImageInput(input) {
    const type = String((input && input.type) || "").trim().toLowerCase();
    return type === "image" || type === "file";
  }

  function isPromptField(input) {
    return modules.state.isPromptLikeInput(input) && !isImageInput(input);
  }

  function hasImageAsset(asset) {
    return Boolean(
      asset &&
        typeof asset === "object" &&
        (((asset.dataUrl || "").trim() || (asset.base64 || "").trim() || (asset.url || "").trim()))
    );
  }

  function findImageInputs(app) {
    return (Array.isArray(app && app.inputs) ? app.inputs : []).filter(isImageInput);
  }

  function getResultDefaultLayerName() {
    const state = modules.state.state;
    const appName = String((state.lastResult && state.lastResult.appName) || (state.currentApp && state.currentApp.name) || "Result").trim();
    return `PixelRunner - ${appName}`;
  }

  function formatSelectionLabel(selectionBounds) {
    if (!selectionBounds) return "整张文档";
    const width = Math.max(0, Number(selectionBounds.right) - Number(selectionBounds.left));
    const height = Math.max(0, Number(selectionBounds.bottom) - Number(selectionBounds.top));
    return `${Math.round(width)}x${Math.round(height)}`;
  }

  function formatDocumentLabel(docInfo) {
    if (!docInfo || !docInfo.hasActiveDocument) return "无活动文档";
    const title = String(docInfo.title || "Untitled");
    const documentId = Number(docInfo.documentId) || 0;
    const sizeText =
      Number.isFinite(Number(docInfo.width)) && Number.isFinite(Number(docInfo.height))
        ? ` ${Math.round(Number(docInfo.width))}x${Math.round(Number(docInfo.height))}`
        : "";
    return `${title} (#${documentId})${sizeText}`;
  }

  function getImageCaptureSettings() {
    const state = modules.state.state;
    const maxDimensionInput = modules.runtime.getById("imageCaptureMaxDimension");
    const qualityInput = modules.runtime.getById("imageCaptureQuality");
    if (maxDimensionInput) {
      state.imageCapture.maxDimension = Math.max(256, Math.min(4096, Math.floor(Number(maxDimensionInput.value) || 1536)));
    }
    if (qualityInput) {
      state.imageCapture.quality = Math.max(20, Math.min(100, Math.floor(Number(qualityInput.value) || 82)));
    }
    return {
      maxDimension: state.imageCapture.maxDimension,
      quality: state.imageCapture.quality
    };
  }

  function syncImageCaptureControls() {
    const state = modules.state.state;
    const maxDimensionInput = modules.runtime.getById("imageCaptureMaxDimension");
    const qualityInput = modules.runtime.getById("imageCaptureQuality");
    if (maxDimensionInput) maxDimensionInput.value = String(state.imageCapture.maxDimension || 1536);
    if (qualityInput) qualityInput.value = String(state.imageCapture.quality || 82);
  }

  function cloneCaptureAsset(asset) {
    if (!hasImageAsset(asset)) return null;
    return {
      assetId: String(asset.assetId || ""),
      capturedAt: Number(asset.capturedAt) || 0,
      kind: String(asset.kind || "captured-document-image"),
      source: String(asset.source || "photoshop-document"),
      documentId: Number(asset.documentId) || null,
      document: asset.document && typeof asset.document === "object" ? { ...asset.document } : null,
      width: Number(asset.width) || null,
      height: Number(asset.height) || null,
      originalWidth: Number(asset.originalWidth) || null,
      originalHeight: Number(asset.originalHeight) || null,
      quality: Number(asset.quality) || null,
      maxDimension: Number(asset.maxDimension) || null,
      mimeType: String(asset.mimeType || "image/jpeg"),
      dataUrl: String(asset.dataUrl || ""),
      base64: String(asset.base64 || ""),
      url: String(asset.url || "")
    };
  }

  function createCaptureAssetId() {
    return `capture-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function getCaptureAssets() {
    return Array.isArray(modules.state.state.imageCapture.assets)
      ? modules.state.state.imageCapture.assets.filter(hasImageAsset)
      : [];
  }

  function getSelectedCaptureAsset() {
    const state = modules.state.state;
    const assets = getCaptureAssets();
    const selected =
      assets.find((asset) => String(asset.assetId || "") === String(state.imageCapture.selectedAssetId || "")) ||
      assets[0] ||
      null;
    state.imageCapture.asset = selected || null;
    state.imageCapture.selectedAssetId = selected ? String(selected.assetId || "") : "";
    return selected;
  }

  function setSelectedCaptureAsset(assetId) {
    const state = modules.state.state;
    const assets = getCaptureAssets();
    const selected =
      assets.find((asset) => String(asset.assetId || "") === String(assetId || "")) ||
      assets[0] ||
      null;
    state.imageCapture.selectedAssetId = selected ? String(selected.assetId || "") : "";
    state.imageCapture.asset = selected || null;
    return selected;
  }

  function pushCapturedAsset(asset) {
    const state = modules.state.state;
    const nextAsset = cloneCaptureAsset({
      ...asset,
      assetId: asset && asset.assetId ? asset.assetId : createCaptureAssetId(),
      capturedAt: Number(asset && asset.capturedAt) > 0 ? Number(asset.capturedAt) : Date.now()
    });
    if (!nextAsset) return null;
    state.imageCapture.assets = [
      nextAsset,
      ...getCaptureAssets().filter((item) => String(item.assetId || "") !== String(nextAsset.assetId || ""))
    ].slice(0, 12);
    state.imageCapture.selectedAssetId = String(nextAsset.assetId || "");
    state.imageCapture.asset = nextAsset;
    return nextAsset;
  }

  function removeCapturedAsset(assetId) {
    const state = modules.state.state;
    const targetId = String(assetId || "").trim();
    if (!targetId) return;
    state.imageCapture.assets = getCaptureAssets().filter((asset) => String(asset.assetId || "") !== targetId);
    Object.keys(state.formValues).forEach((key) => {
      const value = state.formValues[key];
      if (value && typeof value === "object" && String(value.assetId || "") === targetId) state.formValues[key] = null;
    });
    setSelectedCaptureAsset(state.imageCapture.selectedAssetId === targetId ? "" : state.imageCapture.selectedAssetId);
  }

  function clearAllCapturedAssets() {
    const state = modules.state.state;
    state.imageCapture.assets = [];
    state.imageCapture.selectedAssetId = "";
    state.imageCapture.asset = null;
    Object.keys(state.formValues).forEach((key) => {
      if (hasImageAsset(state.formValues[key])) state.formValues[key] = null;
    });
  }

  function getImageTransferModeLabel(input) {
    if (!input || typeof input !== "object") return "dataUrl";
    if (input.passObject === true) return "object";
    const marker = String(input.imageValueMode || input.valueMode || input.transferMode || input.transport || "")
      .trim()
      .toLowerCase();
    if (marker === "base64") return "base64";
    if (marker === "url") return "url";
    if (marker === "object" || marker === "json") return "object";
    return "dataUrl";
  }

  function assignCaptureToInput(key, assetId = "") {
    const selectedAsset = assetId
      ? getCaptureAssets().find((item) => String(item.assetId || "") === String(assetId))
      : getSelectedCaptureAsset();
    const asset = cloneCaptureAsset(selectedAsset);
    if (!asset) throw new Error("请先捕获一张 Photoshop 图像");
    modules.state.state.formValues[key] = asset;
    renderWorkspace();
  }

  function clearImageInputValue(key) {
    modules.state.state.formValues[key] = null;
    renderWorkspace();
  }

  async function captureAndAssignToInput(key) {
    const asset = await captureCurrentDocumentImage();
    modules.state.state.formValues[key] = cloneCaptureAsset(asset);
    renderWorkspace();
    return asset;
  }

  function renderCaptureSummary(asset) {
    if (!hasImageAsset(asset)) {
      return '<div class="empty-panel"><h4>图像输入区</h4><p>点击“捕获当前文档”后，这里会显示预览，并可把捕获结果绑定到下方图像字段。</p></div>';
    }
    const documentText = asset.document ? formatDocumentLabel(asset.document) : `文档 #${asset.documentId || "-"}`;
    const capturedText = asset.capturedAt ? new Date(asset.capturedAt).toLocaleTimeString() : "-";
    return `
      <div class="image-capture-shell">
        <div class="image-preview-frame"><img src="${modules.runtime.escapeHtml(asset.dataUrl)}" alt="Photoshop 捕获预览" /></div>
        <div class="image-meta-grid">
          <span class="image-meta-pill">${modules.runtime.escapeHtml(documentText)}</span>
          <span class="image-meta-pill">${modules.runtime.escapeHtml(String(asset.width || "-"))}x${modules.runtime.escapeHtml(String(asset.height || "-"))}</span>
          <span class="image-meta-pill">JPEG ${modules.runtime.escapeHtml(String(asset.quality || "-"))}</span>
          <span class="image-meta-pill">最大边长 ${modules.runtime.escapeHtml(String(asset.maxDimension || "-"))}</span>
          <span class="image-meta-pill">来源 #${modules.runtime.escapeHtml(String(asset.assetId || "").slice(-6) || "-")}</span>
          <span class="image-meta-pill">${modules.runtime.escapeHtml(capturedText)}</span>
        </div>
      </div>
    `;
  }

  function renderCaptureLibrary(assets, selectedAssetId) {
    if (!Array.isArray(assets) || assets.length === 0) return "";
    return `
      <div class="image-capture-shell">
        <div class="card-head">
          <div>
            <h4>已捕获图像</h4>
            <p>可切换当前选中图像，再分别绑定到不同图像字段。</p>
          </div>
          <div class="inline-actions">
            <button id="btnClearAllCapturedImages" class="mini-btn" type="button">清空全部</button>
          </div>
        </div>
        <div class="tool-list">
          ${assets
            .map((asset) => {
              const documentText = asset.document ? formatDocumentLabel(asset.document) : `文档 #${asset.documentId || "-"}`;
              const isSelected = String(asset.assetId || "") === String(selectedAssetId || "");
              return `
                <article class="tool-item">
                  <div>
                    <h4>${modules.runtime.escapeHtml(documentText)}</h4>
                    <p>${modules.runtime.escapeHtml(`${asset.width || "-"}x${asset.height || "-"} / ${asset.mimeType || "image/jpeg"} / #${String(asset.assetId || "").slice(-6)}`)}</p>
                  </div>
                  <div class="inline-actions">
                    <button class="mini-btn" type="button" data-action="select-captured-image" data-capture-id="${modules.runtime.escapeHtml(String(asset.assetId || ""))}" ${isSelected ? "disabled" : ""}>${isSelected ? "当前选中" : "选中"}</button>
                    <button class="mini-btn" type="button" data-action="remove-captured-image" data-capture-id="${modules.runtime.escapeHtml(String(asset.assetId || ""))}">移除</button>
                  </div>
                </article>
              `;
            })
            .join("")}
        </div>
      </div>
    `;
  }

  function renderImageInputArea() {
    const runtime = modules.runtime;
    const state = modules.state.state;
    const imageInputContainer = runtime.getById("imageInputContainer");
    if (!imageInputContainer) return;

    const imageInputs = findImageInputs(state.currentApp);
    imageInputContainer.hidden = false;
    if (!state.currentApp) {
      imageInputContainer.innerHTML =
        '<div class="empty-panel"><h4>图像</h4><p>图像字段会在这里显示。</p></div>';
      return;
    }

    if (imageInputs.length === 0) {
      imageInputContainer.innerHTML = "";
      imageInputContainer.hidden = true;
      return;
    }

    imageInputContainer.innerHTML = "";
    imageInputContainer.hidden = true;
  }

  function renderImageField(input) {
    const runtime = modules.runtime;
    const state = modules.state.state;
    const key = String(input.key || "").trim();
    const label = runtime.escapeHtml(input.label || input.name || key);
    const requiredMark = input.required ? '<span class="field-required">*</span>' : "";
    const asset = state.formValues[key];
    const hasAssignedAsset = hasImageAsset(asset);
    const captureLabel = hasAssignedAsset ? "重新捕获" : "点击从 PS 选区捕获";
    const captureSource = hasAssignedAsset ? (asset.capturedFromSelection ? "已从 PS 选区捕获" : "已从当前文档捕获") : "";

    return `
      <div class="field dynamic-field">
        <span class="field-label">${label}${requiredMark}</span>
        <div class="input-zone">
          <div class="image-binding-card image-capture-field-card" data-action="capture-field-image" data-form-key="${runtime.escapeHtml(key)}">
            <div class="image-capture-field-head">
              <span class="image-capture-field-title">${label}</span>
              <button class="mini-btn image-capture-clear-btn" type="button" data-action="clear-captured-image" data-form-key="${runtime.escapeHtml(key)}" ${hasAssignedAsset ? "" : "disabled"}>清空</button>
            </div>
            ${
              hasAssignedAsset
                ? `<div class="image-preview-frame image-capture-stage"><img src="${runtime.escapeHtml(asset.dataUrl)}" alt="${label}" /></div>`
                : `
                  <div class="image-capture-stage image-capture-stage-empty">
                    <div class="image-capture-stage-icon">↑</div>
                    <div class="image-capture-stage-text">点击从 PS 选区捕获</div>
                  </div>
                `
            }
            ${captureSource ? `<div class="image-capture-stage-note">${runtime.escapeHtml(captureSource)}</div>` : ""}
            <div class="inline-actions image-capture-field-actions">
              <button class="mini-btn" type="button" data-action="capture-field-image" data-form-key="${runtime.escapeHtml(key)}">${captureLabel}</button>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  function renderPromptHint(value) {
    const text = String(value || "");
    const length = modules.templates.getTextLength(text);
    const tail = modules.templates.getTailPreview(text, 24);
    return `<div class="prompt-length-hint ${length >= modules.templates.PROMPT_WARN_CHARS ? "is-warning" : ""}">长度 ${modules.runtime.escapeHtml(String(length))} 字符 | 末尾预览 ${modules.runtime.escapeHtml(tail)}</div>`;
  }

  function renderAppMeta(app) {
    const runtime = modules.runtime;
    if (!app) return '<div class="workspace-app-placeholder">请先点击右侧切换应用</div>';
    return `<div class="workspace-app-summary"><div class="workspace-app-name">${runtime.escapeHtml(modules.state.getAppDisplayName(app))}</div></div>`;
  }

  function updateRunButtonState() {
    const state = modules.state.state;
    const runButton = modules.runtime.getById("btnRun");
    const cancelButton = modules.runtime.getById("btnCancelJob");
    const taskStatusSummary = modules.runtime.getById("taskStatusSummary");
    const runningTaskList = modules.runtime.getById("runningTaskList");
    const statusChip = modules.runtime.getById("workspaceInputStatusChip");
    const hasCurrentApp = !!state.currentApp;
    const runningTasks = Array.isArray(state.runningTasks) ? state.runningTasks.filter((item) => item && item.taskId) : [];
    const hasRunningTask = runningTasks.length > 0;

    if (runButton) {
      runButton.disabled = !hasCurrentApp;
      runButton.textContent = hasRunningTask
        ? `继续运行（当前 ${runningTasks.length} 个任务）`
        : hasCurrentApp
          ? `运行新任务：${modules.state.getAppDisplayName(state.currentApp)}`
          : "开始运行";
    }

    if (cancelButton) {
      cancelButton.disabled = !hasRunningTask;
      cancelButton.textContent = hasRunningTask ? "取消最近任务" : "取消最近任务";
    }

    if (taskStatusSummary) {
      taskStatusSummary.textContent = hasRunningTask
        ? `当前共有 ${runningTasks.length} 个任务进行中，可在下方逐个取消。`
        : hasCurrentApp
          ? `已准备好运行 ${modules.state.getAppDisplayName(state.currentApp)}，可直接提交任务。`
          : "后台任务：暂时空闲，请先选择一个应用。";
    }

    if (statusChip) {
      statusChip.textContent = hasRunningTask
        ? `运行中 ${runningTasks.length}`
        : hasCurrentApp
          ? `已加载 ${modules.state.getAppInputCount(state.currentApp)} 个输入项`
          : "等待选择应用";
    }

    if (runningTaskList) {
      runningTaskList.innerHTML = hasRunningTask
        ? runningTasks
            .map(
              (task) => `
                <div class="running-task-item">
                  <div class="running-task-main">
                    <div class="running-task-title">${modules.runtime.escapeHtml(task.appName || "未命名任务")}</div>
                    <div class="running-task-meta">Task ID: ${modules.runtime.escapeHtml(task.taskId)} | 状态：${modules.runtime.escapeHtml(task.status || "running")}</div>
                  </div>
                  <button class="mini-btn" type="button" data-action="cancel-running-task" data-task-id="${modules.runtime.escapeHtml(task.taskId)}">取消</button>
                </div>
              `
            )
            .join("")
        : '<div class="running-task-empty">当前没有进行中的任务。</div>';
    }
  }
  function renderField(input) {
    const runtime = modules.runtime;
    const state = modules.state.state;
    const key = String(input.key || "").trim();
    const label = runtime.escapeHtml(input.label || input.name || key);
    const requiredMark = input.required ? '<span class="field-required">*</span>' : "";
    const value = state.formValues[key];
    const escapedKey = runtime.escapeHtml(key);

    if (isImageInput(input)) return renderImageField(input);

    if (input.type === "textarea" || input.type === "multiline" || isPromptField(input)) {
      const currentValue = String(value ?? "");
      return `
        <label class="field dynamic-field ${isPromptField(input) ? "prompt-field" : ""}">
          <span class="field-label">
            <span>${label}${requiredMark}</span>
            ${isPromptField(input) ? `<button class="mini-btn template-trigger-btn" type="button" data-action="open-template-picker" data-form-key="${escapedKey}">预设</button>` : ""}
          </span>
          <textarea class="field-input field-textarea" rows="4" data-form-key="${escapedKey}">${runtime.escapeHtml(currentValue)}</textarea>
          ${isPromptField(input) ? renderPromptHint(currentValue) : ""}
        </label>
      `;
    }

    if (input.type === "number" || input.type === "int" || input.type === "float") {
      return `<label class="field dynamic-field"><span class="field-label">${label}${requiredMark}</span><input class="field-input" type="number" data-form-key="${escapedKey}" value="${runtime.escapeHtml(String(value ?? ""))}" /></label>`;
    }

    if (input.type === "boolean" || input.type === "switch" || input.type === "checkbox") {
      return `<label class="field toggle-field"><span class="field-label">${label}${requiredMark}</span><label class="checkbox-line"><input type="checkbox" data-form-key="${escapedKey}" ${value ? "checked" : ""} /><span>启用</span></label></label>`;
    }

    if (input.type === "select" || input.type === "enum") {
      const options = Array.isArray(input.options) ? input.options : [];
      return `<label class="field dynamic-field"><span class="field-label">${label}${requiredMark}</span><select class="field-input" data-form-key="${escapedKey}"><option value="">请选择</option>${options
        .map((option) => {
          const optValue = typeof option === "object" ? option.value : option;
          const optLabel = typeof option === "object" ? option.label : option;
          return `<option value="${runtime.escapeHtml(String(optValue ?? ""))}" ${String(value ?? "") === String(optValue ?? "") ? "selected" : ""}>${runtime.escapeHtml(String(optLabel ?? optValue ?? ""))}</option>`;
        })
        .join("")}</select></label>`;
    }

    return `<label class="field dynamic-field"><span class="field-label">${label}${requiredMark}</span><input class="field-input" type="text" data-form-key="${escapedKey}" value="${runtime.escapeHtml(String(value ?? ""))}" /></label>`;
  }

  function renderWorkspace() {
    const runtime = modules.runtime;
    const state = modules.state.state;
    const appPickerMeta = runtime.getById("appPickerMeta");
    const dynamicInputContainer = runtime.getById("dynamicInputContainer");

    if (appPickerMeta) {
      appPickerMeta.innerHTML = renderAppMeta(state.currentApp);
    }

    renderImageInputArea();

    if (dynamicInputContainer) {
      if (!state.currentApp) {
        dynamicInputContainer.innerHTML =
          '<div class="empty-panel"><h4>动态表单区</h4><p>请先选择一个已保存应用，后续这里会根据输入结构动态渲染表单。</p></div>';
      } else if (!Array.isArray(state.currentApp.inputs) || state.currentApp.inputs.length === 0) {
        dynamicInputContainer.innerHTML = `<div class="empty-panel"><h4>${runtime.escapeHtml(modules.state.getAppDisplayName(state.currentApp))}</h4><p>当前应用还没有输入结构。你可以先去设置页编辑应用，手动补齐输入 JSON。</p></div>`;
      } else {
        dynamicInputContainer.innerHTML = `<div class="dynamic-form">${state.currentApp.inputs.map(renderField).join("")}</div>`;
      }
    }

    updateRunButtonState();
  }

  function collectFormValuesFromDom() {
    const state = modules.state.state;
    const container = modules.runtime.getById("dynamicInputContainer");
    if (!container) return;
    container.querySelectorAll("[data-form-key]").forEach((element) => {
      const key = element.getAttribute("data-form-key");
      if (!key) return;
      if (element.matches('input[type="checkbox"]')) {
        state.formValues[key] = Boolean(element.checked);
        return;
      }
      const inputMeta = (state.currentApp?.inputs || []).find((item) => String(item.key || "") === key);
      if (inputMeta && isImageInput(inputMeta)) return;
      if (element.matches("input, textarea, select")) state.formValues[key] = element.value;
    });
  }

  function buildRunPayload() {
    const state = modules.state.state;
    collectFormValuesFromDom();
    const payload = {
      appId: state.currentApp ? state.currentApp.appId : "",
      appName: state.currentApp ? state.currentApp.name : "",
      app: state.currentApp
        ? {
            id: state.currentApp.id,
            appId: state.currentApp.appId,
            name: state.currentApp.name,
            inputs: Array.isArray(state.currentApp.inputs) ? state.currentApp.inputs : []
          }
        : null,
      apiKey: state.settings.apiKey || "",
      inputs: { ...state.formValues },
      settings: { pollInterval: state.settings.pollInterval, timeout: state.settings.timeout }
    };
    state.lastRunPayload = payload;
    return payload;
  }

  function syncPrimaryRunningTask() {
    const tasks = Array.isArray(modules.state.state.runningTasks) ? modules.state.state.runningTasks : [];
    const firstTask = tasks[0] || null;
    modules.state.state.runningTask = firstTask
      ? { taskId: String(firstTask.taskId || ""), appName: String(firstTask.appName || ""), status: String(firstTask.status || "running") }
      : { taskId: "", appName: "", status: "idle" };
  }

  function upsertRunningTask(taskId, appName, status = "running") {
    const state = modules.state.state;
    const normalizedTaskId = String(taskId || "").trim();
    if (!normalizedTaskId) return;
    const nextTask = {
      taskId: normalizedTaskId,
      appName: String(appName || "").trim(),
      status: String(status || "running").trim() || "running"
    };
    const list = Array.isArray(state.runningTasks) ? state.runningTasks.slice() : [];
    const index = list.findIndex((item) => String(item.taskId || "") === normalizedTaskId);
    if (index >= 0) list[index] = { ...list[index], ...nextTask };
    else list.unshift(nextTask);
    state.runningTasks = list;
    syncPrimaryRunningTask();
    updateRunButtonState();
  }

  function removeRunningTask(taskId = "") {
    const state = modules.state.state;
    const normalizedTaskId = String(taskId || "").trim();
    state.runningTasks = (Array.isArray(state.runningTasks) ? state.runningTasks : []).filter(
      (item) => String(item.taskId || "") !== normalizedTaskId
    );
    syncPrimaryRunningTask();
    updateRunButtonState();
  }

  function clearRunningTask() {
    modules.state.state.runningTasks = [];
    syncPrimaryRunningTask();
    updateRunButtonState();
  }

  function clearLastResult() {
    modules.state.state.lastResult = { appName: "", sourceDocument: null, outputUrl: "", taskId: "", placedAt: 0 };
    updateRunButtonState();
  }

  function setLastResult(payload) {
    const data = payload && typeof payload === "object" ? payload : {};
    modules.state.state.lastResult = {
      appName: String(data.appName || "").trim(),
      sourceDocument: data.sourceDocument && typeof data.sourceDocument === "object" ? data.sourceDocument : null,
      outputUrl: String(data.outputUrl || "").trim(),
      taskId: String(data.taskId || "").trim(),
      placedAt: Number(data.placedAt) > 0 ? Number(data.placedAt) : 0
    };
    updateRunButtonState();
  }

  async function refreshPhotoshopDocumentStatus(options = {}) {
    const state = modules.state.state;
    if (!modules.runtime.isPluginRuntime()) return null;
    try {
      const info = await modules.runtime.callHost("photoshop.getActiveDocumentInfo", []);
      state.currentDocumentInfo = info && typeof info === "object" ? info : null;
      if (!options.quiet && info && info.ok) modules.ui.logToWorkspace(`Photoshop 当前文档：${info.title} (#${info.documentId})`, "info");
      return state.currentDocumentInfo;
    } catch (_) {
      state.currentDocumentInfo = null;
      return null;
    }
  }

  async function captureSourceDocumentInfo() {
    if (!modules.runtime.isPluginRuntime()) return null;
    return refreshPhotoshopDocumentStatus({ quiet: true });
  }

  async function captureCurrentDocumentImage() {
    if (!modules.runtime.isPluginRuntime()) throw new Error("浏览器预览模式下无法捕获 Photoshop 图像");
    const settings = getImageCaptureSettings();
    const captured = await modules.runtime.callHost("photoshop.captureDocumentPreview", [settings], { timeoutMs: 30000 });
    const asset = pushCapturedAsset(captured);
    modules.ui.logToWorkspace(`已捕获 Photoshop 文档图像：${asset.width}x${asset.height}，JPEG ${asset.quality}`, "success");
    renderWorkspace();
    return asset;
  }

  function clearCapturedImage() {
    const selectedAsset = getSelectedCaptureAsset();
    if (!selectedAsset) return;
    removeCapturedAsset(selectedAsset.assetId);
    renderWorkspace();
  }

  function isMissingRequiredValue(value) {
    if (typeof value === "boolean") return false;
    if (hasImageAsset(value)) return false;
    if (value && typeof value === "object") return true;
    return String(value ?? "").trim() === "";
  }

  function validateRunPayload() {
    const state = modules.state.state;
    const app = state.currentApp;
    if (!app) throw new Error("请先选择一个应用");
    collectFormValuesFromDom();
    const missing = (Array.isArray(app.inputs) ? app.inputs : [])
      .filter((input) => input.required)
      .filter((input) => isMissingRequiredValue(state.formValues[input.key]));
    if (missing.length > 0) throw new Error(`请先填写必填项：${missing.map((item) => item.label || item.key).join("、")}`);
  }

  function buildAutoPlacementPayload(result) {
    const sourceDocument = result && result.sourceDocument && typeof result.sourceDocument === "object" ? result.sourceDocument : null;
    return {
      url: result && result.outputUrl ? result.outputUrl : "",
      taskId: result && result.taskId ? result.taskId : "",
      targetDocumentId: sourceDocument && sourceDocument.hasActiveDocument ? sourceDocument.documentId : null,
      targetBounds: sourceDocument && sourceDocument.selectionBounds ? sourceDocument.selectionBounds : null,
      applyMask: Boolean(sourceDocument && sourceDocument.selectionBounds),
      fitMode: "contain",
      layerName: getResultDefaultLayerName()
    };
  }

  async function autoPlaceLastResult() {
    const result = modules.state.state.lastResult;
    if (!result || !result.outputUrl) throw new Error("当前没有可自动贴回 Photoshop 的结果");
    if (!modules.runtime.isPluginRuntime()) {
      modules.ui.logToWorkspace(`浏览器预览模式不会自动贴回结果，输出地址：${result.outputUrl}`, "info");
      return null;
    }
    await refreshPhotoshopDocumentStatus({ quiet: true });
    const placementPayload = buildAutoPlacementPayload(result);
    const response = await modules.runtime.callHost("photoshop.placeResultFromUrl", [placementPayload], { timeoutMs: 60000 });
    modules.state.state.lastResult.placedAt = Date.now();
    if (response && response.document) modules.state.state.currentDocumentInfo = response.document;
    const sourceDocument = result.sourceDocument;
    const placementSummary = sourceDocument && sourceDocument.selectionBounds
      ? `已按原选区 ${formatSelectionLabel(sourceDocument.selectionBounds)} 自动贴回`
      : "已自动贴回源文档";
    modules.ui.logToWorkspace(`${placementSummary}，文档 #${response.documentId}，图层：${response.layerName || placementPayload.layerName}`, "success");
    return response;
  }
  function bindWorkspaceActions() {
    const runButton = modules.runtime.getById("btnRun");
    const cancelButton = modules.runtime.getById("btnCancelJob");
    const dynamicInputContainer = modules.runtime.getById("dynamicInputContainer");
    const imageInputContainer = modules.runtime.getById("imageInputContainer");

    if (dynamicInputContainer) {
      dynamicInputContainer.addEventListener("input", (event) => {
        const element = event.target;
        if (!element || !element.matches("[data-form-key]")) return;
        const key = element.getAttribute("data-form-key");
        if (!key) return;
        if (element.matches('input[type="checkbox"]')) {
          modules.state.state.formValues[key] = Boolean(element.checked);
          return;
        }
        const inputMeta = (modules.state.state.currentApp?.inputs || []).find((item) => String(item.key || "") === key);
        if (!inputMeta || !isImageInput(inputMeta)) modules.state.state.formValues[key] = element.value;
      });

      dynamicInputContainer.addEventListener("change", (event) => {
        const element = event.target;
        if (!element || !element.matches("[data-form-key]")) return;
        const key = element.getAttribute("data-form-key");
        if (!key) return;
        if (element.matches('input[type="checkbox"]')) {
          modules.state.state.formValues[key] = Boolean(element.checked);
          return;
        }
        const inputMeta = (modules.state.state.currentApp?.inputs || []).find((item) => String(item.key || "") === key);
        if (!inputMeta || !isImageInput(inputMeta)) modules.state.state.formValues[key] = element.value;
      });

      dynamicInputContainer.addEventListener("click", (event) => {
        const actionTarget = event.target && event.target.closest("[data-action][data-form-key]");
        if (!actionTarget) return;
        const action = actionTarget.getAttribute("data-action");
        const key = actionTarget.getAttribute("data-form-key");
        if (!action || !key) return;

        if (action === "open-template-picker") {
          modules.templates.openTemplatePicker({ mode: "multiple", maxSelection: 5, targetKey: key });
          return;
        }

        if (action === "assign-captured-image") {
          try {
            assignCaptureToInput(key);
            modules.ui.logToWorkspace(`已将当前捕获图像绑定到字段：${key}`, "success");
          } catch (error) {
            modules.ui.logToWorkspace(error.message, "warn");
          }
          return;
        }

        if (action === "clear-captured-image") {
          clearImageInputValue(key);
          modules.ui.logToWorkspace(`已清除字段图像：${key}`, "info");
        }
      });
    }

    if (imageInputContainer) {
      imageInputContainer.addEventListener("input", () => {
        getImageCaptureSettings();
      });

      imageInputContainer.addEventListener("click", async (event) => {
        const captureButton = event.target && event.target.closest("#btnCaptureDocumentImage");
        const clearButton = event.target && event.target.closest("#btnClearCapturedImage");
        const clearAllButton = event.target && event.target.closest("#btnClearAllCapturedImages");
        const selectAssetButton = event.target && event.target.closest('[data-action="select-captured-image"][data-capture-id]');
        const removeAssetButton = event.target && event.target.closest('[data-action="remove-captured-image"][data-capture-id]');

        if (captureButton) {
          captureButton.disabled = true;
          try {
            await captureCurrentDocumentImage();
          } catch (error) {
            modules.ui.logToWorkspace(`图像捕获失败：${error.message}`, "error");
          } finally {
            captureButton.disabled = false;
          }
          return;
        }

        if (clearButton) {
          clearCapturedImage();
          modules.ui.logToWorkspace("已移除当前选中的捕获图像。", "info");
          return;
        }

        if (clearAllButton) {
          clearAllCapturedAssets();
          renderWorkspace();
          modules.ui.logToWorkspace("已清空全部捕获图像，并解除字段绑定。", "info");
          return;
        }

        if (selectAssetButton) {
          setSelectedCaptureAsset(selectAssetButton.getAttribute("data-capture-id"));
          renderWorkspace();
          modules.ui.logToWorkspace("已切换当前选中的捕获图像。", "info");
          return;
        }

        if (removeAssetButton) {
          removeCapturedAsset(removeAssetButton.getAttribute("data-capture-id"));
          renderWorkspace();
          modules.ui.logToWorkspace("已移除一张捕获图像。", "info");
        }
      });
    }

    if (runButton) {
      runButton.addEventListener("click", async () => {
        let submittedTaskId = "";
        let submittedAppName = "";
        try {
          validateRunPayload();
          clearLastResult();
          const payload = buildRunPayload();
          submittedAppName = payload.appName;
          const sourceDocument = await captureSourceDocumentInfo();
          const taskStatusSummary = modules.runtime.getById("taskStatusSummary");

          if (!modules.runtime.isPluginRuntime()) {
            if (taskStatusSummary) taskStatusSummary.textContent = `浏览器预览模式已生成 ${payload.appName} 的任务负载。`;
            modules.ui.logToWorkspace(`浏览器预览模式已生成任务负载：${JSON.stringify(payload)}`, "info");
            return;
          }

          if (!payload.apiKey) throw new Error("请先在设置页保存 RunningHub API Key");
          if (taskStatusSummary) taskStatusSummary.textContent = `正在提交任务：${payload.appName}`;

          const submitResult = await modules.runtime.callHost("runninghub.submitTask", [payload], {
            timeoutMs: Math.max(10000, Number(payload.settings.timeout || 180) * 1000 + 5000)
          });

          modules.ui.logToWorkspace(`任务已提交：${submitResult.taskId}`, "success");
          submittedTaskId = String(submitResult.taskId || "");
          upsertRunningTask(submitResult.taskId, payload.appName, "submitted");
          if (taskStatusSummary) taskStatusSummary.textContent = `正在轮询任务结果：${submitResult.taskId}`;

          const pollResult = await modules.runtime.callHost(
            "runninghub.pollTask",
            [{ apiKey: payload.apiKey, taskId: submitResult.taskId, settings: payload.settings }],
            { timeoutMs: Math.max(15000, Number(payload.settings.timeout || 180) * 1000 + 15000) }
          );

          removeRunningTask(submitResult.taskId);
          setLastResult({
            appName: payload.appName,
            sourceDocument,
            outputUrl: pollResult.outputUrl,
            taskId: submitResult.taskId
          });
          modules.ui.logToWorkspace(`任务已完成，结果地址：${pollResult.outputUrl}`, "success");

          const placementResponse = await autoPlaceLastResult();
          if (taskStatusSummary) {
            const placedDocumentId = placementResponse && placementResponse.documentId ? `#${placementResponse.documentId}` : "-";
            taskStatusSummary.textContent = `任务已完成并自动贴回 Photoshop：${payload.appName} -> ${placedDocumentId}`;
          }
        } catch (error) {
          if (submittedTaskId) removeRunningTask(submittedTaskId);
          modules.ui.logToWorkspace(error.message, "warn");
          const taskStatusSummary = modules.runtime.getById("taskStatusSummary");
          if (taskStatusSummary) taskStatusSummary.textContent = `任务失败：${submittedAppName || "当前任务"}，${error.message}`;
        }
      });
    }

    if (cancelButton) {
      cancelButton.addEventListener("click", async () => {
        const runningTasks = Array.isArray(modules.state.state.runningTasks) ? modules.state.state.runningTasks : [];
        const runningTask = runningTasks[0] || null;
        const apiKey = modules.state.state.settings.apiKey;
        if (!runningTask || !runningTask.taskId) {
          modules.ui.logToWorkspace("当前没有可取消的任务。", "info");
          return;
        }
        try {
          await modules.runtime.callHost("runninghub.cancelTask", [{ apiKey, taskId: runningTask.taskId }], { timeoutMs: 20000 });
          modules.ui.logToWorkspace(`任务已取消：${runningTask.taskId}`, "warn");
          removeRunningTask(runningTask.taskId);
          const taskStatusSummary = modules.runtime.getById("taskStatusSummary");
          if (taskStatusSummary) taskStatusSummary.textContent = `任务已取消：${runningTask.taskId}`;
        } catch (error) {
          modules.ui.logToWorkspace(`取消任务失败：${error.message}`, "error");
        }
      });
    }

    document.addEventListener("click", async (event) => {
      const target = event.target && event.target.closest('[data-action="cancel-running-task"][data-task-id], [data-action="capture-field-image"][data-form-key]');
      if (!target) return;

      const action = target.getAttribute("data-action");
      if (action === "capture-field-image") {
        const key = target.getAttribute("data-form-key");
        if (!key) return;
        const button = target.matches("button") ? target : target.querySelector('[data-action="capture-field-image"][data-form-key]');
        if (button) button.disabled = true;
        try {
          const asset = await captureAndAssignToInput(key);
          modules.ui.logToWorkspace(
            `已捕获并写入字段：${key} (${asset.capturedFromSelection ? "选区" : "文档"})`,
            "success"
          );
        } catch (error) {
          modules.ui.logToWorkspace(`图像捕获失败：${error.message}`, "error");
        } finally {
          if (button) button.disabled = false;
        }
        return;
      }

      if (action === "cancel-running-task") {
        const taskId = String(target.getAttribute("data-task-id") || "").trim();
        const apiKey = modules.state.state.settings.apiKey;
        if (!taskId) return;
        target.disabled = true;
        try {
          await modules.runtime.callHost("runninghub.cancelTask", [{ apiKey, taskId }], { timeoutMs: 20000 });
          removeRunningTask(taskId);
          modules.ui.logToWorkspace(`任务已取消：${taskId}`, "warn");
        } catch (error) {
          modules.ui.logToWorkspace(`取消任务失败：${error.message}`, "error");
        } finally {
          target.disabled = false;
        }
      }
    });
  }

  modules.workspace = {
    setModalOpen,
    updateRunButtonState,
    renderWorkspace,
    buildRunPayload,
    bindWorkspaceActions,
    refreshPhotoshopDocumentStatus
  };
})(window);
