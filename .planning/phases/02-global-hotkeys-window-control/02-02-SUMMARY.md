---
phase: 02-global-hotkeys-window-control
plan: 02
subsystem: window-control
tags: [electron, hotkeys, overlay, opacity, multi-monitor, ipc, vitest, react]

# Dependency graph
requires:
  - phase: 02-global-hotkeys-window-control
    plan: 01
    provides: "HotkeyRegistrarService (handler-map constructor, register(), teardown()); IOverlayStatus.hotkeys across three sites; setHotkeyStatus; no-op stub handlers wired in index.ts"
  - phase: 01-overlay-shell-existential-behaviors
    provides: "showOverlay() reveal wrapper; pushStatus read-only push; DebugHud visible-prop component; jedi:status channel"
provides:
  - "WindowControlActionsService — show/hide (via wrappers), 50px clamped move across monitors, 0.1 opacity steps in [0.2,1.0], HUD-content toggle, app.quit; every handler isDestroyed()-guarded"
  - "overlay-window.manager: hideOverlay() hide path; main-owned hudVisible state (get/set) + isOverlayVisible state (get/set); buildStatus carries hudVisible"
  - "IOverlayStatus.hudVisible field across all three declaration sites"
  - "Real window-control handler map injected into HotkeyRegistrarService (replaces 02-01 stubs); show/hide branches on getOverlayVisible()"
  - "DebugHud HUD-content visibility driven by pushed hudVisible flag (D-15) + hotkey cheat-sheet (D-13)"
affects: [02-03-conflict-testing]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Window-control actions as a verb-named service (.actions.ts) mutating one BrowserWindow, delegating reveal/hide to overlay-window.manager wrappers"
    - "Single-source shown-state: overlay-window.manager owns isOverlayVisible; index.ts branches the show/hide chord on getOverlayVisible() rather than a duplicate variable"
    - "Outermost virtual-desktop clamp via union of screen.getAllDisplays() work areas — crossing monitors allowed, never off all screens"
    - "Renderer pure view: HUD content visibility derived from main-owned pushed hudVisible flag; no renderer->main channel"

key-files:
  created:
    - src/main/window-control.actions.ts
    - src/main/window-control.actions.test.ts
  modified:
    - src/main/overlay-window.manager.ts
    - src/main/index.ts
    - src/preload/index.ts
    - src/renderer/src/components/debug-hud.tsx
    - src/renderer/src/App.tsx
    - src/renderer/src/assets/hud.css

key-decisions:
  - "Shown-state owned in overlay-window.manager (isOverlayVisible) not index.ts — showOverlay/hideOverlay set it, the show/hide chord reads getOverlayVisible() to branch"
  - "Opacity steps rounded to one decimal (Math.round(x*10)/10) so repeated 0.1 steps don't accumulate float drift before clamping to [0.2,1.0]"
  - "Move clamp uses window.getSize() against the union of display work areas so the FULL window stays on the virtual desktop (maxX - width), allowing monitor crossing (D-10)"
  - "DebugHud honors pushed status.hudVisible once status arrives; the visible prop is only a pre-first-push fallback (D-12 shown-on-launch), never an override"
  - "Cheat-sheet chords mirror the 02-01 PLACEHOLDER chords; copy updates when 02-03 finalizes the concrete defaults"

requirements-completed: [OVL-03, OVL-05, CTL-01]

# Metrics
duration: ~12min
completed: 2026-06-17
---

# Phase 2 Plan 02: WindowControlActionsService Summary

**Real keyboard control loop wired: a WindowControlActionsService whose isDestroyed()-guarded handlers show/hide the overlay via the existing wrappers, nudge it 50px/step clamped at the outermost virtual-desktop edge (crossing monitors), step opacity in 10% increments within 20%->100%, toggle the main-owned HUD-content flag, and quit — injected into HotkeyRegistrarService in place of the 02-01 stubs, with the HUD reflecting hudVisible as a pure view and doubling as a hotkey cheat-sheet.**

## Performance

- **Duration:** ~12 min
- **Completed:** 2026-06-17
- **Tasks:** 2
- **Files modified:** 8 (2 created, 6 modified)

## Accomplishments
- Built `WindowControlActionsService`: show via `showOverlay()` / hide via the new `hideOverlay()` (never `show()`/`focus()`), `moveLeft/Right/Up/Down` at 50px (D-02) clamped against the union of all display work areas so the overlay can cross monitors but never leave the virtual desktop (D-10), `opacityUp/Down` in 0.1 steps clamped to [0.2, 1.0] (D-03/D-09), `toggleHud()` flipping the main-owned flag (D-14), and `quit()` via `app.quit()` (D-04). Every handler guards `isDestroyed()`.
- Extended `overlay-window.manager.ts` with the `hideOverlay()` hide path, a module-level `hudVisible` (get/set) flag, and a module-level `isOverlayVisible` (get/set) flag so window shown-state lives in exactly one place; `showOverlay`/`hideOverlay` set it, `buildStatus` now carries `hudVisible`.
- Injected the real handler map into `HotkeyRegistrarService` (replacing the 02-01 no-op stubs); the single show/hide chord branches on `getOverlayVisible()` between `showOverlay()` and `hideOverlay()` with no duplicate state in index.ts. Added `hudVisible` to all three `IOverlayStatus` declarations, drove the DebugHud's content visibility from the pushed flag (D-15), added a hotkey cheat-sheet (D-13) with `row-hotkey-*` test ids, and rewired `App.tsx` to stop hard-coding `visible={true}`.

## Task Commits

Each task was committed atomically:

1. **Task 1: WindowControlActionsService (TDD)** - `a24a5da` (test, RED) → `b5abfe4` (feat, GREEN)
2. **Task 2: Inject handlers + hudVisible + HUD cheat-sheet** - `5a5a430` (feat)

**Plan metadata:** committed with this SUMMARY (docs: complete plan)

_Task 1 followed TDD: failing test commit then implementation commit. No refactor commit was needed._

## Files Created/Modified
- `src/main/window-control.actions.ts` - `WindowControlActionsService`: show/hide/move/opacity/HUD-toggle/quit handlers, MOVE_STEP_PX/OPACITY_STEP/floor/ceiling constants, clamp + virtual-desktop-union math, all isDestroyed()-guarded.
- `src/main/window-control.actions.test.ts` - 8 Vitest behaviors: show/hide routing, 50px move, edge clamp, cross-monitor move, 0.1 opacity steps + [0.2,1.0] bounds, HUD-toggle flip + push, app.quit, and isDestroyed() no-op across all handlers.
- `src/main/overlay-window.manager.ts` - `hideOverlay()`; `hudVisible` + `getHudVisible`/`setHudVisible`; `isOverlayVisible` + `getOverlayVisible`/`setOverlayVisible`; `IOverlayStatus.hudVisible`; `buildStatus` populates it; `showOverlay` sets shown-state true.
- `src/main/index.ts` - `buildHandlers(actions)` builds the real handler map; instantiates `WindowControlActionsService`; show/hide branches on `getOverlayVisible()`; teardown() still on window-all-closed.
- `src/preload/index.ts` - `IOverlayStatus.hudVisible` (second identical declaration).
- `src/renderer/src/components/debug-hud.tsx` - `IOverlayStatus.hudVisible` (third declaration); HUD content derived from `status.hudVisible`; `HOTKEY_CHEAT_SHEET` + cheat-sheet rows.
- `src/renderer/src/App.tsx` - renders `<DebugHud />` with no hard-coded `visible` prop.
- `src/renderer/src/assets/hud.css` - `.debug-hud__cheatsheet` block styling.

## Decisions Made
- **Shown-state owned in one place.** `isOverlayVisible` lives in overlay-window.manager.ts (mirroring `contentProtectionEnabled`), set true by `showOverlay` and false by `hideOverlay`. The single show/hide chord in index.ts reads `getOverlayVisible()` to branch — no duplicate shown-state variable was introduced in index.ts (per Task 2 acceptance criteria).
- **Full-window clamp against the display union.** Move clamps `x` to `[minX, maxX - width]` (and `y` likewise) using `window.getSize()` against the union of `screen.getAllDisplays()` work areas, so the whole window stays within the outermost virtual-desktop rectangle while still being free to cross onto an adjacent monitor (D-10).
- **Opacity rounded before set.** `Math.round(next * 10) / 10` after clamping prevents floating-point drift accumulating across repeated 0.1 hold-to-repeat steps.
- **HUD visibility is a pure view of the pushed flag.** Once a status push arrives, the DebugHud renders strictly by `status.hudVisible` (D-15); the `visible` prop is only the pre-first-push fallback that keeps the HUD shown on launch (D-12).

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## Known Stubs
None. The 02-01 no-op hotkey handler stubs (`buildStubHandlers`) were removed and replaced with the real `WindowControlActionsService`-backed handler map, which was the explicit purpose of this plan. The hotkey *chords* themselves remain 02-01 PLACEHOLDERS by design (D-05) — 02-03 finalizes the concrete Ctrl+Alt defaults after conflict testing. The cheat-sheet copy reflects those placeholders and will be updated in 02-03.

## Threat Surface Review
- T-02-05 (jedi:status stays read-only): preserved — `hudVisible` is flipped only in main (`setHudVisible` via `toggleHud`); the renderer derives visibility from the pushed flag and adds no renderer->main channel.
- T-02-07 (move off-screen / fade to invisible): mitigated — move clamps to the display-union outermost edge; opacity floor 0.2 prevents fading to invisible.
- T-02-08 (info disclosure): handlers mutate only geometry/opacity/visibility; `showOverlay` re-applies content protection on every re-show (OVL-04 preserved). No new security surface introduced.

## Next Phase Readiness
- The complete keyboard control loop (show/hide, move, opacity, HUD toggle, quit) is wired end to end behind the registrar. 02-03 only needs to replace the PLACEHOLDER chords with the conflict-tested concrete Ctrl+Alt defaults and update the cheat-sheet copy — the action set, handlers, and HUD reference are in place.
- Under the globalShortcut fallback layer, move/opacity still fire once-per-press (no native key-repeat) — a 02-01 limitation, unchanged here. No blockers.

## Self-Check: PASSED

- Created files verified on disk: window-control.actions.ts, window-control.actions.test.ts, 02-02-SUMMARY.md.
- Task commits verified in git log: a24a5da (Task 1 RED), b5abfe4 (Task 1 GREEN), 5a5a430 (Task 2).
- Verification: `npx vitest run` 17/17 pass; `npm run typecheck` exits 0; `npm run lint` exits 0.

---
*Phase: 02-global-hotkeys-window-control*
*Completed: 2026-06-17*
