---
name: photoshop-plugin-ui-polish
description: Beautify an existing Photoshop UXP plugin UI while preserving runtime logic and existing layout structure. Use when requests ask for visual polish, theme consistency, typography/color/icon refinement, or Gemini 3 Pro / 3.1 Pro inspired styling without changing feature behavior, information architecture, or panel flow.
---

# Photoshop Plugin UI Polish

Polish UI quality without touching business logic or layout architecture.

## Hard Constraints

- Do not change runtime logic:
  - no business logic rewrites
  - no API/request flow changes
  - no behavior changes in command execution paths
- Do not change layout architecture:
  - no reordering existing sections
  - no replacing layout model (for example, grid to stacked flow) unless explicitly requested
  - no feature relocation between major regions
- Keep edits visual-first:
  - tokens, color, typography, borders, shadows, spacing rhythm, motion, icon styling
- Enforce icon rule:
  - disable oval icon shapes in UI and icon containers
  - use square/rounded-rect icon language instead

## Workflow

1. Audit and freeze invariants
- Identify files, components, and selectors that define runtime logic and structural layout.
- Record invariants before changes: DOM order, main containers, and control semantics.

2. Derive target visual system
- Use Gemini design signals from `references/gemini-3-ui-style-signals.md`.
- Translate those signals into a deterministic, fixed-layout plugin style (no generated runtime UI).

3. Apply cosmetic changes only
- Normalize tokens into a compact CSS variable set.
- Improve hierarchy via typography/contrast/spacing.
- Improve interaction states with restrained motion.
- Replace oval icons with the rules in `references/no-oval-icon-system.md`.

4. Validate against Photoshop UXP constraints
- Run the checks in `references/photoshop-uxp-ui-guidelines.md`.
- Ensure narrow panel widths are still usable with no clipping.
- Ensure theme-aware contrast remains valid for light/dark host themes.

5. Final guardrail pass
- Re-check that logic/layout were not changed.
- Keep diff focused on visual files and style declarations.
- Use `references/ui-polish-execution-checklist.md` before handing off.

## Resource Routing

- Read `references/gemini-3-ui-style-signals.md` when selecting color, typography, module treatment, and motion tone.
- Read `references/photoshop-uxp-ui-guidelines.md` before editing or reviewing Photoshop plugin UI.
- Read `references/no-oval-icon-system.md` before any icon-related change.
- Use `references/ui-polish-execution-checklist.md` as the final QA gate.

## Output Requirements

- Provide a short style rationale tied to references.
- Explicitly confirm:
  - no logic change
  - no layout architecture change
  - oval icons removed/disabled
