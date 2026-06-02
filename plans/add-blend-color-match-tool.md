# 融合校色功能规划

## 背景判断

PixelRunner 现在已经具备 RunningHub/第三方 API 任务提交、自动返图贴回、选区捕获、图层辅助、高低频、辉光和空间特效等能力。继续新增通用滤镜的价值有限，尤其是磨皮和油画类工具容易落入“效果不够好，但复杂度不低”的尴尬区间。

“融合校色”更适合作为下一阶段核心功能，因为它直接解决 AI 返图贴回 Photoshop 后最常见的问题：

- 返图和原图亮度不一致。
- 返图色温、色偏、饱和度和周围环境不一致。
- 返图边缘过硬，和原图之间有明显贴片感。
- 返图有轻微像素拉伸、缩放或偏移，尤其是局部重绘结果和原选区边缘对不上。
- 用户每次都要手工调曲线、色相饱和度、蒙版羽化、移动图层，流程重复且费眼。

这个功能不和 Photoshop 的 Camera Raw、磨皮、油画等成熟工具正面对抗，而是增强 PixelRunner 最独特的链路：AI 结果从云端回来以后，自动变得更像原图的一部分。

## 功能定位

功能名称：

```text
融合校色
```

一句话定位：

```text
让 AI 返图图层自动匹配原图的明度、色彩和边缘过渡，并在必要时进行小范围对齐。
```

它不是通用调色滤镜，也不是 Camera Raw 替代品。它的核心对象是“当前选中的 AI 返图图层”和“除去该返图后用户实际可见的原始画面”。

## 目标用户流程

手动流程：

1. 用户选中一张 AI 返图图层。
2. 打开工具箱中的“融合校色”。
3. 点击“分析并融合”。
4. 插件临时隐藏当前返图图层，捕获下方可见原图作为参考。
5. 插件重新显示返图图层，分析返图图层和参考图之间的亮度、颜色、边缘和对齐差异。
6. 插件对返图图层进行校色、轻微位移/缩放、蒙版羽化或边缘过渡处理。
7. 用户可通过强度滑块微调融合结果。

自动流程：

1. 用户在工具箱中打开“自动融合校色”状态按钮。
2. RunningHub/第三方 API 任务完成后，PixelRunner 自动贴回结果图层。
3. 贴回成功后立即执行融合校色。
4. 任务卡片和日志显示“已贴回并完成融合校色”。
5. 如果 Photoshop 当前忙、图像过大或分析失败，则保留原贴回结果，并在日志中说明原因。

## 非目标

第一版不做这些事情：

- 不承诺完美修复明显生成错误。
- 不做复杂形变匹配、透视变换或网格变形。
- 不做 AI 语义级对齐。
- 不做完整 Camera Raw 风格调色。
- 不直接替代用户手工蒙版和曲线精修。
- 不对所有图层强制自动处理，自动模式只处理 PixelRunner 贴回的结果图层。

## 现有代码切入点

当前自动贴回链路大致如下：

- WebView：`PixelRunner/src/webview/workspace.js`
  - `autoPlaceResult(result)`
  - `queueAutoPlacement(result)`
  - `flushPendingAutoPlacements()`
  - `buildAutoPlacementPayload(result)`
- Host bridge：`PixelRunner/src/host/main.js`
  - `photoshop.placeResultFromUrl`
- Photoshop bridge：`PixelRunner/src/host/photoshop-bridge.js`
  - `placeResultIntoPhotoshop(args)`
- Photoshop service：`PixelRunner/src/host/photoshop/service.js`
  - `placeImageFromUrl(payload)`
  - 内部已有 `alignPlacedLayerToBounds(...)`
  - 内部已有 `transformLayerScale(...)`
  - 内部已有 `transformLayerOffset(...)`
  - 内部已有 `applyLayerMaskFromSelection(...)`

工具箱已有入口位于：

- `PixelRunner/app.html`
  - `#viewTools`
  - 当前包含辉光、空间特效、图层辅助、滤镜与修复、合并操作。
- `PixelRunner/src/webview/main.js`
  - 负责绑定工具箱按钮。
- `PixelRunner/src/host/photoshop/tool-actions.js`
  - 负责工具箱动作，例如高低频、辉光、选择并遮住、盖印等。

推荐新增独立模块，而不是把逻辑塞进现有巨型文件：

- WebView 状态与 UI：`PixelRunner/src/webview/blend-match.js`
- Host 算法/动作：`PixelRunner/src/host/photoshop/blend-match.js`
- Photoshop 服务导出：通过 `service.js` 暴露 `blendMatchActiveLayer(payload)` 或挂入 `runToolActionByName`。

## 信息模型

新增本地设置建议：

```js
blendMatch: {
  autoEnabled: false,
  mode: "balanced",
  colorStrength: 70,
  luminanceStrength: 75,
  saturationStrength: 55,
  alignmentEnabled: true,
  alignmentMaxOffset: 8,
  alignmentMaxScale: 2,
  featherRadius: 12,
  edgeBlendStrength: 65,
  grainMatchEnabled: false,
  createBackupLayer: false,
  applyToAutoPlacedResults: true
}
```

需要持久化到 `state.STORAGE_KEYS`，例如：

```text
pixelrunner.blendMatch.settings.v1
```

## UI 设计

工具箱主卡片：

```text
融合校色        [自动：开/关]
让 AI 返图匹配原图明度、颜色和边缘过渡。
[打开面板]
状态：等待选择返图图层
```

面板结构：

```text
融合校色

状态
- 当前图层：PixelRunner - xxx
- 参考来源：隐藏当前图层后的可见画面
- 适用范围：当前图层非透明区域 / 原选区蒙版区域

模式
- 自然
- 均衡
- 强融合
- 仅校色
- 仅边缘

校色
- 明度匹配
- 色温/色偏匹配
- 饱和度匹配
- 对比匹配
- 总强度

对齐
- 启用小范围对齐
- 最大位移 px
- 最大缩放 %
- 仅平移 / 平移+缩放

边缘
- 羽化半径
- 边缘融合强度
- 保留中心区域
- 保护透明像素

自动处理
- AI 返图贴回后自动融合
- 失败时保留原始返图

操作
- 分析预览
- 应用融合
- 重置
```

第一版可以不做复杂实时预览，先做“分析并应用”。如果要做预览，建议只在缩略图上预览，避免滑块拖动时处理大图导致卡顿。

## 核心技术方案

### 1. 参考图获取

手动模式：

1. 获取当前活动文档和当前活动图层 ID。
2. 记录当前图层可见性、透明度、混合模式和 bounds。
3. 临时隐藏当前返图图层。
4. 捕获当前用户可见合成图，作为原始参考图。
5. 恢复当前返图图层可见性。
6. 捕获当前返图图层或当前图层区域，作为待融合图。

自动模式：

1. `placeImageFromUrl(payload)` 完成贴回后返回新图层 ID。
2. 如果 `blendMatch.autoEnabled === true`，立即对该图层执行融合校色。
3. 参考图同样通过临时隐藏新图层后捕获可见合成画面获得。

关键点：

- 参考图必须是“除去返图图层后用户看见的原图”，不是简单取下方单层。
- 这样能兼容用户已有调整层、背景组、修饰层和可见效果。
- 需要避免把返图本身纳入参考统计，否则会产生自我匹配，效果变弱。

### 2. 区域确定

优先级：

1. 如果返图图层有非透明 alpha bounds，则使用非透明区域。
2. 如果贴回时有 `sourceDocument.selectionBounds`，使用原选区 bounds。
3. 如果两者都没有，则使用当前图层 bounds。
4. 如果 bounds 接近整张图，则使用整图逻辑，弱化边缘融合。

区域需要扩展两个采样圈：

```text
innerRegion：返图主体区域
edgeRegion：返图边缘附近区域
contextRegion：返图外侧周围原图区域
```

校色主要比较 `innerRegion` 和参考图同位置像素；边缘融合主要比较 `edgeRegion` 与 `contextRegion`。

### 3. 颜色和明度匹配

第一版推荐从稳健统计开始，不直接做复杂 LUT。

对参考图和返图图层分别计算：

- 平均亮度 `meanLuma`
- 亮度标准差 `stdLuma`
- RGB 均值 `meanR/G/B`
- Lab 或近似 YCbCr 均值
- 饱和度均值 `meanSat`
- 分位数亮度：P5、P25、P50、P75、P95

建议在近似线性空间或至少 gamma-aware 处理：

```text
srgb -> linear -> 统计/校正 -> srgb
```

MVP 可先用 sRGB 近似，但文档中要保留后续升级空间。

校正顺序建议：

1. 曝光/明度偏移。
2. 对比度匹配。
3. RGB 或 YCbCr 色偏修正。
4. 饱和度匹配。
5. 总强度混合。

基础公式：

```text
normalized = (srcLuma - srcMean) / srcStd
matchedLuma = normalized * refStd + refMean
```

颜色偏移：

```text
deltaR = refMeanR - srcMeanR
deltaG = refMeanG - srcMeanG
deltaB = refMeanB - srcMeanB
```

最终不要 100% 套用，必须按用户强度混合：

```text
final = original * (1 - amount) + corrected * amount
```

防止过度校正：

- 单通道偏移限制在安全范围。
- 对比匹配限制最大增益。
- 高光和阴影使用分位数保护，避免黑位压死或高光爆掉。
- 透明像素不处理。

### 4. 三段亮度权重

为了避免单一全局统计导致皮肤、天空、暗部一起偏，可以引入三段权重：

```text
shadowWeight
midtoneWeight
highlightWeight
```

根据亮度 smoothstep 生成，分别计算暗部/中灰/高光的参考差值。

第一版可以先只做全局匹配；第二版再加入三段匹配。文档和数据结构应提前预留：

```js
toneRanges: {
  enabled: false,
  shadowStrength: 50,
  midtoneStrength: 70,
  highlightStrength: 55
}
```

### 5. 小范围对齐

目标是处理“差一点点没对上”的问题，不处理大变形。

支持范围：

- 平移：默认最大 8px。
- 缩放：默认最大 2%。
- 可选只平移。
- 不做旋转、透视和局部网格变形。

建议算法：

1. 从返图图层和参考图中提取灰度缩略图。
2. 取边缘/纹理较多的区域，优先使用 Sobel 梯度图，而不是原始颜色图。
3. 在 `[-maxOffset, maxOffset]` 范围内做局部搜索。
4. 使用 SAD/SSD/NCC 得分评估相似度。
5. 若最佳得分相对第二名没有明显优势，则认为不可靠，不执行对齐。
6. 对齐只在得分超过阈值时应用。

缩放搜索：

```text
scale candidates: 98%, 99%, 100%, 101%, 102%
offset candidates: -8px..8px
```

为了性能，缩略图长边建议限制在 512 或 768。

对齐动作：

- 先用 `transformLayerOffset(...)` 做平移。
- 如果启用缩放，再用 `transformLayerScale(...)` 轻微缩放。
- 对齐后重新计算 bounds 或至少刷新图层信息。

失败策略：

- 如果图像缺少纹理、边缘太少、返图和原图差异过大，则跳过对齐。
- 跳过不视为功能失败，只在日志里写“对齐置信度不足，已仅执行校色/边缘融合”。

### 6. 边缘羽化和过渡

边缘融合是这个工具的感知重点。推荐分两层做。

第一层：蒙版羽化

- 如果当前返图已有蒙版，优先复制/调整蒙版属性。
- 如果没有蒙版，基于非透明区域或原选区创建蒙版。
- 对蒙版边缘应用羽化半径。
- 羽化半径范围：0-64px，默认 12px。

第二层：边缘颜色过渡

在返图边缘附近进行局部混合：

```text
edgeWeight = distanceToMaskEdge / featherRadius
finalPixel = correctedResult * edgeWeight + referencePixel * (1 - edgeWeight)
```

注意：

- 中心区域应尽量保留 AI 结果。
- 边缘区域向参考图靠拢。
- 透明像素不应产生污染。
- 羽化过强会导致局部重绘变糊，因此需要“保留中心区域”参数。

第一版可以先用 Photoshop 原生蒙版羽化；第二版再做像素级边缘颜色过渡。

### 7. 颗粒/噪点匹配

这不是第一版必做，但很适合作为第二阶段。

AI 返图常比原图更干净，贴回后边缘和质感会露馅。颗粒匹配可以分析参考区域噪声强度，再给返图加轻微颗粒。

参数：

```text
颗粒匹配：开/关
颗粒强度：0-100
高光保护：0-100
彩色颗粒：0-100
```

默认关闭，避免破坏商业修图干净感。

## Photoshop 实现路径

### 方案 A：以 Photoshop 原生命令为主

优点：

- 更符合 Photoshop 工作流。
- 图层、蒙版、调整层可编辑。
- 不需要自己重写完整图像编码和像素回写。

可能动作：

- 临时隐藏/显示图层。
- 盖印可见或捕获合成图。
- 创建剪贴调整层：曲线、色相饱和度、色彩平衡、曝光。
- 创建/调整图层蒙版羽化。
- 轻微移动/缩放图层。

缺点：

- 精确统计和自动颜色匹配较受限。
- 不同 Photoshop 版本的 batchPlay descriptor 需要测试。

### 方案 B：像素级处理后回写新图层

优点：

- 算法可控。
- 容易实现统计匹配、边缘融合、颗粒。
- 结果稳定可复现。

缺点：

- 大图性能风险高。
- 需要处理透明通道、色彩空间、编码、临时文件。
- 结果更偏破坏性，除非保留原图层并生成新融合层。

### 推荐组合

第一版采用混合方案：

```text
对齐：Photoshop transform
蒙版羽化：Photoshop mask/selection
校色：优先像素统计 + Photoshop 调整层或像素回写
```

若 Photoshop 调整层自动化成本过高，则第一版可以生成一个新融合结果层，并保留原返图图层隐藏或作为备份。

建议默认非破坏：

```text
原 AI 返图图层保留
生成 “PixelRunner 融合校色 - 原图层名” 结果层
或创建剪贴调整层组
```

但自动贴回场景为了简洁，可以默认直接处理新返图图层，并允许设置“保留备份图层”。

## 自动模式设计

新增状态按钮：

```text
自动融合校色
```

状态含义：

- 开：PixelRunner 自动贴回 AI 结果后执行融合校色。
- 关：只贴回，不自动处理；用户可手动点击工具箱执行。

自动模式只处理这些结果：

- 由 `photoshop.placeResultFromUrl` 刚贴回的新图层。
- 有 `sourceDocument` 或 target bounds 的任务。
- 图层 ID 能被 host 识别。

自动模式不处理：

- 用户手动插入的普通图片。
- 没有活动文档的情况。
- Photoshop 当前处于模态操作且超过重试次数。
- 图像尺寸超过安全阈值且无法降采样分析。

自动模式失败后：

- 不删除返图。
- 不重复无限执行。
- 任务卡片显示“已贴回，融合校色失败/跳过：原因”。
- 日志保留可诊断信息。

## 日志与状态

日志示例：

```text
[融合校色] 开始分析图层：PixelRunner - 全能图片 Pro
[融合校色] 参考图已捕获：隐藏返图后的可见画面
[融合校色] 明度 +6.2 / 饱和 -4.8 / 色偏 R-3 G+1 B+5
[融合校色] 对齐：dx -2px, dy +1px, scale 100.0%, confidence 0.82
[融合校色] 羽化半径 12px，边缘融合强度 65%
[融合校色] 已完成
```

任务卡片状态：

```text
任务已完成，并已自动贴回 Photoshop 文档 #12；融合校色完成。
任务已完成，并已自动贴回；融合校色跳过：对齐置信度不足，仅完成校色。
任务已完成，并已自动贴回；融合校色失败：无法捕获参考图。
```

## 分阶段实施

### 阶段 1：手动工具 MVP

目标：证明“当前图层匹配隐藏当前图层后的可见原图”这条链路可靠。

范围：

- 工具箱新增“融合校色”卡片和面板。
- 支持手动选择当前返图图层。
- 捕获参考图：临时隐藏当前图层后获取可见画面。
- 获取返图区域：使用图层 bounds 或选区 bounds。
- 执行基础明度、色偏、饱和度匹配。
- 支持总强度。
- 支持蒙版羽化。
- 输出日志。

暂不做：

- 自动贴回后处理。
- 小范围缩放对齐。
- 颗粒匹配。
- 三段亮度匹配。
- 实时预览。

验收标准：

- 当前图层能被识别。
- 隐藏当前图层后捕获的参考画面不包含返图自身。
- 局部返图的亮度和颜色明显更接近原图。
- 羽化后边缘过渡比原贴回更自然。
- Ctrl+Z 可以用一次或少数几次撤回。

### 阶段 2：自动贴回后融合

目标：把融合校色接入 PixelRunner 最核心的自动返图链路。

范围：

- 新增持久化设置 `autoEnabled`。
- `placeImageFromUrl` 返回新图层 ID 和 bounds。
- `autoPlaceResult` 贴回成功后调用融合校色。
- pending auto placement 重试成功后也能调用融合校色。
- 任务卡片和日志展示融合状态。
- 失败时保留贴回图层。

验收标准：

- 打开自动模式后，RunningHub 任务完成会自动贴回并融合。
- Photoshop 忙时仍能沿用现有 pending retry 机制。
- 融合失败不会导致返图失败。
- 关闭自动模式时行为和 2.5.0 保持一致。

### 阶段 3：小范围对齐

目标：解决轻微偏移和缩放不一致。

范围：

- 基于缩略图和梯度图进行平移搜索。
- 可选 98%-102% 缩放搜索。
- 置信度不足时跳过。
- UI 提供最大位移、最大缩放、启用/关闭。

验收标准：

- 1-8px 偏移能自动校正。
- 1%-2% 缩放误差能在常见图片上改善。
- 明显错误时不会乱移动图层。
- 大图处理时间可控。

### 阶段 4：高级边缘和颗粒

目标：进一步降低贴片感。

范围：

- 像素级边缘颜色过渡。
- 可选颗粒匹配。
- 三段亮度匹配。
- 缩略图预览。

验收标准：

- 边缘硬切明显减少。
- AI 返图过干净的问题有所改善。
- 参数不会让结果变脏或过度模糊。

## 风险与应对

### 风险 1：参考图捕获不准确

原因：

- 当前图层隐藏/显示失败。
- 多选图层或组图层语义复杂。
- 当前图层本身是智能对象、调整层或特殊图层。

应对：

- 第一版要求选中像素/智能对象返图图层。
- 多选时提示只支持单图层。
- 操作前记录并恢复可见性。
- 出错时恢复图层状态。

### 风险 2：颜色匹配过度

原因：

- 参考区域和返图区内容语义不同。
- AI 结果本身风格差异大。
- 统计被极端亮暗像素影响。

应对：

- 使用分位数裁剪，忽略极端 2%-5% 像素。
- 默认强度不要太高。
- 提供“自然/均衡/强融合”模式。
- 饱和度和 RGB 偏移设置上限。

### 风险 3：自动对齐误判

原因：

- 区域纹理太少。
- AI 重绘内容和原图差异太大。
- 边缘区域重复纹理导致匹配错位。

应对：

- 只做小范围搜索。
- 使用置信度阈值。
- 允许关闭对齐。
- 默认记录对齐结果，便于用户判断。

### 风险 4：性能卡顿

原因：

- 大图像素处理。
- 多次捕获/编码。
- 滑块实时处理。

应对：

- 第一版不做实时大图预览。
- 分析使用缩略图，应用使用必要区域。
- 限制最大处理边长。
- 大图显示“使用降采样分析”提示。

### 风险 5：撤销体验差

原因：

- Photoshop modal 中执行多步操作。
- 临时隐藏图层和创建结果层可能拆成多个历史状态。

应对：

- 所有 Photoshop 操作包在 `executeAsModal`。
- 命令名称统一为 `PixelRunner 融合校色`。
- 尽量把动作合并为一个历史状态。
- 出错时恢复图层可见性。

## 推荐第一版参数默认值

```text
模式：均衡
总强度：70
明度匹配：75
色彩匹配：65
饱和度匹配：50
对比匹配：45
启用对齐：关
最大位移：8px
最大缩放：2%
羽化半径：12px
边缘融合强度：60
保留中心区域：70
自动融合校色：关
保留备份图层：关
```

自动模式默认建议为关。等手动工具稳定后，再在 UI 中推荐用户开启。

## 建议文件清单

第一阶段可能涉及：

```text
PixelRunner/app.html
PixelRunner/app.css
PixelRunner/src/webview-entry.js
PixelRunner/src/webview/state.js
PixelRunner/src/webview/blend-match.js
PixelRunner/src/webview/main.js
PixelRunner/src/host/main.js
PixelRunner/src/host/photoshop-bridge.js
PixelRunner/src/host/photoshop/service.js
PixelRunner/src/host/photoshop/blend-match.js
```

如果复用 `photoshop.runToolAction`，也可能涉及：

```text
PixelRunner/src/host/photoshop/tool-actions.js
```

但考虑功能复杂度，建议独立 host 模块更清晰。

## 验证清单

基础场景：

- 空文档：提示需要打开 Photoshop 文档。
- 无选中图层：提示需要选中返图图层。
- 普通局部返图：校色和羽化正常。
- 整图返图：只做颜色明度匹配，弱化边缘处理。
- 当前图层有透明区域：只处理非透明区域。
- 当前图层有蒙版：不破坏用户蒙版，或先复制/保留。

自动场景：

- RunningHub 完成后自动贴回并融合。
- 第三方 API 完成后自动贴回并融合。
- Photoshop 忙时贴回重试，成功后继续融合。
- 自动融合失败时不影响返图保留。

质量场景：

- 人像皮肤局部重绘。
- 衣服/布料局部替换。
- 商品图背景局部修复。
- 高光区域修复。
- 暗部区域修复。
- 低纹理区域，确保对齐不会乱动。
- 高纹理区域，确保对齐能改善轻微偏移。

性能场景：

- 1024px 局部区域。
- 2048px 局部区域。
- 4K 文档小选区。
- 4K 文档整图返图。

## 版本建议

建议把这个功能作为 `2.6.0` 的主线：

```text
2.6.0：融合校色
```

发布说明重点：

```text
- 新增工具箱「融合校色」。
- 支持将 AI 返图图层自动匹配原图明度、色彩和边缘过渡。
- 支持返图贴回后自动融合校色开关。
- 支持边缘羽化强度调节。
- 为后续小范围对齐、颗粒匹配和高级边缘融合预留算法模块。
```

## 最终判断

这个功能值得做，而且应该成为 PixelRunner 下一阶段的主功能之一。它的复杂度确实比普通工具高，因为它涉及图层状态、合成参考图、像素统计、可能的对齐搜索、蒙版/羽化和自动贴回链路。

但它的产品价值也更高：

- 它和 AI 返图工作流强绑定。
- 它补的是 Photoshop 原生工具不会自动替你做的环节。
- 它能显著减少用户“贴回之后还要手动融合”的疲劳。
- 它比油画、磨皮、通用调色更像 PixelRunner 的特色能力。

推荐先做手动 MVP，确认融合质量和图层捕获链路稳定后，再接入自动贴回。
