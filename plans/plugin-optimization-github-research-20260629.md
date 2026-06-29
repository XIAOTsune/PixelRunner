# PixelRunner 后续优化与开源项目调研

日期：2026-06-29  
范围：只做产品/工程调研与路线建议，未修改插件业务代码。

## 1. 当前判断

PixelRunner 现在已经不是一个单纯的 RunningHub 提交器，而是一个 Photoshop 内的 AI 修图工作台：包含应用解析、动态图像/文本参数表单、选区/文档捕获、任务并发与回贴、快捷入口、提示词模板、AI 优化、第三方 GRS 入口、Blend Match、辉光预览、Space FX、常用修图动作等。

所以接下来的优化不建议只堆更多按钮。更值得做的是三条线：

1. 把高频 AI 修图流程做得更短、更可恢复、更少出错。
2. 把已经复杂的功能模块做成可诊断、可测试、可维护的系统。
3. 把插件从“能跑很多能力”升级为“用户能沉淀自己的修图资产和工作流”。

## 2. GitHub 借鉴项目

| 项目 | 关注点 | 对 PixelRunner 的借鉴 |
| --- | --- | --- |
| [AdobeDocs/uxp-photoshop-plugin-samples](https://github.com/AdobeDocs/uxp-photoshop-plugin-samples) | Adobe 官方 Photoshop UXP 示例库 | 适合作为 UXP API、manifest、panel、modal、文件系统、batchPlay 等写法的基准；后续做功能边界和兼容性时，应优先对照官方样例。 |
| [Adobe UXP Photoshop Docs](https://adobedocs.github.io/uxp-photoshop/) | Photoshop UXP 官方文档 | 当前插件使用 WebView、host bridge、executeAsModal、imaging、filesystem 等能力，后续每次改权限和宿主交互都应对照官方文档做兼容检查。 |
| [AbdullahAlfaraj/Auto-Photoshop-StableDiffusion-Plugin](https://github.com/AbdullahAlfaraj/Auto-Photoshop-StableDiffusion-Plugin) | Photoshop 内 Stable Diffusion / Automatic1111 / ComfyUI 工作流 | 它强调 inpaint、outpaint、txt2img/img2img 与 Photoshop 工具衔接。PixelRunner 可借鉴“任务类型模式化”和“从选区直接进入对应 AI 流程”的体验。 |
| [NimaNzrii/comfyui-photoshop](https://github.com/NimaNzrii/comfyui-photoshop) | ComfyUI inside Photoshop | 社区对“把节点工作流藏在 Photoshop 面板后面”的需求很明确。PixelRunner 已有 RunningHub 应用解析，可进一步做“工作流预设市场/分享包/参数映射模板”。 |
| [zombieyang/sd-ppp](https://github.com/zombieyang/sd-ppp) | Photoshop AI 插件，支持 ComfyUI、Replicate、RunningHub | 这个项目的方向和 PixelRunner 很接近，尤其是“选择任意区域、图层、文档作为输入”“键盘快捷选择图像”“新的收发图 UI”。PixelRunner 可以重点借鉴输入源选择和结果管理。 |
| [hyperbrew/bolt-uxp](https://github.com/hyperbrew/bolt-uxp) | UXP 插件工程脚手架，Vite + TypeScript + Sass，支持打包发布 | PixelRunner 当前是原生 JS + esbuild。短期不必迁移框架，但可以借鉴工程化能力：GitHub Actions、CCX/ZIP 自动打包、类型约束、分环境配置、发布流水线。 |

## 3. 优先级建议

### P0：先补稳定性与可诊断

这些不是最炫的功能，但能明显减少“跑不通、不知道为什么”的体验损耗。

1. **任务诊断中心**
   - 记录最近 N 次任务的提交 payload 摘要、应用 ID、输入字段、上传结果、taskId、状态轮询、失败原因、回贴结果。
   - 支持一键复制脱敏诊断信息，方便用户反馈。
   - 对 RunningHub / GRS / Photoshop 回贴错误分别分类，不要混成“任务失败”。

2. **失败恢复与继续追踪**
   - 本地超时但云端仍在跑时，任务卡片保留“继续追踪/打开详情/重试回贴”。
   - 结果回贴失败时，不应丢掉 outputUrl，应提供“重新回贴到当前文档/另存结果/打开结果链接”。
   - 插件重载后恢复未完成任务列表，至少恢复 taskId、appName、provider、startedAt、sourceDocument。

3. **版本与发布一致性检查**
   - `package.json` / `manifest.json` 是 2.5.5，但 `src/webview/main.js` ready message 里仍是 2.5.3。建议把版本从单一来源注入，避免诊断时误判。
   - 发布前增加 manifest、README、包内文件、dist 同步、版本号一致性的检查脚本。

4. **权限与网络域名审计**
   - manifest 当前网络和 WebView 域名较多，建议维护一份 `permissions-audit.md`，说明每个域名用途。
   - 第三方 API 入口继续扩展时，避免把域名列表变成不可解释的黑箱。

### P1：让高频修图流程更顺

1. **输入源选择器**
   - 借鉴 sd-ppp 的方向，把输入源明确做成：当前选区、当前图层、当前文档、剪贴板、上次结果、指定图层。
   - 对多图输入工作流，给每个图像字段绑定不同来源，而不是只依赖自动填充规则。

2. **结果收件箱**
   - 每次 AI 输出不只是“贴回图层”，还进入一个结果池。
   - 支持查看缩略图、重新回贴、替换当前结果层、另存、作为下一次参考图、标记收藏。
   - 对批量任务尤其有用，能让用户比较多个结果。

3. **场景化运行模式**
   - 把复杂参数包装成模式：局部重绘、背景补全、质感增强、产品图清理、人像精修、风格参考、提示词优化。
   - 模式不是新后端，而是对现有 RunningHub 应用 + 参数 + 输入要求的上层封装。

4. **快捷入口 2.0**
   - 现有快捷入口偏“保存应用和非图片参数”。可扩展为可编辑动作卡：输入源规则、结果回贴规则、Blend Match 是否自动执行、完成后是否提示音。
   - 增加分组、搜索、导入导出、最近使用排序。

### P2：沉淀用户资产

1. **工作流包导入导出**
   - 把应用、模板、快捷入口、分类、默认参数打成一个 JSON 包。
   - 支持“只导入模板/只导入应用/合并分类/覆盖同名项”。
   - 这会让 PixelRunner 更像可分享的修图工作台，而不是每台机器重新配置。

2. **提示词模板变量**
   - 模板支持变量，例如 `{subject}`、`{style}`、`{negative}`、`{camera}`。
   - 插入模板时弹出轻量表单，减少用户复制后再手改。
   - 可支持模板组合：基础质量词 + 场景词 + 负面词。

3. **应用参数预设**
   - 同一个 RunningHub 应用可有多个参数预设，例如“自然”“强修”“产品图”“批量快跑”。
   - 预设和快捷入口区分开：预设解决参数复用，快捷入口解决一键执行。

4. **本地知识库/帮助卡片**
   - 针对每个应用或入口保存使用说明、注意事项、示例图、常见失败原因。
   - 这对“别人分享的工作流包”尤其重要。

### P3：更高级但值得规划

1. **批量处理队列**
   - 对多个选区、多个图层或多个文档批量提交。
   - 支持最大并发、失败重试、暂停/继续、结果按源图层命名。

2. **自动后处理链**
   - AI 回贴后可自动执行：Blend Match、建立蒙版、设置混合模式、加组、改名、加颜色标签。
   - 这会把 PixelRunner 从“AI 结果搬运”推进到“修图动作编排”。

3. **ComfyUI / Replicate / OpenAI Images 等多 Provider 抽象**
   - 当前已有 RunningHub 和 GRS。若继续扩展，需要统一 provider adapter：submit、poll、cancel、extractOutput、account、diagnostics。
   - 不建议在 `workspace.js` 里继续堆 provider 分支。

4. **WebGL/GPU 能力面板**
   - Blend Match 和 Glow 已经有 GPU 方向。可以做一个隐藏或设置页中的“性能诊断”：WebGL2 可用性、预览尺寸、上次耗时、CPU fallback 原因。

## 4. 工程结构优化

当前若只从文件体量看，几个模块已经偏大：

| 模块 | 观察 | 建议 |
| --- | --- | --- |
| `src/webview/workspace.js` | 承担表单、任务、快捷入口、弹窗、输入源、回贴状态等大量职责 | 拆成 `workspace/form.js`、`workspace/tasks.js`、`workspace/images.js`、`workspace/quick-entry-ui.js`、`workspace/render.js`。 |
| `src/host/runninghub.js` | 包含上传、提交、轮询、错误归因、输出解析、AI 优化等逻辑 | 拆 provider adapter，保留一个清晰的 `runninghubClient` 和 `runninghubTaskService`。 |
| `src/host/photoshop/blend-match.js` | 算法、采样、缓存、预览、apply、日志混在一个大文件 | 保持现有行为不动，先按纯函数/host action/算法核心/缓存分层。 |
| `src/webview/state.js` | 状态、归一化、第三方模型能力、搜索、表单默认值混合 | 把 provider 能力、template normalize、app normalize、theme normalize 分文件。 |

测试方面建议补三类：

1. 纯函数单元测试：字段归一化、图片输入判断、任务状态解析、错误信息提取、模板导入合并。
2. 构建快照测试：manifest、版本、dist 同步、发布包包含文件。
3. 手工诊断脚本：用假 provider 模拟提交、轮询成功、失败、超时、取消、回贴失败。

## 5. UI/UX 优化点

基于 Photoshop 插件的使用环境，面板应该偏工作台，不宜做营销式大卡片。重点是密度、可扫读、可恢复。

1. **任务区更像队列**
   - 任务卡片显示：状态、耗时、费用/点数、输入来源、输出操作。
   - 失败卡片显示明确恢复动作：重试提交、继续追踪、复制诊断、打开详情。

2. **主工作区减少“选择成本”**
   - 当前功能很多，建议用“最近使用/收藏/推荐入口”帮用户先看到高频动作。
   - 应用选择器中增加标签和使用次数，而不是只靠名称搜索。

3. **复杂参数渐进展开**
   - 默认只展示必要字段和常用字段。
   - 高级参数折叠，并记住每个应用的展开状态。

4. **输入图像反馈更具体**
   - 显示来源、尺寸、压缩后大小、字段绑定关系。
   - 多图输入时，一眼看出哪个字段用了主图、哪个字段为空、哪个字段是参考图。

5. **首跑引导更短**
   - 不需要完整教程，做成设置页里的检查清单：API Key、添加应用、捕获图像、提交测试、回贴测试。

## 6. 推荐路线图

### 第一阶段：稳定和诊断

目标：减少反馈成本，保证任务失败时可解释、可恢复。

- 版本号单一来源。
- 任务诊断中心。
- 失败恢复动作。
- 结果 URL 保留与重新回贴。
- provider 错误分类。

### 第二阶段：工作台体验

目标：让用户少点几步，少重复配置。

- 输入源选择器。
- 结果收件箱。
- 快捷入口 2.0。
- 应用参数预设。
- 高级参数折叠。

### 第三阶段：资产分享

目标：让用户能沉淀并传播自己的修图流程。

- 工作流包导入导出。
- 模板变量。
- 应用/入口说明卡。
- 分享包兼容检查与冲突合并。

### 第四阶段：自动化编排

目标：从“提交 AI 任务”升级为“修图动作链”。

- 批量队列。
- AI 回贴后自动 Blend Match。
- 自动建组/蒙版/命名/颜色标签。
- 多 provider adapter 标准化。

## 7. 暂不建议优先做的事

1. **大规模换框架**
   - Bolt UXP 值得借鉴，但现在直接迁移 React/Vue/Svelte 成本很高。更现实的是先模块化、补测试、补发布流水线。

2. **继续无限增加 provider**
   - 在 adapter 抽象完成前，继续硬塞第三方 API 会让工作区和任务逻辑更难维护。

3. **把所有高级参数都放到首页**
   - 专业用户需要控制，但新用户更需要稳定的默认路径。高级参数应可展开、可保存、可搜索，而不是默认铺满。

4. **只做视觉重皮肤**
   - 当前最有价值的提升不是换颜色，而是输入、任务、结果、失败恢复这些关键链路的清晰度。

## 8. 最小可执行下一步

如果下一轮只做一个小版本，我建议选：

1. 修正版本号来源与发布检查。
2. 增加任务诊断中心的第一版。
3. 增加结果 URL 保留与“重新回贴”。
4. 把 `workspace.js` 中任务状态/任务卡片相关逻辑抽出，作为后续结果收件箱的基础。

这组改动不会改变用户习惯，但会明显提升插件的可靠感，也为后续大功能铺路。
