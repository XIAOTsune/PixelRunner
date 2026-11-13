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
- 宿主只向 WebView 暴露 `{phase, step: {value, max} | null, channel}`；`channel` 仅使用 `unavailable`、`missing-url`、`invalid-url`、`unsupported`、`connecting`、`connected`、`timeout`、`error`、`closed` 等有限状态。WSS 地址保留在宿主监控闭包内以便重连，成功、失败、取消或空闲清理时释放，绝不跨桥接传递。
- value/max 只接受有限、非负且不超过安全整数上限的数值或十进制数字字符串，max 必须大于零，value 超出 max 时限制到 max。无效数值、二进制预览和超过 64 KiB 的事件均忽略。
- 文案明确为“当前步骤进度（非任务总进度）”。新执行步骤、缓存事件或 WSS success 会清空旧数值；断线或 10 秒没有数值更新后恢复不定进度。10 秒仅用于淘汰旧显示，不用于估算百分比或 ETA。
- executing、execution_cached、execution_success 均不决定任务终态。REST 成功状态或 V1 code=0 的完成输出数组确认生成成功后，继续显示下载、Photoshop 贴回；未知 REST 状态和中间结果不能确认成功。
- 连接失败、8 秒握手超时或断线后，以 1、2、4、8、15 秒间隔重连，单个任务同一时间最多一个 socket；有效事件到达后重置退避间隔。重连只复用原任务 WSS 地址，不重新提交任务，也不改变独立 REST 轮询。804/813 与对应字符串码优先归类为运行/排队，即使 HTTP 或状态字段暗示失败也不误报。
- `WebSocket` 不支持、缺少地址或地址未通过区域白名单时不尝试连接；安全通道状态留在宿主诊断快照中。云端执行期间尚无当前步骤百分比时只显示不定进度条，不推算百分比或显示推测性文案。
- 成功、失败、取消清理连接和重连计时器；无活动 5 分钟清理宿主监控对象，最多 100 个监控对象。
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

2026-11-11 文档核对时可检测到 Photoshop 进程，但没有可用的 UXP Developer Tools 调试会话，也没有受控的插件窗口连接，因此当时未验证真实 UXP WSS 握手、实时数值事件及 Photoshop 实际下载/贴回。

2026-11-13 在当前 Photoshop 插件面板提交并完成了一次真实任务，Photoshop 自动贴回结果；任务卡在整个运行期间显示“实时通道不可用，状态轮询继续”，没有拿到步骤百分比。当前实现原先把缺少 WSS 地址、运行环境不支持以及连接错误统一记为 `unavailable`，且首次连接失败后不会重试，因此无法从这次运行判断服务端是否在模型准备阶段拒绝了首次握手。修复后增加安全状态分类及有界间隔重连；自动化测试覆盖握手超时后恢复。该实测未记录原始 WSS 地址、节点事件或错误载荷。

## 手动验收

1. 在 UXP Developer Tools 加载本次 `release/像素起子V2.9.4/manifest.json`，确认版本 2.9.4 后 Reload；不要卸载插件、清空存储或导入覆盖已有资料包。
2. 打开该插件的 WebView 调试控制台，执行 `diagnostics/runninghub-uxp-check.js` 的内容。脚本不创建任务，不读 Key，不打印 WSS 地址。`hostWebSocketSupported` 仅表示宿主 API 存在。
3. 用自己的区域配置提交一次正常任务。排队应显示不定进度；执行但暂无百分比时会说明模型准备只是可能原因，不显示估算值。如有合法事件，应显示“当前步骤进度 …（非任务总进度）”。诊断脚本的 `channel: connected` 才代表实际 WSS 握手通过。
4. 如果连接失败或超时，检查卡片上的安全状态分类；任务仍由 REST 继续查询，宿主会按退避间隔尝试重连。不要记录或分享含鉴权参数的网络 URL。
5. 检查步骤达到 100% 或接收 WSS success 时仍未提前显示任务完成；仅 REST 确认后进入下载，再进入 Photoshop 贴回。复核积分扣费；任务卡片不应展示运行耗时。
6. 对已知安全失败样例检查卡片“安全错误详情”，只应有安全错误码与中文诊断。检查插件日志及新导出的工作区备份，不应出现监控地址、promptTips、节点名/ID、节点数组、输入输出原文或 traceback。
7. 对国内、国际区域各验证一次。真实部署若返回文档范围外的 WSS 地址，应继续保持 REST 降级，不能扩大为任意网络权限或记录完整地址来排查。

## 自动化验证

`npm run test:runninghub-progress` 覆盖数值校验、敏感字段投影、过期/步骤切换、连接构造异常/超时/断线/不支持、WSS success 提前到达、REST 临时错误与未知状态、804/813、V1/V2 耗时、V1 重复输出积分、错误文本/桥接/日志脱敏、取消释放、任务状态与 UI、异步晚到回复、备份与宿主 WSS 权限。

原有 `test:runninghub-charge` 的 V2 chargedPoint、V1 输出直接扣分及重复输出去重断言全部保留；仅将要求返回原始错误对象的旧断言调整为安全错误协议。

完整 `npm test` 还包含既有发布、授权、图像和工作区回归。Node 下既有 WebGL2/GPU 测试的可选跳过保持原状。

## 首次打包记录（2026-11-11）

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

## 实测修复与重打包（2026-11-13）

- Photoshop 中实际运行并完成一次 RunningHub 任务，耗时 56 秒、扣费 0.089R，结果自动贴回。任务卡全程报告实时通道不可用，没有步骤百分比；未读取或记录原始 WSS 地址和错误载荷。
- 宿主现会在连接失败、超时或断开后按 1、2、4、8、15 秒间隔重连；状态轮询不受影响，也不会重复提交任务。安全通道状态保留在宿主诊断快照中；无步骤百分比时任务卡只显示不定进度条。
- `npm run package:release` 的完整测试及打包通过；`test:runninghub-progress` 覆盖 18 组场景。发布包 ID 为 `com.tsune.pixelrunner`，版本 `2.9.4`，包含 29 个文件，大小 1,648,783 字节。
- 该次真实任务由打包前已加载的 Photoshop 插件执行；新版重连逻辑尚未在 Photoshop 中热加载后再次实测。自动化测试验证了超时后重连恢复。

| 文件 | SHA-256 |
| --- | --- |
| 像素起子V2.9.4.zip | `31b4d6992ecc0bb0dd92f127fa2cfadb15583cdc93094c9abec478b4be7a375b` |
| dist/app.bundle.js | `5d15c7b1761eae65d60082f54c15aa61eb25319f02282d6a62f4b65eab60635f` |
| dist/core.bundle.js | `9fa1fa44e74d9283fe24cdb3c4cf1cb924e7fedf3d7d924c2aa46bdec8b4d60e` |
| dist/host.bundle.js | `6fe7d6620202be712b5c31ebac4997e8b704ba238cd33914ce6d4178d4c7f041` |
