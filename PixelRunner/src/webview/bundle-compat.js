const DEFAULT_REGIONS = {
  CN: "cn",
  GLOBAL: "global"
};

function defaultNormalizeRegion(value) {
  const marker = String(value || "").trim().toLowerCase();
  return ["global", "international", "intl", "overseas", "ai"].includes(marker)
    ? DEFAULT_REGIONS.GLOBAL
    : DEFAULT_REGIONS.CN;
}

function isObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function getAppIdentityKeys(app, region) {
  const prefix = `${region}:`;
  const id = String((app && app.id) || "").trim().toLowerCase();
  const appId = String(
    (app && (app.appId || app.webappId || app.webAppId || app.workflowId || app.workflowID || app.code || app.appid || app.webappid)) || ""
  ).trim().toLowerCase();
  const name = String((app && (app.name || app.title)) || "").trim().toLowerCase();
  return [
    id ? `${prefix}id:${id}` : "",
    appId && name ? `${prefix}app-name:${appId}:${name}` : "",
    !id && appId && !name ? `${prefix}app:${appId}` : "",
    !id && !appId && name ? `${prefix}name:${name}` : ""
  ].filter(Boolean);
}

export function parseBundleApps(parsed, options = {}) {
  const regions = options.regions && typeof options.regions === "object" ? options.regions : DEFAULT_REGIONS;
  const normalizeRegion = typeof options.normalizeRegion === "function" ? options.normalizeRegion : defaultNormalizeRegion;
  const cnRegion = String(regions.CN || DEFAULT_REGIONS.CN);
  const globalRegion = String(regions.GLOBAL || DEFAULT_REGIONS.GLOBAL);
  const fallbackRegion = normalizeRegion(parsed && (parsed.region || parsed.runningHubRegion));
  const apps = [];
  const regionalIdentityKeys = new Set();

  const normalizeApp = (app, forcedRegion = "") => {
    if (!isObject(app)) return;
    const region = forcedRegion || normalizeRegion(app.region || app.runningHubRegion || fallbackRegion);
    return { app: { ...app, region }, region };
  };

  const appsByRegion = isObject(parsed && parsed.appsByRegion) ? parsed.appsByRegion : null;
  if (appsByRegion) {
    const appendRegionalApp = (app, region) => {
      const normalized = normalizeApp(app, region);
      if (!normalized) return;
      apps.push(normalized.app);
      getAppIdentityKeys(normalized.app, region).forEach((key) => regionalIdentityKeys.add(key));
    };
    (Array.isArray(appsByRegion[cnRegion]) ? appsByRegion[cnRegion] : []).forEach((app) => appendRegionalApp(app, cnRegion));
    (Array.isArray(appsByRegion[globalRegion]) ? appsByRegion[globalRegion] : []).forEach((app) => appendRegionalApp(app, globalRegion));
  }

  // v2 stores every app in `apps`. Keep it as a fallback for v2 and partially migrated v3 bundles.
  (Array.isArray(parsed && parsed.apps) ? parsed.apps : []).forEach((app) => {
    const normalized = normalizeApp(app);
    if (!normalized) return;
    const keys = getAppIdentityKeys(normalized.app, normalized.region);
    if (appsByRegion && keys.some((key) => regionalIdentityKeys.has(key))) return;
    apps.push(normalized.app);
  });
  return apps;
}

export function parseTransferPackageText(text, options = {}) {
  const parsed = JSON.parse(String(text || "").trim());
  const isBundle = isObject(parsed) && String(parsed.schema || "").trim().toLowerCase() === "pixelrunner.bundle";
  if (isBundle) {
    return {
      kind: "bundle",
      apps: parseBundleApps(parsed, options),
      templateCategories: Array.isArray(parsed.templateCategories)
        ? parsed.templateCategories
        : Array.isArray(parsed.promptTemplateCategories)
          ? parsed.promptTemplateCategories
          : Array.isArray(parsed.categories)
            ? parsed.categories
            : [],
      templates: Array.isArray(parsed.templates) ? parsed.templates : [],
      quickEntries: Array.isArray(parsed.quickEntries) ? parsed.quickEntries : []
    };
  }

  return {
    kind: "templates",
    apps: [],
    templateCategories: isObject(parsed) && Array.isArray(parsed.templateCategories) ? parsed.templateCategories : [],
    templates: isObject(parsed) && Array.isArray(parsed.templates) ? parsed.templates : parsed,
    quickEntries: []
  };
}
