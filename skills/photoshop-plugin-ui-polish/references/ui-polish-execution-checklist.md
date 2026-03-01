# UI Polish Execution Checklist (No Logic / No Layout Change)

Use this checklist before and after each polish task.

## Pre-Edit

1. Scope freeze
- Identify files to touch (prefer style-only files first).
- Mark logic files as read-only unless selector wiring is unavoidable.

2. Invariant capture
- Record major container order and component map.
- Capture current screenshots for before/after comparison.

3. Rule selection
- Apply `photoshop-uxp-ui-guidelines.md`.
- Apply `gemini-3-ui-style-signals.md`.
- Apply `no-oval-icon-system.md`.

## During Edit

1. Token-first styling
- Define/normalize variables before per-component overrides.

2. State completeness
- Style hover, focus, active, disabled, and loading states.

3. Icon cleanup
- Replace oval icon geometry during component pass.

4. Keep architecture stable
- Do not reorder DOM structure.
- Do not move functional controls across regions.

## Post-Edit Validation

1. Diff check
- Confirm changes are visual-only.
- Confirm no behavior-changing JavaScript edits.

2. Layout integrity
- Confirm the same section hierarchy and arrangement remain.
- Confirm narrow-width panel behavior still works.

3. Theme and contrast
- Validate light and dark host themes.
- Validate readable contrast for primary text and controls.

4. Icon compliance
- Confirm no oval icon wrappers remain.
- Confirm icon sizes, alignment, and stroke weight consistency.

5. Interaction safety
- Confirm keyboard focus visibility.
- Confirm long operations still show loading/progress states.
