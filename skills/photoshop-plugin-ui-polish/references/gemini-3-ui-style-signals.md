# Gemini 3 Pro / 3.1 Pro UI Style Signals

Last reviewed: 2026-03-01

## Source Snapshot

- Google Gemini app update: cleaner look, easier task start/discovery, better response formatting.
  - https://blog.google/products/gemini/google-gemini-app-updates-december-2025/
- Gemini 3 announcement: richer visualizations, deeper interactions.
  - https://blog.google/products/gemini/google-gemini-3/
- Gemini 3.1 announcement: "visual layout" (magazine-style arrangement), "dynamic view" (real-time custom UI), and code-based animation/visual generation.
  - https://blog.google/products/gemini/google-gemini-3-1/
- Google Research on generative interfaces: adaptive, context-driven UI generated from declarative descriptions and rich context.
  - https://research.google/blog/generative-interfaces/

## Stable Design Signals

1. Clean density
- Prefer compact, high-information panels over decorative chrome.
- Increase readability through stronger hierarchy, not larger layout blocks.

2. Better scan flow
- Present content in distinct visual modules/cards.
- Keep headings concise and action-oriented.

3. Rich but controlled visuals
- Add meaningful visual anchors (status chips, grouped metadata, subtle separators).
- Keep motion short and purposeful; avoid ornamental animation.

4. Interaction clarity
- Make next actions obvious with strong affordance and consistent state styling.
- Reduce ambiguity in hover/focus/disabled/loading states.

5. Crisp rendering
- Use vector-like icon treatment and sharp contrast boundaries.
- Avoid fuzzy icon containers and inconsistent radii.

## Translation To Fixed Photoshop Plugin UI

The signals above come from adaptive Gemini products. This section is an inference for fixed-layout Photoshop plugins:

- Keep existing panel structure and workflow, but restyle existing blocks as modules.
- Use one restrained token system:
  - color roles (`surface`, `surface-2`, `text-1`, `text-2`, `accent`)
  - radius scale (small set, no random per-component values)
  - shadow scale (0-2 levels only)
- Strengthen information rhythm:
  - title > subtitle > body > helper text
  - consistent spacing increments
- Keep motion subtle:
  - 120ms to 220ms transitions
  - opacity + slight translate only
- Remove oval icon language; use square/rounded-rect icon framing or glyph-only icons.

## Do Not Infer

- Do not copy Gemini layout architecture directly into plugin UI.
- Do not introduce generated runtime UI or dynamic schema-driven layouts unless requested.
- Do not trade usability for visual novelty.
