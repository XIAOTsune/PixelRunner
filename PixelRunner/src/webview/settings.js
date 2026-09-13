(function initSettingsModule(global) {
  const modules = (global.PixelRunnerModules = global.PixelRunnerModules || {});
  let accountRefreshPromise = null;
  let accountRefreshGeneration = 0;

  function renderSettingsStatus(message, type = "info") {
    modules.runtime.setSummaryStatus(modules.runtime.getById("settingsStatusSummary"), message, type);
  }

  function renderSettingsDiagnostics(message, options = {}) {
    const box = modules.runtime.getById("thirdPartyStatusSummary");
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

    const thirdPartyText = "<p>第三方 API：工作台卡片始终显示，使用当前已保存供应商配置。</p>";

    box.innerHTML = `<p>${modules.runtime.escapeHtml(String(message || ""))}</p>${runtimeText}${apiKeyText}${appText}${templateText}${currentAppText}${thirdPartyText}`;
  }

  function updateAccountSummary(account) {
    const balanceEl = modules.runtime.getById("accountBalanceValue");
    const coinsEl = modules.runtime.getById("accountCoinsValue");
    const summaryEl = modules.runtime.getById("accountSummary");
    if (!balanceEl || !coinsEl || !summaryEl) return;

    const hasAccount = account && account.ok;
    const region = modules.state.normalizeRunningHubRegion(
      hasAccount && account.region ? account.region : modules.state.state.settings.runningHubRegion
    );
    const currency = String((hasAccount && account.currency) || (region === modules.state.RUNNINGHUB_REGIONS.GLOBAL ? "USD" : "R")).trim();
    balanceEl.textContent = hasAccount && account.balance != null
      ? region === modules.state.RUNNINGHUB_REGIONS.GLOBAL
        ? `$${account.balance}`
        : String(account.balance)
      : "--";
    coinsEl.textContent = hasAccount && account.coins != null ? String(account.coins) : "--";
    summaryEl.classList.toggle("is-empty", !hasAccount);
    modules.state.state.accountSummary = {
      balance: hasAccount && account.balance != null ? Number(account.balance) : null,
      coins: hasAccount && account.coins != null ? Number(account.coins) : null,
      region,
      currency,
      updatedAt: Date.now()
    };
    if (modules.workspace && typeof modules.workspace.renderWorkspaceAccountSummary === "function") {
      modules.workspace.renderWorkspaceAccountSummary();
    }
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
    const region = modules.state.normalizeRunningHubRegion(
      options.region != null ? options.region : modules.state.state.settings.runningHubRegion
    );
    if (!apiKey || !modules.runtime.isPluginRuntime()) {
      accountRefreshGeneration += 1;
      accountRefreshPromise = null;
      updateAccountSummary(null);
      return null;
    }

    if (!options.force && accountRefreshPromise) {
      return accountRefreshPromise;
    }

    const requestGeneration = accountRefreshGeneration + 1;
    accountRefreshGeneration = requestGeneration;
    const requestPromise = modules.runtime
      .callHost("runninghub.fetchAccountStatus", [{ apiKey, region }], { timeoutMs: 15000 })
      .then((account) => {
        if (requestGeneration === accountRefreshGeneration) updateAccountSummary(account);
        return account;
      })
      .catch((error) => {
        if (!options.quiet && modules.ui && typeof modules.ui.logToWorkspace === "function") {
          modules.ui.logToWorkspace(`余额刷新失败：${error.message || error}`, "warn");
        }
        if (requestGeneration === accountRefreshGeneration) updateAccountSummary(null);
        return null;
      })
      .finally(() => {
        if (accountRefreshPromise === requestPromise) accountRefreshPromise = null;
      });

    accountRefreshPromise = requestPromise;
    return requestPromise;
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
    renderRunningHubRegionControl(settings.runningHubRegion);
    renderApiProfileControls();
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
    if (modules.runtime.getById("settingsLocalQueueEnabledInput")) {
      modules.runtime.getById("settingsLocalQueueEnabledInput").checked = settings.localQueueEnabled === true;
    }
    if (modules.runtime.getById("settingsRatioOffsetCorrectionInput")) {
      modules.runtime.getById("settingsRatioOffsetCorrectionInput").checked = settings.ratioOffsetCorrectionEnabled === true;
    }
    if (modules.runtime.getById("settingsAiOptimizeAppIdInput")) {
      modules.runtime.getById("settingsAiOptimizeAppIdInput").value = String(
        settings.aiOptimizeAppId ?? modules.state.getDefaultAiOptimizeAppId(settings.runningHubRegion)
      );
    }
    if (modules.runtime.getById("settingsGenerativeFillAppIdInput")) {
      modules.runtime.getById("settingsGenerativeFillAppIdInput").value = String(
        settings.generativeFillAppId ?? modules.state.getDefaultGenerativeFillAppId(settings.runningHubRegion)
      );
    }
    if (modules.runtime.getById("settingsGenerativeFillFeatherInput")) {
      modules.runtime.getById("settingsGenerativeFillFeatherInput").value = String(
        settings.generativeFillFeather ?? modules.state.DEFAULT_SETTINGS.generativeFillFeather
      );
    }
    if (modules.runtime.getById("settingsGenerativeFillContextInput")) {
      modules.runtime.getById("settingsGenerativeFillContextInput").value = String(
        settings.generativeFillContextExpansion ?? modules.state.DEFAULT_SETTINGS.generativeFillContextExpansion
      );
    }
    if (modules.runtime.getById("settingsGenerativeFillMaskExpansionInput")) {
      modules.runtime.getById("settingsGenerativeFillMaskExpansionInput").value = String(
        settings.generativeFillMaskExpansion ?? modules.state.DEFAULT_SETTINGS.generativeFillMaskExpansion
      );
    }
    if (modules.runtime.getById("settingsGenerativeFillColorCorrectionInput")) {
      modules.runtime.getById("settingsGenerativeFillColorCorrectionInput").checked =
        settings.generativeFillColorCorrectionEnabled !== false;
    }
    if (modules.runtime.getById("settingsAppPickerLayoutInput")) {
      modules.runtime.getById("settingsAppPickerLayoutInput").checked = String(settings.appPickerLayout || "") === "compact";
    }
    if (modules.runtime.getById("settingsPlusModeEnabledInput")) {
      modules.runtime.getById("settingsPlusModeEnabledInput").checked = settings.plusModeEnabled === true;
    }
    fillThirdPartySettingsForm(modules.state.state.thirdPartySettings);
  }

  function maskApiKey(apiKey) {
    const value = String(apiKey || "").trim();
    if (!value) return "未填写";
    if (value.length <= 8) return `${value.slice(0, 2)}****${value.slice(-2)}`;
    return `${value.slice(0, 4)}****${value.slice(-4)}`;
  }

  function getActiveApiProfile() {
    return modules.state.getActiveApiProfile ? modules.state.getActiveApiProfile() : null;
  }

  function getCurrentRunningHubRegion() {
    return modules.state.normalizeRunningHubRegion(modules.state.state.settings.runningHubRegion);
  }

  function renderRunningHubRegionControl(region = getCurrentRunningHubRegion()) {
    const normalized = modules.state.normalizeRunningHubRegion(region);
    document.querySelectorAll("[data-runninghub-region]").forEach((button) => {
      const isActive = modules.state.normalizeRunningHubRegion(button.getAttribute("data-runninghub-region")) === normalized;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-pressed", isActive ? "true" : "false");
    });
  }

  function getSelectedGrsRegion() {
    const activeButton = document.querySelector("[data-grs-region].is-active");
    const stored = modules.state.state.thirdPartySettings && modules.state.state.thirdPartySettings.grs
      ? modules.state.state.thirdPartySettings.grs
      : modules.state.DEFAULT_THIRD_PARTY_SETTINGS.grs;
    return modules.state.normalizeGrsRegion(
      activeButton ? activeButton.getAttribute("data-grs-region") : stored.region,
      stored.apiUrl
    );
  }

  function renderGrsRegionControl(region = getSelectedGrsRegion()) {
    const normalized = modules.state.normalizeGrsRegion(region);
    document.querySelectorAll("[data-grs-region]").forEach((button) => {
      const isActive = modules.state.normalizeGrsRegion(button.getAttribute("data-grs-region")) === normalized;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-pressed", isActive ? "true" : "false");
    });
  }

  function renderApiProfileControls() {
    const runtime = modules.runtime;
    const select = runtime.getById("settingsApiProfileSelect");
    const nameInput = runtime.getById("settingsApiProfileNameInput");
    const listEl = runtime.getById("apiProfileList");
    const deleteButton = runtime.getById("btnDeleteApiProfile");
    const region = getCurrentRunningHubRegion();
    const profiles = (Array.isArray(modules.state.state.apiProfiles) ? modules.state.state.apiProfiles : [])
      .filter((profile) => modules.state.normalizeRunningHubRegion(profile.region) === region);
    const active = getActiveApiProfile();

    if (select) {
      select.innerHTML = profiles.length
        ? '<option value="">新增 API 档案...</option>' + profiles
            .map((profile) => {
              const selected = active && String(profile.id) === String(active.id) ? "selected" : "";
              return `<option value="${runtime.escapeHtml(profile.id)}" ${selected}>${runtime.escapeHtml(profile.name)}</option>`;
            })
            .join("")
        : '<option value="">尚未保存 API 档案</option>';
      select.value = active ? active.id : "";
    }

    if (nameInput) nameInput.value = active ? active.name : "";
    if (deleteButton) deleteButton.disabled = !active;

    if (listEl) {
      listEl.innerHTML = profiles.length
        ? profiles
            .map((profile) => {
              const isActive = active && String(profile.id) === String(active.id);
              return `
                <button class="api-profile-chip ${isActive ? "is-active" : ""}" type="button" data-api-profile-id="${runtime.escapeHtml(profile.id)}">
                  <span>${runtime.escapeHtml(profile.name)}</span>
                  <small>${runtime.escapeHtml(maskApiKey(profile.apiKey))}</small>
                </button>
              `;
            })
            .join("")
        : '<div class="api-profile-empty">保存后会在这里显示 API 档案。</div>';
    }
  }

  function applyActiveApiProfile(profile) {
    const normalized = modules.state.normalizeApiProfileRecord(profile || {}, 0);
    modules.state.state.settings.runningHubRegion = normalized.region;
    modules.state.state.activeApiProfileId = normalized.id;
    modules.state.state.settings.activeApiProfileId = normalized.id;
    modules.state.state.settings.apiKey = normalized.apiKey;
    const keyInput = modules.runtime.getById("settingsApiKeyInput");
    if (keyInput) keyInput.value = normalized.apiKey;
    renderRunningHubRegionControl(normalized.region);
    renderApiProfileControls();
  }

  function readApiProfilesFromUi(settings) {
    const profiles = modules.state.normalizeApiProfileList(modules.state.state.apiProfiles);
    const apiKey = String(settings.apiKey || "").trim();
    const region = modules.state.normalizeRunningHubRegion(settings.runningHubRegion);
    const activeId = String(modules.state.state.activeApiProfileId || settings.activeApiProfileId || "").trim();
    const nameInput = modules.runtime.getById("settingsApiProfileNameInput");
    const profileName = String((nameInput && nameInput.value) || "").trim();
    const now = Date.now();

    if (!apiKey) return { profiles, activeApiProfileId: "" };

    const existingIndex = profiles.findIndex((item) => String(item.id) === activeId);
    if (existingIndex >= 0) {
      profiles[existingIndex] = modules.state.normalizeApiProfileRecord({
        ...profiles[existingIndex],
        name: profileName || profiles[existingIndex].name,
        apiKey,
        region,
        updatedAt: now
      }, existingIndex);
      return { profiles: modules.state.normalizeApiProfileList(profiles), activeApiProfileId: profiles[existingIndex].id };
    }

    const duplicate = profiles.find((item) => item.region === region && String(item.apiKey).trim() === apiKey);
    if (duplicate) {
      duplicate.name = profileName || duplicate.name;
      duplicate.updatedAt = now;
      return { profiles: modules.state.normalizeApiProfileList(profiles), activeApiProfileId: duplicate.id };
    }

    const nextProfile = modules.state.normalizeApiProfileRecord({
      name: profileName || `API ${profiles.length + 1}`,
      apiKey,
      region,
      createdAt: now,
      updatedAt: now
    }, profiles.length);
    return { profiles: modules.state.normalizeApiProfileList([nextProfile, ...profiles]), activeApiProfileId: nextProfile.id };
  }

  function fillThirdPartyModelSelect(models, selected) {
    const select = modules.runtime.getById("thirdPartyGrsDefaultModelInput");
    if (!select) return;
    const list = Array.isArray(models) && models.length ? models : modules.state.DEFAULT_THIRD_PARTY_SETTINGS.grs.imageModels;
    const value = String(selected || list[0] || "").trim();
    select.innerHTML = list
      .map((model) => `<option value="${modules.runtime.escapeHtml(String(model))}" ${String(model) === value ? "selected" : ""}>${modules.runtime.escapeHtml(modules.state.getGrsImageModelLabel(model))}</option>`)
      .join("");
    if (value && !list.includes(value)) {
      select.insertAdjacentHTML("afterbegin", `<option value="${modules.runtime.escapeHtml(value)}" selected>${modules.runtime.escapeHtml(value)}</option>`);
    }
  }

  function fillThirdPartyChatModelSelect(selected) {
    const select = modules.runtime.getById("thirdPartyGrsChatModelInput");
    if (!select) return;
    const value = String(selected || modules.state.GRS_CHAT_MODEL_IDS[0] || "").trim();
    const models = [...modules.state.GRS_CHAT_MODEL_IDS];
    if (value && !models.includes(value)) models.unshift(value);
    select.innerHTML = models
      .map((model) => `<option value="${modules.runtime.escapeHtml(model)}" ${model === value ? "selected" : ""}>${modules.runtime.escapeHtml(model)}</option>`)
      .join("");
  }

  function fillThirdPartyCapabilitySelects(model, selectedAspectRatio, selectedResolution) {
    const capabilities = modules.state.getThirdPartyModelCapabilities(model, "grs");
    const ratioSelect = modules.runtime.getById("thirdPartyGrsDefaultRatioInput");
    const resolutionSelect = modules.runtime.getById("thirdPartyGrsDefaultResolutionInput");
    const ratio = capabilities.aspectRatios.includes(String(selectedAspectRatio || ""))
      ? String(selectedAspectRatio)
      : capabilities.defaultAspectRatio;
    const resolution = capabilities.resolutions.includes(String(selectedResolution || ""))
      ? String(selectedResolution)
      : capabilities.defaultResolution;
    if (ratioSelect) {
      ratioSelect.innerHTML = capabilities.aspectRatios
        .map((value) => `<option value="${modules.runtime.escapeHtml(value)}" ${value === ratio ? "selected" : ""}>${modules.runtime.escapeHtml(value)}</option>`)
        .join("");
    }
    if (resolutionSelect) {
      resolutionSelect.innerHTML = capabilities.resolutions
        .map((value) => `<option value="${modules.runtime.escapeHtml(value)}" ${value === resolution ? "selected" : ""}>${modules.runtime.escapeHtml(value)}</option>`)
        .join("");
    }
  }

  function getSelectedThirdPartyProvider() {
    const activeButton = document.querySelector("[data-third-party-provider].is-active");
    return String(activeButton && activeButton.getAttribute("data-third-party-provider") || "grs") === "gemini" ? "gemini" : "grs";
  }

  function getSelectedGeminiChannel() {
    const activeButton = document.querySelector("[data-gemini-channel].is-active");
    const stored = modules.state.state.thirdPartySettings?.gemini?.channelId;
    return modules.state.normalizeGeminiChannelId(activeButton ? activeButton.getAttribute("data-gemini-channel") : stored);
  }

  function renderThirdPartyProviderControls(provider, channelId) {
    const normalizedProvider = String(provider || "") === "gemini" ? "gemini" : "grs";
    const normalizedChannel = modules.state.normalizeGeminiChannelId(channelId);
    document.querySelectorAll("[data-third-party-provider]").forEach((button) => {
      const isActive = button.getAttribute("data-third-party-provider") === normalizedProvider;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-pressed", isActive ? "true" : "false");
    });
    document.querySelectorAll("[data-gemini-channel]").forEach((button) => {
      const isActive = modules.state.normalizeGeminiChannelId(button.getAttribute("data-gemini-channel")) === normalizedChannel;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-pressed", isActive ? "true" : "false");
    });
    const grsGroup = modules.runtime.getById("thirdPartyGrsSettingsGroup");
    const geminiGroup = modules.runtime.getById("thirdPartyGeminiSettingsGroup");
    if (grsGroup) grsGroup.hidden = normalizedProvider !== "grs";
    if (geminiGroup) geminiGroup.hidden = normalizedProvider !== "gemini";
  }

  function fillGeminiModelSelect(selectId, models, selected, fallbackModels = []) {
    const select = modules.runtime.getById(selectId);
    if (!select) return;
    const list = Array.isArray(models) && models.length
      ? models
      : (Array.isArray(fallbackModels) && fallbackModels.length ? fallbackModels : modules.state.GEMINI_IMAGE_MODEL_IDS);
    const value = String(selected || list[0] || "").trim();
    const options = list.includes(value) || !value ? list : [value, ...list];
    select.innerHTML = options
      .map((model) => {
        const label = String(model) === modules.state.MOMO_MIDJOURNEY_MODEL_ID ? "Midjourney Imagine（需梯子/代理）" : String(model);
        return `<option value="${modules.runtime.escapeHtml(String(model))}" ${String(model) === value ? "selected" : ""}>${modules.runtime.escapeHtml(label)}</option>`;
      })
      .join("");
  }

  function fillGeminiCapabilitySelects(selectedAspectRatio, selectedResolution) {
    const ratioSelect = modules.runtime.getById("thirdPartyGeminiDefaultRatioInput");
    const resolutionSelect = modules.runtime.getById("thirdPartyGeminiDefaultResolutionInput");
    const ratio = modules.state.GEMINI_ASPECT_RATIOS.includes(String(selectedAspectRatio || "")) ? String(selectedAspectRatio) : "auto";
    const resolution = modules.state.GEMINI_RESOLUTIONS.includes(String(selectedResolution || "").toUpperCase())
      ? String(selectedResolution).toUpperCase()
      : "1K";
    if (ratioSelect) {
      ratioSelect.innerHTML = modules.state.GEMINI_ASPECT_RATIOS
        .map((value) => `<option value="${value}" ${value === ratio ? "selected" : ""}>${value}</option>`)
        .join("");
    }
    if (resolutionSelect) {
      resolutionSelect.innerHTML = modules.state.GEMINI_RESOLUTIONS
        .map((value) => `<option value="${value}" ${value === resolution ? "selected" : ""}>${value}</option>`)
        .join("");
    }
  }

  function fillMomoEndpointSelect(currentApiUrl) {
    const select = modules.runtime.getById("thirdPartyMomoEndpointInput");
    if (!select) return;
    const endpoints = modules.state.MOMO_SERVICE_ENDPOINTS;
    const current = modules.state.normalizeMomoEndpoint(currentApiUrl);
    select.innerHTML = endpoints
      .map((ep) => `<option value="${modules.runtime.escapeHtml(ep.url)}" ${ep.url === current ? "selected" : ""}>${modules.runtime.escapeHtml(ep.label)}</option>`)
      .join("");
  }

  function getSelectedMomoEndpoint() {
    const select = modules.runtime.getById("thirdPartyMomoEndpointInput");
    const value = String(select && select.value || "").trim().replace(/\/+$/, "");
    return modules.state.normalizeMomoEndpoint(value);
  }

  function renderMomoEndpointControls(channelId, currentApiUrl) {
    const group = modules.runtime.getById("thirdPartyMomoEndpointGroup");
    if (!group) return;
    const visible = channelId === "momo";
    group.hidden = !visible;
    if (visible) fillMomoEndpointSelect(currentApiUrl);
  }

  function fillGeminiSettingsForm(gemini) {
    const active = gemini.channels?.[gemini.channelId] || gemini;
    const modelDefaults = modules.state.getGeminiChannelModelDefaults(gemini.channelId);
    if (modules.runtime.getById("thirdPartyGeminiApiKeyInput")) {
      modules.runtime.getById("thirdPartyGeminiApiKeyInput").value = active.apiKey || "";
    }
    fillGeminiModelSelect("thirdPartyGeminiDefaultModelInput", active.imageModels, active.selectedModel, modelDefaults.imageModels);
    fillGeminiModelSelect("thirdPartyGeminiChatModelInput", active.chatModels, active.chatModel, modelDefaults.chatModels);
    fillGeminiCapabilitySelects(active.aspectRatio, active.resolution);
    renderMomoEndpointControls(gemini.channelId, active.apiUrl);
  }

  function refreshThirdPartyWorkspacePreview() {
    if (!modules.state.isThirdPartyApp(modules.state.state.currentApp)) return;
    const app = modules.state.getThirdPartyApp();
    const descriptor = modules.state.getThirdPartyProviderDescriptor();
    const config = descriptor.config;
    modules.state.state.currentApp = app;
    modules.state.state.formValues = {
      ...modules.state.state.formValues,
      model: config.selectedModel || config.imageModels?.[0] || "",
      aspectRatio: config.aspectRatio || "auto",
      resolution: config.resolution || "1K"
    };
    if (modules.workspace && typeof modules.workspace.updateThirdPartyDynamicOptions === "function") {
      modules.workspace.updateThirdPartyDynamicOptions(modules.state.state.formValues.model);
    }
    if (modules.workspace && typeof modules.workspace.renderWorkspace === "function") modules.workspace.renderWorkspace();
    if (modules.apps && typeof modules.apps.renderAppPickerList === "function") modules.apps.renderAppPickerList();
  }

  function fillThirdPartySettingsForm(settings) {
    const normalized = modules.state.normalizeThirdPartySettings(settings);
    const grs = normalized.grs;
    renderThirdPartyProviderControls(normalized.provider, normalized.gemini.channelId);
    renderGrsRegionControl(grs.region);
    if (modules.runtime.getById("thirdPartyGrsApiKeyInput")) modules.runtime.getById("thirdPartyGrsApiKeyInput").value = grs.apiKey || "";
    fillThirdPartyModelSelect(grs.imageModels, grs.selectedModel);
    fillThirdPartyChatModelSelect(grs.chatModel);
    fillThirdPartyCapabilitySelects(grs.selectedModel, grs.aspectRatio, grs.resolution);
    fillGeminiSettingsForm(normalized.gemini);
    const statusEl = modules.runtime.getById("thirdPartyStatusSummary");
    renderMomoEndpointControls(normalized.gemini.channelId, normalized.gemini.apiUrl);
    const descriptor = modules.state.getThirdPartyProviderDescriptor(normalized);
    modules.runtime.setSummaryStatus(
      statusEl,
      String(descriptor.config.apiKey || "").trim()
        ? `${descriptor.label} 已配置 · ${descriptor.config.selectedModel}`
        : `${descriptor.label} 尚未配置 API Key`,
      String(descriptor.config.apiKey || "").trim() ? "success" : "warn"
    );
  }

  function readThirdPartySettingsForm() {
    const current = modules.state.normalizeThirdPartySettings(modules.state.state.thirdPartySettings);
    const channelId = getSelectedGeminiChannel();
    const modelDefaults = modules.state.getGeminiChannelModelDefaults(channelId);
    const momoApiUrl = channelId === "momo" ? getSelectedMomoEndpoint() : undefined;
    const activeGemini = {
      ...(current.gemini.channels?.[channelId] || {}),
      apiUrl: channelId === "momo" ? momoApiUrl : (current.gemini.channels?.[channelId]?.apiUrl),
      apiKey: modules.runtime.getById("thirdPartyGeminiApiKeyInput")?.value || "",
      selectedModel: modules.runtime.getById("thirdPartyGeminiDefaultModelInput")?.value || "",
      imageModels: current.gemini.channels?.[channelId]?.imageModels || current.gemini.imageModels || modelDefaults.imageModels,
      chatModels: current.gemini.channels?.[channelId]?.chatModels || modelDefaults.chatModels,
      chatModel: modules.runtime.getById("thirdPartyGeminiChatModelInput")?.value || "",
      aspectRatio: modules.runtime.getById("thirdPartyGeminiDefaultRatioInput")?.value || "",
      resolution: modules.runtime.getById("thirdPartyGeminiDefaultResolutionInput")?.value || ""
    };
    return modules.state.normalizeThirdPartySettings({
      provider: getSelectedThirdPartyProvider(),
      grs: {
        region: getSelectedGrsRegion(),
        apiKey: modules.runtime.getById("thirdPartyGrsApiKeyInput")?.value || "",
        imageModels: modules.state.state.thirdPartySettings?.grs?.imageModels || modules.state.GRS_IMAGE_MODEL_IDS,
        chatModel: modules.runtime.getById("thirdPartyGrsChatModelInput")?.value || "",
        selectedModel: modules.runtime.getById("thirdPartyGrsDefaultModelInput")?.value || "",
        aspectRatio: modules.runtime.getById("thirdPartyGrsDefaultRatioInput")?.value || "",
        resolution: modules.runtime.getById("thirdPartyGrsDefaultResolutionInput")?.value || ""
      },
      gemini: {
        ...current.gemini,
        channelId,
        channels: {
          ...current.gemini.channels,
          [channelId]: activeGemini
        }
      }
    });
  }

  const DARK_THEME_TOKENS = {
    "--border": "rgba(169, 194, 214, 0.14)",
    "--border-strong": "rgba(169, 194, 214, 0.26)",
    "--text": "#d8e5f0",
    "--text-strong": "#f6fbf8",
    "--muted": "#9eb0bf",
    "--muted-soft": "#8092a3"
  };

  const LEGACY_THEME_STYLE = {
    "--app-background": "radial-gradient(circle at 0% 0%, var(--accent-soft), transparent 22%), radial-gradient(circle at 92% 8%, var(--accent-wash), transparent 24%), linear-gradient(180deg, var(--bg-top) 0%, var(--bg-mid) 30%, var(--bg-bottom) 100%)",
    "--chrome-border-width": "2px",
    "--chrome-shadow": "0 3px 0 rgba(20, 27, 36, 0.42)",
    "--control-radius": "13px",
    "--control-border-width": "2px",
    "--control-shadow-offset": "3px 4px 0",
    "--control-sheen": "linear-gradient(180deg, rgba(255, 255, 255, 0.08), rgba(255, 255, 255, 0.03) 52%, rgba(255, 255, 255, 0))",
    "--control-hover-transform": "translateY(-1px)",
    "--control-hover-shadow-offset": "0 5px 0",
    "--control-active-transform": "translateY(2px)",
    "--control-active-shadow-offset": "0 2px 0",
    "--control-disabled-shadow": "1px 1px 0 rgba(44, 61, 80, 0.5)",
    "--nav-radius": "12px",
    "--nav-tab-radius": "9px",
    "--layout-gap": "6px",
    "--workspace-section-gap": "12px",
    "--surface-card-padding": "6px 8px 7px",
    "--surface-card-decoration": "linear-gradient(180deg, rgba(255, 255, 255, 0.015), rgba(255, 255, 255, 0))",
    "--joined-card-radius": "14px",
    "--field-radius": "12px",
    "--field-border-width": "2px",
    "--field-shadow": "2px 3px 0 rgba(29, 40, 54, 0.72)",
    "--field-focus-transform": "translate(-1px, -1px)",
    "--field-focus-shadow": "0 0 0 2px rgba(143, 216, 195, 0.08), 3px 4px 0 rgba(29, 40, 54, 0.78)",
    "--workspace-card-gap": "10px",
    "--workspace-card-padding": "10px 12px 12px",
    "--workspace-card-radius": "18px",
    "--workspace-card-border": "1px solid rgba(92, 117, 140, 0.58)",
    "--workspace-card-background": "linear-gradient(180deg, rgba(var(--surface-rgb), var(--surface-alpha)) 0%, rgba(var(--surface-soft-rgb), var(--surface-soft-alpha)) 100%)",
    "--workspace-card-shadow": "inset 0 1px 0 rgba(255, 255, 255, 0.03), 0 0 0 1px rgba(25, 36, 48, 0.5)",
    "--item-border-width": "2px",
    "--item-shadow": "2px 3px 0 var(--control-edge)",
    "--item-hover-transform": "translateY(-1px)",
    "--item-hover-shadow": "0 4px 0 var(--cta-strong)",
    "--radius-xl": "16px",
    "--radius-lg": "12px",
    "--radius-md": "10px",
    "--radius-sm": "8px"
  };

  const MINIMAL_THEME_STYLE = {
    "--app-background": "linear-gradient(180deg, var(--bg-top) 0%, var(--bg-mid) 52%, var(--bg-bottom) 100%)",
    "--chrome-border-width": "1px",
    "--chrome-shadow": "none",
    "--control-radius": "6px",
    "--control-border-width": "1px",
    "--control-shadow-offset": "0 0 0",
    "--control-sheen": "none",
    "--control-hover-transform": "none",
    "--control-hover-shadow-offset": "0 0 0",
    "--control-active-transform": "none",
    "--control-active-shadow-offset": "0 0 0",
    "--control-disabled-shadow": "none",
    "--nav-radius": "8px",
    "--nav-tab-radius": "6px",
    "--layout-gap": "5px",
    "--workspace-section-gap": "9px",
    "--surface-card-padding": "6px 8px",
    "--surface-card-decoration": "none",
    "--joined-card-radius": "8px",
    "--field-radius": "6px",
    "--field-border-width": "1px",
    "--field-shadow": "none",
    "--field-focus-transform": "none",
    "--field-focus-shadow": "0 0 0 2px var(--accent-soft)",
    "--workspace-card-gap": "8px",
    "--workspace-card-padding": "9px 10px 10px",
    "--workspace-card-radius": "8px",
    "--workspace-card-border": "1px solid var(--border-strong)",
    "--workspace-card-background": "rgba(var(--surface-rgb), var(--surface-alpha))",
    "--workspace-card-shadow": "none",
    "--item-border-width": "1px",
    "--item-shadow": "none",
    "--item-hover-transform": "none",
    "--item-hover-shadow": "none",
    "--radius-xl": "8px",
    "--radius-lg": "8px",
    "--radius-md": "6px",
    "--radius-sm": "6px"
  };

  const MATTE_THEME_STYLE = {
    ...MINIMAL_THEME_STYLE,
    "--app-background": "radial-gradient(circle at 50% 0%, rgba(159, 199, 189, 0.08), transparent 30%), linear-gradient(180deg, var(--bg-top), var(--bg-bottom))",
    "--chrome-shadow": "0 4px 14px rgba(0, 0, 0, 0.16)",
    "--control-radius": "8px",
    "--control-shadow-offset": "0 2px 6px",
    "--control-hover-shadow-offset": "0 3px 9px",
    "--nav-radius": "10px",
    "--nav-tab-radius": "8px",
    "--layout-gap": "6px",
    "--workspace-section-gap": "10px",
    "--joined-card-radius": "10px",
    "--field-radius": "8px",
    "--field-shadow": "inset 0 1px 0 rgba(255, 255, 255, 0.025)",
    "--workspace-card-gap": "9px",
    "--workspace-card-padding": "10px 11px",
    "--workspace-card-radius": "10px",
    "--workspace-card-shadow": "0 6px 18px rgba(0, 0, 0, 0.14)",
    "--item-shadow": "0 1px 2px rgba(0, 0, 0, 0.18)",
    "--item-hover-shadow": "0 3px 9px rgba(0, 0, 0, 0.18)",
    "--radius-xl": "10px",
    "--radius-lg": "10px",
    "--radius-md": "8px",
    "--radius-sm": "7px"
  };

  const FOCUS_THEME_STYLE = {
    ...MINIMAL_THEME_STYLE,
    "--control-radius": "3px",
    "--nav-radius": "4px",
    "--nav-tab-radius": "3px",
    "--layout-gap": "4px",
    "--workspace-section-gap": "7px",
    "--surface-card-padding": "5px 7px",
    "--joined-card-radius": "4px",
    "--field-radius": "3px",
    "--workspace-card-gap": "6px",
    "--workspace-card-padding": "7px 8px 8px",
    "--workspace-card-radius": "4px",
    "--radius-xl": "4px",
    "--radius-lg": "4px",
    "--radius-md": "3px",
    "--radius-sm": "3px"
  };

  const THEME_PRESET_LABELS = {
    classic: "经典",
    aurora: "极光",
    graphite: "石墨",
    rose: "玫瑰",
    studio: "影棚",
    minimal: "极简黑",
    mist: "雾银",
    focus: "专注"
  };

  const THEME_PRESETS = {
    classic: {
      ...DARK_THEME_TOKENS,
      ...LEGACY_THEME_STYLE,
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
      ...DARK_THEME_TOKENS,
      ...LEGACY_THEME_STYLE,
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
      ...DARK_THEME_TOKENS,
      ...LEGACY_THEME_STYLE,
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
      ...DARK_THEME_TOKENS,
      ...LEGACY_THEME_STYLE,
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
      ...DARK_THEME_TOKENS,
      ...LEGACY_THEME_STYLE,
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
    },
    minimal: {
      ...DARK_THEME_TOKENS,
      ...MINIMAL_THEME_STYLE,
      "--bg-top": "#111214",
      "--bg-mid": "#141518",
      "--bg-bottom": "#0d0e10",
      "--panel": "#191a1e",
      "--panel-soft": "#202125",
      "--panel-strong": "#292a2f",
      "--ink": "#34363c",
      "--surface-rgb": "27, 28, 32",
      "--surface-soft-rgb": "33, 34, 39",
      "--control-rgb": "49, 50, 56",
      "--control-edge": "#42444c",
      "--control-ink": "#111216",
      "--surface-alpha": "0.98",
      "--surface-soft-alpha": "0.94",
      "--surface-glass-alpha": "0.68",
      "--theme-image-overlay": "rgba(7, 8, 10, 0.52)",
      "--border": "rgba(235, 236, 240, 0.1)",
      "--border-strong": "rgba(235, 236, 240, 0.18)",
      "--text": "#dddfe3",
      "--text-strong": "#f5f5f6",
      "--muted": "#9b9da4",
      "--muted-soft": "#767982",
      "--accent": "#e4e5e8",
      "--accent-strong": "#c8cad0",
      "--accent-soft": "rgba(228, 229, 232, 0.14)",
      "--accent-wash": "rgba(228, 229, 232, 0.07)",
      "--cta": "#b9bcc4",
      "--cta-strong": "#9397a1"
    },
    mist: {
      ...DARK_THEME_TOKENS,
      ...MATTE_THEME_STYLE,
      "--bg-top": "#171b1e",
      "--bg-mid": "#1b2024",
      "--bg-bottom": "#121518",
      "--panel": "#20262a",
      "--panel-soft": "#293136",
      "--panel-strong": "#343e44",
      "--ink": "#3d494f",
      "--surface-rgb": "32, 38, 42",
      "--surface-soft-rgb": "41, 49, 54",
      "--control-rgb": "57, 67, 73",
      "--control-edge": "#4d5a61",
      "--control-ink": "#10201d",
      "--surface-alpha": "0.97",
      "--surface-soft-alpha": "0.92",
      "--surface-glass-alpha": "0.66",
      "--theme-image-overlay": "rgba(10, 15, 17, 0.48)",
      "--border": "rgba(188, 207, 207, 0.12)",
      "--border-strong": "rgba(188, 207, 207, 0.22)",
      "--text": "#dce5e3",
      "--text-strong": "#f2f7f5",
      "--muted": "#9eacab",
      "--muted-soft": "#7f8d8d",
      "--accent": "#9fc7bd",
      "--accent-strong": "#78aa9f",
      "--accent-soft": "rgba(159, 199, 189, 0.16)",
      "--accent-wash": "rgba(159, 199, 189, 0.08)",
      "--cta": "#bdcbd2",
      "--cta-strong": "#95aab4"
    },
    focus: {
      ...DARK_THEME_TOKENS,
      ...FOCUS_THEME_STYLE,
      "--bg-top": "#0e1011",
      "--bg-mid": "#121516",
      "--bg-bottom": "#0a0c0d",
      "--panel": "#151819",
      "--panel-soft": "#1d2123",
      "--panel-strong": "#272c2e",
      "--ink": "#343a3d",
      "--surface-rgb": "22, 25, 27",
      "--surface-soft-rgb": "29, 33, 35",
      "--control-rgb": "43, 48, 51",
      "--control-edge": "#3b4245",
      "--control-ink": "#16130c",
      "--surface-alpha": "0.99",
      "--surface-soft-alpha": "0.96",
      "--surface-glass-alpha": "0.7",
      "--theme-image-overlay": "rgba(5, 7, 8, 0.56)",
      "--border": "rgba(220, 226, 224, 0.09)",
      "--border-strong": "rgba(220, 226, 224, 0.17)",
      "--text": "#d8dcda",
      "--text-strong": "#f2f4f3",
      "--muted": "#929b98",
      "--muted-soft": "#717a78",
      "--accent": "#d9b46c",
      "--accent-strong": "#b8924d",
      "--accent-soft": "rgba(217, 180, 108, 0.15)",
      "--accent-wash": "rgba(217, 180, 108, 0.075)",
      "--cta": "#9bbab4",
      "--cta-strong": "#73978f"
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
    document.body.dataset.themePreset = presetName;
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

    const swatches = document.querySelectorAll(".theme-swatch[data-theme-preset]");
    swatches.forEach((button) => {
      const isSelected = String(button.getAttribute("data-theme-preset")) === presetName;
      button.classList.toggle("is-selected", isSelected);
      button.setAttribute("aria-pressed", String(isSelected));
    });
    const statusEl = modules.runtime.getById("themeStatusSummary");
    if (statusEl) {
      modules.runtime.setSummaryStatus(
        statusEl,
        normalized.customImage
          ? `自定义主题已启用：${normalized.customImageName || "背景照片"}，背景已写入界面皮肤。`
          : `已启用「${THEME_PRESET_LABELS[presetName] || "经典"}」主题。`,
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
    modules.state.state.thirdPartySettings = readThirdPartySettingsForm();
    const runningHubRegion = getCurrentRunningHubRegion();
    const aiOptimizeAppId = modules.runtime.getById("settingsAiOptimizeAppIdInput")?.value || "";
    const generativeFillAppId = modules.runtime.getById("settingsGenerativeFillAppIdInput")?.value || "";
    return modules.state.normalizeSettings({
      apiKey: modules.runtime.getById("settingsApiKeyInput")?.value || "",
      runningHubRegion,
      pollInterval: modules.runtime.getById("settingsPollIntervalInput")?.value,
      timeout: modules.runtime.getById("settingsTimeoutInput")?.value,
      maxConcurrentTasks: modules.runtime.getById("settingsMaxConcurrentTasksInput")?.value,
      localQueueEnabled: modules.runtime.getById("settingsLocalQueueEnabledInput")?.checked === true,
      ratioOffsetCorrectionEnabled: modules.runtime.getById("settingsRatioOffsetCorrectionInput")?.checked === true,
      aiOptimizeAppId,
      aiOptimizeAppIds: {
        ...(modules.state.state.settings.aiOptimizeAppIds || {}),
        [runningHubRegion]: aiOptimizeAppId
      },
      generativeFillAppId,
      generativeFillAppIds: {
        ...(modules.state.state.settings.generativeFillAppIds || {}),
        [runningHubRegion]: generativeFillAppId
      },
      generativeFillSource: modules.state.state.settings.generativeFillSource,
      generativeFillFeather: modules.runtime.getById("settingsGenerativeFillFeatherInput")?.value,
      generativeFillContextExpansion: modules.runtime.getById("settingsGenerativeFillContextInput")?.value,
      generativeFillMaskExpansion: modules.runtime.getById("settingsGenerativeFillMaskExpansionInput")?.value,
      generativeFillColorCorrectionEnabled: modules.runtime.getById("settingsGenerativeFillColorCorrectionInput")?.checked === true,
      appPickerLayout: modules.runtime.getById("settingsAppPickerLayoutInput")?.checked === true ? "compact" : "visual",
      plusModeEnabled: modules.runtime.getById("settingsPlusModeEnabledInput")?.checked === true,
      activeApiProfileId: modules.state.state.activeApiProfileId || modules.runtime.getById("settingsApiProfileSelect")?.value || ""
    });
  }

  function readAdvancedSettingsForm() {
    const runningHubRegion = getCurrentRunningHubRegion();
    const aiOptimizeAppId = modules.runtime.getById("settingsAiOptimizeAppIdInput")?.value || "";
    const generativeFillAppId = modules.runtime.getById("settingsGenerativeFillAppIdInput")?.value || "";
    return modules.state.normalizeSettings({
      ...modules.state.state.settings,
      pollInterval: modules.runtime.getById("settingsPollIntervalInput")?.value,
      timeout: modules.runtime.getById("settingsTimeoutInput")?.value,
      maxConcurrentTasks: modules.runtime.getById("settingsMaxConcurrentTasksInput")?.value,
      localQueueEnabled: modules.runtime.getById("settingsLocalQueueEnabledInput")?.checked === true,
      ratioOffsetCorrectionEnabled: modules.runtime.getById("settingsRatioOffsetCorrectionInput")?.checked === true,
      aiOptimizeAppId,
      aiOptimizeAppIds: {
        ...(modules.state.state.settings.aiOptimizeAppIds || {}),
        [runningHubRegion]: aiOptimizeAppId
      },
      generativeFillAppId,
      generativeFillAppIds: {
        ...(modules.state.state.settings.generativeFillAppIds || {}),
        [runningHubRegion]: generativeFillAppId
      },
      generativeFillFeather: modules.runtime.getById("settingsGenerativeFillFeatherInput")?.value,
      generativeFillContextExpansion: modules.runtime.getById("settingsGenerativeFillContextInput")?.value,
      generativeFillMaskExpansion: modules.runtime.getById("settingsGenerativeFillMaskExpansionInput")?.value,
      generativeFillColorCorrectionEnabled: modules.runtime.getById("settingsGenerativeFillColorCorrectionInput")?.checked === true,
      appPickerLayout: modules.runtime.getById("settingsAppPickerLayoutInput")?.checked === true ? "compact" : "visual",
      plusModeEnabled: modules.runtime.getById("settingsPlusModeEnabledInput")?.checked === true,
      apiKey: modules.state.state.settings.apiKey,
      runningHubRegion: modules.state.state.settings.runningHubRegion,
      activeApiProfileId: modules.state.state.activeApiProfileId || modules.state.state.settings.activeApiProfileId || ""
    });
  }

  async function writeSettingsStorage(nextSettings, thirdParty) {
    await modules.runtime.storageSetItem(
      modules.state.STORAGE_KEYS.SETTINGS,
      JSON.stringify({
        pollInterval: nextSettings.pollInterval,
        timeout: nextSettings.timeout,
        maxConcurrentTasks: nextSettings.maxConcurrentTasks,
        localQueueEnabled: nextSettings.localQueueEnabled,
        ratioOffsetCorrectionEnabled: nextSettings.ratioOffsetCorrectionEnabled,
        aiOptimizeAppId: nextSettings.aiOptimizeAppId,
        aiOptimizeAppIds: nextSettings.aiOptimizeAppIds,
        generativeFillAppId: nextSettings.generativeFillAppId,
        generativeFillAppIds: nextSettings.generativeFillAppIds,
        generativeFillSource: nextSettings.generativeFillSource,
        generativeFillContextExpansion: nextSettings.generativeFillContextExpansion,
        generativeFillMaskExpansion: nextSettings.generativeFillMaskExpansion,
        generativeFillFeather: nextSettings.generativeFillFeather,
        generativeFillColorCorrectionEnabled: nextSettings.generativeFillColorCorrectionEnabled,
        appPickerLayout: nextSettings.appPickerLayout,
        plusModeEnabled: nextSettings.plusModeEnabled,
        runningHubRegion: nextSettings.runningHubRegion,
        activeApiProfileId: nextSettings.activeApiProfileId,
        thirdParty
      })
    );
  }

  function applySettingsSnapshot(nextSettings, thirdParty, options = {}) {
    modules.state.state.settings = nextSettings;
    modules.state.state.thirdPartySettings = thirdParty;
    modules.state.state.settingsLoaded = true;
    if (!options.skipFillForm) {
      fillSettingsForm(nextSettings);
    }
    if (modules.workspace && typeof modules.workspace.updateRunButtonState === "function") {
      modules.workspace.updateRunButtonState();
    }
    if (modules.workspace && typeof modules.workspace.renderWorkspace === "function") {
      modules.workspace.renderWorkspace();
    }
    if (modules.apps && typeof modules.apps.renderAppPickerList === "function") {
      modules.apps.renderAppPickerList();
    }
    renderSettingsDiagnostics(options.diagnosticsMessage || "当前设置已同步。", {
      runtime: modules.state.state.hostRuntime,
      hasApiKey: Boolean(nextSettings.apiKey)
    });
  }

  async function loadSettingsSnapshot() {
    const apiKey = String((await modules.runtime.storageGetItem(modules.state.STORAGE_KEYS.API_KEY)) || "").trim();
    const rawSettings = modules.runtime.readJsonText(await modules.runtime.storageGetItem(modules.state.STORAGE_KEYS.SETTINGS), {});
    const rawApiProfiles = modules.runtime.readJsonText(await modules.runtime.storageGetItem(modules.state.STORAGE_KEYS.API_PROFILES), null);
    const rawThirdPartySettings = modules.runtime.readJsonText(
      await modules.runtime.storageGetItem(modules.state.STORAGE_KEYS.THIRD_PARTY_SETTINGS),
      null
    );
    const rawThirdPartyApiKey = await modules.runtime.storageGetItem(modules.state.STORAGE_KEYS.THIRD_PARTY_GRS_API_KEY);
    const rawGeminiApiKeys = modules.runtime.readJsonText(
      await modules.runtime.storageGetItem(modules.state.STORAGE_KEYS.THIRD_PARTY_GEMINI_API_KEYS),
      {}
    );
    const legacyThirdParty = rawSettings && rawSettings.thirdParty && typeof rawSettings.thirdParty === "object" ? rawSettings.thirdParty : {};
    const storedThirdParty = rawThirdPartySettings && typeof rawThirdPartySettings === "object" ? rawThirdPartySettings : {};
    const legacyGrs = legacyThirdParty.grs && typeof legacyThirdParty.grs === "object" ? legacyThirdParty.grs : {};
    const storedGrs = storedThirdParty.grs && typeof storedThirdParty.grs === "object" ? storedThirdParty.grs : {};
    const legacyGemini = legacyThirdParty.gemini && typeof legacyThirdParty.gemini === "object" ? legacyThirdParty.gemini : {};
    const storedGemini = storedThirdParty.gemini && typeof storedThirdParty.gemini === "object" ? storedThirdParty.gemini : {};
    const storedGeminiChannels = storedGemini.channels && typeof storedGemini.channels === "object" ? storedGemini.channels : {};
    const legacyGeminiChannels = legacyGemini.channels && typeof legacyGemini.channels === "object" ? legacyGemini.channels : {};
    const geminiChannels = {};
    for (const channelId of Object.keys(modules.state.GEMINI_CHANNEL_PRESETS)) {
      geminiChannels[channelId] = {
        ...(legacyGeminiChannels[channelId] || {}),
        ...(storedGeminiChannels[channelId] || {}),
        ...(rawGeminiApiKeys && rawGeminiApiKeys[channelId] !== undefined ? { apiKey: rawGeminiApiKeys[channelId] } : {})
      };
    }
    const mergedThirdParty = {
      ...legacyThirdParty,
      ...storedThirdParty,
      grs: {
        ...legacyGrs,
        ...storedGrs,
        ...(rawThirdPartyApiKey !== null && rawThirdPartyApiKey !== undefined ? { apiKey: rawThirdPartyApiKey } : {})
      },
      gemini: {
        ...legacyGemini,
        ...storedGemini,
        channels: geminiChannels
      }
    };
    const thirdParty = modules.state.normalizeThirdPartySettings(mergedThirdParty);
    modules.state.state.thirdPartySettings = thirdParty;
    const runningHubRegion = modules.state.normalizeRunningHubRegion(rawSettings && rawSettings.runningHubRegion);
    const storedProfiles = modules.state.normalizeApiProfileList(
      Array.isArray(rawApiProfiles) ? rawApiProfiles : rawApiProfiles && Array.isArray(rawApiProfiles.profiles) ? rawApiProfiles.profiles : []
    );
    const migratedProfiles = storedProfiles.length || !apiKey
      ? storedProfiles
      : modules.state.normalizeApiProfileList([{ name: "默认 API", apiKey, region: runningHubRegion }]);
    const activeApiProfileId = String(
      (rawApiProfiles && rawApiProfiles.activeApiProfileId) ||
        (rawSettings && rawSettings.activeApiProfileId) ||
        ""
    ).trim();
    const activeProfile =
      migratedProfiles.find((profile) => String(profile.id) === activeApiProfileId && profile.region === runningHubRegion) ||
      migratedProfiles.find((profile) => String(profile.apiKey) === apiKey && profile.region === runningHubRegion) ||
      migratedProfiles.find((profile) => profile.region === runningHubRegion) ||
      null;
    modules.state.state.apiProfiles = migratedProfiles;
    modules.state.state.activeApiProfileId = activeProfile ? activeProfile.id : "";
    return modules.state.normalizeSettings({
      apiKey: activeProfile ? activeProfile.apiKey : "",
      runningHubRegion,
      pollInterval: rawSettings && rawSettings.pollInterval,
      timeout: rawSettings && rawSettings.timeout,
      maxConcurrentTasks: rawSettings && rawSettings.maxConcurrentTasks,
      localQueueEnabled: rawSettings ? rawSettings.localQueueEnabled : undefined,
      ratioOffsetCorrectionEnabled: rawSettings ? rawSettings.ratioOffsetCorrectionEnabled : undefined,
      aiOptimizeAppId: rawSettings && rawSettings.aiOptimizeAppId,
      aiOptimizeAppIds: rawSettings && rawSettings.aiOptimizeAppIds,
      generativeFillAppId: rawSettings && rawSettings.generativeFillAppId,
      generativeFillAppIds: rawSettings && rawSettings.generativeFillAppIds,
      generativeFillSource: rawSettings && rawSettings.generativeFillSource,
      generativeFillContextExpansion: rawSettings && rawSettings.generativeFillContextExpansion,
      generativeFillMaskExpansion: rawSettings && rawSettings.generativeFillMaskExpansion,
      generativeFillFeather: rawSettings && rawSettings.generativeFillFeather,
      generativeFillColorCorrectionEnabled: rawSettings ? rawSettings.generativeFillColorCorrectionEnabled : undefined,
      appPickerLayout: rawSettings && rawSettings.appPickerLayout,
      plusModeEnabled: rawSettings ? rawSettings.plusModeEnabled : undefined,
      activeApiProfileId: activeProfile ? activeProfile.id : ""
    });
  }

  async function saveSettingsSnapshot(settings) {
    const normalized = modules.state.normalizeSettings(settings);
    const thirdParty = modules.state.normalizeThirdPartySettings(modules.state.state.thirdPartySettings);
    const apiProfileState = readApiProfilesFromUi(normalized);
    const activeProfile =
      apiProfileState.profiles.find(
        (profile) =>
          String(profile.id) === String(apiProfileState.activeApiProfileId) &&
          profile.region === normalized.runningHubRegion
      ) ||
      null;
    const nextSettings = modules.state.normalizeSettings({
      ...normalized,
      apiKey: activeProfile ? activeProfile.apiKey : normalized.apiKey,
      runningHubRegion: normalized.runningHubRegion,
      activeApiProfileId: activeProfile ? activeProfile.id : ""
    });
    await modules.runtime.storageSetItem(modules.state.STORAGE_KEYS.API_KEY, nextSettings.apiKey);
    await modules.runtime.storageSetItem(
      modules.state.STORAGE_KEYS.API_PROFILES,
      JSON.stringify({
        version: 2,
        activeApiProfileId: nextSettings.activeApiProfileId,
        profiles: apiProfileState.profiles
      })
    );
    await modules.runtime.storageSetItem(modules.state.STORAGE_KEYS.THIRD_PARTY_SETTINGS, JSON.stringify(thirdParty));
    await modules.runtime.storageSetItem(modules.state.STORAGE_KEYS.THIRD_PARTY_GRS_API_KEY, thirdParty.grs.apiKey || "");
    await modules.runtime.storageSetItem(
      modules.state.STORAGE_KEYS.THIRD_PARTY_GEMINI_API_KEYS,
      JSON.stringify(Object.fromEntries(
        Object.entries(thirdParty.gemini.channels || {}).map(([channelId, config]) => [channelId, String(config && config.apiKey || "")])
      ))
    );
    await writeSettingsStorage(nextSettings, thirdParty);

    modules.state.state.apiProfiles = apiProfileState.profiles;
    modules.state.state.activeApiProfileId = nextSettings.activeApiProfileId;
    applySettingsSnapshot(nextSettings, thirdParty);
    renderSettingsStatus("设置已保存到宿主本地存储。", "success");
    modules.ui.logToWorkspace(
      `设置已保存：轮询 ${nextSettings.pollInterval}s，超时 ${nextSettings.timeout}s，并发 ${nextSettings.maxConcurrentTasks} 个。`,
      "success"
    );
    return nextSettings;
  }

  async function saveAdvancedSettingsSnapshot(options = {}) {
    const thirdParty = modules.state.normalizeThirdPartySettings(modules.state.state.thirdPartySettings);
    const nextSettings = readAdvancedSettingsForm();
    modules.state.state.activeApiProfileId = nextSettings.activeApiProfileId;
    applySettingsSnapshot(nextSettings, thirdParty, {
      diagnosticsMessage: "高级设置已自动同步。",
      skipFillForm: true
    });
    await writeSettingsStorage(nextSettings, thirdParty);
    if (!options.quiet) {
      renderSettingsStatus("高级设置已自动保存并立即生效。", "success");
    }
    return nextSettings;
  }

  async function saveGenerativeFillSource(source) {
    const thirdParty = modules.state.normalizeThirdPartySettings(modules.state.state.thirdPartySettings);
    const nextSettings = modules.state.normalizeSettings({
      ...modules.state.state.settings,
      generativeFillSource: source
    });
    applySettingsSnapshot(nextSettings, thirdParty, {
      diagnosticsMessage: "创成式填充运行来源已同步。",
      skipFillForm: true
    });
    await writeSettingsStorage(nextSettings, thirdParty);
    return nextSettings.generativeFillSource;
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
    const apiProfileSelect = runtime.getById("settingsApiProfileSelect");
    const newApiProfileButton = runtime.getById("btnNewApiProfile");
    const deleteApiProfileButton = runtime.getById("btnDeleteApiProfile");
    const apiProfileList = runtime.getById("apiProfileList");
    const runningHubRegionButtons = Array.from(document.querySelectorAll("[data-runninghub-region]"));
    const grsRegionButtons = Array.from(document.querySelectorAll("[data-grs-region]"));
    const thirdPartyProviderButtons = Array.from(document.querySelectorAll("[data-third-party-provider]"));
    const geminiChannelButtons = Array.from(document.querySelectorAll("[data-gemini-channel]"));
    const resetAiOptimizeButton = runtime.getById("btnResetAiOptimizeAppId");
    const resetGenerativeFillButton = runtime.getById("btnResetGenerativeFillAppId");
    const parseAppButton = runtime.getById("btnParseApp");
    const saveEditingAppButton = runtime.getById("btnSaveEditingApp");
    const deleteEditingAppButton = runtime.getById("btnDeleteEditingApp");
    const saveTemplateButton = runtime.getById("btnSaveTemplate");
    const resetTemplateButton = runtime.getById("btnResetTemplateEditor");
    const loadParseDebugButton = runtime.getById("btnLoadParseDebug");
    const saveThirdPartySettingsButton = runtime.getById("btnSaveThirdPartySettings");
    const refreshGeminiModelsButton = runtime.getById("btnRefreshThirdPartyGeminiModels");
    const themeImageInput = runtime.getById("themeImageInput");
    const clearThemeImageButton = runtime.getById("btnClearThemeImage");
    const clearPromptHistoryButton = runtime.getById("btnClearPromptHistory");
    const fieldIds = [
      "settingsApiKeyInput",
      "settingsApiProfileNameInput",
      "thirdPartyGrsApiKeyInput",
      "thirdPartyGrsChatModelInput",
      "thirdPartyGrsDefaultModelInput",
      "thirdPartyGrsDefaultRatioInput",
      "thirdPartyGrsDefaultResolutionInput",
      "thirdPartyGeminiApiKeyInput",
      "thirdPartyGeminiChatModelInput",
      "thirdPartyGeminiDefaultModelInput",
      "thirdPartyGeminiDefaultRatioInput",
      "thirdPartyGeminiDefaultResolutionInput",
      "thirdPartyMomoEndpointInput"
    ];
    const advancedSettingFieldIds = [
      "settingsPollIntervalInput",
      "settingsTimeoutInput",
      "settingsMaxConcurrentTasksInput",
      "settingsLocalQueueEnabledInput",
      "settingsRatioOffsetCorrectionInput",
      "settingsAiOptimizeAppIdInput",
      "settingsGenerativeFillAppIdInput",
      "settingsGenerativeFillContextInput",
      "settingsGenerativeFillMaskExpansionInput",
      "settingsGenerativeFillFeatherInput",
      "settingsGenerativeFillColorCorrectionInput",
      "settingsAppPickerLayoutInput",
      "settingsPlusModeEnabledInput"
    ];
    const immediateAdvancedFieldIds = new Set([
      "settingsLocalQueueEnabledInput",
      "settingsRatioOffsetCorrectionInput",
      "settingsGenerativeFillColorCorrectionInput",
      "settingsAppPickerLayoutInput",
      "settingsPlusModeEnabledInput"
    ]);
    const generativeFillSettingFieldIds = new Set([
      "settingsGenerativeFillAppIdInput",
      "settingsGenerativeFillContextInput",
      "settingsGenerativeFillMaskExpansionInput",
      "settingsGenerativeFillFeatherInput",
      "settingsGenerativeFillColorCorrectionInput"
    ]);
    let advancedSaveTimer = null;
    let advancedSaveQueue = Promise.resolve();

    bindAppManagerControls();

    if (clearPromptHistoryButton) {
      clearPromptHistoryButton.addEventListener("click", async () => {
        try {
          await modules.promptHistory.clearHistory();
          modules.ui.logToWorkspace("提示词历史已清空。", "info");
        } catch (error) {
          const status = runtime.getById("promptHistorySettingsStatus");
          if (status) runtime.setSummaryStatus(status, `清空提示词历史失败：${error.message}`, "error");
        }
      });
    }

    function scheduleAdvancedSettingsSave(sourceId, options = {}) {
      const sectionLabel = generativeFillSettingFieldIds.has(sourceId) ? "创成式填充设置" : "高级设置";
      const run = async () => {
        advancedSaveTimer = null;
        try {
          const saveOperation = advancedSaveQueue
            .catch(() => {})
            .then(() => saveAdvancedSettingsSnapshot({ quiet: true }));
          advancedSaveQueue = saveOperation;
          await saveOperation;
          renderSettingsStatus(`${sectionLabel}已自动保存并立即生效。`, "success");
        } catch (error) {
          renderSettingsStatus(`${sectionLabel}自动保存失败：${error.message}`, "error");
          modules.ui.logToWorkspace(`${sectionLabel}自动保存失败：${error.message}`, "error");
        }
      };

      if (advancedSaveTimer) {
        window.clearTimeout(advancedSaveTimer);
        advancedSaveTimer = null;
      }

      if (options.immediate) {
        void run();
        return;
      }

      renderSettingsStatus(`${sectionLabel}将在停止输入后自动保存。`, "pending");
      advancedSaveTimer = window.setTimeout(run, 450);
    }

    function prepareNewApiProfileDraft() {
      modules.state.state.activeApiProfileId = "";
      modules.state.state.settings.activeApiProfileId = "";
      const keyInput = runtime.getById("settingsApiKeyInput");
      const nameInput = runtime.getById("settingsApiProfileNameInput");
      const select = runtime.getById("settingsApiProfileSelect");
      const deleteButton = runtime.getById("btnDeleteApiProfile");
      if (keyInput) keyInput.value = "";
      const regionCount = modules.state.state.apiProfiles.filter(
        (profile) => profile.region === getCurrentRunningHubRegion()
      ).length;
      if (nameInput) nameInput.value = `API ${regionCount + 1}`;
      if (select) select.value = "";
      if (deleteButton) deleteButton.disabled = true;
      runtime.getById("apiProfileList")?.querySelectorAll(".api-profile-chip.is-active").forEach((button) => {
        button.classList.remove("is-active");
      });
      if (keyInput) keyInput.focus();
    }

    async function persistApiProfileSelection(profile) {
      if (!profile) return;
      applyActiveApiProfile(profile);
      const settings = modules.state.normalizeSettings({
        ...readSettingsForm(),
        apiKey: profile.apiKey,
        activeApiProfileId: profile.id
      });
      await saveSettingsSnapshot(settings);
      await refreshAccountSummary({ apiKey: settings.apiKey, region: settings.runningHubRegion, quiet: true, force: true });
      renderSettingsStatus(`已切换到 API 档案：${profile.name}`, "success");
    }

    async function persistRunningHubRegion(region) {
      const normalizedRegion = modules.state.normalizeRunningHubRegion(region);
      if (normalizedRegion === getCurrentRunningHubRegion()) return;

      modules.state.state.settings = modules.state.normalizeSettings({
        ...modules.state.state.settings,
        runningHubRegion: normalizedRegion
      });
      const nextProfile = modules.state.state.apiProfiles.find((profile) => profile.region === normalizedRegion) || null;
      modules.state.state.activeApiProfileId = nextProfile ? nextProfile.id : "";
      modules.state.state.settings.activeApiProfileId = nextProfile ? nextProfile.id : "";
      modules.state.state.settings.apiKey = nextProfile ? nextProfile.apiKey : "";
      renderRunningHubRegionControl(normalizedRegion);
      fillSettingsForm(modules.state.state.settings);

      const saved = await saveSettingsSnapshot(modules.state.state.settings);
      await refreshAccountSummary({
        apiKey: saved.apiKey,
        region: saved.runningHubRegion,
        quiet: true,
        force: true
      });
      if (modules.apps && typeof modules.apps.hydrateCurrentApp === "function") {
        await modules.apps.hydrateCurrentApp({ quiet: true });
      }
      renderSettingsStatus(
        `已切换到 RunningHub ${normalizedRegion === modules.state.RUNNINGHUB_REGIONS.GLOBAL ? "国际版" : "国内版"}。`,
        "success"
      );
    }

    runningHubRegionButtons.forEach((button) => {
      button.addEventListener("click", async () => {
        if (button.classList.contains("is-active")) return;
        runningHubRegionButtons.forEach((item) => { item.disabled = true; });
        try {
          await persistRunningHubRegion(button.getAttribute("data-runninghub-region"));
        } catch (error) {
          renderSettingsStatus(`切换 RunningHub 区域失败：${error.message}`, "error");
          renderRunningHubRegionControl();
        } finally {
          runningHubRegionButtons.forEach((item) => { item.disabled = false; });
        }
      });
    });

    grsRegionButtons.forEach((button) => {
      button.addEventListener("click", async () => {
        if (button.classList.contains("is-active")) return;
        const previousThirdParty = modules.state.normalizeThirdPartySettings(modules.state.state.thirdPartySettings);
        grsRegionButtons.forEach((item) => { item.disabled = true; });
        const statusEl = runtime.getById("thirdPartyStatusSummary");
        try {
          renderGrsRegionControl(button.getAttribute("data-grs-region"));
          runtime.setSummaryStatus(statusEl, "正在切换 GRS 服务节点...", "info");
          await saveSettingsSnapshot(readSettingsForm());
          const regionConfig = modules.state.getGrsRegionConfig(modules.state.state.thirdPartySettings.grs.region);
          runtime.setSummaryStatus(statusEl, `已切换到 GRS ${regionConfig.label}。`, "success");
        } catch (error) {
          modules.state.state.thirdPartySettings = previousThirdParty;
          fillThirdPartySettingsForm(previousThirdParty);
          runtime.setSummaryStatus(statusEl, `切换 GRS 节点失败：${error.message}`, "error");
        } finally {
          grsRegionButtons.forEach((item) => { item.disabled = false; });
        }
      });
    });

    thirdPartyProviderButtons.forEach((button) => {
      button.addEventListener("click", () => {
        const provider = button.getAttribute("data-third-party-provider") === "gemini" ? "gemini" : "grs";
        if (provider === getSelectedThirdPartyProvider()) return;
        const snapshot = readThirdPartySettingsForm();
        modules.state.state.thirdPartySettings = modules.state.normalizeThirdPartySettings({ ...snapshot, provider });
        fillThirdPartySettingsForm(modules.state.state.thirdPartySettings);
        refreshThirdPartyWorkspacePreview();
        renderSettingsStatus("检测到未保存的供应商切换。", "pending");
      });
    });
geminiChannelButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const channelId = modules.state.normalizeGeminiChannelId(button.getAttribute("data-gemini-channel"));
    if (channelId === getSelectedGeminiChannel()) return;
    const snapshot = readThirdPartySettingsForm();
    modules.state.state.thirdPartySettings = modules.state.normalizeThirdPartySettings({
      ...snapshot,
      gemini: { ...snapshot.gemini, channelId }
    });
    fillThirdPartySettingsForm(modules.state.state.thirdPartySettings);
    refreshThirdPartyWorkspacePreview();
    renderSettingsStatus("检测到未保存的 Gemini 渠道切换。", "pending");
  });
});

const momoEndpointSelect = runtime.getById("thirdPartyMomoEndpointInput");
if (momoEndpointSelect) {
  momoEndpointSelect.addEventListener("change", () => {
    modules.state.state.thirdPartySettings = readThirdPartySettingsForm();
    refreshThirdPartyWorkspacePreview();
    renderSettingsStatus("检测到未保存的服务地址修改。", "pending");
  });
}

    if (apiProfileSelect) {
      apiProfileSelect.addEventListener("change", async () => {
        const profile = modules.state.state.apiProfiles.find((item) => String(item.id) === String(apiProfileSelect.value));
        if (!profile) {
          prepareNewApiProfileDraft();
          renderSettingsStatus("已准备新增 API 档案，填写 Key 后点击保存设置。", "pending");
          return;
        }
        try {
          await persistApiProfileSelection(profile);
        } catch (error) {
          renderSettingsStatus(`切换 API 档案失败：${error.message}`, "error");
        }
      });
    }

    if (apiProfileList) {
      apiProfileList.addEventListener("click", async (event) => {
        const button = event.target && event.target.closest("[data-api-profile-id]");
        if (!button) return;
        const profile = modules.state.state.apiProfiles.find((item) => String(item.id) === String(button.getAttribute("data-api-profile-id")));
        if (!profile) return;
        try {
          await persistApiProfileSelection(profile);
        } catch (error) {
          renderSettingsStatus(`切换 API 档案失败：${error.message}`, "error");
        }
      });
    }

    if (newApiProfileButton) {
      newApiProfileButton.addEventListener("click", () => {
        prepareNewApiProfileDraft();
        renderSettingsStatus("已准备新增 API 档案，填写 Key 后点击保存设置。", "pending");
      });
    }

    if (deleteApiProfileButton) {
      deleteApiProfileButton.addEventListener("click", async () => {
        const active = getActiveApiProfile();
        if (!active) return;
        const nextProfiles = modules.state.state.apiProfiles.filter((profile) => String(profile.id) !== String(active.id));
        modules.state.state.apiProfiles = modules.state.normalizeApiProfileList(nextProfiles);
        const nextActive = modules.state.state.apiProfiles.find(
          (profile) => profile.region === getCurrentRunningHubRegion()
        ) || null;
        modules.state.state.activeApiProfileId = nextActive ? nextActive.id : "";
        modules.state.state.settings.apiKey = nextActive ? nextActive.apiKey : "";
        modules.state.state.settings.activeApiProfileId = nextActive ? nextActive.id : "";
        renderApiProfileControls();
        const keyInput = runtime.getById("settingsApiKeyInput");
        if (keyInput) keyInput.value = nextActive ? nextActive.apiKey : "";
        try {
          await saveSettingsSnapshot(modules.state.state.settings);
          await refreshAccountSummary({
            apiKey: modules.state.state.settings.apiKey,
            region: modules.state.state.settings.runningHubRegion,
            quiet: true,
            force: true
          });
          renderSettingsStatus(`已删除 API 档案：${active.name}`, "warn");
        } catch (error) {
          renderSettingsStatus(`删除 API 档案失败：${error.message}`, "error");
        }
      });
    }

    document.querySelectorAll(".theme-swatch[data-theme-preset]").forEach((button) => {
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
      if (id === "thirdPartyGrsDefaultModelInput") {
        element.addEventListener("change", () => {
          fillThirdPartyCapabilitySelects(
            element.value,
            runtime.getById("thirdPartyGrsDefaultRatioInput")?.value,
            runtime.getById("thirdPartyGrsDefaultResolutionInput")?.value
          );
        });
      }
      if (["thirdPartyGeminiDefaultModelInput", "thirdPartyGeminiDefaultRatioInput", "thirdPartyGeminiDefaultResolutionInput"].includes(id)) {
        element.addEventListener("change", () => {
          modules.state.state.thirdPartySettings = readThirdPartySettingsForm();
          refreshThirdPartyWorkspacePreview();
        });
      }
      element.addEventListener("input", () => renderSettingsStatus("检测到未保存修改。", "pending"));
    });

    if (refreshGeminiModelsButton) {
      refreshGeminiModelsButton.addEventListener("click", async () => {
        const statusEl = runtime.getById("thirdPartyStatusSummary");
        const snapshot = readThirdPartySettingsForm();
        const gemini = snapshot.gemini;
        const active = gemini.channels?.[gemini.channelId] || gemini;
        if (!String(active.apiKey || "").trim()) {
          runtime.setSummaryStatus(statusEl, "请先填写当前 Gemini 渠道的 API Key。", "warn");
          return;
        }
        if (!modules.runtime.isPluginRuntime()) {
          runtime.setSummaryStatus(statusEl, "浏览器预览模式无法请求 Gemini 模型列表。", "warn");
          return;
        }
        refreshGeminiModelsButton.disabled = true;
        runtime.setSummaryStatus(statusEl, `正在从 ${modules.state.getGeminiChannelPreset(gemini.channelId).label} 获取模型...`, "info");
        try {
          const result = await modules.runtime.callHost(
            "thirdParty.gemini.listModels",
            [{ config: { ...active, channelId: gemini.channelId } }],
            { timeoutMs: 30000 }
          );
          const remoteModels = (Array.isArray(result && result.models) ? result.models : [])
            .map((model) => String(model && (model.id || model.name) || model || "").replace(/^models\//i, "").trim())
            .filter((model, index, models) => model && models.indexOf(model) === index);
          if (!remoteModels.length) throw new Error("渠道未返回可用模型");
          const imageModels = (Array.isArray(result && result.imageModels) ? result.imageModels : [])
            .map((model) => String(model || "").replace(/^models\//i, "").trim())
            .filter((model, index, models) => model && models.indexOf(model) === index);
          const textModels = (Array.isArray(result && result.chatModels) ? result.chatModels : [])
            .map((model) => String(model || "").replace(/^models\//i, "").trim())
            .filter((model, index, models) => model && models.indexOf(model) === index);
          const effectiveImageModels = imageModels.length ? imageModels : active.imageModels;
          const effectiveChatModels = textModels.length ? textModels : active.chatModels;
          if (!effectiveImageModels.length || !effectiveChatModels.length) {
            throw new Error("渠道没有返回完整的生图和文字模型分类");
          }
          const nextChannel = {
            ...active,
            imageModels: effectiveImageModels,
            chatModels: effectiveChatModels,
            selectedModel: effectiveImageModels.includes(active.selectedModel) ? active.selectedModel : effectiveImageModels[0],
            chatModel: effectiveChatModels.includes(active.chatModel) ? active.chatModel : effectiveChatModels[0]
          };
          modules.state.state.thirdPartySettings = modules.state.normalizeThirdPartySettings({
            ...snapshot,
            gemini: {
              ...gemini,
              channels: { ...gemini.channels, [gemini.channelId]: nextChannel }
            }
          });
          fillThirdPartySettingsForm(modules.state.state.thirdPartySettings);
          refreshThirdPartyWorkspacePreview();
          runtime.setSummaryStatus(
            statusEl,
            `已获取 ${imageModels.length} 个生图模型、${textModels.length} 个文字模型，请保存第三方设置。`,
            "success"
          );
        } catch (error) {
          runtime.setSummaryStatus(statusEl, `模型刷新失败，已保留现有列表：${error.message}`, "error");
        } finally {
          refreshGeminiModelsButton.disabled = false;
        }
      });
    }

    if (saveThirdPartySettingsButton) {
      saveThirdPartySettingsButton.addEventListener("click", async () => {
        const statusEl = runtime.getById("thirdPartyStatusSummary");
        saveThirdPartySettingsButton.disabled = true;
        runtime.setSummaryStatus(statusEl, "正在保存第三方设置...", "info");
        try {
          await saveSettingsSnapshot(readSettingsForm());
          const descriptor = modules.state.getThirdPartyProviderDescriptor();
          runtime.setSummaryStatus(statusEl, `第三方设置已保存 · ${descriptor.label} · ${descriptor.config.selectedModel}`, "success");
        } catch (error) {
          runtime.setSummaryStatus(statusEl, `第三方设置保存失败：${error.message}`, "error");
        } finally {
          saveThirdPartySettingsButton.disabled = false;
        }
      });
    }

    advancedSettingFieldIds.forEach((id) => {
      const element = runtime.getById(id);
      if (!element) return;
      const eventName = element.type === "checkbox" ? "change" : "input";
      element.addEventListener(eventName, () => {
        if (generativeFillSettingFieldIds.has(id)) {
          modules.state.state.settings = readAdvancedSettingsForm();
        }
        if (id === "settingsMaxConcurrentTasksInput") {
          const previewSettings = modules.state.normalizeSettings({
            ...modules.state.state.settings,
            maxConcurrentTasks: element.value
          });
          modules.state.state.settings.maxConcurrentTasks = previewSettings.maxConcurrentTasks;
          if (modules.workspace && typeof modules.workspace.flushQueuedTasks === "function") {
            modules.workspace.flushQueuedTasks();
          } else if (modules.workspace && typeof modules.workspace.updateRunButtonState === "function") {
            modules.workspace.updateRunButtonState();
          }
        }
        if (id === "settingsLocalQueueEnabledInput") {
          const previewSettings = modules.state.normalizeSettings({
            ...modules.state.state.settings,
            localQueueEnabled: element.checked === true
          });
          modules.state.state.settings.localQueueEnabled = previewSettings.localQueueEnabled;
          if (modules.workspace && typeof modules.workspace.flushQueuedTasks === "function") {
            modules.workspace.flushQueuedTasks();
          } else if (modules.workspace && typeof modules.workspace.updateRunButtonState === "function") {
            modules.workspace.updateRunButtonState();
          }
        }
        if (id === "settingsRatioOffsetCorrectionInput") {
          const previewSettings = modules.state.normalizeSettings({
            ...modules.state.state.settings,
            ratioOffsetCorrectionEnabled: element.checked === true
          });
          modules.state.state.settings.ratioOffsetCorrectionEnabled = previewSettings.ratioOffsetCorrectionEnabled;
          if (modules.workspace && typeof modules.workspace.updateRunButtonState === "function") {
            modules.workspace.updateRunButtonState();
          }
        }
        scheduleAdvancedSettingsSave(id, { immediate: immediateAdvancedFieldIds.has(id) });
      });
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
      resetAiOptimizeButton.addEventListener("click", async () => {
        const input = runtime.getById("settingsAiOptimizeAppIdInput");
        if (input) input.value = modules.state.getDefaultAiOptimizeAppId(getCurrentRunningHubRegion());
        scheduleAdvancedSettingsSave("settingsAiOptimizeAppIdInput", { immediate: true });
      });
    }

    if (resetGenerativeFillButton) {
      resetGenerativeFillButton.addEventListener("click", async () => {
        const input = runtime.getById("settingsGenerativeFillAppIdInput");
        const colorCorrectionInput = runtime.getById("settingsGenerativeFillColorCorrectionInput");
        if (input) input.value = modules.state.getDefaultGenerativeFillAppId(getCurrentRunningHubRegion());
        if (colorCorrectionInput) colorCorrectionInput.checked = true;
        scheduleAdvancedSettingsSave("settingsGenerativeFillAppIdInput", { immediate: true });
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

    ["appEditorAppIdInput", "appEditorNameInput", "appEditorDescriptionInput", "appEditorPreviewImageInput", "appEditorInputsInput"].forEach((id) => {
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
      resetTemplateButton.addEventListener("click", async () => {
        await modules.templates.fillTemplateEditor(null);
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
    saveGenerativeFillSource,
    refreshThemeSkin,
    bindSettingsActions
  };
})(window);
