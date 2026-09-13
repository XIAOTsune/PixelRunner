(function initPromptHistoryModule(global) {
  const modules = (global.PixelRunnerModules = global.PixelRunnerModules || {});
  const MAX_ITEMS = 30;
  const MAX_FIELD_ITEMS = 10;
  let historyCleared = false;

  function getStorageKey() { return modules.state.STORAGE_KEYS.PROMPT_HISTORY; }

  function normalizeItem(source) {
    if (!source || typeof source !== "object" || typeof source.content !== "string") return null;
    const content = source.content;
    if (!content.trim()) return null;
    const appId = String(source.appId || source.applicationId || "").trim();
    const fieldKey = String(source.fieldKey || source.key || "prompt").trim() || "prompt";
    const fieldLabel = String(source.fieldLabel || source.label || fieldKey || "提示词").trim() || "提示词";
    const now = Date.now();
    const validTime = (value) => Number.isFinite(Number(value)) && Number(value) > 0;
    const createdAt = validTime(source.createdAt) ? Number(source.createdAt) : validTime(source.lastUsedAt) ? Number(source.lastUsedAt) : now;
    return {
      id: String(source.id || modules.runtime.createId("prompt-history")), appId,
      appName: String(source.appName || source.applicationName || "未命名应用").trim() || "未命名应用",
      fieldKey, fieldLabel, content,
      createdAt,
      lastUsedAt: validTime(source.lastUsedAt) ? Number(source.lastUsedAt) : createdAt
    };
  }

  function normalizeList(value) {
    const seen = new Set();
    const ids = new Set();
    return (Array.isArray(value) ? value : []).map((item) => normalizeItem(item)).filter(Boolean)
      .sort((a, b) => b.lastUsedAt - a.lastUsedAt).filter((item) => {
      const fingerprint = JSON.stringify([item.appId, item.fieldKey, item.content.trim()]);
      if (seen.has(fingerprint)) return false;
      seen.add(fingerprint);
      if (ids.has(item.id)) item.id = modules.runtime.createId("prompt-history");
      ids.add(item.id);
      return true;
    }).slice(0, MAX_ITEMS);
  }

  async function persist() { await modules.runtime.storageSetItem(getStorageKey(), JSON.stringify(modules.state.state.promptHistory || [])); }

  async function initialize() {
    const raw = await modules.runtime.storageGetItem(getStorageKey());
    const parsed = modules.runtime.readJsonText(raw, []);
    const normalized = normalizeList(parsed);
    modules.state.state.promptHistory = normalized;
    if (JSON.stringify(Array.isArray(parsed) ? parsed : []) !== JSON.stringify(normalized)) await persist();
    historyCleared = false;
    refreshViews();
    return normalized;
  }

  function getItems() {
    return [...(modules.state.state.promptHistory || [])].sort((a, b) => b.lastUsedAt - a.lastUsedAt).slice(0, MAX_ITEMS);
  }

  function getCandidates(fieldKey, appId, limit = MAX_FIELD_ITEMS) {
    const key = String(fieldKey || "").trim();
    const currentAppId = String(appId == null ? modules.state.resolveAppId(modules.state.state.currentApp) || "" : appId).trim();
    const items = getItems();
    return items.map((item, index) => {
      const sameField = Boolean(key) && String(item.fieldKey || "").trim() === key;
      const sameApp = Boolean(currentAppId) && String(item.appId || "").trim() === currentAppId;
      return { item, bucket: sameApp && sameField ? 0 : sameApp ? 1 : sameField ? 2 : 3, index };
    }).sort((a, b) => a.bucket - b.bucket || a.index - b.index).slice(0, Math.min(MAX_FIELD_ITEMS, Math.max(0, limit))).map((entry) => entry.item);
  }

  function getForField(fieldKey, appId) { return getCandidates(fieldKey, appId); }

  function formatAge(timestamp) {
    const elapsed = Math.max(0, Date.now() - Number(timestamp || 0));
    if (elapsed < 60000) return "刚刚";
    if (elapsed < 3600000) return `${Math.max(1, Math.floor(elapsed / 60000))} 分钟前`;
    if (elapsed < 86400000) return `${Math.max(1, Math.floor(elapsed / 3600000))} 小时前`;
    return `${Math.max(1, Math.floor(elapsed / 86400000))} 天前`;
  }

  function renderItem(item, key, options = {}) {
    const runtime = modules.runtime;
    const content = String(item.content || "").replace(/\s+/g, " ").trim();
    const preview = content.length > 180 ? `${content.slice(0, 180)}…` : content;
    const meta = `${item.appName || "未命名应用"} · ${item.fieldLabel || item.fieldKey || "提示词"} · ${formatAge(item.lastUsedAt)}`;
    if (options.selectable === false) return `<div class="prompt-history-item"><strong>${runtime.escapeHtml(preview)}</strong><span>${runtime.escapeHtml(meta)}</span></div>`;
    return `<button class="prompt-history-item" type="button" data-action="apply-prompt-history" data-form-key="${runtime.escapeHtml(key)}" data-history-id="${runtime.escapeHtml(item.id)}"><strong>${runtime.escapeHtml(preview)}</strong><span>${runtime.escapeHtml(meta)}</span></button>`;
  }

  function renderTrigger(fieldKey) {
    const key = String(fieldKey || "").trim();
    const runtime = modules.runtime;
    return `<button class="mini-btn prompt-history-trigger-btn" type="button" data-action="toggle-prompt-history" data-form-key="${runtime.escapeHtml(key)}" aria-controls="${runtime.escapeHtml(panelId(key))}" aria-expanded="false">最近</button>`;
  }

  function panelId(key) { return `prompt-history-${encodeURIComponent(key)}`; }

  function renderList(items, key = "", selectable = false) {
    if (items.length) return items.map((item) => renderItem(item, key, { selectable })).join("");
    return selectable
      ? '<div class="prompt-history-empty">暂无最近记录<span>完成一次成功运行后会显示在这里。</span></div>'
      : '<div class="prompt-history-empty">暂无历史记录。</div>';
  }

  function renderPanel(fieldKey) {
    const key = String(fieldKey || "").trim();
    const escape = modules.runtime.escapeHtml;
    return `<div id="${escape(panelId(key))}" class="prompt-history-panel" data-history-panel="${escape(key)}" role="region" aria-label="最近使用的提示词" hidden>${renderList(getCandidates(key), key, true)}</div>`;
  }

  function togglePanel(button) {
    const key = button.getAttribute("data-form-key");
    const panel = modules.runtime.getById(panelId(key));
    if (!panel) return;
    const expanded = button.getAttribute("aria-expanded") !== "true";
    panel.innerHTML = renderList(getCandidates(key), key, true);
    panel.hidden = !expanded;
    button.setAttribute("aria-expanded", String(expanded));
  }

  function refreshViews() {
    renderSettingsSummary();
    const container = modules.runtime.getById("dynamicInputContainer");
    if (container) container.querySelectorAll("[data-history-panel]").forEach((panel) => {
      const key = panel.getAttribute("data-history-panel");
      panel.innerHTML = renderList(getCandidates(key), key, true);
    });
  }

  async function recordSuccessfulRun(payload) {
    const source = payload && typeof payload === "object" ? payload : {};
    const app = source.app && typeof source.app === "object" ? source.app : modules.state.state.currentApp;
    const appId = String(source.appId || modules.state.resolveAppId(app) || "").trim();
    const appName = String(source.appName || (app && app.name) || "未命名应用").trim() || "未命名应用";
    const inputs = source.inputs && typeof source.inputs === "object" ? source.inputs : {};
    const metas = Array.isArray(app && app.inputs) ? app.inputs : [];
    const now = Date.now(); let changed = false;
    metas.forEach((input) => {
      if (!modules.state.isPromptLikeInput(input)) return;
      const fieldKey = String(input.key || "").trim();
      const content = String(inputs[fieldKey] == null ? "" : inputs[fieldKey]).trim();
      if (!fieldKey || !content) return;
      const list = Array.isArray(modules.state.state.promptHistory) ? modules.state.state.promptHistory : [];
      const existing = list.find((item) => item.appId === appId && item.fieldKey === fieldKey && item.content.trim() === content);
      const fieldLabel = String(input.label || input.name || fieldKey).trim() || fieldKey;
      if (existing) { existing.lastUsedAt = now; existing.appName = appName; existing.fieldLabel = fieldLabel; }
      else list.push({ id: modules.runtime.createId("prompt-history"), appId, appName, fieldKey, fieldLabel, content, createdAt: now, lastUsedAt: now });
      modules.state.state.promptHistory = normalizeList(list); changed = true;
    });
    if (changed) { historyCleared = false; refreshViews(); await persist(); }
  }

  function applyHistoryItem(historyId, fieldKey) {
    const item = (modules.state.state.promptHistory || []).find((entry) => String(entry.id) === String(historyId));
    const key = String(fieldKey || "").trim();
    if (!item || !key) return false;
    modules.state.state.formValues[key] = item.content; item.lastUsedAt = Date.now();
    modules.state.state.promptHistory = normalizeList(modules.state.state.promptHistory); void persist(); refreshViews(); return true;
  }

  async function clearHistory() {
    modules.state.state.promptHistory = [];
    historyCleared = true;
    refreshViews();
    await persist();
  }

  function renderSettingsSummary() {
    const items = getItems();
    const badge = modules.runtime.getById("promptHistorySettingsSummary");
    const status = modules.runtime.getById("promptHistorySettingsStatus");
    const list = modules.runtime.getById("promptHistorySettingsList");
    if (badge) badge.textContent = `${items.length} 条`;
    if (status) modules.runtime.setSummaryStatus(status, items.length ? `已保存 ${items.length} 条成功使用过的提示词。` : historyCleared ? "提示词历史已清空。" : "暂无历史记录。", historyCleared ? "success" : "info");
    if (list) list.innerHTML = renderList(items);
  }

  modules.promptHistory = { initialize, getItems, getForField, getCandidates, renderTrigger, renderPanel, togglePanel, recordSuccessfulRun, applyHistoryItem, clearHistory, renderSettingsSummary };
})(window);
