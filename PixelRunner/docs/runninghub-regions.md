# RunningHub 国内版与国际版 API 接入

更新日期：2026-07-12

## 结论

RunningHub 国际版沿用国内版的消费级 API 路径、鉴权方式和主要请求结构，服务基址从
`https://www.runninghub.cn` 切换为 `https://www.runninghub.ai`。插件必须把区域同时用于应用解析、
文件上传、任务提交、结果查询、任务取消和账户查询，不能只替换提交接口。

国内版与国际版应视为两套独立配置。API Key、账户余额以及 AI 应用/工作流 ID 都应与区域一起保存；
用户切换区域时，插件应切换到该区域的 API 档案和应用列表。

## 接口映射

| 能力 | 方法与路径 | 关键字段 |
| --- | --- | --- |
| AI 应用提交 | `POST /task/openapi/ai-app/run` | `apiKey`, `webappId`, `nodeInfoList`, 可选 `instanceType` |
| 工作流提交（兼容） | `POST /task/openapi/create` | `apiKey`, `workflowId`, `nodeParams` |
| V2 文件上传 | `POST /openapi/v2/media/upload/binary` | Bearer 鉴权，multipart 字段 `file` |
| 查询输出 | `POST /task/openapi/outputs` | `apiKey`, `taskId` |
| 查询状态 | `POST /task/openapi/status` | `apiKey`, `taskId` |
| 取消任务 | `POST /task/openapi/cancel` | `apiKey`, `taskId` |
| 查询账户 | `POST /uc/openapi/accountStatus` | 请求体字段为小写 `apikey` |

以上接口均使用 `Authorization: Bearer <API Key>`。账户接口主要返回 `remainMoney`、`remainCoins`、
`currentTaskCounts`、`currency` 和 `apiType`。

## 插件约束

- 区域值使用 `cn` 和 `global`，旧配置默认迁移为 `cn`。
- API 档案和应用记录都保存区域；相同 Key 或应用 ID 可以分别存在于两个区域。
- 提交时把区域复制到任务载荷，后续轮询和取消始终使用任务原区域。
- `.ai` 域名必须同时加入 UXP 的 `webview.domains` 和 `network.domains`。
- 国际版 AI 优化需要填写国际站存在且已成功运行过的 AI 应用 ID，国内版默认应用 ID 不保证跨站存在。

## 官方资料

- 国际版 API 文档目录：https://www.runninghub.ai/runninghub-api-doc-en
- 适合机器读取的文档索引：https://www.runninghub.ai/runninghub-api-doc-en/llms.txt
- 使用说明：https://www.runninghub.ai/runninghub-api-doc-en/doc-6333420.md
- AI 应用提交：https://www.runninghub.ai/runninghub-api-doc-en/api-279102846.md
- V2 文件上传：https://www.runninghub.ai/runninghub-api-doc-en/api-402739351.md
- 查询任务输出：https://www.runninghub.ai/runninghub-api-doc-en/api-276642708.md
- 取消任务：https://www.runninghub.ai/runninghub-api-doc-en/api-276642709.md
- 查询账户：https://www.runninghub.ai/runninghub-api-doc-en/api-276642710.md
- 错误码：https://www.runninghub.ai/runninghub-api-doc-en/doc-6913925.md
- 国际版消费级 API 控制台：https://www.runninghub.ai/enterprise-api/consumerApi
- 国际版 AI 应用广场：https://www.runninghub.ai/ai-apps
