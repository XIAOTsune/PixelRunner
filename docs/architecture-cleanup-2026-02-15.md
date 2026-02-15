# PixelRunner Architecture Cleanup (2026-02-15)

## 1. Business Flow
1. Save `API Key` and polling settings in Settings view (`settings-controller` -> `store`).
2. Parse app info from RunningHub (`runninghub.fetchAppInfo`) and save app config (`store.addAiApp` / `store.updateAiApp`).
3. Select app in Workspace and render dynamic inputs (`workspace-controller`).
4. Run task:
   - Capture image input from Photoshop (`ps.captureSelection`).
   - Submit task (`runninghub.runAppTask`).
   - Poll result (`runninghub.pollTaskOutput`).
   - Download output (`runninghub.downloadResultBinary`).
   - Place output back to document (`ps.placeImage`).

## 2. UI Flow
1. Top tabs switch Workspace / Tools / Settings (`index.js`).
2. Workspace manages app picker and template picker modals.
3. Settings manages app/template lists with delegated click handlers.
4. Cross-controller sync uses app events:
   - `pixelrunner:apps-changed`
   - `pixelrunner:templates-changed`
   - `pixelrunner:settings-changed`

## 3. Cleanup Changes
### 3.1 Shared DOM helpers (new)
- File: `src/shared/dom-utils.js`
- Added:
  - `byId`
  - `encodeDataId` / `decodeDataId`
  - `getRenderedElementCount`
  - `findClosestByClass`
  - `rebindEvent`

### 3.2 Shared input schema helpers (new)
- File: `src/shared/input-schema.js`
- Added:
  - `parseOptionsFromUnknown`
  - `getInputOptions`
  - `resolveInputType`

### 3.3 Event binding hardening
- `workspace-controller` and `settings-controller` now use `rebindEvent`.
- This prevents duplicate listeners when controller init happens more than once.
- `tools-controller` now also uses `rebindEvent` for the three tool actions.

### 3.4 Runtime input type alignment
- `runninghub.resolveRuntimeInputType` now reuses `resolveInputType`.
- This reduces type mismatch between UI rendering and runtime payload conversion.

### 3.5 Workspace input subsystem extraction
- New module: `src/controllers/workspace/workspace-inputs.js`
- Dynamic input rendering and input field creation are now isolated from controller orchestration.
- `workspace-controller` keeps event/state orchestration and delegates input rendering to this module.

### 3.6 RunningHub task status extraction
- New module: `src/services/runninghub-task-status.js`
- Output URL extraction and task status helpers are isolated for polling logic maintenance.
- New module: `src/services/runninghub-polling.js`
- Polling loop is extracted and `runninghub.js` now delegates to this module.

### 3.7 Legacy path cleanup (this round)
- Removed commented legacy implementations from `workspace-controller` that were no longer on active runtime path.
- Removed unreachable fallback code in `runninghub.pollTaskOutput` after delegation to polling core.
- Removed unused wrapper helpers in `workspace-controller` that had no call sites after input subsystem extraction.
- `runninghub.pollTaskOutput` now injects task-status helpers directly from `runninghub-task-status` to reduce duplicate glue code.

### 3.8 RunningHub account boundary split
- New module: `src/services/runninghub-account.js`
- `testApiKey` and `fetchAccountStatus` are moved to account-focused core functions.
- `runninghub.js` now keeps facade wrappers and delegates implementation to `runninghub-account`.

### 3.9 RunningHub common boundary split
- New module: `src/services/runninghub-common.js`
- Shared protocol utilities (`toMessage`, `parseJsonResponse`) and cancellation guard (`throwIfCancelled`) are extracted.
- `runninghub.js` now focuses on business flow assembly and delegates common primitives to this module.

### 3.10 Code health guard
- New script: `scripts/check-code-health.js`
- It checks:
  - JS syntax (`node --check`)
  - UTF-8 BOM presence
  - replacement char `U+FFFD`
  - accidental literal `` `r`n `` leftovers
- Run via: `node scripts/check-code-health.js`

### 3.11 RunningHub task runner split
- New module: `src/services/runninghub-runner.js`
- `runAppTask` now delegates upload + payload conversion + task creation orchestration to runner core.
- `runninghub.js` keeps facade APIs and cross-module assembly, reducing mutation surface in one file.

## 4. Module Boundaries
- `controllers/*`: UI orchestration and event wiring.
- `controllers/workspace/workspace-inputs.js`: workspace dynamic input rendering internals.
- `services/runninghub.js`: RunningHub HTTP protocol and task lifecycle.
- `services/runninghub-task-status.js`: task output/status helper rules.
- `services/runninghub-polling.js`: task polling state loop.
- `services/runninghub-account.js`: API key test and account balance/coins query.
- `services/runninghub-common.js`: shared response/error/cancel primitives.
- `services/runninghub-runner.js`: image upload and task submission orchestration.
- `services/ps.js`: Photoshop document and layer operations.
- `services/store.js`: local persistence only.
- `shared/*`: pure reusable helpers (no business state).

## 5. Anti-Pollution Rules For Future Changes
1. Add protocol/data logic in `services` or `shared`, not directly in controllers.
2. Do not duplicate input-type inference logic in controllers; use `shared/input-schema`.
3. Bind DOM events via `rebindEvent` to avoid repeated handler registration.
4. Keep cross-view sync through `APP_EVENTS` instead of direct controller-to-controller calls.

