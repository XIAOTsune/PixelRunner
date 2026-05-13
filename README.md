# PixelRunner

<p align="center">
  <img src="PixelRunnerV2.4.0/icons/icon.png" width="128" height="128" alt="PixelRunner logo" />
</p>

<h3 align="center">Photoshop 里的 AI 修图工作台</h3>

<p align="center">
  <strong>选区捕获、RunningHub 工作流、提示词模板、AI 优化、常用修图工具、辉光预览，一块面板里全部搞定。</strong>
</p>

<p align="center">
  <a href="https://github.com/XIAOTsune/PixelRunner/blob/main/LICENSE"><img alt="License" src="https://img.shields.io/badge/license-Apache--2.0-blue"></a>
  <img alt="Version" src="https://img.shields.io/badge/version-2.4.5-2f855a">
  <img alt="Photoshop" src="https://img.shields.io/badge/Photoshop-26.0%2B-31a8ff">
  <img alt="UXP" src="https://img.shields.io/badge/Adobe%20UXP-Manifest%205-ff61f6">
  <img alt="RunningHub" src="https://img.shields.io/badge/RunningHub-ready-111827">
</p>

<p align="center">
  <a href="#为什么需要-pixelrunner">为什么需要它</a> ·
  <a href="#核心功能">核心功能</a> ·
  <a href="#快速上手">快速上手</a> ·
  <a href="#开发与构建">开发与构建</a>
</p>

## 一句话介绍

PixelRunner（小T修图助手）是一个面向 Photoshop 的 UXP 插件。它把 Photoshop 和 RunningHub 图像工作流接在一起，让你可以在 PS 里直接框选画面、提交 AI 任务、等待结果、自动贴回图层。

如果你平时要反复做这些事：

- 从 Photoshop 导出局部图像。
- 打开网页或别的工具上传图片。
- 复制粘贴提示词和参数。
- 等任务完成后下载结果。
- 再把图片拖回 Photoshop 对齐。
- 下次换一个工作流，又要重新配一遍。

PixelRunner 想解决的就是这条来回折腾的链路。它把“修图动作”和“AI 工作流”合到 Photoshop 面板里，让创作过程更像一次连续操作，而不是在多个窗口之间搬运素材。

## 为什么需要 PixelRunner

| 以前的流程 | 使用 PixelRunner 后 |
| --- | --- |
| 手动导出选区或整图 | 在 PS 内一键捕获当前选区或文档 |
| 去网页上传图片 | 插件直接提交 RunningHub 工作流 |
| 反复复制提示词 | 模板、快捷入口和应用参数本地保存 |
| 盯着任务状态刷新 | 插件内显示任务进度，可取消和追踪 |
| 下载结果再拖回 PS | 任务完成后自动贴回 Photoshop |
| 常用修图动作分散在菜单里 | 黑白观察、中性灰、盖印、模糊、锐化等集中在工具箱 |
| 辉光效果靠试错 | 先在插件内预览，再确认写回图层 |

## 适合谁

PixelRunner 对这几类用户尤其有用：

| 用户 | 能得到什么 |
| --- | --- |
| 修图师 | 把局部重绘、细节增强、风格化处理接进 Photoshop 工作流 |
| 摄影后期 | 选区捕获、结果回贴、观察层和中性灰等工具集中管理 |
| AI 绘图用户 | 保存常用应用、提示词模板和快捷入口，减少重复输入 |
| RunningHub 用户 | 把网页工作流变成 Photoshop 内的可复用面板 |
| 插件开发者 | 参考 UXP Host + WebView 的插件架构和桥接方式 |

## 核心优势

### 1. 不离开 Photoshop

PixelRunner 的核心体验是“在 PS 里完成 AI 往返”。你可以直接使用当前文档或选区作为输入，任务完成后结果会回到 Photoshop，不需要手动导出、下载、拖拽和重新对齐。

### 2. 小白也能跑工作流

你不需要理解复杂接口。保存 RunningHub API Key 后，把应用 ID 或链接填进插件，PixelRunner 会解析应用输入项，并自动生成表单。该填图片的地方捕获图片，该填文字的地方写提示词。

### 3. 常用配置可以沉淀下来

PixelRunner 不只是“跑一次任务”。它可以保存：

- RunningHub 应用
- 应用参数
- 提示词模板
- 快捷入口
- AI 优化应用 ID
- 并发、轮询、超时等运行设置

这意味着你可以把常用工作流整理成自己的修图工具箱。

### 4. AI 任务状态可见、可控

提交任务后，插件会显示运行状态，支持多任务并发、取消任务、超时追踪和任务完成回贴。比起把任务扔出去之后盲等，PixelRunner 更适合真实生产里的反复试错。

### 5. 修图工具和 AI 工具在同一个面板

修图不是只有 AI。PixelRunner 也内置了一组高频 Photoshop 辅助工具，让你在使用 AI 前后都能快速处理画面。

## 核心功能

### RunningHub 任务工作台

工作台是 PixelRunner 的主场。它负责选择应用、填写参数、捕获图片、提交任务和接收结果。

| 能力 | 说明 |
| --- | --- |
| 应用解析 | 支持通过 RunningHub 应用 ID 或链接解析应用输入结构 |
| 动态表单 | 根据应用输入项自动生成图片、文本、数字等参数表单 |
| 图片捕获 | 可捕获 Photoshop 当前选区或当前文档 |
| 任务提交 | 在插件内提交 RunningHub 图像任务 |
| 状态追踪 | 显示任务运行、成功、失败、超时等状态 |
| 结果回贴 | 任务完成后自动把结果贴回 Photoshop |
| 并发控制 | 支持配置最大并发任务数 |
| 任务取消 | 支持取消进行中的任务 |

### 应用管理

把常用 RunningHub 应用保存起来，之后就不用每次重新找链接、重新填参数。

支持：

- 保存应用
- 修改应用名称和描述
- 删除应用
- 搜索应用
- 排序应用
- 解析应用输入项
- 查看最近一次解析调试信息

### 提示词模板

常用 prompt 可以保存成模板，在工作台中快速插入。

适合保存：

- 人像修图提示词
- 产品图优化提示词
- 局部重绘提示词
- 风格化提示词
- 负向描述
- 常见画质增强描述

模板支持保存、删除、搜索、排序、导入和导出。

### 快捷入口

快捷入口适合把一个常用应用和它的非图片参数固定下来。之后只需要在 Photoshop 里框选区域，点击入口就能跑。

这对于固定工作流很省时间，例如：

- 一键局部精修
- 一键皮肤细节优化
- 一键背景补全
- 一键服装纹理增强
- 一键产品图清理

### AI 优化提示词

PixelRunner 可以使用参考图和当前主 prompt，调用你配置的 RunningHub AI 优化应用，生成更清晰、更适合图像工作流使用的提示词。

它的设计比较克制：AI 返回结果不会自动覆盖原 prompt，而是先展示在弹窗里。你确认之后，可以选择“替换当前”或“追加到当前”。

### Photoshop 工具箱

内置工具箱聚合了一组修图时经常用到的动作：

| 工具 | 用途 |
| --- | --- |
| 黑白观察层 | 快速观察明暗、结构和脏点 |
| 中性灰图层 | 辅助 Dodge & Burn 修图 |
| 盖印图层 | 快速生成当前可见效果图层 |
| 高斯模糊 | 调用 Photoshop 模糊能力 |
| 智能锐化 | 快速进入锐化流程 |
| 高反差保留 | 常见质感和锐化辅助 |
| 内容识别填充 | 调用 Photoshop 原生填充能力 |
| 选择并遮住 | 快速打开原生选区优化面板 |

### 辉光预览面板

辉光模块用于制作高光扩散和梦幻光感。它会先捕获当前图像，在插件内预览辉光效果。你可以调节强度、半径、阈值、饱和度等参数，满意后再应用到 Photoshop。

这个流程的好处是：

- 先预览，再写回。
- 减少大图层反复交换。
- 更容易控制高光范围。
- 结果图层适合在 Photoshop 中继续调整。

## 使用流程

```text
打开 Photoshop
  ↓
加载 PixelRunner 插件
  ↓
在设置页保存 RunningHub API Key
  ↓
添加或解析 RunningHub 应用
  ↓
回到工作台选择应用
  ↓
框选 Photoshop 区域或使用当前文档
  ↓
填写 prompt 和参数
  ↓
提交任务
  ↓
等待结果自动贴回 Photoshop
```

## 快速上手

### 1. 准备环境

你需要：

- Adobe Photoshop 26.0 或更高版本
- Adobe UXP Developer Tool
- Node.js 18 或更高版本
- npm
- RunningHub API Key

### 2. 获取项目

```bash
git clone https://github.com/XIAOTsune/PixelRunner.git
cd PixelRunner/PixelRunnerV2.4.0
```

### 3. 安装依赖并构建

```bash
npm install
npm run build
```

### 4. 在 UXP Developer Tool 中加载

1. 打开 Adobe UXP Developer Tool。
2. 点击 `Add Plugin`。
3. 选择 `PixelRunnerV2.4.0/manifest.json`。
4. 点击 `Load` 或 `Watch`。
5. 在 Photoshop 中打开 `Plugins -> Development -> PixelRunner（小T修图助手）`。

### 5. 第一次使用

1. 打开插件设置页。
2. 填入 RunningHub API Key。
3. 添加一个 RunningHub 应用 ID 或应用链接。
4. 回到工作台选择应用。
5. 在 Photoshop 中框选区域，或使用当前文档作为输入。
6. 填写提示词和参数，提交任务。

## 项目结构

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
        ├── host/                # Photoshop、UXP、RunningHub 桥接能力
        ├── webview/             # UI、状态、任务、模板、辉光等逻辑
        ├── host-entry.js
        └── webview-entry.js
```

## 开发与构建

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

检查构建产物是否与源码同步：

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

## 开发约定

- 正式源码入口是 `src/host-entry.js` 和 `src/webview-entry.js`。
- Photoshop、UXP、RunningHub 相关桥接能力放在 `src/host/`。
- UI、状态、任务列表、模板、快捷入口、辉光预览等逻辑放在 `src/webview/`。
- 不直接编辑 `dist/*.bundle.js`。
- 不提交 `node_modules/`、`dist/`、`release/` 或本地打包文件。
- 修改源码后建议执行 `npm run build`。

## 构建产物说明

以下内容会被 `.gitignore` 忽略：

- `node_modules/`
- `dist/`
- `release/`
- `.ccx`、`.zip`、`.tgz` 等打包结果
- `.env`、日志、编辑器缓存和本地临时文件

克隆仓库后执行 `npm install && npm run build` 即可重新生成运行所需的 bundle。

## 隐私与安全

PixelRunner 不需要你把任何密钥提交到仓库。RunningHub API Key 保存在本机 UXP 存储中，用于向 RunningHub 提交任务和查询状态。

请不要提交：

- 真实 API Key、Token、Cookie 或账号凭证。
- 私人调试日志。
- 本地构建包和历史发布包。
- 只在个人机器上有效的绝对路径。

## 常见问题

### PixelRunner 是独立软件吗？

不是。PixelRunner 是 Photoshop UXP 插件，需要在 Photoshop 和 UXP Developer Tool 中加载。

### 必须有 RunningHub 账号吗？

如果你要使用 AI 工作流提交、任务查询和结果回贴，就需要 RunningHub API Key。工具箱中的部分 Photoshop 辅助能力不依赖 RunningHub。

### 为什么仓库里没有 dist？

`dist/` 是构建产物，可以通过 `npm run build` 重新生成。开源仓库只保留源码、资源、脚本和文档，方便长期维护。

### 小白能用吗？

可以。第一次配置会稍微多一步：安装依赖、构建、用 UXP Developer Tool 加载插件、保存 RunningHub API Key。配置完成后，日常使用主要是在插件面板里选择应用、框选图片、填写提示词和提交任务。

## 路线方向

PixelRunner 会继续围绕一个目标迭代：让 Photoshop 内的 AI 修图流程更顺手。

接下来值得继续增强的方向：

- 更清晰的新手引导。
- 更稳定的任务失败诊断。
- 更完善的 AI 优化提示词历史。
- 更强的辉光预览和 GPU 加速体验。
- 更方便的应用、模板、快捷入口分享方式。

## 许可证

PixelRunner 使用 [Apache License 2.0](LICENSE) 开源。

Copyright 2026 XIAOTsune
