# Settings Controller 技术设计说明

## 1. 事件模型调整

### 旧方案
- 列表按钮使用内联 `onclick`，调用 `window.deleteApp(id)` / `window.deleteTemplate(id)`。
- 问题：
  - 依赖全局对象污染命名空间。
  - 在模块化/UXP 环境下函数暴露不稳定。

### 新方案
- 在容器层绑定一次点击事件（事件委托）：
  - `savedAppsList` 监听删除应用按钮
  - `savedTemplatesList` 监听删除模板按钮
- 删除按钮仅携带 `data-action` 与 `data-id`。
- 通过 `event.target.closest("button[data-action='...']")` 捕获意图。

## 2. 删除链路

### 应用删除
1. 点击 `data-action="delete-app"` 按钮。
2. 从按钮读取 `data-id`。
3. 二次确认 `confirm`。
4. 调用 `store.deleteAiApp(id)`。
5. 立即执行 `renderSavedAppsList()`。

### 模板删除
1. 点击 `data-action="delete-template"` 按钮。
2. 从按钮读取 `data-id`。
3. 二次确认 `confirm`。
4. 调用 `store.deletePromptTemplate(id)`。
5. 立即执行 `renderSavedTemplates()`。

## 3. 保存成功反馈链路

### saveParsedApp 成功分支
1. `store.addAiApp(state.parsedAppData)`。
2. 弹窗提示保存成功。
3. 调用 `clearAppEditorUI()`：
   - 清空 `appIdInput`
   - 清空 `appNameInput`
   - 清空解析结果区
   - 隐藏手动配置区
   - 清空 `state.parsedAppData`
4. 调用 `renderSavedAppsList()` 立即刷新。

## 4. 重复 ID 可视化策略

### 设计目标
即使 `store` 层容忍重复 ID，UI 层也能清晰区分重复条目。

### 实现方式
- 首次遍历统计每个 `id` 的总数。
- 再次遍历给每个条目分配出现序号（1..N）。
- 若某 `id` 总数 > 1：
  - 在 UI 中显示 `重复 x/y` 标记。
  - 同时保留原始 ID。

### 说明
- 删除接口仍按 `id` 删除，遵循现有 store 契约。
- UI 标记主要用于识别与排查重复数据来源。

## 5. 模块边界与兼容性

1. 保持 `initSettingsController` 作为对外入口。
2. 不修改 `store` 接口签名。
3. 不影响 `workspace-controller` 与其他 controller 的调用方式。

## 6. 关键验证点
1. 保存应用后列表是否立即出现新项。
2. 删除按钮在 UXP 环境中是否稳定响应。
3. 重复 ID 时条目是否出现区分标记。
4. 重复初始化时是否会触发重复事件（通过 remove/add 规避）。
