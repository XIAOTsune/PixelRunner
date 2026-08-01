# PixelRunner：从 Photoshop UXP 插件迁移为桌面应用的可行性分析

---

## 1. 当前架构概览

PixelRunner 是一个 **Photoshop UXP（Unified Extensibility Platform）面板插件**，其架构分为三层：

### 1.1 WebView 层（UI 层）
- **路径**: `PixelRunner/src/webview/`（约 28 个模块文件）
- **技术栈**: 纯 HTML + CSS + JavaScript + WebGL
- **职责**:
  - UI 渲染与交互（`app.html` + `app.css`，约 6844 行 CSS）
  - AI 应用管理（`apps.js`，1240 行）
  - 工作台逻辑（`workspace.js`，3697 行）
  - 发光效果（`glow/` 目录，含 WebGL 着色器）
  - 混合匹配（`blend-match/`，含 WebGL GPU 对齐）
  - 空间特效（`space-fx.js`，1759 行）
  - 生成式填充（`generative-fill.js`，824 行）
  - AI 优化提示词（`ai-optimize.js`，1177 行）
  - 本地超分（`local-upscale.js`）
  - 设置、许可、状态管理等

### 1.2 Host 层（后端层）
- **路径**: `PixelRunner/src/host/`（约 12 个模块文件）
- **技术栈**: JavaScript（运行在 UXP Host 上下文）
- **职责**:
  - **消息桥接**（`bridge.js` + `main.js` 的 switch-case 分发）
  - **Photoshop API 调用**（`photoshop-bridge.js`、`photoshop/service.js`——2529 行）
  - **RunningHub AI 服务集成**（`runninghub.js`，1980 行）
  - **GRS 第三方 AI 集成**（`third-party-grs.js`，952 行）
  - **本地超分引擎通信**（`local-upscale.js`，194 行）
  - **文件系统操作**（`files.js`——依赖 `require("uxp").storage`）
  - **Shell 操作**（`shell.js`——依赖 `require("uxp")` + `require("os")`）
  - **许可校验**（`license-enforcement.js`）

### 1.3 本地 AI 服务
- **路径**: `PixelRunner/local-ai/`
- **技术栈**: Python 3.12 + HTTP 服务器
- **职责**: 运行 Real-ESRGAN NCNN Vulkan 进行图片超分
- **特点**: 已 **完全独立** 于 Photoshop，是独立的本地 HTTP 微服务

---

## 2. Photoshop / UXP 依赖性分析

### 2.1 硬依赖（必须替换）

| 依赖类型 | 涉及文件 | 具体 API | 替换方案 |
|---------|--------|---------|---------|
| **Photoshop DOM** | `photoshop/service.js` (2529行) | `require("photoshop")` → `app.activeDocument`, `batchPlay()` | Sharp / Canvas / WASM 图像处理库 |
| **PS 菜单命令** | `photoshop/commands.js` | `core.getMenuCommandTitle()`, 菜单 ID 扫描 | 替换为本地图像处理算法 |
| **PS 工具动作** | `photoshop/tool-actions.js` (1876行) | 高斯模糊、智能锐化、高反差保留等 | 用 Sharp、OpenCV.js 或 WASM 实现 |
| **PS 文档操作** | `photoshop/document.js` | 文档信息、选区操作、通道操作 | 本地图像文件操作 |
| **PS 图层混合** | `photoshop/blend-match.js` | PS 图层混合模式、融合操作 | 实现独立的图层混合算法 |
| **UXP 文件系统** | `files.js` | `require("uxp").storage.localFileSystem` | Electron: `dialog.showSaveDialog()` / Node.js `fs` |
| **UXP Shell** | `shell.js` | `require("uxp")` 打开 URL、启动进程 | Electron: `shell.openExternal()`, `child_process` |
| **UXP 桥接** | `webview/runtime.js` | `global.uxpHost.postMessage()` | Electron: `ipcRenderer.invoke()` / `ipcMain.handle()` |

### 2.2 部分依赖（需适配）

| 依赖类型 | 涉及文件 | 说明 | 适配方案 |
|---------|--------|------|---------|
| **Plugin 生命周期** | `manifest.json` | UXP 插件面板生命周期 | 应用窗口生命周期（Electron window） |
| **存储** | `localStorage` | 插件浏览器存储 | Electron 同构 localStorage 或扩展 |
| **WebView iframe** | `index.html` | UXP `<webview>` 标签 | Electron `<webview>` 或 BrowserView |
| **多进程通信** | `runtime.js` | 请求-响应模式 | Electron IPC 直接复用 |

### 2.3 零依赖（可直接复用）

| 模块 | 文件 | 可复用程度 |
|------|------|-----------|
| **所有 WebView UI 代码** | `webview/*.js` + `app.html` + `app.css` | **100% 复用**（几乎不需改动） |
| **RunningHub 集成** | `runninghub.js` + `runninghub-parser.js` | **100% 复用**（纯 HTTP API） |
| **GRS 第三方 AI 集成** | `third-party-grs.js` | **100% 复用**（纯 HTTP API） |
| **WebGL GPU 着色器** | `webview/glow/gpu/*.js` | **100% 复用** |
| **WebGL 混合匹配** | `webview/blend-match/gpu/*.js` | **100% 复用** |
| **空间特效逻辑** | `webview/space-fx.js` | **100% 复用** |
| **许可系统** | 全部 `license-*` 及 `shared/license-*` | **90% 复用**（仅需调整存储后端） |
| **本地 AI 服务** | `local-ai/` 全部 | **100% 复用**（已独立） |

---

## 3. 迁移为桌面应用的技术路线

### 3.1 推荐框架：**Electron**

**理由：**
- 当前 WebView 代码是 **纯 HTML/CSS/JS** → Electron renderer 可直接加载 `app.html`
- Host 层是 **JavaScript** → Electron main process 可直接复用
- 消息传递模式（`callHost`→`postMessage`→`onmessage`）→ 可直接映射到 `ipcRenderer.invoke`/`ipcMain.handle`
- Node.js 生态完备（文件系统、子进程管理、FFmpeg 绑定等）
- WebView 中的 WebGL 内容在 Electron 中完美兼容

**备选框架：Tauri**（Rust 后端）
- 更小的打包体积和更好的性能
- 但需要将 Host 层 JS 逻辑翻译为 Rust
- 对于视频编码场景，Tauri + Rust 可能有更好的性能

### 3.2 架构对应关系

```
UXP Plugin (当前)                    Desktop App (迁移后)
─────────────────                    ────────────────────
app.html (WebView)          ──→     Electron Renderer (加载 app.html)
webview/*.js (UI Modules)   ──→     Renderer Process (同)
index.html (宿主)            ──→     Electron Main Window
uxpHost.postMessage()       ──→     ipcRenderer.invoke() / send()
host/main.js (桥接处理)      ──→     ipcMain.handle() / main process
host/photoshop/*.js (PS API)──→     本地图像处理库
host/runninghub.js           ──→     main process (不变)
host/local-upscale.js        ──→     main process (不变)
local-ai/server.py           ──→     保持不变 (子进程启动)
require("uxp")               ──→     Node.js 原生模块
manifest.json (插件配置)     ──→     Electron package.json + window config
```

### 3.3 图像处理替换方案

Photoshop 特有的图像操作需要替换为独立方案：

| PS 功能 | 替换方案 |
|--------|---------|
| **文档打开/保存** | Electron dialog + Node.js fs + Sharp |
| **图层系统** | 自建图层堆栈数据结构 + 图像合成 |
| **选区/蒙版** | 用 Sharp 或 Canvas API 实现通道操作 |
| **高斯模糊** | StackBlur WASM 或 Canvas API |
| **智能锐化** | 用 Sharp 或 OpenCV.js 实现 |
| **高反差保留** | 用 WebGL 或 Canvas 实现 |
| **混合模式** | 实现标准 Photoshop 混合模式算法（正片叠底、滤色、叠加等） |
| **色阶/曲线** | 用 Canvas ImageData 或 WebGL 实现 |
| **内容识别填充** | 复用 RunningHub AI 服务 |

---

## 4. 视频生成能力的引入

这是迁移为桌面应用后新增的核心能力，当前的插件架构完全无法实现。

### 4.1 视频生成管线设计

```
输入图片
    │
    ▼
┌─────────────────────┐
│  AI 帧生成（新增）   │ ← RunningHub 或其他视频 AI 模型
│  - 图生视频模型      │    （如 Stable Video Diffusion,
│  - 帧间插值          │      Runway Gen-3, Pika, CogVideo）
│  - 关键帧动画        │
└─────────┬───────────┘
          │ 帧序列（PNG 序列）
          ▼
┌─────────────────────┐
│  后处理管线（新增）   │
│  - 帧一致性增强      │
│  - 超分/降噪         │ ← 复用 local-ai 服务
│  - 调色/光效         │ ← 复用 WebGL glow/space-fx
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│  视频编码（新增）     │ ← FFmpeg 或 WASM 编码器
│  - MP4 / WebM / GIF  │
│  - 可选带音频        │
│  - 导出设置 UI       │
└─────────────────────┘
```

### 4.2 视频 AI 模型集成方式

| 方式 | 说明 | 复杂度 |
|------|------|--------|
| **RunningHub API** | 已有的 RunningHub 平台已有视频生成类应用 | **低**（最直接） |
| **本地 AI 视频模型** | 集成本地 Stable Video Diffusion 等 | **中高**（需 GPU） |
| **第三方 API** | Runway ML / Pika Labs / Haiper 等 | **中**（添加新 HTTP 客户端） |

### 4.3 视频编码方案

| 方案 | 优点 | 缺点 |
|------|------|------|
| **FFmpeg（子进程）** | 功能最全，格式支持最广 | 需要分发 FFmpeg 二进制 |
| **@ffmpeg/wasm** | 无需分发二进制 | 编码速度较慢，体积大 |
| **fluent-ffmpeg (Node)** | API 友好 | 同样依赖 FFmpeg 二进制 |

---

## 5. 迁移复杂度评估

### 5.1 代码复用率估算

| 层级 | 总计代码量（估算） | 可直接复用 | 需修改 | 需重写 |
|------|-------------------|-----------|--------|--------|
| WebView UI | ~22,000 行 | **95%** | 5% | 0% |
| Host 逻辑 | ~6,500 行 | **50%** | 25% | 25% |
| 共享层 | ~2,000 行 | **90%** | 10% | 0% |
| Local AI | ~1,200 行 | **100%** | 0% | 0% |
| **合计** | **~31,700 行** | **~80%** | **~12%** | **~8%** |

### 5.2 各功能模块迁移代价

```
模块                  迁移代价    说明
────────────────────── ────────  ────────────────────────────
UI 框架 (app.html/css)  🟢 低    Electron renderer 直接加载
WebView JS 模块         🟢 低    仅需修改 IPC 调用方式
RunningHub 集成         🟢 低    纯 HTTP，无需改动
Local AI 超分           🟢 低    已有独立服务，复用
WebGL 特效              🟢 低    在 Electron 中完美运行
许可系统                🟡 中    调整存储后端
文件操作                🟡 中    UXP API → Electron/Native API
PS 桥接层               🔴 高    替换为本地图像处理
PS 滤镜/工具动作         🔴 高    需要独立算法实现
PS 图层混合              🔴 高    需要独立图层引擎
视频生成管线             🆕 新增   全新开发
视频编码                🆕 新增   全新开发
```

### 5.3 推荐迁移策略：**渐进式迁移**

```
阶段 1：桌面化封装（MVP）
├── 用 Electron 包装现有代码
├── 替换 UXP/Photoshop API 为本地图像处理
├── 保持现有所有功能可工作
└── 预计工作量：3-4 周

阶段 2：核心功能增强
├── 实现本地图像处理管线（替代 PS 滤镜）
├── 优化 UI 适应桌面窗口
├── 添加批量处理能力
└── 预计工作量：4-6 周

阶段 3：视频能力上线
├── 集成 RunningHub 视频 AI 模型
├── 实现帧序列管理
├── 集成 FFmpeg 视频编码
├── 视频预览播放器
└── 预计工作量：4-6 周

阶段 4：桌面原生体验
├── 系统托盘、自动更新
├── 快捷键、拖拽交互
├── 插件扩展系统
├── 作品集管理
└── 预计工作量：2-4 周
```

---

## 6. 核心风险与缓解措施

| 风险 | 等级 | 缓解措施 |
|------|------|---------|
| **Photoshop 特效无法完美替代** | 🔴 高 | 优先支持 AI 相关功能（AI 本身就是核心价值），PS 滤镜作为"锦上添花"；WebGL 已承载预览渲染 |
| **用户习惯迁移阻力** | 🟡 中 | 保留一致的 UI 布局和交互；提供单独的"导出到 Photoshop"选项 |
| **视频模型质量不确定性** | 🟡 中 | 从 RunningHub 已有视频应用切入，降低风险；逐步集成更多模型 |
| **性能开销（Electron）** | 🟢 低 | Electron 对于图像/视频编辑场景的资源占用可控；计算密集型任务可派发到子进程（Python/WASM） |
| **打包体积** | 🟢 低 | 初期可与 UXP 插件共存；仅 LLM 和模型文件占空间 |

---

## 7. 关键结论

### ✅ 技术上完全可行
- **~80% 的现有代码可以直接复用**
- 核心业务逻辑（AI 服务集成、WebGL 特效、许可系统）全部 **不依赖 Photoshop**
- 本地 AI 服务 **已经独立**，迁移零成本
- Electron 的架构与当前 UXP 架构 **高度相似**，适配成本可控

### ✅ 迁移到桌面应用能带来显著的新能力
- **视频生成是本次迁移的最大价值**——这是 Photoshop 插件无法做到的
- 独立应用可绕开 UXP 的沙箱限制，获得完整的文件系统、进程管理和 GPU 访问权限
- 可集成 FFmpeg 等第三方工具进行视频编码

### ⚠️ 需要正视的挑战
- **Photoshop 专属图像处理功能**（约 2500 行 PS API 调用）需要替换为独立方案
- 但核心 AI 相关功能不受影响，用户的剪辑师工作流（通过 RunningHub 发 AI 任务→接收结果→后期）基本不受影响
- **建议保留"导出到 Photoshop"能力**，让用户需要深度 PS 编辑时仍能无缝切换

### 🎯 建议
**先从"桌面版封装"开始**，将现有插件打包为 Electron 应用，快速验证桌面化架构可行，然后逐步叠加视频生成能力。这种做法风险最低，且每一步都有可交付的成果。