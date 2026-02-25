const STORAGE_KEYS = {
  API_KEY: "rh_api_key",
  AI_APPS: "rh_ai_apps_v2",
  LEGACY_AI_APPS: ["rh_ai_apps", "rh_ai_apps_v1", "ai_apps", "runninghub_ai_apps"],
  PROMPT_TEMPLATES: "rh_prompt_templates",
  SETTINGS: "rh_settings",
  LEGACY_WORKFLOWS: "rh_workflows"
};

const API = {
  BASE_URL: "https://www.runninghub.cn",
  ENDPOINTS: {
    PARSE_APP: "/api/webapp/apiCallDemo",
    AI_APP_RUN: "/task/openapi/ai-app/run",
    LEGACY_CREATE_TASK: "/task/openapi/create",
    TASK_OUTPUTS: "/task/openapi/outputs",
    ACCOUNT_STATUS: "/uc/openapi/accountStatus",
    UPLOAD_V2: "/openapi/v2/media/upload/binary",
    UPLOAD_LEGACY: "/uc/openapi/upload"
  },
  PARSE_FALLBACKS: [
    "/uc/openapi/app",
    "/uc/openapi/community/app",
    "/uc/openapi/workflow"
  ]
};

const DEFAULT_SETTINGS = {
  pollInterval: 2,
  timeout: 180,
  uploadMaxEdge: 0,
  pasteStrategy: "normal"
};

const DEFAULT_PROMPT_TEMPLATES = [
  {
    id: "high_quality",
    title: "高质量二次元",
    content: "masterpiece, best quality, anime style, detailed background, vibrant colors"
  },
  {
    id: "realistic",
    title: "写实摄影",
    content: "photorealistic, professional photography, sharp focus, 8k, detailed skin texture"
  }
];

module.exports = {
  STORAGE_KEYS,
  API,
  DEFAULT_SETTINGS,
  DEFAULT_PROMPT_TEMPLATES
};
