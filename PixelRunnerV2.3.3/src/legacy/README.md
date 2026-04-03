# Legacy Assets

This directory stores deprecated assets that are no longer referenced by runtime code,
but are temporarily retained for one release cycle to reduce accidental rollback risk.

## Current assets

- `qrcode-generator.js`
  - Source: moved from `src/libs/qrcode-generator.js` during Phase 6 cleanup
  - Audit basis: repository-wide search found no static or dynamic runtime references
  - Planned action: delete after one stable release cycle if no regression report appears

## Removal criteria

1. One release cycle has passed since migration to `src/legacy/`.
2. No runtime issue reports indicate this asset is required.
3. Smoke checklist and contract tests pass after removal.
