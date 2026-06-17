---
phase: 02-global-hotkeys-window-control
plan: 01
subsystem: infra
tags: [electron, uiohook-napi, globalShortcut, hotkeys, ipc, native-module, vitest]

# Dependency graph
requires:
  - phase: 01-overlay-shell-existential-behaviors
    provides: "IOverlayStatus + STATUS_CHANNEL ('jedi:status') + pushStatus read-only push; showOverlay reveal wrapper; placeholder-secret.service graceful-degradation analog; DebugHud visible-prop component"
provides:
  - "uiohook-napi@1.5.5 (first native module) + @electron/rebuild devDep + rebuild script"
  - "HotkeyRegistrarService — registers the locked five-group Ctrl+Alt action set via a passive uiohook hook with a globalShortcut fallback, aggregates per-chord results into { active, failed } without throwing, wires move/opacity hold-to-repeat, exposes teardown()"
  - "IHotkeyRegistrationResult interface + HOTKEY_ACTION_LABELS export"
  - "IOverlayStatus.hotkeys field (active + failed) across all three declaration sites"
  - "setHotkeyStatus setter on overlay-window.manager for main-owned hotkey state"
  - "HUD Hotkeys: OK / N failed status line (cell-hotkey-status)"
affects: [02-02-window-control-actions, 02-03-conflict-testing]

# Tech tracking
tech-stack:
  added: [uiohook-napi@1.5.5, "@electron/rebuild@^4.0.1"]
  patterns:
    - "Passive low-level hook (uiohook keydown stream) as primary global-hotkey path; globalShortcut as a fallback behind a single seam"
    - "Graceful-degradation return shape (aggregate { active, failed }, never throw) mirroring placeholder-secret.service"
    - "Main-owned control state pushed read-only over jedi:status; IOverlayStatus declared identically in three bundling boundaries"

key-files:
  created:
    - src/main/hotkey-registrar.service.ts
    - src/main/hotkey-registrar.service.test.ts
  modified:
    - package.json
    - src/main/overlay-window.manager.ts
    - src/main/index.ts
    - src/preload/index.ts
    - src/renderer/src/components/debug-hud.tsx

key-decisions:
  - "uiohook from-source rebuild failed (no MSVC toolchain) but is non-blocking: the prebuilt N-API binary loads under Electron 35.7.5 (human-verified boot), so the native path stays primary"
  - "OS-level key auto-repeat surfaces as repeated uiohook 'keydown' events (there is no separate 'keyrepeat' event) — hold-to-repeat (D-01) is implemented by handling every keydown"
  - "Placeholder Ctrl+Alt chords (J / arrows / [ ] / H / Q) marked PLACEHOLDER in code pending 02-03 conflict testing (D-05)"

patterns-established:
  - "HotkeyRegistrarService: TSDoc note that @singleton() is N/A in the Electron main process (no TSyringe); instantiated once in index.ts by convention"
  - "Tests mock uiohook-napi with a real EventEmitter to exercise actual .on('keydown') wiring; mock electron globalShortcut via hoisted vi.fn"

requirements-completed: [CTL-02, CTL-03]

# Metrics
duration: ~18min
completed: 2026-06-17
---

# Phase 2 Plan 01: HotkeyRegistrarService Summary

**Passive uiohook-napi global-hotkey layer (globalShortcut fallback) that registers the locked Ctrl+Alt action set, aggregates per-chord results without throwing, wires move/opacity hold-to-repeat, and surfaces a Hotkeys: OK / N failed line in the HUD.**

## Performance

- **Duration:** ~18 min (continuation agent)
- **Started:** 2026-06-17 (Task 1 checkpoint pre-approved by human)
- **Completed:** 2026-06-17
- **Tasks:** 3
- **Files modified:** 7 (2 created, 5 modified)

## Accomplishments
- Installed the repo's first native module (uiohook-napi@1.5.5) + @electron/rebuild and a rebuild script; confirmed the prebuilt N-API binary loads under Electron 35.7.5 despite the from-source rebuild failing for lack of an MSVC toolchain.
- Built `HotkeyRegistrarService`: registers the locked five-group Ctrl+Alt action set via a passive uiohook keydown hook, falls back to `globalShortcut` if the native hook cannot attach, aggregates each chord's outcome into `{ active, failed }` without ever throwing (CTL-03), and wires move/opacity hold-to-repeat off the OS keydown-repeat stream (D-01).
- Extended `IOverlayStatus.hotkeys` across all three declaration sites, wired the registrar into the `app.whenReady` bootstrap (with `teardown()` on `window-all-closed`), and added a persistent `Hotkeys: OK / N failed` row to the DebugHud over the read-only `jedi:status` channel (D-06).

## Task Commits

Each task was committed atomically:

1. **Task 1: Install uiohook-napi + @electron/rebuild + rebuild script** - `38f1a42` (chore)
2. **Task 2: HotkeyRegistrarService (TDD)** - `b19a338` (test, RED) → `b46ddfd` (feat, GREEN)
3. **Task 3: IOverlayStatus.hotkeys + bootstrap wiring + HUD line** - `ab6c529` (feat)

**Plan metadata:** committed with this SUMMARY (docs: complete plan)

_Task 2 followed TDD: failing test commit then implementation commit. No refactor commit was needed._

## Files Created/Modified
- `src/main/hotkey-registrar.service.ts` - HotkeyRegistrarService, IHotkeyRegistrationResult, HOTKEY_ACTION_LABELS; locked placeholder chord registry, uiohook-primary/globalShortcut-fallback registration, move/opacity hold-to-repeat, teardown.
- `src/main/hotkey-registrar.service.test.ts` - 6 Vitest behaviors: happy path, per-chord failure surfacing (no throw), uiohook→globalShortcut fallback, both-layers-fail, uiohook hold-to-repeat, once-per-press fallback.
- `package.json` - uiohook-napi@1.5.5 dep, @electron/rebuild devDep, rebuild script.
- `src/main/overlay-window.manager.ts` - IOverlayStatus.hotkeys field, module-level lastHotkeyResult, setHotkeyStatus setter, buildStatus populates hotkeys.
- `src/main/index.ts` - instantiate registrar after boot with stub handlers, register(), feed setHotkeyStatus, pushStatus; teardown() on window-all-closed.
- `src/preload/index.ts` - IOverlayStatus.hotkeys (second identical declaration).
- `src/renderer/src/components/debug-hud.tsx` - IOverlayStatus.hotkeys (third declaration) + Hotkeys: OK / N failed row (cell-hotkey-status).

## Decisions Made
- **Native rebuild non-blocking via prebuilt binary.** `npm run rebuild` (electron-rebuild from source) fails on this machine because no MSVC C++ toolchain is installed. This is acceptable per D-08 and the ROADMAP "evaluate rebuild" flag: uiohook-napi ships a prebuilt N-API binary (`node_modules/uiohook-napi/prebuilds/win32-x64/uiohook-napi.node`). N-API binaries are ABI-stable across Electron versions, so the binary loads under Electron 35.7.5 — the human verified the overlay boots via `npm run dev`. The native uiohook path therefore remains primary; the globalShortcut fallback was NOT promoted to primary.
- **Hold-to-repeat via repeated keydown.** uiohook-napi has no distinct `keyrepeat` event; the OS auto-repeat surfaces as a stream of `keydown` events while a key is held. Move/opacity actions are invoked on every matching keydown, which delivers D-01 hold-to-repeat. Discrete actions (show/hide, HUD toggle, quit) also fire per keydown but are idempotent toggles, so no debounce is added.
- **Placeholder chords.** The action set is locked (D-05) but the concrete chords (`Ctrl+Alt+J`, four arrows, `[`/`]`, `H`, `Q`) are marked PLACEHOLDER in code; 02-03 finalizes them after conflict testing.

## Deviations from Plan

None - plan executed exactly as written. (Task 1's blocking-human checkpoint was pre-approved by the human before this continuation agent ran.)

## Issues Encountered
- **From-source native rebuild failed (missing MSVC toolchain).** Resolved by relying on uiohook-napi's prebuilt N-API binary, which loads under Electron 35.7.5 (human-verified boot). See Decisions. Non-blocking; the native path stays primary.

## Known Stubs
- **Hotkey action handlers are no-op stubs** in `src/main/index.ts` (`buildStubHandlers`). This is intentional and planned: 02-01 establishes the registration + failure-surfacing + hold-to-repeat seam, and **02-02 injects the real window-control handlers** (move with clamping, opacity, show/hide via showOverlay, quit). The plan explicitly scopes concrete window mutations to 02-02.

## Fallback Limitation (documented, not dropped)
- Under the `globalShortcut` fallback layer, move/opacity fire **once per accelerator press** — globalShortcut exposes no native key-repeat, so hold-to-repeat (D-01) is a uiohook-only capability. No synthesized repeat timer was added for the fallback (per plan). Covered by Test 6 and a TSDoc note on the fallback path.

## User Setup Required
None - no external service configuration required. (The optional MSVC build toolchain is only needed if a future from-source native rebuild becomes necessary; the prebuilt binary covers the current target machine.)

## Next Phase Readiness
- The registration + result-aggregation + hold-to-repeat seam and the `IOverlayStatus.hotkeys` IPC contract are ready for **02-02** to inject real window-control handlers (move, opacity, show/hide, quit) into `HotkeyRegistrarService`.
- Concrete default chords are deferred to **02-03** conflict testing; the placeholders are clearly marked in code.
- No blockers. CTL-02 foundation (passive hook that does not consume the focused app's accelerators) and CTL-03 (failures surfaced, never silently dropped) are established.

## Self-Check: PASSED

- Created files verified on disk: hotkey-registrar.service.ts, hotkey-registrar.service.test.ts, 02-01-SUMMARY.md.
- Task commits verified in git log: 38f1a42 (Task 1), b19a338 + b46ddfd (Task 2 RED/GREEN), ab6c529 (Task 3).

---
*Phase: 02-global-hotkeys-window-control*
*Completed: 2026-06-17*
