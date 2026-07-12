(function initGenerativeFillModule(global) {
  const modules = (global.PixelRunnerModules = global.PixelRunnerModules || {});
  const DEFAULT_CONTEXT_EXPANSION = 128;
  const DEFAULT_MASK_EXPANSION = 4;
  const DEFAULT_FEATHER = 12;
  let submissionInFlight = false;
  let taskTimerHandle = 0;

  function getState() {
    return modules.state.state.generativeFill;
  }

  function getConfiguredAppId() {
    return String(modules.state.state.settings.generativeFillAppId || "").trim();
  }

  function getConfiguredFeather() {
    return Math.max(0, Math.min(128, Math.floor(numberOrDefault(
      modules.state.state.settings.generativeFillFeather,
      DEFAULT_FEATHER
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
    sourceContext.drawImage(image, 0, 0, width, height);
    const sourceData = sourceContext.getImageData(0, 0, width, height);

    const silhouetteCanvas = document.createElement("canvas");
    silhouetteCanvas.width = width;
    silhouetteCanvas.height = height;
    const silhouetteContext = silhouetteCanvas.getContext("2d");
    const silhouetteData = silhouetteContext.createImageData(width, height);
    for (let index = 0; index < sourceData.data.length; index += 4) {
      const luminance = Math.max(sourceData.data[index], sourceData.data[index + 1], sourceData.data[index + 2]);
      const alpha = luminance;
      silhouetteData.data[index] = 255;
      silhouetteData.data[index + 1] = 255;
      silhouetteData.data[index + 2] = 255;
      silhouetteData.data[index + 3] = alpha;
    }
    silhouetteContext.putImageData(silhouetteData, 0, 0);

    const expandedCanvas = document.createElement("canvas");
    expandedCanvas.width = width;
    expandedCanvas.height = height;
    const expandedContext = expandedCanvas.getContext("2d", { willReadFrequently: true });
    const scale = Math.min(
      width / Math.max(1, selection.contextBounds.right - selection.contextBounds.left),
      height / Math.max(1, selection.contextBounds.bottom - selection.contextBounds.top)
    );
    const expansion = Math.max(0, Number(getState().maskExpansion) || 0) * scale;
    const feather = getConfiguredFeather() * scale;
    expandedContext.clearRect(0, 0, width, height);
    expandedContext.filter = feather > 0 ? `blur(${Math.max(0.5, feather)}px)` : "none";
    expandedContext.drawImage(silhouetteCanvas, 0, 0);
    if (expansion > 0) {
      const rings = Math.max(1, Math.min(6, Math.ceil(expansion / 4)));
      for (let ring = 1; ring <= rings; ring += 1) {
        const radius = expansion * ring / rings;
        for (let step = 0; step < 20; step += 1) {
          const angle = Math.PI * 2 * step / 20;
          expandedContext.drawImage(silhouetteCanvas, Math.cos(angle) * radius, Math.sin(angle) * radius);
        }
      }
    }
    expandedContext.filter = "none";

    const expandedData = expandedContext.getImageData(0, 0, width, height);
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
    for (let index = 0; index < expandedData.data.length; index += 4) {
      const alpha = expandedData.data[index + 3];
      apiData.data[index] = alpha;
      apiData.data[index + 1] = alpha;
      apiData.data[index + 2] = alpha;
      apiData.data[index + 3] = 255;
      placementData.data[index] = 255;
      placementData.data[index + 1] = 255;
      placementData.data[index + 2] = 255;
      placementData.data[index + 3] = alpha;
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
    if (["running", "tracking", "remote-running"].includes(normalized)) return "生成中";
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

  async function loadSchema() {
    const state = getState();
    const appId = getConfiguredAppId();
    if (!appId) throw new Error("请先在高级设置中填写创成式填充应用 ID");
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

  async function captureSelection() {
    const state = getState();
    if (!modules.runtime.isPluginRuntime()) throw new Error("浏览器预览模式下无法捕获 Photoshop 选区");
    const docInfo = await modules.workspace.refreshPhotoshopDocumentStatus({ quiet: true });
    const selectionBounds = cloneBounds(docInfo && docInfo.selectionBounds);
    if (!docInfo || !docInfo.hasActiveDocument) throw new Error("请先打开 Photoshop 文档");
    if (!selectionBounds) throw new Error("请先在 Photoshop 中框选要生成的区域");

    const contextExpansion = Math.max(0, Math.min(2048, Math.floor(numberOrDefault(state.contextExpansion, DEFAULT_CONTEXT_EXPANSION))));
    setStatus("capturing", `正在捕获选区及周围 ${contextExpansion}px 上下文...`);
    const captured = await modules.runtime.callHost(
      "photoshop.captureDocumentPreview",
      [{ maxDimension: 2048, quality: 90, selectionPadding: contextExpansion, captureSelectionMask: true, forceMaxDimension: true }],
      { timeoutMs: 45000 }
    );
    if (!captured || !captured.uploadDataUrl) throw new Error("Photoshop 未返回可上传的上下文图像");
    if (!captured.selectionMaskDataUrl) {
      throw new Error("Photoshop 未能读取不规则选区蒙版，请重新建立选区后再试");
    }

    const selection = {
      documentId: Number(docInfo.documentId) || 0,
      documentTitle: String(docInfo.title || "Untitled"),
      selectionBounds,
      contextBounds: cloneBounds(captured.contextBounds) || selectionBounds,
      selectionPadding: contextExpansion,
      capturedAt: Date.now(),
      asset: captured,
      maskAsset: captured.selectionMaskDataUrl
        ? {
            dataUrl: captured.selectionMaskDataUrl,
            ...parseDataUrl(captured.selectionMaskDataUrl),
            width: Number(captured.uploadWidth) || null,
            height: Number(captured.uploadHeight) || null,
            shape: String(captured.selectionMaskShape || "selection-channel")
          }
        : null
    };
    state.selection = selection;
    modules.ui.logToWorkspace(`创成式填充已捕获选区：${formatBounds(selectionBounds)}，上下文扩展 ${contextExpansion}px。`, "success");
    return selection;
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
        maskExpansion: numberOrDefault(getState().maskExpansion, DEFAULT_MASK_EXPANSION),
        feather: getConfiguredFeather(),
        maskShape: maskVariants.shape,
        placementMaskDataUrl: maskVariants.placementMask ? maskVariants.placementMask.dataUrl : "",
        useCurrentSelectionMask: true
      }
    };
  }

  async function submit() {
    const state = getState();
    if (submissionInFlight) return false;
    const promptText = String(state.prompt || "").trim();
    if (!promptText) {
      setStatus("error", "请先输入创成式填充提示词");
      return false;
    }
    if (!getConfiguredAppId()) {
      setStatus("error", "请先在高级设置中填写创成式填充应用 ID");
      return false;
    }
    if (!String(modules.state.state.settings.apiKey || "").trim()) {
      setStatus("error", "请先在设置页保存 RunningHub API Key");
      return false;
    }

    submissionInFlight = true;
    render();
    try {
      const selection = await captureSelection();
      const schema = await loadSchema();
      const payload = await buildPayload(schema, selection, promptText);
      const sourceDocument = {
        ...(modules.state.state.currentDocumentInfo || {}),
        ok: true,
        hasActiveDocument: true,
        documentId: selection.documentId,
        title: selection.documentTitle,
        selectionBounds: selection.selectionBounds,
        contextBounds: selection.contextBounds,
        generativeFill: payload.generativeFill,
        generativeFillPrompt: promptText
      };
      modules.state.state.lastRunPayload = payload;
      const localTaskId = modules.workspace.enqueueRunTaskFlow(payload, sourceDocument);
      state.lastTaskId = localTaskId;
      setStatus("queued", `已提交创成式填充任务，正在等待 RunningHub 返回结果。`);
      return true;
    } catch (error) {
      setStatus("error", error && error.message ? error.message : String(error || "创成式填充提交失败"));
      modules.ui.logToWorkspace(`创成式填充提交失败：${error && error.message ? error.message : error}`, "error");
      return false;
    } finally {
      submissionInFlight = false;
      render();
    }
  }

  async function enterMode() {
    if (!getConfiguredAppId()) {
      modules.ui.logToWorkspace("请先在高级设置中填写创成式填充应用 ID。", "warn");
      modules.settings && modules.settings.renderSettingsStatus && modules.settings.renderSettingsStatus("请先在高级设置中填写创成式填充应用 ID。", "warn");
      return false;
    }
    const state = getState();
    state.contextExpansion = Math.max(0, Math.min(2048, numberOrDefault(state.contextExpansion, DEFAULT_CONTEXT_EXPANSION)));
    state.maskExpansion = Math.max(0, Math.min(128, numberOrDefault(state.maskExpansion, DEFAULT_MASK_EXPANSION)));
    state.status = "idle";
    state.statusMessage = "运行时自动读取当前 Photoshop 选区。";
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
    modules.ui.logToWorkspace("已进入创成式填充模式。运行时会自动读取 Photoshop 当前选区。", "info");
    return true;
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

        <div class="generative-fill-selection-row">
          <div class="generative-fill-selection-status is-auto">
            <span class="generative-fill-status-dot" aria-hidden="true"></span>
            <span>运行时自动读取当前 Photoshop 选区</span>
          </div>
          <span class="generative-fill-context-note">上下文 ${numberOrDefault(state.contextExpansion, DEFAULT_CONTEXT_EXPANSION)}px</span>
        </div>

        <label class="generative-fill-prompt-field">
          <span class="generative-fill-prompt-label">描述你希望填充的内容</span>
          <textarea id="generativeFillPromptInput" class="generative-fill-prompt-input" rows="3" placeholder="例如：在选区内补充自然的窗户和室内光线">${modules.runtime.escapeHtml(state.prompt || "")}</textarea>
        </label>

        <div class="generative-fill-control-row">
          <label class="generative-fill-control"><span>上下文</span><input id="generativeFillContextInput" type="number" min="0" max="2048" step="1" value="${numberOrDefault(state.contextExpansion, DEFAULT_CONTEXT_EXPANSION)}" /><em>px</em></label>
          <label class="generative-fill-control"><span>扩展</span><input id="generativeFillMaskExpansionInput" type="number" min="0" max="128" step="1" value="${numberOrDefault(state.maskExpansion, DEFAULT_MASK_EXPANSION)}" /><em>px</em></label>
        </div>

        <div class="generative-fill-footer">
          <div class="generative-fill-status" aria-live="polite">${modules.runtime.escapeHtml(statusText)}<small>每次生成都会读取最新选区，并保留不规则蒙版</small></div>
          <button class="primary-btn generative-fill-submit-btn" type="button" data-action="submit-generative-fill" ${busy ? "disabled" : ""}>${busy ? "读取中" : "生成"}</button>
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
      if (target.id === "generativeFillContextInput") {
        const nextExpansion = Math.max(0, Math.min(2048, Math.floor(Number(target.value) || 0)));
        state.contextExpansion = nextExpansion;
      }
      if (target.id === "generativeFillMaskExpansionInput") state.maskExpansion = Math.max(0, Math.min(128, Math.floor(Number(target.value) || 0)));
    });
    surface.addEventListener("change", (event) => {
      if (event.target && event.target.id === "generativeFillContextInput") render();
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
    });
  }

  modules.generativeFill = {
    DEFAULT_CONTEXT_EXPANSION,
    enterMode,
    exitMode,
    captureSelection,
    submit,
    render,
    bindActions
  };
})(window);
