# Photoshop UXP UI Guidelines For Polish Passes

Last reviewed: 2026-03-01

## Primary Sources

- Photoshop plugin UX guidance (Adobe): panel behavior, minimum width guidance, and Spectrum usage.
  - https://developer.adobe.com/photoshop/uxp/2022/guides/ux-guidelines/
- Photoshop UXP known issues (Adobe): icon requirements and panel icon specs.
  - https://developer.adobe.com/photoshop/uxp/2021/uxp/known-issues/
- Photoshop Marketplace submission checklist: theme awareness, clipping/resize behavior, loading-state expectations.
  - https://developer.adobe.com/photoshop/uxp/2022/guides/distribution/submission-checklist/

## Non-Negotiable Constraints For UI Refresh

1. Panel width safety
- Avoid forcing a panel minimum width above 240px.
- Keep controls readable and operable at narrow widths.

2. Theme awareness
- Validate visual quality in light and dark host themes.
- Ensure icon contrast and text readability in both themes.

3. Resize behavior
- No clipped or overlapped controls during panel resize.
- If overflow is unavoidable, support scrolling instead of hidden content.

4. Spectrum alignment
- Prefer Adobe Spectrum-compatible control styling and interaction semantics.
- Keep spacing and type choices aligned with native plugin expectations.

5. Icon constraints
- Panel icons are expected as 23x23 PNG assets in many Photoshop UXP workflows.
- If multiple panels exist, each panel should use a distinct icon.

6. Runtime feedback
- Long-running operations should have a visible loading/progress state.
- UI should not appear blank or frozen while work is active.

## Practical Review Checklist

- Confirm no text clipping at minimum panel width.
- Confirm no control overlap while increasing/decreasing width.
- Confirm focus rings remain visible in all themes.
- Confirm disabled and loading states are visually distinguishable.
- Confirm icon assets remain sharp at 1x/2x and are not oval-framed.
