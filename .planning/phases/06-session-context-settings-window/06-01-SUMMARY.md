---
phase: 06-session-context-settings-window
plan: 01
subsystem: infra
tags: [electron, safeStorage, electron-store, contextBridge, ipc, electron-vite, hotkeys, react]

# Dependency graph
requires:
  - phase: 01-foundation
    provides: safeStorage placeholder round-trip, contextIsolation+sandbox preload boundary, electron-vite verify-config precedent
  - phase: 02-global-hotkeys-window-control
    provides: HOTKEY_CHORDS add-a-chord pattern, uiohook passive non-consumption (CTL-02)
  - phase: 04-stt-pipeline-live-transcript
    provides: DeepgramSttGateway key-by-constructor, wireSttPipeline boot wiring
  - phase: 05-ai-orchestration-answer-talking-points
    provides: AnthropicGateway key-by-constructor, AiOrchestrator boot wiring
provides:
  - Focusable, framed settings window opened by Ctrl+Alt+S (createSettingsWindow / openOrFocusSettingsWindow, D-01)
  - Two-key safeStorage store (ApiKeyStoreService) — Deepgram + Anthropic, base64 ciphertext only
  - Pure resolveApiKey precedence utility (saved -> env -> '', D-08)
  - Scoped two-way settingsApi contextBridge + four settings:* IPC channels (D-04)
  - Second renderer + preload build target (out/renderer/settings.html, out/preload/settings.cjs)
  - Headless two-key safeStorage round-trip verify script (verify:keys)
affects: [06-03-context-editor-ui, 06-04-live-rekey-grounding]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Settings window = createOverlayWindow() with existential options INVERTED (focusable/framed/opaque)"
    - "Scoped two-way contextBridge (settingsApi) separate from the overlay's one-way jedi namespace (D-04)"
    - "Two-key safeStorage store generalizing the Phase 1 single-placeholder round-trip; presence booleans over IPC, decrypt in main only"
    - "Pure resolveApiKey precedence layer inverts loadDotenvFile's env-wins rule for the two API keys only (D-08)"

key-files:
  created:
    - src/main/config/resolve-api-key.utility.ts
    - src/main/config/resolve-api-key.utility.test.ts
    - src/main/secrets/api-key-store.service.ts
    - src/preload/settings.ts
    - src/renderer/settings.html
    - src/renderer/src/settings.tsx
    - src/main/settings-window.manager.ts
    - scripts/verify-api-keys.ts
    - electron.vite.verify-keys.config.ts
  modified:
    - electron.vite.config.ts
    - src/main/hotkey-registrar.service.ts
    - src/main/index.ts
    - package.json

key-decisions:
  - "open-settings handler imported at module level and added directly to buildHandlers' returned map (the manager owns the lazy lifecycle); buildHandlers signature unchanged"
  - "settings:get-context / settings:save-context registered as no-op stubs in 06-01; bodies filled by 06-03/06-04"
  - "Ctrl+Alt+S chord FINALIZED — conflict-free vs Teams/Zoom/VS Code on the target machine (Task 4 human-verified 2026-06-19); no fallback needed"
  - "Settings dev-server URL suffix VERIFIED as /settings.html (ELECTRON_RENDERER_URL + /settings.html) — 06-03 inherits this value"

patterns-established:
  - "Inverted-overlay settings window (focusable/framed/opaque; NO setIgnoreMouseEvents/setContentProtection/always-on-top re-assert)"
  - "Dedicated electron.vite.verify-keys.config.ts with distinct out/verify-keys outDir for the headless key round-trip"

requirements-completed: [SET-01, SET-02]

# Metrics
duration: 6min
completed: 2026-06-19
---

# Phase 6 Plan 01: Settings Window Shell + Two-Key safeStorage Store Summary

**Focusable Ctrl+Alt+S settings window with a scoped two-way IPC surface, a two-key safeStorage (DPAPI) store for the Deepgram + Anthropic keys, and a boot key-precedence layer (saved -> env -> ''), all on a new second renderer/preload build target.**

## Performance

- **Duration:** 6 min
- **Started:** 2026-06-19T14:33:22Z
- **Completed:** 2026-06-19T14:40:00Z
- **Tasks:** 4 of 4 (Task 4 blocking human-verify PASSED on the target machine, 2026-06-19)
- **Files modified:** 13 (9 created, 4 modified)

## Accomplishments
- Pure `resolveApiKey(saved -> env -> '')` precedence utility with 5 co-located TDD cases (D-08), inverting loadDotenvFile's env-wins rule for the two API keys only without mutating loadDotenvFile.
- `ApiKeyStoreService`: two-key safeStorage encrypt -> base64 ciphertext -> decrypt round-trip under distinct store keys; `hasDeepgram/hasAnthropic` presence booleans for IPC; decrypt in main only; every op guarded by `isEncryptionAvailable()`.
- Focusable, framed settings window (`createSettingsWindow` / `openOrFocusSettingsWindow`, D-01 lazy create-or-focus) — the overlay window with its existential options inverted; never calls setIgnoreMouseEvents / setContentProtection / always-on-top re-assert.
- Scoped two-way `settingsApi` contextBridge (getKeys/saveKeys/getContext/saveContext) bundled separately from the untouched overlay `jedi` namespace (D-04); contextIsolation guard copied verbatim.
- Second renderer + preload build target (`out/renderer/settings.html`, `out/preload/settings.cjs`); `Ctrl+Alt+S` chord; boot resolution of BOTH keys via `resolveApiKey`; four `settings:*` IPC handlers.
- Headless `verify:keys` script (distinct `out/verify-keys` outDir) — round-trips both keys, prints PASS, never prints a key value.

## Task Commits

Each task was committed atomically:

1. **Task 1: Pure key-precedence utility (TDD)** - `b2e12e4` (feat) — test + implementation; 5/5 cases green
2. **Task 2: Two-key store + build wiring + window/preload shell + Ctrl+Alt+S + boot precedence + IPC** - `782855b` (feat)
3. **Task 3: Headless two-key verify script + npm wiring** - `d96c3fd` (test)

**Task 4: On-machine settings-window open + dev/prod load + Ctrl+Alt+S conflict re-check** — human-verified PASSED on the target Windows machine (2026-06-19): dev open with HMR + click-through overlay intact, lazy focus/recreate lifecycle, prod loadFile open, and Ctrl+Alt+S conflict-free vs Teams/Zoom/VS Code (no fallback needed). Verified dev-server URL suffix = `/settings.html`. Tracking commit below.

## Files Created/Modified
- `src/main/config/resolve-api-key.utility.ts` - Pure D-08 precedence (saved non-empty -> env -> '')
- `src/main/config/resolve-api-key.utility.test.ts` - 5 co-located Vitest cases
- `src/main/secrets/api-key-store.service.ts` - Two-key safeStorage store (ciphertext-only, main-only decrypt)
- `src/preload/settings.ts` - Scoped two-way settingsApi contextBridge (presence-only getKeys)
- `src/renderer/settings.html` - Settings renderer HTML entry with CSP meta
- `src/renderer/src/settings.tsx` - Minimal placeholder settings root (full UI in 06-03)
- `src/main/settings-window.manager.ts` - createSettingsWindow + openOrFocusSettingsWindow (D-01)
- `scripts/verify-api-keys.ts` - Headless PASS/FAIL two-key round-trip
- `electron.vite.verify-keys.config.ts` - Dedicated config, distinct out/verify-keys outDir
- `electron.vite.config.ts` - Added `settings` input to preload + renderer rollup maps
- `src/main/hotkey-registrar.service.ts` - Added `open-settings` Ctrl+Alt+S discrete chord
- `src/main/index.ts` - ApiKeyStoreService boot, resolveApiKey for both keys, open-settings handler, four settings:* IPC handlers
- `package.json` - Added `verify:keys` script

## Decisions Made
- **open-settings handler wiring:** `openOrFocusSettingsWindow` is imported at module level in index.ts and added directly to the `buildHandlers` returned map (a one-liner mirroring the other chord handlers). The manager owns the lazy lifecycle, so threading it through `buildHandlers`' signature would add no value — the signature is unchanged. This is a minor simplification of the plan's "thread into buildHandlers" wording with identical behavior.
- **Context channels:** `settings:get-context` / `settings:save-context` registered now as no-op stubs (return undefined) so the settings preload contract is complete; bodies (backed by SessionContextRepository) land in 06-03/06-04.
- **Chord:** `Ctrl+Alt+S` FINALIZED — Task 4 human-verify confirmed it is conflict-free vs Teams/Zoom/VS Code on the target machine; no fallback used.
- **Dev URL suffix:** verified `${ELECTRON_RENDERER_URL}/settings.html` works for the second renderer entry (the one MEDIUM-confidence item from RESEARCH A1 / Open Question 1 — now resolved). 06-03 inherits this value.

## Deviations from Plan

None - plan executed exactly as written. (The `buildHandlers` simplification above is a behavior-identical wiring choice within the plan's latitude, not a functional deviation.)

## Issues Encountered
- The grep gate (`grep -c 'decryptString|getDeepgram|getAnthropic'`) initially matched a TSDoc comment line in `settings.ts` that named those identifiers in its security note. No code referenced them. Reworded the comment so the gate is unambiguously 0 (no code reference); rebuilt to refresh `settings.cjs`.

## User Setup Required
None - no external service configuration required for this plan. (Real API keys are entered through the settings window UI in 06-03.)

## Next Phase Readiness
- **Task 4 human-verify PASSED (2026-06-19, target Windows machine):** dev open with HMR + overlay click-through intact; lazy focus/recreate lifecycle; prod (`build` + `preview`) loadFile open; Ctrl+Alt+S conflict-free vs Teams/Zoom/VS Code (no fallback). Plan 06-01 is fully complete.
- **Verified values 06-03 inherits:**
  - Settings dev-server URL suffix: `${ELECTRON_RENDERER_URL}/settings.html`
  - Open-settings chord: `Ctrl+Alt+S` (finalized, no conflict)
- **For 06-03/06-04:** the settingsApi contract (four channels) and the two-key store are wired; 06-03 fills the Keys/Context tab UI and the get/save-context handler bodies; 06-04 adds live re-key of the running gateways.

## Self-Check: PASSED

All 9 created files verified present on disk; all 3 task commits (`b2e12e4`, `782855b`, `d96c3fd`) verified in git log. Automated verification green: `npx vitest run src/main/config/resolve-api-key.utility.test.ts` (5/5), `npm run typecheck`, `npm run lint`, `npm run build` (both `out/preload/settings.cjs` + `out/renderer/settings.html` emitted), `npm run verify:keys` (PASS, exit 0, no key printed).

---
*Phase: 06-session-context-settings-window*
*Completed: 2026-06-19*
