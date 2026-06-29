# Blend Match GPU Validation Acceleration Plan

Date: 2026-06-24

## Purpose

This document defines the next implementation plan for PixelRunner Blend Match GPU-assisted validation.

The goal is to make CPU hydrate much faster without sacrificing final quality:

- GPU should do more of the expensive search and validation work.
- CPU should gradually move from full recomputation to lightweight trusted guard checks.
- Final Apply must still consume a host-validated trusted `BlendMatchPlan`.
- GPU must not directly become the final Apply source of truth until parity is proven.

In short:

```text
GPU: fast search + rich validation evidence
CPU: conservative guard / spot-check / fallback
Final Apply: trusted host BlendMatchPlan only
```

## Current Expected Foundation

Before starting this plan, verify the current code instead of assuming it is present.

Expected current state:

- Preview first screen is split from CPU plan hydrate.
- `blendMatchPreviewSamples` can return raw source/reference samples with `previewDeferCpuPlan=true`.
- WebView renders quick preview first.
- CPU `BlendMatchPlan` is hydrated later through `blendMatchPreviewPlan`.
- Apply sends `planId` / `previewCacheKey`.
- Apply reuses valid CPU plans.
- Apply can reuse preview raw sample cache when the plan is missing but samples are still valid.
- WebGL alignment currently produces diagnostic/shadow candidates.
- First GPU-assisted hydrate version may exist:
  - WebView stores a hint-only GPU seed.
  - hydrate can attach seed only when `previewCacheKey` matches.
  - host accepts seed only as `seedTrust: "hint-only"`.
  - CPU validates the seed before using it as a fast path.
  - fallback to full CPU remains automatic.

Important: if any of this is missing or broken, fix that foundation first.

## Safety Principles

These rules are non-negotiable:

- GPU result must not directly become final Apply alignment.
- Final output must still be generated from a host-side trusted `BlendMatchPlan`.
- CPU reference behavior must remain available as fallback.
- GPU validation may reduce CPU work only after host-side validation or parity gates pass.
- If GPU is slow, unavailable, unstable, or low-confidence, the flow must not be slower than the current CPU hydrate path by more than a tiny grace window.
- Do not delete legacy corrections fallback.
- Do not break ColorPlan reuse.
- Do not break plan reuse.
- Do not break sampleCache fallback.
- Do not break layer visibility restoration.
- Do not do a large local mesh rewrite before global/affine parity is measurable.

## Desired End State

The target architecture has three validation tiers.

### Tier 1: Hint-Only GPU Seed

Status: first implementation target / likely already partially implemented.

GPU returns:

- refined global candidate
- top-K candidates
- basic timing
- basic shadow validation

CPU does:

- validate seed score using CPU gradient scoring
- refine around seed if strong enough
- fallback to full CPU global search if seed fails
- still runs affine / local mesh / ColorPlan normally

Expected result:

- Safe.
- Some acceleration when GPU seed is strong.
- Limited acceleration because CPU still does much of the validation.

### Tier 2: GPU Global Validation + CPU Spot-Check

GPU returns richer global validation evidence:

- best score
- second score
- score gap
- sample count
- edge overlap
- direction agreement
- top-K stability
- candidate neighborhood stability
- timing per stage

CPU does:

- small spot-check of the chosen transform and a few nearby candidates
- reject if GPU evidence is weak or CPU spot-check disagrees
- fallback to full CPU global search when rejected
- still runs affine / local mesh / ColorPlan normally

Expected result:

- Faster global hydrate.
- Still safe because CPU checks the final chosen transform.
- Useful parity data for future trust expansion.

### Tier 3: GPU Affine / Refine Validation + CPU Spot-Check

GPU expands beyond translation / uniform scale:

- dx/dy fine refine
- uniform scale refine
- non-uniform scale / stretch candidates
- small rotation candidates
- conservative model choice evidence

GPU returns:

- translation candidate and score
- affine candidate and score
- affine gain
- min required affine gain
- affine complexity
- selected model reason
- rejected affine reason if translation is preferred

CPU does:

- spot-check selected translation/affine candidates
- verify conservative thresholds
- fallback to full CPU refine if parity fails
- still runs local mesh / ColorPlan normally

Expected result:

- Best next major speedup with moderate risk.
- This should be prioritized before GPU local mesh.

### Tier 4: GPU Local Mesh Validation

GPU handles tile-level scoring:

- per-tile best dx/dy
- per-tile second score / score gap
- texture energy
- direction agreement
- tile coverage
- spread
- max distance
- local-vs-global validation score

CPU does:

- validate compact mesh summary
- spot-check a small subset of tiles
- fallback to CPU local mesh if coverage, score gain, or parity fails

Expected result:

- Largest potential speedup.
- Highest visual risk.
- Should only begin after Tier 2 and Tier 3 logs show stable parity.

## Recommended Implementation Order

### Step 0: Verify Current State

Run:

```text
git status --short
node --check PixelRunner/src/webview/blend-match.js
node --check PixelRunner/src/host/photoshop/blend-match.js
node --check PixelRunner/src/host/photoshop/tool-actions.js
```

Inspect:

- `refreshPreview`
- `hydratePreviewPlanFromHost`
- `runPreviewGpuDiagnostic`
- `hydrateBlendMatchPreviewPlan`
- `buildCpuBlendMatchPlanFromSamples`
- `estimateGradientAlignment`
- WebGL alignment engine search output

Exit criteria:

- Quick preview does not wait for GPU.
- Hydrate can complete without GPU.
- Apply still reuses CPU plan.
- Apply never consumes GPU as final alignment.

### Step 1: Make CPU Hydrate Bottlenecks Explicit

Add or verify logs for:

- WebView:
  - first preview visible total
  - GPU ready total
  - hydrate request start
  - GPU seed grace wait
  - CPU plan ready total

- Host:
  - CPU hydrate total
  - Sobel / gradient build time
  - global search time
  - translation refine time
  - affine / stretch / rotation refine time
  - local mesh time
  - ColorPlan time
  - seed accepted / rejected / fallback reason

Exit criteria:

- One Photoshop test run can answer where hydrate is slow.
- Logs clearly show whether GPU is ready before CPU plan ready.

### Step 2: Harden Tier 1 Seed Fast Path

If Tier 1 already exists, audit and tighten it.

Required behavior:

- WebView seed is attached only when `previewCacheKey` matches.
- hydrate grace window is short, around 80-120ms.
- seed payload is compact and serializable.
- host treats seed as `hint-only`.
- host rejects seed if:
  - preview cache key mismatches
  - sample size mismatches
  - seed trust is not `hint-only`
  - seed claims final eligibility
  - WebView shadow validation has a hard reject
  - score / gap thresholds are weak
  - CPU spot-check disagrees
- host logs:
  - `gpuSeed=true/false`
  - `seedCandidates=N`
  - `seedAccepted=true/false`
  - `fallbackFullCpu=true/false`
  - `seedRejectReason=...`

Exit criteria:

- No visual behavior change.
- Bad GPU seeds always fallback to full CPU.
- Good GPU seeds can reduce global search work.

### Step 3: Add GPU Global Validation Evidence

Extend WebGL alignment output to include validation metrics for each top candidate:

```js
{
  dx,
  dy,
  scale,
  score,
  secondScore,
  scoreGap,
  sampleCount,
  edgeOverlap,
  directionAgreement,
  neighborhoodStability,
  stage
}
```

Implementation notes:

- Avoid reading large per-pixel buffers back to JS.
- Prefer GPU-side reduction or compact per-candidate summaries.
- Keep top-K small, for example 6-8 candidates.
- Keep existing CPU fallback.

Host behavior:

- Use GPU metrics as evidence.
- CPU spot-check only selected candidate plus a tiny neighborhood.
- If GPU evidence and CPU spot-check disagree, fallback full CPU.

Exit criteria:

- Logs compare GPU global metrics with CPU spot-check.
- Global search time is lower on accepted cases.
- Rejected cases are no worse than current CPU path except the short grace/validation overhead.

### Step 4: Add GPU/CPU Global Parity Log

Add a shadow parity mode controlled by localStorage or debug flag:

```text
pixelrunner.blendMatch.gpuValidationParity = off | once | sampled | always
```

Log:

- score delta
- score gap delta
- chosen dx/dy delta
- scale delta
- accept/reject parity
- fallback reason

Example:

```text
GPU validation parity:
globalScoreDelta=0.004
scoreGapDelta=0.003
dxDelta=1
dyDelta=0
scaleDelta=0.05
acceptParity=true
verdict=parity-ok
```

Exit criteria:

- Can evaluate GPU validation reliability across real documents.
- No final behavior depends on parity mode.

### Step 5: Implement GPU Affine / Refine Evidence

Extend GPU search around top-K seeds:

- dx/dy local refine
- uniform scale local refine
- non-uniform scale pairs
- rotation candidates
- conservative translation-vs-affine selection evidence

Return compact evidence:

```js
{
  translation: {
    dx,
    dy,
    score,
    secondScore,
    scoreGap
  },
  affine: {
    dx,
    dy,
    scaleX,
    scaleY,
    rotation,
    score,
    secondScore,
    scoreGap
  },
  modelChoice: {
    selected,
    translationScore,
    affineScore,
    affineGain,
    minAffineGain,
    affineComplexity,
    rejectedAffine,
    reason
  }
}
```

Host behavior:

- CPU spot-checks selected translation and affine candidates.
- CPU recomputes conservative model choice thresholds.
- If spot-check passes, skip full CPU affine enumeration.
- If not, fallback full CPU refine.

Exit criteria:

- `fallbackFullCpu=false` on stable accepted cases.
- Affine/local quality does not regress in manual tests.
- Logs show model choice parity.

### Step 6: Only Then Consider GPU Local Mesh

Do not begin local mesh GPU work until:

- global parity is stable
- affine/model parity is stable
- accepted cases are visually consistent
- fallback behavior is proven

First local mesh milestone should be shadow-only:

- GPU computes tile candidate summary.
- CPU still computes final local mesh.
- Logs compare tile coverage / spread / accepted state.

Only after parity is stable:

- CPU may spot-check a subset of tiles.
- CPU may accept GPU local mesh summary.
- fallback to CPU local mesh remains available.

## Quality Gates

A GPU-accelerated validation path may skip full CPU only if all are true:

- Same `previewCacheKey`
- Same sample dimensions
- Seed trust is `hint-only`
- Candidate score is above conservative threshold
- Score gap is above conservative threshold, unless absolute score is very strong
- CPU spot-check agrees within thresholds
- Transform is within configured max offset / scale / rotation / stretch
- Conservative model choice agrees
- No hard validation reject

Recommended initial thresholds:

- dx/dy parity target: <= 1-2 sample pixels
- scale parity target: <= 0.15%
- rotation parity target: <= 0.15 degrees
- global score delta target: <= 0.01
- accept/reject parity: required before trust expansion

If unsure, fallback full CPU.

## UX Requirements

- Quick preview must not wait for GPU validation.
- GPU seed grace window may wait only after quick preview is visible.
- Grace window should remain short: 80-120ms.
- If GPU validation is used, overlay may say:
  - `GPU 已提供候选`
  - `CPU 正在验证`
- If GPU is unavailable, UI should behave like CPU-only hydrate.
- Apply button remains disabled until trusted CPU/host plan is ready, except existing sampleCache apply fallback behavior.

## Logging Checklist

WebView logs:

- `GPU seed ready total`
- `GPU validation ready total`
- `GPU seed hydrate grace`
- `GPU seed attached to hydrate request`
- `previewCacheKeyMatch`
- `first preview visible total`
- `CPU plan ready total`

Host logs:

- `CPU hydrate gpuSeed=true/false`
- `seedCandidates=N`
- `seedAccepted=true/false`
- `fallbackFullCpu=true/false`
- `seedRejectReason=...`
- `CPU alignment 分段`
- `globalSearchMs`
- `affineRefineMs`
- `localMeshMs`
- `ColorPlanMs`
- `GPU/CPU parity verdict`
- `Apply GPU seed 状态：never final`

## Manual Test Plan

Photoshop/UXP tests:

1. Open Blend Match and confirm quick preview appears immediately.
2. Confirm GPU diagnostic starts only after quick preview is visible.
3. Confirm hydrate request attaches seed only when preview cache key matches.
4. Confirm host logs either `seedAccepted=true` or `fallbackFullCpu=true`.
5. Confirm plan ready then Apply logs `cachedPlan=true`.
6. Confirm Apply logs that GPU seed is never final.
7. Force WebGL unavailable and confirm CPU-only path still works.
8. Test large offset case.
9. Test small/no offset case.
10. Test case that needs affine/scale/rotation.
11. Test case that needs local mesh.
12. Test hydrate failure with sample cache still valid, then Apply should show `sampleCache=true`.
13. Test sampling failure and confirm layer visibility is restored.

## Verification Commands

After implementation:

```text
node --check PixelRunner/src/webview/blend-match.js
node --check PixelRunner/src/host/photoshop/blend-match.js
node --check PixelRunner/src/host/photoshop/tool-actions.js
node --check PixelRunner/src/webview/blend-match/gpu/webgl-alignment.js
node --check PixelRunner/src/webview/blend-match/gpu/webgl-blend-preview.js
cd PixelRunner
npm run build
npm run check:dist
npm run package:release
```

If `package:release` refreshes `release/PixelRunnerV2.5.5` but does not refresh `release/PixelRunnerV2.5.5.zip`, manually rebuild the zip with the same top-level folder structure.

## Recommended Next Implementation Batch

The next batch should not jump directly to GPU local mesh.

Recommended scope:

1. Audit the current Tier 1 seed fast path.
2. Add missing CPU hydrate sub-stage timing if not already present.
3. Extend WebGL global validation summary:
   - score
   - secondScore
   - scoreGap
   - sampleCount
   - direction/overlap if feasible
   - top-K stability
4. Add host CPU spot-check around GPU chosen candidate.
5. Add GPU/CPU global parity logs.
6. Keep full CPU fallback as default on any uncertainty.

This is the safest high-speed path: it reduces repeated CPU global work first, while leaving affine/local/final Apply quality protected.

## New Conversation Handoff Prompt

Use this prompt in a fresh Codex conversation:

```text
你正在接手 PixelRunner 的融合校色 / Blend Match GPU 验证提速任务。请先阅读：

- plans/blend-match-rewrite-plan.md
- plans/blend-match-gpu-validation-acceleration-plan.md
- PixelRunner/src/webview/blend-match.js
- PixelRunner/src/host/photoshop/blend-match.js
- PixelRunner/src/host/photoshop/tool-actions.js
- PixelRunner/src/webview/blend-match/gpu/webgl-alignment.js
- PixelRunner/src/webview/blend-match/gpu/webgl-blend-preview.js

先运行 git status --short，确认工作区现状，不要回退用户改动。

任务目标：

在不牺牲最终效果的前提下，让 GPU 承担更多 Blend Match hydrate 阶段的 validation 工作，使 CPU 从完整重算逐步降级为轻量 guard / spot-check / fallback。最终 Apply 仍只能消费 host-side trusted CPU/host BlendMatchPlan，GPU 不能直接成为最终 Apply alignment。

当前预期基础：

- 快速预览已与 CPU plan hydrate 拆分。
- WebView 先显示 raw quick preview。
- CPU BlendMatchPlan 通过 blendMatchPreviewPlan 后台补齐。
- Apply 发送 planId / previewCacheKey，并复用有效 CPU plan。
- Apply 在 plan 缺失但 preview raw sample cache 命中时，可复用 sample cache 补建 CPU plan。
- WebGL alignment 已有 diagnostic/shadow candidate。
- 可能已有第一版 GPU-assisted hydrate：
  - WebView 保存 latestGpuAlignmentSeed。
  - hydrate 有 80-120ms grace window。
  - 同 previewCacheKey 的 seed 会作为 hint-only payload 发给 host。
  - host 只把 seed 当 hint-only accelerator。
  - host 验证不过就 fallbackFullCpu=true。
  - Apply 日志应明确 GPU seed never final。

请按以下顺序直接执行：

1. 审查当前 Tier 1 seed fast path 是否真实存在并安全：
   - quick preview 是否不等待 GPU。
   - hydrate seed 是否只在 previewCacheKey match 时附带。
   - host 是否校验 seedTrust=hint-only。
   - host 是否拒绝 stale/mismatch/low-confidence seed。
   - fallbackFullCpu 是否仍自动生效。
   - Apply 是否没有传入或使用 gpuAlignmentSeed。

2. 如果发现 Tier 1 的小 bug，先修复。

3. 补齐或确认 hydrate 分段日志：
   - WebView: GPU seed ready total / hydrate grace / CPU plan ready total。
   - Host: sobel / global search / refine / local mesh / ColorPlan / total。

4. 实现下一批最小可验证提速，不要碰最终 Apply 可信边界：
   - 扩展 WebGL global validation summary，至少输出 top-K 的 score、secondScore 或 scoreGap、sampleCount；如果低风险，再加 directionAgreement / edgeOverlap。
   - 避免大 buffer readback，优先返回 compact summary。
   - Host 用 GPU validation summary 做 evidence，但必须做 CPU spot-check。
   - 只有 GPU evidence 强且 CPU spot-check 通过时，才跳过完整 CPU global 粗搜。
   - 否则 fallbackFullCpu=true。

5. 增加 GPU/CPU parity 日志：
   - scoreDelta
   - scoreGapDelta
   - dx/dy/scale delta
   - acceptParity
   - verdict=parity-ok/parity-warn/parity-fallback

6. 不要开始 GPU local mesh trusted path。local mesh 可以只做 shadow 规划或日志，除非 global/affine parity 已稳定。

7. 保持 UX：
   - 首屏快速预览不等待 GPU。
   - GPU 不可用时不比当前更慢。
   - 如果 GPU validation 被使用，可显示“GPU 已提供候选，CPU 正在验证”。

8. 完成后运行：
   - node --check PixelRunner/src/webview/blend-match.js
   - node --check PixelRunner/src/host/photoshop/blend-match.js
   - node --check PixelRunner/src/host/photoshop/tool-actions.js
   - node --check PixelRunner/src/webview/blend-match/gpu/webgl-alignment.js
   - node --check PixelRunner/src/webview/blend-match/gpu/webgl-blend-preview.js
   - cd PixelRunner && npm run build
   - cd PixelRunner && npm run check:dist
   - cd PixelRunner && npm run package:release
   - 如果 release zip 没刷新，手动覆盖 release/PixelRunnerV2.5.5.zip。

重要约束：

- 稳优先，快第二，但要做真实提速，不要只写日志。
- GPU 可以做更多验证，但不能直接成为 final Apply truth。
- CPU/host trusted BlendMatchPlan 仍是最终执行唯一依据。
- 不要破坏 plan reuse。
- 不要破坏 sampleCache fallback。
- 不要破坏 ColorPlan 最终执行复用。
- 不要破坏图层可见性恢复。
- 不要删除 legacy corrections fallback。
- 不要大规模重写整个 Blend Match 模块。

最后交付时请说明：

- GPU 新增了哪些 validation evidence。
- CPU spot-check 做了什么。
- 哪些情况下 seed/validation accepted。
- 哪些情况下 fallbackFullCpu。
- Apply 是否仍完全不受 GPU final 影响。
- Photoshop/UXP 手测步骤。
```
