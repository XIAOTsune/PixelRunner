# Settings Controller 重构执行计划

## 背景
当前设置页存在三个核心问题：
1. 删除按钮依赖 `window.deleteApp` / `window.deleteTemplate`，在 UXP/模块环境下容易失效。
2. 保存应用后 UI 反馈不完整，列表刷新与输入清理链路不稳定。
3. 列表渲染未处理重复 ID 的可辨识性，排障成本高。

## 目标
1. 移除全局 `window` 挂载删除函数。
2. 使用事件委托统一处理 `savedAppsList` / `savedTemplatesList` 删除操作。
3. 保存应用后立即刷新列表并清理输入区域。
4. 列表中显式标记重复 ID，保证 UI 可区分。
5. 保持 `initSettingsController` 作为唯一初始化导出。

## 实施步骤
1. 读取并确认 `store` 接口契约。
2. 重构列表渲染：
   - 删除内联 `onclick`。
   - 删除按钮改为 `data-action` + `data-id`。
3. 新增事件委托处理器：
   - `onSavedAppsListClick`
   - `onSavedTemplatesListClick`
4. 调整 `saveParsedApp` 成功分支：
   - `alert`
   - 清空输入与解析状态
   - 重新渲染应用列表
5. 增加重复 ID 展示策略：
   - 统计每个 ID 出现次数
   - 对重复项展示“重复 x/y”标签
6. 初始化阶段绑定委托事件并渲染首屏列表。
7. 回归检查：
   - 删除应用是否即时生效
   - 删除模板是否即时生效
   - 保存应用后是否即时刷新
   - 重复 ID 是否可区分

## 验收标准
1. 代码中不再出现 `window.deleteApp` 与 `window.deleteTemplate`。
2. 删除操作由容器 `addEventListener("click", ...)` 处理。
3. 点击删除后调用 `store` 删除并立即 `render`。
4. `saveParsedApp` 成功后输入框、解析区被清空，列表更新。
5. 对重复 ID 的条目，UI 中能看到明确区分信息。
6. `module.exports = { initSettingsController }` 保持不变。

## 风险与缓解
1. 风险：初始化重复执行导致重复绑定事件。
   - 缓解：先 `removeEventListener` 再 `addEventListener`。
2. 风险：历史脏数据存在空 ID。
   - 缓解：渲染时使用 `unknown-id` 兜底显示。

## 回滚方案
如果重构后异常，可仅回滚 `src/controllers/settings-controller.js` 到上一版本，不影响其他模块。
