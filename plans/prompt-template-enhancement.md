# 提示词卡片系统增强计划

## 项目概述

为RunningHub Photoshop插件增加提示词模板的JSON批量导入导出功能，以及在工作台支持多选提示词组合输入。

## 技术方案

### 1. JSON导入导出功能

#### 1.1 JSON格式规范

```json
{
  "version": "1.0",
  "exportedAt": "2026-02-20T07:30:00.000Z",
  "app": "RunningHub Photoshop Plugin",
  "templates": [
    {
      "id": "high_quality",
      "title": "高质量二次元",
      "content": "masterpiece, best quality, anime style...",
      "createdAt": 1700000000000
    }
  ]
}
```

#### 1.2 导出功能实现

**位置**: [`src/controllers/settings-controller.js`](src/controllers/settings-controller.js)

**新增函数**:
- `exportTemplatesToJson()` - 导出所有模板到JSON文件
- `downloadJsonFile(data, filename)` - 触发文件下载

**UI修改**: 在提示词模板区域添加"导出JSON"按钮

#### 1.3 导入功能实现

**新增函数**:
- `importTemplatesFromJson(file)` - 从JSON文件导入模板
- `validateImportData(data)` - 验证导入数据格式
- `mergeTemplates(existing, imported)` - 合并模板（重复title覆盖）

**UI修改**: 在提示词模板区域添加"导入JSON"按钮和隐藏的文件输入框

### 2. 提示词组合功能

#### 2.1 多选UI设计

**位置**: [`src/controllers/workspace-controller.js`](src/controllers/workspace-controller.js)

**修改函数**:
- `renderTemplatePickerList()` - 支持多选渲染
- `openTemplatePicker()` - 支持多选模式参数

**新增状态**:
```javascript
state.selectedTemplates = new Set(); // 已选中的模板ID
state.isMultiSelectMode = false;     // 是否多选模式
```

#### 2.2 字符限制逻辑

**常量定义**:
```javascript
const MAX_TEMPLATE_SELECTION = 5;    // 最多选择5个
const MAX_PROMPT_LENGTH = 4000;      // RunningHub限制4000字符
const TEMPLATE_SEPARATOR = ", ";     // 分隔符：逗号+空格
```

**新增函数**:
- `calculateCombinedLength(templateIds)` - 计算组合后字符数
- `validateSelection(templateIds)` - 验证选择是否合法

#### 2.3 交互设计

**单选模式**（向后兼容）:
- 点击模板标题/内容区域 → 直接选择并关闭模态框

**多选模式**:
- 点击模板左侧checkbox → 切换选中状态
- 底部显示"已选择 X/5"和字符计数
- 超过4000字符时显示警告并禁用确认按钮
- "确认组合"按钮将选中的提示词用", "连接填入输入框

### 3. 文件修改清单

#### 3.1 HTML结构修改 ([`index.html`](index.html))

**设置页面 - 提示词模板区域** (约272-285行):
```html
<div class="setting-section">
  <div class="setting-section-title">提示词模板</div>
  <!-- 现有表单... -->
  <div class="template-actions-row">
    <button id="btnExportTemplates" type="button" class="main-btn">导出JSON</button>
    <button id="btnImportTemplates" type="button" class="main-btn main-btn-secondary">导入JSON</button>
    <input type="file" id="templateImportFile" accept=".json" style="display:none">
  </div>
  <div id="savedTemplatesList" class="saved-list"></div>
</div>
```

**工作台 - 模板选择器模态框** (约333-341行):
```html
<div id="templateModal" class="modal-overlay">
  <div class="modal-content">
    <div class="modal-header">
      选择提示词模板
      <button id="templateModalClose" class="modal-close" type="button">&times;</button>
    </div>
    <div id="templateList" class="template-list"></div>
    <div id="templateMultiSelectControls" class="template-multi-controls" style="display:none">
      <div class="template-selection-info">
        <span id="templateSelectionCount">已选择 0/5</span>
        <span id="templateCharCount">0/4000 字符</span>
      </div>
      <div class="template-selection-actions">
        <button id="btnClearTemplateSelection" type="button" class="tiny-btn">清空</button>
        <button id="btnConfirmTemplateSelection" type="button" class="main-btn main-btn-primary" disabled>确认组合</button>
      </div>
    </div>
  </div>
</div>
```

#### 3.2 JavaScript修改

**Store服务** ([`src/services/store.js`](src/services/store.js)):
- 可能需要添加批量导入模板的方法

**设置控制器** ([`src/controllers/settings-controller.js`](src/controllers/settings-controller.js)):
- 添加导入导出事件处理
- 添加文件读取逻辑

**工作台控制器** ([`src/controllers/workspace-controller.js`](src/controllers/workspace-controller.js)):
- 修改模板选择器逻辑支持多选
- 添加字符计数和验证

**工作区输入模块** ([`src/controllers/workspace/workspace-inputs.js](src/controllers/workspace/workspace-inputs.js)):
- 修改`openTemplatePicker`调用支持多选回调

#### 3.3 CSS样式添加 ([`style.css`](style.css))

需要添加的样式:
- `.template-actions-row` - 导入导出按钮行
- `.template-multi-controls` - 多选控制栏
- `.template-selection-info` - 选择信息区
- `.template-checkbox` - 多选checkbox样式
- `.template-item-selected` - 选中状态样式

### 4. 实现顺序

1. **先实现JSON导入导出**（设置页面）
   - 风险低，不影响现有功能
   - 可以独立测试

2. **再实现提示词组合**（工作台）
   - 需要修改现有模板选择器
   - 需要确保向后兼容

### 5. 边界情况处理

#### 导入功能
- 空JSON文件 → 提示"文件为空"
- 格式错误 → 提示"JSON格式错误"
- 缺少必填字段 → 跳过该模板，记录错误
- 超大文件 → 限制文件大小（如1MB）
- 重复title → 覆盖现有模板

#### 组合功能
- 单个提示词超过4000字符 → 允许选择但显示警告
- 组合后超过4000字符 → 禁用确认按钮
- 选择0个提示词 → 禁用确认按钮
- 快速连续点击 → 防抖处理

## 验收标准

- [ ] 可以成功导出所有提示词模板为JSON文件
- [ ] 可以成功导入JSON文件并正确合并模板
- [ ] 导入时重复title的模板会覆盖现有模板
- [ ] 工作台预设按钮支持多选（最多5个）
- [ ] 组合时实时显示字符数，超过4000时给出警告
- [ ] 单选点击功能保持向后兼容
- [ ] 所有操作有适当的用户反馈
