(function initSoundModule(global) {
  const modules = (global.PixelRunnerModules = global.PixelRunnerModules || {});
  const PLAYER_READY = "pixelrunner.sound.ready";
  const PLAYER_PLAYBACK = "pixelrunner.sound.playback";
  const LONG_PRESS_MS = 520;
  const POPOVER_CLOSE_MS = 170;

  const localState = {
    initialized: false,
    enabled: true,
    volume: 80,
    muted: false,
    playerReady: false,
    lastActiveTaskCount: 0,
    queueArmed: false,
    preferenceLoaded: false,
    preferenceVersion: 0,
    popoverOpen: false,
    popoverCloseTimer: 0,
    longPressTimer: 0,
    longPressTriggered: false,
    activePointerId: null
  };

  function getEnabledStorageKey() {
    return (modules.state && modules.state.STORAGE_KEYS && modules.state.STORAGE_KEYS.SOUND_ENABLED) || "pixelrunner.sound_enabled";
  }

  function getVolumeStorageKey() {
    return (modules.state && modules.state.STORAGE_KEYS && modules.state.STORAGE_KEYS.SOUND_VOLUME) || "pixelrunner.sound_volume";
  }

  function getMutedStorageKey() {
    return (modules.state && modules.state.STORAGE_KEYS && modules.state.STORAGE_KEYS.SOUND_MUTED) || "pixelrunner.sound_muted";
  }

  function getToggleButton() {
    return modules.runtime.getById("btnSoundToggle");
  }

  function getPopover() {
    return modules.runtime.getById("soundVolumePopover");
  }

  function getVolumeSlider() {
    return modules.runtime.getById("soundVolumeSlider");
  }

  function getVolumeValue() {
    return modules.runtime.getById("soundVolumeValue");
  }

  function getMuteButton() {
    return modules.runtime.getById("btnSoundMute");
  }

  function getPreviewButton() {
    return modules.runtime.getById("btnSoundPreview");
  }

  function getPlayerFrame() {
    return modules.runtime.getById("soundPlayerFrame");
  }

  function clampVolume(value) {
    return Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
  }

  function isEffectivelyAudible() {
    return Boolean(localState.enabled && !localState.muted && localState.volume > 0);
  }

  function syncState() {
    if (modules.state && modules.state.state && modules.state.state.sound) {
      modules.state.state.sound.enabled = Boolean(localState.enabled);
      modules.state.state.sound.volume = clampVolume(localState.volume);
      modules.state.state.sound.muted = Boolean(localState.muted);
      modules.state.state.sound.playerReady = Boolean(localState.playerReady);
    }
  }

  function updateToggleUi() {
    const button = getToggleButton();
    if (!button) return;
    const enabled = Boolean(localState.enabled);
    button.dataset.enabled = enabled ? "true" : "false";
    button.dataset.muted = localState.muted ? "true" : "false";
    button.dataset.volume = String(clampVolume(localState.volume));
    button.setAttribute("aria-pressed", enabled ? "true" : "false");
    button.title = enabled
      ? "左键关闭提示音，右键或长按调节音量"
      : "左键开启提示音，右键或长按调节音量";
    button.setAttribute("aria-label", enabled ? "关闭任务完成提示音，右键或长按调节音量" : "开启任务完成提示音，右键或长按调节音量");
  }

  function updatePopoverUi() {
    const volume = clampVolume(localState.volume);
    const slider = getVolumeSlider();
    const valueEl = getVolumeValue();
    const muteButton = getMuteButton();

    if (slider && Number(slider.value) !== volume) slider.value = String(volume);
    if (valueEl) valueEl.textContent = localState.muted ? `静音 · ${volume}%` : `${volume}%`;
    if (muteButton) {
      muteButton.textContent = localState.muted ? "取消静音" : "静音";
      muteButton.setAttribute("aria-pressed", localState.muted ? "true" : "false");
      muteButton.title = localState.muted ? "取消静音" : "静音提示音";
    }
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
      enabled: Boolean(localState.enabled),
      volume: clampVolume(localState.volume) / 100,
      muted: Boolean(localState.muted)
    });
  }

  async function persistEnabledState() {
    try {
      await modules.runtime.storageSetItem(getEnabledStorageKey(), localState.enabled ? "true" : "false");
    } catch (_) {}
  }

  async function persistSoundPreferences() {
    await Promise.all([
      modules.runtime.storageSetItem(getEnabledStorageKey(), localState.enabled ? "true" : "false"),
      modules.runtime.storageSetItem(getVolumeStorageKey(), String(clampVolume(localState.volume))),
      modules.runtime.storageSetItem(getMutedStorageKey(), localState.muted ? "true" : "false")
    ].map((promise) => promise.catch ? promise.catch(() => {}) : promise));
  }

  async function loadPreferences() {
    const currentVersion = ++localState.preferenceVersion;
    let enabled = true;
    let volume = 80;
    let muted = false;
    try {
      const raw = await modules.runtime.storageGetItem(getEnabledStorageKey());
      if (raw != null) {
        const marker = String(raw).trim().toLowerCase();
        enabled = !["false", "0", "off", "no"].includes(marker);
      }
    } catch (_) {}
    try {
      const rawVolume = await modules.runtime.storageGetItem(getVolumeStorageKey());
      if (rawVolume != null && String(rawVolume).trim() !== "") {
        volume = clampVolume(rawVolume);
      }
    } catch (_) {}
    try {
      const rawMuted = await modules.runtime.storageGetItem(getMutedStorageKey());
      if (rawMuted != null) {
        const marker = String(rawMuted).trim().toLowerCase();
        muted = ["true", "1", "on", "yes"].includes(marker);
      }
    } catch (_) {}
    if (currentVersion !== localState.preferenceVersion) return;
    localState.enabled = enabled;
    localState.volume = volume;
    localState.muted = muted;
    localState.preferenceLoaded = true;
    syncState();
    updateToggleUi();
    updatePopoverUi();
    syncPlayerConfig();
  }

  function logSoundMessage(message, type = "info") {
    if (modules.ui && typeof modules.ui.logToWorkspace === "function") {
      modules.ui.logToWorkspace(message, type);
    }
  }

  async function playCompletionSound(reason = "queue-empty") {
    if (!isEffectivelyAudible()) return false;

    const posted = postToPlayer({
      type: "pixelrunner.sound.play",
      reason,
      volume: clampVolume(localState.volume) / 100,
      muted: Boolean(localState.muted)
    });
    if (posted) return true;

    try {
      const audio = new Audio("./video/提示音.MP3");
      audio.volume = clampVolume(localState.volume) / 100;
      audio.muted = Boolean(localState.muted);
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
    updatePopoverUi();
    syncPlayerConfig();
    await persistEnabledState();
    if (localState.enabled) {
      await playCompletionSound("toggle-preview");
    }
  }

  async function setVolume(value, options = {}) {
    localState.preferenceVersion += 1;
    localState.preferenceLoaded = true;
    localState.volume = clampVolume(value);
    if (localState.volume > 0 && options.unmute !== false) {
      localState.muted = false;
    }
    syncState();
    updateToggleUi();
    updatePopoverUi();
    syncPlayerConfig();
    await persistSoundPreferences();
  }

  async function toggleMuted() {
    localState.preferenceVersion += 1;
    localState.preferenceLoaded = true;
    localState.muted = !localState.muted;
    syncState();
    updateToggleUi();
    updatePopoverUi();
    syncPlayerConfig();
    await persistSoundPreferences();
    if (!localState.muted) {
      await playCompletionSound("volume-preview");
    }
  }

  function positionPopover() {
    const button = getToggleButton();
    const popover = getPopover();
    if (!button || !popover || !button.getBoundingClientRect) return;
    const buttonRect = button.getBoundingClientRect();
    const popoverRect = popover.getBoundingClientRect();
    const width = popoverRect.width || 240;
    const height = popoverRect.height || 130;
    const margin = 8;
    const left = Math.max(margin, Math.min(global.innerWidth - width - margin, buttonRect.right - width));
    const preferredTop = buttonRect.bottom + margin;
    const top = preferredTop + height + margin <= global.innerHeight
      ? preferredTop
      : Math.max(margin, buttonRect.top - height - margin);
    popover.style.left = `${Math.round(left)}px`;
    popover.style.top = `${Math.round(top)}px`;
  }

  function openPopover() {
    const popover = getPopover();
    if (!popover) return;
    if (localState.popoverCloseTimer) {
      global.clearTimeout(localState.popoverCloseTimer);
      localState.popoverCloseTimer = 0;
    }
    popover.hidden = false;
    popover.classList.remove("is-closing");
    updatePopoverUi();
    positionPopover();
    popover.classList.add("is-open");
    localState.popoverOpen = true;
    const slider = getVolumeSlider();
    if (slider && typeof slider.focus === "function") {
      global.setTimeout(() => {
        try {
          slider.focus({ preventScroll: true });
        } catch (_) {
          slider.focus();
        }
      }, 0);
    }
  }

  function closePopover() {
    const popover = getPopover();
    if (!popover || popover.hidden) return;
    popover.classList.remove("is-open");
    popover.classList.add("is-closing");
    localState.popoverOpen = false;
    if (localState.popoverCloseTimer) global.clearTimeout(localState.popoverCloseTimer);
    localState.popoverCloseTimer = global.setTimeout(() => {
      popover.classList.remove("is-closing");
      popover.hidden = true;
      localState.popoverCloseTimer = 0;
    }, POPOVER_CLOSE_MS);
  }

  function cancelLongPress() {
    if (localState.longPressTimer) {
      global.clearTimeout(localState.longPressTimer);
      localState.longPressTimer = 0;
    }
    localState.activePointerId = null;
  }

  function handlePointerDown(event) {
    if (!event || event.button === 2) return;
    cancelLongPress();
    localState.longPressTriggered = false;
    localState.activePointerId = event.pointerId;
    localState.longPressTimer = global.setTimeout(() => {
      localState.longPressTimer = 0;
      localState.longPressTriggered = true;
      openPopover();
      try {
        event.preventDefault();
      } catch (_) {}
    }, LONG_PRESS_MS);
  }

  function handlePointerUp(event) {
    if (localState.activePointerId != null && event && event.pointerId != null && event.pointerId !== localState.activePointerId) return;
    cancelLongPress();
  }

  function handleDocumentPointerDown(event) {
    if (!localState.popoverOpen) return;
    const popover = getPopover();
    const button = getToggleButton();
    const target = event && event.target;
    if (popover && target && popover.contains(target)) return;
    if (button && target && button.contains(target)) return;
    closePopover();
  }

  function handleKeyDown(event) {
    if (!event) return;
    if (event.key === "Escape" && localState.popoverOpen) {
      event.preventDefault();
      closePopover();
      const button = getToggleButton();
      if (button && typeof button.focus === "function") button.focus();
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
      button.addEventListener("click", (event) => {
        if (localState.longPressTriggered) {
          localState.longPressTriggered = false;
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        void toggleEnabled();
      });
      button.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        openPopover();
      });
      button.addEventListener("pointerdown", handlePointerDown);
      button.addEventListener("pointerup", handlePointerUp);
      button.addEventListener("pointercancel", handlePointerUp);
      button.addEventListener("pointerleave", handlePointerUp);
    }

    const slider = getVolumeSlider();
    if (slider && !slider.dataset.soundVolumeBound) {
      slider.dataset.soundVolumeBound = "true";
      slider.addEventListener("input", () => {
        void setVolume(slider.value);
      });
      slider.addEventListener("change", () => {
        void setVolume(slider.value);
      });
    }

    const muteButton = getMuteButton();
    if (muteButton && !muteButton.dataset.soundMuteBound) {
      muteButton.dataset.soundMuteBound = "true";
      muteButton.addEventListener("click", () => {
        void toggleMuted();
      });
    }

    const previewButton = getPreviewButton();
    if (previewButton && !previewButton.dataset.soundPreviewBound) {
      previewButton.dataset.soundPreviewBound = "true";
      previewButton.addEventListener("click", () => {
        void playCompletionSound("volume-preview");
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
      document.addEventListener("pointerdown", handleDocumentPointerDown, true);
      document.addEventListener("keydown", handleKeyDown);
      global.addEventListener("resize", () => {
        if (localState.popoverOpen) positionPopover();
      });
      global.addEventListener("blur", () => {
        closePopover();
      });
      document.addEventListener("visibilitychange", () => {
        if (document.hidden) closePopover();
      });
    }
  }

  function initialize() {
    bindEvents();
    syncState();
    updateToggleUi();
    updatePopoverUi();
    void loadPreferences();
    localState.initialized = true;
  }

  modules.sound = {
    initialize,
    handleQueueState,
    playCompletionSound,
    updateToggleUi,
    openVolumePopover: openPopover,
    closeVolumePopover: closePopover
  };
})(window);
