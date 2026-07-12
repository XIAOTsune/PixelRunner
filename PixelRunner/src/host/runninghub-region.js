const RUNNINGHUB_REGION_CONFIG = {
  cn: {
    region: "cn",
    baseUrl: "https://www.runninghub.cn"
  },
  global: {
    region: "global",
    baseUrl: "https://www.runninghub.ai"
  }
};

export function normalizeRunningHubRegion(value) {
  const marker = String(value || "").trim().toLowerCase();
  return ["global", "international", "intl", "overseas", "ai"].includes(marker) ? "global" : "cn";
}

export function getRunningHubRegionConfig(value) {
  return RUNNINGHUB_REGION_CONFIG[normalizeRunningHubRegion(value)];
}

export function resolveRunningHubRegion(payload, fallback = "cn") {
  const source = payload && typeof payload === "object" ? payload : {};
  const settings = source.settings && typeof source.settings === "object" ? source.settings : {};
  return normalizeRunningHubRegion(
    source.region || source.runningHubRegion || settings.runningHubRegion || settings.region || fallback
  );
}
