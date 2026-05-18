# 自定义背景下拉框样式修复方案

## 问题描述

当使用自定义背景（`has-custom-theme-image`）时，工作台中的下拉框（`<select class="field-input">`）呈现全白背景，导致选项文字不可见。只有当鼠标悬浮时才会显示具体参数。

## 根因分析

### 1. 样式覆盖链

在 [`app.css`](../PixelRunnerV2.4.0/app.css) 中，存在两条关键的样式规则：

**基础样式**（第 2775-2791 行）：
```css
.field-input {
  appearance: none;
  -webkit-appearance: none;
  min-height: 30px;
  width: 100%;
  padding: 5px 8px;
  border-radius: 12px;
  border: 2px solid var(--ink);
  background: rgba(var(--surface-soft-rgb), var(--surface-soft-alpha));
  color: var(--text-strong);
  ...
}
```

**自定义背景覆盖**（第 208-217 行）：
```css
body.has-custom-theme-image .input-zone,
body.has-custom-theme-image .field-input,
body.has-custom-theme-image .workspace-app-meta,
body.has-custom-theme-image .image-capture-stage,
body.has-custom-theme-image .image-capture-preview {
  background:
    linear-gradient(180deg, rgba(8, 14, 21, 0.4), rgba(8, 14, 21, 0.26));
  backdrop-filter: blur(10px) saturate(1.14);
  -webkit-backdrop-filter: blur(10px) saturate(1.14);
}
```

### 2. 问题本质

`<select>` 元素在浏览器中有特殊的渲染机制：

1. **`appearance: none`** 移除了浏览器原生的下拉箭头样式，但 `<select>` 的下拉面板（`<option>` 列表）仍然由操作系统/浏览器绘制
2. **自定义背景覆盖** 将 `.field-input` 的背景设置为半透明渐变背景（`rgba(8, 14, 21, 0.4)` 到 `rgba(8, 14, 21, 0.26)`），这导致 `<select>` 元素的背景变得很淡
3. **`<option>` 元素没有独立的样式定义**，浏览器使用系统默认样式渲染下拉选项面板，在 Windows 上默认是白色背景 + 黑色文字
4. 由于 `<select>` 本身背景是半透明的，下拉面板（dropdown）在展开时显示为白色背景（系统默认），而选项文字也是深色，导致文字在白底上几乎不可见

### 3. 关键代码位置

下拉框渲染在 [`src/webview/workspace.js`](../PixelRunnerV2.4.0/src/webview/workspace.js:911-920)：
```javascript
if (input.type === "select" || input.type === "enum") {
  const options = Array.isArray(input.options) ? input.options : [];
  return `<label class="field dynamic-field">...<select class="field-input" data-form-key="${escapedKey}">...`;
}
```

## 修复方案

### 方案一：为 `select.field-input` 添加独立的深色背景（推荐）

在 `body.has-custom-theme-image` 的样式块中，为 `select.field-input` 单独设置一个不透明或高不透明度的深色背景，确保下拉面板的背景是深色的。

**修改位置**：[`app.css`](../PixelRunnerV2.4.0/app.css) 第 208-217 行之后

```css
/* 修复自定义背景下 select 下拉框背景过白的问题 */
body.has-custom-theme-image select.field-input {
  background: rgba(12, 20, 29, 0.85);
  color: var(--text-strong);
}

body.has-custom-theme-image select.field-input option {
  background: #1a2533;
  color: #d8e5f0;
}
```

### 方案二：全局统一 select 的 option 样式

为所有 `select.field-input option` 设置深色背景和浅色文字，不限于自定义背景模式。

```css
select.field-input option {
  background: #1a2533;
  color: #d8e5f0;
}
```

### 推荐方案

**组合使用方案一和方案二**：
1. 全局为 `option` 设置深色主题，确保在任何模式下下拉选项都清晰可读
2. 在 `has-custom-theme-image` 下为 `select.field-input` 设置更实心的背景，避免半透明背景导致视觉混乱

## 修改文件

仅需修改 [`PixelRunnerV2.4.0/app.css`](../PixelRunnerV2.4.0/app.css)

## 影响范围

- 所有使用 `.field-input` 类的 `<select>` 元素
- 工作台中的动态表单下拉框
- 不影响其他输入类型（text、textarea、number）
