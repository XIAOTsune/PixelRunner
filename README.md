# PixelRunner

<p align="center">
  <img src="PixelRunnerV2.4.0/icons/plugin.png" width="96" height="96" alt="PixelRunner logo" />
</p>

<p align="center">
  <strong>面向 Photoshop 的 UXP 修图工作台，将 RunningHub 图像工作流、常用修图工具和辉光预览整合到一个插件面板里。</strong>
</p>

<p align="center">
  <a href="https://github.com/XIAOTsune/PixelRunner/blob/main/LICENSE"><img alt="License" src="https://img.shields.io/badge/license-Apache--2.0-blue"></a>
  <img alt="Version" src="https://img.shields.io/badge/version-2.4.5-2f855a">
  <img alt="Photoshop" src="https://img.shields.io/badge/Photoshop-26.0%2B-31a8ff">
  <img alt="UXP" src="https://img.shields.io/badge/Adobe%20UXP-Manifest%205-ff61f6">
</p>

## 这是什么

PixelRunner（小T修图助手）是一个 Adobe Photoshop UXP 插件。它的目标不是做一个单点按钮，而是把修图过程中经常来回切换的能力放进同一个工作台：

- 在 Photoshop 内捕获当前文档或选区，提交给 RunningHub 图像工作流。
- 管理多个 RunningHub 应用，按应用输入结构动态生成参数表单。
- 保存常用提示词模板和快捷入口，减少重复配置。
- 支持任务提交、轮询、取消、状态追踪和结果自动回贴 Photoshop。
- 内置常用修图动作，例如黑白观察层、中性灰、盖印、模糊、锐化、高反差保留、内容识别填充和选择并遮住。
- 提供辉光预览面板，在插件内调节高光辉光后再写回 Photoshop。
- 支持 AI 优化提示词工作流，用参考图和原始 prompt 生成更适合提交的提示词。

## 项目状态

当前版本：`2.4.5`

这个仓库已经切换到 `UXP Host Shell + WebView UI` 架构，正式源码入口位于：

- `PixelRunnerV2.4.0/src/host-entry.js`
- `PixelRunnerV2.4.0/src/webview-entry.js`
- `PixelRunnerV2.4.0/src/host/`
- `PixelRunnerV2.4.0/src/webview/`

`dist/` 与 `release/` 是构建产物，不进入源码仓库。开发时请修改 `src/`，然后重新构建。

## 功能亮点

### RunningHub 任务工作台

PixelRunner 可以解析并保存 RunningHub 应用，读取应用输入结构后生成对应表单。图像输入可以来自 Photoshop 当前选区或当前文档，文本、数值等参数可以在插件内直接编辑。

任务提交后，插件会在本地显示任务状态，支持并发任务、单任务取消、超时后的状态追踪，并在任务完成后把结果图像贴回 Photoshop。

### 应用与模板管理

设置页内置应用管理和提示词模板管理：

- 保存、修改、删除 RunningHub 应用。
- 通过应用 ID 或链接解析应用信息。
- 搜索、排序已保存应用。
- 保存常用提示词模板。
- 导入、导出、搜索和排序模板。
- 保存快捷入口，将当前应用和非图片参数固化为一键工作流。

### Photoshop 工具箱

工具箱聚合了一组常用修图动作，适合高频 retouch 场景：

- 黑白观察层
- 中性灰图层
- 盖印图层
- 高斯模糊
- 智能锐化
- 高反差保留
- 内容识别填充
- 选择并遮住

这些能力通过 UXP Host 与 Photoshop API/菜单命令桥接执行。

### 辉光预览面板

辉光模块使用插件内预览流程，先捕获图像，在 WebView 中进行辉光预览和参数调节，确认后再生成结果层并写回 Photoshop。它的设计目标是减少大图层反复交换，并让最终效果更接近 Photoshop 中的 Screen 混合结果。

### AI 优化提示词

AI 优化面板可以读取当前工作台中的参考图和主 prompt，通过配置的 RunningHub AI 优化应用返回新的提示词。返回结果不会自动覆盖当前 prompt，需要手动选择替换或追加。

## 目录结构

```text
.
├── LICENSE
├── README.md
├── .gitignore
└── PixelRunnerV2.4.0/
    ├── app.html                 # WebView 主界面
    ├── app.css                  # WebView 样式
    ├── index.html               # UXP Host Shell
    ├── manifest.json            # Adobe UXP 插件清单
    ├── package.json
    ├── package-lock.json
    ├── pages/                   # 独立帮助页面
    ├── icons/                   # 插件图标与界面素材
    ├── video/                   # 提示音等静态资源
    ├── scripts/                 # 构建与打包脚本
    ├── docs/                    # 技术方案和开发记录
    └── src/
        ├── host/                # Photoshop/UXP/RunningHub 桥接能力
        ├── webview/             # UI、状态、任务、模板、辉光等逻辑
        ├── host-entry.js
        └── webview-entry.js
```

## 环境要求

- Node.js 18 或更高版本
- npm
- Adobe Photoshop 26.0 或更高版本
- Adobe UXP Developer Tool
- RunningHub API Key

## 本地开发

进入插件目录：

```bash
cd PixelRunnerV2.4.0
```

安装依赖：

```bash
npm install
```

构建插件 bundle：

```bash
npm run build
```

开发时监听构建：

```bash
npm run build:watch
```

检查 `dist/` 是否与源码同步：

```bash
npm run check:dist
```

生成测试包：

```bash
npm run package:test
```

生成正式发布包：

```bash
npm run package:release
```

## 在 Photoshop 中加载

1. 打开 Adobe UXP Developer Tool。
2. 点击 `Add Plugin`。
3. 选择 `PixelRunnerV2.4.0/manifest.json`。
4. 点击 `Load` 或 `Watch`。
5. 在 Photoshop 中打开插件面板：`Plugins -> Development -> PixelRunner（小T修图助手）`。

首次使用时，在设置页保存 RunningHub API Key。API Key 保存在宿主本地存储中，不应提交到仓库。

## RunningHub 配置

PixelRunner 不内置你的 RunningHub 账号信息。你需要在插件设置页配置：

- `RunningHub API Key`
- 轮询间隔
- 任务超时时间
- 最大并发任务数
- AI 优化应用 ID

应用管理支持输入 RunningHub 应用 ID 或应用链接。解析成功后，插件会保存应用结构，并在工作台生成对应表单。

## 构建产物说明

以下内容不进入 git：

- `node_modules/`
- `dist/`
- `release/`
- `.ccx`、`.zip`、`.tgz` 等打包结果
- 本地 `.env`、日志、编辑器缓存

克隆仓库后执行 `npm install && npm run build` 即可重新生成运行所需的 bundle。

## 开发约定

- 修改功能时优先改 `src/host/` 或 `src/webview/`。
- 不直接编辑 `dist/*.bundle.js`。
- 不把构建包、发布包、依赖目录提交到仓库。
- 涉及 Photoshop 能力的逻辑放在 Host 侧。
- 涉及 UI、状态、表单、任务列表、模板和交互的逻辑放在 WebView 侧。
- 提交前建议至少执行 `npm run build`。

## 安全与隐私

PixelRunner 会请求 Photoshop UXP 所需权限，用于本地文件、WebView、网络请求和打开外部页面。RunningHub API Key 由插件保存在本机 UXP 存储中，仓库不需要也不应该包含任何个人密钥。

开源前请避免提交：

- 真实 API Key、Token、Cookie 或账号凭证。
- 私人调试日志。
- 本地构建包和历史发布包。
- 只在个人机器上有效的绝对路径。

## 许可证

PixelRunner 使用 [Apache License 2.0](LICENSE) 开源。

Copyright 2026 XIAOTsune
