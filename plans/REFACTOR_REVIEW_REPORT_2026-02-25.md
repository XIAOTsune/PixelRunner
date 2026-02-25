# PixelRunner 重构后代码深度审查报告（2026-02-25）

## 1. 审查范围与方法

- 审查范围：`src/`、`index.js`、`scripts/`、`tests/`、`README.md`、重构计划文档。
- 审查方式：
  - 全量自动化回归：`node --test ...`（230 passed, 0 failed）。
  - 依赖方向检查：`node scripts/check-controller-service-deps.js`（通过）。
  - 关键文件语法检查：`node --check ...`（通过）。
  - 架构与运行链路静态审查：`controllers -> application -> services -> infrastructure`。

---

## 2. 结论摘要

- 重构目标中“控制器不直连 `services`”规则已落地，且有脚本防回归，方向正确。
- 当前存在 2 个高风险运行时问题（P0/P1），其中 **任务链路网络请求缺少硬超时** 是最优先修复项。
- 分层已显著改善，但仍有若干“升级维护成本”风险（controller 体积、单例依赖注入、关键路径测试缺口）。

---

## 3. 关键问题清单（按严重级别）

## P0 - 运行链路可能卡死：轮询与下载缺少硬超时

- 位置：
  - `src/services/runninghub-polling.js:32`
  - `src/services/runninghub.js:30`
  - `src/services/runninghub.js:60`
- 现象：
  - 轮询 `pollTaskOutputCore` 直接 `await fetchImpl(...)`，没有 request timeout。
  - 下载 `downloadResultBinary` 直接 `await fetch(...)`，没有 request timeout。
  - 上层虽有“业务超时”（`timeoutMs`），但它建立在“每轮请求能返回”的前提上；若单次网络请求长时间挂起，循环不会进入下一轮，业务超时逻辑失效。
- 影响：
  - 某个任务在 `REMOTE_RUNNING` 或 `DOWNLOADING` 阶段可能长期不结束。
  - 本地队列并发槽位被占满后，后续任务无法推进（表现为“队列卡住”）。
- 建议：
  - 为 `pollTaskOutputCore`、`downloadResultBinary` 统一接入 `fetchWithTimeout`（已有 `runninghub-runner/request-strategy.js` 可复用）。
  - timeout 错误应规范化为可识别类型，便于 `TIMEOUT_TRACKING` 恢复分支处理。

## P1 - 删除确认在部分环境会被绕过，存在误删风险

- 位置：
  - `src/controllers/settings-controller.js:145`
  - `src/controllers/settings-controller.js:153`
- 现象：
  - `safeConfirm` 在 `confirm` 不可用时默认 `return true`。
- 影响：
  - 在不支持原生 `confirm` 的 UXP 环境，点击删除会直接执行，无任何二次确认，存在数据误删风险（应用/模板）。
- 建议：
  - fallback 改为“阻断删除并提示环境不支持确认”，或改为自定义 modal 二次确认。

## P1 - 数字/布尔输入在“无默认值”时被强行赋值，可能污染任务参数

- 位置：
  - `src/controllers/workspace/input-renderer.js:244`
  - `src/controllers/workspace/input-renderer.js:323`
  - `src/controllers/workspace/input-renderer.js:326`
- 现象：
  - `boolean` 输入若无默认值，初始化为 `false`。
  - `number` 输入若无默认值，初始化为 `0`。
- 影响：
  - 原本“未填写”的可选参数被主动下发，可能改变模型行为（尤其数值阈值类参数）。
  - 用户界面看似未输入，但提交 payload 已包含默认注入值，排障困难。
- 建议：
  - 对“无默认值且非 required”的 number/boolean 保持 `undefined`，仅在用户显式输入后写入状态。
  - 若业务必须给默认值，应在 UI 上可见展示，并在提交摘要中明确提示。

## P2 - 控制器层仍采用模块级单例 gateway，限制测试隔离与后续替换能力

- 位置：
  - `src/controllers/workspace-controller.js:43`
  - `src/controllers/settings-controller.js:66`
  - `src/controllers/tools-controller.js:4`
- 现象：
  - gateway 在模块加载时创建并固化为单例实例。
- 影响：
  - 控制器层难以做细粒度依赖注入测试。
  - 未来如果引入多环境/多实现（mock gateway、灰度 gateway）会增加改造成本。
- 建议：
  - 调整为 `init*Controller({ gateway })` 可选注入，默认走工厂创建。
  - 让 usecase/service 依赖在初始化时组装，而非模块顶层固化。

## P2 - 关键模块体积仍偏大，后续演进风险高

- 位置（行数快照）：
  - `src/services/ps/alignment.js`（2029 行）
  - `src/controllers/workspace-controller.js`（923 行）
  - `src/controllers/settings-controller.js`（589 行）
  - `src/services/runninghub-parser.js`（621 行）
- 现象：
  - 尽管已拆分，但核心文件仍承载过多职责。
- 影响：
  - 每次迭代修改触达面大，回归成本高。
  - 新成员接手成本高，容易产生“局部改动引发全局回归”。
- 建议：
  - 继续按“纯策略/副作用编排/视图更新”三层拆分。
  - 对超大文件建立“最大行数阈值 + 拆分里程碑”治理规则。

## P2 - 高风险路径测试覆盖仍有空洞

- 现状：
  - `runninghub-polling`、`settings-controller`（含删除确认 fallback）与 `workspace input-renderer` 默认值策略缺少针对性自动化断言。
- 影响：
  - 关键路径回归主要依赖手工 smoke，线上边界问题难以及早发现。
- 建议：
  - 增补以下测试：
    - 轮询/下载超时与挂起场景。
    - `safeConfirm` 在 `confirm` 不存在时的行为。
    - number/boolean“无默认值”提交语义（是否应发参数）。

---

## 4. 架构分离评估（针对“后续升级维护”）

### 已达成（正向）

- 控制器直连 `services` 的硬规则已建立并脚本化检查。
- application 层已有可测试策略模块（`run-guard`、`job-scheduler` 等）。
- `ps` facade 契约有测试保护，兼容性意识较好。

### 仍待收口（影响升级效率）

- 控制器仍偏重，且依赖实例构建时机偏早（模块级单例）。
- 部分关键副作用（网络超时、删除确认、默认值注入）尚未形成统一策略。
- 大文件未继续下沉，未来功能叠加时复杂度会再次上升。

---

## 5. 修复优先顺序（建议）

1. 先修 P0：轮询/下载统一超时控制，避免任务链路卡死。
2. 修 P1：删除确认 fallback 与 number/boolean 默认值注入策略。
3. 收口 P2：控制器依赖注入改造 + 大文件继续拆分 + 补关键路径测试。

---

## 6. 可执行验收标准

- 网络层：
  - 任何单次请求超过阈值均可在日志中看到超时错误并进入可恢复状态，不出现“无限等待”。
- 设置层：
  - 在无 `confirm` 环境点击删除不会直接执行删除。
- 工作台输入层：
  - optional number/boolean 在用户未输入时不应被隐式提交。
- 测试层：
  - 新增对应自动化用例并纳入当前最小回归命令。

