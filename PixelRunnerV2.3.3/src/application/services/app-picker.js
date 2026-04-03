function normalizeAppPickerKeyword(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeApps(apps) {
  return (Array.isArray(apps) ? apps : []).filter((app) => app && typeof app === "object");
}

function buildAppPickerViewModel(options = {}) {
  const apps = normalizeApps(options.apps);
  const keyword = normalizeAppPickerKeyword(options.keyword);
  const currentAppId = String(options.currentAppId || "");
  const visibleApps = keyword
    ? apps.filter((app) => String(app.name || "").toLowerCase().includes(keyword))
    : apps;

  const items = visibleApps.map((app) => ({
    id: String(app.id || ""),
    name: String(app.name || "Unnamed App"),
    appId: String(app.appId || "-"),
    inputCount: Array.isArray(app.inputs) ? app.inputs.length : 0,
    active: !!currentAppId && String(app.id || "") === currentAppId
  }));

  let emptyState = null;
  if (items.length === 0) {
    if (apps.length === 0) {
      emptyState = {
        kind: "no_apps",
        message: "No saved apps.",
        actionLabel: "Go to Settings"
      };
    } else {
      emptyState = {
        kind: "no_matches",
        message: "No matching apps."
      };
    }
  }

  return {
    totalCount: apps.length,
    visibleCount: visibleApps.length,
    empty: items.length === 0,
    emptyState,
    items
  };
}

module.exports = {
  normalizeAppPickerKeyword,
  buildAppPickerViewModel
};
