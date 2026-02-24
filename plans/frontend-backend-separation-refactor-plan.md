# PixelRunner 前后端逻辑分离重构方案（V1）

- 项目：PixelRunner（RunningHub Photoshop UXP 插件）
- 分支：`refactor/plugin-frontend-backend-separation`
- 日期：2026-02-24
- 目标：将 UI 层、业务编排层、基础设施层解耦，降低页面改造成本，提升功能扩展能力与可测试性。

## 1. 现状分析（基于当前代码）

### 1.1 结构现状
- 启动入口：`index.js` 直接初始化 `workspace/settings/tools` 三个 controller。
- Workspace 核心：`src/controllers/workspace-controller.js`（约 1373 行）同时承担：
  - DOM 渲染与事件绑定
  - 本地状态管理
  - 任务队列调度
  - RunningHub 调用编排
  - Photoshop 回贴编排
- Settings 核心：`src/controllers/settings-controller.js`（约 861 行）同时承担：
  - 设置页 UI
  - 模板导入导出（UXP 文件系统）
  - RunningHub 解析调用
  - 本地存储写入与事件发射
- 服务层：
  - `src/services/runninghub.js` 已具备一定“核心逻辑 + helper 注入”的可测试结构。
  - `src/services/runninghub-parser.js` 与 `src/services/runninghub-runner.js` 仍是超大文件，职责很重。
  - `src/services/ps.js`（约 2647 行）同时包含图像分析、几何变换、工具命令执行等多类职责。
- 存储层：`src/services/store.js` 既有读写，也有迁移逻辑和模板 bundle 逻辑。

### 1.2 关键耦合问题
1. UI 与业务强耦合
- `workspace-controller` 直接调用 `runninghub` 与 `ps`，任务编排逻辑无法脱离 DOM 单测。

2. 控制器过重
- 状态机（按钮状态、任务状态、模板选择）与视图渲染、服务调用混杂，后续页面改版风险高。

3. 重复逻辑存在
- `settings-controller` 与 `workspace-inputs` 内存在长文本处理、长度提示、粘贴处理等重复实现。
- `normalizeUploadMaxEdge / normalizePasteStrategy` 在多个模块重复。

4. 基础能力分散
- 事件是 `document.dispatchEvent` 风格（`src/events.js`），缺乏统一领域事件总线抽象。
- 错误对象和错误码分层不统一（UI/业务/基础设施交叉处理）。

5. 纯业务逻辑与平台能力耦合
- 例如任务流程中同时穿插 `localStorage`、`fetch`、`UXP/PS` 调用，不利于隔离测试。

6. 历史资产治理缺口
- `src/libs/qrcode-generator.js` 目前未被业务引用（仓库中无有效调用），应纳入“废弃资产”治理。

## 2. 重构目标与边界

### 2.1 目标
1. 控制器薄化：仅保留“用户交互 -> 调用用例 -> 渲染视图模型”。
2. 建立明确分层：
- Presentation（UI）
- Application（用例/编排）
- Domain（规则/模型）
- Infrastructure（RunningHub、PS、Storage、UXP 适配器）
3. 业务流程可测试：任务提交、重试、轮询、回贴策略在无 DOM 环境下可测试。
4. 扩展友好：未来增加页面、批处理、任务历史、更多工具时，无需改动核心流程。

### 2.2 非目标（本阶段不做）
- 不改变现有对 RunningHub 的协议行为。
- 不改动 UI 视觉样式（仅架构调整）。
- 不一次性重写所有模块（采用渐进迁移）。

## 3. 目标架构设计

## 3.1 分层模型
- Presentation：页面与交互（Controller/ViewModel/View）
- Application：用例编排（RunTask、ParseApp、ManageSettings）
- Domain：纯规则（输入规范化、状态机、错误模型、fingerprint）
- Infrastructure：外部依赖实现（RunningHub API、PS API、localStorage、UXP FS）

## 3.2 建议目录（渐进落地）

```text
src/
  app/
    bootstrap.js
    container.js
  presentation/
    controllers/
      workspace-controller.js
      settings-controller.js
      tools-controller.js
    viewmodels/
      workspace-vm.js
      settings-vm.js
    views/
      workspace-view.js
      settings-view.js
      modal-view.js
  application/
    usecases/
      run-workflow.js
      sync-workspace-apps.js
      parse-runninghub-app.js
      save-settings.js
      manage-templates.js
    services/
      job-scheduler.js
      run-guard.js
  domain/
    models/
      app.js
      job.js
      template.js
      settings.js
    policies/
      input-policy.js
      prompt-policy.js
      retry-policy.js
    events/
      event-bus.js
    errors/
      app-error.js
  infrastructure/
    gateways/
      runninghub-gateway.js
      photoshop-gateway.js
      storage-gateway.js
      file-gateway.js
    adapters/
      runninghub/
      photoshop/
      storage/
      uxp/
  shared/
    utils/
    constants/
```

## 3.3 核心接口（Port）设计

### RunningHubPort
- `parseApp(appId, apiKey, options)`
- `runTask(apiKey, app, inputValues, options)`
- `pollTask(apiKey, taskId, settings, options)`
- `downloadBinary(url, options)`
- `testApiKey(apiKey)`
- `fetchAccountStatus(apiKey)`

### PhotoshopPort
- `captureSelection(options)`
- `placeImage(buffer, options)`
- `runTool(command, options)`

### StoragePort
- `getApiKey/saveApiKey`
- `getSettings/saveSettings`
- `getApps/saveApps`
- `getTemplates/saveTemplates`

控制器与用例只依赖 Port，不直接依赖 `fetch/localStorage/photoshop/uxp`。

## 3.4 状态与事件设计

### 统一状态（WorkspaceState）
- UI state：`selectedAppId`、`modalState`、`runButtonState`
- Runtime state：`jobs`、`scheduler`、`runGuard`
- Form state：`inputValues`、`imageBounds`

### 事件总线（Domain Event）
- `apps.changed`
- `templates.changed`
- `settings.changed`
- `job.updated`
- `job.completed`
- `job.failed`

保留对 `APP_EVENTS` 的兼容桥接层，避免一次性改动所有监听。

## 4. 模块拆分方案（按现有文件映射）

1. `workspace-controller.js`
- 拆为：
  - `presentation/controllers/workspace-controller.js`（事件绑定 + 调用 usecase）
  - `application/services/job-scheduler.js`（队列/并发/重试）
  - `application/services/run-guard.js`（去重、防连点）
  - `presentation/views/workspace-view.js`（DOM 更新、日志、摘要）

2. `workspace/workspace-inputs.js`
- 拆为：
  - `presentation/views/input-renderer.js`（仅渲染控件）
  - `domain/policies/input-policy.js`（输入类型、默认值、可选项规则）
  - `application/usecases/capture-image-input.js`（调用 PhotoshopPort）

3. `settings-controller.js`
- 拆为：
  - `presentation/controllers/settings-controller.js`（薄控制器）
  - `application/usecases/manage-settings.js`
  - `application/usecases/manage-templates.js`
  - `application/usecases/parse-runninghub-app.js`

4. `services/store.js`
- 拆为：
  - `infrastructure/gateways/storage-gateway.js`（localStorage 读写）
  - `domain/models/settings.js`（normalize/migrate 规则）
  - `domain/models/template.js`（模板规范化与 bundle 规则）

5. `services/runninghub-*.js`
- 保留当前 core 思路，继续按职责拆细：
  - parser：提取“候选源扫描/字段标准化/label 策略”为独立纯函数模块。
  - runner：提取“参数构建/上传策略/重试策略”为独立策略模块。

6. `services/ps.js`
- 按场景拆分：
  - `photoshop/capture.js`
  - `photoshop/place.js`
  - `photoshop/alignment-smart.js`
  - `photoshop/tools.js`
  - `photoshop/common.js`

7. `libs/qrcode-generator.js`
- 标记为 `legacy`，若确认无运行时引用，迁移到 `src/legacy/` 或删除（建议先迁移再观察 1 个版本）。

## 5. 迁移路径（分阶段实施）

## Phase 0：基线与防回归（1-2 天）
- 输出当前行为基线文档（关键流程、关键文案、错误提示）。
- 增加 smoke checklist（手工回归脚本）。
- 新增最小测试入口（Node 原生 `node:test`，先测纯函数）。

验收：基线可复现，核心流程可手工回归。

## Phase 1：任务编排从 Workspace Controller 解耦（2-3 天）
- 抽出 `job-scheduler` 与 `run-guard`。
- Controller 只负责收集输入并触发 usecase。

验收：`workspace-controller` 行数明显下降；任务流程行为不变。

## Phase 2：输入渲染与输入规则分离（2-3 天）
- `workspace-inputs` 分离为 renderer + policy + capture usecase。
- 消除与 settings 页重复的文本处理逻辑。

验收：输入渲染逻辑可单独测试，长文本规则统一。

## Phase 3：Settings 业务下沉（2-3 天）
- 模板导入导出、应用解析、存储读写改为 usecase + gateway。
- Settings controller 仅处理 DOM 事件和提示。

验收：`settings-controller` 只保留交互编排。

## Phase 4：RunningHub 领域策略拆分（3-5 天）
- parser 与 runner 大文件拆分，形成可测纯函数策略模块。
- 统一错误码和错误对象。

验收：parser/runner 可独立单测；失败原因可结构化输出。

## Phase 5：Photoshop 服务模块化（3-5 天）
- 将 `ps.js` 拆分为 capture/place/tool/alignment 子模块。
- 保留 `ps` facade 做兼容导出。

验收：对外 API 不变，内部职责清晰。

## Phase 6：遗留清理与文档（1-2 天）
- 清理未使用资产（含 qrcode 库评估）。
- 更新架构文档与二开指南。

验收：目录结构稳定，二开入口清晰。

## 6. 测试与质量策略

### 6.1 自动化
- 纯函数单测优先覆盖：
  - input schema 规范化
  - parse payload 选择策略
  - run dedup/retry/timeout 策略
  - settings/template migrate 规则
- 目标：新增模块单测覆盖率 >= 70%（按函数分支衡量，不强依赖行覆盖率工具）。

### 6.2 手工回归清单
1. 设置页：保存 API Key、测试连接、解析应用、保存应用。
2. 工作台：选择应用、图像输入、模板插入、运行任务。
3. 运行链路：提交 -> 轮询 -> 下载 -> 回贴。
4. 失败链路：无 API Key、参数缺失、网络失败、超时重试。
5. 工具箱：各工具按钮可用。

## 7. 风险与应对

1. 风险：迁移期事件断链
- 应对：保留 `APP_EVENTS` 兼容桥，逐步切到 event bus。

2. 风险：任务队列行为回归
- 应对：先抽“无副作用策略函数”并加单测，再替换 controller 调用。

3. 风险：PS 回贴行为偏移
- 应对：`ps` facade 保持旧签名；分模块但不改算法参数默认值。

4. 风险：中文文案编码混乱
- 应对：统一 UTF-8 编码策略，新增文案常量文件，避免散落硬编码。

## 8. 里程碑与完成标准

### 里程碑 M1
- 完成 Phase 0-2
- Workspace 主流程“控制器薄化 + 任务编排解耦”落地。

### 里程碑 M2
- 完成 Phase 3-4
- Settings 与 RunningHub 策略分层完成。

### 里程碑 M3
- 完成 Phase 5-6
- PS 模块化与遗留资产治理完成。

### Done 定义
- Controller 不直接调用底层平台 API（通过 usecase/port）。
- 关键业务可在无 DOM 环境执行单测。
- 任务执行主链路回归通过。
- 架构文档和迁移说明更新完成。

## 9. 建议先做的第一批任务（可立即执行）

1. 新建 `application/services/job-scheduler.js`，迁移 `executeJob/pumpJobScheduler`。
2. 新建 `application/services/run-guard.js`，迁移 fingerprint 与连点保护。
3. 在 `workspace-controller` 中改为依赖两个 service，先不改 UI 结构。
4. 增加对应纯函数测试（dedup、timeout-retry、并发选择）。
5. 提交一次小步 PR，确保行为与当前版本一致。

## 10. 当前进度快照（2026-02-24）

### 10.1 代码快照
- 分支：`refactor/plugin-frontend-backend-separation`
- 最近提交：`fa8b52d`（`phase3`）
- 自动化校验（当前最小回归集）：
  - `node --test tests/application/services/*.test.js tests/application/usecases/*.test.js tests/controllers/settings/*.test.js tests/controllers/workspace/*.test.js tests/domain/policies/*.test.js`
  - 结果：`133 passed, 0 failed`

### 10.2 阶段完成度
- Phase 0：部分完成（已建立纯函数测试入口；基线文档/smoke 脚本未单独落地）
- Phase 1：已完成（`job-scheduler`、`run-guard` 已从 `workspace-controller` 解耦）
- Phase 2：已完成（输入策略与文本规则已下沉到 `input-policy/text-input-policy`）
- Phase 3：已完成（Settings 控制器已下沉为 usecase/gateway 编排）
- Phase 4：已完成（`runninghub-parser/runninghub-runner` 策略拆分与结构化错误输出已落地）
- Phase 5：已完成（`ps.js` 已拆分为 `capture/place/tools/alignment` 子模块并保留 facade 兼容导出；已补 facade/shared 自动化测试与 UXP 冒烟验证）
- Phase 6：未开始（`src/libs/qrcode-generator.js` 仍在原位置，未迁移/清理）

### 10.3 接手入口（下一步）
- 直接进入 Phase 6：
  - 清理遗留资产（优先评估 `src/libs/qrcode-generator.js` 是否迁移至 `src/legacy/` 或删除）
  - 更新架构文档与二开指南（补齐 `ps` 拆分后的模块入口说明）
  - 固化最小手工 smoke checklist（记录 UXP 加载、capture/place/tools 的回归步骤）
- 每次推进仅追加一条“进度快照”到本节，保持记录精简（避免长流水）。

### 10.4 进度快照（2026-02-24）
- 本次完成：`runninghub-parser` 已抽离 3 个纯函数策略模块：
  - `src/services/runninghub-parser/source-candidate-strategy.js`（候选源扫描）
  - `src/services/runninghub-parser/label-strategy.js`（label 选择）
  - `src/services/runninghub-parser/json-utils.js`（解析辅助）
- 主文件改造：`src/services/runninghub-parser.js` 已改为组合上述策略模块，`fetchAppInfoCore` 外部行为与签名保持不变。
- 新增单测：
  - `tests/services/runninghub-parser/source-candidate-strategy.test.js`
  - `tests/services/runninghub-parser/label-strategy.test.js`
- 当前回归结果：
  - `node --test tests/application/services/*.test.js tests/application/usecases/*.test.js tests/controllers/settings/*.test.js tests/controllers/workspace/*.test.js tests/domain/policies/*.test.js tests/services/runninghub-parser/*.test.js`
  - `139 passed, 0 failed`
- 阶段状态更新：Phase 4 从“未开始”更新为“进行中（已完成候选源扫描 + label 策略拆分）”；下一步优先拆“字段标准化策略（normalizeInput 相关）”。

### 10.5 进度快照（2026-02-24）
- 本次完成：Phase 3 收口，`settings-controller` 已移除对 `store/runninghub/localStorage` 的直调，改为 usecase 编排 + gateway 注入：
  - 新增 gateway：`src/infrastructure/gateways/settings-gateway.js`
  - 控制器改造：`src/controllers/settings-controller.js` 仅保留事件处理、提示与视图渲染编排
  - 新增/补齐 usecase：
    - `manage-settings`：`loadSettingsSnapshotUsecase`、`getSavedApiKeyUsecase`、`testApiKeyUsecase`
    - `manage-apps`：`listSavedAppsUsecase`、`findSavedAppByIdUsecase`
    - `manage-templates`：`listSavedTemplatesUsecase`、`findSavedTemplateByIdUsecase`
- 新增单测：
  - `tests/application/usecases/manage-settings.test.js`（新增 3 个用例）
  - `tests/application/usecases/manage-apps.test.js`（新增 2 个用例）
  - `tests/application/usecases/manage-templates.test.js`（新增 2 个用例）
- 当前回归结果：
  - `node --test tests/application/usecases/*.test.js tests/application/services/*.test.js tests/controllers/settings/*.test.js tests/controllers/workspace/*.test.js tests/domain/policies/*.test.js tests/services/runninghub-parser/*.test.js`
  - `146 passed, 0 failed`
- 阶段状态更新：Phase 3 从“进行中”更新为“已完成”；下一步回到 Phase 4，继续拆 `runninghub-parser` 的字段标准化策略（`normalizeInput` 相关）。

### 10.6 进度快照（2026-02-24）
- 本次完成：Phase 4 的 `normalizeInput` 字段标准化策略已拆分为独立模块：
  - 新增 `src/services/runninghub-parser/input-normalize-strategy.js`，承接并封装：
    - `normalizeInput`
    - `isGhostSchemaInput`
    - `mergeInputsWithFallback`
    - 以及 options/required/default/type 归一化相关辅助纯函数（模块内私有）
- 主文件改造：`src/services/runninghub-parser.js` 已移除对应内联实现，改为组合 `input-normalize-strategy`；`extractAppInfoPayload` 与 `fetchAppInfoCore` 对外行为和签名保持不变。
- 新增单测：
  - `tests/services/runninghub-parser/input-normalize-strategy.test.js`
- 当前回归结果：
  - `node --test tests/application/usecases/*.test.js tests/application/services/*.test.js tests/controllers/settings/*.test.js tests/controllers/workspace/*.test.js tests/domain/policies/*.test.js tests/services/runninghub-parser/*.test.js`
  - `151 passed, 0 failed`
- 阶段状态更新：Phase 4 保持“进行中”，`runninghub-parser` 已完成“候选源扫描 + label + 字段标准化（normalizeInput）”三块策略拆分；下一步建议转入 `runninghub-runner` 的“参数构建/上传策略/重试策略”拆分。

### 10.7 交接备注（给下一位 AI，2026-02-24）
- 当前 Phase 状态：
  - Phase 3：已完成（settings 侧 usecase/gateway 改造已落地）
  - Phase 4：进行中（`runninghub-parser` 的 source/label/normalizeInput 已完成策略化）
- 本轮关键变更文件：
  - `src/services/runninghub-parser.js`（主解析器改为组合策略模块）
  - `src/services/runninghub-parser/input-normalize-strategy.js`（新增字段标准化策略模块）
  - `tests/services/runninghub-parser/input-normalize-strategy.test.js`（新增单测）
- 建议下一步（直接开工）：
  1. 进入 `runninghub-runner` 拆分，优先抽离“参数构建策略”纯函数。
  2. 继续抽离“上传策略（图片/文件）”与“重试策略（超时/轮询）”。
  3. runner 主文件改为组合策略模块，保持对外签名不变。
  4. 补 `tests/services/runninghub-runner/*.test.js` 并并入最小回归命令。
- 交接校验命令（当前通过）：
  - `node --test tests/application/usecases/*.test.js tests/application/services/*.test.js tests/controllers/settings/*.test.js tests/controllers/workspace/*.test.js tests/domain/policies/*.test.js tests/services/runninghub-parser/*.test.js`
  - 结果：`151 passed, 0 failed`

### 10.8 进度快照（2026-02-24）
- 本次完成：开始进入 `runninghub-runner` 策略拆分，已先抽离“参数构建策略”纯函数模块：
  - 新增 `src/services/runninghub-runner/payload-strategy.js`，承接并封装：
    - `isAiInput`
    - `buildNodeInfoPayload`
    - `resolveRuntimeInputType`
    - `resolveInputValue`
    - `parseBooleanValue`
    - `coerceSelectValue`
    - `getTextLength`
    - `getTailPreview`
- 主文件改造：`src/services/runninghub-runner.js` 已移除上述内联实现，改为组合 `payload-strategy`；`runAppTaskCore` 对外签名与行为保持不变。
- 新增单测：
  - `tests/services/runninghub-runner/payload-strategy.test.js`
- 当前回归结果：
  - `node --test tests/services/runninghub-runner/*.test.js tests/services/runninghub-parser/*.test.js tests/application/usecases/*.test.js tests/application/services/*.test.js tests/controllers/settings/*.test.js tests/controllers/workspace/*.test.js tests/domain/policies/*.test.js`
  - `156 passed, 0 failed`
- 阶段状态更新：Phase 4 保持“进行中”；`runninghub-runner` 已开始策略化，下一步优先拆分“上传策略（uploadImage/resize）”与“重试策略（upload edge retry 判定）”。

### 10.9 进度快照（2026-02-24）
- 本次完成：`runninghub-runner` 继续策略拆分，新增“上传尺寸与重试判定策略”纯函数模块：
  - 新增 `src/services/runninghub-runner/upload-edge-strategy.js`，承接并封装：
    - `normalizeUploadMaxEdge`
    - `getUploadMaxEdgeLabel`
    - `buildUploadMaxEdgeCandidates`
    - `shouldRetryWithNextUploadEdge`
- 主文件改造：`src/services/runninghub-runner.js` 已移除对应内联实现，改为组合 `upload-edge-strategy`；`runAppTaskCore/submitTaskAttempt` 对外签名与行为保持不变。
- 新增单测：
  - `tests/services/runninghub-runner/upload-edge-strategy.test.js`
- 当前回归结果：
  - `node --test tests/services/runninghub-runner/*.test.js tests/services/runninghub-parser/*.test.js tests/application/usecases/*.test.js tests/application/services/*.test.js tests/controllers/settings/*.test.js tests/controllers/workspace/*.test.js tests/domain/policies/*.test.js`
  - `160 passed, 0 failed`
- 阶段状态更新：Phase 4 保持“进行中”；`runninghub-runner` 已完成“参数构建 + upload edge 重试判定”两块策略化，下一步优先拆分“上传执行策略（uploadImage/resizeUploadBufferIfNeeded）”。

### 10.10 进度快照（2026-02-24）
- 本次完成：`runninghub-runner` 继续策略拆分，完成“上传执行策略 + 请求超时策略”模块化：
  - 新增 `src/services/runninghub-runner/request-strategy.js`，承接并封装：
    - `createRunCancelledError`
    - `fetchWithTimeout`
  - 新增 `src/services/runninghub-runner/upload-strategy.js`，承接并封装：
    - `uploadImage`
    - 以及上传链路私有辅助（buffer 归一化、mime 识别、可选缩放、上传结果提取）
- 主文件改造：`src/services/runninghub-runner.js` 已移除对应内联实现，改为组合 `request-strategy/upload-strategy`；`runAppTaskCore` 对外签名与行为保持不变。
- 新增单测：
  - `tests/services/runninghub-runner/request-strategy.test.js`
  - `tests/services/runninghub-runner/upload-strategy.test.js`
- 当前回归结果：
  - `node --test tests/services/runninghub-runner/*.test.js tests/services/runninghub-parser/*.test.js tests/application/usecases/*.test.js tests/application/services/*.test.js tests/controllers/settings/*.test.js tests/controllers/workspace/*.test.js tests/domain/policies/*.test.js`
  - `169 passed, 0 failed`
- 阶段状态更新：Phase 4 保持“进行中”；`runninghub-runner` 已完成“参数构建 + upload edge 重试判定 + 上传执行 + 请求超时控制”四块策略化，下一步可优先拆分 `createAiAppTask/createLegacyTask` 的请求体构建与错误归一化策略。

### 10.11 交接备注（给下一位 AI，2026-02-24）
- 当前 Phase 状态：
  - Phase 3：已完成
  - Phase 4：进行中（runner 已完成多块策略化，主文件显著瘦身）
- 本轮关键变更文件：
  - `src/services/runninghub-runner.js`（改为组合策略模块）
  - `src/services/runninghub-runner/payload-strategy.js`
  - `src/services/runninghub-runner/upload-edge-strategy.js`
  - `src/services/runninghub-runner/request-strategy.js`
  - `src/services/runninghub-runner/upload-strategy.js`
  - `tests/services/runninghub-runner/*.test.js`（新增对应策略单测）
- 交接建议（直接开工）：
  1. 拆分 `createAiAppTask/createLegacyTask` 的请求体构建策略（字段兼容候选、body 组装）。
  2. 拆分错误归一化策略（AI_APP_REJECTED 判定、node validation summary、用户可读错误映射）。
  3. 保持 `runAppTaskCore` 对外签名不变，仅做内部组合替换。
  4. 继续并入最小回归命令，确保 runner 策略模块单测持续覆盖。
- 交接校验命令（当前通过）：
  - `node --test tests/services/runninghub-runner/*.test.js tests/services/runninghub-parser/*.test.js tests/application/usecases/*.test.js tests/application/services/*.test.js tests/controllers/settings/*.test.js tests/controllers/workspace/*.test.js tests/domain/policies/*.test.js`
  - 结果：`169 passed, 0 failed`

### 10.12 进度快照（2026-02-24）
- 本次完成：`runninghub-runner` 继续策略拆分，完成“请求体构建策略 + 错误归一化策略”模块化：
  - 新增 `src/services/runninghub-runner/task-request-strategy.js`，承接并封装：
    - `buildAiAppRunBodyCandidates`
    - `buildLegacyCreateTaskBody`
    - `parseTaskId`
    - `getTaskCreationOutcome`
    - `getBodyVariantMarker`
  - 新增 `src/services/runninghub-runner/task-error-strategy.js`，承接并封装：
    - `fallbackToMessage`
    - `extractNodeValidationSummary`
    - `toAiAppErrorMessage`
    - `isParameterShapeError`
    - `createAiAppRejectedError`
    - `normalizeAiAppFailure`
    - `buildAiAppExceptionReason`
- 主文件改造：`src/services/runninghub-runner.js` 已移除 `createAiAppTask/createLegacyTask` 中对应内联逻辑，改为组合 `task-request-strategy/task-error-strategy`；`runAppTaskCore` 对外签名与行为保持不变。
- 新增单测：
  - `tests/services/runninghub-runner/task-request-strategy.test.js`
  - `tests/services/runninghub-runner/task-error-strategy.test.js`
- 当前回归结果：
  - `node --test tests/services/runninghub-runner/*.test.js tests/services/runninghub-parser/*.test.js tests/application/usecases/*.test.js tests/application/services/*.test.js tests/controllers/settings/*.test.js tests/controllers/workspace/*.test.js tests/domain/policies/*.test.js`
  - `181 passed, 0 failed`
- 阶段状态更新：Phase 4 保持“进行中”；`runninghub-runner` 已完成“参数构建 + upload edge 重试判定 + 上传执行 + 请求超时控制 + 请求体构建 + 错误归一化”六块策略化，下一步可优先继续收敛 `submitTaskAttempt` 内参数校验与日志拼装策略，进一步压缩主文件职责。

### 10.13 进度快照（2026-02-24）
- 本次完成：`runninghub-runner` 继续策略拆分，完成“输入校验策略 + 文本参数日志策略 + 空白图占位 token 策略”模块化：
  - 新增 `src/services/runninghub-runner/input-validation-strategy.js`，承接并封装：
    - `createLocalValidationError`
    - `collectMissingRequiredImageInputs`
    - `coerceNonImageInputValue`
  - 新增 `src/services/runninghub-runner/text-payload-log-strategy.js`，承接并封装：
    - `buildTextPayloadDebugEntry`
    - `emitTextPayloadDebugLog`
  - 新增 `src/services/runninghub-runner/blank-image-strategy.js`，承接并封装：
    - `createBlankImageTokenProvider`
- 主文件改造：`src/services/runninghub-runner.js` 已移除 `submitTaskAttempt` 中对应内联实现，改为组合上述 3 个策略模块；`runAppTaskCore` 对外签名与行为保持不变。
- 新增单测：
  - `tests/services/runninghub-runner/input-validation-strategy.test.js`
  - `tests/services/runninghub-runner/text-payload-log-strategy.test.js`
  - `tests/services/runninghub-runner/blank-image-strategy.test.js`
- 当前回归结果：
  - `node --test tests/services/runninghub-runner/*.test.js tests/services/runninghub-parser/*.test.js tests/application/usecases/*.test.js tests/application/services/*.test.js tests/controllers/settings/*.test.js tests/controllers/workspace/*.test.js tests/domain/policies/*.test.js`
  - `190 passed, 0 failed`
- 阶段状态更新：Phase 4 保持“进行中”；`runninghub-runner` 主流程中的请求组装、错误归一化、输入校验、上传策略、日志策略已完成模块化，下一步可优先抽离 `submitTaskAttempt` 的“AI 优先/legacy fallback 提交决策策略”，继续瘦身主文件控制流。

### 10.14 进度快照（2026-02-24）
- 本次完成：`runninghub-runner` 继续策略拆分，完成“AI 优先 + legacy 回退提交决策策略”模块化：
  - 新增 `src/services/runninghub-runner/submit-decision-strategy.js`，承接并封装：
    - `hasAiPayload`
    - `hasLegacyPayload`
    - `submitTaskWithAiFallback`
- 主文件改造：`src/services/runninghub-runner.js` 已移除 `submitTaskAttempt` 中对应内联控制流，改为组合 `submit-decision-strategy`；`runAppTaskCore` 对外签名与行为保持不变。
- 新增单测：
  - `tests/services/runninghub-runner/submit-decision-strategy.test.js`
- 当前回归结果：
  - `node --test tests/services/runninghub-runner/*.test.js tests/services/runninghub-parser/*.test.js tests/application/usecases/*.test.js tests/application/services/*.test.js tests/controllers/settings/*.test.js tests/controllers/workspace/*.test.js tests/domain/policies/*.test.js`
  - `195 passed, 0 failed`
- 阶段状态更新：Phase 4 保持“进行中”；`runninghub-runner` 的主流程控制流已进一步模块化，下一步可优先抽离 `createAiAppTask/createLegacyTask` 里的网络调用执行器（请求发送 + 结果解析的共用模板），减少重复样板。

### 10.15 进度快照（2026-02-24）
- 本次完成：`runninghub-runner` 继续策略拆分，完成“任务创建网络请求执行器”模块化：
  - 新增 `src/services/runninghub-runner/request-executor-strategy.js`，承接并封装：
    - `resolveRunnerHelpers`
    - `postJsonRequest`
- 主文件改造：`src/services/runninghub-runner.js` 中 `createAiAppTask/createLegacyTask` 已移除重复的 helper 解析和请求发送样板，改为组合 `request-executor-strategy`；`runAppTaskCore` 对外签名与行为保持不变。
- 新增单测：
  - `tests/services/runninghub-runner/request-executor-strategy.test.js`
- 当前回归结果：
  - `node --test tests/services/runninghub-runner/*.test.js tests/services/runninghub-parser/*.test.js tests/application/usecases/*.test.js tests/application/services/*.test.js tests/controllers/settings/*.test.js tests/controllers/workspace/*.test.js tests/domain/policies/*.test.js`
  - `198 passed, 0 failed`
- 阶段状态更新：Phase 4 保持“进行中”；runner 侧核心流程已基本策略化，下一步可优先考虑统一 `createAiAppTask/createLegacyTask` 的错误映射输出结构（便于上层 UI 精细化提示）。

### 10.16 进度快照（2026-02-24）
- 本次完成：`runninghub-runner` 继续策略拆分，完成“结构化错误对象策略 + 主流程行为测试补齐”：
  - 新增 `src/services/runninghub-runner/error-shape-strategy.js`，承接并封装：
    - `attachErrorMeta`
    - `createRunnerError`
    - `createAiAppTaskCreationError`
    - `createLegacyTaskCreationError`
    - `createTaskSubmissionFailedError`
- 主文件改造：`src/services/runninghub-runner.js` 已将远程任务创建失败与兜底提交失败改为结构化错误对象输出（保留原有 message，不改变外部签名）：
  - AI 创建失败：`AI_APP_TASK_CREATE_FAILED`（含 `reasons`）
  - Legacy 创建失败：`LEGACY_TASK_CREATE_FAILED`（含 `channel/responseStatus/apiResult`）
  - 提交兜底失败：`TASK_SUBMISSION_FAILED`
- 新增单测：
  - `tests/services/runninghub-runner/error-shape-strategy.test.js`
  - `tests/services/runninghub-runner/run-app-task-core.test.js`（补 `runAppTaskCore` 行为级断言）
- 当前回归结果：
  - `node --test tests/services/runninghub-runner/*.test.js tests/services/runninghub-parser/*.test.js tests/application/usecases/*.test.js tests/application/services/*.test.js tests/controllers/settings/*.test.js tests/controllers/workspace/*.test.js tests/domain/policies/*.test.js`
  - `205 passed, 0 failed`
- 阶段状态更新：Phase 4 保持“进行中（接近收尾）”；parser/runner 策略拆分与结构化错误输出已基本落地，下一步以“统一跨模块错误码语义 + 补少量端到端失败链路测试”作为收口重点。

### 10.17 进度快照（2026-02-24）
- 本次完成：`runninghub-parser` 收口补强，完成“解析失败结构化错误”策略落地：
  - 新增 `src/services/runninghub-parser/parse-error-strategy.js`，承接并封装：
    - `createParseAppFailedError`
- 主文件改造：`src/services/runninghub-parser.js` 的最终失败分支已改为抛出结构化错误：
  - `PARSE_APP_FAILED`（含 `appId/endpoint/reasons/retryable`）
  - 保留原有 message，不改变 `fetchAppInfoCore` 对外签名
- 新增单测：
  - `tests/services/runninghub-parser/parse-error-strategy.test.js`
  - `tests/services/runninghub-parser/fetch-app-info-core.test.js`（补 `fetchAppInfoCore` 失败链路断言）
- 当前回归结果：
  - `node --test tests/services/runninghub-runner/*.test.js tests/services/runninghub-parser/*.test.js tests/application/usecases/*.test.js tests/application/services/*.test.js tests/controllers/settings/*.test.js tests/controllers/workspace/*.test.js tests/domain/policies/*.test.js`
  - `207 passed, 0 failed`
- 阶段状态更新：Phase 4 保持“进行中（高完成度）”；parser/runner 的策略拆分与结构化失败输出均已落地，剩余工作以“统一错误语义字典 + 少量跨层回归用例收口”为主。

### 10.18 进度快照（2026-02-24）
- 本次完成：Phase 4 收口补强，完成“统一错误码来源 + 跨层失败链路测试”：
  - 新增 `src/services/runninghub-error-codes.js`，集中维护 parser/runner/common 共享错误码常量
  - 相关模块改造为统一常量来源：
    - `src/services/runninghub-runner/request-strategy.js`
    - `src/services/runninghub-runner/upload-edge-strategy.js`
    - `src/services/runninghub-runner/task-error-strategy.js`
    - `src/services/runninghub-runner/input-validation-strategy.js`
    - `src/services/runninghub-runner/error-shape-strategy.js`
    - `src/services/runninghub-runner/submit-decision-strategy.js`
    - `src/services/runninghub-runner.js`
    - `src/services/runninghub-parser/parse-error-strategy.js`
    - `src/services/runninghub-common.js`
- 新增/补强失败链路测试：
  - `tests/services/runninghub-runner/run-app-task-core.test.js`（新增 `AI_APP_REJECTED` 透传、`RUN_CANCELLED` 透传、`localValidation` 非重试终止断言）
  - `tests/services/runninghub-parser/fetch-app-info-core.test.js`（`PARSE_APP_FAILED` 结构化断言）
- 当前回归结果：
  - `node --test tests/services/runninghub-runner/*.test.js tests/services/runninghub-parser/*.test.js tests/application/usecases/*.test.js tests/application/services/*.test.js tests/controllers/settings/*.test.js tests/controllers/workspace/*.test.js tests/domain/policies/*.test.js`
  - `210 passed, 0 failed`
- 阶段状态更新：Phase 4 更新为“已完成”；验收项“parser/runner 可独立单测 + 失败原因结构化输出”已满足。

### 10.19 进度快照（2026-02-24）
- 本次完成：Phase 5 启动，`ps` 服务完成模块拆分并保留兼容 facade：
  - 新增模块：
    - `src/services/ps/shared.js`（公共工具与 paste strategy 归一化）
    - `src/services/ps/capture.js`（`captureSelection`）
    - `src/services/ps/place.js`（`placeImage` 编排）
    - `src/services/ps/alignment.js`（smart/smartEnhanced 对齐策略与几何对齐）
    - `src/services/ps/tools.js`（工具菜单调用与图层辅助工具）
  - 兼容导出：
    - `src/services/ps.js` 已改为 facade，继续对外导出 `captureSelection/placeImage/createNeutralGrayLayer/createObserverLayer/stampVisibleLayers/runGaussianBlur/runSharpen/runHighPass/runContentAwareFill`
- 质量校验：
  - 语法校验：`node --check src/services/ps.js src/services/ps/shared.js src/services/ps/capture.js src/services/ps/alignment.js src/services/ps/place.js src/services/ps/tools.js`
  - 全量回归集：
    - `node --test tests/services/runninghub-runner/*.test.js tests/services/runninghub-parser/*.test.js tests/application/usecases/*.test.js tests/application/services/*.test.js tests/controllers/settings/*.test.js tests/controllers/workspace/*.test.js tests/domain/policies/*.test.js`
    - `210 passed, 0 failed`
- 阶段状态更新：Phase 5 从“未开始”更新为“进行中”；下一步优先补 `ps` facade 导出契约测试，并在 UXP 环境完成 capture/place/tools 冒烟回归。

### 10.20 进度快照（2026-02-24）
- 本次完成：Phase 5 补齐 `ps` facade 导出契约测试（Node 环境可执行、无 Photoshop 依赖）：
  - 新增 `tests/services/ps/facade.test.js`，覆盖：
    - facade 导出集合稳定性断言（9 个公开方法）
    - facade 与拆分子模块导出函数同一性断言（`capture/place/tools`）
  - 测试方案：通过 `Module._load` 注入 `photoshop/uxp` mock，避免 UXP runtime 依赖。
- 当前回归结果：
  - `node --test tests/services/ps/*.test.js tests/services/runninghub-runner/*.test.js tests/services/runninghub-parser/*.test.js tests/application/usecases/*.test.js tests/application/services/*.test.js tests/controllers/settings/*.test.js tests/controllers/workspace/*.test.js tests/domain/policies/*.test.js`
  - `212 passed, 0 failed`
- 阶段状态更新：Phase 5 保持“进行中”；“对外 API 不变”验收项已具备自动化契约保障。下一步建议在 UXP 环境补 capture/place/tools 冒烟回归并记录结果。

### 10.21 进度快照（2026-02-24）
- 本次完成：Phase 5 继续补齐 `ps` 基础能力单测，新增 `shared` 纯函数覆盖：
  - 新增 `tests/services/ps/shared.test.js`，覆盖：
    - `createAbortError/isAbortError/isTimeoutError`
    - `withTimeout`
    - `toPixelNumber/getDocSizePx`
    - `normalizePasteStrategy`
    - `clampNumber/lerpNumber/wrapAngleDegrees`
- 当前回归结果：
  - `node --test tests/services/ps/*.test.js tests/services/runninghub-runner/*.test.js tests/services/runninghub-parser/*.test.js tests/application/usecases/*.test.js tests/application/services/*.test.js tests/controllers/settings/*.test.js tests/controllers/workspace/*.test.js tests/domain/policies/*.test.js`
  - `221 passed, 0 failed`
- 阶段状态更新：Phase 5 保持“进行中”；`ps` facade 契约与 shared 基础策略已具备自动化回归保护，下一步建议在 UXP 环境完成 capture/place/tools 冒烟验证并记录结果。

### 10.22 进度快照（2026-02-24）
- 本次完成：补充 Phase 5 收口验证，修复“插件在 PS 中不显示”问题并完成提交：
  - 关键修复：清理 `manifest.json/index.html` 及 `ps` 相关模块文件的 UTF-8 BOM，消除插件清单解析与启动加载风险
  - 提交记录：`1b12f89`（`phase5-1`）
- UXP 冒烟验证（用户实测反馈）：
  - 插件已可正常显示与加载
  - 当前主要功能链路“基本正常”（workspace + tools 主流程可用）
- 阶段状态更新：Phase 5 从“进行中”更新为“已完成”；下一步进入 Phase 6（遗留清理与文档收口）。

### 10.23 进度快照（2026-02-24）
- 本次完成：Phase 6 收口落地（Task 1~4）：
  - 遗留资产审计：确认 `qrcode-generator` 运行时引用数为 0（静态/动态检索均无命中）
  - 文档收口：`README.md` 新增“PS 模块边界 + 二开入口 + 手工 smoke checklist”
  - 规则固化：`README.md` 新增 R1~R4，`src/diagnostics/ps-env-doctor.js` 对齐 `ps` facade 导出契约（新增 `REQUIRED_PS_EXPORTS`）
  - 遗留处置：`src/libs/qrcode-generator.js` 迁移至 `src/legacy/qrcode-generator.js`，并新增 `src/legacy/README.md`
- 当前回归结果：
  - `node --test tests/services/ps/*.test.js tests/services/runninghub-runner/*.test.js tests/services/runninghub-parser/*.test.js tests/application/usecases/*.test.js tests/application/services/*.test.js tests/controllers/settings/*.test.js tests/controllers/workspace/*.test.js tests/domain/policies/*.test.js`
  - `222 passed, 0 failed`
- 阶段状态更新：Phase 6 从“未开始”更新为“已完成”；M3（Phase 5-6）收口。

### 10.24 进度快照（2026-02-24）
- 本次完成：补充 Phase 6 手工验证记录（用户实测反馈）：
  - 反馈内容：简单测试功能无明显问题
  - 结论：主功能链路当前可用，未发现新增阻断缺陷
- 阶段状态更新：Phase 6 维持“已完成”；进入归档提交阶段（`phase6`）。

### 10.25 进度快照（2026-02-25）
- 本次完成：基于重构后代码审查，新增“审查问题执行清单”并固化关键决策：
  - 新增任务清单（本文件第 11 节，6 个问题，含优先级、验收、执行顺序）
  - 固化决策：
    - 手动参数配置不下线，作为必须修复项
    - 去重策略改为“弱去重”，允许用户主动重复提交
    - `controller` 不直连 `services` 设为硬规则（需自动检查）
- 阶段状态更新：进入“重构后治理收口”阶段（按 AR-01 ~ AR-06 执行）。

### 10.26 进度快照（2026-02-24）
- 本次完成：按产品策略调整，手动参数配置改为下线：
  - 设置页移除手动参数配置入口（`manualConfigArea/btnAddParam/btnSaveManualApp`）
  - `settings-controller` 移除手动参数状态、渲染与保存链路
  - 删除手动配置相关 usecase / view / tests / style
- 决策修订：
  - 冻结项 #1 从“手动参数配置不下线”修订为“手动参数配置下线，统一走自动解析 + 失败提示”
- 阶段状态更新：AR-01 改为“下线收口”定义并标记完成。

## 11. 重构后审查任务清单（AR）

### 11.1 决策冻结（2026-02-24，修订）
1. 手动参数配置下线，设置页不再提供手动参数新增/编辑/保存入口。
2. 去重策略采用“弱去重”：拦截误触连点，但允许用户主动重复提交。
3. `controller` 不直接依赖 `services` 设为硬规则，纳入自动检查。

### 11.2 任务总览（用于跟踪）

| ID | 问题 | 优先级 | 状态 | 依赖 |
| --- | --- | --- | --- | --- |
| AR-01 | 手动参数配置链路下线（统一自动解析） | P0 | DONE | 无 |
| AR-02 | 去重策略过强且指纹误判风险（改弱去重） | P1 | DONE | 无 |
| AR-03 | 结构化解析错误在 usecase 层被降级丢失 | P1 | DONE | 无 |
| AR-04 | controller 仍直连 services，分层规则未收口 | P0 | DONE | AR-03 |
| AR-05 | 冗余文件：`src/services/ps/index.js` | P2 | DONE | AR-04 |
| AR-06 | README 项目结构描述与代码现状不一致 | P2 | DONE | AR-04, AR-05 |

### 11.3 任务明细与验收

#### AR-01 手动参数配置链路下线（P0）
- 目标：
  - 统一应用接入路径为自动解析；下线手动参数配置入口，降低误用与维护成本。
- 实施：
  - 删除 `manualConfigArea/btnAddParam/btnSaveManualApp` UI 与绑定。
  - 删除手动参数相关 usecase、view、测试与样式。
  - 解析失败仅展示失败信息与诊断指引（保持 parse debug 可用）。
- 验收：
  - 设置页无手动参数配置入口；解析失败时仅显示失败提示，不再出现手动保存链路。

#### AR-02 弱去重策略改造（P1）
- 目标：
  - 防误触连点，不阻止用户主动重复提交任务。
- 实施：
  - 将 dedup 从强拦截改为弱拦截（极短窗口仅防误触）。
  - 若保留指纹，仅用于提示/日志，不作为强阻断条件。
  - 补测试：`run-guard` 与 `submit-workspace-job` 的行为断言。
- 验收：
  - 快速双击仍被拦截；用户短时间重复提交可成功进入队列。

#### AR-03 结构化错误透传（P1）
- 目标：
  - 保留 parser 结构化错误（`code/reasons/retryable`）到控制层。
- 实施：
  - `parse-runninghub-app` 不再仅 `throw new Error(message)`，需透传元信息。
  - 控制层文案友好展示，日志/诊断保留结构化字段。
  - 补跨层失败链路测试。
- 验收：
  - 控制层可读取 `PARSE_APP_FAILED` 等错误码与原因列表。

#### AR-04 硬规则落地：controller 禁止直连 services（P0）
- 目标：
  - controller 仅依赖 usecase/application service/gateway。
- 实施：
  - workspace/tools 迁移直连 `store/runninghub/ps` 为中间层依赖。
  - 新增依赖方向检查脚本并纳入预检/CI。
- 验收：
  - `src/controllers/**/*.js` 无 `require("../services/*")`（或等效路径）。

#### AR-05 冗余文件清理（P2）
- 目标：
  - 清理重复导出入口，避免维护歧义。
- 实施：
  - 删除 `src/services/ps/index.js`（确认无引用后）。
  - 统一 `ps` 对外入口为 `src/services/ps.js` facade。
- 验收：
  - 全量测试通过，且仓库内无 `ps/index.js` 运行时依赖。

#### AR-06 README 同步（P2）
- 目标：
  - 文档结构与当前代码分层一致，降低接手成本。
- 实施：
  - 更新 README 的项目结构图、二开入口与规则说明。
  - 写明“controller 禁止直连 services”硬规则与检查命令。
- 验收：
  - 新人仅看 README 可定位扩展入口并执行最小预检。

### 11.4 推荐执行顺序
1. Iteration A：AR-01 -> AR-04（先修可用性与架构边界）
2. Iteration B：AR-02 -> AR-03（行为策略与错误可观测性）
3. Iteration C：AR-05 -> AR-06（清理与文档收口）

### 11.5 每项任务记录模板

```text
### [AR-XX] 进度快照（YYYY-MM-DD）
- 本次完成：
  - ...
- 变更文件：
  - ...
- 校验命令：
  - ...
- 结果：
  - ... passed, 0 failed
- 风险/遗留：
  - ...
- 下一步：
  - ...
```

### [AR-01] 进度快照（2026-02-24）
- 本次完成：
  - 修复解析失败后的手动参数配置链路：补齐 `btnAddParam/btnSaveManualApp` 事件绑定、手动参数列表渲染、参数增删改状态管理与保存流程。
  - 新增手动参数规范化与校验用例，保证保存后的输入结构与 workspace 动态输入渲染契约一致（`key/name/label/type/required/default/options`）。
  - 为手动参数列表新增专用视图模块与样式，确保设置页可操作性（可新增、删除、编辑参数并保存为应用）。
- 变更文件：
  - `src/controllers/settings-controller.js`
  - `src/application/usecases/manual-app-config.js`
  - `src/controllers/settings/manual-params-view.js`
  - `style.css`
  - `tests/application/usecases/manual-app-config.test.js`
  - `tests/controllers/settings/manual-params-view.test.js`
- 校验命令：
  - `node --test tests/application/usecases/*.test.js tests/controllers/settings/*.test.js`
  - `node --test tests/controllers/workspace/*.test.js`
- 结果：
  - `65 passed, 0 failed`
  - `11 passed, 0 failed`
- 风险/遗留：
  - 当前自动化覆盖了手动参数规范化与视图渲染，未在 Node 环境执行 `settings-controller` 直接加载（依赖 UXP/Photoshop 运行时模块）。
  - 建议在 UXP 环境按“解析失败 -> 手动配置 -> 保存 -> workspace 选择并渲染输入”做一次端到端冒烟确认。
- 下一步：
  - 进入 AR-02（弱去重策略改造），并与 AR-01 一起做一次提交链路联调验证。

### [AR-01] 进度快照（2026-02-24）
- 本次完成：
  - 按决策修订彻底下线手动参数配置：移除设置页手动配置 UI、控制器事件与状态、手动保存流程。
  - 清理对应代码资产：删除手动参数专用 usecase/view/test，移除相关样式。
  - 文档同步：更新 11.1 决策冻结、11.2 跟踪项、11.3 AR-01 明细为“下线收口”版本。
- 变更文件：
  - `index.html`
  - `src/controllers/settings-controller.js`
  - `style.css`
  - `plans/frontend-backend-separation-refactor-plan.md`
  - `src/application/usecases/manual-app-config.js`（删除）
  - `src/controllers/settings/manual-params-view.js`（删除）
  - `tests/application/usecases/manual-app-config.test.js`（删除）
  - `tests/controllers/settings/manual-params-view.test.js`（删除）
- 校验命令：
  - `node --test tests/application/usecases/*.test.js tests/controllers/settings/*.test.js`
  - `node --test tests/controllers/workspace/*.test.js`
- 结果：
  - `67 passed, 0 failed`
- 风险/遗留：
  - 手动兜底链路已移除；解析失败时只能通过修正 appId/API key、查看 parse debug、等待 AR-03 错误透传优化来定位问题。
- 下一步：
  - 进入 AR-02（弱去重策略改造）。

### [AR-02] 进度快照（2026-02-24）
- 本次完成：
  - 去重策略从“强阻断”改为“弱去重提示”：`submit-workspace-job` 不再因短时重复指纹返回 `duplicate` 阻断，而是继续创建并入队任务。
  - 保留指纹检测用于提示语义：当命中短时重复指纹时返回 `duplicateHint`，控制层仅提示“短时重复提交，已继续入队”。
  - 将 dedup 窗口收敛为极短窗口（`800ms`），用于误触防护，不再阻断用户主动重复提交。
  - 补齐 AR-02 相关自动化断言：`run-guard` 与 `submit-workspace-job` 行为测试覆盖弱去重路径。
- 变更文件：
  - `src/application/services/run-guard.js`
  - `src/application/usecases/submit-workspace-job.js`
  - `src/controllers/workspace-controller.js`
  - `tests/application/services/run-guard.test.js`
  - `tests/application/usecases/submit-workspace-job.test.js`
  - `plans/frontend-backend-separation-refactor-plan.md`
- 校验命令：
  - `node --test tests/application/services/run-guard.test.js tests/application/usecases/submit-workspace-job.test.js tests/application/services/run-button.test.js tests/controllers/workspace/*.test.js`
  - `node --test tests/application/services/*.test.js tests/application/usecases/*.test.js tests/controllers/workspace/*.test.js`
- 结果：
  - `27 passed, 0 failed`
  - `114 passed, 0 failed`
- 风险/遗留：
  - 目前 `workspace-controller` 仍无 Node 层控制器级自动化（受 DOM/运行时依赖限制），`duplicateHint` 的 UI 提示分支主要依赖集成运行验证。
- 下一步：
  - 进入 AR-03（结构化错误透传），保持 parser 错误元信息跨层可见。

### [AR-03] 进度快照（2026-02-24）
- 本次完成：
  - 修复 usecase 层错误降级：`parse-runninghub-app` 捕获 `runninghub.fetchAppInfo` 异常时，不再 `new Error(message)` 覆盖原错误，而是透传并保留 `code/retryable/reasons/appId/endpoint` 元信息。
  - 控制层增强失败可观测性：设置页解析失败时除用户可读失败提示外，新增结构化诊断输出（`code/appId/endpoint/retryable/reasons`）到 Env Doctor 输出区。
  - 失败视图增强：解析失败结果区域支持展示结构化错误元信息（错误码、可重试标记、原因列表）。
  - 补齐跨层失败链路测试：覆盖“parser 结构化错误 -> usecase 透传 -> 控制层展示/诊断映射”关键断言。
- 变更文件：
  - `src/application/usecases/parse-runninghub-app.js`
  - `src/application/services/settings-parse-result.js`
  - `src/controllers/settings-controller.js`
  - `src/controllers/settings/parse-result-view.js`
  - `tests/application/usecases/parse-runninghub-app.test.js`
  - `tests/application/services/settings-parse-result.test.js`
  - `tests/controllers/settings/parse-result-view.test.js`
  - `plans/frontend-backend-separation-refactor-plan.md`
- 校验命令：
  - `node --test tests/application/usecases/parse-runninghub-app.test.js tests/application/services/settings-parse-result.test.js tests/controllers/settings/parse-result-view.test.js tests/controllers/settings/*.test.js`
  - `node --test tests/application/services/*.test.js tests/application/usecases/*.test.js tests/controllers/settings/*.test.js tests/controllers/workspace/*.test.js tests/domain/policies/*.test.js`
- 结果：
  - `28 passed, 0 failed`
  - `145 passed, 0 failed`
- 风险/遗留：
  - `settings-controller` 仍缺少 Node 侧控制器级自动化，当前对“失败后 Env Doctor 输出写入”的验证主要通过服务层与视图层单测间接覆盖。
- 下一步：
  - 进入 AR-04（controller 禁止直连 services 硬规则落地）。

### [AR-04] 进度快照（2026-02-24）
- 本次完成：
  - 移除 controller 对 `services` 的直连依赖：
    - `workspace-controller` 不再直接 `require("../services/store|runninghub|ps")`，改为通过 `workspace-gateway` 获取依赖。
    - `tools-controller` 不再直接 `require("../services/ps.js")`，改为通过 `workspace-gateway` 获取 Photoshop 能力。
  - 新增硬规则检查脚本：`scripts/check-controller-service-deps.js`，静态扫描 `src/controllers/**/*.js`，若出现 `../services/*` 直连则失败退出。
  - 将规则纳入预检文档：`README` 补充“controller 禁止直连 services”强制约束，并把检查脚本加入发布前最小预检命令。
  - 补齐检查脚本自动化测试：覆盖“合法依赖通过 / 非法依赖报错 / 输出格式”。
- 变更文件：
  - `src/infrastructure/gateways/workspace-gateway.js`
  - `src/controllers/workspace-controller.js`
  - `src/controllers/tools-controller.js`
  - `scripts/check-controller-service-deps.js`
  - `tests/scripts/check-controller-service-deps.test.js`
  - `README.md`
  - `plans/frontend-backend-separation-refactor-plan.md`
- 校验命令：
  - `node scripts/check-controller-service-deps.js`
  - `node --test tests/scripts/check-controller-service-deps.test.js`
  - `node --check src/controllers/workspace-controller.js src/controllers/tools-controller.js src/infrastructure/gateways/workspace-gateway.js scripts/check-controller-service-deps.js`
  - `node --test tests/application/services/*.test.js tests/application/usecases/*.test.js tests/controllers/settings/*.test.js tests/controllers/workspace/*.test.js tests/domain/policies/*.test.js tests/scripts/*.test.js`
- 结果：
  - `Controller dependency check passed: no direct services import.`
  - `3 passed, 0 failed`
  - `148 passed, 0 failed`
- 风险/遗留：
  - 当前“纳入 CI”先以预检脚本落地，仓库尚无现成 CI workflow；若后续接入 CI，需要将该脚本加入 pipeline 必跑阶段。
- 下一步：
  - 进入 AR-05（清理冗余文件 `src/services/ps/index.js`）。

### [AR-05] 进度快照（2026-02-24）
- 本次完成：
  - 删除冗余入口文件 `src/services/ps/index.js`，统一 Photoshop 能力入口为 `src/services/ps.js` facade。
  - 扫描 `src` / `tests` / `scripts` / `README.md` 下 `ps/index` 关键字，确认无运行时依赖残留。
- 变更文件：
  - `src/services/ps/index.js`（删除）
  - `plans/frontend-backend-separation-refactor-plan.md`
- 校验命令：
  - `rg -n "ps/index" src tests scripts README.md`
  - `node scripts/check-controller-service-deps.js`
  - `node --test tests/services/ps/*.test.js tests/controllers/workspace/*.test.js tests/controllers/settings/*.test.js tests/scripts/*.test.js`
- 结果：
  - `No runtime references to ps/index`
  - `Controller dependency check passed: no direct services import.`
  - `45 passed, 0 failed`
- 风险/遗留：
  - 当前无 `ps/index` 直接依赖；后续如新增目录入口，需继续以 `src/services/ps.js` 作为唯一 facade 导出。
- 下一步：
  - 进入 AR-06（README 结构与规则同步收口）。

### [AR-06] 进度快照（2026-02-24）
- 本次完成：
  - README 项目结构图同步到当前仓库分层（`application/domain/infrastructure/legacy/scripts/tests`）。
  - 新增“分层依赖规则（强制）”段落，明确 `controller` 禁止直连 `services`，并写明检查命令 `node scripts/check-controller-service-deps.js`。
  - 发布预检章节新增强制规则 `R4`（controller 依赖方向），并将最小预检顺延为 `R5`。
- 变更文件：
  - `README.md`
  - `plans/frontend-backend-separation-refactor-plan.md`
- 校验命令：
  - `node scripts/check-controller-service-deps.js`
  - `node --test tests/scripts/check-controller-service-deps.test.js`
- 结果：
  - `Controller dependency check passed: no direct services import.`
  - `3 passed, 0 failed`
- 风险/遗留：
  - README 已与当前目录和依赖规则对齐；如后续继续重构目录，需同步更新“项目结构 / 分层依赖规则 / 发布预检”三处文档。
- 下一步：
  - AR-05 与 AR-06 已完成，进入治理阶段归档或下一轮审查项。

---

如果按本方案执行，重构将是“逐层替换”而不是“整包重写”，能在不中断现有插件可用性的前提下，持续降低复杂度并提升后续页面优化效率。
