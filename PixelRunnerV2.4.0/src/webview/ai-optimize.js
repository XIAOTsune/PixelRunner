(function initAiOptimizeModule(global) {
  const modules = (global.PixelRunnerModules = global.PixelRunnerModules || {});
  const DEFAULT_UPLOAD_MAX_DIMENSION = 1536;
  const DEFAULT_UPLOAD_TARGET_BYTES = 9_000_000;
  const DEFAULT_UPLOAD_HARD_LIMIT_BYTES = 10_000_000;
  const DEFAULT_UPLOAD_QUALITY_STEPS = [0.92, 0.88, 0.84, 0.8, 0.76, 0.72, 0.68, 0.64, 0.6, 0.56, 0.52, 0.48];
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
    canceling: false,
    taskId: "",
    taskStatus: "idle",
    taskDetail: "等待开始运行。",
    taskStartedAt: 0,
    taskUpdatedAt: 0,
    balanceCharge: null,
    coinsCharge: null,
    chargeDisplay: "",
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
    if (normalized === "cancelled" || normalized === "canceled") return "已取消";
    if (normalized === "error") return "失败";
    return "待开始";
  }

  function getTaskStatusTone(status) {
    const normalized = String(status || "").trim().toLowerCase();
    if (normalized === "running") return "pending";
    if (normalized === "success") return "success";
    if (normalized === "cancelled" || normalized === "canceled") return "warn";
    if (normalized === "error") return "error";
    return "info";
  }

  function normalizeTaskChargeValue(value) {
    if (value == null) return null;
    if (typeof value === "number") return Number.isFinite(value) ? Math.abs(Number(value.toFixed(3))) : null;
    const text = String(value || "").trim();
    if (!text) return null;
    const matched = text.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
    if (!matched) return null;
    const parsed = Number(matched[0]);
    return Number.isFinite(parsed) ? Math.abs(Number(parsed.toFixed(3))) : null;
  }

  function formatTaskChargeDisplay() {
    const explicit = String(state.chargeDisplay || "").trim();
    if (explicit) return explicit;
    const balanceCharge = normalizeTaskChargeValue(state.balanceCharge);
    const coinsCharge = normalizeTaskChargeValue(state.coinsCharge);
    const parts = [];
    if (balanceCharge !== null) parts.push(`-${balanceCharge.toFixed(3)}R`);
    if (coinsCharge !== null) parts.push(Number.isInteger(coinsCharge) ? `-${coinsCharge}RH` : `-${coinsCharge.toFixed(3)}RH`);
    return parts.join(" · ");
  }

  function setTaskCharge(result) {
    state.balanceCharge = result && result.balanceCharge != null ? normalizeTaskChargeValue(result.balanceCharge) : null;
    state.coinsCharge = result && result.coinsCharge != null ? normalizeTaskChargeValue(result.coinsCharge) : null;
    state.chargeDisplay = String((result && result.chargeDisplay) || "").trim();
  }

  function formatElapsed(startedAt, updatedAt = Date.now()) {
    const diff = Math.max(0, Number(updatedAt || 0) - Number(startedAt || 0));
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const remainSeconds = seconds % 60;
    if (minutes <= 0) return `${remainSeconds}s`;
    return `${minutes}m ${remainSeconds}s`;
  }

  function looksLikeTxtUrl(value) {
    return /\.txt(?:$|[?#])/i.test(String(value || "").trim());
  }

  function looksLikeTxtName(value) {
    return /\.txt$/i.test(String(value || "").trim());
  }

  function collectTxtResultCandidates(payload, results = [], seen = new Set(), depth = 0) {
    if (!payload || depth > 6) return results;
    if (typeof payload === "string") {
      if (looksLikeTxtUrl(payload) && !seen.has(payload)) {
        seen.add(payload);
        results.push({ url: payload, fileName: "" });
      }
      return results;
    }
    if (Array.isArray(payload)) {
      payload.forEach((item) => collectTxtResultCandidates(item, results, seen, depth + 1));
      return results;
    }
    if (typeof payload !== "object") return results;

    const source = payload;
    const fileName = String(
      source.fileName || source.filename || source.name || source.title || source.label || source.key || ""
    ).trim();
    const directUrl = String(
      source.url || source.fileUrl || source.downloadUrl || source.download_url || source.resultUrl || source.textUrl || ""
    ).trim();

    if (directUrl && (looksLikeTxtUrl(directUrl) || looksLikeTxtName(fileName))) {
      const marker = `${directUrl}|${fileName}`;
      if (!seen.has(marker)) {
        seen.add(marker);
        results.push({ url: directUrl, fileName });
      }
    }

    Object.values(source).forEach((value) => {
      if (value && typeof value === "object") {
        collectTxtResultCandidates(value, results, seen, depth + 1);
        return;
      }
      if (typeof value === "string" && looksLikeTxtUrl(value) && !seen.has(value)) {
        seen.add(value);
        results.push({ url: value, fileName });
      }
    });

    return results;
  }

  function pickPreferredPromptInput(inputs) {
    const list = Array.isArray(inputs) ? inputs : [];
    const promptLike = list.filter((input) => {
      const hint = `${input && input.key ? input.key : ""} ${input && input.label ? input.label : ""} ${input && input.name ? input.name : ""}`.toLowerCase();
      return /prompt|positive/.test(hint) && !/negative/.test(hint);
    });
    if (promptLike.length === 0) return null;
    const priority = ["prompt", "positive_prompt"];
    for (const key of priority) {
      const matched = promptLike.find((input) => String((input && input.key) || "").trim().toLowerCase() === key);
      if (matched) return matched;
    }
    return promptLike[0];
  }

  function pickPreferredTextInput(inputs) {
    const list = Array.isArray(inputs) ? inputs : [];
    const promptInput = pickPreferredPromptInput(list);
    if (promptInput) return promptInput;
    return list.find((input) => !isImageInput(input)) || null;
  }

  function buildAiOptimizePromptText() {
    const basePrompt = String(state.promptValue || "").trim();
    const extraRequirement = String(state.extraRequirement || "").trim();
    const sections = [
      "请基于参考图和以下文本，优化为可直接用于图像生成或修图工作流的正向 prompt。",
      `【当前主 prompt】\n${basePrompt || "（未填写）"}`,
      `【附加优化要求】\n${extraRequirement || "无。"}`
    ];

    sections.push(`【输出要求】
1. 只输出优化后的 prompt 正文，不要输出解释、标题、Markdown 或编号。
2. 保留当前主 prompt 中明确的人物、主体、构图、风格、材质、色彩和限制条件。
3. 根据参考图补充清晰、可执行的画面细节，让结果适合直接提交给 RunningHub 图像工作流。
4. 不要编造与参考图或当前主 prompt 冲突的主体信息。`);

    return sections.join("\n\n");
  }

  function getBase64ByteLength(base64) {
    const text = String(base64 || "").trim();
    if (!text) return 0;
    const padding = text.endsWith("==") ? 2 : text.endsWith("=") ? 1 : 0;
    return Math.max(0, Math.floor((text.length * 3) / 4) - padding);
  }

  function getAssetUploadPayload(asset) {
    if (!asset || typeof asset !== "object") return null;
    const dataUrl = String(asset.uploadDataUrl || asset.dataUrl || "").trim();
    const base64 = String(asset.uploadBase64 || asset.base64 || "").trim();
    const mimeType = String(asset.uploadMimeType || asset.mimeType || "image/jpeg").trim() || "image/jpeg";
    if (!dataUrl && !base64 && !String(asset.url || "").trim()) return null;
    return {
      dataUrl,
      base64,
      url: String(asset.url || "").trim(),
      mimeType,
      width: Number(asset.originalWidth) || Number(asset.width) || null,
      height: Number(asset.originalHeight) || Number(asset.height) || null,
      bytes: Number(asset.uploadBytes) || getBase64ByteLength(base64),
      quality: Number(asset.uploadQuality) || null
    };
  }

  function getScaledDimensions(width, height, maxDimension) {
    const safeWidth = Math.max(1, Math.round(Number(width) || 1));
    const safeHeight = Math.max(1, Math.round(Number(height) || 1));
    const longEdge = Math.max(safeWidth, safeHeight);
    if (longEdge <= maxDimension) {
      return { width: safeWidth, height: safeHeight };
    }
    const scale = maxDimension / longEdge;
    return {
      width: Math.max(1, Math.round(safeWidth * scale)),
      height: Math.max(1, Math.round(safeHeight * scale))
    };
  }

  function canvasToBlob(canvas, quality) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error("AI优化图片压缩失败，请换一张图片或降低图片尺寸后重试。"));
          return;
        }
        resolve(blob);
      }, "image/jpeg", quality);
    });
  }

  function readBlobAsDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("AI优化图片读取失败，请重新导入图片后重试。"));
      reader.readAsDataURL(blob);
    });
  }

  async function buildCompressedUploadPayload(asset) {
    const src = getImagePreviewSrc(asset);
    if (!src) {
      throw new Error("当前参考图缺少可提交的数据，请重新导入图片。");
    }

    const image = await loadImageElement(src);
    const targetSize = getScaledDimensions(image.width, image.height, DEFAULT_UPLOAD_MAX_DIMENSION);
    const canvas = document.createElement("canvas");
    canvas.width = targetSize.width;
    canvas.height = targetSize.height;
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("浏览器无法创建图片压缩画布，请重启插件后重试。");
    }

    context.fillStyle = "#101720";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    let fallbackPayload = null;
    for (const quality of DEFAULT_UPLOAD_QUALITY_STEPS) {
      const blob = await canvasToBlob(canvas, quality);
      const dataUrl = await readBlobAsDataUrl(blob);
      const base64 = dataUrl.includes(",") ? dataUrl.split(",")[1] : "";
      const payload = {
        dataUrl,
        base64,
        url: "",
        mimeType: "image/jpeg",
        width: canvas.width,
        height: canvas.height,
        bytes: blob.size,
        quality: Math.round(quality * 100)
      };
      fallbackPayload = payload;
      if (blob.size <= DEFAULT_UPLOAD_TARGET_BYTES) {
        return payload;
      }
      if (blob.size <= DEFAULT_UPLOAD_HARD_LIMIT_BYTES) {
        fallbackPayload = payload;
      }
    }

    if (fallbackPayload) return fallbackPayload;
    throw new Error("AI优化参考图压缩后仍超过大小限制，请换一张更小的图片后重试。");
  }

  async function prepareImageForSubmission(asset) {
    const payload = getAssetUploadPayload(asset);
    if (payload && String((asset && asset.uploadDataUrl) || "").trim()) {
      return payload;
    }
    return payload && payload.bytes > 0 && payload.bytes <= DEFAULT_UPLOAD_HARD_LIMIT_BYTES
      ? payload
      : buildCompressedUploadPayload(asset);
  }

  async function resolveResultText(pollResult, timeoutSeconds) {
    const txtCandidates = collectTxtResultCandidates((pollResult && pollResult.result) || null);
    const txtCandidate = txtCandidates[0] || null;
    if (!txtCandidate || !txtCandidate.url) {
      throw new Error("AI优化应用未返回可解析的 .txt 文本结果，请检查工作流输出配置。");
    }

    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timeoutMs = Math.max(10000, Number(timeoutSeconds || 180) * 1000);
    const timer = controller ? global.setTimeout(() => controller.abort(), timeoutMs) : 0;
    try {
      const response = await fetch(txtCandidate.url, {
        method: "GET",
        signal: controller ? controller.signal : undefined
      });
      if (!response.ok) {
        throw new Error(`读取优化结果失败 (HTTP ${response.status})`);
      }
      const text = String(await response.text()).trim();
      if (!text) {
        throw new Error("AI优化应用返回的 .txt 结果为空。");
      }
      return {
        text,
        txtUrl: txtCandidate.url,
        txtFileName: txtCandidate.fileName || ""
      };
    } finally {
      if (timer) global.clearTimeout(timer);
    }
  }

  function updateWorkspacePromptHint(field, text) {
    if (!field || !modules.templates) return;
    const hint = field.querySelector(".prompt-length-hint");
    if (!hint) return;
    const value = String(text || "");
    const length = modules.templates.getTextLength(value);
    const tail = modules.templates.getTailPreview(value, 24);
    hint.textContent = `长度 ${length} 字符 | 末尾预览 ${tail}`;
    hint.classList.toggle("is-warning", length >= modules.templates.PROMPT_WARN_CHARS);
  }

  function syncPromptToWorkspace(value) {
    if (!state.promptKey) return;
    const nextValue = String(value ?? "");
    modules.state.state.formValues[state.promptKey] = nextValue;
    const container = modules.runtime.getById("dynamicInputContainer");
    if (!container) return;
    const target = Array.from(container.querySelectorAll("[data-form-key]")).find((element) => {
      return String(element.getAttribute("data-form-key") || "") === state.promptKey;
    });
    if (!target) return;
    if ("value" in target && target.value !== nextValue) {
      target.value = nextValue;
    }
    updateWorkspacePromptHint(target.closest(".prompt-field"), nextValue);
  }

  function renderTaskCard() {
    const container = modules.runtime.getById("aiOptimizeTaskCard");
    if (!container) return;
    const taskId = String(state.taskId || "").trim();
    const status = getTaskStatusLabel(state.taskStatus);
    const tone = getTaskStatusTone(state.taskStatus);
    const duration = state.taskStartedAt ? formatElapsed(state.taskStartedAt, state.taskUpdatedAt || Date.now()) : "--";
    const chargeDisplay = formatTaskChargeDisplay();
    const shortTaskId = taskId ? `#${taskId.slice(-8)}` : "尚未创建任务";
    const detail = modules.runtime.escapeHtml(state.taskDetail || "等待开始。");
    const showCancel = state.running && taskId;
    const showClear = !state.running && taskId;

    container.innerHTML = `
      <div class="running-task-item ai-optimize-task-item">
        <div class="running-task-main">
          <div class="running-task-topline">
            <div class="running-task-title">AI优化任务</div>
            <div class="running-task-topline-actions">
              <span class="status-chip running-task-status-chip" data-status="${modules.runtime.escapeHtml(tone)}">${modules.runtime.escapeHtml(status)}</span>
              ${
                showCancel
                  ? `<button id="btnCancelAiOptimizeTask" class="mini-btn running-task-inline-btn" type="button" ${state.canceling ? "disabled" : ""}>${state.canceling ? "取消中" : "取消"}</button>`
                  : showClear
                    ? `<button id="btnClearAiOptimizeTask" class="mini-btn running-task-inline-btn" type="button">清空</button>`
                    : ""
              }
            </div>
          </div>
          <div class="running-task-meta">${modules.runtime.escapeHtml(shortTaskId)} · 耗时 ${modules.runtime.escapeHtml(duration)}${chargeDisplay ? ` · ${modules.runtime.escapeHtml(chargeDisplay)}` : ""}</div>
          <div class="running-task-detail">${detail}</div>
        </div>
      </div>
    `;

    const cancelButton = modules.runtime.getById("btnCancelAiOptimizeTask");
    if (cancelButton) {
      cancelButton.addEventListener("click", () => {
        void cancelTask();
      });
    }

    const clearButton = modules.runtime.getById("btnClearAiOptimizeTask");
    if (clearButton) {
      clearButton.addEventListener("click", () => {
        state.taskId = "";
        state.taskStatus = "idle";
        state.taskDetail = "等待开始运行。";
        state.taskStartedAt = 0;
        state.taskUpdatedAt = 0;
        state.balanceCharge = null;
        state.coinsCharge = null;
        state.chargeDisplay = "";
        renderModal();
      });
    }
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

  function getErrorMessage(error, fallback = "AI优化失败，请稍后重试。") {
    const raw = String((error && error.message) || error || "").trim();
    if (!raw) return fallback;
    if (/runninghub api key is missing/i.test(raw)) return "请先在设置页保存 RunningHub API Key。";
    if (/runninghub app id is missing|ai optimize appid is missing/i.test(raw)) {
      return "当前未配置 AI优化应用 ID，请到设置页高级设置中填写。";
    }
    if (/ai optimize image is missing/i.test(raw)) return "当前没有可提交的参考图，请先选择图片。";
    if (/runninghub taskid is missing/i.test(raw)) return "RunningHub 未返回有效任务 ID，请稍后重试。";
    if (/task polling timed out/i.test(raw)) return "AI优化任务等待超时，请稍后在 RunningHub 查看任务状态或重试。";
    if (/runninghub task submission failed/i.test(raw)) return "RunningHub 任务提交失败，请检查 API Key、应用 ID 和网络状态。";
    return raw;
  }

  function isCancelMessage(message) {
    return /cancel|取消/i.test(String(message || ""));
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
      return { available: true, reason: "请先在当前应用里导入至少一张图片，然后再开始 AI优化。" };
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
    if (promptInput && promptInput.value !== String(state.promptValue || "")) promptInput.value = state.promptValue || "";
    if (extraInput && extraInput.value !== String(state.extraRequirement || "")) extraInput.value = state.extraRequirement || "";
    if (resultInput && resultInput.value !== String(state.resultText || "")) resultInput.value = state.resultText || "";
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
    state.canceling = false;
    state.taskId = "";
    state.taskStatus = "idle";
    state.taskDetail = "等待开始运行。";
    state.taskStartedAt = 0;
    state.taskUpdatedAt = 0;
    state.balanceCharge = null;
    state.coinsCharge = null;
    state.chargeDisplay = "";
    state.txtUrl = "";
    if (state.availableImages.length === 0) {
      state.statusMessage = "当前还没有检测到图片。可以先编辑提示词，导入图片后再开始优化。";
      state.statusType = "warn";
    } else if (String(state.promptValue || "").trim()) {
      state.statusMessage = "点击“开始优化”后，这里会显示 AI 返回的优化提示词。";
      state.statusType = "info";
    } else {
      state.statusMessage = "当前主 prompt 为空。请先填写原始提示词，或在弹窗中补齐后再开始优化。";
      state.statusType = "warn";
    }
    modules.workspace.setModalOpen("aiOptimizeModal", true);
    void refreshSelectedImageAsset();
    return true;
  }

  function closeModal() {
    state.open = false;
    state.running = false;
    state.canceling = false;
    syncTaskTicker();
    modules.workspace.setModalOpen("aiOptimizeModal", false);
  }

  async function cancelTask() {
    const taskId = String(state.taskId || "").trim();
    const apiKey = String(modules.state.state.settings.apiKey || "").trim();
    if (!state.running || !taskId || !apiKey || state.canceling) return;

    state.canceling = true;
    state.taskDetail = "正在取消 AI优化任务...";
    renderModal();
    try {
      await modules.runtime.callHost("runninghub.cancelTask", [{ apiKey, taskId }], { timeoutMs: 20000 });
      state.running = false;
      state.canceling = false;
      state.taskStatus = "cancelled";
      state.taskUpdatedAt = Date.now();
      state.taskDetail = "任务已取消。";
      setStatus("AI优化任务已取消。", "warn");
      modules.ui.logToWorkspace(`AI优化任务已取消：${taskId}`, "warn");
    } catch (error) {
      state.canceling = false;
      const message = getErrorMessage(error, "取消 AI优化任务失败");
      setStatus(message, "error");
      modules.ui.logToWorkspace(message, "error");
    } finally {
      renderModal();
    }
  }

  function applyResult(mode) {
    const text = String(state.resultText || "").trim();
    if (!state.promptKey) {
      setStatus("未找到可写回的主 prompt 字段，请重新打开 AI优化窗口。", "error");
      renderModal();
      return;
    }
    if (!text) {
      setStatus("当前还没有可写回的 AI优化结果。", "warn");
      renderModal();
      return;
    }
    const currentValue = String(modules.state.state.formValues[state.promptKey] || "");
    const nextValue =
      mode === "append" && currentValue.trim()
        ? `${currentValue.replace(/\s+$/g, "")}\n\n${text}`
        : text;
    modules.state.state.formValues[state.promptKey] = nextValue;
    state.promptValue = nextValue;
    syncPromptToWorkspace(nextValue);
    modules.workspace.renderWorkspace();
    modules.ui.logToWorkspace(mode === "append" ? "AI优化结果已追加到当前 prompt。" : "AI优化结果已替换当前 prompt。", "success");
    closeModal();
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
        const localPromptValue = promptInput ? promptInput.value : state.promptValue;
        const availability = getAvailability(state.promptKey);
        state.promptValue = String(localPromptValue || "");
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
        if (!String(state.promptValue || "").trim()) {
          setStatus("请先填写当前主 prompt，再开始 AI优化。", "warn");
          renderModal();
          return;
        }

        state.running = true;
        state.canceling = false;
        state.resultText = "";
        state.taskId = "";
        state.taskStatus = "running";
        state.taskStartedAt = Date.now();
        state.taskUpdatedAt = state.taskStartedAt;
        state.taskDetail = "正在提交 AI优化任务...";
        state.balanceCharge = null;
        state.coinsCharge = null;
        state.chargeDisplay = "";
        state.txtUrl = "";
        setStatus("正在根据参考图、原始提示词和附加优化要求生成优化建议...", "pending");
        renderModal();

        const settings = {
          pollInterval: modules.state.state.settings.pollInterval,
          timeout: modules.state.state.settings.timeout,
          maxConcurrentTasks: modules.state.state.settings.maxConcurrentTasks
        };

        try {
          const parsedApp = await modules.runtime.callHost("runninghub.parseApp", [{
            appId: aiOptimizeAppId,
            apiKey,
            preferredName: "AI优化"
          }], {
            timeoutMs: Math.max(30000, Number(modules.state.state.settings.timeout || 180) * 1000 + 15000)
          });

          const inputs = Array.isArray(parsedApp && parsedApp.inputs) ? parsedApp.inputs : [];
          const imageInput = inputs.find((input) => isImageInput(input));
          if (!imageInput) {
            throw new Error("AI优化应用未识别到图片输入项。");
          }
          const textInput = pickPreferredTextInput(inputs);
          if (!textInput) {
            throw new Error("AI优化应用未识别到可写入的提示词输入项。");
          }

          const submitPayload = {
            apiKey,
            appId: aiOptimizeAppId,
            appName: "AI优化",
            app: {
              id: `ai-optimize-${aiOptimizeAppId}`,
              appId: aiOptimizeAppId,
              name: "AI优化",
              inputs
            },
            inputs: {
              [imageInput.key]: await prepareImageForSubmission(state.imageAsset),
              [textInput.key]: buildAiOptimizePromptText()
            },
            settings
          };

          const submitResult = await modules.runtime.callHost("runninghub.submitTask", [submitPayload], {
            timeoutMs: Math.max(30000, Number(modules.state.state.settings.timeout || 180) * 1000 + 15000)
          });

          state.taskId = String((submitResult && submitResult.taskId) || "").trim();
          if (!state.taskId) {
            throw new Error("RunningHub 未返回有效任务 ID，请稍后重试。");
          }
          state.taskUpdatedAt = Date.now();
          state.taskDetail = "任务已提交，正在等待 RunningHub 返回结果。";
          renderModal();

          const pollResult = await modules.runtime.callHost("runninghub.pollTask", [{
            apiKey,
            taskId: state.taskId,
            settings
          }], {
            timeoutMs: Math.max(30000, Number(modules.state.state.settings.timeout || 180) * 1000 + 15000)
          });

          if (!pollResult || pollResult.failed) {
            throw new Error(String((pollResult && pollResult.message) || "AI优化任务执行失败"));
          }
          if (pollResult && pollResult.timedOut) {
            throw new Error(String((pollResult && pollResult.message) || "AI优化任务超时"));
          }

          const result = await resolveResultText(pollResult, modules.state.state.settings.timeout);

          state.taskStatus = "success";
          state.taskUpdatedAt = Date.now();
          state.taskDetail = "任务已完成，已成功解析返回的 .txt 文本结果。";
          setTaskCharge(pollResult);
          state.txtUrl = String((result && result.txtUrl) || "").trim();
          state.resultText = String((result && result.text) || "").trim();
          if (!state.resultText) {
            throw new Error("AI优化应用未返回有效文本结果。");
          }
          setStatus("AI优化完成。先检查结果，确认后再选择“替换当前”或“追加到当前”。", "success");
          modules.ui.logToWorkspace("AI优化完成，结果已加载到弹窗。", "success");
        } catch (error) {
          const message = getErrorMessage(error);
          const cancelled = isCancelMessage(message);
          state.taskStatus = cancelled ? "cancelled" : "error";
          state.taskUpdatedAt = Date.now();
          state.taskDetail = cancelled ? "任务已取消。" : message;
          setStatus(cancelled ? "AI优化任务已取消。" : message, cancelled ? "warn" : "error");
          modules.ui.logToWorkspace(cancelled ? "AI优化任务已取消。" : message, cancelled ? "warn" : "error");
        } finally {
          state.running = false;
          state.canceling = false;
          renderModal();
        }
      });
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
    isOpen() {
      return state.open;
    },
    handleWorkspacePromptChange(promptKey, value) {
      if (!state.open || !state.promptKey || String(promptKey || "") !== String(state.promptKey || "")) return;
      state.promptValue = String(value ?? "");
      renderModal();
    },
    openModal,
    closeModal,
    renderModal,
    bindModalEvents
  };
})(window);
