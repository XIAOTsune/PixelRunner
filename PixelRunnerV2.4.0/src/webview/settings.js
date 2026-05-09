(function initSettingsModule(global) {
  const modules = (global.PixelRunnerModules = global.PixelRunnerModules || {});
  let accountRefreshPromise = null;

  function renderSettingsStatus(message, type = "info") {
    modules.runtime.setSummaryStatus(modules.runtime.getById("settingsStatusSummary"), message, type);
  }

  function renderSettingsDiagnostics(message, options = {}) {
    const box = modules.runtime.getById("settingsDiagnosticBox");
    if (!box) return;

    const runtimeText = options.runtime ? `<p>宿主环境：${modules.runtime.escapeHtml(options.runtime)}</p>` : "";
    const apiKeyText = options.hasApiKey
      ? "<p>API Key：已配置，会写入宿主本地存储。</p>"
      : "<p>API Key：尚未配置。</p>";
    const appText = `<p>已保存应用：${modules.runtime.escapeHtml(String(modules.state.state.apps.length))} 个。</p>`;
    const templateText = `<p>已保存模板：${modules.runtime.escapeHtml(String(modules.state.state.templates.length))} 条。</p>`;
    const currentApp = modules.state.state.currentApp;
    const currentAppText = currentApp
      ? `<p>当前应用：${modules.runtime.escapeHtml(modules.state.getAppDisplayName(currentApp))}。</p>`
      : "<p>当前应用：尚未选择。</p>";

    box.innerHTML = `<p>${modules.runtime.escapeHtml(String(message || ""))}</p>${runtimeText}${apiKeyText}${appText}${templateText}${currentAppText}`;
  }

  function updateAccountSummary(account) {
    const balanceEl = modules.runtime.getById("accountBalanceValue");
    const coinsEl = modules.runtime.getById("accountCoinsValue");
    const summaryEl = modules.runtime.getById("accountSummary");
    if (!balanceEl || !coinsEl || !summaryEl) return;

    const hasAccount = account && account.ok;
    balanceEl.textContent = hasAccount && account.balance != null ? String(account.balance) : "--";
    coinsEl.textContent = hasAccount && account.coins != null ? String(account.coins) : "--";
    summaryEl.classList.toggle("is-empty", !hasAccount);
    modules.state.state.accountSummary = {
      balance: hasAccount && account.balance != null ? Number(account.balance) : null,
      coins: hasAccount && account.coins != null ? Number(account.coins) : null,
      updatedAt: Date.now()
    };
  }

  function setApiKeyVisibility(visible) {
    const input = modules.runtime.getById("settingsApiKeyInput");
    const toggleButton = modules.runtime.getById("btnResetSettings");
    const nextVisible = Boolean(visible);
    if (input) {
      input.type = nextVisible ? "text" : "password";
    }
    if (toggleButton) {
      toggleButton.dataset.visible = nextVisible ? "true" : "false";
      toggleButton.setAttribute("aria-pressed", nextVisible ? "true" : "false");
      toggleButton.setAttribute("aria-label", nextVisible ? "隐藏 API Key" : "显示 API Key");
      toggleButton.setAttribute("title", nextVisible ? "隐藏 API Key" : "显示 API Key");
    }
  }

  async function refreshAccountSummary(options = {}) {
    const apiKey = String((options.apiKey != null ? options.apiKey : modules.state.state.settings.apiKey) || "").trim();
    if (!apiKey || !modules.runtime.isPluginRuntime()) {
      updateAccountSummary(null);
      return null;
    }

    if (!options.force && accountRefreshPromise) {
      return accountRefreshPromise;
    }

    accountRefreshPromise = modules.runtime
      .callHost("runninghub.fetchAccountStatus", [{ apiKey }], { timeoutMs: 15000 })
      .then((account) => {
        updateAccountSummary(account);
        return account;
      })
      .catch((error) => {
        if (!options.quiet && modules.ui && typeof modules.ui.logToWorkspace === "function") {
          modules.ui.logToWorkspace(`余额刷新失败：${error.message || error}`, "warn");
        }
        updateAccountSummary(null);
        return null;
      })
      .finally(() => {
        accountRefreshPromise = null;
      });

    return accountRefreshPromise;
  }

  function formatParseDebug(debugRecord) {
    if (!debugRecord || typeof debugRecord !== "object") return "暂无解析调试记录。";
    return JSON.stringify(debugRecord, null, 2);
  }

  async function loadParseDebug() {
    const box = modules.runtime.getById("parseDebugOutput");
    const raw = await modules.runtime.storageGetItem("rh_last_parse_debug");
    const parsed = modules.runtime.readJsonText(raw, null);
    const text = formatParseDebug(parsed);
    if (box) box.textContent = text;
    return parsed;
  }

  function fillSettingsForm(settings) {
    if (modules.runtime.getById("settingsApiKeyInput")) modules.runtime.getById("settingsApiKeyInput").value = settings.apiKey || "";
    if (modules.runtime.getById("settingsPollIntervalInput")) {
      modules.runtime.getById("settingsPollIntervalInput").value = String(
        settings.pollInterval ?? modules.state.DEFAULT_SETTINGS.pollInterval
      );
    }
    if (modules.runtime.getById("settingsTimeoutInput")) {
      modules.runtime.getById("settingsTimeoutInput").value = String(
        settings.timeout ?? modules.state.DEFAULT_SETTINGS.timeout
      );
    }
    if (modules.runtime.getById("settingsMaxConcurrentTasksInput")) {
      modules.runtime.getById("settingsMaxConcurrentTasksInput").value = String(
        settings.maxConcurrentTasks ?? modules.state.DEFAULT_SETTINGS.maxConcurrentTasks
      );
    }
    if (modules.runtime.getById("settingsAiOptimizeAppIdInput")) {
      modules.runtime.getById("settingsAiOptimizeAppIdInput").value = String(
        settings.aiOptimizeAppId ?? modules.state.DEFAULT_AI_OPTIMIZE_APP_ID
      );
    }
  }

  const THEME_PRESETS = {
    classic: {
      "--bg-top": "#111822",
      "--bg-mid": "#18212d",
      "--bg-bottom": "#0c1219",
      "--panel": "#18222d",
      "--panel-soft": "#1f2b37",
      "--panel-strong": "#243342",
      "--ink": "#304150",
      "--surface-rgb": "31, 45, 59",
      "--surface-soft-rgb": "35, 49, 62",
      "--control-rgb": "68, 96, 121",
      "--control-edge": "#35506a",
      "--control-ink": "#203648",
      "--surface-alpha": "0.96",
      "--surface-soft-alpha": "0.9",
      "--surface-glass-alpha": "0.62",
      "--theme-image-overlay": "rgba(8, 12, 18, 0.48)",
      "--accent": "#63d67b",
      "--accent-strong": "#28c45b",
      "--accent-soft": "rgba(99, 214, 123, 0.16)",
      "--accent-wash": "rgba(99, 214, 123, 0.09)",
      "--cta": "#a9def2",
      "--cta-strong": "#8ac6df"
    },
    aurora: {
      "--bg-top": "#0b1a20",
      "--bg-mid": "#14333b",
      "--bg-bottom": "#081318",
      "--panel": "#12313a",
      "--panel-soft": "#1a4550",
      "--panel-strong": "#245966",
      "--ink": "#2f6270",
      "--surface-rgb": "22, 58, 68",
      "--surface-soft-rgb": "27, 73, 84",
      "--control-rgb": "42, 116, 126",
      "--control-edge": "#2d7582",
      "--control-ink": "#082b2c",
      "--surface-alpha": "0.96",
      "--surface-soft-alpha": "0.9",
      "--surface-glass-alpha": "0.62",
      "--theme-image-overlay": "rgba(4, 24, 28, 0.46)",
      "--accent": "#74d8c7",
      "--accent-strong": "#35bfa8",
      "--accent-soft": "rgba(116, 216, 199, 0.18)",
      "--accent-wash": "rgba(116, 216, 199, 0.1)",
      "--cta": "#f4d47d",
      "--cta-strong": "#dbb95f"
    },
    graphite: {
      "--bg-top": "#12151a",
      "--bg-mid": "#202832",
      "--bg-bottom": "#0b0e13",
      "--panel": "#202832",
      "--panel-soft": "#2b3540",
      "--panel-strong": "#354250",
      "--ink": "#4b5c6d",
      "--surface-rgb": "35, 43, 52",
      "--surface-soft-rgb": "45, 56, 68",
      "--control-rgb": "77, 92, 108",
      "--control-edge": "#56687a",
      "--control-ink": "#172331",
      "--surface-alpha": "0.96",
      "--surface-soft-alpha": "0.9",
      "--surface-glass-alpha": "0.62",
      "--theme-image-overlay": "rgba(8, 11, 15, 0.48)",
      "--accent": "#9ab0c6",
      "--accent-strong": "#7f99b4",
      "--accent-soft": "rgba(154, 176, 198, 0.2)",
      "--accent-wash": "rgba(154, 176, 198, 0.11)",
      "--cta": "#d7e1ea",
      "--cta-strong": "#b7c7d5"
    },
    rose: {
      "--bg-top": "#1d1420",
      "--bg-mid": "#302234",
      "--bg-bottom": "#120d16",
      "--panel": "#2b1f30",
      "--panel-soft": "#3b2b41",
      "--panel-strong": "#513b58",
      "--ink": "#65496e",
      "--surface-rgb": "50, 36, 56",
      "--surface-soft-rgb": "66, 48, 73",
      "--control-rgb": "114, 76, 106",
      "--control-edge": "#7f5576",
      "--control-ink": "#371827",
      "--surface-alpha": "0.96",
      "--surface-soft-alpha": "0.9",
      "--surface-glass-alpha": "0.62",
      "--theme-image-overlay": "rgba(27, 10, 22, 0.46)",
      "--accent": "#ff9bb4",
      "--accent-strong": "#e87595",
      "--accent-soft": "rgba(255, 155, 180, 0.18)",
      "--accent-wash": "rgba(255, 155, 180, 0.1)",
      "--cta": "#aee7dd",
      "--cta-strong": "#7dd3c4"
    },
    studio: {
      "--bg-top": "#17171a",
      "--bg-mid": "#252823",
      "--bg-bottom": "#101111",
      "--panel": "#252823",
      "--panel-soft": "#33362e",
      "--panel-strong": "#424638",
      "--ink": "#585d4a",
      "--surface-rgb": "42, 45, 39",
      "--surface-soft-rgb": "58, 61, 51",
      "--control-rgb": "91, 99, 71",
      "--control-edge": "#69724d",
      "--control-ink": "#302a10",
      "--surface-alpha": "0.96",
      "--surface-soft-alpha": "0.9",
      "--surface-glass-alpha": "0.62",
      "--theme-image-overlay": "rgba(16, 16, 12, 0.46)",
      "--accent": "#ffd56a",
      "--accent-strong": "#e8b93b",
      "--accent-soft": "rgba(255, 213, 106, 0.18)",
      "--accent-wash": "rgba(255, 213, 106, 0.1)",
      "--cta": "#8fd6ff",
      "--cta-strong": "#65bce9"
    }
  };

  const CUSTOM_THEME_SKIN_SELECTORS = [
    ".view-nav",
    ".panel-header-strip",
    ".overlay-card",
    ".workspace-app-card",
    ".workspace-input-card",
    ".workspace-run-card",
    ".log-card",
    ".selection-meta",
    ".diagnostic-box",
    ".list-shell",
    ".picker-list",
    ".input-zone",
    ".field-input",
    ".summary-strip",
    ".picker-item",
    ".list-item",
    ".tool-item"
  ];

  const CUSTOM_THEME_DEEP_SELECTORS = [
    ".workspace-app-card",
    ".workspace-input-card",
    ".workspace-run-card",
    ".log-card",
    ".overlay-card"
  ];

  const CUSTOM_THEME_LIGHT_SELECTORS = [
    ".input-zone",
    ".field-input",
    ".workspace-app-meta",
    ".image-capture-stage",
    ".image-capture-preview"
  ];

  function makeThemeImageValue(dataUrl) {
    const value = String(dataUrl || "").trim();
    if (!value) return "";
    return `url(${JSON.stringify(value)})`;
  }

  function clearInlineThemeImages() {
    document.body.style.removeProperty("background-image");
    document.body.style.removeProperty("background-size");
    document.body.style.removeProperty("background-position");
    document.body.removeAttribute("data-custom-theme-image-ready");
    const elements = document.querySelectorAll(
      [...CUSTOM_THEME_SKIN_SELECTORS, ...CUSTOM_THEME_DEEP_SELECTORS, ...CUSTOM_THEME_LIGHT_SELECTORS].join(",")
    );
    elements.forEach((element) => {
      element.style.removeProperty("background-image");
      element.style.removeProperty("background-size");
      element.style.removeProperty("background-position");
      element.style.removeProperty("background-blend-mode");
    });
  }

  function applyInlineThemeImages(dataUrl) {
    const imageValue = makeThemeImageValue(dataUrl);
    clearInlineThemeImages();
    if (!imageValue) return false;

    document.body.style.backgroundImage = [
      "linear-gradient(180deg, rgba(9, 13, 18, 0.04), rgba(9, 13, 18, 0.1))",
      imageValue,
      "linear-gradient(180deg, var(--bg-top), var(--bg-bottom))"
    ].join(", ");
    document.body.style.backgroundSize = "cover";
    document.body.style.backgroundPosition = "center";
    document.body.dataset.customThemeImageReady = "true";

    return true;
  }

  function refreshThemeSkin() {
    const theme = modules.state && modules.state.state ? modules.state.state.theme : null;
    if (!theme || !theme.customImage) {
      clearInlineThemeImages();
      return false;
    }
    return applyInlineThemeImages(theme.customImage);
  }

  function applyTheme(theme) {
    const normalized = modules.state.normalizeTheme(theme);
    const root = document.documentElement;
    const presetName = normalized.preset === "custom" ? normalized.basePreset : normalized.preset;
    const preset = THEME_PRESETS[presetName] || THEME_PRESETS.classic;
    Object.entries(preset).forEach(([key, value]) => root.style.setProperty(key, value));
    document.body.classList.toggle("has-custom-theme-image", Boolean(normalized.customImage));
    document.body.classList.toggle("has-glass-theme", Boolean(normalized.glass));
    if (normalized.customImage) {
      const imageValue = makeThemeImageValue(normalized.customImage);
      root.style.setProperty("--theme-image", imageValue);
      root.style.setProperty("--surface-alpha", "0.24");
      root.style.setProperty("--surface-soft-alpha", "0.18");
      root.style.setProperty("--surface-glass-alpha", "0.14");
      applyInlineThemeImages(normalized.customImage);
    } else {
      root.style.removeProperty("--theme-image");
      clearInlineThemeImages();
    }
    modules.state.state.theme = normalized;

    const swatches = document.querySelectorAll("[data-theme-preset]");
    swatches.forEach((button) => {
      button.classList.toggle("is-selected", String(button.getAttribute("data-theme-preset")) === presetName);
    });
    const statusEl = modules.runtime.getById("themeStatusSummary");
    if (statusEl) {
      modules.runtime.setSummaryStatus(
        statusEl,
        normalized.customImage
          ? `自定义主题已启用：${normalized.customImageName || "背景照片"}，背景已写入界面皮肤。`
          : `已启用${normalized.preset === "classic" ? "经典" : "预设"}主题。`,
        "success"
      );
    }
  }

  async function saveThemeSnapshot(theme) {
    const normalized = modules.state.normalizeTheme(theme);
    await modules.runtime.storageSetItem(modules.state.STORAGE_KEYS.THEME, JSON.stringify(normalized));
    applyTheme(normalized);
    return normalized;
  }

  async function loadThemeSnapshot() {
    const raw = await modules.runtime.storageGetItem(modules.state.STORAGE_KEYS.THEME);
    return modules.state.normalizeTheme(modules.runtime.readJsonText(raw, modules.state.DEFAULT_THEME));
  }

  function readImageFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("读取主题照片失败，请换一张图片重试。"));
      reader.readAsDataURL(file);
    });
  }

  function compressThemeImageDataUrl(dataUrl, options = {}) {
    const source = String(dataUrl || "").trim();
    if (!source) return Promise.resolve("");
    const maxWidth = Math.max(640, Number(options.maxWidth) || 1600);
    const quality = Math.max(0.55, Math.min(0.92, Number(options.quality) || 0.82));

    return new Promise((resolve) => {
      if (typeof Image === "undefined" || typeof document === "undefined") {
        resolve(source);
        return;
      }

      const image = new Image();
      image.onload = () => {
        const width = Number(image.naturalWidth || image.width || 0);
        const height = Number(image.naturalHeight || image.height || 0);
        if (!width || !height) {
          resolve(source);
          return;
        }

        const scale = Math.min(1, maxWidth / width);
        const targetWidth = Math.max(1, Math.round(width * scale));
        const targetHeight = Math.max(1, Math.round(height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = targetWidth;
        canvas.height = targetHeight;
        const context = canvas.getContext("2d");
        if (!context) {
          resolve(source);
          return;
        }

        context.drawImage(image, 0, 0, targetWidth, targetHeight);
        try {
          const compressed = canvas.toDataURL("image/jpeg", quality);
          resolve(compressed && compressed.length < source.length ? compressed : source);
        } catch (_) {
          resolve(source);
        }
      };
      image.onerror = () => resolve(source);
      image.src = source;
    });
  }

  function readSettingsForm() {
    return modules.state.normalizeSettings({
      apiKey: modules.runtime.getById("settingsApiKeyInput")?.value || "",
      pollInterval: modules.runtime.getById("settingsPollIntervalInput")?.value,
      timeout: modules.runtime.getById("settingsTimeoutInput")?.value,
      maxConcurrentTasks: modules.runtime.getById("settingsMaxConcurrentTasksInput")?.value,
      aiOptimizeAppId: modules.runtime.getById("settingsAiOptimizeAppIdInput")?.value || ""
    });
  }

  async function loadSettingsSnapshot() {
    const apiKey = String((await modules.runtime.storageGetItem(modules.state.STORAGE_KEYS.API_KEY)) || "").trim();
    const rawSettings = modules.runtime.readJsonText(await modules.runtime.storageGetItem(modules.state.STORAGE_KEYS.SETTINGS), {});
    return modules.state.normalizeSettings({
      apiKey,
      pollInterval: rawSettings && rawSettings.pollInterval,
      timeout: rawSettings && rawSettings.timeout,
      maxConcurrentTasks: rawSettings && rawSettings.maxConcurrentTasks,
      aiOptimizeAppId: rawSettings && rawSettings.aiOptimizeAppId
    });
  }

  async function saveSettingsSnapshot(settings) {
    const normalized = modules.state.normalizeSettings(settings);
    await modules.runtime.storageSetItem(modules.state.STORAGE_KEYS.API_KEY, normalized.apiKey);
    await modules.runtime.storageSetItem(
      modules.state.STORAGE_KEYS.SETTINGS,
      JSON.stringify({
        pollInterval: normalized.pollInterval,
        timeout: normalized.timeout,
        maxConcurrentTasks: normalized.maxConcurrentTasks,
        aiOptimizeAppId: normalized.aiOptimizeAppId
      })
    );

    modules.state.state.settings = normalized;
    modules.state.state.settingsLoaded = true;
    fillSettingsForm(normalized);
    if (modules.workspace && typeof modules.workspace.updateRunButtonState === "function") {
      modules.workspace.updateRunButtonState();
    }
    if (modules.workspace && typeof modules.workspace.renderWorkspace === "function") {
      modules.workspace.renderWorkspace();
    }
    renderSettingsStatus("设置已保存到宿主本地存储。", "success");
    renderSettingsDiagnostics("当前设置已同步。", {
      runtime: modules.state.state.hostRuntime,
      hasApiKey: Boolean(normalized.apiKey)
    });
    modules.ui.logToWorkspace(
      `设置已保存：轮询 ${normalized.pollInterval}s，超时 ${normalized.timeout}s，并发 ${normalized.maxConcurrentTasks} 个。`,
      "success"
    );
  }

  async function initializeSettings() {
    renderSettingsStatus("正在读取本地设置...", "info");
    try {
      if (modules.runtime.isPluginRuntime()) {
        const hostInfo = await modules.runtime.callHost("host.ping");
        modules.state.state.hostRuntime = hostInfo && hostInfo.runtime ? String(hostInfo.runtime) : "uxp-host";
      } else {
        modules.state.state.hostRuntime = "browser-preview";
      }
    } catch (_) {
      modules.state.state.hostRuntime = modules.runtime.isPluginRuntime() ? "uxp-host" : "browser-preview";
    }

    const snapshot = await loadSettingsSnapshot();
    const theme = await loadThemeSnapshot();
    modules.state.state.settings = snapshot;
    modules.state.state.settingsLoaded = true;
    fillSettingsForm(snapshot);
    applyTheme(theme);
    setApiKeyVisibility(false);
    renderSettingsStatus("设置已加载，可以直接修改并保存。", "success");
    renderSettingsDiagnostics("当前设置快照已读取完成。", {
      runtime: modules.state.state.hostRuntime,
      hasApiKey: Boolean(snapshot.apiKey)
    });

    await refreshAccountSummary({ apiKey: snapshot.apiKey, quiet: true });
  }

  function bindAppManagerControls() {
    const runtime = modules.runtime;
    const searchInput = runtime.getById("appManagerSearchInput");
    const sortInput = runtime.getById("appManagerSortInput");
    if (searchInput) {
      searchInput.addEventListener("input", () => {
        modules.state.state.appManagerKeyword = searchInput.value || "";
        modules.apps.renderSavedAppsList();
      });
    }
    if (sortInput) {
      sortInput.value = modules.state.state.appManagerSort || "manual";
      sortInput.addEventListener("change", () => {
        modules.state.state.appManagerSort = sortInput.value || "manual";
        modules.apps.renderSavedAppsList();
      });
    }
  }

  function bindSettingsActions() {
    const runtime = modules.runtime;
    const saveButton = runtime.getById("btnSaveSettings");
    const resetButton = runtime.getById("btnResetSettings");
    const resetAiOptimizeButton = runtime.getById("btnResetAiOptimizeAppId");
    const parseAppButton = runtime.getById("btnParseApp");
    const saveEditingAppButton = runtime.getById("btnSaveEditingApp");
    const deleteEditingAppButton = runtime.getById("btnDeleteEditingApp");
    const saveTemplateButton = runtime.getById("btnSaveTemplate");
    const resetTemplateButton = runtime.getById("btnResetTemplateEditor");
    const loadParseDebugButton = runtime.getById("btnLoadParseDebug");
    const themeImageInput = runtime.getById("themeImageInput");
    const clearThemeImageButton = runtime.getById("btnClearThemeImage");
    const fieldIds = [
      "settingsApiKeyInput",
      "settingsPollIntervalInput",
      "settingsTimeoutInput",
      "settingsMaxConcurrentTasksInput",
      "settingsAiOptimizeAppIdInput"
    ];

    bindAppManagerControls();

    document.querySelectorAll("[data-theme-preset]").forEach((button) => {
      button.addEventListener("click", async () => {
        const preset = String(button.getAttribute("data-theme-preset") || "classic");
        try {
          await saveThemeSnapshot({
            ...modules.state.state.theme,
            preset,
            basePreset: preset,
            customImage: "",
            customImageName: "",
            glass: false
          });
        } catch (error) {
          runtime.setSummaryStatus(runtime.getById("themeStatusSummary"), `主题保存失败：${error.message}`, "error");
        }
      });
    });

    if (themeImageInput) {
      themeImageInput.addEventListener("change", async () => {
        const file = themeImageInput.files && themeImageInput.files[0];
        if (!file) return;
        try {
          const dataUrl = await readImageFileAsDataUrl(file);
          const skinDataUrl = await compressThemeImageDataUrl(dataUrl);
          await saveThemeSnapshot({
            ...modules.state.state.theme,
            preset: "custom",
            basePreset:
              modules.state.state.theme.preset === "custom"
                ? modules.state.state.theme.basePreset || "classic"
                : modules.state.state.theme.preset || "classic",
            customImage: skinDataUrl,
            customImageName: String(file.name || "自定义照片"),
            glass: true
          });
          runtime.setSummaryStatus(
            runtime.getById("themeStatusSummary"),
            `自定义主题已启用：${file.name || "背景照片"}，皮肤图片约 ${Math.ceil(skinDataUrl.length / 1024)} KB。`,
            "success"
          );
        } catch (error) {
          runtime.setSummaryStatus(runtime.getById("themeStatusSummary"), `主题照片应用失败：${error.message}`, "error");
        } finally {
          themeImageInput.value = "";
        }
      });
    }

    if (clearThemeImageButton) {
      clearThemeImageButton.addEventListener("click", async () => {
        await saveThemeSnapshot({
          ...modules.state.state.theme,
          preset:
            modules.state.state.theme.preset === "custom"
              ? modules.state.state.theme.basePreset || "classic"
              : modules.state.state.theme.preset,
          basePreset: modules.state.state.theme.basePreset || "classic",
          customImage: "",
          customImageName: "",
          glass: false
        });
      });
    }

    fieldIds.forEach((id) => {
      const element = runtime.getById(id);
      if (!element) return;
      if (id === "settingsMaxConcurrentTasksInput") {
        element.addEventListener("input", () => {
          const previewSettings = modules.state.normalizeSettings({
            ...modules.state.state.settings,
            maxConcurrentTasks: element.value
          });
          modules.state.state.settings.maxConcurrentTasks = previewSettings.maxConcurrentTasks;
          if (
            modules.workspace &&
            typeof modules.workspace.updateRunButtonState === "function"
          ) {
            modules.workspace.updateRunButtonState();
          }
        });
      }
      element.addEventListener("input", () => renderSettingsStatus("检测到未保存修改。", "pending"));
    });

    if (saveButton) {
      saveButton.addEventListener("click", async () => {
        saveButton.disabled = true;
        renderSettingsStatus("正在保存设置...", "info");
        try {
          await saveSettingsSnapshot(readSettingsForm());
          await refreshAccountSummary({ quiet: true, force: true });
        } catch (error) {
          renderSettingsStatus(`设置保存失败：${error.message}`, "error");
          renderSettingsDiagnostics("保存设置时发生错误，请检查宿主桥接与当前环境。", {
            runtime: modules.state.state.hostRuntime,
            hasApiKey: Boolean(runtime.getById("settingsApiKeyInput")?.value)
          });
          modules.ui.logToWorkspace(`设置保存失败：${error.message}`, "error");
        } finally {
          saveButton.disabled = false;
        }
      });
    }

    if (resetButton) {
      setApiKeyVisibility(false);
      resetButton.addEventListener("click", () => {
        const input = runtime.getById("settingsApiKeyInput");
        const visible = input ? input.type !== "password" : false;
        setApiKeyVisibility(!visible);
        renderSettingsStatus("表单已恢复为当前已加载设置。", "info");
      });
    }

    if (resetAiOptimizeButton) {
      resetAiOptimizeButton.addEventListener("click", () => {
        const input = runtime.getById("settingsAiOptimizeAppIdInput");
        if (input) input.value = modules.state.DEFAULT_AI_OPTIMIZE_APP_ID;
        renderSettingsStatus("AI 优化应用 ID 已恢复为内置默认值，记得保存设置。", "pending");
      });
    }

    if (parseAppButton) {
      parseAppButton.addEventListener("click", async () => {
        parseAppButton.disabled = true;
        try {
          const parsed = await modules.apps.parseAppReference();
          if (parsed) {
            renderSettingsDiagnostics(
              `应用解析完成：${parsed.name || parsed.appId || "未命名应用"}。`,
              {
                runtime: modules.state.state.hostRuntime,
                hasApiKey: Boolean(modules.state.state.settings.apiKey)
              }
            );
          }
        } catch (error) {
          runtime.setSummaryStatus(runtime.getById("appEditorStatus"), error.message, "error");
        } finally {
          parseAppButton.disabled = false;
        }
      });
    }

    ["appEditorAppIdInput", "appEditorNameInput", "appEditorDescriptionInput", "appEditorInputsInput"].forEach((id) => {
      const element = runtime.getById(id);
      if (!element) return;
      element.addEventListener("input", () => {
        if (id === "appEditorInputsInput") {
          modules.apps.renderAppInputsSummary(element.value || "[]");
        }
        runtime.setSummaryStatus(
          runtime.getById("appEditorStatus"),
          modules.state.state.editingAppId
            ? "已修改当前应用，记得保存。"
            : "输入应用 ID 或链接后解析，确认名称后保存。",
          "pending"
        );
      });
    });

    if (saveEditingAppButton) {
      saveEditingAppButton.addEventListener("click", async () => {
        try {
          await modules.apps.saveEditedApp();
          runtime.setSummaryStatus(runtime.getById("savedAppsSummary"), "应用已保存。", "success");
        } catch (error) {
          runtime.setSummaryStatus(runtime.getById("appEditorStatus"), `保存失败：${error.message}`, "error");
        }
      });
    }

    if (deleteEditingAppButton) {
      deleteEditingAppButton.addEventListener("click", async () => {
        if (!modules.state.state.editingAppId) return;
        await modules.apps.deleteAppById(modules.state.state.editingAppId);
        runtime.setSummaryStatus(runtime.getById("savedAppsSummary"), "应用已删除。", "warn");
      });
    }

    if (resetTemplateButton) {
      resetTemplateButton.addEventListener("click", () => {
        modules.templates.fillTemplateEditor(null);
      });
    }

    if (loadParseDebugButton) {
      loadParseDebugButton.addEventListener("click", async () => {
        try {
          const debug = await loadParseDebug();
          renderSettingsDiagnostics(
            debug ? "已加载最近一次应用解析调试记录。" : "当前还没有解析调试记录，请先解析一次应用。",
            {
              runtime: modules.state.state.hostRuntime,
              hasApiKey: Boolean(modules.state.state.settings.apiKey)
            }
          );
        } catch (error) {
          renderSettingsDiagnostics(`读取解析调试记录失败：${error.message}`, {
            runtime: modules.state.state.hostRuntime,
            hasApiKey: Boolean(modules.state.state.settings.apiKey)
          });
        }
      });
    }

    ["templateTitleInput", "templateContentInput"].forEach((id) => {
      const element = runtime.getById(id);
      if (!element) return;
      element.addEventListener("input", () => {
        modules.templates.updateTemplateLengthHint();
      });
    });

    if (saveTemplateButton) {
      saveTemplateButton.addEventListener("click", async () => {
        try {
          await modules.templates.saveEditedTemplate();
          runtime.setSummaryStatus(runtime.getById("savedTemplatesSummary"), "模板已保存。", "success");
        } catch (error) {
          runtime.setSummaryStatus(runtime.getById("templateStatusSummary"), `保存失败：${error.message}`, "error");
        }
      });
    }

    document.addEventListener("click", async (event) => {
      const actionTarget = event.target && event.target.closest("[data-action]");
      if (!actionTarget) return;

      const action = actionTarget.getAttribute("data-action");
      const appId = actionTarget.getAttribute("data-app-id");
      if (action === "edit-app" && appId) {
        modules.apps.openAppEditor(appId);
        return;
      }
      if (action === "delete-app" && appId) {
        await modules.apps.deleteAppById(appId);
        runtime.setSummaryStatus(runtime.getById("savedAppsSummary"), "应用已删除。", "warn");
      }
    });
  }

  modules.settings = {
    renderSettingsStatus,
    renderSettingsDiagnostics,
    updateAccountSummary,
    refreshAccountSummary,
    loadParseDebug,
    initializeSettings,
    refreshThemeSkin,
    bindSettingsActions
  };
})(window);
