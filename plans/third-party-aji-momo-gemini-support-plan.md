# PixelRunner Aji / Momo Gemini 兼容渠道接入计划

日期：2026-08-01  
状态：提案，待评审后实施

## 1. 目标

在现有 PixelRunner 的“第三方支持”中保留 GRS 生图能力，同时接入 Aji 与 Momo 两个 Gemini-compatible 渠道，使用户能在 Photoshop 工作台内完成：

- 文生图、图生图与参考图生图。
- 提示词 AI 优化。
- 渠道级 API Key、模型列表和默认模型配置。
- 同步取得 Gemini 返图并自动贴回 Photoshop。

首发只支持以下预设渠道：

| ID | 显示名称 | Base URL | 协议类型 |
| --- | --- | --- | --- |
| `aji` | 阿吉 Aji | `https://ai.ajiai.top` | Gemini-compatible |
| `momo` | 墨墨 Momo | `https://api.momoapi.icu` | Gemini-compatible |

本计划不替换、不迁移、不删除当前 GRS 配置与运行链路。

## 2. 调研结论

### 2.1 HHPS 的实现边界

调研源码：`C:\Users\fxy\Desktop\2026.4.25HHPS源码`。

HHPS 没有为 Aji 和 Momo 分别实现独立 API 适配器；两者被定义为 Gemini 渠道预设：

- `src/components/settings/constants.js`：定义 Aji、Momo 的 URL、显示名和 Key 获取链接。
- `src/controllers/network/gemini.js`：模型发现、文本/视觉请求和 Gemini 响应解析。
- `src/controllers/APIClient.js`：生图请求构建与 `inlineData` 返图解析。
- `plugin/host/bridgeHandlers.js`：在 UXP Host 内请求 Gemini，并将 Base64 图片写入宿主临时文件，避免大图穿过 WebView 消息通道。

其共用的 Gemini-compatible 协议如下：

| 能力 | 请求 | 鉴权 | 关键响应 |
| --- | --- | --- | --- |
| 模型发现 | `GET /v1beta/models` | `Authorization: Bearer <key>` | `models[].name`，可能带 `models/` 前缀 |
| 生图/视觉 | `POST /v1beta/models/{model}:generateContent` | 同上 | `candidates[].content.parts[].inlineData` |
| 文本优化 | 与生图相同的 `generateContent` | 同上 | `candidates[].content.parts[].text` |
| 余额探测（可选） | `GET /api/usage/token` | 同上 | 渠道服务自定义的余额字段 |

与 Google 官方 Gemini 不同，预设中转渠道通过 `Authorization: Bearer` 传递 Key；Google 官方才通过 `?key=` 查询参数。首发只实现中转渠道鉴权，不把 Google 官方渠道纳入本次范围。

### 2.2 Gemini 生图的请求和结果特点

Gemini-compatible 生图是同步请求，不需要 GRS 那种“提交任务 -> 轮询远端 taskId -> 下载 URL”的协议。基本请求体为：

```json
{
  "contents": [
    {
      "role": "user",
      "parts": [
        { "text": "提示词" },
        { "inlineData": { "mimeType": "image/png", "data": "..." } }
      ]
    }
  ],
  "generationConfig": {
    "responseModalities": ["TEXT", "IMAGE"],
    "imageConfig": {
      "aspectRatio": "1:1",
      "imageSize": "2K"
    }
  }
}
```

输入图像直接嵌入 `inlineData`，不经过 GRS 的上传 Token/CDN 流程。输出图像通常也是 `inlineData`（也需要兼容 `inline_data`），可转换为 `data:<mime>;base64,...`。

### 2.3 PixelRunner 当前结构

当前第三方实现是 GRS 专用的：

- `src/webview/state.js` 的 `thirdPartySettings` 只有 `grs` 子配置，`provider` 被归一化为 `grs`。
- `src/webview/settings.js` 与 `app.html` 的第三方设置只渲染 GRS 节点、Key、模型、比例和分辨率。
- `src/webview/workspace.js` 的 `buildThirdPartyRunPayload()` 固定生成 `provider: "grs"`。
- `src/host/main.js` 只路由 `thirdParty.grs.*`。
- `src/host/third-party-grs.js` 假设图像必须上传、任务可能异步完成、最终结果是可下载 URL。

现有自动贴回功能支持 URL、`dataUrl` 和 Base64 三种输入，宿主的 `photoshop.placeImageFromUrl()` 已可处理 `dataUrl`。但工作台的 `lastResult.outputUrl` 当前语义更偏向普通 URL，不能把 Gemini 的 Data URL 当作网络地址下载。

## 3. 架构决策

### 3.1 使用供应商适配器，而非向 GRS 适配器追加分支

不建议把 Aji/Momo 逻辑直接塞入 `third-party-grs.js`，也不建议只把它们的 URL 写进 GRS 设置。原因如下：

- GRS 使用专用上传、专用生图端点、远端任务状态与结果查询。
- Aji/Momo 使用 Gemini `generateContent`，同步返回内联图片。
- 两者的模型能力、比例/分辨率约束、提示词优化协议和失败响应结构不同。
- 混用会让 `third-party-grs.js` 的命名、错误处理和取消语义失真，并增加后续接入其他 Gemini-compatible 渠道的成本。

推荐结构：

```text
WebView 设置 / 工作台
        |
        v
thirdPartySettings + provider 路由
        |
        +--> GRS adapter      -> thirdParty.grs.*
        |
        +--> Gemini adapter   -> thirdParty.gemini.*
                  |
                  +--> Aji preset
                  +--> Momo preset
                  +--> future custom preset (not in v1)
        |
        v
统一任务结果 { taskId, outputUrl | dataUrl, ... }
        |
        v
Photoshop 自动贴回
```

### 3.2 同步 Gemini 请求仍复用现有任务生命周期

为避免改写 PixelRunner 的本地队列、运行记录、超时状态和自动贴回体系，Gemini 适配器应遵循现有提交/轮询契约：

1. `submitTask` 调用 Gemini，并在请求完成后生成本地 `gemini-immediate-*` taskId。
2. 将图片结果缓存为 immediate result。
3. `pollTask` 读取该缓存，立即返回 `SUCCEEDED` 和 `dataUrl`。
4. `fetchTaskStatus` 同样可读取该缓存，便于工作台恢复/追踪逻辑统一处理。
5. `cancelTask` 取消本地 `AbortController`；服务端没有可确认的远端取消协议时，不虚报远端取消成功。

这与现有 GRS immediate result 机制一致，但 Gemini 不应被伪装成远端异步任务。

### 3.3 返图传递契约

新适配器返回：

```js
{
  ok: true,
  taskId: "gemini-immediate-...",
  status: "SUCCEEDED",
  dataUrl: "data:image/png;base64,...",
  outputUrl: ""
}
```

工作台结果对象新增或统一使用 `dataUrl`：

- 网络 URL：通过现有 `url` 字段下载后贴回。
- Base64 Data URL：通过 `dataUrl` 字段直接贴回。
- 不允许把 Data URL 写入 `url` 后交给 `fetch()`；这会破坏下载和错误提示逻辑。

为避免 UXP WebView 消息体过大，生产实现应优先让 Host 将 Gemini 图片落到临时文件，再将临时文件路径或可安全消费的宿主引用交给贴回逻辑。若第一阶段先走 Data URL，必须给出载荷上限、失败提示与后续迁移路径。

### 3.4 第三方配置模型

建议在 `src/webview/state.js` 中将配置升级为以下兼容结构：

```js
{
  enabled: false,
  provider: "grs", // grs | gemini
  grs: {
    region: "cn",
    apiUrl: "https://grsai.dakka.com.cn",
    apiKey: "",
    imageModels: [],
    chatModel: "",
    selectedModel: "",
    aspectRatio: "auto",
    resolution: "1K",
    adapter: "grs-image-generate"
  },
  gemini: {
    channelId: "aji", // aji | momo
    apiUrl: "https://ai.ajiai.top",
    apiKey: "",
    imageModels: [],
    chatModel: "",
    selectedModel: "",
    aspectRatio: "auto",
    resolution: "1K"
  }
}
```

归一化规则：

- 不存在 `gemini` 时补齐默认值。
- 缺少/未知 `provider` 时沿用 `grs`，保证旧数据行为不变。
- `channelId` 只允许 `aji` 与 `momo`；根据预设强制回填对应 Base URL，避免错误输入破坏预设。
- GRS 现有 Key 继续保存在兼容 Key `pixelrunner.thirdParty.grs.apiKey`。
- Gemini Key 使用独立存储 Key，例如 `pixelrunner.thirdParty.gemini.apiKey`；完整配置仍写入 `pixelrunner.thirdParty.settings`。

首发使用“每个 Gemini 预设一个 Key”的最小模型。多 Key、Key 轮换、隐藏预设和自定义渠道是后续增强项，不从 HHPS 原样搬运。

## 4. 首发范围与非范围

### 4.1 首发范围

- Aji / Momo 预设切换。
- 独立于 GRS 的 Gemini API Key、图片模型、AI 优化文本模型、默认比例和分辨率。
- 远端 `GET /v1beta/models` 模型发现，并允许因接口失败保留用户已保存的模型。
- 文生图、主图编辑、参考图编辑。
- 使用 Gemini `generateContent` 的 AI 优化文本。
- 请求超时、401/403、429、5xx、内容安全拦截和无图结果的用户可理解错误。
- GRS 旧配置兼容、任务执行和自动贴回回归验证。

### 4.2 明确不在首发范围

- Google 官方 Gemini。
- 自定义 Gemini Base URL。
- 每渠道多 Key、自动 Key 轮换与余额面板。
- 将 `/api/usage/token` 余额探测作为功能前置条件。不同中转站对此接口的支持和响应结构并不稳定。
- SSE/流式生成。首发仅支持普通 JSON `generateContent` 响应。
- 远端 Gemini 任务取消、远端历史任务恢复或远端消费记录链接。
- 从 HHPS 复制其整个 React 设置模块、统计模块或上传会话系统。

## 5. 分阶段实施计划

### 阶段 0：先建立可测契约

目标：让协议解析脱离 UI，先锁定输入和输出。

1. 新建 `src/shared/gemini-config.js`。
2. 定义 `GEMINI_CHANNEL_PRESETS`、`getGeminiChannelPreset()`、URL 归一化和默认模型/比例/分辨率能力。
3. 新建 `scripts/test-third-party-gemini-config.mjs`，覆盖预设查找、配置迁移和无效渠道回退。
4. 将协议辅助函数设计成纯函数并测试：
   - `buildGeminiModelsRequest()`
   - `buildGeminiGenerateRequest()`
   - `parseGeminiModelsResponse()`
   - `parseGeminiTextResponse()`
   - `parseGeminiImageResponse()`
   - `normalizeGeminiFailure()`

完成标准：不需要真实 API Key 即可通过所有请求/响应解析测试。

### 阶段 1：配置和设置界面

目标：用户可安全保存、切换和恢复 GRS/Aji/Momo 配置。

1. 扩展 `src/webview/state.js` 中的默认配置和 `normalizeThirdPartySettings()`。
2. 扩展 `src/webview/settings.js` 的读写、迁移与状态摘要。
3. 在 `app.html` 的“第三方支持”中加入供应商选择控件。
4. 当选择 Gemini 时显示渠道选择（Aji/Momo）、Gemini API Key、模型刷新、默认图片模型、AI 优化模型、比例和分辨率。
5. 当选择 GRS 时保留现有界面和行为，不在 Gemini 控件中混用 GRS 字段。
6. 所有 Key 保持 `type="password"`，只写入宿主本地存储；日志和工作台任务记录继续禁止输出完整 Key。

完成标准：

- 旧 GRS 配置加载后与改造前表现相同。
- Aji/Momo 各自的 Key、模型和默认选择可独立保存与恢复。
- 切换供应商不会清空另一个供应商的已保存配置。

### 阶段 2：Gemini Host 适配器

目标：在 UXP Host 内执行 Gemini 请求，避免浏览器跨域限制。

1. 新建 `src/host/third-party-gemini.js`。
2. 增加 Host 路由：

```text
thirdParty.gemini.submitTask
thirdParty.gemini.pollTask
thirdParty.gemini.fetchTaskStatus
thirdParty.gemini.cancelTask
thirdParty.gemini.listModels
thirdParty.gemini.optimizePrompt
```

3. 图片输入读取 `mainImage`、`referenceImage`，转换为 Gemini `inlineData`。
4. 生图请求携带 `responseModalities: ["TEXT", "IMAGE"]`；仅在用户选择了值时提交 `imageConfig.aspectRatio` 与 `imageConfig.imageSize`。
5. 解析所有候选项中的 `inlineData` 和 `inline_data`，不要只读取第一项。
6. 对当前请求关联 `AbortController`；超时错误和人工取消必须可区分。
7. 将同步图片结果映射为 immediate task cache，并支持统一 poll/fetch 接口。
8. AI 优化请求使用 `generateContent` + `responseModalities: ["TEXT"]`，并复用当前的优化系统提示词。

完成标准：用 mock `fetch` 覆盖模型、文本、内联图片、异常和超时分支。

### 阶段 3：工作台路由和结果贴回

目标：让 Gemini 和 GRS 共享任务体验，但不共享错误的传输语义。

1. 修改 `src/webview/workspace.js` 的 `buildThirdPartyRunPayload()`，按当前 provider 产生 GRS 或 Gemini 负载。
2. 将 `payload.provider === "grs"` 的硬编码判断收敛为 provider descriptor/辅助函数，避免遗漏 `gemini`。
3. 在提交、轮询、后台追踪、取消和任务展示处根据 provider 选择 Host method 与显示名。
4. 将结果对象统一为 `outputUrl` 或 `dataUrl`，并在自动贴回 payload 中正确传递 `url` 或 `dataUrl`。
5. 更新第三方应用卡片和工作台摘要，显示 `GRS`、`阿吉 Aji` 或 `墨墨 Momo` 及当前模型。
6. AI 优化入口根据 provider 调用 GRS chat completion 或 Gemini text adapter。

完成标准：Gemini 成功生图可自动贴回；GRS 的 URL 返回图仍可自动贴回；两者运行记录都能正确显示渠道和失败原因。

### 阶段 4：大图交付路径和回归验证

目标：避免 2K/4K Base64 结果令 WebView 消息桥接不稳定。

1. 在 `third-party-gemini.js` 或 Photoshop Host 服务中，将内联图片写到 UXP 临时文件。
2. 为自动贴回增加可消费的文件输入或受控的宿主文件引用，避免 WebView 持有整张 Base64。
3. 对 Data URL 路径保留小图兼容，但为超限载荷定义明确阈值和错误提示。
4. 执行 `npm test`、`npm run build` 和现有 GRS 专项测试。
5. 使用真实但脱敏的 Aji 与 Momo Key 分别手工验证模型获取、文生图、图生图、AI 优化、失败提示和自动贴回。

完成标准：2K/4K 结果不依赖超大 WebView 消息载荷；构建产物同步检查通过。

## 6. 文件改造清单

| 文件 | 预计改动 |
| --- | --- |
| `src/shared/gemini-config.js` | 新建；预设、默认值和协议无关配置 |
| `src/host/third-party-gemini.js` | 新建；模型、文本、图片、缓存、取消和错误归一化 |
| `src/host/main.js` | 引入 Gemini adapter 并注册 `thirdParty.gemini.*` 路由 |
| `src/webview/state.js` | 扩展第三方配置、迁移、第三方应用表单和 provider 描述 |
| `src/webview/settings.js` | 读取、保存、模型刷新、状态摘要与 Key 存储 |
| `app.html` | 第三方设置中的供应商/渠道/Gemini 表单控件 |
| `app.css` | 与现有 GRS 设置保持一致的切换和字段布局 |
| `src/webview/apps.js` | 第三方卡片的渠道和模型展示 |
| `src/webview/workspace.js` | 负载、Host 路由、任务显示、取消、结果 dataUrl 贴回 |
| `src/webview/ai-optimize.js` | GRS 与 Gemini 的文本优化分派 |
| `scripts/test-third-party-gemini-config.mjs` | 新建；预设、迁移、请求/响应与失败场景测试 |
| `scripts/test-grs-config.mjs` | 必要时追加回归断言，确保 GRS 行为未改变 |

## 7. 验收清单

### 功能验收

- [ ] 老版本仅有 GRS 配置的用户升级后仍可直接运行 GRS。
- [ ] 启用第三方支持后可选择 GRS、阿吉 Aji、墨墨 Momo。
- [ ] Aji 和 Momo 分别保存独立的 Key、模型和默认参数。
- [ ] Gemini 模型列表可从 `/v1beta/models` 获取，且能处理 `models/` 前缀。
- [ ] 选择支持图片的 Gemini 模型后，文生图、主图编辑、参考图编辑均能正确传送 `inlineData`。
- [ ] Gemini 返回 `inlineData` 与 `inline_data` 都能识别。
- [ ] Gemini 返图能正确自动贴回 Photoshop，不会把 Data URL 当 HTTP URL 下载。
- [ ] AI 优化在 GRS 与 Gemini 之间按当前 provider 正确切换。
- [ ] 取消、超时和窗口恢复不会把立即完成的 Gemini 任务误判为远端运行中。

### 错误与安全验收

- [ ] 401/403 显示鉴权失败且不泄露 Key。
- [ ] 429 显示限流/额度提示。
- [ ] 5xx、网络中断和 JSON 格式异常有可理解提示。
- [ ] Gemini 安全拦截能根据 `finishReason`/`blockReason` 显示内容策略提示。
- [ ] 无图片响应时明确报错，不创建空贴回任务。
- [ ] 运行日志、任务历史、异常文本和截图中不输出完整 API Key。

### 工程验收

- [ ] `npm run test:grs` 通过。
- [ ] 新增 Gemini 单元/契约测试通过。
- [ ] `npm test` 通过。
- [ ] `npm run build` 通过。
- [ ] `npm run check:dist` 通过。

## 8. 风险与待确认事项

1. Aji/Momo 是第三方服务，模型名、图片尺寸能力、限流政策和余额接口可能随时变化。模型发现和用户自定义保存值必须优先于硬编码模型清单。
2. 不能仅以 `/api/usage/token` 成功与否判断 Key 有效；该接口在不同服务端可能不存在或额度字段不同。应以模型请求/生成请求的实际响应为准。
3. 单张 2K/4K PNG 的 Base64 可能超过 UXP WebView 消息通道的稳定载荷范围。Host 临时文件路径不是优化项，而是发布前应验证的可靠性要求。
4. Gemini-compatible 中转服务可能只实现部分 Gemini `imageConfig`，或只允许特定模型生图。UI 应允许模型列表保留，但在服务端错误时展示原始、已截断且脱敏的诊断信息。
5. 没有真实 Aji/Momo Key 时，只能验证协议构建与解析，不能确认 2026-08-01 当天的可用模型、配额或服务状态。上线前必须进行两家服务的实测。
6. HHPS 为 Apache-2.0 许可；本计划只提取通用协议与架构思路。实现时应按 PixelRunner 的现有模块组织重写，不复制其 React UI、宿主桥接或无关业务代码。

## 9. 推荐实施顺序

先完成阶段 0 和阶段 1，确保配置迁移和 UI 结构正确；随后完成阶段 2 的 mock 测试与真实请求验证；阶段 3 接入工作台；最后以阶段 4 的大图贴回与回归测试作为合并门槛。

这样可以把高风险点（外部协议、同步返图、Base64 传输）在扩散到整个工作台前隔离验证，同时保持 GRS 现有生产路径稳定。
