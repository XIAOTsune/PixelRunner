(function initAiOptimizeModule(global) {
  const modules = (global.PixelRunnerModules = global.PixelRunnerModules || {});
  let taskTicker = 0;
  let composeSequence = 0;

  const state = {
    open: false,
    promptKey: "",
    promptLabel: "",
    promptValue: "",
    imageKey: "",
    imageLabel: "",
    imageAsset: null,
    extraRequirement: "",
    resultText: "",
    statusMessage: "点击“开始优化”后，这里会显示 AI 返回的优化提示词。",
    statusType: "info",
    running: false,
    taskId: "",
    taskStatus: "idle",
    taskDetail: "待开始",
    taskStartedAt: 0,
    taskUpdatedAt: 0,
    txtUrl: "",
    availableImages: [],
    selectedImageKey: "",
    selectedImageMode: "single",
    composingImage: false
  };

  function isImageInput(input) {
    const type = String((input && input.type) || "").trim().toLowerCase();
    return type === "image" || type === "file";
  }

  function hasImageAsset(asset) {
    return Boolean(
      asset &&
        typeof asset === "object" &&
        (
          String(asset.dataUrl || "").trim() ||
          String(asset.base64 || "").trim() ||
          String(asset.url || "").trim() ||
          String(asset.uploadDataUrl || "").trim() ||
          String(asset.uploadBase64 || "").trim()
        )
    );
  }

  function cloneValue(value) {
    if (value == null) return value;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
    if (Array.isArray(value)) return value.map(cloneValue);
    if (value && typeof value === "object") {
      const out = {};
      Object.keys(value).forEach((key) => {
        out[key] = cloneValue(value[key]);
      });
      return out;
    }
    return value;
  }

  function getPrimaryPromptInput(app) {
    const inputs = Array.isArray(app && app.inputs) ? app.inputs : [];
    const promptLike = inputs.filter((input) => modules.state.isPromptLikeInput(input) && !isImageInput(input));
    if (promptLike.length === 0) return null;
    const priority = ["prompt", "positive_prompt"];
    for (const key of priority) {
      const matched = promptLike.find((input) => String((input && input.key) || "").trim().toLowerCase() === key);
      if (matched) return matched;
    }
    return promptLike[0];
  }

  function getFilledImageInputs(app, formValues) {
    const inputs = Array.isArray(app && app.inputs) ? app.inputs : [];
    return inputs
      .filter(isImageInput)
      .map((input) => {
        const key = String((input && input.key) || "").trim();
        const value = formValues && typeof formValues === "object" ? formValues[key] : null;
        if (!key || !hasImageAsset(value)) return null;
        return {
          key,
          label: String(input.label || input.name || key),
          asset: cloneValue(value),
          input
        };
      })
      .filter(Boolean);
  }

  function getImagePreviewSrc(asset) {
    if (!asset || typeof asset !== "object") return "";
    const candidates = [asset.dataUrl, asset.uploadDataUrl, asset.url];
    for (const candidate of candidates) {
      const text = String(candidate || "").trim();
      if (text) return text;
    }
    const base64 = String(asset.base64 || asset.uploadBase64 || "").trim();
    if (!base64) return "";
    const mimeType = String(asset.mimeType || asset.uploadMimeType || "image/jpeg").trim() || "image/jpeg";
    return `data:${mimeType};base64,${base64}`;
  }

  function getAssetSizeLabel(asset) {
    if (!asset || typeof asset !== "object") return "";
    const width = Number(asset.width || asset.originalWidth || 0);
    const height = Number(asset.height || asset.originalHeight || 0);
    if (!width || !height) return "";
    return `${width}x${height}`;
  }

  function getTaskStatusLabel(status) {
    const normalized = String(status || "").trim().toLowerCase();
    if (normalized === "running") return "运行中";
    if (normalized === "success") return "已完成";
    if (normalized === "error") return "失败";
    return "待开始";
  }

  function getTaskStatusTone(status) {
    const normalized = String(status || "").trim().toLowerCase();
    if (normalized === "running") return "pending";
    if (normalized === "success") return "success";
    if (normalized === "error") return "error";
    return "info";
  }

  function formatElapsed(startedAt, updatedAt = Date.now()) {
    const diff = Math.max(0, Number(updatedAt || 0) - Number(startedAt || 0));
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const remainSeconds = seconds % 60;
    if (minutes <= 0) return `${remainSeconds}s`;
    return `${minutes}m ${remainSeconds}s`;
  }

  function renderTaskCard() {
    const container = modules.runtime.getById("aiOptimizeTaskCard");
    if (!container) return;
    const taskId = String(state.taskId || "").trim();
    const status = getTaskStatusLabel(state.taskStatus);
    const tone = getTaskStatusTone(state.taskStatus);
    const duration = state.taskStartedAt ? formatElapsed(state.taskStartedAt, state.taskUpdatedAt || Date.now()) : "--";
    const shortTaskId = taskId ? `#${taskId.slice(-8)}` : "尚未创建任务";
    const detail = modules.runtime.escapeHtml(state.taskDetail || "待开始");
    container.innerHTML = `
      <div class="running-task-item ai-optimize-task-item">
        <div class="running-task-main">
          <div class="running-task-topline">
            <div class="running-task-title">AI优化任务</div>
            <div class="running-task-topline-actions">
              <span class="status-chip running-task-status-chip" data-status="${modules.runtime.escapeHtml(tone)}">${modules.runtime.escapeHtml(status)}</span>
            </div>
          </div>
          <div class="running-task-meta">${modules.runtime.escapeHtml(shortTaskId)} · 耗时 ${modules.runtime.escapeHtml(duration)}</div>
          <div class="running-task-detail">${detail}</div>
        </div>
      </div>
    `;
  }

  function syncTaskTicker() {
    if (state.running && !taskTicker) {
      taskTicker = global.setInterval(() => {
        state.taskUpdatedAt = Date.now();
        renderTaskCard();
      }, 1000);
      return;
    }
    if (!state.running && taskTicker) {
      global.clearInterval(taskTicker);
      taskTicker = 0;
    }
  }

  function setStatus(message, type = "info") {
    state.statusMessage = String(message || "");
    state.statusType = String(type || "info");
    const statusEl = modules.runtime.getById("aiOptimizeStatus");
    if (statusEl) {
      modules.runtime.setSummaryStatus(statusEl, state.statusMessage, state.statusType);
    }
  }

  function syncContextFromWorkspace(promptKey = "") {
    if (modules.workspace && typeof modules.workspace.captureWorkspaceFormSnapshot === "function") {
      modules.workspace.captureWorkspaceFormSnapshot();
    }

    const app = modules.state.state.currentApp;
    const promptInput = getPrimaryPromptInput(app);
    const filledImages = getFilledImageInputs(app, modules.state.state.formValues);
    const resolvedPromptKey = String(promptKey || (promptInput && promptInput.key) || "").trim();
    const resolvedPromptInput =
      (Array.isArray(app && app.inputs) ? app.inputs : []).find((input) => String((input && input.key) || "") === resolvedPromptKey) ||
      promptInput;

    state.promptKey = resolvedPromptInput ? String(resolvedPromptInput.key || "") : "";
    state.promptLabel = resolvedPromptInput ? String(resolvedPromptInput.label || resolvedPromptInput.name || resolvedPromptInput.key || "") : "";
    state.promptValue = String((state.promptKey && modules.state.state.formValues[state.promptKey]) || "");
    state.availableImages = filledImages;

    if (!filledImages.some((item) => item.key === state.selectedImageKey)) {
      state.selectedImageKey = filledImages[0] ? filledImages[0].key : "";
      state.selectedImageMode = "single";
    }
  }

  function getAvailability(promptKey = "") {
    syncContextFromWorkspace(promptKey);
    if (!modules.state.state.currentApp) {
      return { available: false, reason: "请先在工作台选择一个应用。" };
    }
    if (!state.promptKey) {
      return { available: false, reason: "当前应用未检测到可写入的主提示词字段。" };
    }
    if (state.availableImages.length === 0) {
      return { available: false, reason: "请先在当前应用里导入至少一张图片，然后再打开 AI优化。" };
    }
    return { available: true, reason: "" };
  }

  async function loadImageElement(src) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("图片加载失败，无法拼接多图。"));
      image.src = src;
    });
  }

  async function composeImageAssets(entries) {
    const validEntries = (Array.isArray(entries) ? entries : []).filter((item) => item && hasImageAsset(item.asset));
    if (validEntries.length === 0) throw new Error("当前没有可拼接的图片。");
    if (validEntries.length === 1) return cloneValue(validEntries[0].asset);

    const images = await Promise.all(
      validEntries.map(async (item) => {
        const src = getImagePreviewSrc(item.asset);
        if (!src) throw new Error(`图片 ${item.label || item.key} 缺少预览源，无法拼接。`);
        return {
          image: await loadImageElement(src),
          label: item.label || item.key,
          asset: item.asset
        };
      })
    );

    const columnCount = images.length <= 2 ? images.length : 2;
    const rowCount = Math.ceil(images.length / columnCount);
    const cellSize = 512;
    const canvas = document.createElement("canvas");
    canvas.width = columnCount * cellSize;
    canvas.height = rowCount * cellSize;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("当前环境不支持图片拼接。");

    context.fillStyle = "#101720";
    context.fillRect(0, 0, canvas.width, canvas.height);

    images.forEach((item, index) => {
      const col = index % columnCount;
      const row = Math.floor(index / columnCount);
      const x = col * cellSize;
      const y = row * cellSize;
      const scale = Math.min(cellSize / item.image.width, cellSize / item.image.height);
      const width = Math.max(1, Math.round(item.image.width * scale));
      const height = Math.max(1, Math.round(item.image.height * scale));
      const offsetX = x + Math.round((cellSize - width) / 2);
      const offsetY = y + Math.round((cellSize - height) / 2);

      context.fillStyle = "#131c25";
      context.fillRect(x, y, cellSize, cellSize);
      context.drawImage(item.image, offsetX, offsetY, width, height);
      context.strokeStyle = "rgba(126, 154, 181, 0.6)";
      context.lineWidth = 4;
      context.strokeRect(x + 2, y + 2, cellSize - 4, cellSize - 4);
    });

    const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
    const base64 = dataUrl.includes(",") ? dataUrl.split(",")[1] : "";
    return {
      dataUrl,
      base64,
      mimeType: "image/jpeg",
      width: canvas.width,
      height: canvas.height,
      originalWidth: canvas.width,
      originalHeight: canvas.height,
      source: "ai-optimize-collage",
      kind: "collage-image"
    };
  }

  async function refreshSelectedImageAsset() {
    const currentComposeId = ++composeSequence;
    if (state.selectedImageMode === "composite" && state.availableImages.length > 1) {
      state.composingImage = true;
      state.imageKey = "composite";
      state.imageLabel = `拼接全部 ${state.availableImages.length} 张图`;
      renderModal();
      try {
        const composed = await composeImageAssets(state.availableImages);
        if (currentComposeId !== composeSequence) return;
        state.imageAsset = composed;
        state.composingImage = false;
        renderModal();
      } catch (error) {
        if (currentComposeId !== composeSequence) return;
        state.composingImage = false;
        state.imageAsset = null;
        setStatus(error.message || "多图拼接失败。", "error");
        renderModal();
      }
      return;
    }

    const selected = state.availableImages.find((item) => item.key === state.selectedImageKey) || state.availableImages[0] || null;
    state.imageKey = selected ? selected.key : "";
    state.imageLabel = selected ? selected.label : "";
    state.imageAsset = selected ? cloneValue(selected.asset) : null;
    state.composingImage = false;
    renderModal();
  }

  function buildUsageHint() {
    const imageCount = state.availableImages.length;
    if (imageCount <= 0) {
      return "请先回到工作台，在当前应用中导入图片并填写主提示词后，再打开这个窗口。";
    }
    if (imageCount === 1) {
      return "当前会使用这张已导入图片和“原始提示词”作为 AI优化输入。你可以在“附加优化要求”里补充希望强化的方向。";
    }
    return "当前应用里已检测到多张图片。你可以选择任意一张作为优化参考，或切换为“拼接全部图片”后再运行优化。";
  }

  function renderImagePicker() {
    const container = modules.runtime.getById("aiOptimizeImagePicker");
    const modeContainer = modules.runtime.getById("aiOptimizeImageMode");
    if (!container || !modeContainer) return;

    const canCompose = state.availableImages.length > 1;
    modeContainer.innerHTML = `
      <button class="mini-btn ${state.selectedImageMode === "single" ? "is-selected" : ""}" type="button" data-ai-opt-mode="single">单图</button>
      ${canCompose ? `<button class="mini-btn ${state.selectedImageMode === "composite" ? "is-selected" : ""}" type="button" data-ai-opt-mode="composite">拼接全部</button>` : ""}
    `;

    if (state.availableImages.length <= 1) {
      container.innerHTML = state.availableImages[0]
        ? `<div class="summary-strip">当前已检测到 1 张图片：${modules.runtime.escapeHtml(state.availableImages[0].label)}</div>`
        : `<div class="summary-strip">当前还没有可用图片。</div>`;
      return;
    }

    container.innerHTML = state.availableImages
      .map((item) => {
        const active = state.selectedImageMode === "single" && item.key === state.selectedImageKey;
        const sizeText = getAssetSizeLabel(item.asset);
        return `
          <button class="picker-item ${active ? "active" : ""}" type="button" data-ai-opt-image-key="${modules.runtime.escapeHtml(item.key)}">
            <span class="picker-item-title">${modules.runtime.escapeHtml(item.label)}</span>
            <span class="picker-item-meta">
              <span>${modules.runtime.escapeHtml(item.key)}</span>
              ${sizeText ? `<span>${modules.runtime.escapeHtml(sizeText)}</span>` : ""}
            </span>
          </button>
        `;
      })
      .join("");
  }

  function renderModal() {
    const previewImg = modules.runtime.getById("aiOptimizeImagePreview");
    const imageMeta = modules.runtime.getById("aiOptimizeImageMeta");
    const intro = modules.runtime.getById("aiOptimizeGuide");
    const promptInput = modules.runtime.getById("aiOptimizePromptInput");
    const extraInput = modules.runtime.getById("aiOptimizeExtraInput");
    const resultInput = modules.runtime.getById("aiOptimizeResultInput");
    const startButton = modules.runtime.getById("btnStartAiOptimize");
    const replaceButton = modules.runtime.getById("btnAiOptimizeReplace");
    const appendButton = modules.runtime.getById("btnAiOptimizeAppend");
    const modeHint = modules.runtime.getById("aiOptimizeImageModeHint");

    if (previewImg) {
      const src = getImagePreviewSrc(state.imageAsset);
      previewImg.src = src || "";
      previewImg.hidden = !src;
    }
    if (imageMeta) {
      imageMeta.textContent = state.composingImage
        ? "正在生成拼接预览..."
        : state.imageKey
          ? `${state.imageLabel || state.imageKey}${getAssetSizeLabel(state.imageAsset) ? ` · ${getAssetSizeLabel(state.imageAsset)}` : ""}`
          : "未检测到可用图片输入";
    }
    if (intro) intro.textContent = buildUsageHint();
    if (modeHint) {
      modeHint.textContent = state.selectedImageMode === "composite"
        ? "当前会把所有已输入图片拼接为一张，再作为 AI优化参考图。"
        : "当前会使用你选中的这张图作为 AI优化参考图。";
    }
    if (promptInput) promptInput.value = state.promptValue || "";
    if (extraInput) extraInput.value = state.extraRequirement || "";
    if (resultInput) resultInput.value = state.resultText || "";
    if (startButton) startButton.disabled = state.running || state.composingImage || !hasImageAsset(state.imageAsset);
    if (replaceButton) replaceButton.disabled = state.running || !String(state.resultText || "").trim();
    if (appendButton) appendButton.disabled = state.running || !String(state.resultText || "").trim();
    syncTaskTicker();
    renderImagePicker();
    renderTaskCard();
    setStatus(state.statusMessage, state.statusType);
  }

  function openModal(promptKey = "") {
    const availability = getAvailability(promptKey);
    if (!availability.available) {
      modules.ui.logToWorkspace(availability.reason, "warn");
      return false;
    }

    state.open = true;
    state.extraRequirement = "";
    state.resultText = "";
    state.running = false;
    state.taskId = "";
    state.taskStatus = "idle";
    state.taskDetail = "等待开始运行。";
    state.taskStartedAt = 0;
    state.taskUpdatedAt = 0;
    state.txtUrl = "";
    state.statusMessage = "点击“开始优化”后，这里会显示 AI 返回的优化提示词。";
    state.statusType = "info";
    modules.workspace.setModalOpen("aiOptimizeModal", true);
    void refreshSelectedImageAsset();
    return true;
  }

  function closeModal() {
    state.open = false;
    state.running = false;
    syncTaskTicker();
    modules.workspace.setModalOpen("aiOptimizeModal", false);
  }

  function bindModalEvents() {
    const promptInput = modules.runtime.getById("aiOptimizePromptInput");
    const extraInput = modules.runtime.getById("aiOptimizeExtraInput");
    const resultInput = modules.runtime.getById("aiOptimizeResultInput");
    const closeButton = modules.runtime.getById("aiOptimizeModalClose");
    const startButton = modules.runtime.getById("btnStartAiOptimize");
    const replaceButton = modules.runtime.getById("btnAiOptimizeReplace");
    const appendButton = modules.runtime.getById("btnAiOptimizeAppend");
    const imagePicker = modules.runtime.getById("aiOptimizeImagePicker");
    const imageMode = modules.runtime.getById("aiOptimizeImageMode");

    if (promptInput) {
      promptInput.addEventListener("input", () => {
        state.promptValue = promptInput.value || "";
      });
    }
    if (extraInput) {
      extraInput.addEventListener("input", () => {
        state.extraRequirement = extraInput.value || "";
      });
    }
    if (resultInput) {
      resultInput.addEventListener("input", () => {
        state.resultText = resultInput.value || "";
        renderModal();
      });
    }
    if (closeButton) {
      closeButton.addEventListener("click", closeModal);
    }
    if (imageMode) {
      imageMode.addEventListener("click", (event) => {
        const button = event.target && event.target.closest("[data-ai-opt-mode]");
        if (!button || state.running) return;
        const nextMode = String(button.getAttribute("data-ai-opt-mode") || "single");
        state.selectedImageMode = nextMode === "composite" ? "composite" : "single";
        void refreshSelectedImageAsset();
      });
    }
    if (imagePicker) {
      imagePicker.addEventListener("click", (event) => {
        const button = event.target && event.target.closest("[data-ai-opt-image-key]");
        if (!button || state.running) return;
        state.selectedImageMode = "single";
        state.selectedImageKey = String(button.getAttribute("data-ai-opt-image-key") || "");
        void refreshSelectedImageAsset();
      });
    }
    document.addEventListener("click", (event) => {
      if (event.target && event.target.closest("#aiOptimizeBackdrop")) {
        closeModal();
      }
    });
    if (startButton) {
      startButton.addEventListener("click", async () => {
        const availability = getAvailability(state.promptKey);
        if (!availability.available) {
          setStatus(availability.reason, "warn");
          renderModal();
          return;
        }
        if (!modules.runtime.isPluginRuntime()) {
          setStatus("浏览器预览模式下无法调用宿主执行 AI优化。", "warn");
          renderModal();
          return;
        }

        const apiKey = String(modules.state.state.settings.apiKey || "").trim();
        const aiOptimizeAppId = String(modules.state.state.settings.aiOptimizeAppId || modules.state.DEFAULT_AI_OPTIMIZE_APP_ID || "").trim();
        if (!apiKey) {
          setStatus("请先在设置页保存 RunningHub API Key。", "warn");
          renderModal();
          return;
        }
        if (!aiOptimizeAppId) {
          setStatus("当前未配置 AI优化应用 ID，请到设置页高级设置中填写。", "warn");
          renderModal();
          return;
        }
        if (!hasImageAsset(state.imageAsset)) {
          setStatus("当前没有可提交的参考图，请先选择图片。", "warn");
          renderModal();
          return;
        }

        state.running = true;
        state.resultText = "";
        state.taskId = "";
        state.taskStatus = "running";
        state.taskStartedAt = Date.now();
        state.taskUpdatedAt = state.taskStartedAt;
        state.taskDetail = "正在提交 AI优化任务...";
        state.txtUrl = "";
        setStatus("正在根据参考图、原始提示词和附加优化要求生成优化建议...", "pending");
        renderModal();
        try {
          const result = await modules.runtime.callHost("runninghub.runAiOptimize", [{
            apiKey,
            appId: aiOptimizeAppId,
            image: cloneValue(state.imageAsset),
            prompt: state.promptValue,
            extraRequirement: state.extraRequirement,
            settings: {
              pollInterval: modules.state.state.settings.pollInterval,
              timeout: modules.state.state.settings.timeout,
              maxConcurrentTasks: modules.state.state.settings.maxConcurrentTasks
            }
          }], { timeoutMs: Math.max(30000, Number(modules.state.state.settings.timeout || 180) * 1000 + 15000) });
          state.taskId = String((result && result.taskId) || "").trim();
          state.taskStatus = "success";
          state.taskUpdatedAt = Date.now();
          state.taskDetail = "任务已完成，已成功解析返回的 .txt 文本结果。";
          state.txtUrl = String((result && result.txtUrl) || "").trim();
          state.resultText = String((result && result.text) || "").trim();
          if (!state.resultText) {
            throw new Error("AI优化应用未返回有效文本结果。");
          }
          setStatus("AI优化完成。先检查结果，确认后再选择“替换当前”或“追加到当前”。", "success");
          modules.ui.logToWorkspace("AI优化完成，结果已加载到弹窗。", "success");
        } catch (error) {
          const message = error && error.message ? error.message : String(error || "AI优化失败");
          state.taskStatus = "error";
          state.taskUpdatedAt = Date.now();
          state.taskDetail = message;
          setStatus(message, "error");
          modules.ui.logToWorkspace(message, "error");
        } finally {
          state.running = false;
          renderModal();
        }
      });
    }

    function applyResult(mode) {
      const text = String(state.resultText || "").trim();
      if (!state.promptKey || !text) return;
      const currentValue = String(modules.state.state.formValues[state.promptKey] || "");
      const nextValue =
        mode === "append" && currentValue.trim()
          ? `${currentValue.replace(/\s+$/g, "")}\n\n${text}`
          : text;
      modules.state.state.formValues[state.promptKey] = nextValue;
      state.promptValue = nextValue;
      modules.workspace.renderWorkspace();
      modules.ui.logToWorkspace(mode === "append" ? "AI优化结果已追加到当前 prompt。" : "AI优化结果已替换当前 prompt。", "success");
      closeModal();
    }

    if (replaceButton) {
      replaceButton.addEventListener("click", () => applyResult("replace"));
    }
    if (appendButton) {
      appendButton.addEventListener("click", () => applyResult("append"));
    }
  }

  modules.aiOptimize = {
    getAvailability,
    getPrimaryPromptInput,
    openModal,
    closeModal,
    renderModal,
    bindModalEvents
  };
})(window);
