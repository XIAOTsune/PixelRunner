# PixelRunner Phase 6 任务单（可直接执行）

- 适用分支：`refactor/plugin-frontend-backend-separation`
- 任务阶段：Phase 6（遗留清理与文档收口）
- 编写日期：2026-02-24
- 目标：在不引入行为回归的前提下，完成遗留资产治理、文档收口、规则固化。

---

## 0. Phase 6 Done 定义（本任务单验收口径）

满足以下 5 条即可判定 Phase 6 完成：

1. 遗留资产结论明确：`src/libs/qrcode-generator.js` 经过引用审计并落地处理（迁移到 `src/legacy/` 或删除）。
2. 关键文档更新：至少包含“PS 模块拆分边界说明 + 二开入口说明 + 最小冒烟清单”。
3. 冒烟流程可复现：可按文档完成 UXP 加载与核心链路检查，并记录结果。
4. 踩坑规则落地：本次重构中暴露的问题形成“强制规则 + 检查命令”。
5. 交接可执行：新对话中给 AI 这份任务单即可按步骤执行。

---

## 1. 执行策略（建议）

- 采用“小步提交”：每个任务 1 次提交，避免混改。
- 每步先“审计/验证”再“改动”，最后“回归”。
- 优先做低风险文档与治理，再做遗留删除动作。

推荐提交顺序：

1. `phase6-1`: 遗留资产审计结论（含是否引用的证据）
2. `phase6-2`: 文档收口（架构/二开/smoke checklist）
3. `phase6-3`: 踩坑规则落地（含 BOM/启动前检查流程）
4. `phase6-4`: 遗留资产处置（迁移或删除）

---

## 2. 任务清单（按顺序执行）

## Task 1：遗留资产审计（必须）

目标：明确 `src/libs/qrcode-generator.js` 的真实状态，避免误删。

执行：

1. 全仓搜索引用：
   - `rg -n "qrcode-generator|qrcode|QRCode" src tests index.js index.html README.md`
2. 检查运行时是否存在动态引用风险：
   - `rg -n "require\\(|import\\(" src | rg -n "qrcode|libs"`
3. 输出结论（写入文档）：
   - `引用数 = 0` 且无动态加载证据 -> 可进入“迁移/删除”决策
   - 存在引用 -> 标记为“暂不处理”，并记录调用路径

产出：

- 一段可追溯结论（含命令和结果摘要）。

验收：

- 结论可复现，不依赖口头判断。

---

## Task 2：Phase 6 文档收口（必须）

目标：让二开和后续维护不再依赖隐性知识。

最少应补齐以下内容：

1. PS 模块边界说明：
   - `src/services/ps/capture.js`: 选区捕获
   - `src/services/ps/place.js`: 回贴编排
   - `src/services/ps/alignment.js`: 对齐/几何策略
   - `src/services/ps/tools.js`: 工具菜单触发
   - `src/services/ps/shared.js`: 共享工具函数
   - `src/services/ps.js`: facade 兼容导出
2. 二开入口说明：
   - “新增工具功能时改哪里”
   - “禁止直接改 facade 对外签名的约束”
3. 手工 smoke checklist：
   - UXP 加载成功
   - workspace 主流程可运行
   - tools 主要按钮可触发
   - 常见失败链路可给出可读提示

验收：

- 新人不看历史上下文，只看文档即可完成一次冒烟。

---

## Task 3：踩坑规则固化（必须）

目标：把“插件不显示”等高代价问题前置拦截。

### 规则 R1（强制）：Manifest/入口文件必须 UTF-8 无 BOM

适用文件：

- `manifest.json`
- `index.html`
- `index.js`
- 其他入口级脚本

原因：

- BOM 会导致严格 JSON 解析失败，出现“插件在 PS 中不显示”。

检查命令（示例）：

```powershell
@'
const fs = require('fs');
const files = ['manifest.json', 'index.html', 'index.js'];
for (const f of files) {
  const b = fs.readFileSync(f);
  const hasBom = b.length >= 3 && b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF;
  console.log(`${f}: ${hasBom ? 'BOM' : 'no BOM'}`);
}
'@ | node -
```

验收：

- 上述文件均输出 `no BOM`。

### 规则 R2（强制）：启动链路必须容错加载

要求：

- 控制器初始化与诊断模块加载应在 `DOMContentLoaded` 后执行。
- 对可选模块（如诊断）要做 `typeof fn === "function"` 判定后再调用。
- 单模块异常不能拖垮整个面板启动（至少要保留错误日志）。

验收：

- 任一模块加载失败时，插件面板仍可显示基础 UI（不白屏）。

### 规则 R3（强制）：对外导出契约与诊断检查保持一致

要求：

- `ps` facade 导出函数名变更时，必须同步更新：
  - `tests/services/ps/facade.test.js`
  - `src/diagnostics/ps-env-doctor.js` 的导出检查列表

验收：

- 合同测试通过，且诊断报告不出现“误报缺失导出”。

### 规则 R4（建议）：发布前执行最小预检

至少执行：

1. `node --check index.js src/services/ps.js src/controllers/workspace-controller.js`
2. `node --test tests/services/ps/*.test.js tests/controllers/workspace/*.test.js tests/controllers/settings/*.test.js`
3. BOM 检查（规则 R1）

---

## Task 4：遗留资产处置（决策后执行）

当 Task 1 结论为“无引用”时，采用二选一：

方案 A（推荐稳妥）：

1. 迁移到 `src/legacy/qrcode-generator.js`
2. 新增 `src/legacy/README.md` 说明保留周期与删除条件
3. 在一个版本观察期后删除

方案 B（直接）：

1. 直接删除 `src/libs/qrcode-generator.js`
2. 在变更说明中记录“删除依据 = 全仓无引用 + 冒烟通过”

验收：

- 不影响插件加载与主流程。

---

## 3. 回归与记录模板（每次执行后补齐）

建议按以下模板记录到 Phase 文档或本任务单末尾：

```text
### Phase 6.x 进度快照（YYYY-MM-DD）
- 本次完成：
  - ...
- 关键文件：
  - ...
- 校验命令：
  - ...
- 结果：
  - ... passed, 0 failed
- 阶段状态更新：
  - ...
```

---

## 4. 新对话可直接使用的起始指令

```text
请按 plans/phase6-task-sheet.md 逐项执行 Phase 6。
要求：
1) 严格按 Task 1 -> Task 4 顺序推进；
2) 每个 Task 完成后给出“改动清单 + 验收结果 + 下一步”；
3) 先跑检查再改动，禁止跳过规则 R1~R3；
4) 每个 Task 单独提交（phase6-1, phase6-2...）。
```

---

## 5. 执行记录（2026-02-24）

### Phase 6.1 进度快照（Task 1：遗留资产审计）
- 本次完成：
  - 完成 `qrcode-generator` 全仓引用审计与动态加载风险审计。
- 关键命令：
  - `rg -n "qrcode-generator|qrcode|QRCode" src tests index.js index.html README.md -g "!src/legacy/**"`
  - `rg -n "require\\(|import\\(" src | rg -n "qrcode|libs"`
- 结果摘要：
  - 静态引用：无匹配（exit code 1）
  - 动态引用：`NO_DYNAMIC_QRCODE_OR_LIBS_MATCH`
- 结论：
  - 运行时引用数可判定为 `0`，可进入 Task 4 处置决策。

### Phase 6.2 进度快照（Task 2：文档收口）
- 本次完成：
  - 在 `README.md` 新增“PS 模块边界与二开入口”章节；
  - 新增“手工 Smoke Checklist（UXP）”章节；
  - 明确“新增工具功能改哪里”与“facade 契约变更同步点”。
- 关键文件：
  - `README.md`
- 验收结果：
  - 新人仅阅读 README 即可获取 PS 模块职责、二开入口与最小冒烟步骤。

### Phase 6.3 进度快照（Task 3：踩坑规则固化）
- 本次完成：
  - 在 `README.md` 固化 R1~R4 规则与命令；
  - 修正 `ps` 诊断契约检查列表并导出 `REQUIRED_PS_EXPORTS`，对齐当前 facade。
- 关键文件：
  - `README.md`
  - `src/diagnostics/ps-env-doctor.js`
- 校验命令：
  - `@' ... '@ | node -`（BOM 检查：`manifest.json/index.html/index.js`）
  - `node --check index.js src/services/ps.js src/controllers/workspace-controller.js src/diagnostics/ps-env-doctor.js`
  - `node --test tests/services/ps/*.test.js tests/controllers/workspace/*.test.js tests/controllers/settings/*.test.js`
- 结果：
  - BOM：全部 `no BOM`
  - 测试：`41 passed, 0 failed`

### Phase 6.4 进度快照（Task 4：遗留资产处置）
- 本次完成：
  - 采用方案 A：将 `src/libs/qrcode-generator.js` 迁移到 `src/legacy/qrcode-generator.js`；
  - 新增 `src/legacy/README.md`，记录保留周期与删除条件。
- 关键文件：
  - `src/legacy/qrcode-generator.js`
  - `src/legacy/README.md`
- 回归结果：
  - `node --test tests/services/ps/*.test.js tests/services/runninghub-runner/*.test.js tests/services/runninghub-parser/*.test.js tests/application/usecases/*.test.js tests/application/services/*.test.js tests/controllers/settings/*.test.js tests/controllers/workspace/*.test.js tests/domain/policies/*.test.js`
  - `222 passed, 0 failed`
- 阶段状态更新：
  - Phase 6 验收口径（Task 1~4）已全部落地，可进入“提交与发布前检查”。

### Phase 6.5 进度快照（2026-02-24）
- 本次完成：
  - 手工功能复测（用户反馈）：“简单测试后功能无明显问题”。
- 覆盖范围（反馈口径）：
  - 工作台与主要功能链路可用，未发现新的阻断问题。
- 结果：
  - 手工验证通过（以用户实测为准）。
- 阶段状态更新：
  - Phase 6 维持“已完成”，可执行归档提交 `phase6`。
