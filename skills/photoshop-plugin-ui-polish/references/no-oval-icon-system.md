# No Oval Icon System

User preference baseline: disable oval icon shapes.

## Ban List

- No circular or elliptical icon containers.
- No pill-shaped icon backgrounds used as default control chrome.
- No SVG `<ellipse>` for primary icon silhouette unless it is core product meaning and explicitly approved.
- No `border-radius: 9999px` icon wrappers in standard controls.

## Allowed Icon Geometry

1. Glyph-only icons
- 14px, 16px, or 20px glyph size.
- No container background for neutral actions.

2. Rounded-rectangle icon containers
- Radius in a constrained range (for example 4px to 8px).
- Use a square or near-square box; avoid capsule proportions.

3. Stroke consistency
- Keep stroke width consistent within one icon family.
- Match visual weight across dark/light themes.

## Replacement Rules

- Existing oval wrapper -> convert to rounded rectangle wrapper with same interaction role.
- Existing circular badge -> square badge with small radius and equivalent semantic color.
- Existing pill icon chip -> keep chip only when it carries text; icon-only chip must not be pill-shaped.

## CSS Review Patterns

Search for risky patterns before handoff:

- `border-radius: 50%`
- `border-radius: 9999px`
- class names containing `oval`, `circle`, `pill` on icon elements
- SVG paths containing `<ellipse>` used as frame/background

## Accessibility Notes

- Maintain hit target size even after removing oval backgrounds.
- Ensure focus/active states stay visible with keyboard navigation.
