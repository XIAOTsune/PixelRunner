(function initWorkspaceModule(global) {
  const modules = (global.PixelRunnerModules = global.PixelRunnerModules || {});
  const RUN_BUTTON_COOLDOWN_MS = 1500;
  const TASK_CARD_LIMIT = 24;
  let runButtonCooldownUntil = 0;
  let taskTickerHandle = 0;

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
        (
          ((asset.dataUrl || "").trim() ||
            (asset.base64 || "").trim() ||
            (asset.url || "").trim() ||
            (asset.uploadDataUrl || "").trim() ||
            (asset.uploadBase64 || "").trim())
        )
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

  function cloneCaptureAsset(asset) {
    if (!hasImageAsset(asset)) return null;
    return {
      assetId: String(asset.assetId || ""),
      capturedAt: Number(asset.capturedAt) || 0,
      capturedFromSelection: Boolean(asset.capturedFromSelection),
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
      url: String(asset.url || ""),
      uploadMimeType: String(asset.uploadMimeType || asset.mimeType || "image/jpeg"),
      uploadDataUrl: String(asset.uploadDataUrl || ""),
      uploadBase64: String(asset.uploadBase64 || ""),
      uploadBytes: Number(asset.uploadBytes) || null,
      uploadQuality: Number(asset.uploadQuality) || null,
      uploadTargetBytes: Number(asset.uploadTargetBytes) || null,
      uploadHardLimitBytes: Number(asset.uploadHardLimitBytes) || null,
      compressionAttempts: Array.isArray(asset.compressionAttempts)
        ? asset.compressionAttempts.map((attempt) => ({
            quality: Number(attempt && attempt.quality) || null,
            bytes: Number(attempt && attempt.bytes) || null
          }))
        : []
    };
  }

  function getImageAssetPreviewSrc(asset) {
    if (!asset || typeof asset !== "object") return "";
    const dataUrl = String(asset.dataUrl || "").trim();
    if (dataUrl) return dataUrl;
    const base64 = String(asset.base64 || "").trim();
    if (base64) {
      const mimeType = String(asset.mimeType || "image/jpeg").trim() || "image/jpeg";
      return `data:${mimeType};base64,${base64}`;
    }
    const uploadDataUrl = String(asset.uploadDataUrl || "").trim();
    if (uploadDataUrl) return uploadDataUrl;
    const uploadBase64 = String(asset.uploadBase64 || "").trim();
    if (uploadBase64) {
      const uploadMimeType = String(asset.uploadMimeType || asset.mimeType || "image/jpeg").trim() || "image/jpeg";
      return `data:${uploadMimeType};base64,${uploadBase64}`;
    }
    return String(asset.url || "").trim();
  }

  function buildImageInputPayloadValue(asset) {
    if (!asset || typeof asset !== "object") return asset;
    const uploadDataUrl = String(asset.uploadDataUrl || "").trim();
    const uploadBase64 = String(asset.uploadBase64 || "").trim();
    const uploadMimeType = String(asset.uploadMimeType || asset.mimeType || "image/jpeg").trim() || "image/jpeg";
    const previewDataUrl = String(asset.dataUrl || "").trim();
    const previewBase64 = String(asset.base64 || "").trim();
    const payloadValue = {
      dataUrl: uploadDataUrl || previewDataUrl,
      base64: uploadBase64 || previewBase64,
      url: String(asset.url || "").trim(),
      mimeType: uploadMimeType,
      width: Number(asset.originalWidth) || Number(asset.width) || null,
      height: Number(asset.originalHeight) || Number(asset.height) || null,
      bytes: Number(asset.uploadBytes) || null,
      quality: Number(asset.uploadQuality) || null
    };
    return payloadValue;
  }

  function normalizePayloadInputs(app, formValues) {
    const inputs = Array.isArray(app && app.inputs) ? app.inputs : [];
    const source = formValues && typeof formValues === "object" ? formValues : {};
    const out = { ...source };
    inputs.forEach((input) => {
      if (!isImageInput(input)) return;
      const key = String((input && input.key) || "").trim();
      if (!key || !(key in out)) return;
      out[key] = buildImageInputPayloadValue(out[key]);
    });
    return out;
  }

  function createCaptureAssetId() {
    return `capture-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function getCaptureAssets() {
    return Array.isArray(modules.state.state.imageCapture.assets)
      ? modules.state.state.imageCapture.assets.filter(hasImageAsset)
      : [];
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

  function clearImageInputValue(key) {
    modules.state.state.formValues[key] = null;
    renderWorkspace();
  }

  function logImageCaptureTrace(message, data = null) {
    const detail = data && typeof data === "object" ? ` ${JSON.stringify(data)}` : "";
    modules.ui.logToWorkspace(`[图像捕获] ${message}${detail}`, "info");
  }

  async function captureAndAssignToInput(key) {
    logImageCaptureTrace("开始写入字段", { key });
    const asset = await captureCurrentDocumentImage();
    modules.state.state.formValues[key] = cloneCaptureAsset(asset);
    logImageCaptureTrace("字段写入完成", {
      key,
      width: asset && asset.width ? asset.width : null,
      height: asset && asset.height ? asset.height : null,
      capturedFromSelection: Boolean(asset && asset.capturedFromSelection)
    });
    renderWorkspace();
    return asset;
  }

  function renderImageInputArea() {
    const runtime = modules.runtime;
    const state = modules.state.state;
    const imageInputContainer = runtime.getById("imageInputContainer");
    if (!imageInputContainer) return;

    const imageInputs = findImageInputs(state.currentApp);
    imageInputContainer.hidden = true;
    if (!state.currentApp) {
      imageInputContainer.innerHTML = "";
      return;
    }

    if (imageInputs.length === 0) {
      imageInputContainer.innerHTML = "";
      imageInputContainer.hidden = true;
      return;
    }

    imageInputContainer.innerHTML = "";
  }

  function renderImageField(input) {
    const runtime = modules.runtime;
    const state = modules.state.state;
    const key = String(input.key || "").trim();
    const label = runtime.escapeHtml(input.label || input.name || key);
    const asset = state.formValues[key];
    const hasAssignedAsset = hasImageAsset(asset);
    const previewSrc = getImageAssetPreviewSrc(asset);
    const captureLabel = hasAssignedAsset ? "重新捕获" : "捕获图像";
    const captureSource = hasAssignedAsset
      ? (asset.capturedFromSelection ? "来源：Photoshop 当前选区" : "来源：Photoshop 当前文档")
      : "点击此区域直接捕获图像";
    const captureMeta = hasAssignedAsset
      ? [
          `${asset.originalWidth || asset.width || "-"}x${asset.originalHeight || asset.height || "-"}`,
          asset.uploadBytes ? `${(asset.uploadBytes / (1024 * 1024)).toFixed(2)}MB` : "",
          asset.uploadQuality ? `Q${asset.uploadQuality}` : ""
        ].filter(Boolean).join(" · ")
      : "";
    const requiredMark = input.required ? '<span class="field-required">*</span>' : "";

    return `
      <div class="field dynamic-field image-field">
        <div class="image-binding-card image-capture-field-card" data-action="capture-field-image" data-form-key="${runtime.escapeHtml(key)}">
          <div class="image-capture-stage ${hasAssignedAsset ? "image-capture-stage-filled" : "image-capture-stage-empty"}">
            <div class="image-capture-stage-corners">
              <span class="image-capture-corner-label">${label}${requiredMark}</span>
              <button class="mini-btn image-capture-clear-btn" type="button" data-action="clear-captured-image" data-form-key="${runtime.escapeHtml(key)}" ${hasAssignedAsset ? "" : "disabled"}>清空</button>
            </div>
            ${
              hasAssignedAsset && previewSrc
                ? `<div class="image-capture-preview"><img src="${runtime.escapeHtml(previewSrc)}" alt="${label}" /></div>`
                : `
                  <div class="image-capture-stage-empty-inner">
                    <div class="image-capture-stage-icon">↑</div>
                    <div class="image-capture-stage-text">点击捕获</div>
                  </div>
                `
            }
            <div class="inline-actions image-capture-stage-actions">
              <button class="mini-btn image-capture-primary-btn" type="button" data-action="capture-field-image" data-form-key="${runtime.escapeHtml(key)}">${captureLabel}</button>
            </div>
          </div>
          <div class="image-capture-stage-note">${runtime.escapeHtml(captureSource)}${captureMeta ? ` · ${runtime.escapeHtml(captureMeta)}` : ""}</div>
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

  function getRunningTasks() {
    return Array.isArray(modules.state.state.runningTasks)
      ? modules.state.state.runningTasks.filter((item) => item && item.taskId)
      : [];
  }

  function isTaskTerminalStatus(status) {
    const normalized = String(status || "").trim().toLowerCase();
    return ["succeeded", "success", "done", "failed", "error", "cancelled", "canceled"].includes(normalized);
  }

  function isTaskCancellable(task) {
    if (!task || typeof task !== "object") return false;
    if (isTaskTerminalStatus(task.status)) return false;
    return Boolean(String(task.remoteTaskId || task.taskId || "").trim()) && String(task.status || "").trim().toLowerCase() !== "submitting";
  }

  function getActiveRunningTasks() {
    return getRunningTasks().filter((task) => !isTaskTerminalStatus(task.status));
  }

  function getMaxConcurrentTasks() {
    return Math.max(1, Number(modules.state.state.settings.maxConcurrentTasks) || modules.state.DEFAULT_SETTINGS.maxConcurrentTasks || 3);
  }

  function isRunCooldownActive() {
    return Date.now() < runButtonCooldownUntil;
  }

  function formatTaskDuration(ms) {
    const totalSeconds = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  function getTaskElapsedMs(task) {
    if (!task || typeof task !== "object") return 0;
    const startedAt = Number(task.submittedAt || task.createdAt || 0);
    const endedAt = Number(task.finishedAt || 0);
    if (!startedAt) return 0;
    return Math.max(0, (endedAt || Date.now()) - startedAt);
  }

  function getTaskStatusTone(status) {
    const normalized = String(status || "").trim().toLowerCase();
    if (["succeeded", "success", "done"].includes(normalized)) return "success";
    if (["failed", "error"].includes(normalized)) return "error";
    if (["cancelled", "canceled"].includes(normalized)) return "warn";
    return "info";
  }

  function getTaskStatusLabel(status) {
    const normalized = String(status || "").trim().toLowerCase();
    if (!normalized) return "运行中";
    if (normalized === "submitting") return "提交中";
    if (normalized === "submitted") return "已提交";
    if (normalized === "running") return "运行中";
    if (normalized === "queued") return "排队中";
    if (normalized === "succeeded" || normalized === "success" || normalized === "done") return "已完成";
    if (normalized === "failed" || normalized === "error") return "失败";
    if (normalized === "cancelled" || normalized === "canceled") return "已取消";
    return status;
  }

  function getTaskStatusDetail(task) {
    if (!task || typeof task !== "object") return "";
    if (task.detail) return String(task.detail);
    const normalized = String(task.status || "").trim().toLowerCase();
    if (normalized === "submitting") return "正在提交到 RunningHub...";
    if (normalized === "submitted") return "任务已创建，等待 RunningHub 执行。";
    if (normalized === "running") return "任务执行中，正在等待结果返回。";
    if (normalized === "queued") return "任务排队中，尚未开始执行。";
    if (normalized === "succeeded" || normalized === "success" || normalized === "done") return "任务已完成。";
    if (normalized === "failed" || normalized === "error") return task.errorMessage || "任务执行失败。";
    if (normalized === "cancelled" || normalized === "canceled") return "任务已取消。";
    return "";
  }

  function sortRunningTasks(tasks) {
    return tasks
      .slice()
      .sort((left, right) => {
        const leftActive = isTaskTerminalStatus(left.status) ? 1 : 0;
        const rightActive = isTaskTerminalStatus(right.status) ? 1 : 0;
        if (leftActive !== rightActive) return leftActive - rightActive;
        return Number(right.updatedAt || right.createdAt || 0) - Number(left.updatedAt || left.createdAt || 0);
      });
  }

  function ensureTaskTickerState() {
    const hasActiveTask = getActiveRunningTasks().length > 0;
    if (hasActiveTask && !taskTickerHandle) {
      taskTickerHandle = window.setInterval(() => {
        updateRunButtonState();
      }, 1000);
      return;
    }
    if (!hasActiveTask && taskTickerHandle) {
      window.clearInterval(taskTickerHandle);
      taskTickerHandle = 0;
    }
  }

  function renderRunningTaskList(tasks) {
    if (!Array.isArray(tasks) || tasks.length === 0) return "";
    return sortRunningTasks(tasks)
      .map((task, index) => {
        const appName = modules.runtime.escapeHtml(task.appName || `任务 ${index + 1}`);
        const taskId = String(task.remoteTaskId || task.taskId || "").trim();
        const shortTaskId = taskId ? `#${taskId.slice(-8)}` : "等待分配任务 ID";
        const statusLabel = getTaskStatusLabel(task.status || "running");
        const statusTone = getTaskStatusTone(task.status || "running");
        const durationLabel = `${isTaskTerminalStatus(task.status) ? "耗时" : "已运行"} ${formatTaskDuration(getTaskElapsedMs(task))}`;
        const detail = modules.runtime.escapeHtml(getTaskStatusDetail(task));
        const canCancel = isTaskCancellable(task);
        return `
          <div class="running-task-item">
            <div class="running-task-main">
              <div class="running-task-topline">
                <div class="running-task-title">${appName}</div>
                <span class="status-chip running-task-status-chip" data-status="${modules.runtime.escapeHtml(statusTone)}">${modules.runtime.escapeHtml(statusLabel)}</span>
              </div>
              <div class="running-task-meta">${modules.runtime.escapeHtml(shortTaskId)} · ${modules.runtime.escapeHtml(durationLabel)}</div>
              <div class="running-task-detail">${detail}</div>
            </div>
            ${
              canCancel
                ? `<button class="mini-btn running-task-cancel-btn" type="button" data-action="cancel-running-task" data-task-id="${modules.runtime.escapeHtml(String(task.taskId || "").trim())}">取消</button>`
                : ""
            }
          </div>
        `;
      })
      .join("");
  }

  function updateRunButtonState() {
    const state = modules.state.state;
    const runButton = modules.runtime.getById("btnRun");
    const taskStatusSummary = modules.runtime.getById("taskStatusSummary");
    const runningTaskList = modules.runtime.getById("runningTaskList");
    const hasCurrentApp = !!state.currentApp;
    const runningTasks = getRunningTasks();
    const activeRunningTasks = getActiveRunningTasks();
    const hasRunningTask = runningTasks.length > 0;
    const activeCount = activeRunningTasks.length;
    const maxConcurrentTasks = getMaxConcurrentTasks();
    const concurrencyReached = activeCount >= maxConcurrentTasks;
    const cooldownActive = isRunCooldownActive();
    const cooldownSeconds = Math.max(1, Math.ceil((runButtonCooldownUntil - Date.now()) / 1000));

    if (runButton) {
      runButton.disabled = !hasCurrentApp || concurrencyReached || cooldownActive;
      if (!hasCurrentApp) {
        runButton.textContent = "开始运行";
      } else if (concurrencyReached) {
        runButton.textContent = `并发已满 ${activeCount}/${maxConcurrentTasks}`;
      } else if (cooldownActive) {
        runButton.textContent = `请稍候 ${cooldownSeconds}s`;
      } else if (activeCount > 0) {
        runButton.textContent = `运行新任务 ${activeCount}/${maxConcurrentTasks}`;
      } else {
        runButton.textContent = `运行 ${modules.state.getAppDisplayName(state.currentApp)}`;
      }
    }

    if (taskStatusSummary) {
      if (!hasCurrentApp) {
        taskStatusSummary.textContent = "后台任务：无，请先选择应用。";
      } else if (concurrencyReached) {
        taskStatusSummary.textContent = `后台任务：进行中 ${activeCount}/${maxConcurrentTasks} 个，已达到并发上限，请等待任务完成或在卡片中取消。`;
      } else if (cooldownActive) {
        taskStatusSummary.textContent = `后台任务：已进入提交冷却，${cooldownSeconds}s 后可继续发送新任务。`;
      } else if (activeCount > 0) {
        taskStatusSummary.textContent = `后台任务：进行中 ${activeCount}/${maxConcurrentTasks} 个，可继续发送新任务，也可在卡片中逐个取消。`;
      } else if (hasRunningTask) {
        taskStatusSummary.textContent = `后台任务：当前无进行中任务，已保留最近 ${runningTasks.length} 条任务卡片。`;
      } else {
        taskStatusSummary.textContent = `后台任务：无，已就绪，可直接运行 ${modules.state.getAppDisplayName(state.currentApp)}。`;
      }
    }

    if (runningTaskList) {
      runningTaskList.hidden = false;
      runningTaskList.innerHTML = hasRunningTask ? renderRunningTaskList(runningTasks) : '<div class="running-task-empty">运行后的任务会显示在这里。</div>';
    }

    ensureTaskTickerState();
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
    const currentAppId = modules.state.resolveAppId(state.currentApp);
    const payload = {
      appId: currentAppId,
      appName: state.currentApp ? state.currentApp.name : "",
      app: state.currentApp
        ? {
            id: state.currentApp.id,
            appId: currentAppId,
            name: state.currentApp.name,
            inputs: Array.isArray(state.currentApp.inputs) ? state.currentApp.inputs : []
          }
        : null,
      apiKey: state.settings.apiKey || "",
      inputs: normalizePayloadInputs(state.currentApp, state.formValues),
      settings: {
        pollInterval: state.settings.pollInterval,
        timeout: state.settings.timeout,
        maxConcurrentTasks: state.settings.maxConcurrentTasks
      }
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

  function createLocalTaskId() {
    return `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function upsertRunningTask(taskOrTaskId, appName = "", status = "running") {
    const state = modules.state.state;
    const patch =
      taskOrTaskId && typeof taskOrTaskId === "object"
        ? { ...taskOrTaskId }
        : {
            taskId: String(taskOrTaskId || "").trim(),
            appName: String(appName || "").trim(),
            status: String(status || "running").trim() || "running"
          };
    const normalizedTaskId = String(patch.taskId || "").trim();
    if (!normalizedTaskId) return null;

    const now = Date.now();
    const nextTask = {
      taskId: normalizedTaskId,
      remoteTaskId: String(patch.remoteTaskId || patch.taskId || "").trim(),
      appName: String(patch.appName || "").trim(),
      status: String(patch.status || "running").trim() || "running",
      detail: String(patch.detail || "").trim(),
      errorMessage: String(patch.errorMessage || "").trim(),
      outputUrl: String(patch.outputUrl || "").trim(),
      sourceDocument: patch.sourceDocument && typeof patch.sourceDocument === "object" ? patch.sourceDocument : null,
      createdAt: Number(patch.createdAt) > 0 ? Number(patch.createdAt) : now,
      submittedAt: Number(patch.submittedAt) > 0 ? Number(patch.submittedAt) : now,
      finishedAt: Number(patch.finishedAt) > 0 ? Number(patch.finishedAt) : 0,
      updatedAt: Number(patch.updatedAt) > 0 ? Number(patch.updatedAt) : now,
      placementDocumentId: Number(patch.placementDocumentId) > 0 ? Number(patch.placementDocumentId) : 0
    };

    const list = Array.isArray(state.runningTasks) ? state.runningTasks.slice() : [];
    const index = list.findIndex((item) => String(item.taskId || "") === normalizedTaskId);
    if (index >= 0) {
      const current = list[index];
      list[index] = {
        ...current,
        ...nextTask,
        createdAt: Number(current.createdAt) > 0 ? Number(current.createdAt) : nextTask.createdAt,
        submittedAt: Number(current.submittedAt) > 0 ? Number(current.submittedAt) : nextTask.submittedAt
      };
    } else {
      list.unshift(nextTask);
    }

    state.runningTasks = sortRunningTasks(list).slice(0, TASK_CARD_LIMIT);
    syncPrimaryRunningTask();
    updateRunButtonState();
    return state.runningTasks.find((item) => String(item.taskId || "") === normalizedTaskId) || null;
  }

  function replaceRunningTaskId(currentTaskId, nextTaskPatch = {}) {
    const state = modules.state.state;
    const normalizedCurrentTaskId = String(currentTaskId || "").trim();
    const normalizedNextTaskId = String(nextTaskPatch.taskId || "").trim();
    if (!normalizedCurrentTaskId || !normalizedNextTaskId) return null;

    const list = Array.isArray(state.runningTasks) ? state.runningTasks.slice() : [];
    const index = list.findIndex((item) => String(item.taskId || "") === normalizedCurrentTaskId);
    if (index < 0) return upsertRunningTask(nextTaskPatch);

    const current = list[index];
    list[index] = {
      ...current,
      ...nextTaskPatch,
      taskId: normalizedNextTaskId,
      remoteTaskId: String(nextTaskPatch.remoteTaskId || normalizedNextTaskId).trim(),
      updatedAt: Date.now()
    };
    state.runningTasks = sortRunningTasks(list).slice(0, TASK_CARD_LIMIT);
    syncPrimaryRunningTask();
    updateRunButtonState();
    return state.runningTasks.find((item) => String(item.taskId || "") === normalizedNextTaskId) || null;
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
    logImageCaptureTrace("准备调用宿主捕获", settings);
    const captured = await modules.runtime.callHost("photoshop.captureDocumentPreview", [settings], { timeoutMs: 30000 });
    logImageCaptureTrace("宿主已返回捕获结果", {
      ok: Boolean(captured && captured.ok),
      width: captured && captured.width,
      height: captured && captured.height,
      hasBase64: Boolean(captured && String(captured.base64 || "").trim()),
      hasDataUrl: Boolean(captured && String(captured.dataUrl || "").trim()),
      uploadBytes: captured && captured.uploadBytes,
      uploadQuality: captured && captured.uploadQuality
    });
    const asset = pushCapturedAsset(captured);
    if (!asset) {
      throw new Error("宿主已返回结果，但未生成可用预览资源");
    }
    modules.ui.logToWorkspace(
      `已捕获 Photoshop 文档图像：预览 ${asset.width}x${asset.height}，上传 ${(asset.uploadBytes || 0) / (1024 * 1024) > 0 ? `${((asset.uploadBytes || 0) / (1024 * 1024)).toFixed(2)}MB` : "-"}`,
      "success"
    );
    renderWorkspace();
    return asset;
  }

  async function handleCaptureFieldClick(actionTarget) {
    const key = actionTarget && actionTarget.getAttribute("data-form-key");
    if (!key) return;

    const triggerButton =
      actionTarget.matches("button")
        ? actionTarget
        : actionTarget.querySelector('.image-capture-primary-btn[data-action="capture-field-image"][data-form-key]');

    const card = actionTarget.closest(".image-capture-field-card");
    if ((triggerButton && triggerButton.disabled) || (card && card.dataset.captureBusy === "true")) return;

    if (triggerButton) triggerButton.disabled = true;
    if (card) card.dataset.captureBusy = "true";

    try {
      logImageCaptureTrace("收到点击事件", {
        key,
        trigger: actionTarget.matches("button") ? "button" : "card"
      });
      const asset = await captureAndAssignToInput(key);
      modules.ui.logToWorkspace(
        `已捕获并写入字段：${key} (${asset.capturedFromSelection ? "选区" : "文档"})`,
        "success"
      );
    } catch (error) {
      modules.ui.logToWorkspace(`图像捕获失败：${error.message}`, "error");
    } finally {
      if (card) delete card.dataset.captureBusy;
      if (triggerButton) triggerButton.disabled = false;
    }
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

  async function autoPlaceResult(result) {
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

  async function autoPlaceLastResult() {
    return autoPlaceResult(modules.state.state.lastResult);
  }

  function markRunCooldown() {
    runButtonCooldownUntil = Date.now() + RUN_BUTTON_COOLDOWN_MS;
    updateRunButtonState();
    window.setTimeout(() => {
      updateRunButtonState();
    }, RUN_BUTTON_COOLDOWN_MS + 80);
  }

  async function startRunTaskFlow(payload, sourceDocument) {
    const tempTaskId = createLocalTaskId();
    upsertRunningTask({
      taskId: tempTaskId,
      remoteTaskId: "",
      appName: payload.appName,
      status: "submitting",
      detail: "正在提交到 RunningHub...",
      sourceDocument,
      createdAt: Date.now(),
      submittedAt: Date.now()
    });

    try {
      modules.ui.logToWorkspace(
        `[运行提交] appId=${payload.appId} appName=${payload.appName || "-"} inputCount=${Object.keys(payload.inputs || {}).length}`,
        "info"
      );

      const submitResult = await modules.runtime.callHost("runninghub.submitTask", [payload], {
        timeoutMs: Math.max(10000, Number(payload.settings.timeout || 180) * 1000 + 5000)
      });

      const remoteTaskId = String(submitResult.taskId || "").trim();
      modules.ui.logToWorkspace(`任务已提交：${remoteTaskId}`, "success");
      replaceRunningTaskId(tempTaskId, {
        taskId: remoteTaskId,
        remoteTaskId,
        appName: payload.appName,
        status: "running",
        detail: "任务已提交，正在等待 RunningHub 返回结果。",
        sourceDocument,
        submittedAt: Date.now()
      });

      const pollResult = await modules.runtime.callHost(
        "runninghub.pollTask",
        [{ apiKey: payload.apiKey, taskId: remoteTaskId, settings: payload.settings }],
        { timeoutMs: Math.max(15000, Number(payload.settings.timeout || 180) * 1000 + 15000) }
      );

      upsertRunningTask({
        taskId: remoteTaskId,
        remoteTaskId,
        appName: payload.appName,
        status: "succeeded",
        detail: "任务已完成，结果已返回。",
        outputUrl: String(pollResult.outputUrl || "").trim(),
        sourceDocument,
        finishedAt: Date.now()
      });
      setLastResult({
        appName: payload.appName,
        sourceDocument,
        outputUrl: pollResult.outputUrl,
        taskId: remoteTaskId
      });
      modules.ui.logToWorkspace(`任务已完成，结果地址：${pollResult.outputUrl}`, "success");

      const placementResponse = await autoPlaceResult({
        appName: payload.appName,
        sourceDocument,
        outputUrl: pollResult.outputUrl,
        taskId: remoteTaskId
      });
      upsertRunningTask({
        taskId: remoteTaskId,
        remoteTaskId,
        appName: payload.appName,
        status: "succeeded",
        detail:
          placementResponse && placementResponse.documentId
            ? `任务已完成，并已自动贴回 Photoshop 文档 #${placementResponse.documentId}。`
            : "任务已完成。"
      });
    } catch (error) {
      const message = error && error.message ? error.message : String(error || "任务执行失败");
      const normalizedMessage = String(message).trim();
      const latestTask = getRunningTasks().find((item) => String(item.taskId || "") === tempTaskId);
      const currentTaskId = latestTask ? tempTaskId : String((payload && payload.taskId) || "").trim();
      const activeTask = latestTask || getRunningTasks().find((item) => String(item.appName || "") === String(payload.appName || "").trim() && !isTaskTerminalStatus(item.status));
      const targetTaskId = activeTask ? String(activeTask.taskId || "").trim() : tempTaskId;
      const cancelled = /cancel/i.test(normalizedMessage);
      upsertRunningTask({
        taskId: targetTaskId,
        appName: payload.appName,
        status: cancelled ? "cancelled" : "failed",
        detail: cancelled ? "任务已取消。" : normalizedMessage,
        errorMessage: cancelled ? "" : normalizedMessage,
        sourceDocument,
        finishedAt: Date.now()
      });
      modules.ui.logToWorkspace(normalizedMessage, cancelled ? "warn" : "error");
    }
  }
  function bindWorkspaceActions() {
    const runButton = modules.runtime.getById("btnRun");
    const dynamicInputContainer = modules.runtime.getById("dynamicInputContainer");

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

        if (action === "clear-captured-image") {
          event.preventDefault();
          event.stopPropagation();
          clearImageInputValue(key);
          modules.ui.logToWorkspace(`已清除字段图像：${key}`, "info");
          return;
        }

        if (action === "capture-field-image") {
          event.preventDefault();
          handleCaptureFieldClick(actionTarget);
        }
      });
    }

    if (runButton) {
      runButton.addEventListener("click", async () => {
        try {
          validateRunPayload();
          clearLastResult();
          const payload = buildRunPayload();
          if (!modules.runtime.isPluginRuntime()) {
            modules.ui.logToWorkspace(`浏览器预览模式已生成任务负载：${JSON.stringify(payload)}`, "info");
            return;
          }
          if (!payload.apiKey) throw new Error("请先在设置页保存 RunningHub API Key");
          if (!payload.appId) throw new Error("当前应用缺少有效的 appId，请到设置页重新保存该应用后再运行");
          if (getActiveRunningTasks().length >= getMaxConcurrentTasks()) {
            throw new Error(`已达到最大并发数 ${getMaxConcurrentTasks()}，请等待部分任务完成后再继续发送。`);
          }
          if (isRunCooldownActive()) {
            throw new Error("请不要短时间连续点击运行按钮，稍后再试。");
          }

          markRunCooldown();
          const sourceDocument = await captureSourceDocumentInfo();
          startRunTaskFlow(payload, sourceDocument);
        } catch (error) {
          modules.ui.logToWorkspace(error.message, "warn");
          updateRunButtonState();
        }
      });
    }

    document.addEventListener("click", async (event) => {
      const target = event.target && event.target.closest('[data-action="cancel-running-task"][data-task-id]');
      if (!target) return;

      const action = target.getAttribute("data-action");
      if (action === "cancel-running-task") {
        const taskId = String(target.getAttribute("data-task-id") || "").trim();
        const apiKey = modules.state.state.settings.apiKey;
        if (!taskId) return;
        const currentTask = getRunningTasks().find((item) => String(item.taskId || "") === taskId);
        const remoteTaskId = String((currentTask && (currentTask.remoteTaskId || currentTask.taskId)) || taskId).trim();
        if (!remoteTaskId) return;
        target.disabled = true;
        try {
          await modules.runtime.callHost("runninghub.cancelTask", [{ apiKey, taskId: remoteTaskId }], { timeoutMs: 20000 });
          upsertRunningTask({
            taskId,
            remoteTaskId,
            appName: currentTask && currentTask.appName ? currentTask.appName : "",
            status: "cancelled",
            detail: "任务已取消。",
            finishedAt: Date.now()
          });
          modules.ui.logToWorkspace(`任务已取消：${remoteTaskId}`, "warn");
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
