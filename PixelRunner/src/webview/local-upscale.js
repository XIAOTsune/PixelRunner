(function initLocalUpscaleModule(global) {
  const modules = (global.PixelRunnerModules = global.PixelRunnerModules || {});
  const POLL_INTERVAL_MS = 900;
  const ENGINE_START_POLL_INTERVAL_MS = 700;
  const ENGINE_START_TIMEOUT_MS = 25000;
  const LOCAL_AI_BASE_URL = "http://127.0.0.1:17836";
  const LOCAL_AI_PROTOCOL_VERSION = "2";
  const LOCAL_AI_BUILD_ID = "PixelRunnerV2.7.3-local-ai-native-cli";
  const STATUS_LABELS = {
    queued: "正在排队",
    running: "正在推理",
    processing: "正在推理",
    preparing: "正在准备",
    exporting: "正在导出",
    succeeded: "正在回传",
    completed: "正在回传",
    cancelled: "已取消",
    canceled: "已取消",
    failed: "任务失败",
    error: "任务失败"
  };
  const state = {
    bound: false,
    engine: null,
    engineReady: false,
    running: false,
    engineStarting: false,
    engineStartPromise: null,
    currentJobId: "",
    currentCapture: null,
    pollTimer: 0
  };

  function getById(id) {
    return modules.runtime.getById(id);
  }

  function normalizeStatus(value) {
    return String(value || "").trim().toLowerCase();
  }

  function getLocalUpscalePayload(args = []) {
    const payload = Array.isArray(args) ? args[0] : args;
    return payload && typeof payload === "object" ? payload : {};
  }

  function assertCompatibleEngine(payload) {
    const protocolVersion = String(payload && payload.protocolVersion || "").trim();
    const buildId = String(payload && payload.buildId || "").trim();
    if (protocolVersion !== LOCAL_AI_PROTOCOL_VERSION || buildId !== LOCAL_AI_BUILD_ID) {
      throw new Error("本地超分服务版本不匹配，请重新启动 PixelRunner Local AI");
    }
  }

  function shouldUseWebviewLocalAiFallback(error) {
    const message = String(error && error.message || error || "").toLowerCase();
    return message.includes("manifest entry not found") || message.includes("permission denied to the url");
  }

  async function requestLocalAiFromWebview(method, args = []) {
    if (typeof global.fetch !== "function") throw new Error("WebView fetch 不可用");
    const payload = getLocalUpscalePayload(args);
    let path = "";
    let options = { headers: { Accept: "application/json" } };
    if (method === "localUpscale.getHealth") {
      path = "/v1/health";
    } else if (method === "localUpscale.submitJob") {
      path = "/v1/jobs";
      options = {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({
          ...payload,
          protocolVersion: LOCAL_AI_PROTOCOL_VERSION,
          buildId: LOCAL_AI_BUILD_ID
        })
      };
    } else if (method === "localUpscale.getJob") {
      path = `/v1/jobs/${encodeURIComponent(String(payload.jobId || "").trim())}`;
    } else if (method === "localUpscale.cancelJob") {
      path = `/v1/jobs/${encodeURIComponent(String(payload.jobId || "").trim())}/cancel`;
      options = { method: "POST", headers: { Accept: "application/json" } };
    } else if (method === "localUpscale.recordPlacement") {
      path = `/v1/jobs/${encodeURIComponent(String(payload.jobId || "").trim())}/placement`;
      options = {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({
          ...payload,
          protocolVersion: LOCAL_AI_PROTOCOL_VERSION,
          buildId: LOCAL_AI_BUILD_ID
        })
      };
    } else {
      throw new Error("不支持的本地超分请求");
    }

    const response = await global.fetch(`${LOCAL_AI_BASE_URL}${path}`, options);
    let result = null;
    try {
      result = await response.json();
    } catch (_) {}
    if (!response.ok) {
      throw new Error(String(result && (result.error || result.message) || `本地引擎返回 HTTP ${response.status}`));
    }
    const responsePayload = result && typeof result === "object" ? result : {};
    assertCompatibleEngine(responsePayload);
    if (method === "localUpscale.getJob" && responsePayload.resultPath && !responsePayload.resultUrl) {
      responsePayload.resultUrl = `${LOCAL_AI_BASE_URL}${path}/result`;
    }
    return responsePayload;
  }

  async function callLocalUpscaleService(method, args = [], options = {}) {
    try {
      return await modules.runtime.callHost(method, args, options);
    } catch (error) {
      if (!shouldUseWebviewLocalAiFallback(error)) throw error;
      try {
        return await requestLocalAiFromWebview(method, args);
      } catch (fallbackError) {
        throw new Error(`无法连接 PixelRunner Local AI：${String(fallbackError && fallbackError.message || fallbackError)}`);
      }
    }
  }

  function getEngineLabel(engine) {
    const gpu = String(engine && (engine.gpuName || engine.gpu || "") || "").trim();
    const backend = String(engine && (engine.backend || "") || "").trim();
    const model = String(engine && (engine.model || "realesrgan-x4plus") || "realesrgan-x4plus").trim();
    return [gpu, backend, model].filter(Boolean).join(" · ") || "Real-ESRGAN x4plus";
  }

  function setStatus(message, tone = "info") {
    const status = getById("localUpscaleEngineStatus");
    const hint = getById("localUpscaleHint");
    const quickBadge = getById("localUpscaleQuickBadge");
    const quickHint = getById("localUpscaleQuickHint");
    if (status) {
      status.textContent = String(message || "");
      status.dataset.tone = tone;
    }
    if (hint) modules.runtime.setSummaryStatus(hint, String(message || ""), tone);
    if (quickBadge) {
      quickBadge.textContent = tone === "success" ? "本地引擎已就绪" : tone === "error" ? "本地引擎未连接" : "检测本地引擎";
      quickBadge.dataset.tone = tone;
    }
    if (quickHint) modules.runtime.setSummaryStatus(quickHint, String(message || ""), tone);
  }

  function setEngineMeta(engine) {
    const meta = getById("localUpscaleEngineMeta");
    if (meta) meta.textContent = getEngineLabel(engine);
  }

  function setProgress(label, meta, progress, status = "idle") {
    const panel = getById("localUpscaleProgressPanel");
    const labelEl = getById("localUpscaleProgressLabel");
    const metaEl = getById("localUpscaleProgressMeta");
    const bar = getById("localUpscaleProgressBar");
    if (panel) panel.dataset.state = status;
    if (labelEl) labelEl.textContent = String(label || "");
    if (metaEl) metaEl.textContent = String(meta || "");
    if (bar) bar.style.width = `${Math.max(0, Math.min(100, Number(progress) || 0))}%`;
  }

  function setRunning(running) {
    state.running = Boolean(running);
    const controlsLocked = state.running || state.engineStarting;
    const startButton = getById("btnStartLocalUpscale");
    const cancelButton = getById("btnCancelLocalUpscale");
    const refreshButton = getById("btnRefreshLocalUpscaleEngine");
    const tileInput = getById("localUpscaleTileInput");
    const ttaInput = getById("localUpscaleTtaInput");
    const debugInput = getById("localUpscaleDebugInput");
    if (startButton) startButton.disabled = controlsLocked || !state.engineReady;
    if (cancelButton) cancelButton.disabled = !state.running || !state.currentJobId;
    if (refreshButton) refreshButton.disabled = controlsLocked;
    if (tileInput) tileInput.disabled = controlsLocked;
    if (ttaInput) ttaInput.disabled = controlsLocked;
    if (debugInput) debugInput.disabled = controlsLocked;
  }

  function clearPollTimer() {
    if (!state.pollTimer) return;
    global.clearTimeout(state.pollTimer);
    state.pollTimer = 0;
  }

  function wait(delayMs) {
    return new Promise((resolve) => global.setTimeout(resolve, delayMs));
  }

  async function getEngineHealth() {
    const health = await callLocalUpscaleService("localUpscale.getHealth", [], { timeoutMs: 8000 });
    if (!health || health.ok === false || health.ready === false) {
      throw new Error(String(health && (health.message || health.error) || "本地引擎未就绪"));
    }
    return health;
  }

  function markEngineReady(health) {
    state.engine = health;
    state.engineReady = true;
    setEngineMeta(health);
    setStatus(`本地引擎已就绪：${getEngineLabel(health)}`, "success");
    setProgress("等待开始", "完整画布 · 原生 4x", 0, "idle");
  }

  function markEngineUnavailable(error) {
    const message = String(error && error.message || error || "本地引擎未就绪");
    state.engine = null;
    state.engineReady = false;
    setEngineMeta(null);
    setStatus(`未连接本地引擎：${message}`, "error");
    setProgress("等待本地引擎", "正在启动 PixelRunner Local AI", 0, "error");
  }

  function closePanel() {
    if (state.running) return;
    if (modules.workspace && typeof modules.workspace.setModalOpen === "function") {
      modules.workspace.setModalOpen("localUpscaleModal", false);
    }
  }

  async function refreshEngineHealth(options = {}) {
    const quiet = options.quiet === true;
    if (!modules.runtime.isPluginRuntime()) {
      state.engine = null;
      state.engineReady = false;
      setEngineMeta(null);
      setStatus("浏览器预览模式下无法连接本地超分引擎。", "warn");
      setRunning(false);
      return null;
    }

    if (!quiet) setStatus("正在检测 PixelRunner Local AI...", "info");
    try {
      const health = await getEngineHealth();
      markEngineReady(health);
      setRunning(state.running);
      return health;
    } catch (error) {
      markEngineUnavailable(error);
      setRunning(state.running);
      return null;
    }
  }

  async function startEngineAndWait() {
    if (state.engineReady) return state.engine;
    if (state.engineStartPromise) return state.engineStartPromise;

    state.engineStartPromise = (async () => {
      state.engineStarting = true;
      setRunning(state.running);
      setStatus("正在启动 PixelRunner Local AI...", "info");
      setProgress("正在启动本地引擎", "首次启动可能需要几秒", 8, "running");
      try {
        const launched = await modules.runtime.callHost("localUpscale.startEngine", [], { timeoutMs: 15000 });
        if (!launched || launched.ok === false) {
          throw new Error(String(launched && launched.result || "无法启动 PixelRunner Local AI"));
        }

        const deadline = Date.now() + ENGINE_START_TIMEOUT_MS;
        let lastError = null;
        while (Date.now() < deadline) {
          try {
            const health = await getEngineHealth();
            markEngineReady(health);
            return health;
          } catch (error) {
            lastError = error;
            await wait(ENGINE_START_POLL_INTERVAL_MS);
          }
        }
        throw lastError || new Error("PixelRunner Local AI 启动超时");
      } catch (error) {
        markEngineUnavailable(error);
        setProgress("本地引擎未启动", "请检查插件目录中的 local-ai 日志", 0, "error");
        return null;
      } finally {
        state.engineStarting = false;
        state.engineStartPromise = null;
        setRunning(state.running);
      }
    })();

    return state.engineStartPromise;
  }

  async function ensureEngineReady(startIfNeeded) {
    if (state.engineReady) return state.engine;
    const health = await refreshEngineHealth({ quiet: true });
    if (health || !startIfNeeded) return health;
    return startEngineAndWait();
  }

  async function finishSuccessfully(job) {
    const resultPath = String(job && job.resultPath || "").trim();
    const capture = state.currentCapture;
    if (!resultPath) throw new Error("本地引擎未返回超分结果文件");
    if (!capture || !capture.documentId || !capture.targetWidth || !capture.targetHeight) {
      throw new Error("本地超分缺少原文档回贴信息");
    }
    setProgress("正在回贴 Photoshop", "原文档新图层", 88, "running");
    const result = await modules.runtime.callHost("photoshop.placeLocalUpscaleResult", [{
      filePath: resultPath,
      taskId: state.currentJobId,
      targetDocumentId: capture.documentId,
      targetWidth: capture.targetWidth,
      targetHeight: capture.targetHeight,
    }], { timeoutMs: 360000 });
    const document = result && result.document ? result.document : {};
    const size = Number(document.width) && Number(document.height)
      ? `${Math.round(Number(document.width))} x ${Math.round(Number(document.height))}`
      : `${Math.round(Number(capture.targetWidth))} x ${Math.round(Number(capture.targetHeight))}`;
    try {
      await callLocalUpscaleService("localUpscale.recordPlacement", [{
        jobId: state.currentJobId,
        width: Number(document.width) || Number(capture.targetWidth) || 0,
        height: Number(document.height) || Number(capture.targetHeight) || 0,
        layerId: Number(result && result.layerId) || 0,
        documentId: Number(document.documentId) || Number(capture.documentId) || 0
      }], { timeoutMs: 15000 });
    } catch (error) {
      console.warn("[PixelRunner/WebView] localUpscale placement diagnostics unavailable", error);
    }
    setProgress("超分完成", size, 100, "success");
    setStatus(`已回贴到原文档的新图层：${size}`, "success");
    if (modules.ui && typeof modules.ui.logToWorkspace === "function") {
      modules.ui.logToWorkspace(`本地超分已完成，已回贴到原文档的新图层（${size}）。`, "success");
    }
  }

  function schedulePoll() {
    clearPollTimer();
    state.pollTimer = global.setTimeout(() => {
      void pollCurrentJob();
    }, POLL_INTERVAL_MS);
  }

  async function pollCurrentJob() {
    if (!state.running || !state.currentJobId) return;
    try {
      const job = await callLocalUpscaleService("localUpscale.getJob", [{ jobId: state.currentJobId }], { timeoutMs: 15000 });
      const status = normalizeStatus(job && job.status);
      const progress = Number(job && job.progress);
      const label = STATUS_LABELS[status] || "正在处理";
      const detail = String(job && (job.message || job.stage) || "原生 4x").trim();
      if (["succeeded", "success", "completed", "done"].includes(status)) {
        await finishSuccessfully(job);
        state.currentJobId = "";
        state.currentCapture = null;
        setRunning(false);
        return;
      }
      if (["failed", "error", "cancelled", "canceled"].includes(status)) {
        throw new Error(String(job && (job.error || job.message) || label));
      }
      setProgress(label, detail, Number.isFinite(progress) ? progress : 54, "running");
      schedulePoll();
    } catch (error) {
      const wasCancelled = /取消/.test(String(error && error.message || ""));
      setProgress(wasCancelled ? "已取消" : "本地超分失败", String(error.message || error), 100, wasCancelled ? "idle" : "error");
      setStatus(wasCancelled ? "本地超分已取消。" : `本地超分失败：${error.message}`, wasCancelled ? "warn" : "error");
      if (modules.ui && typeof modules.ui.logToWorkspace === "function") {
        modules.ui.logToWorkspace(`本地超分${wasCancelled ? "已取消" : `失败：${error.message}`}`, wasCancelled ? "info" : "error");
      }
      state.currentJobId = "";
      state.currentCapture = null;
      setRunning(false);
    }
  }

  async function startUpscale() {
    if (state.running) return;
    if (!modules.runtime.isPluginRuntime()) {
      setStatus("浏览器预览模式下不可执行本地超分。", "warn");
      return;
    }
    if (!state.engineReady && !await ensureEngineReady(true)) return;

    const tileInput = getById("localUpscaleTileInput");
    const ttaInput = getById("localUpscaleTtaInput");
    const debugInput = getById("localUpscaleDebugInput");
    const tile = Math.max(32, Math.min(1024, Math.floor(Number(tileInput && tileInput.value) || 128)));
    const tta = Boolean(ttaInput && ttaInput.checked);
    const debug = Boolean(debugInput && debugInput.checked);
    state.currentJobId = modules.runtime.createId("local-upscale");
    setRunning(true);
    setProgress("正在导出无损图像", "完整画布 · 原生 4x", 12, "running");
    setStatus("正在从 Photoshop 导出无损 PNG...", "info");

    try {
      const capture = await modules.runtime.callHost("photoshop.captureLocalUpscaleSource", [{
        taskId: state.currentJobId,
        expectedDocumentId: Number(modules.state.state.currentDocumentInfo && modules.state.state.currentDocumentInfo.documentId) || 0
      }], { timeoutMs: 300000 });
      if (!capture || !capture.inputPath || !capture.outputPath) {
        throw new Error("Photoshop 未返回本地超分源文件");
      }
      state.currentCapture = capture;
      const sourceSize = `${Math.round(Number(capture.width) || 0)} x ${Math.round(Number(capture.height) || 0)}`;
      setProgress("正在提交本地引擎", `${sourceSize} · 原生 4x`, 28, "running");
      const job = await callLocalUpscaleService("localUpscale.submitJob", [{
        jobId: state.currentJobId,
        inputPath: capture.inputPath,
        outputPath: capture.outputPath,
        scale: 1,
        tile,
        tta,
        debug,
        targetWidth: capture.targetWidth,
        targetHeight: capture.targetHeight
      }], { timeoutMs: 20000 });
      const jobId = String(job && job.jobId || state.currentJobId).trim();
      if (!jobId) throw new Error("本地引擎未返回任务编号");
      state.currentJobId = jobId;
      setStatus(`已提交本地超分：${sourceSize} · 原生 4x`, "info");
      setProgress("正在排队", `${sourceSize} · 原生 4x`, 36, "running");
      schedulePoll();
    } catch (error) {
      setProgress("本地超分失败", String(error.message || error), 100, "error");
      setStatus(`本地超分失败：${error.message}`, "error");
      if (modules.ui && typeof modules.ui.logToWorkspace === "function") {
        modules.ui.logToWorkspace(`本地超分失败：${error.message}`, "error");
      }
      state.currentJobId = "";
      state.currentCapture = null;
      setRunning(false);
    }
  }

  async function cancelUpscale() {
    if (!state.running || !state.currentJobId) return;
    const jobId = state.currentJobId;
    setProgress("正在取消", "等待本地引擎停止", 60, "running");
    try {
      await callLocalUpscaleService("localUpscale.cancelJob", [{ jobId }], { timeoutMs: 15000 });
      clearPollTimer();
      state.currentJobId = "";
      state.currentCapture = null;
      setRunning(false);
      setProgress("已取消", "完整画布 · 原生 4x", 0, "idle");
      setStatus("本地超分已取消。", "warn");
    } catch (error) {
      setStatus(`取消任务失败：${error.message}`, "error");
      schedulePoll();
    }
  }

  function openPanel() {
    if (modules.workspace && typeof modules.workspace.setModalOpen === "function") {
      modules.workspace.setModalOpen("localUpscaleModal", true);
    }
    void ensureEngineReady(true);
  }

  function bindActions() {
    if (state.bound) return;
    state.bound = true;
    const openButton = getById("btnOpenLocalUpscalePanel");
    const closeButton = getById("localUpscaleModalClose");
    const refreshButton = getById("btnRefreshLocalUpscaleEngine");
    const startButton = getById("btnStartLocalUpscale");
    const cancelButton = getById("btnCancelLocalUpscale");
    if (openButton) openButton.addEventListener("click", openPanel);
    if (closeButton) closeButton.addEventListener("click", closePanel);
    if (refreshButton) refreshButton.addEventListener("click", () => void ensureEngineReady(true));
    if (startButton) startButton.addEventListener("click", () => void startUpscale());
    if (cancelButton) cancelButton.addEventListener("click", () => void cancelUpscale());
    document.addEventListener("click", (event) => {
      if (event.target && event.target.closest("#localUpscaleBackdrop")) closePanel();
    });
    setRunning(false);
  }

  function initialize() {
    void refreshEngineHealth({ quiet: true });
  }

  modules.localUpscale = {
    bindActions,
    initialize,
    openPanel,
    refreshEngineHealth
  };
})(window);
