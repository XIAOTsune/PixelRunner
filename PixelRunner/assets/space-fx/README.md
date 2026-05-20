# Space FX Built-In Assets

This folder contains optional runtime assets for the Space FX panel.

## Generated Smoke Atlas

`generated/smoke-atlas.png` is a transparent PNG atlas converted from a black-background smoke/fluid reference sheet.

`generated/smoke-atlas.json` stores detected frame rectangles. The webview loads these files lazily when the airflow effect is rendered. If the files are missing, Space FX falls back to the procedural airflow algorithm.

## Rebuild

From the plugin root:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/build-space-fx-assets.ps1 -Source "E:\ps素材\波动纹理及流体.jpg"
```

The script downsizes the source sheet, converts black to alpha, detects smoke islands, and writes the atlas plus frame metadata to `assets/space-fx/generated/`.
