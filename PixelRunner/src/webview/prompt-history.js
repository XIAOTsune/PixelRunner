(function initPromptHistoryModule(global) {
  const modules = (global.PixelRunnerModules = global.PixelRunnerModules || {});
  const MAX_ITEMS = 30;
  const MAX_FIELD_ITEMS = 10;
  const MAX_CONTENT_LENGTH = 8000;

  function getStorageKey() {
    return modules.state.STORAGE_KEYS.PROMPT_HISTORY;
  }

  function normalizeItem(source, index = 0) {
    if (!source || typeof source !== "object") return null;
    const content = String(source.content == null ? "" : source.content).trim();
    const appId = String(source.appId || "").trim();
    const fieldKey = String(source.fieldKey || "").trim();
    if (!content || !fieldKey) return null;
    const now = Date.now();
    return {
      id: String(source.id || modules.runtime.createId("prompt-history")),
      appId,
      appName: String(source.appName || "未命名应用").trim() || "未命名应用",
      fieldKey,
      content: content.slice(0, MAX_CONTENT_LENGTH),
      createdAt: Number(source.createdAt) > 0 ? Number(source.createdAt) : now + index,
      lastUsedAt: Number(source.lastUsedAt) > 0 ? Number(source.lastUsedAt) : now + index
    };
  }

  function normalizeList(value) {
    const seen = new Set();
    return (Array.isArray(value) ? value : [])
      .map((item, index) => normalizeItem(item, index))
      .filter((item) => {
        if (!item) return false;
        const fingerprint = `${item.appId}\n${item.fieldKey}\n${item.content}`;
        if (seen.has(fingerprint)) return false;
        seen.add(fingerprint);
        return true;
      })
      .sort((a, b) => Number(b.lastUsedAt || 0) - Number(a.lastUsedAt || 0))
      .slice(0, MAX_ITEMS);
  }

  async function persist() {
    await modules.runtime.storageSetItem(getStorageKey(), JSON.stringify(modules.state.state.promptHistory || []));
  }

  async function initialize() {
    const raw = await modules.runtime.storageGetItem(getStorageKey());
    const parsed = modules.runtime.readJsonText(raw, []);
    modules.state.state.promptHistory = normalizeList(parsed);
    if (Array.isArray(parsed) && parsed.length !== modules.state.state.promptHistory.length) {
      await persist();
    }
    renderSettingsSummary();
    return modules.state.state.promptHistory;
  }

  function getForField(fieldKey, appId = "") {
    const key = String(fieldKey || "").trim();
    const currentAppId = String(appId || (modules.state.state.currentApp && modules.state.resolveAppId(modules.state.state.currentApp)) || "").trim();
    const items = Array.isArray(modules.state.state.promptHistory) ? modules.state.state.promptHistory : [];
    const matching = items.filter((item) => item.fieldKey === key);
    if (!currentAppId) return matching.slice(0, MAX_FIELD_ITEMS);
    const current = matching.filter((item) => item.appId === currentAppId);
    const other = matching.filter((item) => item.appId !== currentAppId);
    return [...current, ...other].slice(0, MAX_FIELD_ITEMS);
  }

  function formatAge(timestamp) {
    const elapsed = Math.max(0, Date.now() - Number(timestamp || 0));
    if (elapsed < 60000) return "刚刚";
    if (elapsed < 3600000) return `${Math.max(1, Math.floor(elapsed / 60000))} 分钟前`;
    if (elapsed < 86400000) return `${Math.max(1, Math.floor(elapsed / 3600000))} 小时前`;
    return `${Math.max(1, Math.floor(elapsed / 86400000))} 天前`;
  }

  function renderTrigger(fieldKey) {
    const key = String(fieldKey || "").trim();
    const items = getForField(key);
    const runtime = modules.runtime;
    const body = items.length
      ? items.map((item) => {
          const preview = item.content.replace(/\s+/g, " ").trim();
          return `<button class="prompt-history-item" type="button" data-action="apply-prompt-history" data-form-key="${runtime.escapeHtml(key)}" data-history-id="${runtime.escapeHtml(item.id)}"><strong>${runtime.escapeHtml(preview)}</strong><span>${runtime.escapeHtml(item.appName)} · ${runtime.escapeHtml(formatAge(item.lastUsedAt))}</span></button>`;
        }).join("")
      : '<div class="prompt-history-empty">暂无最近记录<span>完成一次成功运行后会显示在这里。</span></div>';
    return `<details class="prompt-history-menu"><summary class="mini-btn prompt-history-trigger-btn">最近</summary><div class="prompt-history-popover">${body}</div></details>`;
  }

  async function recordSuccessfulRun(payload) {
    const source = payload && typeof payload === "object" ? payload : {};
    const app = source.app && typeof source.app === "object" ? source.app : modules.state.state.currentApp;
    const appId = String(source.appId || modules.state.resolveAppId(app) || "").trim();
    const appName = String(source.appName || (app && app.name) || "未命名应用").trim() || "未命名应用";
    const inputs = source.inputs && typeof source.inputs === "object" ? source.inputs : {};
    const metas = Array.isArray(app && app.inputs) ? app.inputs : [];
    const now = Date.now();
    let changed = false;
    metas.forEach((input) => {
      if (!modules.state.isPromptLikeInput(input)) return;
      const fieldKey = String(input.key || "").trim();
      const content = String(inputs[fieldKey] == null ? "" : inputs[fieldKey]).trim();
      if (!fieldKey || !content) return;
      const normalizedContent = content.slice(0, MAX_CONTENT_LENGTH);
      const list = Array.isArray(modules.state.state.promptHistory) ? modules.state.state.promptHistory : [];
      const existing = list.find((item) => item.appId === appId && item.fieldKey === fieldKey && item.content === normalizedContent);
      if (existing) {
        existing.lastUsedAt = now;
        existing.appName = appName;
      } else {
        list.push({ id: modules.runtime.createId("prompt-history"), appId, appName, fieldKey, content: normalizedContent, createdAt: now, lastUsedAt: now });
      }
      modules.state.state.promptHistory = normalizeList(list);
      changed = true;
    });
    if (changed) {
      await persist();
      renderSettingsSummary();
    }
  }

  function applyHistoryItem(historyId, fieldKey) {
    const item = (modules.state.state.promptHistory || []).find((entry) => String(entry.id) === String(historyId) && String(entry.fieldKey) === String(fieldKey));
    if (!item) return false;
    modules.state.state.formValues[fieldKey] = item.content;
    item.lastUsedAt = Date.now();
    modules.state.state.promptHistory = normalizeList(modules.state.state.promptHistory);
    void persist();
    renderSettingsSummary();
    return true;
  }

  async function clearHistory() {
    modules.state.state.promptHistory = [];
    await persist();
    renderSettingsSummary();
    if (modules.workspace && typeof modules.workspace.renderWorkspace === "function") modules.workspace.renderWorkspace();
  }

  function renderSettingsSummary() {
    const count = Array.isArray(modules.state.state.promptHistory) ? modules.state.state.promptHistory.length : 0;
    const badge = modules.runtime.getById("promptHistorySettingsSummary");
    const status = modules.runtime.getById("promptHistorySettingsStatus");
    if (badge) badge.textContent = `${count} 条`;
    if (status && !status.dataset.customStatus) status.textContent = count ? `已保存 ${count} 条成功使用过的提示词。` : "暂无历史记录。";
  }

  modules.promptHistory = { initialize, getForField, renderTrigger, recordSuccessfulRun, applyHistoryItem, clearHistory, renderSettingsSummary };
})(window);
