# PS Environment Doctor

## Goal
This startup script runs automatically when the panel loads and creates a diagnostic report so plugin issues can be analyzed with evidence instead of guesswork.

## What it checks
1. Runtime capabilities (`fetch`, `AbortController`, `CustomEvent`, `localStorage`).
2. Photoshop and UXP host info.
3. Required DOM node presence.
4. Module contracts (`store`, `runninghub`, `ps` required exports).
5. Data health (empty IDs, duplicate IDs for apps/templates).
6. Basic network reachability to RunningHub endpoints.

## Files added
1. `src/diagnostics/ps-env-doctor.js`
2. Startup integration in `index.js`

## Output locations
1. Console logs prefixed with `[Diag]`.
2. LocalStorage key: `rh_env_diagnostic_latest`.
3. UXP data folder files:
   - `pixelrunner_diag_latest.json`
   - `pixelrunner_diag_latest.txt`
   - timestamped copies: `pixelrunner_diag_<runId>.json/.txt`

## How to use
1. Load plugin in Photoshop.
2. Open panel once.
3. Check UXP Developer Console for `[Diag]` logs.
4. Open data folder report files for full details.

## Suggested workflow
1. Reproduce bug.
2. Restart panel to generate a fresh report.
3. Compare report recommendations against current implementation.
4. Fix one class of issue at a time and re-run diagnostics.
