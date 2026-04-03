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

  function hasImageAsset(asset) {
    return Boolean(
      asset &&
      typeof asset === "object" &&
      (
        (typeof asset.dataUrl === "string" && asset.dataUrl.trim()) ||
        (typeof asset.base64 === "string" && asset.base64.trim()) ||
        (typeof asset.url === "string" && asset.url.trim())
      )
    );
  }

  function findImageInputs(app) {
    return (Array.isArray(app && app.inputs) ? app.inputs : []).filter(isImageInput);
  }

  function getResultDefaultLayerName() {
    const state = modules.state.state;
    const appName = String(
      (state.lastResult && state.lastResult.appName) ||
      (state.currentApp && state.currentApp.name) ||
      "Result"
    ).trim();
    return `PixelRunner - ${appName}`;
  }

  function formatDocumentLabel(docInfo) {
    if (!docInfo || !docInfo.hasActiveDocument) {
      return "无活动文档";
    }

    const title = String(docInfo.title || "Untitled");
    const documentId = Number(docInfo.documentId) || 0;
    const sizeText =
      Number.isFinite(Number(docInfo.width)) && Number.isFinite(Number(docInfo.height))
        ? ` ${Math.round(Number(docInfo.width))}x${Math.round(Number(docInfo.height))}`
        : "";
    return `${title} (#${documentId})${sizeText}`;
  }

  function readPlacementOptionsFromDom() {
    const state = modules.state.state;
    const layerNameInput = modules.runtime.getById("placementLayerNameInput");
    const requireSameDocumentInput = modules.runtime.getById("placementRequireSameDocument");

    state.resultPlacement.layerName = String(layerNameInput?.value || "").trim();
    state.resultPlacement.requireSameDocument = Boolean(requireSameDocumentInput?.checked);
    return { ...state.resultPlacement };
  }

  function syncPlacementControls() {
    const state = modules.state.state;
    const layerNameInput = modules.runtime.getById("placementLayerNameInput");
    const requireSameDocumentInput = modules.runtime.getById("placementRequireSameDocument");

    if (layerNameInput) {
      layerNameInput.value = state.resultPlacement.layerName || "";
      layerNameInput.placeholder = getResultDefaultLayerName();
    }

    if (requireSameDocumentInput) {
      requireSameDocumentInput.checked = state.resultPlacement.requireSameDocument !== false;
    }
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
      kind: String(asset.kind || "captured-document-image"),
      source: String(asset.source || "photoshop-document"),
      documentId: Number(asset.documentId) || null,
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

  function assignCaptureToInput(key) {
    const state = modules.state.state;
    const asset = cloneCaptureAsset(state.imageCapture.asset);
    if (!asset) {
      throw new Error("请先捕获一张 Photoshop 图像");
    }

    state.formValues[key] = asset;
    renderWorkspace();
  }

  function clearImageInputValue(key) {
    modules.state.state.formValues[key] = null;
    renderWorkspace();
  }

  function renderCaptureSummary(asset) {
    if (!hasImageAsset(asset)) {
      return `
        <div class="empty-panel">
          <h4>图像输入区</h4>
          <p>点击“捕获当前文档”后，WebView 会显示预览，并可把捕获结果绑定到下方图像字段。</p>
        </div>
      `;
    }

    const documentText = asset.document ? formatDocumentLabel(asset.document) : `文档 #${asset.documentId || "-"}`;
    return `
      <div class="image-capture-shell">
        <div class="image-preview-frame">
          <img src="${modules.runtime.escapeHtml(asset.dataUrl)}" alt="Captured Photoshop document preview" />
        </div>
        <div class="image-meta-grid">
          <span class="image-meta-pill">${modules.runtime.escapeHtml(documentText)}</span>
          <span class="image-meta-pill">${modules.runtime.escapeHtml(String(asset.width || "-"))}x${modules.runtime.escapeHtml(String(asset.height || "-"))}</span>
          <span class="image-meta-pill">JPEG ${modules.runtime.escapeHtml(String(asset.quality || "-"))}</span>
          <span class="image-meta-pill">Max ${modules.runtime.escapeHtml(String(asset.maxDimension || "-"))}</span>
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
    if (!state.currentApp) {
      imageInputContainer.innerHTML = `
        <div class="empty-panel">
          <h4>图像输入区</h4>
          <p>等待应用选择后，再接入图像捕获和图像输入映射。</p>
        </div>
      `;
      return;
    }

    if (imageInputs.length === 0) {
      imageInputContainer.innerHTML = `
        <div class="empty-panel">
          <h4>图像输入区</h4>
          <p>当前应用没有图像字段，后续如果 schema 出现 image/file 输入，会在这里统一管理捕获与预处理。</p>
        </div>
      `;
      return;
    }

    imageInputContainer.innerHTML = `
      <div class="image-capture-shell">
        <div class="card-head">
          <div>
            <h4>Photoshop 图像捕获</h4>
            <p>宿主负责抓取当前文档，WebView 负责预览、压缩参数和字段绑定。</p>
          </div>
          <div class="inline-actions">
            <button id="btnCaptureDocumentImage" class="mini-btn" type="button">捕获当前文档</button>
            <button id="btnClearCapturedImage" class="mini-btn" type="button" ${hasImageAsset(state.imageCapture.asset) ? "" : "disabled"}>清除捕获</button>
          </div>
        </div>

        <div class="dual-grid">
          <label class="field">
            <span class="field-label">最大边长</span>
            <input id="imageCaptureMaxDimension" class="field-input" type="number" min="256" max="4096" step="128" />
          </label>
          <label class="field">
            <span class="field-label">JPEG 质量</span>
            <input id="imageCaptureQuality" class="field-input" type="number" min="20" max="100" step="1" />
          </label>
        </div>

        ${renderCaptureSummary(state.imageCapture.asset)}
      </div>
    `;

    syncImageCaptureControls();
  }

  function renderImageField(input) {
    const runtime = modules.runtime;
    const state = modules.state.state;
    const key = String(input.key || "").trim();
    const label = runtime.escapeHtml(input.label || input.name || key);
    const requiredMark = input.required ? '<span class="field-required">*</span>' : "";
    const asset = state.formValues[key];
    const hasAssignedAsset = hasImageAsset(asset);
    const captureReady = hasImageAsset(state.imageCapture.asset);
    const meta = hasAssignedAsset
      ? `${asset.width || "-"}x${asset.height || "-"} / ${asset.mimeType || "image/jpeg"}`
      : "尚未绑定图像";

    return `
      <div class="field dynamic-field">
        <span class="field-label">${label}${requiredMark}</span>
        <div class="input-zone">
          <div class="image-binding-card">
            ${hasAssignedAsset ? `
              <div class="image-preview-frame">
                <img src="${runtime.escapeHtml(asset.dataUrl)}" alt="${label}" />
              </div>
            ` : `
              <div class="empty-panel">
                <h4>等待图像绑定</h4>
                <p>先在上方捕获当前文档，再绑定到这个字段。</p>
              </div>
            `}
            <div class="image-meta-grid">
              <span class="image-meta-pill">${runtime.escapeHtml(meta)}</span>
              <span class="image-meta-pill">字段: ${runtime.escapeHtml(key)}</span>
            </div>
            <div class="inline-actions">
              <button class="mini-btn" type="button" data-action="assign-captured-image" data-form-key="${runtime.escapeHtml(key)}" ${captureReady ? "" : "disabled"}>使用当前捕获</button>
              <button class="mini-btn" type="button" data-action="clear-captured-image" data-form-key="${runtime.escapeHtml(key)}" ${hasAssignedAsset ? "" : "disabled"}>清除</button>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  function renderResultPlacementPanel() {
    const runtime = modules.runtime;
    const state = modules.state.state;
    const panel = runtime.getById("resultPlacementPanel");
    const summaryBox = runtime.getById("resultSummaryBox");
    if (!panel || !summaryBox) return;

    const result = state.lastResult;
    const hasResult = Boolean(result && result.outputUrl);
    panel.hidden = !hasResult;
    syncPlacementControls();

    if (!hasResult) {
      summaryBox.innerHTML = "暂无可放回结果";
      return;
    }

    const sourceDocument = result.sourceDocument;
    const sourceText = sourceDocument ? formatDocumentLabel(sourceDocument) : "任务运行时未记录";
    const currentDocument = state.currentDocumentInfo;
    const currentText = currentDocument ? formatDocumentLabel(currentDocument) : "尚未检查";
    const hasDocMismatch =
      sourceDocument &&
      currentDocument &&
      sourceDocument.hasActiveDocument &&
      currentDocument.hasActiveDocument &&
      String(sourceDocument.documentId) !== String(currentDocument.documentId);

    const hintText = hasDocMismatch
      ? "检测到当前文档与任务发起文档不同，建议确认后再放回。"
      : state.resultPlacement.requireSameDocument === false
      ? "已允许跨文档放回。"
      : "将按当前设置检查文档一致性。";

    summaryBox.innerHTML = `
      <div><strong>${runtime.escapeHtml(result.appName || "未命名应用")}</strong></div>
      <div>Task ID: ${runtime.escapeHtml(result.taskId || "-")}</div>
      <div>结果 URL: ${runtime.escapeHtml(result.outputUrl || "-")}</div>
      <div>任务文档: ${runtime.escapeHtml(sourceText)}</div>
      <div>当前文档: ${runtime.escapeHtml(currentText)}</div>
      <div>${runtime.escapeHtml(hintText)}</div>
    `;
  }

  function updateRunButtonState() {
    const state = modules.state.state;
    const runButton = modules.runtime.getById("btnRun");
    const cancelButton = modules.runtime.getById("btnCancelJob");
    const placeResultButton = modules.runtime.getById("btnPlaceResult");
    const taskStatusSummary = modules.runtime.getById("taskStatusSummary");
    const hasCurrentApp = !!state.currentApp;
    const hasRunningTask = Boolean(state.runningTask && state.runningTask.taskId);
    const hasResult = Boolean(state.lastResult && state.lastResult.outputUrl);

    if (runButton) {
      runButton.disabled = !hasCurrentApp || hasRunningTask;
      runButton.textContent = hasRunningTask
        ? "任务进行中..."
        : hasCurrentApp
        ? `运行 ${modules.state.getAppDisplayName(state.currentApp)}`
        : "开始运行";
    }

    if (cancelButton) {
      cancelButton.disabled = !hasRunningTask;
      cancelButton.textContent = "取消任务";
    }

    if (placeResultButton) {
      placeResultButton.disabled = !hasResult || hasRunningTask;
      placeResultButton.textContent = "放回 Photoshop";
    }

    if (taskStatusSummary) {
      if (hasRunningTask) {
        taskStatusSummary.textContent = `任务进行中：${state.runningTask.appName}，Task ID: ${state.runningTask.taskId}`;
      } else {
        taskStatusSummary.textContent = hasCurrentApp
          ? `当前应用：${modules.state.getAppDisplayName(state.currentApp)}，动态表单已接入，可直接提交任务`
          : "后台任务：暂无，请先选择一个应用";
      }
    }

    renderResultPlacementPanel();
  }

  function renderField(input) {
    const runtime = modules.runtime;
    const state = modules.state.state;
    const key = String(input.key || "").trim();
    const label = runtime.escapeHtml(input.label || input.name || key);
    const requiredMark = input.required ? '<span class="field-required">*</span>' : "";
    const value = state.formValues[key];
    const escapedKey = runtime.escapeHtml(key);

    if (isImageInput(input)) {
      return renderImageField(input);
    }

    if (input.type === "textarea" || input.type === "multiline") {
      return `
        <label class="field dynamic-field">
          <span class="field-label">${label}${requiredMark}</span>
          <textarea class="field-input field-textarea" rows="4" data-form-key="${escapedKey}">${runtime.escapeHtml(String(value ?? ""))}</textarea>
        </label>
      `;
    }

    if (input.type === "number" || input.type === "int" || input.type === "float") {
      return `
        <label class="field dynamic-field">
          <span class="field-label">${label}${requiredMark}</span>
          <input class="field-input" type="number" data-form-key="${escapedKey}" value="${runtime.escapeHtml(String(value ?? ""))}" />
        </label>
      `;
    }

    if (input.type === "boolean" || input.type === "switch" || input.type === "checkbox") {
      return `
        <label class="field toggle-field">
          <span class="field-label">${label}${requiredMark}</span>
          <label class="checkbox-line">
            <input type="checkbox" data-form-key="${escapedKey}" ${value ? "checked" : ""} />
            <span>启用</span>
          </label>
        </label>
      `;
    }

    if (input.type === "select" || input.type === "enum") {
      const options = Array.isArray(input.options) ? input.options : [];
      return `
        <label class="field dynamic-field">
          <span class="field-label">${label}${requiredMark}</span>
          <select class="field-input" data-form-key="${escapedKey}">
            <option value="">请选择</option>
            ${options.map((option) => {
              const optValue = typeof option === "object" ? option.value : option;
              const optLabel = typeof option === "object" ? option.label : option;
              return `<option value="${runtime.escapeHtml(String(optValue ?? ""))}" ${String(value ?? "") === String(optValue ?? "") ? "selected" : ""}>${runtime.escapeHtml(String(optLabel ?? optValue ?? ""))}</option>`;
            }).join("")}
          </select>
        </label>
      `;
    }

    return `
      <label class="field dynamic-field">
        <span class="field-label">${label}${requiredMark}</span>
        <input class="field-input" type="text" data-form-key="${escapedKey}" value="${runtime.escapeHtml(String(value ?? ""))}" />
      </label>
    `;
  }

  function renderWorkspace() {
    const runtime = modules.runtime;
    const state = modules.state.state;
    const appPickerMeta = runtime.getById("appPickerMeta");
    const dynamicInputContainer = runtime.getById("dynamicInputContainer");

    if (appPickerMeta) {
      if (!state.currentApp) {
        appPickerMeta.innerHTML = "暂未选择 RunningHub 应用";
      } else {
        appPickerMeta.innerHTML = `
          <div><strong>${runtime.escapeHtml(modules.state.getAppDisplayName(state.currentApp))}</strong></div>
          <div>App ID: ${runtime.escapeHtml(modules.state.getAppDisplayId(state.currentApp))}</div>
          <div>输入项：${runtime.escapeHtml(String(modules.state.getAppInputCount(state.currentApp)))}</div>
          <div>图像项：${runtime.escapeHtml(String(findImageInputs(state.currentApp).length))}</div>
        `;
      }
    }

    renderImageInputArea();

    if (dynamicInputContainer) {
      if (!state.currentApp) {
        dynamicInputContainer.innerHTML = `
          <div class="empty-panel">
            <h4>动态表单区</h4>
            <p>请先选择一个已保存应用，后续这里会根据 schema 动态渲染输入表单。</p>
          </div>
        `;
      } else if (!Array.isArray(state.currentApp.inputs) || state.currentApp.inputs.length === 0) {
        dynamicInputContainer.innerHTML = `
          <div class="empty-panel">
            <h4>${runtime.escapeHtml(modules.state.getAppDisplayName(state.currentApp))}</h4>
            <p>当前应用还没有输入 schema。你可以先去 Settings 编辑应用，手动填写输入 JSON。</p>
          </div>
        `;
      } else {
        dynamicInputContainer.innerHTML = `
          <div class="dynamic-form">
            ${state.currentApp.inputs.map(renderField).join("")}
          </div>
        `;
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
      if (inputMeta && isImageInput(inputMeta)) {
        return;
      }

      if (element.matches("input, textarea, select")) {
        state.formValues[key] = element.value;
      }
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
      settings: {
        pollInterval: state.settings.pollInterval,
        timeout: state.settings.timeout
      }
    };

    state.lastRunPayload = payload;
    return payload;
  }

  function setRunningTask(taskId, appName, status = "running") {
    modules.state.state.runningTask = {
      taskId: String(taskId || ""),
      appName: String(appName || ""),
      status: String(status || "running")
    };
    updateRunButtonState();
  }

  function clearRunningTask() {
    modules.state.state.runningTask = {
      taskId: "",
      appName: "",
      status: "idle"
    };
    updateRunButtonState();
  }

  function clearLastResult() {
    const state = modules.state.state;
    state.lastResult = {
      appName: "",
      sourceDocument: null,
      outputUrl: "",
      taskId: "",
      placedAt: 0
    };
    state.resultPlacement.layerName = "";
    updateRunButtonState();
  }

  function setLastResult(payload) {
    const state = modules.state.state;
    const data = payload && typeof payload === "object" ? payload : {};
    state.lastResult = {
      appName: String(data.appName || "").trim(),
      sourceDocument: data.sourceDocument && typeof data.sourceDocument === "object" ? data.sourceDocument : null,
      outputUrl: String(data.outputUrl || "").trim(),
      taskId: String(data.taskId || "").trim(),
      placedAt: Number(data.placedAt) > 0 ? Number(data.placedAt) : 0
    };
    state.resultPlacement.layerName = String(data.layerName || "").trim();
    updateRunButtonState();
  }

  async function refreshPhotoshopDocumentStatus(options = {}) {
    const state = modules.state.state;
    if (!modules.runtime.isPluginRuntime()) return null;

    try {
      const info = await modules.runtime.callHost("photoshop.getActiveDocumentInfo", []);
      state.currentDocumentInfo = info && typeof info === "object" ? info : null;

      if (!options.quiet && info && info.ok) {
        modules.ui.logToWorkspace(`Photoshop 当前文档：${info.title} (#${info.documentId})`, "info");
      }

      renderResultPlacementPanel();
      return state.currentDocumentInfo;
    } catch (_) {
      state.currentDocumentInfo = null;
      renderResultPlacementPanel();
      return null;
    }
  }

  async function captureSourceDocumentInfo() {
    if (!modules.runtime.isPluginRuntime()) return null;
    return refreshPhotoshopDocumentStatus({ quiet: true });
  }

  async function captureCurrentDocumentImage() {
    if (!modules.runtime.isPluginRuntime()) {
      throw new Error("浏览器预览模式下无法捕获 Photoshop 图像");
    }

    const settings = getImageCaptureSettings();
    const asset = await modules.runtime.callHost("photoshop.captureDocumentPreview", [settings], {
      timeoutMs: 30000
    });

    modules.state.state.imageCapture.asset = asset;
    modules.ui.logToWorkspace(
      `已捕获 Photoshop 文档图像：${asset.width}x${asset.height}，JPEG ${asset.quality}`,
      "success"
    );
    renderWorkspace();
    return asset;
  }

  function clearCapturedImage() {
    const state = modules.state.state;
    state.imageCapture.asset = null;
    const imageInputs = findImageInputs(state.currentApp);
    imageInputs.forEach((input) => {
      const key = String(input.key || "").trim();
      if (hasImageAsset(state.formValues[key])) {
        state.formValues[key] = null;
      }
    });
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
    if (!app) {
      throw new Error("请先选择一个应用");
    }

    collectFormValuesFromDom();
    const missing = (Array.isArray(app.inputs) ? app.inputs : [])
      .filter((input) => input.required)
      .filter((input) => isMissingRequiredValue(state.formValues[input.key]));

    if (missing.length > 0) {
      throw new Error(`请先填写必填项：${missing.map((item) => item.label || item.key).join("、")}`);
    }
  }

  function buildPlacementPayload() {
    const state = modules.state.state;
    const placement = readPlacementOptionsFromDom();
    return {
      url: state.lastResult.outputUrl,
      taskId: state.lastResult.taskId,
      sourceDocumentId:
        state.lastResult.sourceDocument && state.lastResult.sourceDocument.hasActiveDocument
          ? state.lastResult.sourceDocument.documentId
          : null,
      requireSameDocument: placement.requireSameDocument !== false,
      layerName: placement.layerName || getResultDefaultLayerName()
    };
  }

  function bindWorkspaceActions() {
    const runButton = modules.runtime.getById("btnRun");
    const cancelButton = modules.runtime.getById("btnCancelJob");
    const placeResultButton = modules.runtime.getById("btnPlaceResult");
    const dynamicInputContainer = modules.runtime.getById("dynamicInputContainer");
    const imageInputContainer = modules.runtime.getById("imageInputContainer");
    const layerNameInput = modules.runtime.getById("placementLayerNameInput");
    const requireSameDocumentInput = modules.runtime.getById("placementRequireSameDocument");

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
        if (!inputMeta || !isImageInput(inputMeta)) {
          modules.state.state.formValues[key] = element.value;
        }
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
        if (!inputMeta || !isImageInput(inputMeta)) {
          modules.state.state.formValues[key] = element.value;
        }
      });

      dynamicInputContainer.addEventListener("click", (event) => {
        const actionTarget = event.target && event.target.closest("[data-action][data-form-key]");
        if (!actionTarget) return;

        const action = actionTarget.getAttribute("data-action");
        const key = actionTarget.getAttribute("data-form-key");
        if (!action || !key) return;

        if (action === "assign-captured-image") {
          try {
            assignCaptureToInput(key);
            modules.ui.logToWorkspace(`已把当前捕获绑定到字段：${key}`, "success");
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
          modules.ui.logToWorkspace("已清除当前捕获图像。", "info");
        }
      });
    }

    if (layerNameInput) {
      layerNameInput.addEventListener("input", () => {
        modules.state.state.resultPlacement.layerName = String(layerNameInput.value || "").trim();
        renderResultPlacementPanel();
      });
    }

    if (requireSameDocumentInput) {
      requireSameDocumentInput.addEventListener("change", () => {
        modules.state.state.resultPlacement.requireSameDocument = Boolean(requireSameDocumentInput.checked);
        renderResultPlacementPanel();
      });
    }

    if (runButton) {
      runButton.addEventListener("click", async () => {
        try {
          validateRunPayload();
          clearLastResult();

          const payload = buildRunPayload();
          const sourceDocument = await captureSourceDocumentInfo();
          const taskStatusSummary = modules.runtime.getById("taskStatusSummary");

          if (!modules.runtime.isPluginRuntime()) {
            if (taskStatusSummary) {
              taskStatusSummary.textContent = `浏览器预览模式：已生成 ${payload.appName} 的任务 payload`;
            }
            modules.ui.logToWorkspace(`任务 payload 已生成：${JSON.stringify(payload)}`, "info");
            return;
          }

          if (!payload.apiKey) {
            throw new Error("请先在设置页保存 RunningHub API Key");
          }

          if (taskStatusSummary) taskStatusSummary.textContent = `正在提交任务：${payload.appName}`;

          const submitResult = await modules.runtime.callHost("runninghub.submitTask", [payload], {
            timeoutMs: Math.max(10000, Number(payload.settings.timeout || 180) * 1000 + 5000)
          });

          modules.ui.logToWorkspace(`任务提交成功，Task ID: ${submitResult.taskId}`, "success");
          setRunningTask(submitResult.taskId, payload.appName, "submitted");
          if (taskStatusSummary) taskStatusSummary.textContent = `任务已提交，正在轮询结果：${submitResult.taskId}`;

          const pollResult = await modules.runtime.callHost("runninghub.pollTask", [{
            apiKey: payload.apiKey,
            taskId: submitResult.taskId,
            settings: payload.settings
          }], {
            timeoutMs: Math.max(15000, Number(payload.settings.timeout || 180) * 1000 + 15000)
          });

          clearRunningTask();
          setLastResult({
            appName: payload.appName,
            sourceDocument,
            outputUrl: pollResult.outputUrl,
            taskId: submitResult.taskId,
            layerName: getResultDefaultLayerName()
          });

          if (taskStatusSummary) {
            taskStatusSummary.textContent = `任务完成：${payload.appName}，结果已就绪，可放回 Photoshop`;
          }
          modules.ui.logToWorkspace(`任务完成，结果 URL: ${pollResult.outputUrl}`, "success");
          await refreshPhotoshopDocumentStatus({ quiet: true });
        } catch (error) {
          clearRunningTask();
          modules.ui.logToWorkspace(error.message, "warn");
          const taskStatusSummary = modules.runtime.getById("taskStatusSummary");
          if (taskStatusSummary) {
            taskStatusSummary.textContent = `任务提交失败：${error.message}`;
          }
        }
      });
    }

    if (cancelButton) {
      cancelButton.addEventListener("click", async () => {
        const runningTask = modules.state.state.runningTask;
        const apiKey = modules.state.state.settings.apiKey;
        if (!runningTask || !runningTask.taskId) {
          modules.ui.logToWorkspace("当前没有可取消的任务。", "info");
          return;
        }

        try {
          await modules.runtime.callHost("runninghub.cancelTask", [{
            apiKey,
            taskId: runningTask.taskId
          }], { timeoutMs: 20000 });
          modules.ui.logToWorkspace(`任务已取消：${runningTask.taskId}`, "warn");
          clearRunningTask();
          const taskStatusSummary = modules.runtime.getById("taskStatusSummary");
          if (taskStatusSummary) {
            taskStatusSummary.textContent = `任务已取消：${runningTask.taskId}`;
          }
        } catch (error) {
          modules.ui.logToWorkspace(`取消任务失败：${error.message}`, "error");
        }
      });
    }

    if (placeResultButton) {
      placeResultButton.addEventListener("click", async () => {
        const result = modules.state.state.lastResult;
        if (!result || !result.outputUrl) {
          modules.ui.logToWorkspace("当前没有可放回 Photoshop 的结果。", "info");
          return;
        }

        if (!modules.runtime.isPluginRuntime()) {
          modules.ui.logToWorkspace(`浏览器预览模式下不会执行放图。结果 URL: ${result.outputUrl}`, "info");
          return;
        }

        try {
          await refreshPhotoshopDocumentStatus({ quiet: true });
          const placementPayload = buildPlacementPayload();
          const response = await modules.runtime.callHost("photoshop.placeResultFromUrl", [placementPayload], {
            timeoutMs: 60000
          });

          modules.state.state.lastResult.placedAt = Date.now();
          modules.ui.logToWorkspace(
            `结果已放回 Photoshop，文档 ID: ${response.documentId}，图层：${response.layerName || placementPayload.layerName}`,
            "success"
          );

          if (response && response.document) {
            modules.state.state.currentDocumentInfo = response.document;
          }

          const taskStatusSummary = modules.runtime.getById("taskStatusSummary");
          if (taskStatusSummary) {
            taskStatusSummary.textContent = `结果已放回 Photoshop，Task ID: ${result.taskId}`;
          }

          renderResultPlacementPanel();
        } catch (error) {
          modules.ui.logToWorkspace(`放回 Photoshop 失败：${error.message}`, "error");
        }
      });
    }
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
