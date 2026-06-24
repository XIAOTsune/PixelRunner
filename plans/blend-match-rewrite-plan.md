# PixelRunner Blend Match Rewrite Plan

Date: 2026-06-24

Related local commits:

- `20f2c14` - `融合慢优化`
- `2328734` - `gpu优化`
- `26fedd7` - `gpu优化2`

## Goal

Rewrite the Blend Match / 融合校色 module so it can perform fast correction without losing alignment precision, color quality, or preview-to-final consistency.

The rewrite should not merely add another GPU shortcut. The core goal is to make preview and final execution consume the same analysis result, so the module has one source of truth for alignment, local deformation, color matching, and validation.

## Current State Summary

The recent commits improved the hot preview path but did not resolve the architectural split.

`融合慢优化` added frontend timing and logging around preview refresh. This helped identify where time is spent but did not change the pipeline.

`gpu优化` added a WebGL2 alignment path and a host action named `blendMatchPreviewSamples`. The host captures source/reference samples, then the WebView estimates global alignment on GPU.

`gpu优化2` removed JPEG/PNG encoding from the GPU preview sampling path. Host preview sampling now captures raw RGBA, computes stats outside `executeAsModal`, serializes raw samples, and lets the WebView build preview canvases directly.

These changes are useful, but the current module still cannot reliably meet the target because preview, final application, CPU alignment, GPU alignment, and color rendering are not unified.

## Main Problems To Fix

### 1. Preview and final application use different truth sources

The WebView GPU preview computes an alignment result in `PixelRunner/src/webview/blend-match.js`, but final application still calls `blendMatchActiveLayer` in `PixelRunner/src/host/photoshop/blend-match.js`, where CPU alignment is computed again unless a host-side preview cache exists.

In the current GPU preview path, `sampleResult.previewCacheKey` is set to an empty string. As a result, pressing Apply after GPU preview usually causes host to re-sample and re-run CPU alignment.

Impact:

- Preview can be fast while Apply is still slow.
- Preview alignment can differ from the final generated layer.
- Debugging becomes confusing because "GPU preview result" and "host final result" are separate algorithm outputs.

### 2. GPU alignment only covers a subset of the CPU algorithm

The WebGL2 alignment engine currently covers:

- Sobel magnitude
- global translation
- uniform scale candidate search

The CPU alignment path also includes:

- translation refinement
- affine refinement
- non-uniform scale/stretch
- rotation
- local tile offsets
- local mesh validation
- conservative model selection

Impact:

- GPU preview can be faster, but it does not represent the full fidelity of the current CPU result.
- If CPU validation is disabled, GPU preview may lose precision on cases that need affine or local correction.
- If CPU validation is enabled, performance gains shrink because CPU alignment still runs.

### 3. Preview color and final color are different implementations

WebView preview currently uses simplified corrections derived from `buildCorrectionsFromStats`.

Final generation uses the internal color pipeline:

- `buildInternalColorProfile`
- `applyInternalColorCorrectionsToRgba`
- full-resolution warp
- PNG placement into Photoshop

Impact:

- Preview can look different from the final result.
- Improving preview speed alone does not guarantee quality or consistency.

### 4. Raw transfer is better than image encoding, but still wasteful

The GPU preview path still serializes raw RGBA as base64, sends it through the bridge, and decodes it in WebView with `atob`.

Impact:

- 512x512 x 2 RGBA samples become several MB of text transfer.
- CPU time is spent on base64 encode/decode.
- Memory churn increases.

### 5. GPU scoring still has synchronization bottlenecks

The current WebGL scoring path reads GPU buffers back to JS for every candidate batch and sums results on CPU.

Impact:

- GPU acceleration is limited by repeated `readPixels` synchronization.
- Larger searches become CPU/GPU round-trip bound.

## Target Architecture

Introduce a single intermediate product:

```js
BlendMatchPlan
```

Preview and final execution should both consume this plan. CPU and GPU should be backends that generate or refine the same plan shape.

The module should be split conceptually into five layers.

### 1. Capture Session

Responsibility:

- Photoshop-only work.
- Select target layer.
- Read layer bounds and document info.
- Capture source sample.
- Hide source layer.
- Capture reference sample.
- Restore visibility.
- Compute stable capture/session metadata.

Modal rule:

- `executeAsModal` should only include Photoshop operations that require modal access.
- Stats, hashing, CPU analysis, serialization, and plan building should happen outside modal where possible.

Output:

```js
BlendMatchSession
```

Suggested fields:

```js
{
  sessionId,
  documentId,
  layerId,
  layerName,
  bounds,
  configHash,
  sampleHash,
  previewSample: {
    width,
    height,
    scaleX,
    scaleY,
    source,
    reference,
    sourceStats,
    referenceStats
  },
  createdAt,
  timings
}
```

### 2. Analyzer

Responsibility:

- Convert a `BlendMatchSession` into a `BlendMatchPlan`.
- Use CPU as reference backend.
- Use GPU as acceleration backend where supported.
- Record confidence, validation, fallback reasons, and backend timings.

Output:

```js
BlendMatchPlan
```

Suggested fields:

```js
{
  planId,
  version: 1,
  documentId,
  layerId,
  bounds,
  config,
  configHash,
  sampleHash,
  sampleSize: { width, height, scaleX, scaleY },
  alignment: {
    backend,
    applied,
    dx,
    dy,
    scaleXPercent,
    scaleYPercent,
    rotation,
    confidence,
    score,
    sampleDx,
    sampleDy,
    sampleScaleX,
    sampleScaleY,
    sampleRotation,
    modelChoice,
    search,
    local,
    validation
  },
  color: {
    method,
    corrections,
    profile,
    lut,
    stats,
    validation
  },
  preview: {
    sourceTextureKey,
    referenceTextureKey,
    renderMode
  },
  timings,
  warnings
}
```

Important rule:

GPU results must never be a separate format. A GPU analyzer may produce a partial plan, but the final output must be normalized into the same `BlendMatchPlan` schema.

### 3. Preview Renderer

Responsibility:

- Render before/after preview from `BlendMatchPlan`.
- Use the same alignment and color parameters as final execution.
- Use WebGL2 when available and CPU canvas fallback when unavailable.

Preview should not independently decide alignment or color. It should only render the plan.

### 4. Executor

Responsibility:

- Validate `planId`, `documentId`, `layerId`, `bounds`, `configHash`, and `sampleHash`.
- If the plan is still valid, reuse it.
- Capture full-resolution isolated source.
- Apply plan alignment and color at full resolution.
- Encode/place final PNG result layer.
- Hide backup layer and apply feather mask according to settings.

The executor should not re-run preview analysis unless the plan is missing, stale, or invalid.

### 5. Cache And Bridge

Responsibility:

- Maintain host-side session and plan cache.
- Allow WebView to store/use a plan key.
- Probe whether typed array / `ArrayBuffer` bridge transfer is available.
- Prefer binary transfer over base64 when supported.

Cache entries should be invalidated by:

- document id change
- layer id change
- bounds change
- config hash change
- source/reference sample hash change
- age limit
- explicit user refresh

## Proposed Implementation Phases

### Phase 0: Baseline And Guard Rails

Purpose:

Create a reliable baseline before changing behavior.

Tasks:

- Add structured timing logs for capture, stats, alignment, local mesh, color, warp, PNG encode, and placement.
- Add a compact `alignmentSummary` and `colorSummary` to logs.
- Add an internal debug flag for CPU shadow comparison.
- Save selected diagnostic snapshots only behind an explicit debug flag.
- Define quality checks:
  - alignment delta vs CPU reference
  - local mesh accepted/rejected parity
  - final image pixel diff against old CPU output on test cases

Exit criteria:

- Existing behavior still works.
- We can compare old CPU result and new plan result.

### Phase 1: Extract Shared Plan Schema Without Behavior Change

Purpose:

Introduce `BlendMatchPlan` while keeping CPU as the only trusted analyzer.

Tasks:

- Create a plan builder around current CPU alignment and color logic.
- Wrap current `estimateGradientAlignment`, `buildCorrections`, and `buildInternalColorProfile` outputs into `BlendMatchPlan`.
- Make old CPU preview path and final execution read from the plan object.
- Keep old fallback paths available.

Expected files:

- `PixelRunner/src/host/photoshop/blend-match.js`
- optional new module: `PixelRunner/src/host/photoshop/blend-match-plan.js`
- optional new module: `PixelRunner/src/webview/blend-match/plan.js`

Exit criteria:

- No intentional visual behavior change.
- Final application can consume a CPU-built plan.

### Phase 2: Host Plan Cache And Apply Reuse

Purpose:

Make preview analysis reusable by final application.

Tasks:

- Replace or extend `blendMatchPreviewCache` with a session/plan cache.
- Return `planId` and `previewCacheKey` from preview refresh.
- Store the latest valid plan in WebView state.
- Modify `runBlendMatch` so Apply sends `planId` or `previewCacheKey`.
- Modify `blendMatchActiveLayer` to reuse plan alignment/color when valid.
- Log whether Apply used cached plan or re-analyzed.

Important:

This phase should deliver immediate performance gain even before further GPU work.

Exit criteria:

- Pressing Apply after preview does not re-run CPU preview alignment when plan is valid.
- Logs clearly show `cachedPlan: true`.
- Result matches the previous CPU final output within expected tolerance.

### Phase 3: Unify Color Plan Between Preview And Final

Purpose:

Eliminate preview/final color drift.

Tasks:

- Define `ColorPlan` as part of `BlendMatchPlan`.
- Move final color profile parameters into a serializable plan.
- Update WebGL preview shader to render from `ColorPlan`, not only simplified brightness/contrast/saturation/colorBalance.
- Keep simplified correction preview as fallback only.

Exit criteria:

- Preview and final output are visually consistent.
- Color changes in sliders update preview by re-rendering from plan or rebuilding only the color sub-plan when needed.

### Phase 4: GPU Analyzer Backend V2

Purpose:

Use GPU for speed without sacrificing CPU result quality.

Tasks:

- Keep CPU analyzer as reference backend.
- Refactor WebGL alignment so it returns the same `alignment` schema as CPU.
- Implement coarse-to-fine global search:
  - low-resolution translation seed
  - local translation refinement
  - affine refine around best seed
  - conservative model selection
- Add GPU top-K or reduced readback to avoid reading every candidate batch into JS.
- Add CPU shadow compare mode:
  - `off`
  - `once`
  - `sampled`
  - `always`
- If GPU/CPU diff exceeds threshold, fallback to CPU plan and log reason.

Exit criteria:

- GPU plan matches CPU within accepted thresholds on reference cases.
- GPU path does not disable affine/local quality.
- Unsupported WebGL devices fall back cleanly.

### Phase 5: Local Mesh Integration

Purpose:

Restore precision for local deformation cases.

Tasks:

- First implementation may compute local mesh on CPU outside modal using the same preview session.
- Later implementation can move tile scoring to GPU.
- Store local mesh in `BlendMatchPlan`.
- Render local deformation in preview.
- Apply local mesh at full resolution by scaling the plan mesh.

Exit criteria:

- Cases that previously required local mesh still pass.
- GPU global fast path does not silently drop local correction.

### Phase 6: Transfer And Memory Optimization

Purpose:

Remove remaining avoidable overhead.

Tasks:

- Add bridge capability probe for structured clone / typed array transfer.
- Prefer `ArrayBuffer` for raw sample transfer where supported.
- Keep base64 fallback.
- Reuse typed arrays and WebGL textures where safe.
- Avoid rebuilding canvases/textures when sample hash is unchanged.

Exit criteria:

- Raw decode time is reduced or removed on supported hosts.
- Memory churn is lower during repeated preview refresh.

### Phase 7: Full-Resolution Executor Optimization

Purpose:

Reduce Apply time after analysis is solved.

Tasks:

- Reuse plan alignment/color.
- Avoid duplicate full-res samples where possible.
- Consider chunked CPU processing for large layers.
- Consider GPU/WebGL processing for full-res warp/color only if Photoshop/UXP memory limits are acceptable.
- Keep PNG encode/place as the last unavoidable host operation unless a better Photoshop pixel-write route is available.

Exit criteria:

- Apply after preview is dominated by full-res source capture, full-res processing, PNG encode, and placement.
- No repeated preview analysis happens on valid cached plans.

## Acceptance Targets

These are practical targets, not hard guarantees for every machine.

Preview:

- Repeated preview refresh on unchanged layer/config should avoid redundant Photoshop sampling.
- GPU preview path should clearly log capture, transfer/decode, analysis, render, and total time.
- For 512px preview samples, normal refresh should feel interactive.

Apply:

- Apply after a valid preview should reuse the plan.
- Apply should not run host CPU alignment again unless the plan is stale or invalid.
- Final visual result should match CPU reference output within acceptable tolerance.

Quality:

- Alignment deltas vs CPU reference should normally be under:
  - dx/dy: 1 to 2 sample pixels for confident cases
  - scale: 0.15%
  - rotation: 0.15 degrees
- If diff is larger, fallback to CPU plan.
- Local mesh accepted/rejected state should not be silently lost.
- Preview should closely match final generated layer.

Reliability:

- WebGL unavailable should fall back to CPU.
- 16-bit unsupported/limited paths should report clear messages.
- Layer visibility must always restore after capture failures.
- Cache validation must prevent using a plan for the wrong layer, bounds, or settings.

## Suggested File Organization

Keep changes conservative at first, but avoid leaving all logic in one 5000-line file.

Suggested new modules:

- `PixelRunner/src/host/photoshop/blend-match-plan.js`
- `PixelRunner/src/host/photoshop/blend-match-session.js`
- `PixelRunner/src/host/photoshop/blend-match-cache.js`
- `PixelRunner/src/webview/blend-match/plan.js`
- `PixelRunner/src/webview/blend-match/preview-controller.js`
- `PixelRunner/src/webview/blend-match/gpu/webgl-alignment-v2.js`

The first implementation may still route through existing `blend-match.js`, but new logic should be isolated behind small functions so it can be tested and replaced.

## Implementation Priorities

Recommended first PR / first implementation batch:

1. Define `BlendMatchPlan` and helpers.
2. Build CPU plan from existing host analysis.
3. Store and return `planId` from preview.
4. Let Apply reuse valid preview plan.
5. Add logs proving whether the plan was reused.
6. Keep current GPU preview path as optional/fallback until plan reuse works.

Do not start by rewriting the whole WebGL algorithm. First make the pipeline correct and reusable, then accelerate the analyzer.

## New Conversation Delivery Prompt

Use the prompt below in a fresh conversation:

```text
你正在接手 PixelRunner 的融合校色 / Blend Match 模块重写任务。请先阅读 plans/blend-match-rewrite-plan.md，然后仔细检查最近三个本地提交：

- 20f2c14 融合慢优化
- 2328734 gpu优化
- 26fedd7 gpu优化2

目标不是继续叠小补丁，而是按计划重构：让预览和最终应用共享同一个 BlendMatchPlan，使 CPU 是可靠参考实现，GPU 是加速后端，最终达到快速校正且不损失精度和效果。

请从计划中的 Phase 1 和 Phase 2 开始实施：

1. 定义 BlendMatchPlan / plan cache 的最小可用结构。
2. 用现有 CPU alignment 和 color 逻辑生成 plan，先不改变视觉效果。
3. 让预览返回可复用的 planId / previewCacheKey。
4. 让点击“应用”时复用有效预览 plan，避免重复采样和重复 CPU 对齐。
5. 保留现有 CPU/GPU fallback，不要删除旧路径。
6. 添加清晰日志，能看出 Apply 是否复用了 plan、何时因为失效而重新分析。
7. 完成后运行可用的构建/检查命令，并说明无法自动验证的 Photoshop/UXP 手测步骤。

重要约束：

- 不要牺牲现有最终效果。
- 不要让 GPU partial alignment 冒充完整 CPU 结果。
- 不要破坏图层可见性恢复。
- 保持改动聚焦在融合校色相关文件。
- 工作区可能有用户改动，修改前先看 git status，不要回退用户改动。

请先读代码和计划，再给出简短执行计划，然后直接实现 Phase 1/2 的第一批可落地改动。
```
