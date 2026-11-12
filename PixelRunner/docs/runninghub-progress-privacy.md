# RunningHub 隐私进度与 UXP 验证

核对日期：2026-11-11。适用版本：2.9.4 标准 release。

## 官方文档核对

本次直接获取了以下官方 Markdown，而不是依赖上一轮结论：

| 能力 | 国内版 | 国际版 | 当前核对结果 |
| --- | --- | --- | --- |
| AI 应用提交 | https://www.runninghub.cn/runninghub-api-doc-cn/api-425749010.md | https://www.runninghub.ai/runninghub-api-doc-en/api-425761096.md | 均示例返回 taskId、netWssUrl、taskStatus、clientId、promptTips |
| 任务进度示例 | https://www.runninghub.cn/runninghub-api-doc-cn/doc-8287341.md | https://www.runninghub.ai/runninghub-api-doc-en/doc-8287471.md | 均以 WSS 的 progress.data.value/max 表示当前步骤进度；示例的整体进度另行依赖工作流节点映射 |
| V2 查询 | https://www.runninghub.cn/runninghub-api-doc-cn/api-425767306.md | https://www.runninghub.ai/runninghub-api-doc-en/api-425767807.md | 均无整体百分比字段，usage 包含 taskCostTime、settleMode、chargedPoint；国内文档当前为 released，国际文档仍为 developing |
| V1 输出 | https://www.runninghub.cn/runninghub-api-doc-cn/api-425749004.md | https://www.runninghub.ai/runninghub-api-doc-en/api-425761034.md | 输出项包含 taskCostTime、settleMode、chargedPoint；失败示例包含 failedReason 下的节点、输入输出和 traceback；国内文档当前为 deprecated，国际文档为 released |
| V1 状态 | https://www.runninghub.cn/runninghub-api-doc-cn/api-425749003.md | https://www.runninghub.ai/runninghub-api-doc-en/api-425761033.md | 用于查询任务状态，不提供整体完成百分比 |

官方更新记录：https://www.runninghub.ai/runninghub-api-doc-en/doc-8287462.md 。本次获取的最新条目是 2026-04-27，说明新增 accessPassword；2026-01-08 的条目说明调整文档结构并增加 V2 上传与查询。

区域文档并非完全一致：V2 与 V1 的状态标签不同，国际提交和输出的 WSS 示例仍引用 .cn 域名。实现不复制示例鉴权地址，也不把地址改写到另一区域；只有实际响应中的、符合任务所属区域和官方 WSS 路径的地址才尝试连接。其余情况继续 REST。

## 实现边界

- WSS 完全在宿主创建，WebView 不接收地址、连接参数、clientId 或提交原始响应。不读取节点映射、不新增工作流查询、不读取 WSS 节点字段。
- 宿主只保存连接对象与 `{phase, step: {value, max} | null, channel}`。连接闭包与接收完整响应的函数隔离；URL 在构造 socket 后清空局部引用。socket 本身为维持连接仍需持有地址，关闭时解除事件并释放对象。
- value/max 只接受有限、非负且不超过安全整数上限的数值或十进制数字字符串，max 必须大于零，value 超出 max 时限制到 max。无效数值、二进制预览和超过 64 KiB 的事件均忽略。
- 文案明确为“当前步骤进度（非任务总进度）”。新执行步骤、缓存事件或 WSS success 会清空旧数值；断线或 10 秒没有数值更新后恢复不定进度。10 秒仅用于淘汰旧显示，不用于估算百分比或 ETA。
- executing、execution_cached、execution_success 均不决定任务终态。REST 成功状态或 V1 code=0 的完成输出数组确认生成成功后，继续显示下载、Photoshop 贴回；未知 REST 状态和中间结果不能确认成功。
- 连接失败、不支持 WebSocket、8 秒握手超时、断线均不改变独立 REST 轮询。804/813 与对应字符串码优先归类为运行/排队，即使 HTTP 或状态字段暗示失败也不误报。
- 成功、失败、取消清理连接；无活动 5 分钟清理宿主监控对象，最多 100 个监控对象。WSS 不自动重试，不重复提交任务。
- 任务提交、状态与轮询不再返回原始平台对象；AI 优化保留的兼容结果仅含必要文本结果 URL。平台错误文本仅在宿主短期内存中分类；卡片、桥接异常和日志只保留数字错误码或已知平台字符串码及预定义中文诊断。未知文本及可能混入节点信息的中文/英文文本均不会回显。
- 工作区备份额外排除 netWssUrl、clientId、promptTips、outputs_to_execute、node_errors、platformErrorRaw 与 WSS 地址字符串。原有应用提交所需的配置输入 ID 属于现有用户数据，继续保留；进度通道不会读取、复制或追加这些信息。没有修改磁盘中的既有用户数据或旧备份。
- 平台耗时只取 V2 聚合 usage.taskCostTime 或 V1 输出项重复且一致的 taskCostTime；不求和、不从子任务或本地时间推算。RunningHub 任务卡片不展示任务耗时。
- 任务积分首选 V2 `usage.chargedPoint` 及去重后的 `taskUsageList`；成功的 V2 结果缺少积分结算时，尝试从 V1 输出项读取 `chargedPoint`。V1 查询失败不影响已确认的 V2 任务成功。

## UXP 兼容性依据与实机边界

Adobe 的 WebSocket 文档明确要求 network.domains 中声明 wss 域名：
https://github.com/AdobeDocs/uxp/blob/main/src/pages/uxp-api/reference-js/Global%20Members/Data%20Transfers/WebSocket.md

Manifest v5 的权限声明结构：
https://developer.adobe.com/photoshop/uxp/2022/guides/uxp_guide/uxp-misc/manifest-v5/

manifest 的 network.domains 新增国内/国际 RunningHub 的精确主机、根域和子域 WSS 权限；保留原 HTTPS 权限。WSS 不进入 WebView 权限。对网络与 WebView 的原有同步测试调整为 HTTP 权限一致，同时单独断言宿主 WSS 白名单。

本轮可检测到 Photoshop 进程，但没有可用的 UXP Developer Tools 调试会话，也没有受控的插件窗口连接。因此本轮未验证真实 UXP WSS 握手、真实任务数值事件以及 Photoshop 实际下载/贴回；Node 隔离测试和浏览器视觉检查不能替代该验证。

## 手动验收

1. 在 UXP Developer Tools 加载本次 `release/像素起子V2.9.4/manifest.json`，确认版本 2.9.4 后 Reload；不要卸载插件、清空存储或导入覆盖已有资料包。
2. 打开该插件的 WebView 调试控制台，执行 `diagnostics/runninghub-uxp-check.js` 的内容。脚本不创建任务，不读 Key，不打印 WSS 地址。`hostWebSocketSupported` 仅表示宿主 API 存在。
3. 用自己的区域配置提交一次正常任务。排队应显示不定进度，执行时如有合法事件应显示“当前步骤进度 …（非任务总进度）”；再运行诊断脚本，`handshakeVerified: true` / `channel: connected` 才代表实际 WSS 握手通过。
4. 若出现 `unavailable`，确认卡片仍查询任务状态并正常生成、下载、贴回。可用支持按路径拦截的调试代理仅阻断 `/ws/c_instance` 而放行 HTTPS REST，验证降级；不要记录或分享含鉴权参数的网络 URL。
5. 检查步骤达到 100% 或接收 WSS success 时仍未提前显示任务完成；仅 REST 确认后进入下载，再进入 Photoshop 贴回。复核积分扣费；任务卡片不应展示运行耗时。
6. 对已知安全失败样例检查卡片“安全错误详情”，只应有安全错误码与中文诊断。检查插件日志及新导出的工作区备份，不应出现监控地址、promptTips、节点名/ID、节点数组、输入输出原文或 traceback。
7. 对国内、国际区域各验证一次。真实部署若返回文档范围外的 WSS 地址，应继续保持 REST 降级，不能扩大为任意网络权限或记录完整地址来排查。

## 自动化验证

`npm run test:runninghub-progress` 覆盖数值校验、敏感字段投影、过期/步骤切换、连接构造异常/超时/断线/不支持、WSS success 提前到达、REST 临时错误与未知状态、804/813、V1/V2 耗时、V1 重复输出积分、错误文本/桥接/日志脱敏、取消释放、任务状态与 UI、异步晚到回复、备份与宿主 WSS 权限。

原有 `test:runninghub-charge` 的 V2 chargedPoint、V1 输出直接扣分及重复输出去重断言全部保留；仅将要求返回原始错误对象的旧断言调整为安全错误协议。

完整 `npm test` 还包含既有发布、授权、图像和工作区回归。Node 下既有 WebGL2/GPU 测试的可选跳过保持原状。

## 本轮执行结果

- 初始工作区无未提交改动，版本 2.9.4；覆盖前确认旧发布目录的项目 ID / manifest 版本匹配，而且旧 ZIP 与目录的全部 29 个文件逐字节一致。
- `test:runninghub-charge`、`test:runninghub-progress`（17 组场景）、`test:task-card-status` 和 `test:generative-fill` 通过。
- 最终 `npm run package:release` 内部完整运行 `npm test` 的 27 个专项命令，全部通过；既有可选 WebGL2/GPU 项按 Node 环境跳过。
- `npm run build:release`、`npm run check:dist:release`、`npm run package:release` 和 `git diff --check` 通过。标准 release 没有使用加固/混淆参数。
- Chrome 隔离预览调用真实卡片渲染函数及 app.css；280px 与 380px 视口均无横向溢出，5 个活动阶段进度条中仅 1 个包含合法当前步骤百分比，合成的敏感节点文本未进入卡片。
- 只重新生成 `release/像素起子V2.9.4/` 与 `release/像素起子V2.9.4.zip`。其余预先记录的 814 个文件 SHA-256 全部一致，其中 779 个属于其他版本的 release 文件。
- ZIP CRC 检查通过，共 29 个文件，1,647,475 字节；包内项目 ID 为 `com.tsune.pixelrunner`，manifest 版本为 `2.9.4`；三个运行时 bundle 通过语法检查，与当前工作区标准 release bundle 逐字节相同。
- ZIP 与发布目录逐文件一致；没有 src、scripts、tests、node_modules、诊断文件、用户数据、source map 或私钥；发布 HTML 已移除 uxpAllowInspector。
- 检查通过不等于 Photoshop 实机握手通过；真实 UXP 连接、平台任务事件及实际下载/贴回仍须按上述手动步骤验证。

| 文件 | SHA-256 |
| --- | --- |
| 像素起子V2.9.4.zip | `3b2b56fc888bcf7d50b235ba41035b4cd06727dfb94e1ad3773a761ea86dd988` |
| dist/app.bundle.js | `5d15c7b1761eae65d60082f54c15aa61eb25319f02282d6a62f4b65eab60635f` |
| dist/core.bundle.js | `14bfd621c2d253a239af76246de3acb5034594f0674dc6fc4bf28590fcf5a62d` |
| dist/host.bundle.js | `261312e9defb79d9173616e4b15fb68bd34c32e897cf122bcda36c474938d1da` |
