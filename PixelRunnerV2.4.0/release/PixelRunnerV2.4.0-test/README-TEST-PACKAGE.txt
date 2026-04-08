# PixelRunner Test Package

Version: 2.4.0
Folder: PixelRunnerV2.4.0-test

This test package contains only the runtime files required by the Photoshop UXP plugin shell and the bundled WebView UI.

Included:
- manifest.json
- index.html
- app.html
- sound-player.html
- style.css
- app.css
- dist
- icons
- pages
- video

Not included:
- docs/
- legacy/
- scripts/
- src/
- node_modules/
- package.json
- package-lock.json

Why:
- The plugin runtime loads `index.html` as the panel entry.
- `index.html` and `app.html` both load bundled files from `dist/`.
- Icons and `manifest.json` are required for UXP installation and display.
