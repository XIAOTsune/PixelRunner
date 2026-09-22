# 像素起子 · Photoshop AI 修图工作台

<p align="center">
  <img src="PixelRunner/icons/icon.png" width="128" height="128" alt="像素起子图标" />
</p>

<h2 align="center">把 RunningHub AI 工作流，直接带进 Photoshop</h2>

<p align="center">
  在熟悉的 Photoshop 面板里完成选区捕获、AI 任务提交、进度追踪与结果回贴。
  <br />少一次窗口切换，多一点创作专注。
</p>

<p align="center">
  <a href="https://github.com/XIAOTsune/PixelRunner/releases"><img alt="Version" src="https://img.shields.io/badge/version-2.8.4-2f855a?style=for-the-badge"></a>
  <a href="https://github.com/XIAOTsune/PixelRunner/blob/main/LICENSE"><img alt="License" src="https://img.shields.io/badge/license-Apache--2.0-2563eb?style=for-the-badge"></a>
  <img alt="Photoshop" src="https://img.shields.io/badge/Photoshop-26.0%2B-31a8ff?style=for-the-badge">
  <img alt="UXP" src="https://img.shields.io/badge/Adobe%20UXP-Manifest%205-ff61f6?style=for-the-badge">
</p>

<p align="center">
  <a href="#它能做什么">功能亮点</a> ·
  <a href="#一条顺手的-ai-修图链路">工作流</a> ·
  <a href="#快速开始">快速开始</a> ·
  <a href="#项目结构">项目结构</a> ·
  <a href="#赞助支持--sponsor">赞助支持</a> ·
  <a href="#runninghub-合作">RunningHub 合作</a>
</p>

---

## 为什么是像素起子？

AI 修图真正耗时的部分，常常不是生成本身，而是反复导出、上传、等待、下载、对齐，再回到 Photoshop 继续工作。

像素起子把这条链路收进一个 UXP 面板：当前文档或选区可以直接成为输入，RunningHub 负责执行图像工作流，结果完成后自动回到 Photoshop。你可以把它理解成一把连接 **Photoshop × RunningHub × 日常修图工具** 的工作台。

| 传统流程 | 像素起子工作流 |
| --- | --- |
| 导出图片，切到网页上传 | 在 Photoshop 内捕获当前选区或文档 |
| 手动复制应用参数和提示词 | 保存应用、模板和快捷入口 |
| 反复刷新页面查看进度 | 在任务卡片中查看状态、日志和失败原因 |
| 下载结果，再拖回并重新对齐 | 任务完成后自动贴回 Photoshop |
| AI 工具和修图动作分散 | AI 工作台、观察层、锐化、辉光预览集中在同一面板 |

## 它能做什么

### RunningHub 工作台

从应用解析到结果回贴，完整覆盖一次 AI 修图任务：

- 通过应用 ID 或链接解析 RunningHub 应用输入项
- 按应用结构生成图片、文本、数字等动态表单
- 捕获 Photoshop 当前选区或整个文档
- 提交任务、显示运行状态、取消任务、追踪超时
- 支持多任务并发，完成后自动把结果贴回 Photoshop

### 把常用流程保存下来

一次配置，之后重复使用：

- **应用管理**：保存、搜索、排序和维护常用 RunningHub 应用
- **提示词模板**：沉淀人像、产品、局部重绘、风格化和画质增强 prompt
- **快捷入口**：固定应用与参数，框选区域后即可一键运行
- **导入导出**：备份模板、应用与快捷入口，方便迁移和分享

### AI 与 Photoshop 工具并行工作

像素起子不只负责提交 AI 任务，也把高频后期动作放在手边：

| 模块 | 适合做什么 |
| --- | --- |
| AI 优化提示词 | 结合参考图优化 prompt，确认后替换或追加 |
| 黑白观察层 | 检查明暗、结构和画面脏点 |
| 中性灰图层 | 辅助 Dodge & Burn |
| 盖印、模糊、锐化 | 快速进入常见后期处理 |
| 内容识别填充、选择并遮住 | 调用 Photoshop 原生能力 |
| 辉光预览 | 调节强度、半径、阈值和饱和度后再写回图层 |

## 一条顺手的 AI 修图链路

```text
打开 Photoshop
      ↓
加载像素起子
      ↓
保存 RunningHub API Key
      ↓
添加或解析一个 AI 应用
      ↓
框选区域 / 使用当前文档
      ↓
填写 prompt 与参数
      ↓
提交任务并查看进度
      ↓
结果自动回到 Photoshop
```

## 适合谁

| 角色 | 使用方式 |
| --- | --- |
| 修图师 | 把局部重绘、细节增强、风格化处理接入现有修图流程 |
| 摄影后期 | 在 Photoshop 内完成捕获、返图、观察和基础后期 |
| AI 绘图用户 | 保存应用、参数和 prompt，减少重复输入 |
| RunningHub 用户 | 将网页工作流变成可复用的 Photoshop 面板 |
| 插件开发者 | 参考 UXP Host + WebView + RunningHub 桥接架构 |

## 快速开始

### 环境要求

- Adobe Photoshop 26.0 或更高版本
- Adobe UXP Developer Tool
- Node.js 18 或更高版本
- npm
- RunningHub API Key

### 获取并构建

```bash
git clone https://github.com/XIAOTsune/PixelRunner.git
cd PixelRunner/PixelRunner
npm install
npm run build
```

### 在 Photoshop 中加载

1. 打开 Adobe UXP Developer Tool。
2. 点击 `Add Plugin`，选择 `PixelRunner/manifest.json`。
3. 点击 `Load` 或 `Watch`。
4. 在 Photoshop 中打开 `Plugins -> Development -> 像素起子`。
5. 在插件设置中保存 RunningHub API Key，添加一个应用 ID 或应用链接。

更完整的 RunningHub 配置、区域选择、余额和故障排查说明，见 [RunningHub 使用文档](PixelRunner/pages/runninghub-guide.html)。

## 项目结构

```text
.
├── README.md                         # 项目展示与使用说明
├── LICENSE
├── runninghub合作/                   # 合作文案与品牌素材
└── PixelRunner/
    ├── manifest.json                 # Adobe UXP 插件清单
    ├── index.html                    # UXP Host 入口
    ├── app.html / app.css            # WebView 界面
    ├── icons/                        # 插件图标与界面资源
    ├── pages/                        # 独立帮助页面
    ├── docs/                         # 技术说明与专题文档
    ├── scripts/                      # 构建、测试与打包脚本
    ├── local-ai/                     # 本地 AI 放大能力与运行时
    └── src/
        ├── host/                     # Photoshop、UXP、RunningHub 桥接
        ├── webview/                  # UI、状态、任务、模板与效果
        ├── host-entry.js
        └── webview-entry.js
```

## 开发与构建

所有命令在 `PixelRunner/` 目录执行：

```bash
npm install
npm run build                 # 构建插件 bundle
npm run build:watch           # 监听源码并持续构建
npm run check:dist            # 检查构建产物同步状态
npm test                      # 运行项目测试
npm run package:test          # 生成测试包
npm run package:release       # 生成正式发布包
```

开发约定：

- 源码入口是 `src/host-entry.js` 和 `src/webview-entry.js`。
- Photoshop、UXP、RunningHub 相关桥接代码位于 `src/host/`。
- UI、任务、模板、快捷入口和效果模块位于 `src/webview/`。
- 不直接编辑 `dist/*.bundle.js`。
- `node_modules/`、`dist/`、`release/` 和本地打包文件不提交到仓库。

## RunningHub 合作

<p align="center">
  <a href="https://www.runninghub.ai/zh-cn/call-api?source=github">
    <img src="runninghub合作/logo.png" width="150" alt="RunningHub Logo" />
  </a>
</p>

RunningHub API 为生产环境而设计，提供一个接口驱动的全模态 AI 生产力平台。无需管理多个服务商，即可通过单一 API 接入 400+ 主流大模型，生成图片、视频和其他 AI 内容。

平台支持 ComfyUI 工作流免运维托管、按需弹性计量、细粒度权限控制与全链路加密。像素起子通过 RunningHub 将 AI 图像工作流接入 Photoshop，让创作者可以在熟悉的修图环境中完成素材提交、任务追踪和结果回贴。

RunningHub API is built for production. Access 400+ leading AI models through one API to generate images, videos, and more. It also provides managed ComfyUI workflows, usage-based pricing, fine-grained access control, and end-to-end encryption for reliable and secure AI production.

<p align="center">
  <a href="https://www.runninghub.ai/zh-cn/call-api?source=github"><strong>访问 RunningHub API 官方页面</strong></a>
  ·
  <a href="mailto:zhenyuedong@haima.me"><strong>获取折扣与接入支持</strong></a>
</p>

## 赞助支持 · SPONSOR

### RunningHub API

Access 400+ leading AI models via API — Seedance, Kling, MiniMax, Nano Banana, Veo, and more — at highly competitive prices.

- High-Concurrency Support
- Free API Testing
- End-to-End Encryption

<p align="center">
  <a href="https://www.runninghub.ai/zh-cn/call-api?source=github"><strong>CTA：Test the API for Free</strong></a>
</p>

RunningHub 为本项目提供 AI 能力支持：

- Seedance 满血版 API 接入全网骨折价，在线工具低至 0.21 元/秒，节省 60%-80% 成本
- 超稳定高并发高折扣，随用随充、按需弹性付费，不捆绑、不排队、不抽卡
- 无限画布、ComfyUI、Agent 等在线工具，支持从剧本到成片的全链路制作
- 一站式接入 LLM API、多模态 API、工作流 API、AI 应用
- 400+ 主流模型，支持国际版权限，8000+ 版本任选
- 数千家企业信赖，500 万 C 端月活验证

<p align="center">
  <strong>RunningHub 折扣获取与免费测试联系：</strong>
  <a href="mailto:zhenyuedong@haima.me">zhenyuedong@haima.me</a>
</p>

<p align="center">
  本项目由 RunningHub 提供支持 · 单一接口直连 400+ 主流大模型 · 免费测试
  <br />
  <a href="https://www.runninghub.ai/zh-cn/call-api?source=github">https://www.runninghub.ai/zh-cn/call-api?source=github</a>
</p>

## 隐私与安全

RunningHub API Key 保存在本机 UXP 存储中，用于提交任务和查询状态。请不要将 API Key、Token、Cookie、私人调试日志或本地绝对路径提交到仓库。

## 常见问题

### 像素起子是独立软件吗？

不是。像素起子是 Photoshop UXP 插件，需要在 Photoshop 和 UXP Developer Tool 中加载。

### 必须有 RunningHub 账号吗？

使用 AI 工作流提交、任务查询和结果回贴需要 RunningHub API Key。工具箱中的部分 Photoshop 辅助能力不依赖 RunningHub。

### 为什么仓库里没有 dist？

`dist/` 是构建产物，执行 `npm run build` 即可重新生成。仓库保留源码、资源、脚本和文档，便于维护。

## 路线方向

- 更清晰的新手引导与任务诊断
- 更完善的提示词历史和工作流分享
- 更强的辉光预览与 GPU 加速体验
- 更稳定的本地 AI 能力和跨服务商配置

## 许可证

像素起子使用 [Apache License 2.0](LICENSE) 开源。

Copyright 2026 XIAOTsune
