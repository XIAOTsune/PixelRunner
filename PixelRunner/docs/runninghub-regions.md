# RunningHub 国内版与国际版 API 接入

更新日期：2026-07-15

## 结论

RunningHub 国际版沿用国内版的消费级 API 路径、鉴权方式和主要请求结构，服务基址从
`https://www.runninghub.cn` 切换为 `https://www.runninghub.ai`。插件必须把区域同时用于应用解析、
文件上传、任务提交、结果查询、任务取消和账户查询，不能只替换提交接口。

国内版与国际版应视为两套独立配置。API Key、账户余额以及 AI 应用/工作流 ID 都应与区域一起保存；
用户切换区域时，插件应切换到该区域的 API 档案和应用列表。
国内版余额扣费使用 `R`，国际版余额扣费使用美元符号 `$`。

## 接口映射

| 能力 | 方法与路径 | 关键字段 |
| --- | --- | --- |
| AI 应用提交 | `POST /task/openapi/ai-app/run` | `apiKey`, `webappId`, `nodeInfoList`, 可选 `instanceType` |
| 工作流提交（兼容） | `POST /task/openapi/create` | `apiKey`, `workflowId`, `nodeParams` |
| V2 文件上传 | `POST /openapi/v2/media/upload/binary` | Bearer 鉴权，multipart 字段 `file` |
| V2 查询任务结果 | `POST /openapi/v2/query` | Bearer 鉴权，`taskId`；返回 `status`、`results[].url`、`results[].outputType` |
| V1 查询输出（兼容） | `POST /task/openapi/outputs` | `apiKey`, `taskId`；仅在 V2 不可用或已完成但无结果时回退 |
| 取消任务 | `POST /task/openapi/cancel` | `apiKey`, `taskId` |
| 查询账户 | `POST /uc/openapi/accountStatus` | 请求体字段为小写 `apikey` |

以上接口均使用 `Authorization: Bearer <API Key>`。账户接口主要返回 `remainMoney`、`remainCoins`、
`currentTaskCounts`、`currency` 和 `apiType`。

## 插件约束

- 区域值使用 `cn` 和 `global`，旧配置默认迁移为 `cn`。
- API 档案和应用记录都保存区域；相同 Key 或应用 ID 可以分别存在于两个区域。
- 本地应用存储与资料包均使用 `appsByRegion.cn/global` 分区；旧资料包中无区域信息的应用默认归入 `cn`。
- 提交时把区域复制到任务载荷，后续轮询和取消始终使用任务原区域。
- `.ai` 域名必须同时加入 UXP 的 `webview.domains` 和 `network.domains`。
- 返图会使用 `rh-images.xiaoyaoyou.com`、`rh-hk-images.xiaoyaoyou.com`、香港 COS 或北京 COS 域名；这些 CDN 必须加入 UXP 的 WebView 和网络权限。
- V2 结果可能是 PNG、JPG 或 WebP；下载时必须按字节签名和响应 MIME 确定临时文件扩展名，不能一律写成 `.png`。
- 国际版 AI 优化默认应用 ID 为 `2077336528350871553`，创成式填充默认应用 ID 为 `2077331388482748417`；用户保存的非空自定义 ID 优先。
- 应用解析默认请求中文元数据，并优先使用响应中的中文名称字段；国际版已有纯英文名称在重新解析时会更新为平台中文原名，用户手动填写的中文名称仍优先。

## 官方资料

- 国际版 API 文档目录：https://www.runninghub.ai/runninghub-api-doc-en
- 国内版 V2 查询任务结果：https://www.runninghub.cn/runninghub-api-doc-cn/api-425767306.md
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
