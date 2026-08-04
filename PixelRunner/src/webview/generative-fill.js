(function initGenerativeFillModule(global) {
  const modules = (global.PixelRunnerModules = global.PixelRunnerModules || {});
  const DEFAULT_CONTEXT_EXPANSION = 128;
  const DEFAULT_MASK_EXPANSION = 4;
  const DEFAULT_FEATHER = 36;
  const FEATHER_BLUR_PASSES = 3;
  const FEATHER_CONTEXT_SAFETY_PIXELS = 2;
  const FEATHER_ALPHA_CURVE = Uint8ClampedArray.from({ length: 256 }, (_, value) => {
    const normalized = value / 255;
    const flattened = 0.5 + Math.asin(normalized * 2 - 1) / Math.PI;
    return Math.round(flattened * 255);
  });
  let submissionInFlight = false;
  let captureInFlight = null;
  let taskTimerHandle = 0;

  function getState() {
    return modules.state.state.generativeFill;
  }

  function getConfiguredAppId() {
    return String(modules.state.state.settings.generativeFillAppId || "").trim();
  }

  function getConfiguredSource() {
    return modules.state.normalizeGenerativeFillSource(
      modules.state.state.settings.generativeFillSource
    );
  }

  function getThirdPartyAvailability() {
    const descriptor = modules.state.getThirdPartyProviderDescriptor();
    const apiKey = String(descriptor.config && descriptor.config.apiKey || "").trim();
    const model = String(descriptor.config && descriptor.config.selectedModel || "").trim();
    return {
      available: Boolean(apiKey && model),
      descriptor,
      message: !apiKey
        ? `请先到设置页的“第三方支持”中配置 ${descriptor.label} API Key`
        : !model
          ? `请先到设置页的“第三方支持”中选择 ${descriptor.label} 生图模型`
          : ""
    };
  }

  function buildThirdPartyGenerativeFillPrompt(promptText) {
    const request = String(promptText || "").trim();
    return [
      "Edit the first image using the second image as a grayscale mask.",
      "Generate only inside the white mask area; preserve every pixel outside the mask.",
      "Keep the original composition, perspective, lighting, and canvas aspect ratio.",
      `Requested edit: ${request}`
    ].join("\n");
  }

  function getConfiguredFeather() {
    return Math.max(0, Math.min(128, Math.floor(numberOrDefault(
      modules.state.state.settings.generativeFillFeather,
      DEFAULT_FEATHER
    ))));
  }

  function getConfiguredContextExpansion() {
    return Math.max(0, Math.min(2048, Math.floor(numberOrDefault(
      modules.state.state.settings.generativeFillContextExpansion,
      DEFAULT_CONTEXT_EXPANSION
    ))));
  }

  function getConfiguredMaskExpansion() {
    return Math.max(0, Math.min(128, Math.floor(numberOrDefault(
      modules.state.state.settings.generativeFillMaskExpansion,
      DEFAULT_MASK_EXPANSION
    ))));
  }

  function numberOrDefault(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function cloneBounds(bounds) {
    if (!bounds || typeof bounds !== "object") return null;
    const values = ["left", "top", "right", "bottom"].map((key) => Number(bounds[key]));
    if (!values.every(Number.isFinite) || values[2] <= values[0] || values[3] <= values[1]) return null;
    return { left: values[0], top: values[1], right: values[2], bottom: values[3] };
  }

  function getCaptureContextPadding(contextExpansion, maskExpansion, feather) {
    const requestedPadding = Math.max(0, Number(contextExpansion) || 0);
    const safeFeather = Math.max(0, Number(feather) || 0);
    const maskSafetyPadding = Math.max(0, Number(maskExpansion) || 0) +
      (safeFeather > 0 ? Math.ceil(safeFeather) + FEATHER_CONTEXT_SAFETY_PIXELS : 0);
    return Math.max(requestedPadding, maskSafetyPadding);
  }

  function formatBounds(bounds) {
    const safe = cloneBounds(bounds);
    if (!safe) return "未捕获选区";
    return `${Math.round(safe.right - safe.left)} x ${Math.round(safe.bottom - safe.top)}`;
  }

  function getImageInputs(inputs) {
    return (Array.isArray(inputs) ? inputs : []).filter((input) => {
      const marker = String(`${input && input.type || ""} ${input && input.fieldName || ""}`).toLowerCase();
      return marker.includes("image") || marker.includes("img") || marker.includes("file");
    });
  }

  function getInputMarker(input) {
    return String(`${input && input.key || ""} ${input && input.label || ""} ${input && input.name || ""} ${input && input.fieldName || ""}`).toLowerCase();
  }

  function isMaskInput(input) {
    return /(mask|蒙版|遮罩|填充区域|inpaint|control)/i.test(getInputMarker(input));
  }

  function isPromptInput(input) {
    if (modules.state.isPromptLikeInput(input)) return true;
    return /(prompt|提示词|描述|text|positive)/i.test(getInputMarker(input));
  }

  function getPromptScore(input, index) {
    const marker = getInputMarker(input);
    let score = isPromptInput(input) ? 40 : 0;
    if (/(main|primary|positive|正向|主提示词|提示词)/i.test(marker)) score += 40;
    if (/(negative|负向|反向)/i.test(marker)) score -= 100;
    if (input && input.required) score += 4;
    return score - index * 0.01;
  }

  function resolveSchemaInputs(schema) {
    const inputs = Array.isArray(schema && schema.inputs) ? schema.inputs : [];
    const imageInputs = getImageInputs(inputs);
    const sourceImage = imageInputs.find((input) => !isMaskInput(input)) || imageInputs[0] || null;
    const maskImage = imageInputs.find((input) => isMaskInput(input)) || null;
    const prompt = inputs
      .map((input, index) => ({ input, score: getPromptScore(input, index) }))
      .filter((item) => item.score > 0)
      .sort((left, right) => right.score - left.score)[0]?.input || null;
    return { inputs, sourceImage, maskImage, prompt };
  }

  function parseDataUrl(dataUrl) {
    const match = String(dataUrl || "").match(/^data:([^;,]+)?;base64,(.+)$/i);
    return match
      ? { mimeType: String(match[1] || "image/png"), base64: String(match[2] || "") }
      : { mimeType: "image/png", base64: "" };
  }

  function loadImage(dataUrl) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("选区蒙版无法读取"));
      image.src = dataUrl;
    });
  }

  function dilateAlphaMask(source, width, height, radius) {
    const safeRadius = Math.max(0, Math.min(Math.max(width, height), Math.round(Number(radius) || 0)));
    if (!safeRadius) return source;

    const horizontal = new Uint8ClampedArray(source.length);
    const output = new Uint8ClampedArray(source.length);
    const deque = new Int32Array(Math.max(width, height));

    for (let y = 0; y < height; y += 1) {
      const rowOffset = y * width;
      let head = 0;
      let tail = 0;
      let addIndex = 0;
      for (let x = 0; x < width; x += 1) {
        const addUntil = Math.min(width - 1, x + safeRadius);
        while (addIndex <= addUntil) {
          const value = source[rowOffset + addIndex];
          while (tail > head && source[rowOffset + deque[tail - 1]] <= value) tail -= 1;
          deque[tail] = addIndex;
          tail += 1;
          addIndex += 1;
        }
        const keepFrom = x - safeRadius;
        while (tail > head && deque[head] < keepFrom) head += 1;
        horizontal[rowOffset + x] = source[rowOffset + deque[head]];
      }
    }

    for (let x = 0; x < width; x += 1) {
      let head = 0;
      let tail = 0;
      let addIndex = 0;
      for (let y = 0; y < height; y += 1) {
        const addUntil = Math.min(height - 1, y + safeRadius);
        while (addIndex <= addUntil) {
          const value = horizontal[addIndex * width + x];
          while (tail > head && horizontal[deque[tail - 1] * width + x] <= value) tail -= 1;
          deque[tail] = addIndex;
          tail += 1;
          addIndex += 1;
        }
        const keepFrom = y - safeRadius;
        while (tail > head && deque[head] < keepFrom) head += 1;
        output[y * width + x] = horizontal[deque[head] * width + x];
      }
    }

    return output;
  }

  function boxBlurAlphaMask(source, width, height, radius) {
    const safeRadius = Math.max(0, Math.min(Math.max(width, height), Math.round(Number(radius) || 0)));
    if (!safeRadius) return new Uint8ClampedArray(source);

    const horizontal = new Uint8ClampedArray(source.length);
    const output = new Uint8ClampedArray(source.length);
    const windowSize = safeRadius * 2 + 1;

    for (let y = 0; y < height; y += 1) {
      const rowOffset = y * width;
      let sum = 0;
      for (let x = 0; x <= safeRadius && x < width; x += 1) sum += source[rowOffset + x];
      for (let x = 0; x < width; x += 1) {
        horizontal[rowOffset + x] = Math.round(sum / windowSize);
        const removeIndex = x - safeRadius;
        const addIndex = x + safeRadius + 1;
        if (removeIndex >= 0) sum -= source[rowOffset + removeIndex];
        if (addIndex < width) sum += source[rowOffset + addIndex];
      }
    }

    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      for (let y = 0; y <= safeRadius && y < height; y += 1) sum += horizontal[y * width + x];
      for (let y = 0; y < height; y += 1) {
        output[y * width + x] = Math.round(sum / windowSize);
        const removeIndex = y - safeRadius;
        const addIndex = y + safeRadius + 1;
        if (removeIndex >= 0) sum -= horizontal[removeIndex * width + x];
        if (addIndex < height) sum += horizontal[addIndex * width + x];
      }
    }

    return output;
  }

  function buildFeatheredAlpha(source, width, height, radius) {
    const safeRadius = Math.max(0, Number(radius) || 0);
    if (!safeRadius) return new Uint8ClampedArray(source);
    const passRadius = Math.max(1, Math.ceil(safeRadius / FEATHER_BLUR_PASSES));
    let blurred = new Uint8ClampedArray(source);
    for (let pass = 0; pass < FEATHER_BLUR_PASSES; pass += 1) {
      blurred = boxBlurAlphaMask(blurred, width, height, passRadius);
    }
    return blurred;
  }

  function buildOutwardFeatherAlpha(source, width, height, radius) {
    const safeRadius = Math.max(0, Number(radius) || 0);
    if (!safeRadius) return new Uint8ClampedArray(source);

    // Center the blur outside the protected edge, then flatten its S-curve into a broader transition.
    const preExpansion = Math.max(1, Math.ceil(safeRadius / 2));
    const expanded = dilateAlphaMask(source, width, height, preExpansion);
    const blurred = buildFeatheredAlpha(expanded, width, height, preExpansion);
    const output = new Uint8ClampedArray(source.length);
    for (let index = 0; index < output.length; index += 1) {
      output[index] = Math.max(source[index], FEATHER_ALPHA_CURVE[blurred[index]]);
    }
    return output;
  }

  async function buildMaskVariants(selection) {
    const rawMask = selection && selection.maskAsset && selection.maskAsset.dataUrl ? selection.maskAsset : null;
    if (!rawMask || !rawMask.dataUrl) {
      throw new Error("Photoshop 未返回不规则选区蒙版，已停止生成以避免使用矩形选区");
    }

    const width = Math.max(1, Number(selection.asset.uploadWidth || rawMask.width || 1));
    const height = Math.max(1, Number(selection.asset.uploadHeight || rawMask.height || 1));
    const image = await loadImage(rawMask.dataUrl);
    const sourceCanvas = document.createElement("canvas");
    sourceCanvas.width = width;
    sourceCanvas.height = height;
    const sourceContext = sourceCanvas.getContext("2d", { willReadFrequently: true });
    if (!sourceContext) return { apiMask: rawMask, placementMask: rawMask, shape: rawMask.shape || "unknown" };
    const maskSourceBounds = cloneBounds(rawMask.sourceBounds);
    const contextBounds = cloneBounds(selection.contextBounds);
    if (maskSourceBounds && contextBounds) {
      const contextWidth = Math.max(1, contextBounds.right - contextBounds.left);
      const contextHeight = Math.max(1, contextBounds.bottom - contextBounds.top);
      const scaleX = width / contextWidth;
      const scaleY = height / contextHeight;
      sourceContext.drawImage(
        image,
        (maskSourceBounds.left - contextBounds.left) * scaleX,
        (maskSourceBounds.top - contextBounds.top) * scaleY,
        Math.max(1, (maskSourceBounds.right - maskSourceBounds.left) * scaleX),
        Math.max(1, (maskSourceBounds.bottom - maskSourceBounds.top) * scaleY)
      );
    } else {
      sourceContext.drawImage(image, 0, 0, width, height);
    }
    const sourceData = sourceContext.getImageData(0, 0, width, height);

    const alphaMask = new Uint8ClampedArray(width * height);
    for (let index = 0; index < sourceData.data.length; index += 4) {
      const luminance = Math.max(sourceData.data[index], sourceData.data[index + 1], sourceData.data[index + 2]);
      alphaMask[index / 4] = Math.min(luminance, sourceData.data[index + 3]);
    }

    const scale = Math.min(
      width / Math.max(1, selection.contextBounds.right - selection.contextBounds.left),
      height / Math.max(1, selection.contextBounds.bottom - selection.contextBounds.top)
    );
    const expansion = Math.max(0, numberOrDefault(selection && selection.maskExpansion, getConfiguredMaskExpansion())) * scale;
    const feather = Math.max(0, numberOrDefault(selection && selection.feather, getConfiguredFeather())) * scale;
    const expandedAlpha = dilateAlphaMask(alphaMask, width, height, expansion);
    const featheredAlpha = buildOutwardFeatherAlpha(expandedAlpha, width, height, feather);
    const apiCanvas = document.createElement("canvas");
    apiCanvas.width = width;
    apiCanvas.height = height;
    const apiContext = apiCanvas.getContext("2d");
    const apiData = apiContext.createImageData(width, height);
    const placementCanvas = document.createElement("canvas");
    placementCanvas.width = width;
    placementCanvas.height = height;
    const placementContext = placementCanvas.getContext("2d");
    const placementData = placementContext.createImageData(width, height);
    for (let index = 0; index < featheredAlpha.length; index += 1) {
      const dataIndex = index * 4;
      const alpha = featheredAlpha[index];
      apiData.data[dataIndex] = alpha;
      apiData.data[dataIndex + 1] = alpha;
      apiData.data[dataIndex + 2] = alpha;
      apiData.data[dataIndex + 3] = 255;
      placementData.data[dataIndex] = 255;
      placementData.data[dataIndex + 1] = 255;
      placementData.data[dataIndex + 2] = 255;
      placementData.data[dataIndex + 3] = alpha;
    }
    apiContext.putImageData(apiData, 0, 0);
    placementContext.putImageData(placementData, 0, 0);
    const apiDataUrl = apiCanvas.toDataURL("image/png");
    const placementDataUrl = placementCanvas.toDataURL("image/png");
    const apiParsed = parseDataUrl(apiDataUrl);
    const placementParsed = parseDataUrl(placementDataUrl);
    return {
      shape: rawMask.shape || "unknown",
      apiMask: { dataUrl: apiDataUrl, ...apiParsed, width, height, shape: rawMask.shape || "unknown" },
      placementMask: { dataUrl: placementDataUrl, ...placementParsed, width, height, shape: rawMask.shape || "unknown" }
    };
  }

  function buildImageValue(asset) {
    if (!asset) return null;
    return {
      dataUrl: String(asset.uploadDataUrl || asset.dataUrl || ""),
      base64: String(asset.uploadBase64 || asset.base64 || ""),
      mimeType: String(asset.uploadMimeType || asset.mimeType || "image/jpeg"),
      width: Number(asset.uploadWidth || asset.width) || null,
      height: Number(asset.uploadHeight || asset.height) || null
    };
  }

  function getGenerativeFillTasks() {
    const tasks = Array.isArray(modules.state.state.runningTasks) ? modules.state.state.runningTasks : [];
    return tasks
      .filter((task) => task && task.kind === "generative-fill")
      .sort((left, right) => Number(right.createdAt || right.submittedAt || 0) - Number(left.createdAt || left.submittedAt || 0));
  }

  function isTerminalTaskStatus(status) {
    return ["succeeded", "success", "done", "failed", "error", "cancelled", "canceled", "timeout"].includes(String(status || "").trim().toLowerCase());
  }

  function getTaskStatusLabel(status) {
    const normalized = String(status || "").trim().toLowerCase();
    if (normalized === "queued") return "排队中";
    if (normalized === "submitting") return "提交中";
    if (normalized === "submitted") return "已提交";
    if (["running", "remote-running"].includes(normalized)) return "运行中";
    if (normalized === "tracking") return "后台追踪";
    if (normalized === "downloading") return "下载中";
    if (normalized === "placing") return "回贴中";
    if (["succeeded", "success", "done"].includes(normalized)) return "已完成";
    if (["failed", "error"].includes(normalized)) return "失败";
    if (["cancelled", "canceled"].includes(normalized)) return "已取消";
    if (normalized === "timeout") return "已超时";
    return normalized || "运行中";
  }

  function getTaskStatusTone(status) {
    const normalized = String(status || "").trim().toLowerCase();
    if (["succeeded", "success", "done"].includes(normalized)) return "success";
    if (["failed", "error", "timeout"].includes(normalized)) return "error";
    if (["cancelled", "canceled"].includes(normalized)) return "warn";
    return "info";
  }

  function formatTaskDuration(milliseconds) {
    const totalSeconds = Math.max(0, Math.floor((Number(milliseconds) || 0) / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  function getTaskElapsedMs(task, now = Date.now()) {
    const startedAt = Number(task && (task.submittedAt || task.createdAt || 0));
    if (!startedAt) return 0;
    const endedAt = Number(task && task.finishedAt) || (isTerminalTaskStatus(task && task.status) ? Number(task && task.updatedAt) || now : now);
    return Math.max(0, endedAt - startedAt);
  }

  function updateTaskTimers() {
    const surface = modules.runtime.getById("generativeFillSurface");
    if (!surface || surface.hidden || modules.state.state.workspaceMode !== "generative-fill") return;
    const now = Date.now();
    surface.querySelectorAll("[data-generative-fill-timer]").forEach((element) => {
      const startedAt = Number(element.getAttribute("data-started-at")) || 0;
      const endedAt = Number(element.getAttribute("data-ended-at")) || 0;
      if (!startedAt) return;
      element.textContent = formatTaskDuration((endedAt || now) - startedAt);
    });
  }

  function syncTaskTimer(tasks) {
    const hasActiveTask = tasks.some((task) => !isTerminalTaskStatus(task.status));
    if (hasActiveTask && !taskTimerHandle) {
      taskTimerHandle = window.setInterval(updateTaskTimers, 1000);
    } else if (!hasActiveTask && taskTimerHandle) {
      window.clearInterval(taskTimerHandle);
      taskTimerHandle = 0;
    }
  }

  function renderTaskList(tasks) {
    if (tasks.length === 0) return '<div class="generative-fill-task-empty">运行后的任务会显示在这里，可继续提交多个选区。</div>';
    return tasks.map((task, index) => {
      const taskId = String(task.taskId || "").trim();
      const escapedTaskId = modules.runtime.escapeHtml(taskId);
      const status = String(task.status || "running").trim().toLowerCase();
      const terminal = isTerminalTaskStatus(status);
      const startedAt = Number(task.submittedAt || task.createdAt || 0);
      const endedAt = Number(task.finishedAt || 0) || (terminal ? Number(task.updatedAt || 0) : 0);
      const prompt = String(task.sourceDocument && task.sourceDocument.generativeFillPrompt || "").trim();
      const detail = String(task.detail || "").trim();
      const summary = prompt || detail || `创成式填充任务 ${index + 1}`;
      const action = terminal ? "delete-running-task" : "cancel-running-task";
      const actionLabel = terminal ? "删除" : "取消";
      return `
        <div class="generative-fill-task" data-status="${modules.runtime.escapeHtml(getTaskStatusTone(status))}">
          <div class="generative-fill-task-main">
            <div class="generative-fill-task-topline">
              <span class="generative-fill-task-summary" title="${modules.runtime.escapeHtml(summary)}">${modules.runtime.escapeHtml(summary)}</span>
              <span class="generative-fill-task-status">${modules.runtime.escapeHtml(getTaskStatusLabel(status))}</span>
            </div>
            <div class="generative-fill-task-meta"><span>${taskId ? `#${modules.runtime.escapeHtml(taskId.slice(-8))}` : "等待任务 ID"}</span><span>${terminal ? "耗时" : "计时"} <b data-generative-fill-timer data-started-at="${startedAt}" data-ended-at="${endedAt}">${formatTaskDuration(getTaskElapsedMs(task))}</b></span></div>
          </div>
          ${taskId ? `<button class="generative-fill-task-action" type="button" data-action="${action}" data-task-id="${escapedTaskId}">${actionLabel}</button>` : ""}
        </div>`;
    }).join("");
  }

  function setStatus(status, message) {
    const state = getState();
    state.status = String(status || "idle");
    state.statusMessage = String(message || "");
    render();
  }

  async function cleanupSelectionSnapshot(selection) {
    const channelName = String(selection && selection.selectionSnapshotChannelName || "").trim();
    const documentId = Number(selection && selection.documentId) || 0;
    if (!channelName || !(documentId > 0) || !modules.runtime.isPluginRuntime()) return false;
    try {
      await modules.runtime.callHost(
        "photoshop.deleteSelectionSnapshot",
        [{ documentId, selectionSnapshotChannelName: channelName }],
        { timeoutMs: 15000 }
      );
      return true;
    } catch (_) {
      return false;
    }
  }

  async function loadSchema() {
    const state = getState();
    const appId = getConfiguredAppId();
    if (!appId) throw new Error("请先在设置页的创成式填充设置中填写应用 ID");
    if (state.schema && state.schemaLoadedForAppId === appId) return state.schema;
    if (!modules.runtime.isPluginRuntime()) {
      state.schema = {
        appId,
        name: "创成式填充",
        inputs: [
          { key: "image", label: "主图", type: "image", required: true },
          { key: "mask", label: "蒙版", type: "image", required: false },
          { key: "prompt", label: "提示词", type: "textarea", required: true }
        ]
      };
      state.schemaLoadedForAppId = appId;
      return state.schema;
    }

    const apiKey = String(modules.state.state.settings.apiKey || "").trim();
    if (!apiKey) throw new Error("请先在设置页保存 RunningHub API Key");
    setStatus("schema", "正在读取创成式填充应用输入结构...");
    const parsed = await modules.runtime.callHost(
      "runninghub.parseApp",
      [{ appId, apiKey, preferredName: "创成式填充", region: modules.state.state.settings.runningHubRegion }],
      { timeoutMs: 45000 }
    );
    if (!parsed || !Array.isArray(parsed.inputs) || parsed.inputs.length === 0) {
      throw new Error("创成式填充应用没有返回可用的输入结构");
    }
    state.schema = parsed;
    state.schemaLoadedForAppId = appId;
    return parsed;
  }

  async function captureSelectionInternal() {
    const state = getState();
    if (!modules.runtime.isPluginRuntime()) throw new Error("浏览器预览模式下无法捕获 Photoshop 选区");
    const docInfo = await modules.workspace.refreshPhotoshopDocumentStatus({ quiet: true });
    const selectionBounds = cloneBounds(docInfo && docInfo.selectionBounds);
    if (!docInfo || !docInfo.hasActiveDocument) throw new Error("请先打开 Photoshop 文档");
    if (!selectionBounds) throw new Error("请先在 Photoshop 中框选要生成的区域");

    const contextExpansion = getConfiguredContextExpansion();
    const maskExpansion = getConfiguredMaskExpansion();
    const feather = getConfiguredFeather();
    const selectionPadding = getCaptureContextPadding(
      contextExpansion,
      maskExpansion,
      feather
    );
    const captureMessage = selectionPadding > contextExpansion
      ? `正在捕获选区及周围 ${selectionPadding}px 上下文（已为向外羽化预留安全边距）...`
      : `正在捕获选区及周围 ${selectionPadding}px 上下文...`;
    setStatus("capturing", captureMessage);
    const captured = await modules.runtime.callHost(
      "photoshop.captureDocumentPreview",
      [{
        maxDimension: 1536,
        maxPixels: 2000000,
        quality: 90,
        selectionPadding,
        captureSelectionMask: true,
        generativeFillCapture: true,
        expectedDocumentId: Number(docInfo.documentId) || 0,
        expectedSelectionBounds: selectionBounds
      }],
      { timeoutMs: 120000 }
    );
    if (!captured || !captured.uploadDataUrl) throw new Error("Photoshop 未返回可上传的上下文图像");
    if (!captured.selectionMaskDataUrl) {
      const maskError = String(captured.selectionMaskError || "").trim();
      throw new Error(
        maskError
          ? `Photoshop 未能读取不规则选区蒙版：${maskError}`
          : "Photoshop 未能读取不规则选区蒙版，请重新建立选区后再试"
      );
    }

    const selection = {
      documentId: Number(docInfo.documentId) || 0,
      documentTitle: String(docInfo.title || "Untitled"),
      selectionBounds,
      contextBounds: cloneBounds(captured.contextBounds) || selectionBounds,
      selectionPadding,
      requestedContextExpansion: contextExpansion,
      maskExpansion,
      feather,
      selectionSnapshotChannelName: String(captured.selectionSnapshotChannelName || ""),
      capturedAt: Date.now(),
      asset: captured,
      maskAsset: captured.selectionMaskDataUrl
        ? {
            dataUrl: captured.selectionMaskDataUrl,
            ...parseDataUrl(captured.selectionMaskDataUrl),
            width: Number(captured.selectionMaskWidth) || Number(captured.uploadWidth) || null,
            height: Number(captured.selectionMaskHeight) || Number(captured.uploadHeight) || null,
            sourceBounds: cloneBounds(captured.selectionMaskBounds),
            shape: String(captured.selectionMaskShape || "selection-channel")
          }
        : null
    };
    state.selection = selection;
    modules.ui.logToWorkspace(
      `创成式填充已捕获选区：${formatBounds(selectionBounds)}，上下文扩展 ${selectionPadding}px，向外羽化 ${feather}px。`,
      "success"
    );
    return selection;
  }

  function captureSelection() {
    if (captureInFlight) return captureInFlight;
    if (modules.workspace && typeof modules.workspace.pauseAutoPlacementRetry === "function") {
      modules.workspace.pauseAutoPlacementRetry();
    }
    const operation = captureSelectionInternal();
    captureInFlight = operation;
    void operation.then(
      () => {
        if (captureInFlight === operation) captureInFlight = null;
        if (modules.workspace && typeof modules.workspace.resumeAutoPlacementRetry === "function") {
          modules.workspace.resumeAutoPlacementRetry();
        }
      },
      () => {
        if (captureInFlight === operation) captureInFlight = null;
        if (modules.workspace && typeof modules.workspace.resumeAutoPlacementRetry === "function") {
          modules.workspace.resumeAutoPlacementRetry();
        }
      }
    );
    return operation;
  }

  async function buildPayload(schema, selection, promptText) {
    const roles = resolveSchemaInputs(schema);
    if (!roles.sourceImage) throw new Error("创成式填充应用没有识别到主图输入");
    if (!roles.prompt) throw new Error("创成式填充应用没有识别到提示词输入");

    const sourceImage = buildImageValue(selection.asset);
    const maskVariants = await buildMaskVariants(selection);
    const maskAsset = maskVariants.apiMask;
    const values = {
      ...modules.state.buildDefaultFormValues({ inputs: roles.inputs }),
      [String(roles.sourceImage.key)]: sourceImage,
      [String(roles.prompt.key)]: String(promptText || "").trim()
    };
    if (roles.maskImage && maskAsset) values[String(roles.maskImage.key)] = buildImageValue(maskAsset);

    const currentAppId = getConfiguredAppId();
    return {
      kind: "generative-fill",
      appId: currentAppId,
      appName: "创成式填充",
      app: {
        id: modules.state.GENERATIVE_FILL_APP_ID,
        appId: currentAppId,
        name: String(schema.name || "创成式填充"),
        inputs: Array.isArray(schema.inputs) ? schema.inputs : []
      },
      apiKey: modules.state.state.settings.apiKey || "",
      region: modules.state.state.settings.runningHubRegion,
      inputs: values,
      settings: {
        pollInterval: modules.state.state.settings.pollInterval,
        timeout: modules.state.state.settings.timeout,
        maxConcurrentTasks: modules.state.state.settings.maxConcurrentTasks,
        runningHubRegion: modules.state.state.settings.runningHubRegion
      },
      generativeFill: {
        selectionBounds: selection.selectionBounds,
        contextBounds: selection.contextBounds,
        selectionPadding: selection.selectionPadding,
        maskExpansion: Math.max(0, numberOrDefault(selection.maskExpansion, getConfiguredMaskExpansion())),
        feather: Math.max(0, numberOrDefault(selection.feather, getConfiguredFeather())),
        maskShape: maskVariants.shape,
        placementMaskDataUrl: maskVariants.placementMask ? maskVariants.placementMask.dataUrl : "",
        selectionSnapshotChannelName: String(selection.selectionSnapshotChannelName || ""),
        autoColorCorrection: modules.state.state.settings.generativeFillColorCorrectionEnabled !== false,
        useCurrentSelectionMask: true
      }
    };
  }

  async function buildThirdPartyPayload(selection, promptText) {
    const availability = getThirdPartyAvailability();
    if (!availability.available) throw new Error(availability.message);
    if (!modules.workspace || typeof modules.workspace.buildThirdPartyRunPayload !== "function") {
      throw new Error("当前版本未加载第三方 API 任务适配器");
    }

    const sourceImage = buildImageValue(selection.asset);
    const maskVariants = await buildMaskVariants(selection);
    const maskImage = buildImageValue(maskVariants.apiMask);
    const app = modules.state.getThirdPartyApp();
    const config = availability.descriptor.config;
    const generativeFill = {
      selectionBounds: selection.selectionBounds,
      contextBounds: selection.contextBounds,
      selectionPadding: selection.selectionPadding,
      maskExpansion: Math.max(0, numberOrDefault(selection.maskExpansion, getConfiguredMaskExpansion())),
      feather: Math.max(0, numberOrDefault(selection.feather, getConfiguredFeather())),
      maskShape: maskVariants.shape,
      placementMaskDataUrl: maskVariants.placementMask ? maskVariants.placementMask.dataUrl : "",
      selectionSnapshotChannelName: String(selection.selectionSnapshotChannelName || ""),
      autoColorCorrection: modules.state.state.settings.generativeFillColorCorrectionEnabled !== false,
      useCurrentSelectionMask: true,
      source: modules.state.GENERATIVE_FILL_SOURCES.THIRD_PARTY,
      compatibilityMode: true
    };
    return modules.workspace.buildThirdPartyRunPayload({
      kind: "generative-fill",
      appId: modules.state.THIRD_PARTY_APP_ID,
      appName: "创成式填充 · 第三方 API",
      app,
      inputs: {
        ...modules.state.buildDefaultFormValues(app),
        mainImage: sourceImage,
        referenceImage: maskImage,
        prompt: buildThirdPartyGenerativeFillPrompt(promptText),
        model: config.selectedModel,
        aspectRatio: "auto",
        resolution: config.resolution || "1K"
      },
      generativeFill
    });
  }

  async function submit() {
    const state = getState();
    let selection = null;
    if (submissionInFlight) return false;
    const promptText = String(state.prompt || "").trim();
    if (!promptText) {
      setStatus("error", "请先输入创成式填充提示词");
      return false;
    }
    const source = getConfiguredSource();
    if (source === modules.state.GENERATIVE_FILL_SOURCES.THIRD_PARTY) {
      const availability = getThirdPartyAvailability();
      if (!availability.available) {
        setStatus("error", availability.message);
        return false;
      }
    } else {
      if (!getConfiguredAppId()) {
        setStatus("error", "请先在设置页的创成式填充设置中填写应用 ID");
        return false;
      }
      if (!String(modules.state.state.settings.apiKey || "").trim()) {
        setStatus("error", "请先在设置页保存 RunningHub API Key");
        return false;
      }
    }

    submissionInFlight = true;
    render();
    try {
      selection = await captureSelection();
      const payload = source === modules.state.GENERATIVE_FILL_SOURCES.THIRD_PARTY
        ? await buildThirdPartyPayload(selection, promptText)
        : await buildPayload(await loadSchema(), selection, promptText);
      const sourceDocument = {
        ...(modules.state.state.currentDocumentInfo || {}),
        ok: true,
        hasActiveDocument: true,
        documentId: selection.documentId,
        title: selection.documentTitle,
        selectionBounds: selection.selectionBounds,
        contextBounds: selection.contextBounds,
        generativeFill: payload.generativeFill,
        generativeFillSource: source,
        generativeFillPrompt: promptText
      };
      modules.state.state.lastRunPayload = payload;
      const localTaskId = modules.workspace.enqueueRunTaskFlow(payload, sourceDocument);
      state.lastTaskId = localTaskId;
      const providerLabel = source === modules.state.GENERATIVE_FILL_SOURCES.THIRD_PARTY
        ? getThirdPartyAvailability().descriptor.label
        : "RunningHub";
      setStatus("queued", `已提交创成式填充任务，正在等待 ${providerLabel} 返回结果。`);
      return true;
    } catch (error) {
      if (selection) await cleanupSelectionSnapshot(selection);
      setStatus("error", error && error.message ? error.message : String(error || "创成式填充提交失败"));
      modules.ui.logToWorkspace(`创成式填充提交失败：${error && error.message ? error.message : error}`, "error");
      return false;
    } finally {
      submissionInFlight = false;
      render();
    }
  }

  async function enterMode() {
    const source = getConfiguredSource();
    if (source === modules.state.GENERATIVE_FILL_SOURCES.RUNNINGHUB && !getConfiguredAppId()) {
      modules.ui.logToWorkspace("请先在设置页的创成式填充设置中填写应用 ID。", "warn");
      modules.settings && modules.settings.renderSettingsStatus && modules.settings.renderSettingsStatus("请先在设置页的创成式填充设置中填写应用 ID。", "warn");
      return false;
    }
    const state = getState();
    const thirdPartyAvailability = source === modules.state.GENERATIVE_FILL_SOURCES.THIRD_PARTY
      ? getThirdPartyAvailability()
      : null;
    state.status = thirdPartyAvailability && !thirdPartyAvailability.available ? "error" : "idle";
    state.statusMessage = thirdPartyAvailability && !thirdPartyAvailability.available
      ? thirdPartyAvailability.message
      : "运行时自动读取当前 Photoshop 选区。";
    if (modules.quickEntries && typeof modules.quickEntries.setWorkspaceMode === "function") {
      await modules.quickEntries.setWorkspaceMode("generative-fill");
    } else {
      modules.state.state.workspaceMode = "generative-fill";
      modules.workspace.renderWorkspace();
    }
    if (modules.runtime.isPluginRuntime()) {
      try {
        await modules.workspace.refreshPhotoshopDocumentStatus({ quiet: true });
      } catch (_) {}
    }
    render();
    modules.ui.logToWorkspace(
      thirdPartyAvailability && !thirdPartyAvailability.available
        ? `${thirdPartyAvailability.message}。`
        : `已进入创成式填充模式，当前来源：${source === modules.state.GENERATIVE_FILL_SOURCES.THIRD_PARTY ? thirdPartyAvailability.descriptor.label : "RunningHub"}。`,
      thirdPartyAvailability && !thirdPartyAvailability.available ? "warn" : "info"
    );
    return true;
  }

  async function selectSource(source) {
    if (submissionInFlight) return false;
    const normalized = modules.state.normalizeGenerativeFillSource(source);
    try {
      if (modules.settings && typeof modules.settings.saveGenerativeFillSource === "function") {
        await modules.settings.saveGenerativeFillSource(normalized);
      } else {
        modules.state.state.settings = modules.state.normalizeSettings({
          ...modules.state.state.settings,
          generativeFillSource: normalized
        });
      }
      const state = getState();
      if (normalized === modules.state.GENERATIVE_FILL_SOURCES.THIRD_PARTY) {
        const availability = getThirdPartyAvailability();
        state.status = availability.available ? "idle" : "error";
        state.statusMessage = availability.available
          ? `当前使用 ${availability.descriptor.label} 第三方兼容模式。`
          : availability.message;
        modules.ui.logToWorkspace(
          availability.available
            ? `创成式填充已切换到 ${availability.descriptor.label} 第三方兼容模式。`
            : `${availability.message}。`,
          availability.available ? "info" : "warn"
        );
      } else {
        state.status = "idle";
        state.statusMessage = "当前使用 RunningHub 应用 ID。";
        modules.ui.logToWorkspace("创成式填充已切换到 RunningHub 应用 ID。", "info");
      }
      render();
      return true;
    } catch (error) {
      setStatus("error", `保存创成式填充来源失败：${error && error.message ? error.message : error}`);
      return false;
    }
  }

  async function exitMode() {
    const state = getState();
    state.status = "idle";
    state.statusMessage = "已退出创成式填充模式。";
    state.selection = null;
    if (taskTimerHandle) {
      window.clearInterval(taskTimerHandle);
      taskTimerHandle = 0;
    }
    if (modules.quickEntries && typeof modules.quickEntries.setWorkspaceMode === "function") {
      await modules.quickEntries.setWorkspaceMode("app");
    } else {
      modules.state.state.workspaceMode = "app";
      modules.workspace.renderWorkspace();
    }
    modules.ui.logToWorkspace("已退出创成式填充模式。", "info");
    return true;
  }

  function render() {
    const surface = modules.runtime.getById("generativeFillSurface");
    if (!surface) return;
    const state = getState();
    const active = modules.state.state.workspaceMode === "generative-fill";
    surface.hidden = !active;
    if (!active) return;

    const tasks = getGenerativeFillTasks();
    const busy = submissionInFlight || ["capturing", "schema", "submitting"].includes(state.status);
    const statusText = state.statusMessage || "运行时自动读取当前 Photoshop 选区。";
    const source = getConfiguredSource();
    const thirdPartyAvailability = getThirdPartyAvailability();
    const sourceIsThirdParty = source === modules.state.GENERATIVE_FILL_SOURCES.THIRD_PARTY;
    const sourceMeta = sourceIsThirdParty
      ? thirdPartyAvailability.available
        ? `${thirdPartyAvailability.descriptor.shortLabel} · ${thirdPartyAvailability.descriptor.config.selectedModel}`
        : thirdPartyAvailability.message
      : `应用 ID ${getConfiguredAppId() || "未配置"}`;
    const submitDisabled = busy || (sourceIsThirdParty && !thirdPartyAvailability.available);

    surface.innerHTML = `
      <div class="generative-fill-toolbar" role="region" aria-label="创成式填充操作栏">
        <div class="generative-fill-toolbar-head">
          <div class="generative-fill-title-group">
            <span class="generative-fill-mark" aria-hidden="true">GF</span>
            <div>
              <p class="generative-fill-kicker">Photoshop 工作区</p>
              <h2 class="generative-fill-title">创成式填充</h2>
            </div>
          </div>
          <button id="btnExitGenerativeFill" class="generative-fill-exit-btn" type="button" data-action="exit-generative-fill" title="退出创成式填充模式">退出</button>
        </div>

        <div class="generative-fill-source-row">
          <span class="generative-fill-source-label">运行来源</span>
          <div class="region-segmented generative-fill-source-control" role="group" aria-label="创成式填充运行来源">
            <button class="region-segmented-btn ${sourceIsThirdParty ? "" : "is-active"}" type="button" data-action="select-generative-fill-source" data-generative-fill-source="runninghub" aria-pressed="${sourceIsThirdParty ? "false" : "true"}" ${busy ? "disabled" : ""}><span>RunningHub</span><small>应用 ID</small></button>
            <button class="region-segmented-btn ${sourceIsThirdParty ? "is-active" : ""}" type="button" data-action="select-generative-fill-source" data-generative-fill-source="third-party" aria-pressed="${sourceIsThirdParty ? "true" : "false"}" ${busy ? "disabled" : ""}><span>第三方 API</span><small>兼容模式</small></button>
          </div>
          <span class="generative-fill-source-meta ${sourceIsThirdParty && !thirdPartyAvailability.available ? "is-error" : ""}">${modules.runtime.escapeHtml(sourceMeta)}</span>
        </div>

        <div class="generative-fill-selection-row">
          <div class="generative-fill-selection-status is-auto">
            <span class="generative-fill-status-dot" aria-hidden="true"></span>
            <span>运行时自动读取当前 Photoshop 选区</span>
          </div>
        </div>

        <label class="generative-fill-prompt-field">
          <span class="generative-fill-prompt-label">描述你希望填充的内容</span>
          <textarea id="generativeFillPromptInput" class="generative-fill-prompt-input" rows="3" placeholder="例如：在选区内补充自然的窗户和室内光线">${modules.runtime.escapeHtml(state.prompt || "")}</textarea>
        </label>

        <div class="generative-fill-footer">
          <div class="generative-fill-status" aria-live="polite">${modules.runtime.escapeHtml(statusText)}<small>${sourceIsThirdParty ? "蒙版作为第二张图交给模型解释，回贴仍按原选区裁切" : "每次生成都会读取最新选区，并保留不规则蒙版"}</small></div>
          <button class="primary-btn generative-fill-submit-btn" type="button" data-action="submit-generative-fill" ${submitDisabled ? "disabled" : ""}>${busy ? "读取中" : "生成"}</button>
        </div>

        <section class="generative-fill-tasks" aria-label="创成式填充任务">
          <div class="generative-fill-tasks-head"><strong>任务</strong><span>${tasks.length} 项</span></div>
          <div class="generative-fill-task-list">${renderTaskList(tasks)}</div>
        </section>
      </div>
    `;
    syncTaskTimer(tasks);
  }

  function bindActions() {
    const surface = modules.runtime.getById("generativeFillSurface");
    if (!surface || surface.dataset.bound === "true") return;
    surface.dataset.bound = "true";
    surface.addEventListener("input", (event) => {
      const target = event.target;
      const state = getState();
      if (target.id === "generativeFillPromptInput") state.prompt = target.value;
    });
    surface.addEventListener("keydown", (event) => {
      if (event.target && event.target.id === "generativeFillPromptInput" && event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        void submit();
      }
    });
    surface.addEventListener("click", (event) => {
      const target = event.target && event.target.closest("[data-action]");
      if (!target) return;
      const action = target.getAttribute("data-action");
      if (action === "exit-generative-fill") void exitMode();
      if (action === "submit-generative-fill") void submit();
      if (action === "select-generative-fill-source") {
        void selectSource(target.getAttribute("data-generative-fill-source"));
      }
    });
  }

  modules.generativeFill = {
    DEFAULT_CONTEXT_EXPANSION,
    dilateAlphaMask,
    buildOutwardFeatherAlpha,
    buildThirdPartyGenerativeFillPrompt,
    getThirdPartyAvailability,
    enterMode,
    exitMode,
    captureSelection,
    submit,
    render,
    bindActions
  };
})(window);
