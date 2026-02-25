<div align="center">
  <img src="icons/icon.png" width="92" alt="小T修图助手" />
  <h1>小T修图助手</h1>
  <p>RunningHub Photoshop Plugin</p>
  <p>把 RunningHub AI 工作流直接放进 Photoshop 的 UXP 插件。自动解析参数、执行任务、下载结果，并回贴到当前画布。</p>
  <p>
    <img src="https://img.shields.io/badge/version-V2.2.1-0A7BFF" alt="version" />
    <img src="https://img.shields.io/badge/Photoshop-23%2B-31A8FF?logo=adobephotoshop&logoColor=white" alt="photoshop" />
    <img src="https://img.shields.io/badge/UXP-Manifest%20v5-111111" alt="uxp" />
    <img src="https://img.shields.io/badge/license-Apache--2.0-3DA639" alt="license" />
  </p>
</div>

<p align="center">
  <a href="#quick-start">快速上手</a> ·
  <a href="#feature-map">功能一览</a> ·
  <a href="#workflow">工作流</a> ·
  <a href="#integration">集成细节</a> ·
  <a href="#data-privacy">数据与隐私</a> ·
  <a href="#ps-modules">PS模块边界</a> ·
  <a href="#smoke-checklist">冒烟清单</a> ·
  <a href="#release-guardrails">发布预检</a> ·
  <a href="#development">开发与调试</a>
</p>

> 在 Photoshop 内完成 RunningHub AI 应用的解析、参数填写、任务执行与结果回贴，适合高频、可复用、追求效率的修图场景。

<a name="specs"></a>
## 关键规格 / Specs

| 项目 | 值 |
| --- | --- |
| Host | Photoshop (UXP Manifest v5) |
| Min Photoshop | 23.0 |
| Version | V2.2.1 |

<a name="highlights"></a>
## 亮点 / Highlights
- 一键接入 RunningHub 应用，自动解析参数并生成动态表单
- 图像参数可直接从 PS 选区获取，支持预览与清除
- 提示词模板一键插入，适合高频重复任务
- 任务执行、轮询、下载与回贴一体化完成
- 智能回贴对齐主体位置，低置信度自动回退
- 打赏弹窗支持静态二维码展示与加载状态提示，提升小面板场景可用性
- 内置常用修图工具箱，启动即生成环境诊断报告

<a name="use-cases"></a>
## 适用场景 / Use Cases
- 将 RunningHub AI 应用嵌入 PS 修图流程
- 在 PS 内完成参数配置、任务提交与结果回贴
- 需要模板化提示词与快速试错的场景

<a name="quick-start"></a>
## 快速上手 / Quick Start
1. 安装：使用 Adobe UXP Developer Tool 添加插件，选择 `manifest.json`
2. 启动：在 Photoshop 中打开 “插件面板 -> 小T修图助手”
3. 配置：在 “设置” 保存 RunningHub API Key 并点击测试
4. 解析应用：输入 RunningHub 应用 ID 或 URL -> 解析 -> 保存到工作台
5. 运行任务：选择应用，捕获选区图像，填写参数，点击 “开始运行”
6. 查看结果：日志区查看进度，结果自动下载并回贴到当前文档

<a name="feature-map"></a>
## 功能一览 / Feature Map

| 模块 | 亮点 | 典型用途 |
| --- | --- | --- |
| Workspace | 动态参数表单、图像取样、模板插入 | 解析应用并执行任务 |
| Tools | 观察层、盖印、高斯模糊、锐化等 | 高频修图操作快捷入口 |
| Settings | API Key、应用管理、模板管理 | 初始配置与维护 |
| Diagnostics | 启动诊断、报告导出 | 环境与依赖排查 |

<details>
<summary><strong>Workspace 细节</strong></summary>

- 应用选择器：搜索、刷新与快速切换
- 动态参数：图像、文本、数字、选择、布尔等控件自动生成
- 图像输入：从 PS 选区获取，支持预览与清除
- 提示词模板：输入框可唤起模板面板
- 上传分辨率：无限制 / 4k / 2k / 1k 以缩短上传时间
- 回贴策略：普通(居中填满) 与 智能(主体对齐)
- 运行日志：支持复制与清空

</details>

<details>
<summary><strong>Tools 细节</strong></summary>

- 黑白观察层：创建黑白 + 曲线观察组
- 中性灰图层：50% 灰 + 柔光，用于加深减淡
- 盖印图层：等同 Ctrl+Alt+Shift+E
- 高斯模糊：调用原生对话框
- 锐化：调用智能锐化对话框
- 高反差保留：调用原生对话框
- 内容识别填充：需先建立选区

</details>

<details>
<summary><strong>Settings 细节</strong></summary>

- API Key：保存、显示与测试 RunningHub API Key
- 应用管理：解析、保存、编辑、删除，重复 ID 自动标记
- 解析调试：读取最近一次解析的 Debug 信息
- 提示词模板：新增、覆盖同名、删除模板
- 高级设置：轮询间隔(1-15s) 与超时(10-600s)
- 环境诊断：手动运行并查看摘要

</details>

<a name="workflow"></a>
## 工作流 / Workflow

```mermaid
flowchart LR
  A[RunningHub App ID or URL] --> B[参数解析]
  B --> C[动态表单]
  C --> D[选区图像捕获]
  D --> E[任务提交]
  E --> F[状态轮询]
  F --> G[结果下载]
  G --> H[智能回贴]
```

<a name="integration"></a>
## 集成细节 / Integration

### RunningHub 解析与任务
- 解析端点：优先 `/api/webapp/apiCallDemo`，失败回退 `/uc/openapi/app` 等
- 参数规范化：自动推断类型、解析选项、优化标签
- AI App / Legacy 双通道：优先 AI App API，失败回退 Legacy
- 图片上传：支持 v2/legacy 上传接口，可按设置自动缩放
- 任务轮询：依据状态与超时配置轮询，失败有清晰提示

### 图像处理与回贴
- 选区捕获：有选区时裁剪导出，无选区时导出整幅画面
- 结果回贴：基于选区边界放置与对齐
- 智能对齐：基于内容分析计算缩放与偏移，低分数自动降级
- 兼容处理：异常或超时回退到普通回贴

<a name="data-privacy"></a>
## 数据与隐私 / Data & Privacy

| 类型 | 内容 |
| --- | --- |
| LocalStorage | `rh_api_key`, `rh_ai_apps_v2`, `rh_prompt_templates`, `rh_settings` |
| Parse Debug | `rh_last_parse_debug` |
| 网络请求 | 仅访问 RunningHub 域名 |

<a name="permissions"></a>
## 权限说明 / Permissions

| 权限 | 用途 |
| --- | --- |
| `localFileSystem: fullAccess` | 临时文件与诊断报告读写 |
| `launchProcess` | 打开外部链接(如打赏二维码) |
| `network` | 访问 RunningHub API 与资源域名 |

<a name="structure"></a>
## 项目结构 / Project Structure

```text
.
├─ index.html             # 面板 UI 结构
├─ index.js               # 启动与控制器初始化
├─ style.css              # UI 样式
├─ plans/                 # 重构与审查计划文档
├─ scripts/               # 预检与静态检查脚本
├─ src/
│  ├─ application/        # 用例与应用服务（编排层）
│  ├─ controllers/        # 工作台 / 设置 / 工具箱控制器（展示层）
│  ├─ diagnostics/        # 环境诊断
│  ├─ domain/             # 纯策略与规则
│  ├─ infrastructure/     # gateway 适配层
│  ├─ legacy/             # 已下线/历史资产
│  ├─ services/           # RunningHub 与 Photoshop 服务实现
│  └─ shared/             # 输入规范与 DOM 工具
└─ tests/                 # Node 自动化测试
```

### 分层依赖规则（强制）
1. `src/controllers/**/*.js` 禁止直接依赖 `src/services/*`。
2. 控制层访问能力必须经由 `src/application/*` 或 `src/infrastructure/gateways/*`。
3. 检查命令：`node scripts/check-controller-service-deps.js`。
4. 命中违规依赖时，视为发布阻断项，必须先修复后再继续。

<a name="ps-modules"></a>
## PS 模块边界与二开入口 / PS Module Boundaries

| 模块 | 职责边界 | 什么时候改这里 |
| --- | --- | --- |
| `src/services/ps/capture.js` | 选区捕获与图像导出 | 调整“从 PS 获取输入图像”的行为 |
| `src/services/ps/place.js` | 回贴编排与入口策略选择 | 调整“结果放置回画布”的主流程 |
| `src/services/ps/alignment.js` | 几何对齐与智能对齐策略 | 调整智能回贴算法或对齐参数 |
| `src/services/ps/tools.js` | 工具菜单能力（观察层/锐化等） | 新增或修改工具箱按钮对应动作 |
| `src/services/ps/shared.js` | 通用工具函数（超时、数值、策略归一化） | 需要跨 capture/place/tools 复用的纯函数 |
| `src/services/ps.js` | facade 兼容导出层 | 仅做聚合导出，不放业务逻辑 |

### 二开入口约束（强制）
1. 新增工具功能时，优先改 `src/services/ps/tools.js` 与 `src/controllers/tools-controller.js`，再补 UI 按钮。
2. `src/services/ps.js` 的对外函数签名视为稳定契约，禁止随意改名或删除。
3. 若确需变更 facade 契约，必须同步更新：
   - `tests/services/ps/facade.test.js`
   - `src/diagnostics/ps-env-doctor.js`（`REQUIRED_PS_EXPORTS`）
4. 合同测试不通过时，不允许发布。

<a name="smoke-checklist"></a>
## 手工 Smoke Checklist（UXP）

1. 加载插件：用 UXP Developer Tool 加载 `manifest.json`，确认面板可见且不白屏。
2. Workspace 主流程：
   - 打开工作台，选择已保存应用；
   - 捕获选区图像并运行任务；
   - 确认日志有提交/轮询/完成或可读失败信息。
3. Tools 按钮回归：
   - 至少验证 `中性灰图层`、`高斯模糊`、`内容识别填充` 可触发；
   - 无文档/无选区时应给出可读错误提示，不得无响应。
4. Settings 关键链路：
   - API Key 可保存并测试；
   - 应用可解析并保存；
   - 模板可新增和删除。
5. 失败链路：
   - 空 API Key / 非法应用 ID / 网络失败时，界面出现明确提示，不允许静默失败。

<a name="release-guardrails"></a>
## 发布前预检与踩坑规则 / Release Guardrails

### R1（强制）Manifest/入口文件必须 UTF-8 无 BOM
- 适用：`manifest.json`, `index.html`, `index.js`（以及其它入口级脚本）
- 检查命令：

```powershell
@'
const fs = require('fs');
const files = ['manifest.json', 'index.html', 'index.js'];
for (const f of files) {
  const b = fs.readFileSync(f);
  const hasBom = b.length >= 3 && b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF;
  console.log(`${f}: ${hasBom ? 'BOM' : 'no BOM'}`);
}
'@ | node -
```

### R2（强制）启动链路必须容错加载
- 控制器初始化必须在 `DOMContentLoaded` 后执行。
- 可选模块调用前必须做 `typeof fn === "function"` 判定。
- 单模块失败不能拖垮整体启动，至少保留错误日志。

### R3（强制）导出契约与诊断检查保持一致
- `ps` facade 变更时，必须同步更新：
  - `tests/services/ps/facade.test.js`
  - `src/diagnostics/ps-env-doctor.js` 的 `REQUIRED_PS_EXPORTS`

### R4（强制）controller 禁止直连 services
- 规则：`src/controllers/**/*.js` 中不允许出现 `../services/*`（`require`/`import`）依赖。
- 检查命令：`node scripts/check-controller-service-deps.js`
- 处置：发现违规即阻断发布，必须先迁移到 `usecase/application service/gateway`。

### R5（建议）发布前最小预检
1. `node --check index.js src/services/ps.js src/controllers/workspace-controller.js`
2. `node --test tests/services/ps/*.test.js tests/controllers/workspace/*.test.js tests/controllers/settings/*.test.js tests/controllers/tools-controller-init.test.js`
3. `node scripts/check-controller-service-deps.js`
4. 执行 R1 的 BOM 检查

<a name="development"></a>
## 开发与调试 / Development
- 无需构建步骤，直接由 UXP Developer Tool 加载
- 推荐入口：`index.html`, `index.js`, `src/controllers`, `src/application/usecases`, `src/infrastructure/gateways`, `src/services/ps.js`
- 日志查看：使用 UXP Developer Console
- 解析调试：设置页提供 “Load Parse Debug”

<a name="faq"></a>
## 常见问题 / FAQ

<details>
<summary><strong>API Key 无效怎么办</strong></summary>

确认 RunningHub 后台生成的 API Key，账户余额与权限正常。

</details>

<details>
<summary><strong>解析失败怎么办</strong></summary>

尝试不同应用 URL/ID，或查看 Parse Debug 信息。

</details>

<details>
<summary><strong>任务超时怎么办</strong></summary>

提高超时设置或稍后在 RunningHub 任务列表查看。

</details>

<details>
<summary><strong>智能回贴不理想</strong></summary>

切换为 “普通” 策略。

</details>

<details>
<summary><strong>内容识别填充不可用</strong></summary>

确保有有效选区。

</details>

<a name="roadmap"></a>
## 路线图 / Roadmap
- 失败场景的诊断可观测性增强
- 更多 PS 工具与预设

<a name="version"></a>
## 版本 / Version
- 当前版本：`V2.2.1` (见 `manifest.json`)


<a name="release-2-1-1"></a>
## Release 2.2.1
- Moved upload resolution limit entry from workspace header to Settings > Advanced.
- Default upload resolution policy is now unlimited, with migration for existing settings.
- Added safer upload resize fallback and request timeout handling for task submission stability.
- Fixed modal input occlusion issue (input/select/textarea piercing above overlay).
- Removed log copy button from workspace toolbar (manual copy remains available).
<a name="license"></a>
## 许可 / License
- Apache-2.0

<a name="support"></a>
## 支持与反馈 / Support
- GitHub Issues 或联系 QQ: 1048855084
