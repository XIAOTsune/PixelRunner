# PixelRunner RunningHub 积分与预设持久化修复交接

更新时间：2026-11-11

## 新对话执行指令

请以本文作为已确认需求，先检查当前工作区改动，再直接完成代码、内置指南和回归测试。不要重新做一轮需求确认。保留工作区中已有的用户改动；遇到无法从当前公开文档确认的 RunningHub 账户字段语义时，采用本文列出的保守显示方式，并把该不确定性写入最终说明。

本轮不只是产出方案。目标是在当前插件中完成积分展示、RunningHub 错误码任务卡片说明、内置指南更新，以及提示词预设与资料包快照的一致性修复。

## 已确认需求

1. 工作台账户卡片把旧的“RH 币”显示改为“积分”。RunningHub 账户查询公开字段是 `data.remainPoint`，应读取此字段；不要把 `remainCoins` 直接改名显示成积分。保留当前“余额”项目，除非实现时发现它已不代表有效账户余额，并在最终说明中解释。
2. 新版任务结算使用积分。任务完成后，任务卡片要显示实际扣除的积分；当前 RunningHub V2 返回 `usage.settleMode` 和 `usage.chargedPoint`。
3. 每次点击运行后创建的 RunningHub 任务卡片，要能显示平台错误码对应的中文原因，帮助用户决定充值、检查权限、修正应用配置、等待队列或重试。保留平台原始错误码和原始错误信息供详情排查。排队/运行状态不能被误报为失败，也不能引导用户重复提交。
4. 更新插件内置的 RunningHub 运行指南，移除不再适用的 RH 币/旧扣费口径，并补充积分、常见错误码和新的排查建议。
5. 修复提示词预设保存后在切换资料包时消失的问题。创建、编辑、收藏、删除、排序和分类变更等操作都要与当前资料包的持久化数据保持一致；切换资料包或导入资料包不能静默覆盖已保存内容。

## RunningHub 文档核对

以下公开文档于 2026-11-11 访问。国内版和国际版的 V2 结果结构一致。

- [当前 API 文档索引](https://www.runninghub.ai/runninghub-api-doc-en/llms.txt)
- [账户信息接口](https://www.runninghub.ai/runninghub-api-doc-en/api-425761030.md)：`POST /uc/openapi/accountStatus`，请求体字段为小写 `apikey`；响应包含 `remainCoins`、`remainMoney`、`currency`、`apiType`，并额外定义 `remainPoint`（描述为 Point balance）。
- [V2 任务结果接口](https://www.runninghub.ai/runninghub-api-doc-en/api-425767807.md)；[国内版对应文档](https://www.runninghub.cn/runninghub-api-doc-cn/api-425767306.md)：成功状态示例为 `status: SUCCESS`，`usage.settleMode: POINT`，`usage.chargedPoint: "1.28"`。也存在 `taskUsageList[].usage.chargedPoint`。
- [旧任务输出接口](https://www.runninghub.ai/runninghub-api-doc-en/api-425761034.md)：仍列出 `settleMode` 和 `chargedPoint`，可作为 V2 兼容回退数据来源。
- [RunningHub API 错误码表](https://www.runninghub.ai/runninghub-api-doc-en/doc-8287467.md)：含余额、并发、API Key、任务队列、实例权限、上传等错误码。
- [AI 应用提交接口](https://www.runninghub.ai/runninghub-api-doc-en/api-425761096.md)：还支持可选 `accessPassword`、`webhookUrl` 和 `instanceType`（`default`/`plus`/`ultra`）。这些能力不属于本轮验收范围；`webhookUrl` 需要可接收回调的服务端，暂不在纯 UXP 客户端实现。
- [RunningHub API 更新日志](https://www.runninghub.ai/runninghub-api-doc-en/doc-8287462.md)：2026-04-27 增加加密访问密码参数；2026-01-08 加入 V2 上传与任务查询文档。

**积分口径的限制：**公开账户接口把 `remainPoint` 描述为“Point balance”，没有明确说明免费积分与付费积分如何拆分，或该字段是否严格等于可用于 API 调用的付费积分。因此 UI 文案先使用“积分”，不擅自标成“付费积分”或“API 可用积分”，除非能从更新后的官方资料或真实接口语义确认。若账户响应没有 `remainPoint`，显示 `--` 并保留刷新失败提示；禁止回退到 `remainCoins` 冒充积分。

## 当前代码事实

### 积分与任务错误

- [src/host/runninghub.js](../PixelRunner/src/host/runninghub.js)：`fetchRunningHubAccountStatus` 读取 `remainMoney` 和 `remainCoins`，还没有 `remainPoint`。任务费用提取器认识旧的 `consumeMoney`/`consumeCoins`，不认识新的 `usage.chargedPoint`/`settleMode`。
- 同一文件已经优先请求 `/openapi/v2/query`，旧 `/task/openapi/outputs` 作为兼容查询路径。保持现有状态与结果查询回退行为，不要为接入积分而退回旧接口。
- [src/webview/settings.js](../PixelRunner/src/webview/settings.js)：RunningHub 账户卡片把 `account.coins` 显示在第二项。
- [src/webview/workspace.js](../PixelRunner/src/webview/workspace.js)：任务卡片有状态详情和扣费字段，但当前 RunningHub 错误分类以错误文本为主；需要从 Host 响应到 task record 保留错误码。
- [app.html](../PixelRunner/app.html)：账户卡片第二项默认文案为“RH 币”。
- [scripts/test-runninghub-charge.mjs](../PixelRunner/scripts/test-runninghub-charge.mjs) 覆盖旧币/金额字段，尚无 V2 `chargedPoint` 用例。
- [scripts/test-task-card-status.mjs](../PixelRunner/scripts/test-task-card-status.mjs) 已覆盖任务卡片状态、详情和旧扣费显示，适合扩展错误码行为断言。

### 提示词预设消失：已确认的根因

这不是“保存按钮完全没有保存”。弹窗创建路径会等待本地保存：

- [src/webview/templates.js](../PixelRunner/src/webview/templates.js) 的 `saveCurrentFieldAsTemplateFromPicker` 在 `templates.js` 770 行附近创建模板并调用 `saveTemplatesToStorage`。
- `saveTemplatesToStorage` 在 411 行附近写入全局 `PROMPT_TEMPLATES`（键名 `rh_prompt_templates`），更新内存 state，并生成工作区备份。
- 资料包另存于 `PROMPT_BUNDLES`（键名 `pixelrunner.promptBundles.v1`），每个资料包的 `content` 是 JSON 快照。`persistBundleSnapshot` 只在“导入为新资料包”时写入快照。
- `switchPromptBundle` 在 1089 行附近把目标资料包的 `content` 通过 `importTransferPackageText(... forceReplace: true)` 载入。切换前没有把当前正在编辑的工作区快照回写到当前资料包。
- 因此预设可以已经写入 `rh_prompt_templates` 和工作区备份，但并未写入当前资料包的 `PROMPT_BUNDLES[].content`。用户切到另一个资料包再切回来时，旧快照会覆盖全局模板列表，造成“刚才保存的预设消失”。用户“只在弹窗状态保存、没落到当前包”的判断基本正确，精确说法是：保存落到了全局插件模板状态，但没有同步到当前资料包快照。

### 预设消失的其它可能原因

这些是需要保留的次要排查项，不应盖过已确认的资料包快照问题：

1. [src/webview/runtime.js](../PixelRunner/src/webview/runtime.js) 的 `storageGetItem`/`storageSetItem` 在 Host 桥接失败时会静默回退 WebView `localStorage`。Host 存储使用 Host 侧 `localStorage`，与 WebView 后备存储可能不同；短暂桥接错误时写入后备存储、随后恢复时又从 Host 读旧值，可能呈现间歇性丢失。检查控制台/桥接错误，并避免在插件模式下把“写入了另一份后备存储”当成持久化成功。
2. 如果用户是从“提示词历史”里的星标入口收藏，取消该历史收藏可能按既有设计删除由该历史项拥有且没有其它引用的模板（`removePromptHistoryTemplate`）。确认反馈案例是否发生在取消星标后；不要误把它与预设弹窗的普通删除混为一谈。
3. 当前分类或搜索筛选可能让预设暂时不可见。确认模板是否还在 `rh_prompt_templates`、其 `categoryId` 是否存在，再判断是隐藏还是实际被覆盖。
4. 用户关闭或取消创建弹窗不会保存；真正的“保存预设”按钮会等待 `saveTemplatesToStorage`。如果保存时报错，不能显示成功状态。复现时记录按钮操作、成功提示、当前资料包名称、是否切换/导入/重启，以及存储桥接是否报错。

## 实施要求

### 1. 积分账户与扣费

- 在 Host 的账户解析中增加 `remainPoint`，将数据作为独立的 points 字段返回；不要继续复用语义为 RH 币的 `coins`。WebView 状态和 UI 对应改名为 `points` 或清晰等价字段，第二项标签显示“积分”。
- 任务结算按 `settleMode` 区分。`POINT` 时使用 `chargedPoint`，任务卡片显示类似“扣费 -1.28 积分”；旧 API 返回 `consumeCoins`/`consumeMoney` 时保留兼容格式。第三方服务的币种/积分展示不受 RunningHub 变更影响。
- `usage.chargedPoint` 是首选聚合值。若聚合字段缺失，再从 `taskUsageList[].usage.chargedPoint` 取值；不要把根 `usage` 与子任务费用重复求和，也不要因为结果数组重复费用而重复累计。
- 若结算信息暂缺，保留“扣费待确认”，不要用 `remainCoins` 或未隔离的余额差值假造积分费用。
- 账户 API 公共说明没明确付费/免费拆分。UI 只标“积分”；只有在 `remainPoint` 的可用范围已确认后才改标“可用积分/付费积分”。

### 2. 任务卡片错误码

在 Host 响应、WebView 任务记录、失败详情之间完整传递 `errorCode`（数字码和平台字符串码都可能出现）、`errorMessage` 和原始响应。任务卡片展示简洁的中文诊断以及代码；原始信息保留在详情中。错误码不能只在日志里出现。

至少支持以下文档错误：

| 错误码 | 平台标识 | 任务卡片建议说明 |
| --- | --- | --- |
| 301 | `PARAMS_INVALID` | 请求参数缺失或格式不正确，检查必填项 |
| 380 / 901 | `WORKFLOW_NOT_EXISTS` / `WEBAPP_NOT_EXISTS` | 工作流或 AI 应用不存在，检查应用 ID 或重新解析应用 |
| 415 / 421 | `TASK_INSTANCE_MAXED` / `TASK_QUEUE_MAXED` | 云端资源或并发队列已满，等待后重试；不要连续重复提交 |
| 416 | `TASK_CREATE_FAILED_BY_NOT_ENOUGH_WALLET` | RunningHub 账户可用余额/积分不足，前往对应区域控制台核对 |
| 433 / 803 | `VALIDATE_PROMPT_FAILED` / `APIKEY_INVALID_NODE_INFO` | 应用输入或节点参数不匹配，重新解析应用并检查字段 |
| 435 | `TASK_USER_EXCLAPI_INSTANCE_NOT_FOUND` | 当前账号没有所选 Plus/Ultra 实例权限，改用默认模式或检查权益 |
| 436 | `TASK_USER_EXCLAPI_REQUIRED` | 专属资源会员/服务已过期，检查 RunningHub 权益 |
| 801 | `APIKEY_UNSUPPORTED_FREE_USER` | 当前账号/API Key 类型不支持 API 调用，核对账号等级和 Key 类型 |
| 802 / 811 | `APIKEY_UNAUTHORIZED` / `CORPAPIKEY_INVALID` | API Key 无效或权限不匹配，重新检查对应区域和 Key 类型 |
| 804 / 813 | `APIKEY_TASK_IS_RUNNING` / `APIKEY_TASK_IS_QUEUED` | 任务仍在运行/排队，继续跟踪现有任务，不要重新提交 |
| 805 / 807 | `APIKEY_TASK_STATUS_ERROR` / `APIKEY_TASK_NOT_FOUND` | 云端任务状态异常或记录不存在，保留任务 ID 并查看原始详情 |
| 808 / 809 | `APIKEY_UPLOAD_FAILED` / `APIKEY_FILE_SIZE_EXCEEDED` | 图片上传失败或文件过大，检查网络或压缩图片 |
| 810 | `WORKFLOW_NOT_SAVED_OR_NOT_RUNNING` | 先在 RunningHub 保存应用/工作流并按平台要求手动运行一次 |
| 812 | `CORPAPIKEY_INSUFFICIENT_FUNDS` | 企业账户余额不足，联系团队管理员充值或分配额度 |

这张表是用户提示映射，不是要把所有非零状态都作为失败：`804` 和 `813` 尤其必须按运行/排队处理。对未识别码显示通用提示，并保留原始码和消息。

### 3. 提示词包持久化

- 先补一个专门的回归测试，按现有测试风格使用隔离的内存存储。至少复现：当前包 A 已有模板，用户保存新模板，切换到 B，再切回 A；新模板不得消失。覆盖新建与编辑，至少一个分类关联场景。
- 采用单一可靠策略并落实到所有可能覆盖工作区的边界：每次模板/分类变更后同步当前包快照，且在切换资料包、以“新资料包/替换/合并”导入前保存当前包。也可以用另一种等价的单一数据源设计，但必须让切换后回到原包恢复最新的模板和分类。
- 快照必须从当前规范化的 live state 构建（模板、分类及包格式要求的其它数据），不要只保存原始导入 JSON，否则合并、应用修改、模板编辑后的快照仍会过期。
- 内置资料包仍不可删除；用户对当前内置包的新增/编辑内容应按既定产品语义保留，不能每次初始化或切换时被内置资产覆盖。
- 导入策略取消时不得覆盖当前包。导入“新资料包”时先保存旧活动包，再将导入后的实际工作区状态确认为新包内容；替换/合并必须更新正确的活动包快照。
- Host 持久化失败不能静默显示“已保存”。如果运行时仍允许插件模式回退到 WebView `localStorage`，应明确区分后备存储并提供迁移或错误反馈；不要通过无提示的双存储覆盖制造数据丢失。
- 成功提示应发生在必要的模板和包快照写入都完成后；任意写入失败时显示失败，不应宣称保存成功。

### 4. 内置运行指南

更新 [PixelRunner/pages/runninghub-guide.html](../PixelRunner/pages/runninghub-guide.html) 中的余额、计费、首次配置、余额不足排查段落：

- 将国内版“RH 币 / R”、国际版“美元余额”作为普遍 API 扣费规则的旧表述删除或修订。
- 说明插件显示积分和任务实际扣除积分；账户余额字段使用 `remainPoint`，不要将 RH 币当作积分。
- 加入一小段任务卡片错误码排查，至少覆盖积分/余额不足、API Key 类型/鉴权、并发排队、输入参数不匹配、文件上传、Plus/Ultra 权限。
- 保留有效的区域 Key、API/应用区域匹配、任务排队和网络排查说明；不要把第三方 API 的余额说明一并改坏。
- 同步 [PixelRunner/docs/runninghub-regions.md](../PixelRunner/docs/runninghub-regions.md) 中的账户字段与扣费说明；搜索仓库其他用户可见的“RH 币”运行指南文案，避免留下互相矛盾的提示。

## 推荐执行顺序

1. 阅读本文引用的模块与现有测试，检查工作区状态并保留已有改动。
2. 先加提示词资料包切换回归测试，确认其在现有代码下失败；再实现活动包快照同步与切换/导入保护。
3. 增加账户 `remainPoint` 解析及 UI 显示；增加 V2 `chargedPoint` 提取、格式化和任务费用测试。
4. 传递任务错误码并增加任务卡片中文提示映射及测试，确保排队/运行码仍继续轮询。
5. 更新内置 RunningHub 指南、区域开发说明以及必要的 README 文案。
6. 运行相关测试，最后运行项目完整 `npm test` 与构建脚本；构建命令先从 `PixelRunner/package.json` 确认。

## 验收标准

- RunningHub 账户卡片第二项显示“积分”，数据来自 `remainPoint`；`remainPoint` 缺失时不会把 `remainCoins` 伪装为积分。
- V2 成功响应 `usage: { settleMode: "POINT", chargedPoint: "1.28" }` 后，RunningHub 任务卡片显示 `-1.28 积分`；根 usage 与 taskUsageList 同时存在时不重复计费。
- 旧版 `consumeCoins`/`consumeMoney` 仍按对应旧单位显示；第三方 API 费用格式保持原样。
- 任务卡片能区分错误码中文原因，保留原始码；`804`/`813` 是继续跟踪，不是失败或重试建议。
- 创建/编辑预设后切换资料包再切回、重新打开插件、从工作区备份恢复均不丢失；导入取消不改动活动包。
- 运行指南不再教用户按 RH 币进行 API 计费，并与实际积分 UI/任务卡片一致。
- 相关专项测试与完整 `npm test`、构建脚本通过；最终列明验证结果和仍未能确认的“remainPoint 是否仅包含 API 可用付费积分”语义。

## 重要边界

- 不要将 `remainPoint` 和 `remainCoins` 混为一项。
- 不要改变第三方 GRS/Gemini/Momo 等 API 的计费单位。
- 不要为并发或 API Key 错误自动重复提交任务。
- 本轮不实现 webhook 接收服务，不扩展 Ultra UI，不实现加密访问密码表单；如处理时间允许，可以只在结尾列为后续事项。
- 不删除、重置或覆盖用户已有资料包和工作区数据。任何替换操作都必须遵守现有确认与备份机制。
