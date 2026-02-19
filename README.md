# 小T修图助手 / RunningHub Photoshop Plugin

RunningHub AI 工作流在 Photoshop 内一键运行的 UXP 插件，支持自动解析参数、任务运行与结果回贴 / A Photoshop UXP plugin that runs RunningHub AI apps inside Photoshop with auto parsing, task execution, and smart pasting.

## 功能亮点 / Highlights
- RunningHub 应用一键接入：输入应用 ID 或 URL，自动解析参数并生成动态表单 / One-click import of RunningHub apps by ID/URL with automatic parameter parsing and dynamic form generation.
- 图像参数直接取自 PS 选区并支持预览与清除 / Image parameters can be captured directly from Photoshop selections with preview and clear controls.
- 提示词模板一键插入，提升重复任务效率 / Prompt templates can be inserted with one click for faster repeated workflows.
- 任务运行、轮询、结果下载与回贴一体化 / End-to-end task execution, polling, download, and result pasting.
- 智能回贴策略：对齐主体位置并可自动容错回退 / Smart pasting aligns main subjects and falls back when alignment confidence is low.
- 内置 PS 工具箱：观察层、中性灰、盖印、高斯模糊、锐化、高反差、内容识别填充 / Built-in PS tools: observer group, neutral gray, stamp, Gaussian blur, sharpen, high pass, content-aware fill.
- 启动即运行环境诊断，支持一键导出诊断报告 / Startup environment diagnostics with one-click report export.

## 适用场景 / Use Cases
- 将 RunningHub 上的 AI 应用直接嵌入 PS 修图流程 / Embed RunningHub AI apps directly into Photoshop retouching workflows.
- 在 PS 内完成参数配置、任务提交与结果回贴 / Configure parameters, submit tasks, and paste results without leaving Photoshop.
- 需要高频调用模板化提示词的场景 / Scenarios with frequent prompt-template reuse.

## 快速上手 / Quick Start
1. 安装：使用 Adobe UXP Developer Tool 添加插件，选择 `manifest.json` / Install via Adobe UXP Developer Tool and select `manifest.json`.
2. 启动：在 Photoshop 中打开“插件面板 → 小T修图助手” / Open the panel in Photoshop.
3. 配置：进入“设置”保存 RunningHub API Key，并点击测试 / Go to Settings, save the RunningHub API Key, and test the connection.
4. 解析应用：输入 RunningHub 应用 ID 或 URL → 解析 → 保存到工作台 / Parse an app by ID/URL, then save it to Workspace.
5. 运行任务：选择应用，捕获选区图像，填写参数，点击“开始运行” / Select an app, capture selection images, fill parameters, and click Run.
6. 查看结果：日志区查看进度，结果自动下载并回贴到当前文档 / Watch logs, the result downloads and pastes into the active document.

## 使用指南 / Usage

### RH 工作台 / Workspace
- 应用选择器：支持搜索与刷新 / App picker supports search and refresh.
- 动态参数：根据解析结果生成输入控件（图像、文本、数字、选择、布尔） / Dynamic inputs for image/text/number/select/boolean.
- 图像输入：点击“从 PS 选区获取”，支持预览与清除 / Image inputs capture from PS selection with preview and clear.
- 提示词模板：提示词输入框支持“预设”弹窗选择 / Prompt fields support a template picker.
- 上传分辨率：无限制/4k/2k/1k，可减少上传时间 / Upload max edge: unlimited/4k/2k/1k to reduce upload time.
- 回贴策略：普通（居中填满）与智能（主体对齐） / Paste strategy: normal (center cover) or smart (subject alignment).
- 运行日志：支持复制与清空 / Logs can be copied or cleared.

### 工具箱 / Tools
- 黑白观察层：创建黑白+曲线观察组 / Create a B&W + Curves observer group.
- 中性灰图层：50% 灰 + 柔光，用于加深减淡 / 50% gray layer in Soft Light for dodge & burn.
- 盖印图层：等同 Ctrl+Alt+Shift+E / Stamp visible layers.
- 高斯模糊：调用原生对话框 / Gaussian blur with native dialog.
- 锐化：调用智能锐化对话框 / Smart sharpen dialog.
- 高反差保留：调用原生对话框 / High pass dialog.
- 智能识别填充：需先建立选区 / Content-Aware Fill (selection required).

### 设置 / Settings
- API Key：保存/显示/测试 RunningHub API Key / Save, reveal, and test API key.
- 应用管理：解析应用、保存、编辑、删除，重复 ID 自动标记 / Parse apps, save/edit/delete, duplicate IDs are highlighted.
- 解析调试：可读取最近一次解析 Debug 信息 / Load the latest parse debug report.
- 提示词模板：新增、覆盖同名、删除模板 / Add, overwrite by title, or delete templates.
- 高级设置：轮询间隔（1-15s）与超时（10-600s） / Advanced: poll interval and timeout.
- 环境诊断：手动运行并查看报告摘要 / Run diagnostics and view summaries.

## RunningHub 集成 / RunningHub Integration
- 多端点解析：优先使用 `/api/webapp/apiCallDemo`，失败时回退到 `/uc/openapi/app` 等 / Parses via `/api/webapp/apiCallDemo` with fallbacks to `/uc/openapi/app` and others.
- 参数智能规范化：自动推断类型、解析选项、优化标签 / Heuristic normalization of types, options, and labels.
- AI App / Legacy 双通道：优先 AI App API，失败自动回退 Legacy / Uses AI App API first, falls back to legacy workflow API.
- 图片上传：支持 v2/legacy 上传接口，可自动缩放 / Uploads via v2/legacy endpoints with optional resize.
- 任务轮询：依据状态与超时配置进行轮询，失败有清晰提示 / Polls with status/timeout handling and clear errors.

## 图像处理与回贴 / Image Pipeline & Pasting
- 选区捕获：有选区时裁剪导出，无选区时导出整幅画面 / Captures selection or full document.
- 结果回贴：基于选区边界进行放置与对齐 / Pastes results based on selection bounds.
- 智能对齐：基于内容分析计算缩放与偏移，低分数自动降级 / Smart alignment computes scale/offset and falls back if confidence is low.
- 兼容处理：异常或超时会回退到普通回贴 / Errors and timeouts fall back to normal pasting.

## 环境诊断 / Diagnostics
- 自动启动诊断：插件加载即生成报告 / A report is generated on startup.
- 报告存储：LocalStorage `rh_env_diagnostic_latest` 与 UXP 数据目录 `pixelrunner_diag_*.json/txt` / Stored in localStorage and UXP data folder.
- 检测范围：运行环境、PS/UXP 版本、DOM 完整性、模块契约、数据健康、网络连通性 / Checks runtime, host, DOM, module exports, data health, and network reachability.

## 数据与隐私 / Data & Privacy
- 本地存储键 / LocalStorage keys: `rh_api_key`, `rh_ai_apps_v2`, `rh_prompt_templates`, `rh_settings`.
- 解析 Debug：`rh_last_parse_debug` / Parse debug key: `rh_last_parse_debug`.
- 网络请求仅面向 RunningHub 域名 / Network requests are limited to RunningHub domains.

## 权限说明 / Permissions
- `localFileSystem: fullAccess`：临时文件、诊断报告读写 / For temp files and diagnostic reports.
- `launchProcess`：打开外部链接（如打赏二维码） / Open external links (e.g., donation QR).
- `network`：访问 RunningHub API 与资源域名 / Access RunningHub API and assets.

## 项目结构 / Project Structure
- `index.html`：面板 UI 结构 / Panel UI layout.
- `index.js`：启动与控制器初始化 / Bootstrap and controllers.
- `style.css`：UI 样式 / UI styles.
- `src/controllers`：工作台/设置/工具箱控制器 / Workspace/Settings/Tools controllers.
- `src/services`：RunningHub API、PS 操作、存储逻辑 / RunningHub APIs, PS operations, storage.
- `src/diagnostics`：环境诊断 / Environment diagnostics.
- `src/shared`：输入规范与 DOM 工具 / Input schema and DOM helpers.
- `docs/`：设计与诊断说明 / Design and diagnostic notes.

## 开发与调试 / Development
- 无需构建步骤，直接由 UXP 加载 / No build step required; load directly in UXP Developer Tool.
- 推荐入口：`index.html`, `index.js`, `src/controllers`, `src/services` / Main entry points.
- 日志查看：使用 UXP Developer Console / Use UXP Developer Console for logs.
- 调试解析：设置页提供“Load Parse Debug” / Parse debug can be loaded from Settings.

## 常见问题 / FAQ
- API Key 无效？确认 RunningHub 后台生成的 API Key，账户余额与权限正常 / Ensure the API key is valid and the account has balance/permissions.
- 解析失败？尝试不同应用 URL/ID，或查看 Parse Debug 信息 / Try different IDs/URLs and inspect Parse Debug.
- 任务超时？提高超时设置或稍后在 RunningHub 任务列表查看 / Increase timeout or check RunningHub task list later.
- 智能回贴效果不理想？切换为“普通”策略 / Switch paste strategy to Normal.
- 内容识别填充不可用？确保有有效选区 / Content-Aware Fill requires a selection.

## 路线图 / Roadmap
- 失败场景的手动参数编辑器 / Manual parameter editor for parse failures.
- 更多 PS 工具与预设 / More PS tools and presets.

## 版本 / Version
- 当前版本：`v2.0.3`（见 `manifest.json`） / Current version: `v2.0.3` (see `manifest.json`).

## 许可 / License
- Apache-2.0

## 支持与反馈 / Support
- GitHub Issues 或联系 QQ: 1048855084 / GitHub Issues or QQ: 1048855084.
