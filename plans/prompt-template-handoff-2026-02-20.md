# 提示词模板增强交接文档（2026-02-20，二次定位修复）

## 1. 当前状态摘要

- 已完成并通过用户验证：
1. 设置页提示词模板 `JSON` 导入/导出可用。
2. 工作台预设支持最多 5 个模板组合，且有 4000 字符上限拦截。

- 首轮已完成（上次接手）：
1. 设置页/工作台都增加了实时长度与末尾预览。
2. 修复了 `promptLike + select<=1` 回退单行输入的问题。
3. 运行前增加了 prompt 参数长度日志（工作台层）。

- 最新验收反馈：
1. 截断问题修复通过，设置页与工作台长文本输入表现一致。
2. 可观测日志验证通过（运行前与提交前长度检查均可输出）。

- 本轮二次定位后已新增修复：
1. 设置页模板内容输入框强制放开长度上限（`maxlength=20000`）并接管粘贴逻辑。
2. 工作台 prompt 输入框强制放开长度上限（`maxlength=20000`）并接管粘贴逻辑。
3. 运行提交层（`runninghub-runner`）新增“最终提交前文本参数长度/末尾预览”日志。
4. AI App 请求构建中，对 `text/prompt` 参数不再附带 `fieldData`，避免后端潜在的字段覆盖或降级行为。

## 2. 本轮新增落地改造（代码）

1. `src/controllers/settings-controller.js`
- 增加 `TEXT_INPUT_HARD_MAX_CHARS = 20000`。
- 增加 `enforceLongTextCapacity()`：对模板内容输入框显式设置更高 `maxlength`。
- 增加 `onTemplateContentPaste()`：接管粘贴并手动插入，避免宿主默认粘贴链路可能截断。
- 保留并沿用实时长度/尾部预览提示。

2. `src/controllers/workspace/workspace-inputs.js`
- 增加 `TEXT_INPUT_HARD_MAX_CHARS = 20000`。
- 对 prompt textarea 显式提高 `maxlength`。
- 增加 `insertTextAtCursor()` + prompt 输入粘贴接管。
- 继续保留实时长度/尾部预览与 4000 警告。

3. `src/services/runninghub-runner.js`
- 新增 `getTextLength()` / `getTailPreview()` 调试辅助。
- 新增 `textPayloadDebug`：在真正提交 API 前记录最终文本参数长度和末尾预览。
- 调整 `buildNodeInfoPayload()`：仅在 `select/boolean/number` 等场景附带 `fieldData`；`text/prompt` 不再附带。

## 3. 二次定位结论（当前判断）

1. 可能性 A：宿主输入控件链路存在默认长度限制（或粘贴链路限制）
- 依据：用户截图中长度稳定在接近固定值（252）。
- 本轮对策：提高 `maxlength` + 接管粘贴插入。

2. 可能性 B：AI App 提交时 `fieldData` 与 `fieldValue` 发生冲突，导致后端按旧值/默认值处理
- 本轮对策：`text/prompt` 请求不再附带 `fieldData`。

3. 若以上仍不能解决
- 需要抓取一次完整“提交前文本长度日志 + 接口原始响应”联合证据，再继续精确定位。

## 4. 下一轮验证步骤（必须按顺序）

1. 在设置页模板输入框粘贴 600+ 字符文本，观察长度提示是否 >252。
2. 保存模板后重新点“修改”，确认长度保持一致。
3. 在工作台点击“预设”应用该模板，确认工作台长度提示与设置页一致。
4. 运行任务后导出日志，确认出现两段日志：
- `运行前长度检查：...`（workspace 层）
- `提交前文本参数检查：...`（runner 层）
5. 若两段日志长度都完整但效果仍像“后半段不生效”，可初步归类为 RunningHub/模型上下文限制。

## 5. 回归测试补充

1. prompt 输入框手动粘贴长文本（>=600），不应被固定截到 252。
2. prompt 输入框手动输入 + 粘贴混合编辑，长度应持续正确增长。
3. 模板导入（JSON）中的长文本导入后，编辑再保存长度不变化。
4. 运行日志中应能看到提交前最终文本参数长度，且与 UI 一致。

## 6. 当前已改动文件

1. `index.html`
2. `style.css`
3. `src/services/store.js`
4. `src/services/runninghub-runner.js`
5. `src/controllers/settings-controller.js`
6. `src/controllers/workspace-controller.js`
7. `src/controllers/workspace/workspace-inputs.js`
8. `plans/prompt-template-enhancement.md`
9. `plans/prompt-template-handoff-2026-02-20.md`

## 7. 本轮验收与版本记录

1. 用户验收结论：通过（截断问题修复成功）。
2. 本轮状态：提示词长文本输入问题关闭，进入稳定维护阶段。
3. 版本更新：所有显示版本号区域已更新为 `V2.0.4`，`manifest.json` 版本已同步为 `2.0.4`。
