# Gemini Flattened Code Export

- GeneratedAt: 2026-02-14T14:14:41.853Z
- Root: C:\Users\TSUNE\Desktop\PixelRunner
- FileCount: 13

## File Index

- `index.html`
- `index.js`
- `manifest.json`
- `README.md`
- `scripts/flatten-for-gemini.js`
- `src/app-controller.js`
- `src/config.js`
- `src/controllers/tools-controller.js`
- `src/services/ps.js`
- `src/services/runninghub.js`
- `src/services/store.js`
- `src/utils.js`
- `style.css`

## index.html

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>RunningHub Photoshop 插件</title>
  <link rel="stylesheet" href="style.css" />
</head>
<body>
  <div class="nav-tabs">
      <button id="tabWorkspace" class="nav-item active" type="button">RH 工作台</button>
      <button id="tabTools" class="nav-item" type="button">工具箱</button>
      <button id="tabSettings" class="nav-item" type="button">设置</button>
  </div>
  
  <section id="viewTools" class="tab-content">
    <div class="section-header">图层辅助</div>
    <div class="input-grid">
        <button id="btnNeutralGray" class="main-btn" type="button">新建中性灰 (D&B)</button>
        <button id="btnObserver" class="main-btn" type="button">创建观察层</button>
    </div>
    
    <div class="section-header">合并操作</div>
    <div class="input-grid full-width">
        <button id="btnStamp" class="main-btn" type="button">盖印图层 (Ctrl+Alt+Shift+E)</button>
    </div>
</section>

  <section id="viewWorkspace" class="tab-content active">
    <header class="header">
      <div class="header-main">
        <h3>RunningHub AI 助手</h3>
        <div id="accountSummary" class="account-summary is-empty" title="请先设置 API Key">
          <span class="account-pill">
            <span class="account-pill-label">余额</span>
            <span id="accountBalanceValue" class="account-pill-value">--</span>
          </span>
          <span class="account-pill">
            <span class="account-pill-label">RH币</span>
            <span id="accountCoinsValue" class="account-pill-value">--</span>
          </span>
        </div>
      </div>
      <span class="version">v3.2.0</span>
    </header>

    <div class="card app-select-card">
      <div class="card-title-row">
        <div class="card-title">选择 AI 应用</div>
        <div class="card-title-tools">
          <button id="btnOpenAppPicker" class="tiny-btn tiny-btn-compact" type="button">切换</button>
          <button id="btnRefreshWorkspaceApps" class="tiny-btn tiny-btn-compact" type="button">刷新</button>
        </div>
      </div>
      <div id="appPickerMeta" class="app-picker-meta">
        暂无应用，请在设置页解析并保存
      </div>
    </div>

    <div id="workspaceInputArea" class="workspace-input-area">
      <div id="imageInputContainer" class="image-input-container"></div>
      <div id="dynamicInputContainer" class="dynamic-input-container">
        <div class="empty-state">
          <div class="empty-state-icon">📝</div>
          <div>请先选择一个应用</div>
        </div>
      </div>
    </div>

    <button id="btnRun" class="main-btn main-btn-primary" type="button" disabled>开始运行</button>

    <div id="logWindow">
      <div class="log-info">[系统] 插件已加载，等待操作...</div>
    </div>
  </section>

  <section id="viewSettings" class="tab-content">
    <header class="header">
      <h3>系统设置</h3>
      <span class="version">v3.2.0</span>
    </header>

    <div class="setting-section">
      <div class="setting-section-title">API Key</div>
      <div class="control-group">
        <label for="apiKeyInput">RunningHub API Key</label>
        <div class="inline-input">
          <input id="apiKeyInput" type="password" placeholder="请输入 API Key" />
          <button id="toggleApiKey" type="button" class="tiny-btn">显示</button>
        </div>
      </div>
      <div class="inline-row">
        <button id="btnSaveApiKey" class="main-btn main-btn-primary" type="button">保存设置</button>
        <button id="btnTestApiKey" class="main-btn main-btn-secondary" type="button">测试连接</button>
      </div>
      <div class="setting-hint">API Key 仅保存在本地，不会上传到第三方。</div>
    </div>

    <div class="setting-section">
      <div class="setting-section-title">AI 应用管理</div>
      <div class="control-group">
        <label for="appIdInput">应用 ID / URL</label>
        <div class="inline-row">
          <input id="appIdInput" type="text" placeholder="例如: 123456 或 RunningHub 应用链接" />
          <button id="btnParseApp" class="main-btn main-btn-secondary parse-btn" type="button">解析</button>
        </div>
      </div>
      <div class="control-group">
        <label for="appNameInput">应用名称</label>
        <input id="appNameInput" type="text" placeholder="例如: SDXL 风格化" />
      </div>

      <div id="parseResultContainer"></div>

      <div id="manualConfigArea" class="manual-config" style="display:none;">
        <div class="manual-config-title">自动解析失败，请手动配置参数</div>
        <div id="manualParamsList"></div>
        <div class="inline-row">
          <button id="btnAddParam" type="button" class="main-btn main-btn-secondary">添加参数</button>
          <button id="btnSaveManualApp" type="button" class="main-btn main-btn-primary">保存应用</button>
        </div>
      </div>

      <div id="savedAppsList" class="saved-list"></div>
    </div>

    <div class="setting-section">
      <div class="setting-section-title">提示词模板</div>
      <div class="control-group">
        <label for="templateTitleInput">模板标题</label>
        <input id="templateTitleInput" type="text" placeholder="例如: 高质量二次元" />
      </div>
      <div class="control-group">
        <label for="templateContentInput">模板内容</label>
        <textarea id="templateContentInput" rows="3" placeholder="输入模板文本"></textarea>
      </div>
      <button id="btnSaveTemplate" type="button" class="main-btn main-btn-primary">保存模板</button>
      <div id="savedTemplatesList" class="saved-list"></div>
    </div>

    <div id="advancedSettingsSection" class="setting-section setting-section-collapsible setting-section-compact is-collapsed">
      <div id="advancedSettingsHeader" class="setting-section-title setting-section-toggle" role="button" tabindex="0" aria-expanded="false">
        <span>高级设置</span>
        <button id="advancedSettingsToggle" type="button" class="dynamic-input-toggle setting-section-toggle-btn">展开</button>
      </div>
      <div class="setting-section-body">
        <div class="control-group">
          <label for="pollIntervalInput">轮询间隔（秒）</label>
          <input id="pollIntervalInput" type="number" min="1" max="15" value="2" />
        </div>
        <div class="control-group">
          <label for="timeoutInput">超时时间（秒）</label>
          <input id="timeoutInput" type="number" min="10" max="600" value="90" />
        </div>
      </div>
    </div>
  </section>

  <div id="templateModal" class="modal-overlay">
    <div class="modal-content">
      <div class="modal-header">
        选择提示词模板
        <button id="templateModalClose" class="modal-close" type="button">&times;</button>
      </div>
      <div id="templateList" class="template-list"></div>
    </div>
  </div>

  <div id="appPickerModal" class="modal-overlay">
    <div class="modal-content">
      <div class="modal-header">
        选择 AI 应用
        <button id="appPickerModalClose" class="modal-close" type="button">&times;</button>
      </div>
      <div class="app-picker-search-row">
        <input id="appPickerSearchInput" type="text" placeholder="搜索应用名称..." />
        <div id="appPickerStats" class="app-picker-stats">0 / 0</div>
      </div>
      <div id="appPickerList" class="app-picker-modal-list"></div>
    </div>
  </div>

  <script src="index.js"></script>
</body>
</html>

```

## index.js

```javascript
// 1. 引入旧控制器 (负责 AI 和 设置)
const { createAppController } = require("./src/app-controller");
// 2. 引入新控制器 (负责 工具箱)
const { initToolsController } = require("./src/controllers/tools-controller");

// 初始化旧的大控制器
const legacyController = createAppController();

document.addEventListener("DOMContentLoaded", () => {
  // 启动旧逻辑
  legacyController.init();
  
  // 启动新逻辑
  initToolsController();

  // === 统一的 Tab 切换逻辑 ===
  setupTabs();
});

function setupTabs() {
  const tabs = {
    tabWorkspace: "viewWorkspace",
    tabTools: "viewTools",        // 新增
    tabSettings: "viewSettings"
  };

  Object.keys(tabs).forEach(tabId => {
    const btn = document.getElementById(tabId);
    if (!btn) return;

    btn.addEventListener("click", () => {
      // 1. 移除所有 active 样式
      document.querySelectorAll(".nav-item").forEach(el => el.classList.remove("active"));
      document.querySelectorAll(".tab-content").forEach(el => el.classList.remove("active"));

      // 2. 激活当前按钮和对应的内容区
      btn.classList.add("active");
      const viewId = tabs[tabId];
      const view = document.getElementById(viewId);
      if (view) view.classList.add("active");
    });
  });
}
```

## manifest.json

```json
{
  "id": "my.runninghub.plugin",
  "name": "小T修图助手",
  "version": "3.0.3",
  "main": "index.html",
  "manifestVersion": 5,
  "entryPoints": [
    {
      "type": "panel",
      "id": "mainPanel",
      "label": {
        "default": "小T修图助手"
      },
      "minimumSize": {
        "width": 280,
        "height": 420
      },
      "maximumSize": {
        "width": 900,
        "height": 1400
      },
      "preferredDockedSize": {
        "width": 340,
        "height": 700
      },
      "preferredFloatingSize": {
        "width": 380,
        "height": 760
      },
      "icons": [
        {
          "width": 23,
          "height": 23,
          "path": "icons/icon.png",
          "scale": [
            1
          ]
        },
        {
          "width": 46,
          "height": 46,
          "path": "icons/icon@2x.png",
          "scale": [
            2
          ]
        }
      ]
    }
  ],
  "host": {
    "app": "PS",
    "minVersion": "23.0.0"
  },
  "icons": [
    {
      "width": 23,
      "height": 23,
      "path": "icons/icon.png",
      "scale": [
        1
      ]
    },
    {
      "width": 46,
      "height": 46,
      "path": "icons/icon@2x.png",
      "scale": [
        2
      ]
    }
  ],
  "requiredPermissions": {
    "localFileSystem": "fullAccess",
    "network": {
      "domains": [
        "https://www.runninghub.cn",
        "https://runninghub.cn",
        "https://rh-images.xiaoyaoyou.com"
      ]
    }
  }
}

```

## README.md

```markdown
# 小T修图助手 (PixelRunner)

一个基于 Adobe Photoshop UXP 的 RunningHub AI 插件，用于在 Photoshop 内快速选择并运行 RunningHub 应用，将结果图自动回贴到画布。

## 功能概览

- 解析并保存 RunningHub 应用（支持输入应用 ID 或应用 URL）
- 动态渲染应用参数（图片、文本、数字、下拉、开关）
- 下拉参数自动解析与清洗（含比例/分辨率等常见字段）
- 提示词模板保存、加载与编辑
- 运行任务、轮询结果并回贴到 Photoshop
- API Key 测试与账户余额信息显示

## 环境要求

- Adobe Photoshop 23.0.0+
- UXP 开发者工具（用于本地加载插件）
- RunningHub API Key

## 快速开始

1. 克隆仓库：

```bash
git clone <your-repo-url>
cd PixelRunner
```

2. 打开 UXP 开发者工具，选择 `Add Plugin`。
3. 选择本项目根目录下的 `manifest.json`。
4. 在 Photoshop 中打开插件面板：`小T修图助手`。

## 使用流程

1. 在设置页填写并保存 RunningHub API Key。
2. 输入应用 ID 或 RunningHub 应用链接并点击“解析”。
3. 保存应用后，切换到工作区选择应用并填写参数。
4. 若有图片输入，先在 Photoshop 中框选区域并点击“从 PS 选区获取”。
5. 点击“开始运行”，等待结果自动回贴。

## 项目结构

```text
PixelRunner/
├─ manifest.json          # UXP 插件清单
├─ index.html             # 面板页面
├─ style.css              # 面板样式
├─ index.js               # 入口
├─ icons/                 # 插件图标
└─ src/
   ├─ app-controller.js   # UI 与交互控制
   ├─ runninghub.js       # RunningHub API 调用与参数解析
   ├─ ps.js               # Photoshop 侧操作封装
   ├─ store.js            # 本地存储
   ├─ config.js           # 配置与接口常量
   └─ utils.js            # 通用工具
```

## 注意事项

- API Key 与应用配置存储在本地（`localStorage`），不会自动上传到仓库。
- 发布到 GitHub 前，建议确认未提交个人敏感信息。

## License

可根据你的发布需求添加（例如 MIT）。

```

## scripts/flatten-for-gemini.js

```javascript
#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const DEFAULT_OUTPUT_FILE = 'gemini_flattened.md';
const DEFAULT_IGNORE_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.next',
  '.cache',
  '.idea',
  '.vscode',
  'gemini_flat',
]);

const DEFAULT_IGNORE_FILES = new Set([
  '.DS_Store',
  'Thumbs.db',
  'gemini_flattened.txt',
  'gemini_flattened.md',
]);

const DEFAULT_INCLUDE_EXTENSIONS = new Set([
  '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs',
  '.css', '.scss', '.sass', '.less',
  '.html', '.htm',
  '.json', '.md', '.txt',
  '.yml', '.yaml', '.toml', '.ini',
  '.xml', '.svg',
  '.sh', '.ps1', '.bat', '.cmd',
  '.py', '.java', '.go', '.rs', '.php', '.rb',
  '.c', '.h', '.cpp', '.hpp',
]);

function parseArgs(argv) {
  const options = {
    root: process.cwd(),
    outputFile: DEFAULT_OUTPUT_FILE,
    includeAllText: false,
    dryRun: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === '--out' && argv[i + 1]) {
      options.outputFile = argv[i + 1];
      i += 1;
      continue;
    }

    if (arg === '--root' && argv[i + 1]) {
      options.root = path.resolve(argv[i + 1]);
      i += 1;
      continue;
    }

    if (arg === '--all-text') {
      options.includeAllText = true;
      continue;
    }

    if (arg === '--dry-run') {
      options.dryRun = true;
      continue;
    }

    if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
  }

  options.outputPath = path.resolve(options.root, options.outputFile);
  return options;
}

function printHelp() {
  console.log(`\nflatten-for-gemini\n\nUsage:\n  node scripts/flatten-for-gemini.js [--out <file>] [--root <path>] [--all-text] [--dry-run]\n\nOptions:\n  --out <file>     Output file path (default: ${DEFAULT_OUTPUT_FILE})\n  --root <path>    Project root path (default: current directory)\n  --all-text       Include all text files (not only common code extensions)\n  --dry-run        Preview files without writing output\n  -h, --help       Show this help\n`);
}

function isBinaryBuffer(buffer) {
  if (buffer.length === 0) return false;

  let suspicious = 0;
  const sampleLength = Math.min(buffer.length, 1024);

  for (let i = 0; i < sampleLength; i += 1) {
    const byte = buffer[i];
    if (byte === 0) return true;

    const isControl = (byte < 7) || (byte > 14 && byte < 32);
    const isExtended = byte > 126;
    const isWhitespace = byte === 9 || byte === 10 || byte === 13;

    if ((isControl || isExtended) && !isWhitespace) {
      suspicious += 1;
    }
  }

  return (suspicious / sampleLength) > 0.3;
}

function isTextFile(filePath) {
  try {
    const fd = fs.openSync(filePath, 'r');
    const buffer = Buffer.alloc(1024);
    const bytesRead = fs.readSync(fd, buffer, 0, 1024, 0);
    fs.closeSync(fd);
    return !isBinaryBuffer(buffer.subarray(0, bytesRead));
  } catch {
    return false;
  }
}

function shouldIncludeFile(filePath, includeAllText) {
  const ext = path.extname(filePath).toLowerCase();

  if (DEFAULT_INCLUDE_EXTENSIONS.has(ext)) {
    return true;
  }

  if (!includeAllText) {
    return false;
  }

  return isTextFile(filePath);
}

function walk(dirPath, options, files = []) {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      if (DEFAULT_IGNORE_DIRS.has(entry.name)) {
        continue;
      }
      walk(fullPath, options, files);
      continue;
    }

    if (DEFAULT_IGNORE_FILES.has(entry.name)) {
      continue;
    }

    if (path.resolve(fullPath) === options.outputPath) {
      continue;
    }

    if (shouldIncludeFile(fullPath, options.includeAllText)) {
      files.push(fullPath);
    }
  }

  return files;
}

function normalizeLineEndings(content) {
  return content.replace(/\r\n/g, '\n');
}

function detectCodeFenceLang(relativePath) {
  const ext = path.extname(relativePath).toLowerCase();
  const extToLang = {
    '.js': 'javascript',
    '.jsx': 'jsx',
    '.ts': 'typescript',
    '.tsx': 'tsx',
    '.mjs': 'javascript',
    '.cjs': 'javascript',
    '.css': 'css',
    '.scss': 'scss',
    '.sass': 'sass',
    '.less': 'less',
    '.html': 'html',
    '.htm': 'html',
    '.json': 'json',
    '.md': 'markdown',
    '.yml': 'yaml',
    '.yaml': 'yaml',
    '.xml': 'xml',
    '.svg': 'xml',
    '.sh': 'bash',
    '.ps1': 'powershell',
    '.py': 'python',
    '.java': 'java',
    '.go': 'go',
    '.rs': 'rust',
    '.php': 'php',
    '.rb': 'ruby',
    '.c': 'c',
    '.h': 'c',
    '.cpp': 'cpp',
    '.hpp': 'cpp',
  };
  return extToLang[ext] || '';
}

function createBlock(relativePath, content) {
  const lang = detectCodeFenceLang(relativePath);
  return [
    `## ${relativePath}`,
    '',
    `\`\`\`${lang}`,
    content,
    '```',
    '',
  ].join('\n');
}

function main() {
  const options = parseArgs(process.argv.slice(2));

  const fileList = walk(options.root, options)
    .map((absPath) => path.relative(options.root, absPath).replace(/\\/g, '/'))
    .sort((a, b) => a.localeCompare(b));

  if (options.dryRun) {
    console.log(`Would merge ${fileList.length} files into: ${options.outputPath}`);
    for (const rel of fileList) {
      console.log(rel);
    }
    return;
  }

  const blocks = [];
  blocks.push('# Gemini Flattened Code Export');
  blocks.push('');
  blocks.push(`- GeneratedAt: ${new Date().toISOString()}`);
  blocks.push(`- Root: ${options.root}`);
  blocks.push(`- FileCount: ${fileList.length}`);
  blocks.push('');
  blocks.push('## File Index');
  blocks.push('');
  for (const relPath of fileList) {
    blocks.push(`- \`${relPath}\``);
  }
  blocks.push('');

  for (const relPath of fileList) {
    const absPath = path.resolve(options.root, relPath);
    const raw = fs.readFileSync(absPath, 'utf8');
    const normalized = normalizeLineEndings(raw);
    blocks.push(createBlock(relPath, normalized));
  }

  fs.writeFileSync(options.outputPath, `${blocks.join('\n')}\n`, 'utf8');
  console.log(`Merged ${fileList.length} files into: ${options.outputPath}`);
}

main();

```

## src/app-controller.js

```javascript
const store = require("./services/store");
const runninghub = require("./services/runninghub");
const ps = require("./services/ps");
const { inferInputType, normalizeAppId, escapeHtml } = require("./utils");

function createAppController() {
  const state = {
    currentApp: null,
    currentInputValues: {},
    currentEditingAppId: null,
    currentEditingTemplateId: null,
    parsedAppData: null,
    manualParams: [],
    currentTemplateTarget: null,
    lastSelectionBounds: null,
    imageSelectionBounds: {},
    promptInputRefs: [],
    appPickerKeyword: "",
    runTimerId: null,
    runStartedAt: 0,
    isRunning: false,
    cancelRequested: false,
    runRequestId: 0,
    accountStatus: null,
    accountStatusFetchedAt: 0,
    accountStatusLoading: false
  };

  const dom = {};

  function byId(id) {
    return document.getElementById(id);
  }

  function findClosestByClass(startNode, className) {
    let node = startNode;
    while (node && node !== document) {
      if (node.classList && node.classList.contains(className)) return node;
      node = node.parentNode;
    }
    return null;
  }

  function findClosestButtonWithAction(startNode) {
    let node = startNode;
    while (node && node !== document) {
      const isButton = node.tagName && String(node.tagName).toLowerCase() === "button";
      if (isButton && node.dataset && node.dataset.action) return node;
      node = node.parentNode;
    }
    return null;
  }

  function log(message, type = "info") {
    if (!dom.logWindow) return;
    const line = document.createElement("div");
    const time = new Date().toLocaleTimeString("zh-CN", { hour12: false });
    line.innerHTML = `<span class="log-time">[${time}]</span><span class="log-${type}">${escapeHtml(message)}</span>`;
    dom.logWindow.appendChild(line);
    dom.logWindow.scrollTop = dom.logWindow.scrollHeight;
    console.log(`[${type}] ${message}`);
  }

  function shortText(text, maxLength = 16) {
    const value = String(text || "").trim();
    if (!value) return "";
    if (value.length <= maxLength) return value;
    return `${value.slice(0, Math.max(1, maxLength - 1))}…`;
  }

  function formatElapsedSeconds(ms) {
    const seconds = Math.max(0, ms) / 1000;
    return seconds.toFixed(2);
  }

  function formatAccountValue(raw) {
    const text = String(raw || "").trim();
    if (!text) return "--";
    const normalized = text.replace(/,/g, "");
    const asNumber = Number(normalized);
    if (Number.isFinite(asNumber)) {
      const fractionDigits = asNumber % 1 === 0 ? 0 : 2;
      return asNumber.toLocaleString("zh-CN", { minimumFractionDigits: 0, maximumFractionDigits: fractionDigits });
    }
    return text;
  }

  function renderAccountStatus(accountStatus, errorMessage = "") {
    if (!dom.accountSummary || !dom.accountBalanceValue || !dom.accountCoinsValue) return;

    const balanceText = formatAccountValue(accountStatus && accountStatus.remainMoney);
    const coinsText = formatAccountValue(accountStatus && accountStatus.remainCoins);
    dom.accountBalanceValue.textContent = balanceText;
    dom.accountCoinsValue.textContent = coinsText;

    const hasAnyValue = balanceText !== "--" || coinsText !== "--";
    dom.accountSummary.classList.toggle("is-empty", !hasAnyValue);
    dom.accountSummary.classList.toggle("is-error", !!errorMessage);
    dom.accountSummary.classList.toggle("is-loading", !!state.accountStatusLoading);

    if (errorMessage) {
      dom.accountSummary.title = errorMessage;
      return;
    }
    if (hasAnyValue) {
      dom.accountSummary.title = `余额 ${balanceText} / RH币 ${coinsText}`;
      return;
    }
    dom.accountSummary.title = "请先设置并测试 API Key";
  }

  async function refreshAccountStatus(options = {}) {
    const force = !!options.force;
    const silent = !!options.silent;
    const maxAgeMs = typeof options.maxAgeMs === "number" ? Math.max(0, options.maxAgeMs) : 120000;
    const apiKey = String(options.apiKey || store.getApiKey() || "").trim();

    if (!apiKey) {
      state.accountStatus = null;
      state.accountStatusFetchedAt = 0;
      state.accountStatusLoading = false;
      renderAccountStatus(null);
      return;
    }

    const staleMs = Date.now() - state.accountStatusFetchedAt;
    if (!force && state.accountStatus && staleMs < maxAgeMs) {
      renderAccountStatus(state.accountStatus);
      return;
    }
    if (!force && state.accountStatusLoading) return;

    state.accountStatusLoading = true;
    renderAccountStatus(state.accountStatus);
    try {
      const status = await runninghub.fetchAccountStatus(apiKey);
      state.accountStatus = status;
      state.accountStatusFetchedAt = Date.now();
      renderAccountStatus(status);
      if (!silent) {
        const balanceText = formatAccountValue(status.remainMoney);
        const coinsText = formatAccountValue(status.remainCoins);
        log(`账户信息已更新：余额 ${balanceText} / RH币 ${coinsText}`, "success");
      }
    } catch (e) {
      state.accountStatusFetchedAt = Date.now();
      renderAccountStatus(state.accountStatus, `账户信息更新失败: ${e.message}`);
      if (!silent) log(`账户信息更新失败: ${e.message}`, "warn");
    } finally {
      state.accountStatusLoading = false;
      renderAccountStatus(state.accountStatus);
    }
  }

  function makeRunCancelledError(message = "用户取消运行") {
    const err = new Error(message);
    err.code = "RUN_CANCELLED";
    return err;
  }

  function isRunCancelledError(error) {
    return Boolean(error && (error.code === "RUN_CANCELLED" || /取消/.test(String(error.message || ""))));
  }

  function shouldCancelCurrentRun(runRequestId) {
    if (!state.isRunning) return false;
    if (state.cancelRequested) return true;
    if (typeof runRequestId === "number" && runRequestId !== state.runRequestId) return true;
    return false;
  }

  function updateRunButtonUi() {
    if (!dom.btnRun) return;

    if (state.isRunning) {
      const elapsed = formatElapsedSeconds(Date.now() - (state.runStartedAt || Date.now()));
      dom.btnRun.classList.add("is-cancel");
      if (state.cancelRequested) {
        dom.btnRun.disabled = true;
        dom.btnRun.innerHTML = `<span class="loading">取消中 ${elapsed}秒</span>`;
      } else {
        dom.btnRun.disabled = false;
        dom.btnRun.innerHTML = `<span class="loading">取消 ${elapsed}秒</span>`;
      }
      return;
    }

    dom.btnRun.classList.remove("is-cancel");
    dom.btnRun.disabled = !state.currentApp;
    dom.btnRun.textContent = "开始运行";
  }

  function clearRunTimer() {
    if (state.runTimerId) {
      clearInterval(state.runTimerId);
      state.runTimerId = null;
    }
  }

  function setRunButton(running) {
    if (running) {
      state.isRunning = true;
      if (!state.runStartedAt) state.runStartedAt = Date.now();
      clearRunTimer();
      state.runTimerId = setInterval(updateRunButtonUi, 100);
      updateRunButtonUi();
      return;
    }

    state.isRunning = false;
    state.cancelRequested = false;
    clearRunTimer();
    state.runStartedAt = 0;
    updateRunButtonUi();
  }

  function ensureDom() {
    const ids = [
      "tabWorkspace",
      "tabSettings",
      "viewWorkspace",
      "viewSettings",
      "btnOpenAppPicker",
      "appPickerMeta",
      "btnRefreshWorkspaceApps",
      "workspaceInputArea",
      "imageInputContainer",
      "dynamicInputContainer",
      "btnRun",
      "logWindow",
      "apiKeyInput",
      "toggleApiKey",
      "btnSaveApiKey",
      "btnTestApiKey",
      "advancedSettingsSection",
      "advancedSettingsHeader",
      "advancedSettingsToggle",
      "pollIntervalInput",
      "timeoutInput",
      "appIdInput",
      "appNameInput",
      "btnParseApp",
      "parseResultContainer",
      "manualConfigArea",
      "manualParamsList",
      "btnAddParam",
      "btnSaveManualApp",
      "savedAppsList",
      "templateTitleInput",
      "templateContentInput",
      "btnSaveTemplate",
      "savedTemplatesList",
      "templateModal",
      "templateList",
      "templateModalClose",
      "appPickerModal",
      "appPickerModalClose",
      "appPickerSearchInput",
      "appPickerStats",
      "appPickerList",
      "accountSummary",
      "accountBalanceValue",
      "accountCoinsValue"
    ];
    for (const id of ids) dom[id] = byId(id);
  }

  function ensureWorkspacePickerDom() {
    if (!dom.viewWorkspace) return;

    let appSelectCard = dom.viewWorkspace.querySelector(".app-select-card");
    if (!appSelectCard) {
      appSelectCard = document.createElement("div");
      appSelectCard.className = "card app-select-card";
      const titleRow = document.createElement("div");
      titleRow.className = "card-title-row";
      titleRow.innerHTML = '<div class="card-title">选择 AI 应用</div><div class="card-title-tools"></div>';
      appSelectCard.appendChild(titleRow);
      const dynamicCard = byId("dynamicInputContainer");
      const parentCard = dynamicCard ? findClosestByClass(dynamicCard, "card") : null;
      if (parentCard && parentCard.parentNode) {
        parentCard.parentNode.insertBefore(appSelectCard, parentCard);
      } else {
        dom.viewWorkspace.appendChild(appSelectCard);
      }
    }

    let tools = appSelectCard.querySelector(".card-title-tools");
    if (!tools) {
      const titleRow = appSelectCard.querySelector(".card-title-row") || document.createElement("div");
      if (!titleRow.classList.contains("card-title-row")) titleRow.className = "card-title-row";
      tools = document.createElement("div");
      tools.className = "card-title-tools";
      titleRow.appendChild(tools);
      if (!titleRow.parentNode) appSelectCard.appendChild(titleRow);
    }

    if (!dom.btnOpenAppPicker) {
      const btn = document.createElement("button");
      btn.id = "btnOpenAppPicker";
      btn.type = "button";
      btn.className = "tiny-btn tiny-btn-compact";
      btn.textContent = "切换";
      tools.appendChild(btn);
      dom.btnOpenAppPicker = btn;
    }

    if (!dom.btnRefreshWorkspaceApps) {
      const btn = document.createElement("button");
      btn.id = "btnRefreshWorkspaceApps";
      btn.type = "button";
      btn.className = "tiny-btn tiny-btn-compact";
      btn.textContent = "刷新";
      tools.appendChild(btn);
      dom.btnRefreshWorkspaceApps = btn;
    }

    if (!dom.appPickerMeta) {
      const meta = document.createElement("div");
      meta.id = "appPickerMeta";
      meta.className = "app-picker-meta";
      meta.textContent = "暂无应用，请在设置页解析并保存";
      appSelectCard.appendChild(meta);
      dom.appPickerMeta = meta;
    }

    const runButton = dom.btnRun || byId("btnRun");
    if (!dom.workspaceInputArea) dom.workspaceInputArea = byId("workspaceInputArea");
    if (!dom.workspaceInputArea) {
      const area = document.createElement("div");
      area.id = "workspaceInputArea";
      area.className = "workspace-input-area";
      if (runButton && runButton.parentNode) {
        runButton.parentNode.insertBefore(area, runButton);
      } else {
        dom.viewWorkspace.appendChild(area);
      }
      dom.workspaceInputArea = area;
    }

    if (!dom.imageInputContainer) dom.imageInputContainer = byId("imageInputContainer");
    if (!dom.imageInputContainer) {
      const imageContainer = document.createElement("div");
      imageContainer.id = "imageInputContainer";
      imageContainer.className = "image-input-container";
      dom.workspaceInputArea.appendChild(imageContainer);
      dom.imageInputContainer = imageContainer;
    }

    if (!dom.dynamicInputContainer) dom.dynamicInputContainer = byId("dynamicInputContainer");
    if (!dom.dynamicInputContainer) {
      const dynamicContainer = document.createElement("div");
      dynamicContainer.id = "dynamicInputContainer";
      dynamicContainer.className = "dynamic-input-container";
      dynamicContainer.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📝</div><div>请先选择一个应用</div></div>';
      dom.workspaceInputArea.appendChild(dynamicContainer);
      dom.dynamicInputContainer = dynamicContainer;
    }

    if (dom.imageInputContainer.parentNode !== dom.workspaceInputArea) {
      dom.workspaceInputArea.insertBefore(dom.imageInputContainer, dom.dynamicInputContainer || null);
    }
    if (dom.dynamicInputContainer.parentNode !== dom.workspaceInputArea) {
      dom.workspaceInputArea.appendChild(dom.dynamicInputContainer);
    }

  }

  function ensureAppPickerModalDom() {
    if (!dom.appPickerModal) {
      const overlay = document.createElement("div");
      overlay.id = "appPickerModal";
      overlay.className = "modal-overlay";
      overlay.innerHTML = `
        <div class="modal-content">
          <div class="modal-header">
            选择 AI 应用
            <button id="appPickerModalClose" class="modal-close" type="button">&times;</button>
          </div>
          <div class="app-picker-search-row">
            <input id="appPickerSearchInput" type="text" placeholder="搜索应用名称..." />
            <div id="appPickerStats" class="app-picker-stats">0 / 0</div>
          </div>
          <div id="appPickerList" class="app-picker-modal-list"></div>
        </div>
      `;
      document.body.appendChild(overlay);
      dom.appPickerModal = overlay;
    }

    if (!dom.appPickerModalClose) dom.appPickerModalClose = byId("appPickerModalClose");
    if (!dom.appPickerSearchInput) dom.appPickerSearchInput = byId("appPickerSearchInput");
    if (!dom.appPickerStats) dom.appPickerStats = byId("appPickerStats");
    if (!dom.appPickerList) dom.appPickerList = byId("appPickerList");
  }

  function switchTab(tabName) {
    dom.tabWorkspace.classList.remove("active");
    dom.tabSettings.classList.remove("active");
    dom.viewWorkspace.classList.remove("active");
    dom.viewSettings.classList.remove("active");

    if (tabName === "workspace") {
      dom.tabWorkspace.classList.add("active");
      dom.viewWorkspace.classList.add("active");
      refreshWorkspaceApps();
      refreshAccountStatus({ silent: true });
      return;
    }

    dom.tabSettings.classList.add("active");
    dom.viewSettings.classList.add("active");
    renderSavedAppsList();
    renderSavedTemplatesList();
  }

  function getWorkspaceApps() {
    const rawApps = store.getAiApps().filter((x) => x && typeof x === "object");
    return rawApps.map((appItem, idx) => {
      const appIdText = String(appItem.appId || "").trim();
      const normalizedItem = {
        ...appItem,
        id: String(appItem.id || ""),
        name: String(appItem.name || "未命名应用"),
        inputs: Array.isArray(appItem.inputs) ? appItem.inputs : []
      };
      if (!normalizedItem.id) {
        normalizedItem.id = `legacy_${appIdText || idx + 1}`;
      }
      return normalizedItem;
    });
  }

  function selectAppById(id) {
    const appItem = getWorkspaceApps().find((x) => x.id === id) || null;
    state.currentApp = appItem;
    renderAppCards();
    renderDynamicInputs(appItem);
  }

  function renderAppCards() {
    const normalizedApps = getWorkspaceApps();
    if (!dom.btnOpenAppPicker) return;

    if (!state.currentApp || !normalizedApps.find((x) => x.id === state.currentApp.id)) {
      state.currentApp = null;
    }
    if (!state.currentApp && normalizedApps.length > 0) {
      state.currentApp = normalizedApps[0];
    }

    if (normalizedApps.length === 0) {
      dom.btnOpenAppPicker.textContent = "无应用";
      dom.btnOpenAppPicker.disabled = true;
      dom.btnOpenAppPicker.title = "";
      if (dom.appPickerMeta) dom.appPickerMeta.textContent = "暂无应用，请在设置页解析并保存";
      return;
    }

    dom.btnOpenAppPicker.disabled = false;
    const currentName = String((state.currentApp && state.currentApp.name) || "未命名应用").trim() || "未命名应用";
    dom.btnOpenAppPicker.textContent = `切换 · ${shortText(currentName, 16)}`;
    dom.btnOpenAppPicker.title = `当前应用：${currentName}`;
    if (dom.appPickerMeta) {
      dom.appPickerMeta.textContent = `共 ${normalizedApps.length} 个应用，当前：${currentName} · ${(state.currentApp.inputs || []).length}参`;
    }
  }

  function refreshWorkspaceApps(logRefresh = false) {
    const beforeId = state.currentApp ? state.currentApp.id : "";
    renderAppCards();
    renderAppPickerList();
    renderDynamicInputs(state.currentApp || null);
    if (logRefresh) {
      const apps = getWorkspaceApps();
      const pickedId = state.currentApp ? state.currentApp.id : "";
      const changed = beforeId !== pickedId;
      log(`应用列表已刷新（共 ${apps.length} 个）${changed ? "，已同步当前选择" : ""}`, "info");
    }
  }

  function renderAppPickerList() {
    if (!dom.appPickerList) return;
    const apps = getWorkspaceApps();
    const keyword = String(state.appPickerKeyword || "").trim().toLowerCase();
    const visibleApps = keyword
      ? apps.filter((x) => String(x.name || "").toLowerCase().includes(keyword))
      : apps;

    if (dom.appPickerStats) dom.appPickerStats.textContent = `${visibleApps.length} / ${apps.length}`;

    if (visibleApps.length === 0) {
      dom.appPickerList.innerHTML = '<div class="empty-state"><div>未找到匹配的应用</div></div>';
      return;
    }

    dom.appPickerList.innerHTML = visibleApps
      .map((appItem) => {
        const active = state.currentApp && state.currentApp.id === appItem.id;
        const appIdText = String(appItem.appId || "").trim();
        return `
          <button type="button" class="app-picker-item ${active ? "active" : ""}" data-id="${escapeHtml(appItem.id)}">
            <div class="app-picker-item-main">
              <div class="app-picker-item-title">${escapeHtml(appItem.name || "未命名应用")}</div>
              <div class="app-picker-item-subtitle">${appIdText ? `ID: ${escapeHtml(appIdText)}` : "未设置 ID"}</div>
            </div>
            <div class="app-picker-item-meta">${(appItem.inputs || []).length} 参数</div>
          </button>
        `;
      })
      .join("");
  }

  function openAppPickerModal() {
    renderAppPickerList();
    if (dom.appPickerModal) dom.appPickerModal.classList.add("active");
    if (dom.appPickerSearchInput) {
      dom.appPickerSearchInput.value = state.appPickerKeyword;
      try {
        dom.appPickerSearchInput.focus();
      } catch (_) {}
    }
  }

  function closeAppPickerModal() {
    if (dom.appPickerModal) dom.appPickerModal.classList.remove("active");
  }

  function handleAppPickerListClick(event) {
    const button = findClosestByClass(event.target, "app-picker-item");
    if (!button) return;
    const id = String(button.dataset.id || "");
    if (!id) return;
    selectAppById(id);
    closeAppPickerModal();
  }

  function hasCapturedImageInput(appItem, values) {
    const inputs = Array.isArray(appItem && appItem.inputs) ? appItem.inputs : [];
    return inputs.some((input) => {
      const key = String(input.key || "");
      if (!key) return false;
      const type = inferInputType(input.type || input.fieldType);
      return type === "image" && typeof values[key] === "string" && values[key].length > 0;
    });
  }

  function getImageInputKeys(appItem) {
    const inputs = Array.isArray(appItem && appItem.inputs) ? appItem.inputs : [];
    const keys = [];
    for (const input of inputs) {
      const key = String(input.key || "").trim();
      if (!key) continue;
      const type = inferInputType(input.type || input.fieldType);
      if (type === "image") keys.push(key);
    }
    return keys;
  }

  function getPreferredImageAnchor(appItem) {
    const imageKeys = getImageInputKeys(appItem);
    for (const key of imageKeys) {
      const bounds = state.imageSelectionBounds[key];
      if (bounds) return { key, bounds: { ...bounds }, isPrimary: key === imageKeys[0] };
    }
    return null;
  }

  function isPromptLikeInput(input) {
    const type = inferInputType(input.type || input.fieldType);
    if (type !== "text") return false;
    const text = `${input.key || ""} ${input.name || ""} ${input.label || ""} ${input.fieldName || ""}`.toLowerCase();
    return /prompt|提示词|正向|负向|negative/.test(text);
  }

  function buildToggleButton(expanded) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "dynamic-input-toggle";
    btn.textContent = expanded ? "收起" : "展开";
    return btn;
  }

  function bindCollapseBehavior(group, header, toggleButton, expandedByDefault) {
    const setExpanded = (expanded) => {
      if (expanded) {
        group.classList.remove("is-collapsed");
      } else {
        group.classList.add("is-collapsed");
      }
      if (header) header.setAttribute("aria-expanded", expanded ? "true" : "false");
      if (toggleButton) toggleButton.textContent = expanded ? "收起" : "展开";
    };

    setExpanded(expandedByDefault);
    const toggle = () => setExpanded(group.classList.contains("is-collapsed"));
    header.addEventListener("click", toggle);
    if (toggleButton) {
      toggleButton.addEventListener("click", (event) => {
        event.stopPropagation();
        toggle();
      });
    }
  }

  function createInputBody(input, key, type, label, promptLike) {
    const body = document.createElement("div");
    body.className = "dynamic-input-body";

    if (type === "text") {
      const textarea = document.createElement("textarea");
      if (promptLike) textarea.classList.add("prompt-textarea");
      textarea.value = String(input.default ?? "");
      state.currentInputValues[key] = textarea.value;
      textarea.addEventListener("input", () => {
        state.currentInputValues[key] = textarea.value;
      });

      if (promptLike) {
        const actions = document.createElement("div");
        actions.className = "prompt-actions";

        const templates = store.getPromptTemplates();
        const loadGroup = document.createElement("div");
        loadGroup.className = "prompt-load-group";

        const presetSelect = document.createElement("select");
        presetSelect.className = "prompt-load-select";
        const emptyOption = document.createElement("option");
        emptyOption.value = "";
        emptyOption.textContent = templates.length > 0 ? "载入提示词预设..." : "暂无提示词预设";
        presetSelect.appendChild(emptyOption);
        templates.forEach((template) => {
          const option = document.createElement("option");
          option.value = template.id;
          option.textContent = template.title || "未命名模板";
          presetSelect.appendChild(option);
        });

        const loadBtn = document.createElement("button");
        loadBtn.type = "button";
        loadBtn.className = "prompt-action-btn prompt-load-btn";
        loadBtn.textContent = "载入";
        loadBtn.disabled = templates.length === 0;
        loadBtn.addEventListener("click", () => {
          const templateId = presetSelect.value;
          if (!templateId) {
            log("请先选择一个提示词预设", "warn");
            return;
          }
          const template = store.getPromptTemplates().find((x) => x.id === templateId);
          if (!template) {
            log("未找到所选提示词预设", "error");
            return;
          }
          textarea.value = template.content || "";
          textarea.dispatchEvent(new Event("input"));
          log(`已载入提示词预设: ${template.title}`, "success");
        });

        loadGroup.appendChild(presetSelect);
        loadGroup.appendChild(loadBtn);

        const saveBtn = document.createElement("button");
        saveBtn.type = "button";
        saveBtn.className = "prompt-action-btn";
        saveBtn.textContent = "存为模板";
        saveBtn.addEventListener("click", () => saveCurrentAsTemplate(textarea.value));
        actions.appendChild(loadGroup);
        actions.appendChild(saveBtn);
        body.appendChild(actions);
      }

      body.appendChild(textarea);
      if (promptLike) {
        state.promptInputRefs.push({ key, label, textarea });
      }
      return body;
    }

    if (type === "number") {
      const el = document.createElement("input");
      el.type = "number";
      if (typeof input.min === "number") el.min = String(input.min);
      if (typeof input.max === "number") el.max = String(input.max);
      if (typeof input.step === "number") el.step = String(input.step);
      el.value = String(input.default ?? 0);
      state.currentInputValues[key] = Number(el.value);
      el.addEventListener("input", () => {
        const n = Number(el.value);
        state.currentInputValues[key] = Number.isFinite(n) ? n : "";
      });
      body.appendChild(el);
      return body;
    }

    if (type === "select") {
      const el = document.createElement("select");
      const options = Array.isArray(input.options) ? input.options : [];
      if (options.length === 0 && input.default !== undefined) options.push(String(input.default));
      options.forEach((opt) => {
        const optionEl = document.createElement("option");
        optionEl.value = String(opt);
        optionEl.textContent = String(opt);
        el.appendChild(optionEl);
      });
      if (input.default !== undefined) el.value = String(input.default);
      state.currentInputValues[key] = el.value;
      el.addEventListener("change", () => {
        state.currentInputValues[key] = el.value;
      });
      body.appendChild(el);
      return body;
    }

    if (type === "boolean") {
      const el = document.createElement("input");
      el.type = "checkbox";
      el.checked = Boolean(input.default);
      state.currentInputValues[key] = el.checked;
      el.addEventListener("change", () => {
        state.currentInputValues[key] = el.checked;
      });
      body.appendChild(el);
      return body;
    }

    if (type === "image") {
      const wrapper = document.createElement("div");
      wrapper.className = "image-input-wrapper";

      const button = document.createElement("button");
      button.type = "button";
      button.className = "image-input-button";
      button.textContent = "从 PS 选区获取";

      const preview = document.createElement("img");
      preview.className = "image-preview";
      preview.style.display = "none";

      state.currentInputValues[key] = "";
      button.addEventListener("click", async () => {
        const capture = await ps.captureSelection({ log });
        if (!capture || !capture.base64) return;
        state.currentInputValues[key] = capture.base64;
        if (capture.selectionBounds) {
          state.imageSelectionBounds[key] = { ...capture.selectionBounds };
          const anchor = getPreferredImageAnchor(state.currentApp);
          state.lastSelectionBounds = anchor ? { ...anchor.bounds } : null;
          if (anchor && anchor.key !== key) {
            log(`已记录图片选区: ${label}；回贴仍优先使用首图锚点`, "info");
          } else {
            log(`已缓存选区锚点: (${capture.selectionBounds.left}, ${capture.selectionBounds.top}) - (${capture.selectionBounds.right}, ${capture.selectionBounds.bottom})`, "info");
          }
        }
        preview.src = `data:image/png;base64,${capture.base64}`;
        preview.style.display = "block";
        preview.classList.add("has-image");
        log(`图片参数已就绪: ${label}`, "success");
      });

      wrapper.appendChild(button);
      wrapper.appendChild(preview);
      body.appendChild(wrapper);
      return body;
    }

    const textarea = document.createElement("textarea");
    textarea.value = String(input.default ?? "");
    state.currentInputValues[key] = textarea.value;
    textarea.addEventListener("input", () => {
      state.currentInputValues[key] = textarea.value;
    });
    body.appendChild(textarea);
    return body;
  }

  function createInputField(input, idx, options = {}) {
    const key = String(input.key || `param_${idx + 1}`);
    const type = inferInputType(input.type || input.fieldType);
    const label = input.label || input.name || key;
    const promptLike = isPromptLikeInput(input);

    const field = document.createElement("div");
    field.className = `dynamic-input-field ${options.compact ? "is-compact" : ""}`;

    const header = document.createElement("div");
    header.className = "dynamic-input-field-header";

    const labelEl = document.createElement("div");
    labelEl.className = "dynamic-input-label";
    labelEl.innerHTML = `${escapeHtml(label)}${input.required ? '<span class="dynamic-input-required">*</span>' : ""}`;

    const typeEl = document.createElement("div");
    typeEl.className = "dynamic-input-type";
    typeEl.textContent = type;

    header.appendChild(labelEl);
    header.appendChild(typeEl);

    const body = createInputBody(input, key, type, label, promptLike);
    body.classList.add("dynamic-input-field-body");

    field.appendChild(header);
    field.appendChild(body);
    return field;
  }

  function renderDynamicInputs(appItem) {
    state.currentInputValues = {};
    state.lastSelectionBounds = null;
    state.imageSelectionBounds = {};
    state.promptInputRefs = [];
    if (dom.dynamicInputContainer) dom.dynamicInputContainer.innerHTML = "";
    if (dom.imageInputContainer) {
      dom.imageInputContainer.innerHTML = "";
      dom.imageInputContainer.style.display = "none";
    }

    const imageContainer = dom.imageInputContainer;
    const paramContainer = dom.dynamicInputContainer;
    const imageRenderTarget = imageContainer || paramContainer;
    if (!paramContainer) {
      updateRunButtonUi();
      return;
    }

    if (!appItem) {
      paramContainer.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📝</div><div>请选择应用以显示输入参数</div></div>';
      updateRunButtonUi();
      return;
    }

    const inputs = Array.isArray(appItem.inputs) ? appItem.inputs : [];
    if (inputs.length === 0) {
      paramContainer.innerHTML = '<div class="empty-state"><div class="empty-state-icon">ℹ️</div><div>该应用没有可配置参数</div></div>';
      updateRunButtonUi();
      return;
    }

    const normalizedInputs = inputs.map((input, idx) => ({ ...input, __idx: idx }));
    const imageInputs = normalizedInputs.filter((input) => inferInputType(input.type || input.fieldType) === "image");
    const otherInputs = normalizedInputs.filter((input) => inferInputType(input.type || input.fieldType) !== "image");

    if (imageInputs.length > 0) {
      const imageSection = document.createElement("div");
      imageSection.className = "image-input-section";
      imageInputs.forEach((input) => {
        imageSection.appendChild(createInputField(input, input.__idx, { compact: true }));
      });
      if (imageContainer) imageContainer.style.display = "block";
      imageRenderTarget.appendChild(imageSection);
    }

    if (otherInputs.length > 0) {
      const bundle = document.createElement("div");
      bundle.className = "input-bundle is-collapsed";

      const bundleHeader = document.createElement("div");
      bundleHeader.className = "input-bundle-header";

      const bundleTitle = document.createElement("div");
      bundleTitle.className = "input-bundle-title";
      bundleTitle.textContent = `其他参数 (${otherInputs.length})`;

      const bundleRight = document.createElement("div");
      bundleRight.className = "dynamic-input-right";
      const toggleBtn = buildToggleButton(false);
      bundleRight.appendChild(toggleBtn);

      bundleHeader.appendChild(bundleTitle);
      bundleHeader.appendChild(bundleRight);
      bundle.appendChild(bundleHeader);

      const bundleBody = document.createElement("div");
      bundleBody.className = "input-bundle-body";

      otherInputs.forEach((input) => {
        bundleBody.appendChild(createInputField(input, input.__idx, { compact: true }));
      });

      bundle.appendChild(bundleBody);
      bindCollapseBehavior(bundle, bundleHeader, toggleBtn, false);
      paramContainer.appendChild(bundle);
    } else {
      paramContainer.innerHTML = '<div class="empty-state"><div class="empty-state-icon">ℹ️</div><div>当前应用没有其他参数</div></div>';
    }

    renderPromptPresetToolbar(paramContainer);
    updateRunButtonUi();
  }

  function renderPromptPresetToolbar(targetContainer) {
    if (!targetContainer) return;
    const oldToolbar = targetContainer.querySelector(".prompt-preset-toolbar");
    if (oldToolbar && oldToolbar.parentNode === targetContainer) {
      oldToolbar.remove();
    }
    if (state.promptInputRefs.length === 0) return;

    const templates = store.getPromptTemplates();
    const toolbar = document.createElement("div");
    toolbar.className = "prompt-preset-toolbar";

    const title = document.createElement("div");
    title.className = "prompt-preset-title";
    title.textContent = "预置提示词";

    const controls = document.createElement("div");
    controls.className = "prompt-preset-controls";

    const templateSelect = document.createElement("select");
    templateSelect.className = "prompt-preset-select";
    const emptyTemplateOption = document.createElement("option");
    emptyTemplateOption.value = "";
    emptyTemplateOption.textContent = templates.length > 0 ? "选择模板以覆盖提示词" : "暂无模板，请先到设置页保存";
    templateSelect.appendChild(emptyTemplateOption);
    templates.forEach((t) => {
      const option = document.createElement("option");
      option.value = t.id;
      option.textContent = t.title || "未命名模板";
      templateSelect.appendChild(option);
    });

    const targetSelect = document.createElement("select");
    targetSelect.className = "prompt-preset-select";
    const allOption = document.createElement("option");
    allOption.value = "__all__";
    allOption.textContent = "覆盖全部提示词字段";
    targetSelect.appendChild(allOption);
    state.promptInputRefs.forEach((item) => {
      const option = document.createElement("option");
      option.value = item.key;
      option.textContent = item.label || item.key;
      targetSelect.appendChild(option);
    });

    const applyBtn = document.createElement("button");
    applyBtn.type = "button";
    applyBtn.className = "prompt-preset-apply";
    applyBtn.textContent = "应用模板";
    applyBtn.disabled = templates.length === 0;
    applyBtn.addEventListener("click", () => {
      const templateId = templateSelect.value;
      if (!templateId) {
        log("请先选择一个模板", "warn");
        return;
      }
      const template = templates.find((x) => x.id === templateId);
      if (!template) {
        log("未找到所选模板", "error");
        return;
      }

      const targetKey = targetSelect.value || "__all__";
      const targets =
        targetKey === "__all__"
          ? state.promptInputRefs
          : state.promptInputRefs.filter((item) => item.key === targetKey);

      if (targets.length === 0) {
        log("未找到可覆盖的提示词字段", "warn");
        return;
      }

      targets.forEach((item) => {
        item.textarea.value = template.content || "";
        item.textarea.dispatchEvent(new Event("input"));
      });
      log(`已应用模板「${template.title}」到 ${targets.length} 个提示词字段`, "success");
    });

    controls.appendChild(templateSelect);
    controls.appendChild(targetSelect);
    controls.appendChild(applyBtn);
    toolbar.appendChild(title);
    toolbar.appendChild(controls);
    targetContainer.prepend(toolbar);
  }

  function clearAppEditorUI() {
    dom.appIdInput.value = "";
    dom.appNameInput.value = "";
    dom.parseResultContainer.innerHTML = "";
    dom.manualConfigArea.style.display = "none";
    state.manualParams = [];
    state.currentEditingAppId = null;
    state.parsedAppData = null;
  }

  function renderParseResult(data) {
    const inputsHtml = (data.inputs || [])
      .map((input, idx) => `
        <div class="parse-result-item">
          <span>${escapeHtml(input.name || input.key)} (${escapeHtml(input.type)})</span>
          <input type="text" class="input-label-edit" data-index="${idx}" value="${escapeHtml(input.label || input.name || input.key)}" placeholder="显示名称" />
        </div>
      `)
      .join("");

    dom.parseResultContainer.innerHTML = `
      <div class="parse-result">
        <div class="parse-result-header"><span>✓</span> 解析成功</div>
        <div class="parse-result-summary">
          <strong>${escapeHtml(data.name || "未命名应用")}</strong>
          ${data.description ? `<div class="parse-result-desc">${escapeHtml(data.description)}</div>` : ""}
        </div>
        <div class="parse-result-tip">检测到 ${data.inputs.length} 个输入参数，可修改显示名称：</div>
        ${inputsHtml}
        <button id="btnSaveParsedApp" type="button" class="main-btn main-btn-primary">保存应用</button>
      </div>
    `;

    const saveBtn = byId("btnSaveParsedApp");
    if (saveBtn) saveBtn.addEventListener("click", saveParsedApp);
    dom.manualConfigArea.style.display = "none";
  }

  function renderManualParams() {
    if (state.manualParams.length === 0) {
      dom.manualParamsList.innerHTML = '<div class="manual-empty">点击“添加参数”开始配置</div>';
      return;
    }

    dom.manualParamsList.innerHTML = state.manualParams
      .map((param, index) => `
        <div class="param-row" data-index="${index}">
          <input type="text" data-field="label" value="${escapeHtml(param.label || "")}" placeholder="参数名称" />
          <input type="text" data-field="key" value="${escapeHtml(param.key || "")}" placeholder="参数 Key" />
          <select data-field="type">
            <option value="text" ${param.type === "text" ? "selected" : ""}>文本</option>
            <option value="image" ${param.type === "image" ? "selected" : ""}>图片</option>
            <option value="number" ${param.type === "number" ? "selected" : ""}>数字</option>
            <option value="select" ${param.type === "select" ? "selected" : ""}>选择</option>
            <option value="boolean" ${param.type === "boolean" ? "selected" : ""}>开关</option>
          </select>
          <button type="button" class="btn-remove" data-action="remove">删除</button>
        </div>
      `)
      .join("");
  }

  function showManualConfig(reasonText = "") {
    dom.parseResultContainer.innerHTML = `
      <div class="parse-result parse-result-warn">
        <div class="parse-result-header"><span>⚠️</span> 自动解析失败</div>
        <div class="parse-result-tip">${escapeHtml(reasonText || "请手动配置参数后保存应用。")}</div>
      </div>
    `;
    dom.manualConfigArea.style.display = "block";
    state.manualParams = [];
    renderManualParams();
  }

  function saveParsedApp() {
    if (!state.parsedAppData) {
      log("没有可保存的解析结果", "warn");
      return;
    }

    const labelInputs = dom.parseResultContainer.querySelectorAll(".input-label-edit");
    labelInputs.forEach((el, idx) => {
      const value = String(el.value || "").trim();
      if (state.parsedAppData.inputs[idx]) {
        state.parsedAppData.inputs[idx].label =
          value || state.parsedAppData.inputs[idx].name || state.parsedAppData.inputs[idx].key;
      }
    });

    if (state.currentEditingAppId) {
      store.updateAiApp(state.currentEditingAppId, state.parsedAppData);
      log("应用已更新", "success");
    } else {
      store.addAiApp(state.parsedAppData);
      log("应用已保存", "success");
    }

    clearAppEditorUI();
    renderSavedAppsList();
    refreshWorkspaceApps();
  }

  async function parseApp() {
    const apiKey = store.getApiKey();
    const appId = normalizeAppId(dom.appIdInput.value);

    if (!appId) {
      log("请输入应用 ID 或 URL", "error");
      return;
    }
    if (!apiKey) {
      log("请先设置 API Key", "error");
      return;
    }

    dom.btnParseApp.disabled = true;
    dom.btnParseApp.innerHTML = '<span class="loading">解析中</span>';
    try {
      dom.appIdInput.value = appId;
      const data = await runninghub.fetchAppInfo(appId, apiKey, { log });
      if (!data.inputs || data.inputs.length === 0) throw new Error("未识别到可用输入参数");
      state.parsedAppData = {
        appId,
        name: dom.appNameInput.value.trim() || data.name || "未命名应用",
        description: data.description || "",
        inputs: data.inputs
      };
      renderParseResult(state.parsedAppData);
      log("应用解析成功", "success");
    } catch (e) {
      log(`自动解析失败: ${e.message}`, "warn");
      showManualConfig(e.message);
    } finally {
      dom.btnParseApp.disabled = false;
      dom.btnParseApp.textContent = "解析";
    }
  }

  function saveManualApp() {
    const appId = normalizeAppId(dom.appIdInput.value);
    const appName = dom.appNameInput.value.trim() || "未命名应用";
    if (!appId) {
      log("请输入应用 ID 或 URL", "error");
      return;
    }

    const inputs = state.manualParams
      .map((x) => ({
        key: String(x.key || "").trim(),
        label: String(x.label || "").trim(),
        name: String(x.label || "").trim(),
        type: inferInputType(x.type),
        required: true
      }))
      .filter((x) => x.key && x.label);

    if (inputs.length === 0) {
      log("请至少添加一个参数", "error");
      return;
    }

    const appData = { appId, name: appName, description: "", inputs };
    if (state.currentEditingAppId) {
      store.updateAiApp(state.currentEditingAppId, appData);
      log("应用已更新", "success");
    } else {
      store.addAiApp(appData);
      log("应用已保存", "success");
    }

    clearAppEditorUI();
    renderSavedAppsList();
    refreshWorkspaceApps();
  }

  function renderSavedAppsList() {
    const apps = store.getAiApps();
    if (apps.length === 0) {
      dom.savedAppsList.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📭</div><div>暂无保存的应用</div></div>';
      return;
    }

    dom.savedAppsList.innerHTML = apps
      .map((appItem) => `
        <div class="saved-item saved-item-app" data-id="${appItem.id}">
          <div class="saved-item-info">
            <div class="saved-item-name">${escapeHtml(appItem.name)}</div>
            <div class="saved-item-meta">ID: ${escapeHtml(appItem.appId)} · ${(appItem.inputs || []).length} 个参数</div>
          </div>
          <div class="saved-item-actions saved-item-actions-inline">
            <button type="button" class="saved-item-btn saved-item-edit" data-action="edit">编辑</button>
            <button type="button" class="saved-item-btn saved-item-refresh" data-action="refresh">刷新</button>
            <button type="button" class="saved-item-btn saved-item-delete" data-action="delete">删除</button>
          </div>
        </div>
      `)
      .join("");
  }

  function editApp(id) {
    const appItem = store.getAiApps().find((x) => x.id === id);
    if (!appItem) return;

    state.currentEditingAppId = id;
    state.parsedAppData = {
      appId: appItem.appId,
      name: appItem.name,
      description: appItem.description || "",
      inputs: (appItem.inputs || []).map((x) => ({ ...x }))
    };
    dom.appIdInput.value = appItem.appId;
    dom.appNameInput.value = appItem.name || "";
    renderParseResult(state.parsedAppData);
  }

  function bindAdvancedSettingsCollapse() {
    if (!dom.advancedSettingsSection || !dom.advancedSettingsHeader) return;
    bindCollapseBehavior(dom.advancedSettingsSection, dom.advancedSettingsHeader, dom.advancedSettingsToggle || null, false);
    dom.advancedSettingsHeader.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      if (dom.advancedSettingsToggle) {
        dom.advancedSettingsToggle.click();
      } else {
        dom.advancedSettingsHeader.click();
      }
    });
  }

  function isAutoGeneratedInputLabel(input) {
    if (!input || typeof input !== "object") return true;
    const label = String(input.label || "").trim();
    if (!label) return true;

    const key = String(input.key || "").trim();
    const name = String(input.name || "").trim();
    const fieldName = String(input.fieldName || "").trim();
    const keyTail = key.includes(":") ? key.split(":").pop().trim() : "";
    const marker = label.toLowerCase();

    const autoCandidates = [key, name, fieldName, keyTail]
      .map((x) => String(x || "").trim().toLowerCase())
      .filter(Boolean);
    return autoCandidates.includes(marker);
  }

  async function refreshApp(id) {
    const appItem = store.getAiApps().find((x) => x.id === id);
    if (!appItem) return;
    const apiKey = store.getApiKey();
    if (!apiKey) {
      log("请先设置 API Key", "error");
      return;
    }

    try {
      const latest = await runninghub.fetchAppInfo(appItem.appId, apiKey, { log });
      const oldInputs = Array.isArray(appItem.inputs) ? appItem.inputs : [];
      const mergedInputs = (latest.inputs || []).map((newInput) => {
        const old = oldInputs.find((x) => String(x.key) === String(newInput.key));
        const keepOldLabel = old && old.label && !isAutoGeneratedInputLabel(old);
        return {
          ...newInput,
          label: keepOldLabel ? old.label : newInput.label || (old && old.label) || newInput.name || newInput.key
        };
      });

      store.updateAiApp(id, {
        ...appItem,
        appId: normalizeAppId(appItem.appId),
        name: latest.name || appItem.name,
        description: latest.description || appItem.description || "",
        inputs: mergedInputs
      });
      renderSavedAppsList();
      refreshWorkspaceApps();
      log("应用已刷新", "success");
    } catch (e) {
      log(`刷新失败: ${e.message}`, "error");
    }
  }

  function removeApp(id) {
    const appItem = store.getAiApps().find((x) => x.id === id);
    if (!appItem) return;

    let allowDelete = true;
    try {
      if (typeof confirm === "function") allowDelete = confirm(`确定删除应用「${appItem.name}」吗？`);
    } catch (_) {}
    if (!allowDelete) return;

    if (!store.deleteAiApp(id)) {
      log("删除应用失败", "error");
      return;
    }

    if (state.currentApp && state.currentApp.id === id) {
      state.currentApp = null;
      renderDynamicInputs(null);
    }

    renderSavedAppsList();
    refreshWorkspaceApps();
    log("应用已删除", "success");
  }

  function renderSavedTemplatesList() {
    const templates = store.getPromptTemplates();
    if (templates.length === 0) {
      dom.savedTemplatesList.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📝</div><div>暂无保存的模板</div></div>';
      return;
    }

    dom.savedTemplatesList.innerHTML = templates
      .map((t) => `
        <div class="saved-item saved-item-template" data-id="${t.id}">
          <div class="saved-item-info">
            <div class="saved-item-name">${escapeHtml(t.title)}</div>
            <div class="saved-item-meta">${escapeHtml((t.content || "").slice(0, 40))}...</div>
          </div>
          <div class="saved-item-actions saved-item-actions-inline">
            <button type="button" class="saved-item-btn saved-item-edit" data-action="edit">编辑</button>
            <button type="button" class="saved-item-btn saved-item-delete" data-action="delete">删除</button>
          </div>
        </div>
      `)
      .join("");
  }

  function clearTemplateEditor() {
    state.currentEditingTemplateId = null;
    if (dom.templateTitleInput) dom.templateTitleInput.value = "";
    if (dom.templateContentInput) dom.templateContentInput.value = "";
    if (dom.btnSaveTemplate) dom.btnSaveTemplate.textContent = "保存模板";
  }

  function editTemplate(id) {
    const template = store.getPromptTemplates().find((x) => x.id === id);
    if (!template) return;
    state.currentEditingTemplateId = id;
    dom.templateTitleInput.value = String(template.title || "");
    dom.templateContentInput.value = String(template.content || "");
    dom.btnSaveTemplate.textContent = "更新模板";
    try {
      dom.templateTitleInput.focus();
    } catch (_) {}
    log(`已载入模板进行编辑: ${template.title}`, "info");
  }

  function saveCurrentAsTemplate(content) {
    const value = String(content || "").trim();
    if (!value) {
      log("提示词为空，无法保存模板", "warn");
      return;
    }
    if (typeof prompt !== "function") {
      log("当前环境不支持弹窗输入，请在设置页手动保存模板", "warn");
      return;
    }
    const title = prompt("请输入模板标题");
    if (!title || !title.trim()) return;
    store.addPromptTemplate({ title: title.trim(), content: value });
    renderSavedTemplatesList();
    log("模板已保存", "success");
  }

  function showTemplateModal(targetTextarea) {
    state.currentTemplateTarget = targetTextarea;
    const templates = store.getPromptTemplates();
    if (templates.length === 0) {
      dom.templateList.innerHTML = '<div class="empty-state">暂无模板</div>';
    } else {
      dom.templateList.innerHTML = templates
        .map((t) => `
          <button type="button" class="template-item" data-id="${t.id}">
            <div class="template-item-title">${escapeHtml(t.title)}</div>
            <div class="template-item-preview">${escapeHtml(t.content)}</div>
          </button>
        `)
        .join("");
    }
    dom.templateModal.classList.add("active");
  }

  function closeTemplateModal() {
    dom.templateModal.classList.remove("active");
    state.currentTemplateTarget = null;
  }

  async function handleRun() {
    if (state.isRunning) {
      if (!state.cancelRequested) {
        state.cancelRequested = true;
        updateRunButtonUi();
        log("已请求取消，正在停止当前任务...", "warn");
      }
      return;
    }

    const apiKey = store.getApiKey();
    if (!apiKey) {
      log("请先设置 API Key", "error");
      return;
    }
    if (!state.currentApp) {
      log("请先选择应用", "error");
      return;
    }

    const runRequestId = state.runRequestId + 1;
    state.runRequestId = runRequestId;
    state.cancelRequested = false;
    const runStartAt = Date.now();
    state.runStartedAt = runStartAt;
    setRunButton(true);

    const shouldCancel = () => shouldCancelCurrentRun(runRequestId);
    const guardedLog = (message, type = "info") => {
      if (!shouldCancel()) log(message, type);
    };
    const throwIfCancelled = () => {
      if (shouldCancel()) throw makeRunCancelledError();
    };

    let wasCancelled = false;
    try {
      throwIfCancelled();
      const settings = store.getSettings();
      const taskId = await runninghub.runAppTask(apiKey, state.currentApp, state.currentInputValues, {
        log: guardedLog,
        shouldCancel
      });
      throwIfCancelled();
      guardedLog(`任务已创建: ${taskId}`, "success");

      const resultUrl = await runninghub.pollTaskOutput(apiKey, taskId, settings, {
        log: guardedLog,
        shouldCancel
      });
      throwIfCancelled();
      guardedLog(`任务完成，下载结果: ${resultUrl}`, "info");

      const imageBuffer = await runninghub.downloadResultBinary(resultUrl, { shouldCancel });
      throwIfCancelled();
      const preferredAnchor = getPreferredImageAnchor(state.currentApp);
      const targetBounds = preferredAnchor ? preferredAnchor.bounds : state.lastSelectionBounds;
      const shouldAlign = hasCapturedImageInput(state.currentApp, state.currentInputValues) && !!targetBounds;
      await ps.placeImage(imageBuffer, {
        targetBounds: shouldAlign ? targetBounds : null,
        log: guardedLog
      });
      throwIfCancelled();
      if (shouldAlign) guardedLog("结果图已按首图选区锚点自动对齐", "success");
      guardedLog("处理完成，已回贴到 Photoshop", "success");
    } catch (e) {
      if (isRunCancelledError(e)) {
        wasCancelled = true;
        log("当前运行已取消", "warn");
      } else {
        log(`运行失败: ${e.message}`, "error");
      }
    } finally {
      wasCancelled = wasCancelled || state.cancelRequested;
      const elapsedMs = Date.now() - runStartAt;
      state.runRequestId += 1;
      setRunButton(false);
      if (wasCancelled) {
        log(`本次运行已取消，耗时: ${formatElapsedSeconds(elapsedMs)}秒`, "warn");
      } else {
        log(`本次运行耗时: ${formatElapsedSeconds(elapsedMs)}秒`, "info");
      }
    }
  }

  function saveApiKeyAndSettings() {
    const apiKey = String(dom.apiKeyInput.value || "").trim();
    const pollInterval = Number(dom.pollIntervalInput.value) || 2;
    const timeout = Number(dom.timeoutInput.value) || 90;
    store.saveApiKey(apiKey);
    store.saveSettings({ pollInterval, timeout });
    refreshAccountStatus({ apiKey, force: true, silent: true });
    log("设置已保存", "success");
  }

  async function testApiKey() {
    const apiKey = String(dom.apiKeyInput.value || "").trim();
    if (!apiKey) {
      log("请输入 API Key", "error");
      return;
    }
    try {
      const result = await runninghub.testApiKey(apiKey);
      log(result.message, result.ok ? "success" : "error");
      if (result.ok) {
        await refreshAccountStatus({ apiKey, force: true, silent: false });
      } else {
        renderAccountStatus(state.accountStatus, "API Key 测试失败，无法刷新账户");
      }
    } catch (e) {
      log(`测试失败: ${e.message}`, "error");
      renderAccountStatus(state.accountStatus, `API Key 测试失败: ${e.message}`);
    }
  }

  function handleSavedAppsClick(event) {
    const button = findClosestButtonWithAction(event.target);
    if (!button) return;
    const item = findClosestByClass(button, "saved-item");
    if (!item) return;
    const id = item.dataset.id;
    const action = button.dataset.action;
    if (!id || !action) return;
    if (action === "edit") editApp(id);
    else if (action === "refresh") refreshApp(id);
    else if (action === "delete") removeApp(id);
  }

  function handleSavedTemplatesClick(event) {
    const button = findClosestButtonWithAction(event.target);
    if (!button) return;
    const item = findClosestByClass(button, "saved-item");
    if (!item) return;
    const id = item.dataset.id;
    const action = button.dataset.action;
    if (!id) return;
    if (action === "edit") {
      editTemplate(id);
      return;
    }
    if (action !== "delete") return;
    if (store.deletePromptTemplate(id)) {
      if (state.currentEditingTemplateId === id) clearTemplateEditor();
      renderSavedTemplatesList();
      log("模板已删除", "success");
    }
  }

  function handleTemplateListClick(event) {
    const button = findClosestByClass(event.target, "template-item");
    if (!button) return;
    const id = button.dataset.id;
    if (!id || !state.currentTemplateTarget) return;
    const template = store.getPromptTemplates().find((x) => x.id === id);
    if (!template) return;
    state.currentTemplateTarget.value = template.content;
    state.currentTemplateTarget.dispatchEvent(new Event("input"));
    closeTemplateModal();
    log(`已加载模板: ${template.title}`, "success");
  }

  function handleManualParamListEvent(event) {
    const row = findClosestByClass(event.target, "param-row");
    if (!row) return;
    const idx = Number(row.dataset.index);
    if (!Number.isFinite(idx) || !state.manualParams[idx]) return;

    if (event.type === "click") {
      const removeBtn = findClosestButtonWithAction(event.target);
      if (!removeBtn || removeBtn.dataset.action !== "remove") return;
      state.manualParams.splice(idx, 1);
      renderManualParams();
      return;
    }

    const field = event.target.dataset.field;
    if (!field) return;
    state.manualParams[idx][field] = event.target.value;
  }

  function bindEvents() {
    dom.tabWorkspace.addEventListener("click", () => switchTab("workspace"));
    dom.tabSettings.addEventListener("click", () => switchTab("settings"));

    dom.toggleApiKey.addEventListener("click", () => {
      const hidden = dom.apiKeyInput.type === "password";
      dom.apiKeyInput.type = hidden ? "text" : "password";
      dom.toggleApiKey.textContent = hidden ? "隐藏" : "显示";
    });

    dom.btnSaveApiKey.addEventListener("click", saveApiKeyAndSettings);
    dom.btnTestApiKey.addEventListener("click", testApiKey);
    dom.btnRun.addEventListener("click", handleRun);
    if (dom.btnOpenAppPicker) {
      dom.btnOpenAppPicker.addEventListener("click", openAppPickerModal);
    }
    if (dom.btnRefreshWorkspaceApps) {
      dom.btnRefreshWorkspaceApps.addEventListener("click", () => refreshWorkspaceApps(true));
    }

    dom.btnParseApp.addEventListener("click", parseApp);
    dom.btnAddParam.addEventListener("click", () => {
      state.manualParams.push({ key: "", label: "", type: "text", required: true });
      renderManualParams();
    });
    dom.btnSaveManualApp.addEventListener("click", saveManualApp);

    dom.savedAppsList.addEventListener("click", handleSavedAppsClick);
    dom.savedTemplatesList.addEventListener("click", handleSavedTemplatesClick);

    dom.btnSaveTemplate.addEventListener("click", () => {
      const title = String(dom.templateTitleInput.value || "").trim();
      const content = String(dom.templateContentInput.value || "").trim();
      if (!title || !content) {
        log("请填写模板标题和内容", "error");
        return;
      }
      if (state.currentEditingTemplateId) {
        const templates = store.getPromptTemplates();
        const idx = templates.findIndex((x) => x.id === state.currentEditingTemplateId);
        if (idx >= 0) {
          templates[idx] = {
            ...templates[idx],
            title,
            content,
            updatedAt: Date.now()
          };
          store.savePromptTemplates(templates);
          log("模板已更新", "success");
        } else {
          store.addPromptTemplate({ title, content });
          log("模板不存在，已按新模板保存", "warn");
        }
      } else {
        store.addPromptTemplate({ title, content });
        log("模板已保存", "success");
      }
      clearTemplateEditor();
      renderSavedTemplatesList();
    });

    dom.templateModal.addEventListener("click", (event) => {
      if (event.target === dom.templateModal) closeTemplateModal();
    });
    dom.templateModalClose.addEventListener("click", closeTemplateModal);
    dom.templateList.addEventListener("click", handleTemplateListClick);
    if (dom.appPickerModal) {
      dom.appPickerModal.addEventListener("click", (event) => {
        if (event.target === dom.appPickerModal) closeAppPickerModal();
      });
    }
    if (dom.appPickerModalClose) {
      dom.appPickerModalClose.addEventListener("click", closeAppPickerModal);
    }
    if (dom.appPickerSearchInput) {
      dom.appPickerSearchInput.addEventListener("input", () => {
        state.appPickerKeyword = String(dom.appPickerSearchInput.value || "");
        renderAppPickerList();
      });
    }
    if (dom.appPickerList) {
      dom.appPickerList.addEventListener("click", handleAppPickerListClick);
    }

    dom.manualParamsList.addEventListener("input", handleManualParamListEvent);
    dom.manualParamsList.addEventListener("change", handleManualParamListEvent);
    dom.manualParamsList.addEventListener("click", handleManualParamListEvent);
  }

  function init() {
    ensureDom();
    ensureWorkspacePickerDom();
    ensureAppPickerModalDom();
    store.migrateLegacyWorkflows(log);

    const criticalDomIds = [
      "btnOpenAppPicker",
      "btnRefreshWorkspaceApps",
      "appPickerMeta",
      "appPickerModal",
      "appPickerList"
    ];
    const missing = criticalDomIds.filter((id) => !dom[id]);
    if (missing.length > 0) {
      log(`应用选择器节点缺失: ${missing.join(", ")}`, "warn");
    }

    dom.apiKeyInput.value = store.getApiKey();
    const settings = store.getSettings();
    bindAdvancedSettingsCollapse();
    dom.pollIntervalInput.value = settings.pollInterval;
    dom.timeoutInput.value = settings.timeout;
    clearTemplateEditor();
    renderAccountStatus(null);
    refreshAccountStatus({ silent: true });

    refreshWorkspaceApps();
    renderSavedAppsList();
    renderSavedTemplatesList();
    bindEvents();
    switchTab("workspace");
    setRunButton(false);
    log("插件初始化完成", "success");
  }

  return { init };
}

module.exports = { createAppController };

```

## src/config.js

```javascript
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
  timeout: 90
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

```

## src/controllers/tools-controller.js

```javascript
const ps = require("../services/ps");

// 这个控制器不需要像 app-controller 那样维护复杂的 state
// 它只需要绑定事件

function initToolsController() {
  const btnNeutralGray = document.getElementById("btnNeutralGray");
  const btnObserver = document.getElementById("btnObserver");
  const btnStamp = document.getElementById("btnStamp");

  // 绑定事件
  if (btnNeutralGray) {
    btnNeutralGray.addEventListener("click", async () => {
      try {
        await ps.createNeutralGrayLayer();
        // 如果你有 toast 系统，可以在这里调用 showToast("创建成功")
        console.log("中性灰图层已创建");
      } catch (e) {
        console.error("创建失败", e);
        // showToast("创建失败: " + e.message, "error");
      }
    });
  }

  if (btnObserver) {
    btnObserver.addEventListener("click", async () => {
      await ps.createObserverLayer();
    });
  }

  if (btnStamp) {
    btnStamp.addEventListener("click", async () => {
      await ps.stampVisibleLayers();
    });
  }
}

module.exports = { initToolsController };
```

## src/services/ps.js

```javascript
const { app, core, action } = require("photoshop");
const { storage } = require("uxp");

const fs = storage.localFileSystem;
const formats = storage.formats;

function arrayBufferToBase64(buffer) {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function toPixelNumber(value, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number.parseFloat(value);
    return Number.isFinite(n) ? n : fallback;
  }
  if (value && typeof value === "object") {
    if (typeof value._value === "number" && Number.isFinite(value._value)) return value._value;
    if (typeof value.value === "number" && Number.isFinite(value.value)) return value.value;
  }
  return fallback;
}

function getDocSizePx(doc) {
  const width = Math.max(1, Math.round(toPixelNumber(doc && doc.width, 1)));
  const height = Math.max(1, Math.round(toPixelNumber(doc && doc.height, 1)));
  return { width, height };
}

function parseRawBounds(rawBounds) {
  if (!rawBounds) return null;
  if (Array.isArray(rawBounds) && rawBounds.length >= 4) {
    return {
      left: toPixelNumber(rawBounds[0], 0),
      top: toPixelNumber(rawBounds[1], 0),
      right: toPixelNumber(rawBounds[2], 0),
      bottom: toPixelNumber(rawBounds[3], 0)
    };
  }
  if (typeof rawBounds === "object") {
    return {
      left: toPixelNumber(rawBounds.left, 0),
      top: toPixelNumber(rawBounds.top, 0),
      right: toPixelNumber(rawBounds.right, 0),
      bottom: toPixelNumber(rawBounds.bottom, 0)
    };
  }
  return null;
}

function buildCropBounds(rawBounds, doc) {
  const size = getDocSizePx(doc);
  const parsed = parseRawBounds(rawBounds);
  if (!parsed) return { left: 0, top: 0, right: size.width, bottom: size.height };

  const left = Math.max(0, Math.min(size.width - 1, Math.round(parsed.left)));
  const top = Math.max(0, Math.min(size.height - 1, Math.round(parsed.top)));
  const right = Math.max(left + 1, Math.min(size.width, Math.round(parsed.right)));
  const bottom = Math.max(top + 1, Math.min(size.height, Math.round(parsed.bottom)));
  return { left, top, right, bottom };
}

async function closeDocNoSave(docRef) {
  if (!docRef) return;
  if (typeof docRef.closeWithoutSaving === "function") {
    await docRef.closeWithoutSaving();
    return;
  }
  await action.batchPlay([{
    _obj: "close",
    _target: [{ _ref: "document", _id: docRef.id }],
    saving: { _enum: "yesNo", _value: "no" }
  }], {});
}

async function captureSelection(options = {}) {
  const log = options.log || (() => {});
  try {
    const doc = app.activeDocument;
    if (!doc) {
      log("请先在 Photoshop 中打开文档", "error");
      return null;
    }

    let base64 = null;
    let selectionBounds = null;
    let originalSelectionBounds = null;
    try {
      originalSelectionBounds = doc.selection && doc.selection.bounds;
    } catch (_) {}

    await core.executeAsModal(async () => {
      let tempDoc = null;
      try {
        tempDoc = await doc.duplicate("rh_capture_temp");
        try {
          await tempDoc.flatten();
        } catch (_) {}

        let tempSelectionBounds = null;
        try {
          tempSelectionBounds = tempDoc.selection && tempDoc.selection.bounds;
        } catch (_) {}

        const cropBounds = buildCropBounds(originalSelectionBounds || tempSelectionBounds, tempDoc);
        selectionBounds = { ...cropBounds };
        await tempDoc.crop(cropBounds);

        const tempFolder = await fs.getTemporaryFolder();
        const tempFile = await tempFolder.createFile("capture.png", { overwrite: true });
        const sessionToken = await fs.createSessionToken(tempFile);

        await action.batchPlay([{
          _obj: "save",
          as: { _obj: "PNGFormat", method: { _enum: "PNGMethod", _value: "quick" } },
          in: { _path: sessionToken, _kind: "local" },
          documentID: tempDoc.id,
          copy: true,
          lowerCase: true,
          saveStage: { _enum: "saveStageType", _value: "saveStageOS" }
        }], {});

        const arrayBuffer = await tempFile.read({ format: formats.binary });
        base64 = arrayBufferToBase64(arrayBuffer);
      } finally {
        await closeDocNoSave(tempDoc);
      }
    }, { commandName: "Capture Selection" });

    if (!base64) return null;
    return { base64, selectionBounds };
  } catch (e) {
    log(`捕获选区失败: ${e.message}`, "error");
    return null;
  }
}

function parseLayerBounds(bounds) {
  const parsed = parseRawBounds(bounds);
  if (!parsed) return null;
  if (parsed.right <= parsed.left || parsed.bottom <= parsed.top) return null;
  return parsed;
}

function getBoundsSize(bounds) {
  return {
    width: Math.max(1, bounds.right - bounds.left),
    height: Math.max(1, bounds.bottom - bounds.top)
  };
}

function getBoundsCenter(bounds) {
  return {
    x: (bounds.left + bounds.right) / 2,
    y: (bounds.top + bounds.bottom) / 2
  };
}

async function transformLayerScale(layerId, scaleXPercent, scaleYPercent) {
  await action.batchPlay([{
    _obj: "transform",
    _target: [{ _ref: "layer", _id: layerId }],
    freeTransformCenterState: { _enum: "quadCenterState", _value: "QCSAverage" },
    width: { _unit: "percentUnit", _value: scaleXPercent },
    height: { _unit: "percentUnit", _value: scaleYPercent },
    linked: false
  }], {});
}

async function transformLayerOffset(layerId, dx, dy) {
  await action.batchPlay([{
    _obj: "transform",
    _target: [{ _ref: "layer", _id: layerId }],
    freeTransformCenterState: { _enum: "quadCenterState", _value: "QCSAverage" },
    offset: {
      _obj: "offset",
      horizontal: { _unit: "pixelsUnit", _value: dx },
      vertical: { _unit: "pixelsUnit", _value: dy }
    }
  }], {});
}

async function alignActiveLayerToBounds(targetBounds) {
  const doc = app.activeDocument;
  const layer = doc && doc.activeLayers && doc.activeLayers[0];
  if (!layer) return;

  const layerId = layer.id;
  const currentBounds0 = parseLayerBounds(layer.bounds);
  if (!currentBounds0) return;

  const cSize = getBoundsSize(currentBounds0);
  const tSize = getBoundsSize(targetBounds);
  const scaleX = (tSize.width / cSize.width) * 100;
  const scaleY = (tSize.height / cSize.height) * 100;

  if (Number.isFinite(scaleX) && Number.isFinite(scaleY) && (Math.abs(scaleX - 100) > 0.2 || Math.abs(scaleY - 100) > 0.2)) {
    await transformLayerScale(layerId, scaleX, scaleY);
  }

  const layerAfterScale = doc.activeLayers && doc.activeLayers[0];
  const currentBounds1 = parseLayerBounds(layerAfterScale && layerAfterScale.bounds);
  if (!currentBounds1) return;

  const cCenter = getBoundsCenter(currentBounds1);
  const tCenter = getBoundsCenter(targetBounds);
  const dx = tCenter.x - cCenter.x;
  const dy = tCenter.y - cCenter.y;

  if (Math.abs(dx) > 0.2 || Math.abs(dy) > 0.2) {
    await transformLayerOffset(layerId, dx, dy);
  }
}

async function placeImage(arrayBuffer, options = {}) {
  const log = options.log || (() => {});
  const targetBoundsRaw = options.targetBounds || null;

  await core.executeAsModal(async () => {
    const doc = app.activeDocument;
    const tempFolder = await fs.getTemporaryFolder();
    const tempFile = await tempFolder.createFile("result.png", { overwrite: true });
    await tempFile.write(arrayBuffer, { format: formats.binary });
    const sessionToken = await fs.createSessionToken(tempFile);

    await action.batchPlay([{
      _obj: "placeEvent",
      ID: 5,
      null: { _path: sessionToken, _kind: "local" },
      freeTransformCenterState: { _enum: "quadCenterState", _value: "QCSAverage" },
      offset: {
        _obj: "offset",
        horizontal: { _unit: "pixelsUnit", _value: 0 },
        vertical: { _unit: "pixelsUnit", _value: 0 }
      }
    }], {});

    if (!targetBoundsRaw) return;

    const targetBounds = buildCropBounds(targetBoundsRaw, doc);
    try {
      await alignActiveLayerToBounds(targetBounds);
    } catch (e) {
      log(`结果图对齐失败，已保留默认位置: ${e.message}`, "warn");
    }
  }, { commandName: "Place AI Result" });
}

/**
 * 创建中性灰图层（用于加深减淡）
 * 逻辑：新建图层 -> 填充50%灰 -> 模式设为柔光
 */
async function createNeutralGrayLayer() {
  await core.executeAsModal(async () => {
    await action.batchPlay([
      // 1. 创建新图层
      { _obj: "make", _target: [{ _ref: "layer" }] },
      // 2. 命名
      { _obj: "set", _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }], to: { _obj: "layer", name: "中性灰 (D&B)" } },
      // 3. 填充 50% 灰
      { _obj: "fill", using: { _enum: "fillContents", _value: "gray" }, opacity: { _unit: "percentUnit", _value: 50 }, mode: { _enum: "blendMode", _value: "normal" } },
      // 4. 混合模式改为柔光 (Soft Light)
      { _obj: "set", _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }], to: { _obj: "layer", mode: { _enum: "blendMode", _value: "softLight" } } }
    ], {});
  }, { commandName: "新建中性灰" });
}

/**
 * 创建观察组（黑白观察层 + 曲线）
 */
async function createObserverLayer() {
  await core.executeAsModal(async () => {
    // 1. 创建图层组
    await action.batchPlay([{ _obj: "make", _target: [{ _ref: "layerSection" }] }], {});
    await action.batchPlay([{ _obj: "set", _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }], to: { _obj: "layer", name: "== 观察组 ==" } }], {});

    // 2. 创建黑白调整层 (让画面变黑白)
    await action.batchPlay([{ _obj: "make", _target: [{ _ref: "adjustmentLayer" }], using: { _obj: "adjustmentLayer", type: { _obj: "blackAndWhite", red: 40, yellow: 60, green: 40, cyan: 60, blue: 20, magenta: 80 } } }], {});
    
    // 3. 创建曲线调整层 (增加对比度)
    // 这里简化处理，直接创建一个空的曲线层，用户自己调
    await action.batchPlay([{ _obj: "make", _target: [{ _ref: "adjustmentLayer" }], using: { _obj: "adjustmentLayer", type: { _obj: "curves" } } }], {});
  }, { commandName: "创建观察层" });
}

/**
 * 盖印可见图层
 */
async function stampVisibleLayers() {
  await core.executeAsModal(async () => {
    // 这是一个特殊的命令，模拟键盘快捷键行为
    // 1. 全选
    await action.batchPlay([{ _obj: "selectAll", _target: [{ _ref: "channel", _enum: "channel", _value: "component" }] }], {});
    // 2. 复制合并 (Copy Merged)
    await action.batchPlay([{ _obj: "copyTheMergedLayers" }], {});
    // 3. 粘贴 (Paste)
    await action.batchPlay([{ _obj: "paste" }], {});
    // 4. 命名
    await action.batchPlay([{ _obj: "set", _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }], to: { _obj: "layer", name: "盖印图层" } }], {});
  }, { commandName: "盖印图层" });
}

// 记得在 module.exports 里导出这些新函数
module.exports = {
  captureSelection,
  placeImage,
  createNeutralGrayLayer, // 新增
  createObserverLayer,    // 新增
  stampVisibleLayers      // 新增
};

```

## src/services/runninghub.js

```javascript
const { API } = require("./config");
const { normalizeAppId, inferInputType, sleep, isEmptyValue } = require("./utils");

function toMessage(result, fallback = "请求失败") {
  if (!result || typeof result !== "object") return fallback;
  return String(result.msg || result.message || fallback);
}

const OPTION_CONTAINER_KEYS = [
  "options",
  "enums",
  "values",
  "items",
  "list",
  "data",
  "children",
  "selectOptions",
  "optionList",
  "fieldOptions",
  "candidate",
  "candidates",
  "enum"
];

const OPTION_VALUE_KEYS = [
  "value",
  "name",
  "label",
  "title",
  "text",
  "index",
  "option",
  "optionValue",
  "enumValue",
  "displayName",
  "display",
  "key",
  "id",
  "code"
];

const OPTION_IGNORE_MARKERS = new Set(["ignore", "ignored", "忽略"]);
const OPTION_NOISE_MARKERS = new Set([
  "string",
  "text",
  "number",
  "int",
  "integer",
  "float",
  "double",
  "boolean",
  "bool",
  "object",
  "array",
  "list",
  "enum",
  "select",
  "index",
  "fastindex",
  "description",
  "descriptionen",
  "descriptioncn"
]);
const OPTION_META_KEYS = new Set([
  "default",
  "description",
  "descriptionEn",
  "desc",
  "title",
  "label",
  "name",
  "placeholder",
  "required",
  "min",
  "max",
  "step",
  "type",
  "widget",
  "inputType",
  "fieldType",
  "multiple"
]);

const FIELD_LABEL_MAP = {
  aspectratio: "比例",
  resolution: "分辨率",
  channel: "通道",
  prompt: "提示词",
  negativeprompt: "反向提示词",
  seed: "随机种子",
  steps: "步数",
  cfg: "CFG",
  cfgscale: "CFG 强度",
  sampler: "采样器",
  scheduler: "调度器",
  width: "宽度",
  height: "高度",
  model: "模型",
  style: "风格",
  strength: "强度",
  denoise: "降噪强度"
};

function normalizeFieldToken(text) {
  return String(text || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function lookupMappedLabel(rawToken) {
  const token = normalizeFieldToken(rawToken);
  if (!token) return "";
  return FIELD_LABEL_MAP[token] || "";
}

function resolveDisplayLabel(key, fieldName, rawLabel, rawName) {
  const candidates = [];
  const keyText = String(key || "").trim();
  const fieldText = String(fieldName || "").trim();
  if (fieldText) candidates.push(fieldText);
  if (keyText) {
    candidates.push(keyText);
    if (keyText.includes(":")) candidates.push(keyText.split(":").pop());
  }
  if (rawLabel) candidates.push(rawLabel);
  if (rawName) candidates.push(rawName);

  for (const item of candidates) {
    const mapped = lookupMappedLabel(item);
    if (mapped) return mapped;
  }

  return String(rawLabel || rawName || key || "").trim();
}

function isLikelyOptionKey(rawKey) {
  const key = String(rawKey || "").trim();
  if (!key) return false;
  const marker = key.toLowerCase();
  if (OPTION_META_KEYS.has(marker)) return false;
  if (key.length > 40) return false;
  return /^[a-z0-9:_./\-]+$/i.test(key);
}

function tryParseJsonString(raw) {
  if (typeof raw !== "string") return undefined;
  const text = raw.trim();
  if (!text) return undefined;
  if (!/^[\[{"]/.test(text)) return undefined;
  try {
    return JSON.parse(text);
  } catch (_) {
    return undefined;
  }
}

function normalizeOptionText(value) {
  if (value === undefined || value === null) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value).trim();
  }
  if (typeof value !== "object" || Array.isArray(value)) return "";
  for (const key of OPTION_VALUE_KEYS) {
    const item = value[key];
    if (typeof item === "string" || typeof item === "number" || typeof item === "boolean") {
      const text = String(item).trim();
      if (text) return text;
    }
  }
  return "";
}

function pushOptionValue(bucket, seen, value) {
  const text = normalizeOptionText(value);
  if (!text) return false;
  const marker = text.toLowerCase();
  if (OPTION_IGNORE_MARKERS.has(marker)) return false;
  if (seen.has(marker)) return true;
  seen.add(marker);
  bucket.push(text);
  return true;
}

function collectOptionValues(source, bucket, seen, depth = 0) {
  if (depth > 8 || source === undefined || source === null) return;

  if (typeof source === "string") {
    const text = source.trim();
    if (!text) return;
    const parsed = tryParseJsonString(text);
    if (parsed !== undefined) {
      collectOptionValues(parsed, bucket, seen, depth + 1);
      return;
    }
    if ((text.includes("|") || text.includes(",") || text.includes("\n")) && text.length <= 2000) {
      const tokens = text.split(/[|,\r\n]+/).map((x) => x.trim()).filter(Boolean);
      if (tokens.length > 1) {
        tokens.forEach((token) => pushOptionValue(bucket, seen, token));
      }
    }
    return;
  }

  if (typeof source === "number" || typeof source === "boolean") {
    pushOptionValue(bucket, seen, source);
    return;
  }

  if (Array.isArray(source)) {
    source.forEach((item) => collectOptionValues(item, bucket, seen, depth + 1));
    return;
  }

  if (typeof source !== "object") return;

  let usedKnownContainer = false;
  for (const key of OPTION_CONTAINER_KEYS) {
    if (source[key] !== undefined) {
      usedKnownContainer = true;
      collectOptionValues(source[key], bucket, seen, depth + 1);
    }
  }

  pushOptionValue(bucket, seen, source);
  if (usedKnownContainer) return;

  const keys = Object.keys(source);
  if (keys.length > 0 && keys.length <= 24) {
    const optionLikeKeys = keys.filter(isLikelyOptionKey);
    if (optionLikeKeys.length >= 2) {
      optionLikeKeys.forEach((k) => pushOptionValue(bucket, seen, k));
    }

    const primitiveValues = keys
      .map((k) => source[k])
      .filter((v) => typeof v === "string" || typeof v === "number" || typeof v === "boolean");
    if (primitiveValues.length >= 2) {
      primitiveValues.forEach((v) => pushOptionValue(bucket, seen, v));
    }

    const nestedValues = keys.map((k) => source[k]).filter((v) => v && (Array.isArray(v) || typeof v === "object"));
    if (nestedValues.length > 0) {
      nestedValues.forEach((v) => collectOptionValues(v, bucket, seen, depth + 1));
    }
  }
}

function parseFieldOptions(fieldData) {
  const bucket = [];
  const seen = new Set();
  collectOptionValues(fieldData, bucket, seen, 0);
  const cleaned = sanitizeOptionList(bucket);
  return cleaned.length > 0 ? cleaned : undefined;
}

function sanitizeOptionList(list) {
  if (!Array.isArray(list) || list.length === 0) return [];
  const out = [];
  const seen = new Set();
  for (const item of list) {
    const text = String(item || "").trim();
    if (!text) continue;
    const marker = text.toLowerCase();
    if (seen.has(marker)) continue;
    if (OPTION_IGNORE_MARKERS.has(marker)) continue;
    if (OPTION_META_KEYS.has(marker)) continue;
    if (OPTION_NOISE_MARKERS.has(marker)) continue;
    if (/^\d+$/.test(marker)) continue;
    if (/^(?:fast)?index$/i.test(text)) continue;
    if (/^description(?:en|cn)?$/i.test(text)) continue;
    seen.add(marker);
    out.push(text);
  }
  return out;
}

function mergeOptionLists(primary, secondary) {
  const merged = [];
  const seen = new Set();
  const pushMany = (list) => {
    if (!Array.isArray(list)) return;
    for (const item of list) {
      const text = String(item || "").trim();
      if (!text) continue;
      const marker = text.toLowerCase();
      if (seen.has(marker)) continue;
      seen.add(marker);
      merged.push(text);
    }
  };
  pushMany(primary);
  pushMany(secondary);
  return sanitizeOptionList(merged);
}

function pushUniqueText(bucket, seen, raw) {
  const text = String(raw || "").trim();
  if (!text) return;
  const marker = text.toLowerCase();
  if (seen.has(marker) || OPTION_IGNORE_MARKERS.has(marker) || OPTION_META_KEYS.has(marker)) return;
  seen.add(marker);
  bucket.push(text);
}

function stringifyLoose(value) {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch (_) {
    return String(value);
  }
}

function inferOptionsFromRawText(fieldData, hintText) {
  const text = stringifyLoose(fieldData);
  if (!text) return [];

  const bucket = [];
  const seen = new Set();
  const hint = String(hintText || "").toLowerCase();
  const preferAspect = /aspect|ratio|比例/.test(hint);
  const preferResolution = /resolution|分辨率/.test(hint);
  if (!preferAspect && !preferResolution) return [];

  if (preferAspect) {
    if (/\bauto\b/i.test(text) || /自动/.test(text)) {
      pushUniqueText(bucket, seen, "auto");
    }
    const ratioMatches = text.match(/\b\d{1,2}\s*:\s*\d{1,2}\b/g) || [];
    ratioMatches.forEach((x) => pushUniqueText(bucket, seen, x.replace(/\s+/g, "")));
  }

  if (preferResolution) {
    const kMatches = text.match(/\b\d+(?:\.\d+)?k\b/gi) || [];
    const sizeMatches = text.match(/\b\d{3,5}\s*[xX]\s*\d{3,5}\b/g) || [];
    kMatches.forEach((x) => pushUniqueText(bucket, seen, x.toLowerCase()));
    sizeMatches.forEach((x) => pushUniqueText(bucket, seen, x.replace(/\s+/g, "").toLowerCase()));
  }

  return sanitizeOptionList(bucket).slice(0, 40);
}

function pickBestOptionList(candidates) {
  if (!Array.isArray(candidates) || candidates.length === 0) return undefined;
  let fallback = undefined;
  let best = undefined;
  for (const list of candidates) {
    if (!Array.isArray(list) || list.length === 0) continue;
    if (!fallback) fallback = list;
    if (list.length <= 1) continue;
    if (!best || list.length > best.length) best = list;
  }
  return best || fallback;
}

function tryParseJsonText(raw) {
  if (typeof raw !== "string") return undefined;
  const text = raw.trim();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch (_) {
    return undefined;
  }
}

function extractNodeInfoListFromCurl(curlText) {
  if (typeof curlText !== "string" || !curlText.trim()) return [];

  const raw = curlText.trim();
  const patterns = [
    /--data-raw\s+'([\s\S]*?)'(?:\s|$)/i,
    /--data\s+'([\s\S]*?)'(?:\s|$)/i,
    /--data-raw\s+"([\s\S]*?)"(?:\s|$)/i,
    /--data\s+"([\s\S]*?)"(?:\s|$)/i
  ];

  let bodyRaw = "";
  for (const pattern of patterns) {
    const m = raw.match(pattern);
    if (m && m[1]) {
      bodyRaw = m[1];
      break;
    }
  }
  if (!bodyRaw) return [];

  const direct = tryParseJsonText(bodyRaw);
  if (direct && Array.isArray(direct.nodeInfoList)) return direct.nodeInfoList;

  const repaired = bodyRaw
    .replace(/\\r\\n/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\\"/g, '"')
    .trim();
  const parsed = tryParseJsonText(repaired);
  if (parsed && Array.isArray(parsed.nodeInfoList)) return parsed.nodeInfoList;
  return [];
}

function findCurlDemoText(data) {
  if (!data || typeof data !== "object") return "";
  const keys = ["curl", "curlCmd", "curlCommand", "requestDemo", "requestExample", "demo", "example"];
  for (const key of keys) {
    if (typeof data[key] === "string" && data[key].trim()) return data[key];
  }
  return "";
}

function buildInputMergeKey(input) {
  if (!input || typeof input !== "object") return "";
  const nodeId = String(input.nodeId || "").trim();
  const fieldName = String(input.fieldName || "").trim();
  if (nodeId && fieldName) return `${nodeId}:${fieldName}`.toLowerCase();
  const key = String(input.key || "").trim();
  if (key) return key.toLowerCase();
  if (fieldName) return fieldName.toLowerCase();
  return "";
}

function mergeInputsWithFallback(primaryInputs, fallbackInputs) {
  const base = Array.isArray(primaryInputs) ? primaryInputs : [];
  const backup = Array.isArray(fallbackInputs) ? fallbackInputs : [];
  if (base.length === 0) return backup;
  if (backup.length === 0) return base;

  const backupMap = new Map();
  for (const item of backup) {
    const marker = buildInputMergeKey(item);
    if (!marker || backupMap.has(marker)) continue;
    backupMap.set(marker, item);
  }

  return base.map((input) => {
    const marker = buildInputMergeKey(input);
    if (!marker) return input;
    const alt = backupMap.get(marker);
    if (!alt) return input;

    const type = inferInputType(input.type || input.fieldType);
    const needsSelectOptions =
      type === "select" && (!Array.isArray(input.options) || input.options.length <= 1) && Array.isArray(alt.options) && alt.options.length > 1;
    if (!needsSelectOptions) return input;

    return {
      ...input,
      options: alt.options
    };
  });
}

function isPromptLikeText(text) {
  const hint = String(text || "").toLowerCase();
  return /prompt|提示词|negative|正向|负向/.test(hint);
}

function isGhostSchemaInput(raw, input) {
  if (!raw || !input) return false;
  const hint = `${input.key || ""} ${input.fieldName || ""} ${input.label || ""}`;
  if (!isPromptLikeText(hint)) return false;

  const hasNodeBinding = Boolean(String(input.nodeId || "").trim() && String(input.fieldName || "").trim());
  if (hasNodeBinding) return false;

  const rawType = String(raw.type || raw.valueType || raw.widget || raw.inputType || raw.fieldType || "").toLowerCase();
  const defaultMarker = String(input.default || "").trim().toLowerCase();
  const optionCount = Array.isArray(input.options) ? input.options.length : 0;
  const looksTypeDescriptor = OPTION_NOISE_MARKERS.has(defaultMarker) || /string|text|schema/.test(rawType);
  return looksTypeDescriptor && optionCount <= 1;
}

function normalizeInput(raw, index = 0) {
  const nodeId = String(raw.nodeId || raw.nodeID || "").trim();
  const fieldName = String(raw.fieldName || "").trim();
  const key = String(
    raw.key ||
      raw.paramKey ||
      (nodeId && fieldName ? `${nodeId}:${fieldName}` : `param_${index + 1}`)
  ).trim();

  const primaryOptionCandidates = [
    parseFieldOptions(raw.options),
    parseFieldOptions(raw.enums),
    parseFieldOptions(raw.values),
    parseFieldOptions(raw.selectOptions),
    parseFieldOptions(raw.optionList),
    parseFieldOptions(raw.fieldOptions),
    parseFieldOptions(raw.fieldData)
  ];
  const secondaryOptionCandidates = [
    parseFieldOptions(raw.config),
    parseFieldOptions(raw.extra),
    parseFieldOptions(raw.schema)
  ];
  let options = pickBestOptionList(primaryOptionCandidates) || pickBestOptionList(secondaryOptionCandidates);

  const optionCount = Array.isArray(options) ? options.length : 0;
  if (optionCount <= 1) {
    const hintText = `${key} ${raw.fieldName || ""} ${raw.label || ""} ${raw.name || ""}`;
    const textFallback = inferOptionsFromRawText(raw.fieldData, hintText);
    options = mergeOptionLists(options, textFallback);
  }
  options = sanitizeOptionList(options);

  const inferredType = inferInputType(raw.type || raw.valueType || raw.widget || raw.inputType || raw.fieldType);
  const keyHint = `${key} ${raw.fieldName || ""} ${raw.label || ""} ${raw.name || ""}`.toLowerCase();
  const looksPromptLike = isPromptLikeText(keyHint);
  let normalizedType = inferredType;
  if (inferredType === "text" && Array.isArray(options) && options.length > 1) normalizedType = "select";
  if (inferredType === "select" && looksPromptLike && (!Array.isArray(options) || options.length <= 1)) {
    normalizedType = "text";
  }

  const baseName = String(raw.name || raw.label || raw.title || raw.description || fieldName || key).trim();
  const baseLabel = String(raw.label || raw.name || raw.title || fieldName || key).trim();
  const displayLabel = resolveDisplayLabel(key, fieldName, baseLabel, baseName);

  return {
    key,
    name: baseName,
    label: displayLabel || baseLabel || baseName || key,
    type: normalizedType,
    required: raw.required !== false && raw.required !== 0 && raw.required !== "false",
    default: raw.default ?? raw.fieldValue,
    options: Array.isArray(options) ? options : undefined,
    min: typeof raw.min === "number" ? raw.min : undefined,
    max: typeof raw.max === "number" ? raw.max : undefined,
    step: typeof raw.step === "number" ? raw.step : undefined,
    nodeId: nodeId || undefined,
    fieldName: fieldName || undefined,
    fieldType: raw.fieldType || undefined,
    fieldData: raw.fieldData || undefined
  };
}

function extractAppInfoPayload(data) {
  if (!data || typeof data !== "object") {
    return { name: "未命名应用", description: "", inputs: [] };
  }

  let rawInputs = [];
  if (Array.isArray(data.nodeInfoList)) rawInputs = data.nodeInfoList;
  else if (Array.isArray(data.inputs)) rawInputs = data.inputs;
  else if (Array.isArray(data.params)) rawInputs = data.params;
  else if (Array.isArray(data.inputParams)) rawInputs = data.inputParams;
  else if (Array.isArray(data.nodeList)) rawInputs = data.nodeList;
  else if (data.workflow && Array.isArray(data.workflow.inputs)) rawInputs = data.workflow.inputs;

  const primaryInputs = rawInputs
    .map((x, idx) => ({ raw: x, input: normalizeInput(x, idx) }))
    .filter((item) => item && item.input && item.input.key)
    .filter((item) => !isGhostSchemaInput(item.raw, item.input))
    .map((item) => item.input);
  const curlDemoText = findCurlDemoText(data);
  const curlNodeInfoList = extractNodeInfoListFromCurl(curlDemoText);
  const fallbackInputs = curlNodeInfoList.map((x, idx) => normalizeInput(x, idx)).filter((x) => x.key);
  const inputs = mergeInputsWithFallback(primaryInputs, fallbackInputs);

  return {
    name: data.webappName || data.name || data.title || data.appName || data.workflowName || "未命名应用",
    description: data.description || data.desc || data.summary || "",
    inputs
  };
}

function warnSelectOptionCoverage(appInfo, log) {
  if (typeof log !== "function" || !appInfo || !Array.isArray(appInfo.inputs)) return;
  const weakSelects = appInfo.inputs
    .filter((input) => inferInputType(input.type || input.fieldType) === "select")
    .filter((input) => !Array.isArray(input.options) || input.options.length <= 1);
  if (weakSelects.length === 0) return;

  const preview = weakSelects
    .slice(0, 4)
    .map((input) => input.label || input.name || input.key || "unknown")
    .join(", ");
  log(`检测到 ${weakSelects.length} 个下拉参数可选项不足（${preview}）`, "warn");
}

async function parseJsonResponse(response) {
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    const text = await response.text().catch(() => "");
    return text ? { message: text } : null;
  }
  return response.json().catch(() => null);
}

async function fetchAppInfo(appId, apiKey, options = {}) {
  const log = options.log || (() => {});
  const normalizedId = normalizeAppId(appId);
  const reasons = [];

  const parseUrl = new URL(`${API.BASE_URL}${API.ENDPOINTS.PARSE_APP}`);
  parseUrl.searchParams.set("apiKey", apiKey);
  parseUrl.searchParams.set("webappId", normalizedId);

  try {
    log(`解析应用: ${API.ENDPOINTS.PARSE_APP}`, "info");
    const response = await fetch(parseUrl.toString(), {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }
    });
    const result = await parseJsonResponse(response);
    if (response.ok && result && (result.code === 0 || result.success === true)) {
      const payload = extractAppInfoPayload(result.data || result.result || result);
      warnSelectOptionCoverage(payload, log);
      return payload;
    }
    reasons.push(`apiCallDemo: ${toMessage(result, `HTTP ${response.status}`)}`);
  } catch (e) {
    reasons.push(`apiCallDemo: ${e.message}`);
  }

  for (const endpoint of API.PARSE_FALLBACKS) {
    const url = `${API.BASE_URL}${endpoint}/${encodeURIComponent(normalizedId)}`;
    try {
      log(`解析应用回退: ${endpoint}`, "info");
      const response = await fetch(url, {
        method: "GET",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }
      });
      const result = await parseJsonResponse(response);
      if (response.ok && result && (result.code === 0 || result.success === true)) {
        const payload = extractAppInfoPayload(result.data || result.result || result);
        warnSelectOptionCoverage(payload, log);
        return payload;
      }
      reasons.push(`${endpoint}: ${toMessage(result, `HTTP ${response.status}`)}`);
    } catch (e) {
      reasons.push(`${endpoint}: ${e.message}`);
    }
  }

  throw new Error(reasons[0] || "自动解析失败");
}

function base64ToArrayBuffer(base64) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binaryString.charCodeAt(i);
  return bytes.buffer;
}

function pickUploadedValue(data) {
  const token = data.fileName || data.filename || data.fileKey || data.key || "";
  const url = data.url || data.fileUrl || data.download_url || data.downloadUrl || "";
  return { value: token || url, token: token || "", url: url || "" };
}

async function uploadImage(apiKey, base64Image, options = {}) {
  const log = options.log || (() => {});
  const endpoints = [API.ENDPOINTS.UPLOAD_V2, API.ENDPOINTS.UPLOAD_LEGACY];
  const buffer = base64ToArrayBuffer(base64Image);
  const blob = new Blob([buffer], { type: "image/png" });
  const reasons = [];

  for (const endpoint of endpoints) {
    throwIfCancelled(options);
    try {
      const formData = new FormData();
      formData.append("file", blob, "image.png");

      const response = await fetch(`${API.BASE_URL}${endpoint}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: formData
      });
      throwIfCancelled(options);
      const result = await parseJsonResponse(response);
      throwIfCancelled(options);
      if (!response.ok) {
        reasons.push(`${endpoint}: HTTP ${response.status}`);
        continue;
      }

      const success = result && (result.code === 0 || result.success === true);
      if (!success) {
        reasons.push(`${endpoint}: ${toMessage(result)}`);
        continue;
      }

      const data = result.data || result.result || {};
      const picked = pickUploadedValue(data);
      if (picked.value) return picked;
      reasons.push(`${endpoint}: 上传成功但未返回可用文件标识`);
    } catch (e) {
      if (e && e.code === "RUN_CANCELLED") throw e;
      reasons.push(`${endpoint}: ${e.message}`);
    }
  }

  log(reasons.join(" | "), "warn");
  throw new Error("图片上传失败");
}

function isAiInput(input) {
  return Boolean(input && input.nodeId && input.fieldName);
}

function buildNodeInfoPayload(input, value) {
  const payload = {
    nodeId: input.nodeId,
    fieldName: input.fieldName,
    fieldValue: value
  };
  if (input.fieldType) payload.fieldType = input.fieldType;
  if (input.fieldData) payload.fieldData = input.fieldData;
  return payload;
}

function parseTaskId(result) {
  if (!result || typeof result !== "object") return "";
  return (
    (result.data && (result.data.taskId || result.data.id)) ||
    result.taskId ||
    result.id ||
    ""
  );
}

async function createAiAppTask(apiKey, appId, nodeInfoList, options = {}) {
  const log = options.log || (() => {});
  const normalizedId = normalizeAppId(appId);
  const candidates = [
    { apiKey, webappId: normalizedId, nodeInfoList },
    { apiKey, webAppId: normalizedId, nodeInfoList },
    { apiKey, appId: normalizedId, nodeInfoList },
    { webappId: normalizedId, nodeInfoList },
    { appId: normalizedId, nodeInfoList }
  ];
  const reasons = [];

  for (const body of candidates) {
    throwIfCancelled(options);
    try {
      const response = await fetch(`${API.BASE_URL}${API.ENDPOINTS.AI_APP_RUN}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      throwIfCancelled(options);
      const result = await parseJsonResponse(response);
      throwIfCancelled(options);
      const taskId = parseTaskId(result);
      const success = response.ok && result && (result.code === 0 || result.success === true) && taskId;
      if (success) return taskId;

      const marker = Object.keys(body).join(",");
      reasons.push(`ai-app/run(${marker}): ${toMessage(result, `HTTP ${response.status}`)}`);
    } catch (e) {
      if (e && e.code === "RUN_CANCELLED") throw e;
      reasons.push(`ai-app/run: ${e.message}`);
    }
  }

  log(reasons.join(" | "), "warn");
  throw new Error("AI 应用任务创建失败");
}

async function createLegacyTask(apiKey, appId, nodeParams, options = {}) {
  throwIfCancelled(options);
  const response = await fetch(`${API.BASE_URL}${API.ENDPOINTS.LEGACY_CREATE_TASK}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ apiKey, workflowId: normalizeAppId(appId), nodeParams })
  });
  throwIfCancelled(options);
  const result = await parseJsonResponse(response);
  throwIfCancelled(options);
  const taskId = parseTaskId(result);
  const success = response.ok && result && (result.code === 0 || result.success === true) && taskId;
  if (!success) throw new Error(toMessage(result, `创建任务失败 (HTTP ${response.status})`));
  return taskId;
}

function extractOutputUrl(payload) {
  if (!payload) return "";

  if (typeof payload === "string") {
    return /^https?:\/\//i.test(payload) ? payload : "";
  }

  if (Array.isArray(payload)) {
    for (const item of payload) {
      const url = extractOutputUrl(item);
      if (url) return url;
    }
    return "";
  }

  if (typeof payload === "object") {
    const keys = ["fileUrl", "url", "downloadUrl", "download_url", "imageUrl", "resultUrl"];
    for (const key of keys) {
      const v = payload[key];
      if (typeof v === "string" && /^https?:\/\//i.test(v)) return v;
    }

    const nestedKeys = ["outputs", "data", "result", "list", "items", "nodeOutputs"];
    for (const key of nestedKeys) {
      const url = extractOutputUrl(payload[key]);
      if (url) return url;
    }
  }

  return "";
}

function extractTaskStatus(payload) {
  if (!payload || typeof payload !== "object") return "";
  const status = payload.status || payload.state || payload.taskStatus || "";
  return String(status).toUpperCase();
}

function isPendingStatus(status) {
  return ["PENDING", "RUNNING", "PROCESSING", "QUEUED", "QUEUE", "WAITING", "IN_PROGRESS"].includes(status);
}

function isFailedStatus(status) {
  return ["FAILED", "ERROR", "CANCELLED", "CANCELED"].includes(status);
}

function isPendingMessage(message) {
  const text = String(message || "").toLowerCase();
  return /(processing|pending|running|queue|wait|运行中|排队|处理中)/i.test(text);
}

function makeRunCancelledError(message = "用户取消运行") {
  const err = new Error(message);
  err.code = "RUN_CANCELLED";
  return err;
}

function throwIfCancelled(options = {}) {
  if (typeof options.shouldCancel === "function" && options.shouldCancel()) {
    throw makeRunCancelledError();
  }
}

async function pollTaskOutput(apiKey, taskId, settings, options = {}) {
  const log = options.log || (() => {});
  const pollIntervalMs = Math.max(1, Number(settings.pollInterval) || 2) * 1000;
  const timeoutMs = Math.max(10, Number(settings.timeout) || 90) * 1000;
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    throwIfCancelled(options);
    try {
      const response = await fetch(`${API.BASE_URL}${API.ENDPOINTS.TASK_OUTPUTS}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey, taskId })
      });
      throwIfCancelled(options);
      const result = await parseJsonResponse(response);
      throwIfCancelled(options);

      if (response.ok && result && (result.code === 0 || result.success === true)) {
        const payload = result.data || result.result || result;
        const outputUrl = extractOutputUrl(payload);
        if (outputUrl) return outputUrl;

        const status = extractTaskStatus(payload);
        if (isFailedStatus(status)) throw new Error(toMessage(result, `任务失败 (${status})`));
        log(`任务状态: ${status || "处理中"}`, "info");
        await sleep(pollIntervalMs);
        throwIfCancelled(options);
        continue;
      }

      const message = toMessage(result, `HTTP ${response.status}`);
      const status = extractTaskStatus(result && result.data ? result.data : result);
      if (isPendingStatus(status) || isPendingMessage(message)) {
        log(`任务状态: ${status || message}`, "info");
        await sleep(pollIntervalMs);
        throwIfCancelled(options);
        continue;
      }

      throw new Error(message);
    } catch (e) {
      if (e && e.code === "RUN_CANCELLED") throw e;
      if (isPendingMessage(e.message)) {
        await sleep(pollIntervalMs);
        throwIfCancelled(options);
        continue;
      }
      throw e;
    }
  }

  throw new Error("任务超时，请稍后查看 RunningHub 任务列表");
}

async function runAppTask(apiKey, appItem, inputValues, options = {}) {
  const log = options.log || (() => {});
  const nodeInfoList = [];
  const nodeParams = {};

  for (const input of appItem.inputs || []) {
    throwIfCancelled(options);
    const key = String(input.key || "").trim();
    if (!key) continue;

    let value = inputValues[key];
    const type = inferInputType(input.type || input.fieldType);
    if (type !== "image" && input.required && isEmptyValue(value)) {
      throw new Error(`缺少必填参数: ${input.label || input.name || key}`);
    }

    if (type === "image") {
      if (isEmptyValue(value)) {
        // 显式传空值占位，避免服务端回退到应用内示例图。
        value = "";
        if (input.required) log(`图片参数未上传，已使用空值占位: ${input.label || input.name || key}`, "warn");
      } else {
        const uploaded = await uploadImage(apiKey, value, options);
        value = uploaded.value;
        throwIfCancelled(options);
      }
    } else if (type === "number" && !isEmptyValue(value)) {
      const n = Number(value);
      if (!Number.isFinite(n)) throw new Error(`数字参数无效: ${input.label || key}`);
      value = n;
    } else if (type === "boolean") {
      value = Boolean(value);
    }

    nodeParams[key] = value;
    if (input.fieldName && !(input.fieldName in nodeParams)) nodeParams[input.fieldName] = value;
    if (isAiInput(input)) nodeInfoList.push(buildNodeInfoPayload(input, value));
  }

  let lastErr = null;
  if (nodeInfoList.length > 0) {
    try {
      throwIfCancelled(options);
      log(`提交任务: AI 应用接口 (${nodeInfoList.length} 个参数)`, "info");
      return await createAiAppTask(apiKey, appItem.appId, nodeInfoList, options);
    } catch (e) {
      if (e && e.code === "RUN_CANCELLED") throw e;
      lastErr = e;
      log(`AI 应用接口失败，尝试回退旧接口: ${e.message}`, "warn");
    }
  }

  if (Object.keys(nodeParams).length > 0) {
    throwIfCancelled(options);
    log("提交任务: 兼容工作流接口", "info");
    return createLegacyTask(apiKey, appItem.appId, nodeParams, options);
  }

  if (lastErr) throw lastErr;
  throw new Error("没有可提交的参数");
}

async function downloadResultBinary(url, options = {}) {
  throwIfCancelled(options);
  const response = await fetch(url);
  throwIfCancelled(options);
  if (!response.ok) throw new Error(`下载结果失败 (HTTP ${response.status})`);
  return response.arrayBuffer();
}

async function testApiKey(apiKey) {
  const url = new URL(`${API.BASE_URL}${API.ENDPOINTS.PARSE_APP}`);
  url.searchParams.set("apiKey", apiKey);
  url.searchParams.set("webappId", "1");

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }
  });
  const result = await parseJsonResponse(response);

  if (response.status === 401) return { ok: false, message: "API Key 无效 (401)" };
  if (response.status === 403) return { ok: false, message: "API Key 权限不足或余额不足 (403)" };
  if (result && (result.code === 0 || result.success === true)) return { ok: true, message: "API Key 有效" };

  return { ok: response.ok, message: toMessage(result, `HTTP ${response.status}`) };
}

function pickAccountValue(raw, keys) {
  if (!raw || typeof raw !== "object") return "";
  for (const key of keys) {
    if (raw[key] !== undefined && raw[key] !== null && String(raw[key]).trim() !== "") {
      return String(raw[key]).trim();
    }
  }
  return "";
}

async function fetchAccountStatus(apiKey) {
  if (!apiKey) throw new Error("缺少 API Key");
  const response = await fetch(`${API.BASE_URL}${API.ENDPOINTS.ACCOUNT_STATUS}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ apikey: apiKey })
  });
  const result = await parseJsonResponse(response);
  const ok = response.ok && result && (result.code === 0 || result.success === true);
  if (!ok) throw new Error(toMessage(result, `获取账户信息失败 (HTTP ${response.status})`));

  const data = result.data || result.result || {};
  const account = (data && data.accountStatus && typeof data.accountStatus === "object" ? data.accountStatus : data) || {};
  return {
    remainMoney: pickAccountValue(account, ["remainMoney", "balance", "money"]),
    remainCoins: pickAccountValue(account, ["remainCoins", "rhCoins", "coins"])
  };
}

module.exports = {
  fetchAppInfo,
  runAppTask,
  pollTaskOutput,
  downloadResultBinary,
  testApiKey,
  fetchAccountStatus
};

```

## src/services/store.js

```javascript
const { STORAGE_KEYS, DEFAULT_SETTINGS, DEFAULT_PROMPT_TEMPLATES } = require("./config");
const { generateId, safeJsonParse, normalizeAppId, inferInputType } = require("./utils");

function readJson(key, fallback) {
  const raw = localStorage.getItem(key);
  if (!raw) return fallback;
  return safeJsonParse(raw, fallback);
}

function writeJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function getApiKey() {
  return localStorage.getItem(STORAGE_KEYS.API_KEY) || "";
}

function saveApiKey(apiKey) {
  localStorage.setItem(STORAGE_KEYS.API_KEY, String(apiKey || "").trim());
}

function getSettings() {
  const value = readJson(STORAGE_KEYS.SETTINGS, DEFAULT_SETTINGS);
  return {
    pollInterval: Number(value.pollInterval) || DEFAULT_SETTINGS.pollInterval,
    timeout: Number(value.timeout) || DEFAULT_SETTINGS.timeout
  };
}

function saveSettings(settings) {
  writeJson(STORAGE_KEYS.SETTINGS, {
    pollInterval: Number(settings.pollInterval) || DEFAULT_SETTINGS.pollInterval,
    timeout: Number(settings.timeout) || DEFAULT_SETTINGS.timeout
  });
}

function getAiApps() {
  const apps = readJson(STORAGE_KEYS.AI_APPS, []);
  return Array.isArray(apps) ? apps : [];
}

function saveAiApps(apps) {
  writeJson(STORAGE_KEYS.AI_APPS, Array.isArray(apps) ? apps : []);
}

function addAiApp(appData) {
  const list = getAiApps();
  const item = {
    ...appData,
    id: generateId(),
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  list.push(item);
  saveAiApps(list);
  return item.id;
}

function updateAiApp(id, appData) {
  const list = getAiApps();
  const idx = list.findIndex((x) => x.id === id);
  if (idx === -1) return false;
  list[idx] = {
    ...list[idx],
    ...appData,
    id,
    updatedAt: Date.now()
  };
  saveAiApps(list);
  return true;
}

function deleteAiApp(id) {
  const list = getAiApps();
  const next = list.filter((x) => x.id !== id);
  if (next.length === list.length) return false;
  saveAiApps(next);
  return true;
}

function getPromptTemplates() {
  const value = readJson(STORAGE_KEYS.PROMPT_TEMPLATES, DEFAULT_PROMPT_TEMPLATES);
  if (!Array.isArray(value) || value.length === 0) return [...DEFAULT_PROMPT_TEMPLATES];
  return value;
}

function savePromptTemplates(templates) {
  writeJson(STORAGE_KEYS.PROMPT_TEMPLATES, Array.isArray(templates) ? templates : []);
}

function addPromptTemplate(template) {
  const list = getPromptTemplates();
  list.push({
    id: generateId(),
    title: String(template.title || "").trim(),
    content: String(template.content || ""),
    createdAt: Date.now()
  });
  savePromptTemplates(list);
}

function deletePromptTemplate(id) {
  const list = getPromptTemplates();
  const next = list.filter((x) => x.id !== id);
  if (next.length === list.length) return false;
  savePromptTemplates(next);
  return true;
}

function migrateLegacyWorkflows(log) {
  const currentApps = getAiApps();
  if (currentApps.length > 0) return;

  const legacyAiAppKeys = Array.isArray(STORAGE_KEYS.LEGACY_AI_APPS) ? STORAGE_KEYS.LEGACY_AI_APPS : [];
  for (const legacyKey of legacyAiAppKeys) {
    const legacyApps = readJson(legacyKey, []);
    if (!Array.isArray(legacyApps) || legacyApps.length === 0) continue;

    const convertedApps = legacyApps
      .map((app, appIndex) => {
        const appId = normalizeAppId(app.appId || app.workflowId || app.webappId || app.id || app.code || "");
        if (!appId) return null;

        const rawInputs = Array.isArray(app.inputs)
          ? app.inputs
          : Array.isArray(app.params)
          ? app.params
          : Array.isArray(app.mappings)
          ? app.mappings
          : [];

        const inputs = rawInputs
          .map((input, inputIndex) => {
            const key = String(
              input.key || input.name || input.fieldName || input.paramKey || `param_${inputIndex + 1}`
            ).trim();
            if (!key) return null;

            const label = String(input.label || input.title || input.name || key).trim();
            return {
              key,
              name: label,
              label,
              type: inferInputType(input.type || input.fieldType),
              required: input.required !== false,
              default: input.default,
              options: Array.isArray(input.options) ? [...input.options] : undefined
            };
          })
          .filter(Boolean);

        return {
          id: generateId(),
          appId,
          name: String(app.name || app.title || app.appName || `应用 ${appIndex + 1}`),
          description: String(app.description || ""),
          inputs,
          createdAt: Date.now(),
          updatedAt: Date.now()
        };
      })
      .filter(Boolean);

    if (convertedApps.length > 0) {
      saveAiApps(convertedApps);
      if (typeof log === "function") log(`已迁移 ${convertedApps.length} 个旧版应用（${legacyKey}）`, "success");
      return;
    }
  }

  const legacy = readJson(STORAGE_KEYS.LEGACY_WORKFLOWS, []);
  if (!Array.isArray(legacy) || legacy.length === 0) return;

  const converted = legacy
    .map((w) => ({
      id: generateId(),
      appId: normalizeAppId(w.workflowId || w.appId || ""),
      name: String(w.name || "未命名应用"),
      description: "",
      inputs: Array.isArray(w.mappings)
        ? w.mappings
            .map((m, idx) => {
              const key = String(m.key || m.name || `param_${idx + 1}`).trim();
              const label = String(m.label || key || "参数").trim();
              return {
                key,
                name: label,
                label,
                type: inferInputType(m.type),
                required: true
              };
            })
            .filter((x) => x.key)
        : [],
      createdAt: Date.now(),
      updatedAt: Date.now()
    }))
    .filter((x) => x.appId);

  if (converted.length > 0) {
    saveAiApps(converted);
    if (typeof log === "function") log(`已迁移 ${converted.length} 个旧工作流`, "success");
  }
}

module.exports = {
  getApiKey,
  saveApiKey,
  getSettings,
  saveSettings,
  getAiApps,
  saveAiApps,
  addAiApp,
  updateAiApp,
  deleteAiApp,
  getPromptTemplates,
  savePromptTemplates,
  addPromptTemplate,
  deletePromptTemplate,
  migrateLegacyWorkflows
};

```

## src/utils.js

```javascript
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function generateId() {
  return `id_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function safeJsonParse(raw, fallback) {
  try {
    return JSON.parse(raw);
  } catch (_) {
    return fallback;
  }
}

function normalizeAppId(rawValue) {
  const value = String(rawValue || "").trim();
  if (!value) return "";

  if (!/[/?#]/.test(value) && !value.includes("runninghub.cn")) return value;

  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch (_) {}

  try {
    const url = new URL(decoded);
    const keys = [
      "webappId",
      "webappid",
      "appId",
      "appid",
      "workflowId",
      "workflowid",
      "id",
      "code"
    ];
    for (const key of keys) {
      const v = url.searchParams.get(key);
      if (v && v.trim()) return v.trim();
    }

    const segments = url.pathname.split("/").filter(Boolean);
    if (segments.length > 0) {
      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i].toLowerCase();
        if (["app", "workflow", "community", "detail"].includes(seg) && segments[i + 1]) {
          return segments[i + 1].trim();
        }
      }
      return segments[segments.length - 1].trim();
    }
  } catch (_) {}

  const numeric = decoded.match(/\d{5,}/);
  return numeric ? numeric[0] : value;
}

function inferInputType(rawType) {
  const t = String(rawType || "").toLowerCase();
  if (t.includes("image") || t.includes("file") || t.includes("img")) return "image";
  if (t.includes("number") || t.includes("int") || t.includes("float") || t.includes("slider")) return "number";
  if (t === "list") return "select";
  if (t.includes("select") || t.includes("enum") || t.includes("option")) return "select";
  if (t.includes("bool") || t.includes("switch") || t.includes("checkbox")) return "boolean";
  return "text";
}

function isEmptyValue(value) {
  return value === undefined || value === null || value === "";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function toFiniteNumber(value, fallback = 0) {
  const n = typeof value === "number" ? value : Number.parseFloat(String(value || ""));
  return Number.isFinite(n) ? n : fallback;
}

module.exports = {
  sleep,
  generateId,
  safeJsonParse,
  normalizeAppId,
  inferInputType,
  isEmptyValue,
  escapeHtml,
  toFiniteNumber
};


```

## style.css

```css
:root {
  /* Adobe Dark Theme Colors */
  --bg-app: #323232;
  --bg-panel: #3E3E3E;
  --bg-input: #262626;
  --bg-hover: #464646;
  --border-color: #1E1E1E; /* 几乎黑色的分割线 */
  --accent-color: #378EF0; /* Adobe Blue */
  --text-main: #FFFFFF;
  --text-sub: #9E9E9E;
  --font-size-xs: 10px;
  --font-size-sm: 11px;
  --radius-sm: 2px; /* Adobe 风格圆角很小 */
}

body {
  background-color: var(--bg-app);
  color: var(--text-main);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  font-size: var(--font-size-sm);
  margin: 0; padding: 0;
  overflow: hidden; /* 防止整体滚动 */
}

/* --- 紧凑导航 --- */
.nav-tabs {
  display: flex;
  background: #2A2A2A;
  border-bottom: 1px solid #000;
  padding: 0;
}
.nav-item {
  flex: 1;
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  color: var(--text-sub);
  padding: 8px 0;
  cursor: pointer;
  font-size: var(--font-size-sm);
  transition: all 0.2s;
}
.nav-item.active {
  color: var(--text-main);
  border-bottom-color: var(--accent-color);
  background: #383838;
}

/* --- 内容区 --- */
.tab-content {
  display: none;
  padding: 8px;
  height: calc(100vh - 35px); /* 减去头部高度 */
  overflow-y: auto;
}
.tab-content.active { display: block; }

/* --- 卡片去除，改为分隔线布局 --- */
.section-header {
  font-size: var(--font-size-xs);
  font-weight: 700;
  color: var(--text-sub);
  text-transform: uppercase;
  margin: 12px 0 6px 0;
  display: flex;
  justify-content: space-between;
}

/* --- 紧凑输入框组 (Grid Layout) --- */
.input-grid {
  display: grid;
  grid-template-columns: 1fr 1fr; /* 两列布局 */
  gap: 6px;
  margin-bottom: 8px;
}
.input-grid.full-width { grid-template-columns: 1fr; }

.control-group label {
  display: block;
  font-size: var(--font-size-xs);
  color: #B3B3B3;
  margin-bottom: 2px;
}

input, select, textarea {
  width: 100%;
  background: var(--bg-input);
  border: 1px solid var(--border-color);
  color: var(--text-main);
  padding: 4px 6px;
  border-radius: var(--radius-sm);
  font-size: var(--font-size-sm);
}
input:focus, textarea:focus {
  border-color: var(--accent-color);
  outline: none;
}

/* --- 按钮优化 --- */
.main-btn {
  width: 100%;
  background: #4B4B4B;
  border: 1px solid #202020;
  color: white;
  padding: 6px 0;
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-weight: 600;
}
.main-btn:hover { background: #5a5a5a; }
.main-btn-primary { background: var(--accent-color); border-color: #205596; }
.main-btn-primary:hover { background: #409bf5; }

/* --- 状态栏与 Toast 替代日志窗口 --- */
#logWindow {
  display: none; /* 默认隐藏旧日志 */
}
.toast-container {
  position: fixed;
  bottom: 10px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 100;
  display: flex;
  flex-direction: column;
  gap: 5px;
  pointer-events: none; /* 让鼠标穿透 */
}
.toast {
  background: rgba(0,0,0,0.8);
  padding: 6px 12px;
  border-radius: 4px;
  font-size: var(--font-size-xs);
  color: #fff;
  animation: fadeIn 0.3s ease;
}
@keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
```

