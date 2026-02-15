# Parser / Workspace Handoff (2026-02-15)

## Current Status
- Parse debug confirms parser output is correct for app `2012102815430221826`:
  - `normalizedInputs` includes non-image fields (`number/text`).
  - `selectedRawCount=5`, `image=1`, non-image exists.
- Therefore the blocker is **workspace render stage**, not parser stage.

## Key Evidence From User Repro
- Workspace log shows `render inputs: image=1, other=4`.
- UI still showed `参数渲染失败，请重新解析应用后重试`.
- This proves non-image inputs are detected but rendering failed for all non-image entries.

## Root Cause Analysis
Likely one or more non-image fields can throw during dynamic control render (select/text/number inference + option extraction path). In old code, a single render exception could remove all non-image controls from final UI.

## Official API Doc Cross-check
- Verified against RunningHub doc pages:
  - `https://www.runninghub.cn/runninghub-api-doc-cn/api-335439604`
  - `https://www.runninghub.cn/runninghub-api-doc-cn/api-335448107`
- Key confirmed structure:
  - request body uses `nodeInfoList`.
  - each node param item uses `nodeId`, `fieldName`, `fieldValue`, and often `fieldData`.
  - `fieldData` can be a JSON string containing option objects (`name/index/default/description` etc.).
- Practical implication:
  - parser is allowed to output numeric/text fields directly from `type=FLOAT/INT/STRING`;
  - UI renderer must tolerate `fieldData` string/object formats and cannot assume `input.options` is always a plain string array.

## Changes Applied In This Round
### `src/controllers/workspace-controller.js`
1. Added resilient option parser:
- `parseOptionsFromUnknown(raw)`
- `getInputOptions(input)`
- `resolveUiInputType(input)`

2. Updated input partition logic:
- Use `resolveUiInputType` for image/non-image split.
- Added render debug line: `render inputs: image=..., other=...`.

3. Hardened non-image rendering loop:
- Wrap each field render in `try/catch`.
- On failure, log exact field + error message.
- Append fallback field instead of dropping whole panel.

4. Added fallback renderer:
- `createFallbackInputField(input, idx)`.
- Guarantees at least editable text control is visible for failed fields.

5. Improved select/number handling:
- `select` no longer assumes `input.options` is always array.
- If select options unresolved, degrade to text input.
- Number inputs now apply `min/max/step` when available.
- `fieldData` JSON-string objects are now recursively parsed (avoid `[object Object]` option pollution).

6. Image area text:
- Force overlay text to `点击从 PS 选区获取` after DOM creation.
- Camera icon style is handled in CSS (`.image-input-icon::before`).

7. Bounds resolve consistency:
- `resolveTargetBounds()` now uses `resolveUiInputType`.

### `style.css`
- `.image-input-icon` switched to pseudo-element camera icon (`📷`) to avoid glyph corruption from HTML text content.

## Validation Completed
- `node --check src/controllers/workspace-controller.js` passed after changes.

## Important Process Note (avoid repeat mistakes)
- Do **not** bulk rewrite JS files with encoding-converting commands during hotfix (can trigger hidden quote/encoding corruption).
- Prefer `apply_patch` scoped hunks.
- If a file unexpectedly changes encoding or shrinks, restore from git first and reapply minimal patches.

## Next Verification Steps
1. Reload plugin.
2. Switch to `Zimage自然磨皮`.
3. Check log:
   - `render inputs: image=1, other=4`
   - if any field fails, see `render input failed: <field> | <error>`.
4. Confirm non-image inputs are now visible (normal controls or fallback controls).
5. If fallback appears, capture one line of `render input failed` to continue targeted fix.

## Hotfix Update (2026-02-15 16:xx)
- New key finding:
  - In UXP runtime, `grid.childElementCount` can be unreliable/undefined.
  - This caused a false failure branch: controls were appended but still treated as zero, then replaced by
    `参数渲染失败...`.
- Applied fix in `src/controllers/workspace-controller.js`:
  - Added `getRenderedElementCount(node)` compatibility helper.
  - Replaced `grid.childElementCount` check with `getRenderedElementCount(grid)`.
  - Added log `rendered non-image inputs: <n>` for confirmation.
- Expected post-fix behavior:
  - For your sample app (`image=3, other=4`), workspace should render non-image controls instead of the failure text.

## Latest Unresolved State (2026-02-15 16:28+)
- User verified: issue still exists, non-image controls still not visible.
- New parse debug sample app: `1991550248581603329`
  - `selectedRawCount=7`
  - normalized inputs include:
    - 3 image
    - 3 select (`比例/分辨率/通道`)
    - 1 text (`提示词`)
  - This again proves parser is producing non-image inputs correctly.
- Workspace screenshot still shows only image panel + failure hint.
- Runtime log still contains `render inputs: image=3, other=4` (or `image=1, other=4` for another app), so non-image inputs are recognized before render output.

## Mandatory Next-AI Debug Order (Do Not Skip)
1. **Confirm loaded code version first**
- Add a temporary boot log marker in `workspace-controller` (e.g. `workspace-build: 2026-02-15Txx:xx`).
- If marker not shown after reload, stop and fix plugin loading path/cache first.

2. **Capture exact render failure path**
- In `renderDynamicInputs`, log all of:
  - `otherInputs.length`
  - per-field start (`render field start: key/type`)
  - per-field end (`render field ok: key`)
  - fallback path (`render field fallback: key`)
  - final container count (`grid.children.length`, `childNodes.length`, `outerHTML.length`)
- Keep these logs in `logWindow` (not only `console`) so user can paste directly.

3. **Differentiate “not rendered” vs “rendered but hidden”**
- Temporarily append one hardcoded text input after grid render.
- If hardcoded input not visible: layout/container/style issue.
- If hardcoded input visible but dynamic inputs missing: per-field creation failure.

4. **If per-field failure confirmed**
- Force all non-image fields to plain text controls (ignore select/text/number branching) and verify visibility.
- Then restore branches one by one: `text` -> `number` -> `select`.

5. **If style/layout issue confirmed**
- Inspect `style.css` duplicated selectors (`.input-grid`, `.dynamic-input-field`) for overriding side effects.
- Verify no runtime CSS class toggles hide `.dynamic-input-field` or `.input-grid`.

## Important Constraint For Next AI
- Avoid any whole-file re-encode/write operations (PowerShell `Set-Content` on JS files caused repeated mojibake/quote corruption in this repo).
- Use `apply_patch` only, with minimal hunks.
