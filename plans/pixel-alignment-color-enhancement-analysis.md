# 像素对齐和校色增强分析

日期：2026-09-23  
分支：`像素对齐和校色增强`

## 结论先行

PixelRunner 的核心价值是把 RunningHub、第三方图像模型和 Photoshop 之间的往返操作压缩成一条可重复的修图链路。这个分支关注的“像素对齐和校色增强”属于结果回贴阶段：模型返图已经生成，但它与原始 Photoshop 图层存在位移、缩放、旋转、局部形变、曝光或色偏时，插件负责把结果变成可以继续编辑的 Photoshop 图层。

当前实现已经具备一套相对完整的 CPU 对齐、共享内容颜色推断、GPU 预览、预览缓存和最终执行复用机制。本分支已把 `ColorPlan` 的 profile 接入 WebView CPU 预览，并让 Host 全分辨率和预览共用同一套颜色函数；下一步重点转向 GPU shader 的 profile 化、ArrayBuffer 传输和对齐候选的进一步加速。

## 插件的使用范围

| 能力 | 入口和代码 | 适用范围 | 不应承担的职责 |
| --- | --- | --- | --- |
| AI 工作流编排 | `src/webview/workspace.js`、`src/host/runninghub.js`、第三方 provider 模块 | 选择应用、上传输入、提交任务、下载结果、回贴 Photoshop | 不替代模型本身的结构重绘能力 |
| 对齐与校色 | `src/webview/blend-match.js`、`src/host/photoshop/blend-match.js` | AI 返图与当前活动图层的几何对齐、颜色融合、羽化、结果层创建 | 不应自动修改用户未选择的图层，不应把低置信度匹配强行套用 |
| 比例偏移修正 | `src/webview/ratio-offset-correction.js` | 方形模型、蒙版、姿态/深度/线稿等坐标关联输入的统一补边 | 不应裁掉原图内容，也不应改变非方形模型的既有比例策略 |
| 本地超分 | `src/webview/local-upscale.js`、`src/host/local-upscale.js` | 结果放大、细节恢复、离线或本地模型处理 | 不负责几何配准和颜色基准建立 |
| 辉光和空间特效 | `src/webview/glow.js`、`src/webview/space-fx.js` | 有明确发光源或设计化光效的后处理 | 不应被当作普通颜色校正使用 |
| 镜头与后期 | `src/webview/post-fx.js`、`capturePhotoshopPostFxPreview` | 胶片、CRT、像素化、风、碎片和镜头类风格效果 | 不应修复模型返图和原图的结构错位 |
| 生成式填充 | `src/webview/generative-fill.js`、Host 侧生成式填充桥接 | 局部扩图、移除、重建和蒙版驱动的内容生成 | 不应通过全局融合掩盖局部生成失败 |

对齐与校色的边界可以概括为：输入是“同一构图或同一主体的两张图”，输出是“能在 Photoshop 中继续编辑的融合结果”。如果输入是完全不同的构图、主体替换或大范围重新设计，应先由生成式填充/工作流完成内容生成，再由对齐与校色处理仍然共享的背景、光照和边界。

## 典型使用情景

1. **同构图 AI 精修**：原图和返图主体、背景基本一致，只存在 1 到几十个像素的偏移。使用全局平移和颜色计划即可，适合人像精修、产品细节增强、局部材质重建。
2. **模型输出轻微缩放或旋转**：返图尺寸相同但主体大小、镜头边界或角度有微小变化。使用仿射候选、非均匀缩放和小角度旋转；置信度不足时保留纯平移结果。
3. **局部形变**：脸部、服装、四肢或产品边缘被模型局部拉伸。使用局部 tile/mesh，但必须通过局部提升分数和边缘约束验证，避免把噪声当成形变。
4. **整体色偏或曝光差**：返图保留结构但更冷、更暖、更亮或饱和度不同。颜色统计只使用共享区域，排除新增、删除、透明和替换区域，避免用 AI 新内容污染全局颜色。
5. **大面积内容替换**：背景或服装被重新生成，源图和返图的共享区域不足。此时应停止颜色推断或降到零校正，避免把错误颜色扩散到整张图。
6. **比例不匹配的工作流**：原图是 16:9，模型只接受 1:1，且同时有蒙版、姿态或深度图。比例修正模块以同一个方形变换处理主图和坐标关联图，并强制模型比例字段为方形，结果再依赖后续回贴流程恢复空间关系。
7. **完成校色后的风格化输出**：先完成几何对齐和颜色融合，再打开 `postFx` 或辉光。这样风格效果不会干扰对齐采样，也便于用户区分“修复”与“设计效果”。
8. **不适用情况**：32 位、1 位文档；无纹理的纯色图；源图和返图主体完全不同；超出设定搜索范围的严重裁切。代码会拒绝、低置信度跳过或回退，但产品层应把原因显示给用户。

## 当前代码链路

### 1. WebView 入口和设置

`src/webview/main.js` 绑定 `modules.blendMatch.bindBlendMatchActions()`，面板位于 `app.html` 的 `blendMatchModal`。WebView 从活动图层读取设置并构建 payload，包括模式、总强度、色调、颜色匹配、羽化、最大对齐距离、备份层和自动执行开关。

`src/webview/blend-match.js` 的主要阶段如下：

- `refreshPreview()`：请求 Host 的 `blendMatchPreviewSamples`，优先取得 raw source/reference 采样。
- `decodePreviewSample()` / `installPreviewResult()`：解码采样并绘制预览。
- `runPreviewGpuDiagnostic()`：WebGL2 做候选对齐和验证；GPU 结果目前需要经过 Host 可信门槛。
- `hydratePreviewPlanFromHost()`：把 GPU 候选交给 Host 生成或拒绝完整计划。
- `refreshPreviewWithCpu()` / `useSampleCpuBaselinePreview()`：WebGL2 不可用或不可信时使用 CPU 计划。
- `runBlendMatch()`：点击应用时携带 `planId`、`previewCacheKey`，让 Host 尝试复用预览计划。

预览采用 raw RGBA 采样后在 WebView 建立 Canvas/WebGL 纹理，避免在 Photoshop modal 内编码 JPEG/PNG。该方式降低了 Photoshop 阻塞时间，但目前仍通过 base64 传输，后续可增加 ArrayBuffer/typed-array 能力探测。

### 2. Host 侧采样和计划

`src/host/photoshop/blend-match.js` 负责 Photoshop 文档和像素处理：

- `DEFAULT_BLEND_MATCH_CONFIG` 定义搜索范围、缩放、旋转、局部 mesh、预览边长等约束。
- `captureCompositeRawSample()` 读取可见合成参考图。
- `captureIsolatedLayerSample()` 读取当前返图图层的隔离像素。
- `buildCpuBlendMatchPlanFromSamples()` 组织颜色统计、对齐分析、共享内容掩膜和 ColorPlan。
- `estimateGradientAlignment()` 进行 Sobel/梯度、平移、金字塔定位、仿射精修和局部 mesh 验证。
- `buildInternalColorProfile()` 从共享内容建立亮度、色度、饱和度和 tone curve 画像。
- `buildBlendMatchPlan()` 输出带 `planId`、文档/图层/边界、样本 hash、对齐、颜色和 timing 的统一计划。
- `blendMatchPreviewCache` 按 TTL、容量、文档/图层/边界/config/sample hash 管理缓存。
- `blendMatchActiveLayer()` 在 Apply 时验证计划；有效则复用，不有效则重新采样和分析。

颜色执行链路在 `applyInternalColorCorrectionsToRgba()`：先对齐/局部 warp，再依据 `ColorPlan` 或 legacy corrections 处理亮度、对比度、饱和度、色彩平衡和 profile，再编码为结果层并应用羽化蒙版。

### 3. 比例修正和后期边界

`ratio-offset-correction.js` 的 `computeSquareTransform()` 计算方形画布、偏移和保留面积；`padImageToSquare()` 对主图进行边缘延展或对蒙版填黑；`prepareRunPayload()` 将同一个 transform 传给蒙版、姿态、深度、法线等坐标关联图，并更新可识别的方形比例字段。

`post-fx.js` 是独立的捕获、预览、参数和 Apply 链路。它读取最长边受限的预览，应用时重新捕获原始尺寸，因此应在对齐与校色之后执行，不能把后期效果图作为对齐参考。

## 已有能力和实际效果判断

### 已经成立的能力

- `BlendMatchPlan` 已统一文档、图层、边界、配置、样本 hash、对齐、颜色和 timing，Apply 有明确的缓存复用/失效日志。
- 对齐支持平移、缩放、旋转、非均匀 stretch 和局部 mesh，并根据置信度、分数增益和边缘条件保守拒绝。
- GPU 对齐有 WebGL2 引擎、top-K/候选验证和 CPU shadow validation；GPU 结果不会未经校验直接成为最终结果。
- 共享内容掩膜会降低新增、删除、透明和替换内容对颜色统计的影响；共享比例过低时停止颜色推断。
- Photoshop modal 内主要保留像素读取、图层可见性和文档操作，统计、hash、编码等工作已部分移出 modal。
- 自动化测试覆盖了共享区域颜色推断、平移定位、低纹理低置信度、大偏移金字塔定位、GPU plan 结构和比例补边。

### 当前可见的质量风险

- WebGL2 预览 shader 还没有完整实现 tone curve、YUV chroma profile 和共享内容掩膜，因此带完整 profile 的计划会主动走 CPU 预览以保持质量；这牺牲了部分 GPU 速度，但避免预览和最终结果漂移。
- legacy corrections 仍保留兼容回退，只有 profile 缺失或 ColorPlan 失效时才使用；这条回退路径需要继续通过 hash 和版本校验保护。
- GPU 预览首先显示 raw/简化结果，之后才异步补齐可信 plan。用户在快速点击 Apply 时可能触发延后分析或 Host 回退，需要继续强化状态锁和计划状态提示。
- raw sample 当前仍有 base64 编解码和复制 typed array 的内存开销，连续拖动或重复刷新时会放大。
- 对齐和颜色代码集中在一个较大的 Host 文件中，新算法若继续直接追加会增加回归风险；应先抽出纯函数模块和稳定数据契约。
- 计划缓存目前按进程内 Map 管理，Photoshop 文档切换、图层重命名、边界变化和设置变化必须继续保持 hash 校验，不能仅凭 `planId` 命中。

## 推荐的效果增强方案

### P0：统一预览和最终颜色

1. 已完成：把 `ColorPlan` 的 profile、tone curve、共享区域权重和 hash 作为可序列化计划交给 WebView。
2. 已完成：WebView CPU 预览使用与 `applyInternalColorCorrectionsToRgba()` 同源的颜色函数，并缓存校色后的 RGBA，分割线移动不再重复校色。
3. 待完成：将同一套 profile 数学编译进 WebGL shader；在 shader 支持共享掩膜和 tone curve 前，带 profile 的计划继续走 CPU 质量路径。
4. 已完成基础回归：同一输入下 RGB 预览函数和 RGBA 最终函数逐通道一致；还需要补真实 Photoshop 采样的端到端像素 diff。

### P1：提高像素对齐的稳定性

1. 采用“粗到细 + 置信度门控”：低分辨率只找大范围平移，原尺寸再做平移精修；仅当仿射分数增益超过阈值时接受缩放/旋转。
2. 将局部 mesh 的接受条件从单一分数扩展为分数增益、有效 tile 比例、最大边缘偏移、邻域平滑度和背景直线保护。
3. 对低纹理、透明边缘、纯色背景直接降低置信度并显示“未执行对齐”，避免输出看似精确但实际随机的偏移。
4. 将对齐结果记录为可比较摘要：`dx/dy`、scale、rotation、confidence、global score、local accepted/rejected、fallback reason。

### P1：改进颜色推断的保守性

1. 共享区域掩膜继续作为唯一颜色证据；新增内容、删除内容、透明区域、边缘混合和明显高饱和替换区域必须排除。
2. 对肤色、灰阶、产品白底等敏感区域分别统计，避免单一大面积背景决定整张图颜色。
3. 高光和暗部使用受限 tone curve，避免简单均值差把高光推爆、暗部压死；16 位文档保留更高精度中间值，最终输出再量化。
4. 引入“颜色变化上限”：当 profile 的 mismatch/evidence 不可靠时，只允许低强度亮度和色温校正，并记录原因。

### P2：提升预览和 Apply 的速度

1. 保持 `BlendMatchPlan` 作为唯一分析结果：预览负责渲染，Apply 负责全分辨率执行，不在 Apply 重跑相同分析。
2. 增加 bridge 能力探测，支持时直接传 `ArrayBuffer`；base64 仅作为 UXP 兼容回退。
3. 重用 raw sample、Canvas 和 WebGL texture；sample hash 不变时只重算颜色参数或局部渲染。
4. GPU 只承担可验证的候选搜索和渲染加速；每次 GPU/CPU 差异超过门槛时自动使用 CPU plan，并记录回退原因。

### P2：把后处理放到正确阶段

推荐执行顺序：

```text
模型生成/下载
  -> 比例偏移修正（必要时）
  -> Photoshop 返图采样
  -> 几何对齐
  -> 共享区域颜色计划
  -> 全分辨率融合和羽化
  -> 本地超分（必要时）
  -> 辉光/镜头/后期效果
  -> 结果层和备份层整理
```

本地超分是否放在融合前要按任务选择：需要保留原图边界时先对齐再超分；返图本身是最终主体且只需提升细节时可以先超分，但必须重新计算尺寸和样本 hash，禁止复用旧计划。

## 建议的数据契约

```js
{
  version: 3,
  planId,
  documentId,
  layerId,
  bounds,
  configHash,
  sampleHash,
  alignment: {
    backend,
    trusted,
    applied,
    dx,
    dy,
    scaleXPercent,
    scaleYPercent,
    rotation,
    confidence,
    score,
    local: { applied, validTiles, totalTiles, maxDistance, reason },
    validation: { verdict, reason }
  },
  color: {
    version,
    method,
    executable,
    previewRenderable,
    profile,
    corrections,
    sharedMaskSummary,
    hashes: { configHash, sampleHash, alignmentHash }
  },
  preview: { renderMode, sourceTextureKey, referenceTextureKey },
  timings,
  warnings
}
```

计划必须能回答三个问题：它针对哪一个文档/图层，基于哪一组样本和配置，最终预览与 Apply 是否使用同一套几何和颜色参数。任何一个答案不明确，都应视为缓存失效。

## 验收指标

### 质量

- 高纹理、同构图样本：`dx/dy` 与 CPU 参考误差不超过 1 到 2 个采样像素。
- 缩放误差不超过 0.15%，旋转误差不超过 0.15 度；不满足时回退 CPU 或纯平移。
- 局部 mesh 的有效 tile、最大距离和接受/拒绝状态与 CPU 参考一致，不允许静默丢失。
- 预览与最终结果的颜色 diff 在中性灰、肤色、强饱和色、高光、暗部五类样本上均无可见整体漂移。

### 性能

- 未变更图层、样本和设置的重复预览不重新执行 Photoshop 采样。
- Apply 命中有效计划时日志明确出现 `cachedPlan=true`，不重复全局对齐和颜色画像。
- raw 传输记录字节数、解码耗时和 Canvas/WebGL 渲染耗时；ArrayBuffer 可用时不再发生 base64 往返。
- GPU 不可用、16 位受限或计划失效时能在一个明确的回退路径完成，不出现半成品结果层。

### 安全和可恢复性

- 采样失败、异常中断或结果层创建失败后，返图图层可见性始终恢复。
- 计划校验覆盖文档、图层、边界、配置 hash、样本 hash、计划版本和颜色计划版本。
- 低置信度不执行强行校正，并在面板和日志中说明原因。
- 备份层、结果层和羽化蒙版的行为保持可逆，用户能清楚区分原返图和融合结果。

## 实施顺序

1. 先完成 ColorPlan 的预览渲染和 preview/final diff 测试。
2. 再把对齐结果摘要、颜色摘要和缓存命中状态稳定写入日志及测试夹具。
3. 然后做 ArrayBuffer 传输和纹理/Canvas 复用，解决重复预览的内存开销。
4. 最后扩大 GPU 对齐覆盖范围和局部 mesh 加速；GPU 质量门槛和 CPU fallback 必须保留。

不建议先重写整个 WebGL 对齐算法。只要预览和最终仍消费不同的颜色实现，GPU 加速只会让“错误的结果”更快出现；先统一计划和验收，再扩大加速范围，收益和风险更容易被量化。
