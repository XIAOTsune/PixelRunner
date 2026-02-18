# 回贴对齐交接文档（重写版，2026-02-18）

## 1. 当前目标
在 Photoshop 插件中，解决 RunningHub 图生图结果“回贴错位”问题，优先保证：
- 流程不卡死、可中止。
- 主体（人物）优先对齐。
- 超出选区区域可裁切收口。

## 2. 最新结论（已确认）
- `stretch`、`contain`、`cover` 都存在明显错位。
- `alphaTrim`、`edgeAuto` 目前已不再是主要卡死问题，但对齐效果仍有较大偏移。
- 高可信根因：部分 AI 模型会按自身构图/比例返回结果，导致主体相对输入图出现非等比尺度变化与位置漂移，并可能多画边缘内容。
- 结论：仅靠透明边检测或普通边缘框，无法稳定纠正该类偏移。

## 3. 已完成进度（代码已落地）
1. 稳定性修复（防挂死）
   - `src/services/ps.js` 已加入图像解码与内容分析超时保护（超时后回退 `cover`）。
   - 失败/超时默认回退，不阻塞主流程。
2. 中止链路修复
   - `src/controllers/workspace-controller.js` 已把 `signal` 传入 `ps.placeImage(...)`，回贴阶段可响应中止。
3. 可观测性增强
   - `src/services/ps.js` 已加入阶段日志：
     - `buildContentReference start/end`
     - `placeEvent start/end`
     - `alignActiveLayerToBounds start/end`
   - 已加入几何日志：
     - `align geometry before/after`
     - `align scale factors`
     - `align offset`
4. 基础校验
   - 已通过语法检查：
     - `node --check src/services/ps.js`
     - `node --check src/controllers/workspace-controller.js`

## 4. 当前未解决问题（核心）
- 对齐策略仍偏“外框+居中”，无法处理模型输出中的内容漂移。
- 需要从“框对齐”升级到“主体显著区域对齐”。
- 需要支持 `x/y` 独立缩放 + 平移，并对超出区域裁切。

## 5. 已确认方案（下一阶段）
将回贴策略下拉框收敛为两档：
1. `normal`（普通）
   - 稳定路径：`cover + center`。
   - 作为兜底策略，保证速度与稳定性。
2. `smart`（智能）
   - 通过计算机图像学算法检测“原图 vs 回贴图”的显著性边缘。
   - 求解并应用 `x/y` 独立缩放和偏移，使主体对齐。
   - 超出选区部分进行裁切（建议非破坏性蒙版）。
   - 任何失败/超时立即回退 `normal`。

## 6. Smart 模式算法草案（实现导向）
1. 输入
   - 原始输入图（选区截图 buffer）。
   - AI 返回图（下载结果 buffer）。
   - 目标选区 bounds。
2. 预处理
   - 灰度化、轻度模糊。
   - 梯度图（Sobel/Scharr）。
3. 主体检测
   - 阈值+连通域筛选，得到主体框：
     - 原图 `boxSrc`
     - 回贴图 `boxOut`
4. 变换求解
   - `sx = boxSrc.w / boxOut.w`
   - `sy = boxSrc.h / boxOut.h`
   - 基于中心点求 `dx/dy`
5. 回贴执行
   - 对回贴层应用 `scaleX/scaleY + offset`。
   - 再执行选区裁切（超出不可见）。
6. 质量评估与回退
   - 记录指标：中心偏移、宽高比差、重叠率（IoU或近似值）。
   - 指标过差或检测失败：回退 `normal`。

## 7. 立即可执行任务清单（给下一位 AI）
1. UI 与配置收敛
   - `index.html`：策略项改为 `normal`、`smart`。
   - `src/config.js`、`src/services/store.js`：默认值与枚举更新。
   - 设置迁移：
     - `stretch/contain/cover` -> `normal`
     - `alphaTrim/edgeAuto` -> `smart`
2. 算法实现
   - 在 `src/services/ps.js`（或新建 `src/services/alignment.js`）实现 `computeSmartAlignment(...)`，返回 `{ sx, sy, dx, dy, score }`。
   - 扩展对齐执行函数以支持非等比缩放与裁切。
3. 日志与调参
   - 保留当前阶段日志。
   - 新增 `smart` 评分日志与回退原因日志。
4. 回归样本
   - 固定至少 3 组样本：单人、半身、复杂背景。
   - 对比 `normal` vs `smart` 的偏移改善。

## 8. 验收标准
- 不再出现“运行中无法结束”。
- 智能模式失败时可自动回退普通模式。
- 智能模式在主要样本中明显降低主体偏移（肉眼可见改善），且超出选区内容被裁切。
