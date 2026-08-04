(function initLocalUpscaleModule(global) {
  const modules = (global.PixelRunnerModules = global.PixelRunnerModules || {});
  const POLL_INTERVAL_MS = 900;
  const ENGINE_START_POLL_INTERVAL_MS = 700;
  const ENGINE_START_TIMEOUT_MS = 25000;
  const ENGINE_DISCOVERY_TIMEOUT_MS = 2500;
  const LOCAL_AI_PORT_START = 17836;
  const LOCAL_AI_PORT_END = 17845;
  const LOCAL_AI_BASE_URLS = Object.freeze(
    Array.from(
      { length: LOCAL_AI_PORT_END - LOCAL_AI_PORT_START + 1 },
      (_, index) => `http://127.0.0.1:${LOCAL_AI_PORT_START + index}`
    )
  );
  const LOCAL_AI_BASE_URL = LOCAL_AI_BASE_URLS[0];
  const LOCAL_AI_PROTOCOL_VERSION = "2";
  const LOCAL_AI_BUILD_ID = "PixelRunnerV2.8.2-local-ai-bundled-runtime";
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
    engineSessionActive: false,
    engineSessionId: 0,
    shutdownPromise: null,
    shutdownBeaconSent: false,
    baseUrl: LOCAL_AI_BASE_URL,
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

  function normalizeLocalAiBaseUrl(value) {
    const candidate = String(value || "").trim().replace(/\/$/, "").toLowerCase();
    return LOCAL_AI_BASE_URLS.includes(candidate) ? candidate : LOCAL_AI_BASE_URL;
  }

  function buildLocalUpscaleArgs(payload = {}, baseUrl = state.baseUrl) {
    return [{
      ...(payload && typeof payload === "object" ? payload : {}),
      baseUrl: normalizeLocalAiBaseUrl(baseUrl)
    }];
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
    const baseUrl = normalizeLocalAiBaseUrl(payload.baseUrl);
    let path = "";
    let options = { headers: { Accept: "application/json" } };
    if (method === "localUpscale.getHealth") {
      path = "/v1/health";
    } else if (method === "localUpscale.stopEngine") {
      path = "/v1/shutdown";
      options = {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({
          protocolVersion: LOCAL_AI_PROTOCOL_VERSION,
          buildId: LOCAL_AI_BUILD_ID
        })
      };
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

    const response = await global.fetch(`${baseUrl}${path}`, options);
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
      responsePayload.resultUrl = `${baseUrl}${path}/result`;
    }
    return { ...responsePayload, baseUrl };
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
      status.dataset.status = tone;
    }
    if (hint) modules.runtime.setSummaryStatus(hint, String(message || ""), tone);
    if (quickBadge) {
      quickBadge.textContent = tone === "success" ? "本地引擎已就绪" : tone === "error" ? "本地引擎未连接" : "检测本地引擎";
      quickBadge.dataset.status = tone;
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

  function getCaptureLabel(capture) {
    if (!capture || String(capture.captureMode || "") !== "selection") return "整图超分 · 原生 4x";
    const bounds = capture.captureBounds || capture.targetBounds || {};
    const width = Math.max(0, Math.round(Number(bounds.right) - Number(bounds.left)));
    const height = Math.max(0, Math.round(Number(bounds.bottom) - Number(bounds.top)));
    const padding = Math.max(0, Math.round(Number(capture.padding) || 0));
    return `选区超分 · ${width} x ${height} · padding ${padding}px · 原生 4x`;
  }

  function getCaptureProgressLabel(capture) {
    if (!capture || String(capture.captureMode || "") !== "selection") return "整图";
    const bounds = capture.captureBounds || capture.targetBounds || {};
    const width = Math.max(0, Math.round(Number(bounds.right) - Number(bounds.left)));
    const height = Math.max(0, Math.round(Number(bounds.bottom) - Number(bounds.top)));
    return `选区 ${width} x ${height}`;
  }

  function getNativeFilename(value) {
    return String(value || "").trim().split(/[\\/]/).pop() || "";
  }

  function resolveLocalUpscaleResultSource(job, capture) {
    const reportedPath = String(job && job.resultPath || "").trim();
    const expectedPath = String(capture && capture.outputPath || "").trim();
    const resultUrl = String(job && job.resultUrl || "").trim();
    const reportedFilename = getNativeFilename(reportedPath).toLowerCase();
    const expectedFilename = getNativeFilename(expectedPath).toLowerCase();
    if (reportedFilename && expectedFilename && reportedFilename !== expectedFilename) {
      throw new Error("本地引擎返回的结果文件与当前任务不匹配，请重新运行本地超分");
    }
    if (!reportedPath && !resultUrl) throw new Error("本地引擎未返回超分结果文件");
    return {
      filePath: expectedPath || reportedPath,
      resultUrl
    };
  }

  function getInferenceProgress(job) {
    const value = Number(job && job.inferencePercent);
    return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : null;
  }

  function formatInferenceProgress(job) {
    const percent = getInferenceProgress(job);
    if (percent === null) return "正在准备推理";
    return `推理 ${percent.toFixed(2)}%`;
  }

  async function cleanupCaptureSelectionSnapshot(capture = state.currentCapture) {
    const channelName = String(capture && capture.selectionSnapshotChannelName || "").trim();
    const documentId = Number(capture && capture.documentId) || 0;
    if (!channelName || !documentId || !modules.runtime.isPluginRuntime()) return;
    try {
      await modules.runtime.callHost("photoshop.deleteSelectionSnapshot", [{
        targetDocumentId: documentId,
        selectionSnapshotChannelName: channelName
      }], { timeoutMs: 15000 });
    } catch (error) {
      console.warn("[PixelRunner/WebView] localUpscale selection snapshot cleanup unavailable", error);
    }
  }

  function setRunning(running) {
    state.running = Boolean(running);
    const controlsLocked = state.running || state.engineStarting;
    const startButton = getById("btnStartLocalUpscale");
    const cancelButton = getById("btnCancelLocalUpscale");
    const refreshButton = getById("btnRefreshLocalUpscaleEngine");
    const modeInput = getById("localUpscaleModeInput");
    const tileInput = getById("localUpscaleTileInput");
    const ttaInput = getById("localUpscaleTtaInput");
    const debugInput = getById("localUpscaleDebugInput");
    if (startButton) startButton.disabled = controlsLocked || !state.engineReady;
    if (cancelButton) cancelButton.disabled = !state.running || !state.currentJobId;
    if (refreshButton) refreshButton.disabled = controlsLocked;
    if (tileInput) tileInput.disabled = controlsLocked;
    if (modeInput) modeInput.disabled = controlsLocked;
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

  async function getEngineHealth(baseUrl = state.baseUrl) {
    const normalizedBaseUrl = normalizeLocalAiBaseUrl(baseUrl);
    const health = await callLocalUpscaleService(
      "localUpscale.getHealth",
      buildLocalUpscaleArgs({}, normalizedBaseUrl),
      { timeoutMs: ENGINE_DISCOVERY_TIMEOUT_MS }
    );
    if (!health || health.ok === false || health.ready === false) {
      throw new Error(String(health && (health.message || health.error) || "本地引擎未就绪"));
    }
    return { ...health, baseUrl: normalizeLocalAiBaseUrl(health.baseUrl || normalizedBaseUrl) };
  }

  function discoverCompatibleEngine() {
    return new Promise((resolve, reject) => {
      let settled = false;
      let remaining = LOCAL_AI_BASE_URLS.length;
      let lastError = null;
      LOCAL_AI_BASE_URLS.forEach((baseUrl) => {
        getEngineHealth(baseUrl).then((health) => {
          if (settled) return;
          settled = true;
          resolve(health);
        }).catch((error) => {
          lastError = error;
          remaining -= 1;
          if (!settled && remaining === 0) {
            reject(lastError || new Error("未找到可用的 PixelRunner Local AI 服务"));
          }
        });
      });
    });
  }

  function markEngineReady(health) {
    state.engine = health;
    state.engineReady = true;
    state.baseUrl = normalizeLocalAiBaseUrl(health && health.baseUrl);
    setEngineMeta(health);
    setStatus(`本地引擎已就绪：${getEngineLabel(health)}`, "success");
    setProgress("等待开始", "自动范围 · 原生 4x", 0, "idle");
  }

  function markEngineUnavailable(error, options = {}) {
    const startupFailed = options.startupFailed === true;
    state.engine = null;
    state.engineReady = false;
    state.baseUrl = LOCAL_AI_BASE_URL;
    setEngineMeta(null);
    setStatus(
      startupFailed
        ? "本地模型暂未启动成功；点击“重新检测”会再次启动。"
        : "本地模型尚未启动；打开本地超分后会自动启动并加载。",
      startupFailed ? "warn" : "info"
    );
    const quickBadge = getById("localUpscaleQuickBadge");
    if (quickBadge) quickBadge.textContent = startupFailed ? "可重新启动" : "打开后自动启动";
    const meta = getById("localUpscaleEngineMeta");
    if (meta) meta.textContent = "Real-ESRGAN x4plus · 打开面板后自动加载";
    setProgress("等待启动", "打开面板后自动加载本地模型", 0, "idle");
    if (startupFailed) console.warn("[PixelRunner/WebView] local upscale engine start failed", error);
  }

  function closePanel() {
    const capture = state.currentCapture;
    state.engineSessionActive = false;
    state.engineSessionId += 1;
    clearPollTimer();
    state.currentJobId = "";
    state.currentCapture = null;
    void cleanupCaptureSelectionSnapshot(capture);
    setRunning(false);
    void stopEngine();
    if (modules.workspace && typeof modules.workspace.setModalOpen === "function") {
      modules.workspace.setModalOpen("localUpscaleModal", false);
    }
  }

  function isCurrentEngineSession(sessionId) {
    return state.engineSessionActive && state.engineSessionId === sessionId;
  }

  async function stopEngine() {
    if (state.shutdownPromise) return state.shutdownPromise;
    clearPollTimer();
    const activeBaseUrl = state.baseUrl;
    state.shutdownPromise = (async () => {
      try {
        await callLocalUpscaleService(
          "localUpscale.stopEngine",
          buildLocalUpscaleArgs({}, activeBaseUrl),
          { timeoutMs: 8000 }
        );
      } catch (error) {
        // A service that failed to start or has already exited needs no further cleanup.
        console.warn("[PixelRunner/WebView] localUpscale shutdown unavailable", error);
      } finally {
        state.engine = null;
        state.engineReady = false;
        state.baseUrl = LOCAL_AI_BASE_URL;
        setRunning(false);
      }
    })();
    try {
      return await state.shutdownPromise;
    } finally {
      state.shutdownPromise = null;
    }
  }

  function sendShutdownBeacon() {
    if (!state.engineSessionActive || state.shutdownBeaconSent || !modules.runtime.isPluginRuntime()) return;
    state.engineSessionActive = false;
    state.shutdownBeaconSent = true;
    clearPollTimer();
    const activeBaseUrl = normalizeLocalAiBaseUrl(state.baseUrl);
    const payload = JSON.stringify({
      protocolVersion: LOCAL_AI_PROTOCOL_VERSION,
      buildId: LOCAL_AI_BUILD_ID
    });
    try {
      if (global.navigator && typeof global.navigator.sendBeacon === "function") {
        const body = typeof Blob === "function"
          ? new Blob([payload], { type: "application/json" })
          : payload;
        if (global.navigator.sendBeacon(`${activeBaseUrl}/v1/shutdown`, body)) return;
      }
      if (typeof global.fetch === "function") {
        void global.fetch(`${activeBaseUrl}/v1/shutdown`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: payload,
          keepalive: true
        });
      }
    } catch (_) {
      // The host may already be tearing down its WebView.
    }
  }

  async function refreshEngineHealth(options = {}) {
    if (modules.license && !modules.license.isFeatureUnlocked("localUpscale")) {
      state.engine = null;
      state.engineReady = false;
      setRunning(false);
      return null;
    }
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
      const health = await discoverCompatibleEngine();
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
    if (modules.license && !modules.license.requireFeature("localUpscale")) return null;
    if (state.engineReady) return state.engine;
    if (state.engineStartPromise) return state.engineStartPromise;

    state.engineStartPromise = (async () => {
      const sessionId = state.engineSessionId;
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
            const health = await discoverCompatibleEngine();
            if (!isCurrentEngineSession(sessionId)) {
              await stopEngine();
              return null;
            }
            markEngineReady(health);
            return health;
          } catch (error) {
            lastError = error;
            await wait(ENGINE_START_POLL_INTERVAL_MS);
          }
        }
        throw lastError || new Error("PixelRunner Local AI 启动超时");
      } catch (error) {
        markEngineUnavailable(error, { startupFailed: true });
        setProgress("等待重新启动", "点击“重新检测”再次启动本地模型", 0, "idle");
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
    const capture = state.currentCapture;
    if (!capture || !capture.documentId || !capture.targetWidth || !capture.targetHeight) {
      throw new Error("本地超分缺少原文档回贴信息");
    }
    const resultSource = resolveLocalUpscaleResultSource(job, capture);
    setProgress("正在回贴 Photoshop", getCaptureLabel(capture), 88, "running");
    const result = await modules.runtime.callHost("photoshop.placeLocalUpscaleResult", [{
      filePath: resultSource.filePath,
      url: resultSource.resultUrl,
      taskId: state.currentJobId,
      targetDocumentId: capture.documentId,
      targetWidth: capture.targetWidth,
      targetHeight: capture.targetHeight,
      targetBounds: capture.targetBounds,
      captureBounds: capture.captureBounds,
      captureMode: capture.captureMode,
      padding: capture.padding,
      selectionSnapshotChannelName: capture.selectionSnapshotChannelName,
      restoreActiveLayerId: capture.restoreActiveLayerId,
    }], { timeoutMs: 360000 });
    const document = result && result.document ? result.document : {};
    const size = Number(document.width) && Number(document.height)
      ? `${Math.round(Number(document.width))} x ${Math.round(Number(document.height))}`
      : `${Math.round(Number(capture.targetWidth))} x ${Math.round(Number(capture.targetHeight))}`;
    if (result && result.document) modules.state.state.currentDocumentInfo = result.document;
    try {
      await callLocalUpscaleService("localUpscale.recordPlacement", buildLocalUpscaleArgs({
        jobId: state.currentJobId,
        width: Number(document.width) || Number(capture.targetWidth) || 0,
        height: Number(document.height) || Number(capture.targetHeight) || 0,
        layerId: Number(result && result.layerId) || 0,
        documentId: Number(document.documentId) || Number(capture.documentId) || 0
      }), { timeoutMs: 15000 });
    } catch (error) {
      console.warn("[PixelRunner/WebView] localUpscale placement diagnostics unavailable", error);
    }
    setProgress("超分完成", `${getCaptureLabel(capture)} · ${size}`, 100, "success");
    setStatus(`已回贴到原文档的新图层：${String(capture.captureMode) === "selection" ? "选区超分" : "整图超分"} · ${size}`, "success");
    if (modules.ui && typeof modules.ui.logToWorkspace === "function") {
      modules.ui.logToWorkspace(`本地超分已完成，${String(capture.captureMode) === "selection" ? "选区" : "整图"}结果已回贴到原文档新图层（${size}）。`, "success");
    }
  }

  function schedulePoll() {
    clearPollTimer();
    state.pollTimer = global.setTimeout(() => {
      void pollCurrentJob();
    }, POLL_INTERVAL_MS);
  }

  async function pollCurrentJob() {
    if (!state.running || !state.currentJobId || !state.engineSessionActive) return;
    const jobId = state.currentJobId;
    try {
      const job = await callLocalUpscaleService(
        "localUpscale.getJob",
        buildLocalUpscaleArgs({ jobId }),
        { timeoutMs: 15000 }
      );
      if (!state.running || state.currentJobId !== jobId || !state.engineSessionActive) return;
      const status = normalizeStatus(job && job.status);
      const progress = Number(job && job.progress);
      const inferenceProgress = getInferenceProgress(job);
      const label = STATUS_LABELS[status] || "正在处理";
      const isInference = ["running", "processing"].includes(status);
      const detail = isInference
        ? `${formatInferenceProgress(job)} · Vulkan 4x`
        : `${getCaptureProgressLabel(state.currentCapture)} · ${String(job && (job.message || job.stage) || "原生 4x").trim()}`;
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
      setProgress(label, detail, isInference && inferenceProgress !== null ? inferenceProgress : Number.isFinite(progress) ? progress : 0, "running");
      schedulePoll();
    } catch (error) {
      const wasCancelled = /取消/.test(String(error && error.message || ""));
      setProgress(wasCancelled ? "已取消" : "本地超分失败", String(error.message || error), 100, wasCancelled ? "idle" : "error");
      setStatus(wasCancelled ? "本地超分已取消。" : `本地超分失败：${error.message}`, wasCancelled ? "warn" : "error");
      if (modules.ui && typeof modules.ui.logToWorkspace === "function") {
        modules.ui.logToWorkspace(`本地超分${wasCancelled ? "已取消" : `失败：${error.message}`}`, wasCancelled ? "info" : "error");
      }
      const failedCapture = state.currentCapture;
      state.currentJobId = "";
      state.currentCapture = null;
      await cleanupCaptureSelectionSnapshot(failedCapture);
      setRunning(false);
    }
  }

  async function startUpscale() {
    if (modules.license && !modules.license.requireFeature("localUpscale")) return;
    if (state.running) return;
    if (!modules.runtime.isPluginRuntime()) {
      setStatus("浏览器预览模式下不可执行本地超分。", "warn");
      return;
    }
    const sessionId = state.engineSessionId;
    if (!state.engineReady && !await ensureEngineReady(true)) return;
    if (!isCurrentEngineSession(sessionId)) return;

    const tileInput = getById("localUpscaleTileInput");
    const modeInput = getById("localUpscaleModeInput");
    const ttaInput = getById("localUpscaleTtaInput");
    const debugInput = getById("localUpscaleDebugInput");
    const tile = Math.max(32, Math.min(1024, Math.floor(Number(tileInput && tileInput.value) || 128)));
    const tta = Boolean(ttaInput && ttaInput.checked);
    const debug = Boolean(debugInput && debugInput.checked);
    const mode = String(modeInput && modeInput.value || "auto").trim() || "auto";
    state.currentJobId = modules.runtime.createId("local-upscale");
    setRunning(true);
    setProgress("正在导出无损图像", mode === "full" ? "整图超分 · 原生 4x" : "正在检测 Photoshop 选区 · 原生 4x", 12, "running");
    setStatus("正在从 Photoshop 导出无损 PNG...", "info");

    try {
      const activeDocumentInfo = modules.workspace && typeof modules.workspace.refreshPhotoshopDocumentStatus === "function"
        ? await modules.workspace.refreshPhotoshopDocumentStatus({ quiet: true })
        : modules.state.state.currentDocumentInfo;
      if (!activeDocumentInfo || !activeDocumentInfo.hasActiveDocument || !(Number(activeDocumentInfo.documentId) > 0)) {
        throw new Error("没有可用于本地超分的 Photoshop 文档，请打开文档后重试");
      }
      if (!isCurrentEngineSession(sessionId)) return;
      const capture = await modules.runtime.callHost("photoshop.captureLocalUpscaleSource", [{
        taskId: state.currentJobId,
        expectedDocumentId: Number(activeDocumentInfo.documentId),
        mode
      }], { timeoutMs: 300000 });
      if (!capture || !capture.inputPath || !capture.outputPath) {
        throw new Error("Photoshop 未返回本地超分源文件");
      }
      if (!isCurrentEngineSession(sessionId)) {
        await cleanupCaptureSelectionSnapshot(capture);
        return;
      }
      state.currentCapture = capture;
      const sourceSize = `${Math.round(Number(capture.width) || 0)} x ${Math.round(Number(capture.height) || 0)}`;
      setProgress("正在提交本地引擎", `${getCaptureLabel(capture)} · 输入 ${sourceSize}`, 28, "running");
      const job = await callLocalUpscaleService("localUpscale.submitJob", buildLocalUpscaleArgs({
        jobId: state.currentJobId,
        inputPath: capture.inputPath,
        outputPath: capture.outputPath,
        scale: 1,
        tile,
        tta,
        debug,
        targetWidth: capture.targetWidth,
        targetHeight: capture.targetHeight
      }), { timeoutMs: 20000 });
      if (!isCurrentEngineSession(sessionId)) {
        await cleanupCaptureSelectionSnapshot(capture);
        return;
      }
      const jobId = String(job && job.jobId || state.currentJobId).trim();
      if (!jobId) throw new Error("本地引擎未返回任务编号");
      state.currentJobId = jobId;
      setStatus(`已提交${String(capture.captureMode) === "selection" ? "选区" : "整图"}超分：${sourceSize} · 原生 4x`, "info");
      setProgress("正在排队", `${getCaptureLabel(capture)} · 输入 ${sourceSize}`, 36, "running");
      schedulePoll();
    } catch (error) {
      if (!isCurrentEngineSession(sessionId)) return;
      setProgress("本地超分失败", String(error.message || error), 100, "error");
      setStatus(`本地超分失败：${error.message}`, "error");
      if (modules.ui && typeof modules.ui.logToWorkspace === "function") {
        modules.ui.logToWorkspace(`本地超分失败：${error.message}`, "error");
      }
      const failedCapture = state.currentCapture;
      state.currentJobId = "";
      state.currentCapture = null;
      await cleanupCaptureSelectionSnapshot(failedCapture);
      setRunning(false);
    }
  }

  async function cancelUpscale() {
    if (!state.running || !state.currentJobId) return;
    const jobId = state.currentJobId;
    setProgress("正在取消", "等待本地引擎停止", 60, "running");
    try {
      await callLocalUpscaleService(
        "localUpscale.cancelJob",
        buildLocalUpscaleArgs({ jobId }),
        { timeoutMs: 15000 }
      );
      clearPollTimer();
      const cancelledCapture = state.currentCapture;
      state.currentJobId = "";
      state.currentCapture = null;
      await cleanupCaptureSelectionSnapshot(cancelledCapture);
      setRunning(false);
      setProgress("已取消", "自动范围 · 原生 4x", 0, "idle");
      setStatus("本地超分已取消。", "warn");
    } catch (error) {
      setStatus(`取消任务失败：${error.message}`, "error");
      schedulePoll();
    }
  }

  function openPanel() {
    if (modules.license && !modules.license.requireFeature("localUpscale")) return;
    state.engineSessionActive = true;
    state.shutdownBeaconSent = false;
    state.engineSessionId += 1;
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
    global.addEventListener("pagehide", sendShutdownBeacon);
    global.addEventListener("beforeunload", sendShutdownBeacon);
    setRunning(false);
  }

  function initialize() {
    if (!modules.license || modules.license.isFeatureUnlocked("localUpscale")) {
      void refreshEngineHealth({ quiet: true });
    }
  }

  modules.localUpscale = {
    bindActions,
    initialize,
    openPanel,
    refreshEngineHealth
  };
})(window);
