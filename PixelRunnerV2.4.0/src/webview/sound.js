(function initSoundModule(global) {
  const modules = (global.PixelRunnerModules = global.PixelRunnerModules || {});
  const PLAYER_READY = "pixelrunner.sound.ready";
  const PLAYER_PLAYBACK = "pixelrunner.sound.playback";

  const localState = {
    initialized: false,
    enabled: true,
    playerReady: false,
    lastActiveTaskCount: 0,
    queueArmed: false,
    preferenceLoaded: false,
    preferenceVersion: 0
  };

  function getStorageKey() {
    return (modules.state && modules.state.STORAGE_KEYS && modules.state.STORAGE_KEYS.SOUND_ENABLED) || "pixelrunner.sound_enabled";
  }

  function getToggleButton() {
    return modules.runtime.getById("btnSoundToggle");
  }

  function getPlayerFrame() {
    return modules.runtime.getById("soundPlayerFrame");
  }

  function syncState() {
    if (modules.state && modules.state.state && modules.state.state.sound) {
      modules.state.state.sound.enabled = Boolean(localState.enabled);
      modules.state.state.sound.playerReady = Boolean(localState.playerReady);
    }
  }

  function updateToggleUi() {
    const button = getToggleButton();
    if (!button) return;
    const enabled = Boolean(localState.enabled);
    button.dataset.enabled = enabled ? "true" : "false";
    button.setAttribute("aria-pressed", enabled ? "true" : "false");
    button.title = enabled ? "任务完成提示音已开启" : "任务完成提示音已关闭";
  }

  function postToPlayer(message) {
    const frame = getPlayerFrame();
    if (!frame || !frame.contentWindow) return false;
    try {
      frame.contentWindow.postMessage(message, "*");
      return true;
    } catch (_) {
      return false;
    }
  }

  function syncPlayerConfig() {
    postToPlayer({
      type: "pixelrunner.sound.config",
      enabled: Boolean(localState.enabled)
    });
  }

  async function persistEnabledState() {
    try {
      await modules.runtime.storageSetItem(getStorageKey(), localState.enabled ? "true" : "false");
    } catch (_) {}
  }

  async function loadEnabledState() {
    const currentVersion = ++localState.preferenceVersion;
    let enabled = true;
    try {
      const raw = await modules.runtime.storageGetItem(getStorageKey());
      if (raw != null) {
        const marker = String(raw).trim().toLowerCase();
        enabled = !["false", "0", "off", "no"].includes(marker);
      }
    } catch (_) {}
    if (currentVersion !== localState.preferenceVersion) return;
    localState.enabled = enabled;
    localState.preferenceLoaded = true;
    syncState();
    updateToggleUi();
    syncPlayerConfig();
  }

  function logSoundMessage(message, type = "info") {
    if (modules.ui && typeof modules.ui.logToWorkspace === "function") {
      modules.ui.logToWorkspace(message, type);
    }
  }

  async function playCompletionSound(reason = "queue-empty") {
    if (!localState.enabled) return false;

    const posted = postToPlayer({
      type: "pixelrunner.sound.play",
      reason
    });
    if (posted) return true;

    try {
      const audio = new Audio("./video/提示音.MP3");
      audio.currentTime = 0;
      await audio.play();
      return true;
    } catch (error) {
      logSoundMessage(`提示音播放失败：${error.message || error}`, "warn");
      return false;
    }
  }

  async function toggleEnabled() {
    localState.preferenceVersion += 1;
    localState.preferenceLoaded = true;
    localState.enabled = !localState.enabled;
    syncState();
    updateToggleUi();
    syncPlayerConfig();
    await persistEnabledState();
    if (localState.enabled) {
      await playCompletionSound("toggle-preview");
    }
  }

  function handleQueueState(activeCount) {
    const count = Math.max(0, Number(activeCount) || 0);
    if (count > 0) {
      localState.queueArmed = true;
    } else if (localState.queueArmed && localState.lastActiveTaskCount > 0) {
      localState.queueArmed = false;
      void playCompletionSound("queue-empty");
    }
    localState.lastActiveTaskCount = count;
  }

  function handleWindowMessage(event) {
    const payload = event && event.data;
    if (!payload || typeof payload !== "object") return;

    if (payload.type === PLAYER_READY) {
      localState.playerReady = true;
      syncState();
      syncPlayerConfig();
      return;
    }

    if (payload.type === PLAYER_PLAYBACK && payload.ok === false) {
      logSoundMessage(`提示音播放失败：${payload.message || "未知原因"}`, "warn");
    }
  }

  function bindEvents() {
    const button = getToggleButton();
    if (button && !button.dataset.soundBound) {
      button.dataset.soundBound = "true";
      button.addEventListener("click", () => {
        void toggleEnabled();
      });
    }

    const frame = getPlayerFrame();
    if (frame && !frame.dataset.soundFrameBound) {
      frame.dataset.soundFrameBound = "true";
      frame.addEventListener("load", () => {
        syncPlayerConfig();
      });
    }

    if (!localState.initialized) {
      global.addEventListener("message", handleWindowMessage);
    }
  }

  function initialize() {
    bindEvents();
    syncState();
    updateToggleUi();
    void loadEnabledState();
    localState.initialized = true;
  }

  modules.sound = {
    initialize,
    handleQueueState,
    playCompletionSound,
    updateToggleUi
  };
})(window);
