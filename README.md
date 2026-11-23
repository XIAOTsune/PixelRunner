# 像素起子

<p align="center">
  <img src="PixelRunner/icons/icon.png" width="112" height="112" alt="像素起子图标" />
</p>

<h3 align="center">Photoshop 里的 AI 修图工作台</h3>

<p align="center">
  把云端 AI 工作流、局部生成和高频后期工具放进熟悉的 Photoshop 面板。
  <br />从选区输入到结果回贴，尽量留在同一条修图流程里。
</p>

<p align="center">
  <a href="https://github.com/XIAOTsune/PixelRunner/releases"><img alt="仓库版本" src="https://img.shields.io/badge/source-2.9.4-2f855a?style=flat-square"></a>
  <a href="https://github.com/XIAOTsune/PixelRunner/blob/main/LICENSE"><img alt="许可证" src="https://img.shields.io/badge/license-GPL--3.0--only-2563eb?style=flat-square"></a>
  <img alt="Photoshop" src="https://img.shields.io/badge/Photoshop-26.0%2B-31a8ff?style=flat-square">
  <img alt="Adobe UXP" src="https://img.shields.io/badge/Adobe%20UXP-Manifest%205-ff61f6?style=flat-square">
</p>

<p align="center">
  <a href="https://github.com/XIAOTsune/PixelRunner/releases">下载插件</a> ·
  <a href="PixelRunner/pages/runninghub-guide.html">使用指南</a> ·
  <a href="#功能一览">功能一览</a> ·
  <a href="#开发与构建">开发与构建</a>
</p>

---

像素起子从早期的 RunningHub 工作流面板，扩展成覆盖 AI 任务、提示词与资料管理、局部生成和 Photoshop 后期处理的 UXP 工作台。你可以在 Photoshop 中捕获文档或选区，调用云端服务，再把结果作为图层放回当前画布。

## 功能一览

| AI 工作流 | Photoshop 工具 | 提示词与资料 |
| --- | --- | --- |
| RunningHub 国内版与国际版 | AI 返图自动对齐与校色 | 分类提示词预设与收藏 |
| GRS、Aji、Momo、自定义 NewAPI | 创成式填充：RunningHub 或第三方 API | 提示词历史与应用参数记忆 |
| 应用动态表单、选区/文档捕获 | 辉光、空间特效、镜头与后期 | 应用、预设、快捷入口资料包 |
| 并发任务、步骤进度、积分结算与错误诊断 | 观察层、高低频、滤镜与修复 | 导入、导出和切换资料包 |
| 生成结果自动回贴 Photoshop | 社交平台切图与 Photoshop 原生操作 | 应用搜索、排序和一键快捷入口 |

### AI 工作区

- 从 RunningHub 应用 ID 或链接解析输入项，并按应用结构生成动态表单。
- 使用当前选区或整个文档作为输入；任务支持并发、取消、状态追踪和完成提示音。
- 任务卡片提供平台错误码的中文诊断、运行日志与结算信息。RunningHub 任务费用优先使用平台结算，缺少费用时，能单独归属的余额差会标为「估算」。
- 在可用的实时通道上显示当前执行步骤进度。步骤进度不是整项任务的百分比；任务最终状态仍以服务端查询为准。
- GRS 和兼容 Gemini API 的 NewAPI 支持 Aji、Momo 及自定义服务根地址；各渠道可分别保存 API Key 和模型设置。Momo 渠道还支持 Midjourney Imagine。
- 可用已配置的文字模型结合参考图优化提示词，确认结果后再替换或追加到应用输入。

### Photoshop 工具箱

| 工具 | 用途 |
| --- | --- |
| 创成式填充 | 在选区内生成内容，支持 RunningHub 工作流或已配置的第三方图像服务 |
| 对齐与校色 | 将 AI 返图对齐到原区域，并调整明度和色彩融合 |
| 辉光 | 预览高光效果，调节强度、半径、阈值和饱和度后生成图层 |
| 空间特效、镜头与后期 | 预览并应用位移、胶片等图像效果 |
| 图层辅助 | 创建黑白、饱和度、中性灰观察层和高低频图层 |
| 滤镜与修复 | 快速调用模糊、锐化、高反差保留、内容识别填充、选择并遮住等操作 |
| 社交平台切图 | 预览常见平台布局并拆分导出画面 |

辉光、空间特效、镜头与后期、对齐与校色需要本机离线授权。授权状态可在插件设置中查看；其余 Photoshop 原生辅助操作不依赖云端 AI 账号。

### 提示词与资料包

应用、提示词预设和快捷入口可以重复使用，减少每次任务的重复配置：

- 提示词按分类整理，可收藏常用内容，并从历史记录重新使用最近的提示词。
- 快捷入口保存应用和参数，满足选区条件后可直接发起任务。
- 资料包包含应用、提示词分类与预设、快捷入口，支持导入、导出、切换和备份迁移。
- 应用输入值可按设置在切换应用后恢复；RunningHub 国内版与国际版的应用和 API 配置分别保存。

## 使用流程

```text
打开 Photoshop 并加载像素起子
              ↓
选择 RunningHub 应用或第三方图像模型
              ↓
捕获当前选区 / 使用整个文档
              ↓
填写提示词与应用参数并提交
              ↓
跟踪任务、查看诊断和结算信息
              ↓
生成结果回贴 Photoshop，继续校色与修图
```

## 安装

### 使用发布包

仓库当前源码版本为 `2.9.4`；已发布压缩包的版本以 [GitHub Releases](https://github.com/XIAOTsune/PixelRunner/releases) 页面为准。要使用 `main` 上的最新源码，请按下方步骤自行构建。

1. 从 [GitHub Releases](https://github.com/XIAOTsune/PixelRunner/releases) 下载插件压缩包并解压。
2. 安装并打开 Adobe UXP Developer Tool。
3. 选择 **Add Plugin**，载入解压目录根部的 `manifest.json`，然后点击 **Load**。
4. 在 Photoshop 的 **Plugins → Development → 像素起子** 中打开面板。
5. 在设置中配置所需的 RunningHub 或第三方 API，再添加应用或选择模型。

### 从源码构建

需要 Adobe Photoshop 26.0+、Adobe UXP Developer Tool、Node.js 18+ 和 npm。

```bash
git clone https://github.com/XIAOTsune/PixelRunner.git
cd PixelRunner/PixelRunner
npm install
npm run build
```

然后在 UXP Developer Tool 中载入 `PixelRunner/manifest.json`。

## 服务与数据

- RunningHub 国内版与国际版是独立配置；API Key、应用和任务区域按所选站点分别处理。
- API Key 保存在本机 UXP 存储中。提交云端任务时，当前任务所需的图片和参数会发送到所选服务。
- RunningHub 账户积分来自 `remainPoint`。任务卡片可用「查扣费」重新查询原任务。并发任务共享一段余额变化且有多笔未知费用时，卡片保留平台未返回扣费的状态。
- 实时进度只显示有效的当前步骤数据；没有可用进度时显示不定进度，不估算总百分比或剩余时间。

详细说明：[RunningHub 使用指南](PixelRunner/pages/runninghub-guide.html) · [区域与账户字段](PixelRunner/docs/runninghub-regions.md) · [进度与隐私边界](PixelRunner/docs/runninghub-progress-privacy.md)

## 开发与构建

在 `PixelRunner/` 目录运行：

```bash
npm install
npm run build                 # 构建 UXP 插件 bundle
npm run build:watch           # 监听源码并持续构建
npm test                      # 运行完整测试
npm run package:test          # 构建测试包
npm run package:release       # 构建正式发布包
```

源码入口为 `src/host-entry.js` 和 `src/webview-entry.js`；Photoshop 与服务桥接位于 `src/host/`，界面和工作区功能位于 `src/webview/`。`dist/` 为构建产物，不直接编辑。

## RunningHub 合作

<p align="center">
  <a href="https://www.runninghub.ai/zh-cn/call-api?source=github">
    <img src="runninghub合作/logo.png" width="150" alt="RunningHub Logo" />
  </a>
</p>

## 赞助支持 · SPONSOR

### RunningHub API

Access 400+ leading AI models via API — Seedance, Kling, MiniMax, Nano Banana, Veo, and more — at highly competitive prices.

- High-Concurrency Support
- Free API Testing
- End-to-End Encryption

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
  本项目由 <a href="https://www.runninghub.ai/zh-cn/call-api?source=github">RunningHub</a> 提供支持 · 单一接口直连 400+ 主流大模型 · 免费测试
</p>

## 常见问题

### 像素起子是独立软件吗？

不是。它是 Photoshop UXP 插件，需要通过 Photoshop 和 UXP Developer Tool 加载。

### 使用插件必须有 RunningHub 账号吗？

只有 RunningHub 工作流需要 RunningHub API Key。第三方 AI 任务需要对应服务的 API Key；Photoshop 原生工具不依赖在线 AI 服务。

### API Key 会上传到项目服务器吗？

插件没有项目自有的中转服务器。API Key 保存在本机 UXP 存储，并由插件用于请求你配置的服务。提交云端任务时，图像会发送给所选服务。

### 插件为什么需要 Photoshop 26.0 以上版本？

当前 UXP manifest 声明的最低 Photoshop 版本为 26.0.0。

## 许可证

像素起子以 [GNU General Public License v3.0](LICENSE) 开源（`GPL-3.0-only`）。

Copyright 2026 XIAOTsune
