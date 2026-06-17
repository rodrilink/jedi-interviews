---
phase: 02-global-hotkeys-window-control
verified: 2026-06-17T02:15:00Z
status: passed
score: 5/5 must-haves verified
overrides_applied: 0
re_verification:
  previous_status: human_needed
  previous_score: 5/5
  gaps_closed:
    - "Discrete-chord hold behavior (CR-01): dispatchUiohookKeydown now branches on chord.kind — discrete chords (show/hide, hud-toggle, quit) fire exactly once per leading-edge press via heldDiscreteKeycodes Set; repeat chords (move/opacity) still fire per keydown (D-01). Covered by two new automated tests. Commit 63fdff4."
  gaps_remaining: []
  regressions: []
known_issues:
  - id: WR-05
    description: "move() clamps X/Y independently against the virtual-desktop union rectangle; mismatched/offset multi-monitor setups can produce a dead zone on no physical screen"
    severity: warning
    blocking: false
    scope: "Single-monitor and equal-height two-monitor setups (the target machine) are unaffected. Only staggered-height multi-monitor configurations are at risk."
    tracked_in: 02-HUMAN-UAT.md
---

# Phase 2: Global Hotkeys + Window Control — Verification Report

**Phase Goal:** The complete keyboard-only control loop — show/hide, move, and opacity — operating globally while a meeting app holds focus, with hotkey registration failures detected and surfaced.
**Verified:** 2026-06-17T02:15:00Z
**Status:** passed
**Re-verification:** Yes — after CR-01 gap closure (commit 63fdff4)

---

## Re-verification Summary

The single human-verification item from the initial report (CR-01 — discrete-chord hold strobe) has been fixed in code and covered by automated tests. WR-05 (move-clamp dead zone on staggered multi-monitor setups) remains a tracked non-blocking warning; it does not touch any roadmap success criterion and the target machine is single-monitor. All five success criteria now pass without reservation. Status advances from `human_needed` to `passed`.

---

## Goal Achievement

### Observable Truths (Roadmap Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | The user can show and hide the overlay by global hotkey while another application holds focus, and content protection is re-applied on every show. | ✓ VERIFIED | `WindowControlActionsService.showOverlay()` delegates to `showOverlay()` wrapper (overlay-window.manager.ts) which re-applies `setContentProtection(true)` on every call. The show/hide handler branches on `getOverlayVisible()`. CR-01 fixed: `dispatchUiohookKeydown` now guards discrete chords via `heldDiscreteKeycodes` Set — holding the chord fires once, not strobing. Human conflict test (signed 2026-06-17) verified tap-and-hold behavior. |
| 2 | The user can move the overlay around the screen using only the keyboard. | ✓ VERIFIED | `WindowControlActionsService.move()` reads position, applies ±50px delta, clamps against `virtualDesktopBounds()` union of all display work areas, calls `window.setPosition()`. Wired into `HotkeyRegistrarService` via `buildHandlers` in index.ts. All move tests pass. |
| 3 | The user can raise and lower the overlay's opacity by keyboard. | ✓ VERIFIED | `stepOpacity()` applies ±0.1 delta clamped to [0.2, 1.0], rounded to 1 decimal. `opacityUp()`/`opacityDown()` wired via `buildHandlers`. Both are `repeat`-kind chords: they correctly fire on every keydown (D-01 hold-to-repeat), unaffected by the CR-01 fix. Tests pass. |
| 4 | Global hotkeys fire while a real meeting app (e.g. Teams or Zoom) is the focused window, without stealing that app's accelerators. | ✓ VERIFIED (human-verified) | `02-HOTKEY-CONFLICT-TEST.md` signed 2026-06-17 by rodrigo-gomez@idexx.com. All three apps (Teams, Zoom, VS Code) tested — column (a) all YES, column (b) all NO, column (c) all n/a/YES. uiohook passive hook confirmed active. |
| 5 | A hotkey that fails to register or conflicts is detected and surfaced to the user, never silently dropped. | ✓ VERIFIED | `HotkeyRegistrarService.register()` aggregates `{ active, failed }` without throwing. `setHotkeyStatus(result)` feeds `lastHotkeyResult` into `buildStatus()`. `debug-hud.tsx` renders `cell-hotkey-status` showing `OK` or `N failed`. Tests verify per-chord failure surfacing and both-layers-fail paths. |

**Score:** 5/5 truths verified

---

### CR-01 Fix Verification (Discrete-Chord Guard)

The fix is substantive and correct. Verified against `src/main/hotkey-registrar.service.ts`:

- **Guard set declared** (line 90): `private readonly heldDiscreteKeycodes = new Set<number>()` — instance field, initialized fresh per service instance.
- **`dispatchUiohookKeydown` branches on `chord.kind`** (lines 187-193): reads `chord.kind === 'discrete'`, bails out if `heldDiscreteKeycodes.has(chord.keycode)` (auto-repeat suppression), adds keycode before invoking handler (leading-edge record). Repeat chords bypass this block entirely and invoke the handler unconditionally.
- **Keyup listener clears held set** (lines 160-161): `uIOhook.on('keyup', (event) => { this.heldDiscreteKeycodes.delete(event.keycode); })` — registered alongside the keydown listener in `bindViaUiohook()`.
- **`teardown()` clears the set** (line 131): `this.heldDiscreteKeycodes.clear()` — no stale state across re-register.

Test coverage in `hotkey-registrar.service.test.ts`:

- **Test 5 (line 179):** "should invoke repeat handlers on each uiohook key-repeat event but discrete handlers once (CR-01)" — emits J twice with no intervening keyup; asserts `handlers['show/hide']` called exactly **1** time. Also asserts `move-left` called 3 times and `opacity-up` called 2 times (repeat chords unaffected). This is the direct inversion of the old bug assertion.
- **Test 6 (line 215):** "should fire a discrete chord again after a keyup releases the held key (CR-01)" — press, auto-repeat (suppressed), keyup, re-press; asserts `handlers['show/hide']` called exactly **2** times. Confirms the keyup-clear mechanism restores firing for the next press.

The implementation matches the fix prescribed in `02-REVIEW.md` CR-01 exactly.

---

### Deferred Items

None. All five roadmap success criteria are addressed in this phase.

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/main/hotkey-registrar.service.ts` | HotkeyRegistrarService — registers Ctrl+Alt set, aggregates results, wires hold-to-repeat, discrete-chord leading-edge guard | ✓ VERIFIED | 236 lines. Contains `class HotkeyRegistrarService`, `IHotkeyRegistrationResult`, `HOTKEY_ACTION_LABELS`, `heldDiscreteKeycodes` Set, keyup listener, teardown(). CR-01 fix confirmed substantive. |
| `src/main/hotkey-registrar.service.test.ts` | Vitest coverage of 7 behaviors including CR-01 discrete-guard (two tests) | ✓ VERIFIED | 269 lines. 7 tests: all-pass registration, per-chord failure surfacing, globalShortcut fallback, both-layers-fail, discrete-once-on-hold (CR-01), discrete-fires-after-keyup (CR-01), globalShortcut single-fire. 7/7 pass per `npx vitest run` (18/18 total suite). |
| `src/main/window-control.actions.ts` | WindowControlActionsService — show/hide, move-with-clamp, opacity-step, HUD-toggle, quit | ✓ VERIFIED | 202 lines. Contains `class WindowControlActionsService` with all six handler types, all `isDestroyed()`-guarded. |
| `src/main/window-control.actions.test.ts` | Vitest coverage of clamping math, opacity bounds, hide/show routing, HUD-toggle | ✓ VERIFIED | 8/8 tests pass. |
| `src/main/overlay-window.manager.ts` | IOverlayStatus extended with hotkeys + hudVisible; hideOverlay(); isOverlayVisible state | ✓ VERIFIED | Exports `hotkeys: { active: string; failed: string[] }` and `hudVisible: boolean` in IOverlayStatus. Exports `hideOverlay`, `setHudVisible`, `getHudVisible`, `setHotkeyStatus`, `setOverlayVisible`, `getOverlayVisible`. |
| `.planning/phases/02-global-hotkeys-window-control/02-HOTKEY-CONFLICT-TEST.md` | Per-app conflict matrix with all three result columns, Final chord set, sign-off | ✓ VERIFIED | All 5 action groups × 3 apps × 3 columns filled all-pass. Final chord set present. Signed by rodrigo-gomez@idexx.com on 2026-06-17. |
| `src/renderer/src/components/debug-hud.tsx` | IOverlayStatus.hotkeys + hudVisible; cell-hotkey-status; row-hotkey-* cheat-sheet | ✓ VERIFIED | IOverlayStatus declared with both `hotkeys` and `hudVisible` fields. `cell-hotkey-status` present. `HOTKEY_CHEAT_SHEET` + `row-hotkey-{id}` rows for all 5 action groups. |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/main/index.ts` | `HotkeyRegistrarService` | instantiate after `app.whenReady`, `buildHandlers(actions)`, `register()`, teardown on `window-all-closed` | ✓ WIRED | `index.ts` instantiates `HotkeyRegistrarService(buildHandlers(windowControlActions))`, calls `register()`, feeds `setHotkeyStatus(result)`, calls `pushStatus(window)`. Calls `hotkeyRegistrar?.teardown()` on cleanup. |
| `src/main/index.ts` | `WindowControlActionsService` | real handlers injected, show/hide branches on `getOverlayVisible()` | ✓ WIRED | `buildHandlers()` maps all 9 action labels to real methods. Show/hide branches on `getOverlayVisible()`. |
| `src/main/hotkey-registrar.service.ts` | `overlay-window.manager.ts (pushStatus)` | via `setHotkeyStatus(result)` then `pushStatus(window)` in index.ts | ✓ WIRED | `setHotkeyStatus` exported from overlay-window.manager.ts, called in index.ts. `lastHotkeyResult` flows into `buildStatus()`. |
| `src/main/window-control.actions.ts` | `showOverlay` | show handler delegates to `showOverlay(window)` | ✓ WIRED | `window-control.actions.ts` calls `showOverlay(this.window)`. No `.show()` or `.focus()` call. |
| `src/main/window-control.actions.ts` | `screen.getAllDisplays()` | `virtualDesktopBounds()` method | ✓ WIRED | Calls `screen.getAllDisplays()`, unions work areas into min/max bounds, used in `move()`. |
| `src/renderer/src/components/debug-hud.tsx` | `status.hotkeys` | `cell-hotkey-status` row rendered from pushed payload | ✓ WIRED | Derives `hotkeyLabel` from `status.hotkeys.failed.length`, rendered in `data-testid="cell-hotkey-status"`. |
| `src/renderer/src/components/debug-hud.tsx` | `status.hudVisible` | HUD content derived from pushed flag | ✓ WIRED | Sets `hudVisible = status ? status.hudVisible : visible`. Returns `null` when `!hudVisible`. |
| `src/preload/index.ts` | `IOverlayStatus` | second identical declaration carries `hotkeys` + `hudVisible` | ✓ WIRED | `preload/index.ts` declares `IOverlayStatus` with both fields identically. `onStatus` bridge unchanged. |
| `src/main/hotkey-registrar.service.ts` chord constants | `02-HOTKEY-CONFLICT-TEST.md` Final chord set | finalized chords match the document | ✓ WIRED | `HOTKEY_CHORDS`: `Ctrl+Alt+J`, arrows, `[`/`]`, `H`, `Q` — exactly matches Final chord set. |
| `src/renderer/src/components/debug-hud.tsx` `row-hotkey-*` | finalized chords | cheat-sheet labels match final set | ✓ WIRED | `HOTKEY_CHEAT_SHEET` shows `Ctrl+Alt+J`, `Ctrl+Alt+Arrows`, `Ctrl+Alt+[ / ]`, `Ctrl+Alt+H`, `Ctrl+Alt+Q`. |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `debug-hud.tsx` | `status.hotkeys` | `HotkeyRegistrarService.register()` → `setHotkeyStatus()` → `buildStatus()` → `pushStatus()` → `ipcRenderer.on` → `onStatus` → `setStatus()` | Yes — real uiohook/globalShortcut registration outcome | ✓ FLOWING |
| `debug-hud.tsx` | `status.hudVisible` | `setHudVisible()` in `toggleHud()` → `buildStatus()` → `pushStatus()` | Yes — real main-owned boolean flag | ✓ FLOWING |
| `debug-hud.tsx` | `status.contentProtection` | `contentProtectionEnabled` set in `showOverlay()` / blur handler → `buildStatus()` | Yes — real window state | ✓ FLOWING |
| `debug-hud.tsx` | `status.position` | `window.getPosition()` in `buildStatus()` | Yes — real Electron window position | ✓ FLOWING |

---

### Behavioral Spot-Checks

Step 7b skipped — the app requires Electron runtime and cannot be checked with a single static command. The human conflict test (signed 2026-06-17) and the 18/18 automated test suite serve as the combined behavioral verification for the control loop. The CR-01 fix is covered by two dedicated tests that drive `FakeUiohook` events through the real `dispatchUiohookKeydown` dispatch path.

---

### Probe Execution

No probes declared in PLAN files or found under `scripts/*/tests/`. Phase uses human-verify checkpoints as the live verification gates. Both checkpoints are signed in the SUMMARYs.

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| CTL-02 | 02-01-PLAN, 02-03-PLAN | Hotkeys work while another app holds focus (non-consumption) | ✓ SATISFIED | `uiohook-napi` passive hook wired in `HotkeyRegistrarService`. Empirically verified on target machine: `02-HOTKEY-CONFLICT-TEST.md` signed 2026-06-17. |
| CTL-03 | 02-01-PLAN, 02-03-PLAN | Registration failures surfaced, never silently dropped | ✓ SATISFIED | `register()` aggregates `{ active, failed }` without throwing. `cell-hotkey-status` in HUD shows `OK` / `N failed`. Tests 2 and 4 verify failure and both-layers-fail paths. |
| OVL-03 | 02-02-PLAN | Adjust overlay opacity by keyboard | ✓ SATISFIED | `opacityUp()`/`opacityDown()` step ±0.1 clamped to [0.2, 1.0]. Wired via `buildHandlers`. `repeat`-kind: fires on every keydown (D-01 unaffected by CR-01 fix). |
| OVL-05 | 02-02-PLAN, 02-03-PLAN | Show/hide overlay by global hotkey | ✓ SATISFIED | Show/hide handler wired; tap path and hold path both verified. CR-01 fix ensures hold fires once, not strobe. Tap and hold tested on target machine. |
| CTL-01 | 02-02-PLAN | Move overlay by keyboard only | ✓ SATISFIED | `moveLeft/Right/Up/Down` wired; 50px step; virtual-desktop clamp; `repeat`-kind: hold-to-repeat working. |

All five Phase 2 requirements are satisfied. No orphaned requirements found.

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/main/window-control.actions.ts` | 145-158, 182-201 | `virtualDesktopBounds()` unions X and Y independently — on staggered monitors a dead zone between physical screens exists (WR-05) | ⚠️ Warning (known, non-blocking) | Single-monitor and equal-height multi-monitor setups are unaffected. Target machine is single-monitor. The "overlay can't be lost" guarantee (D-10) holds for the expected configuration. Tracked in 02-HUMAN-UAT.md. |
| `src/renderer/src/components/debug-hud.tsx` | 50-52 | `useEffect` subscribes to `onStatus` with no cleanup function; `ipcRenderer.on` listener non-removable | ℹ️ Info (WR-03) | No functional impact in production single-mount lifecycle. StrictMode dev double-fires are cosmetic. Does not affect any success criterion. |
| `src/main/hotkey-registrar.service.ts` | 143-167 | `bindViaUiohook` calls `uIOhook.on` and `uIOhook.start()` without re-entry guard; second `register()` stacks duplicate listeners (WR-01/WR-02) | ℹ️ Info (latent) | `register()` called exactly once in production (index.ts). Latent risk only; does not affect any success criterion for this phase. |

No `TBD`, `FIXME`, or `XXX` debt markers found in phase-modified files.

---

### Human Verification Required

None. The only human-verification item from the initial report (CR-01 discrete-chord hold strobe) has been resolved in code and covered by automated tests. WR-05 is a tracked non-blocking known issue, not a verification gate.

---

### Gaps Summary

No gaps. All five roadmap success criteria are VERIFIED. No MISSING or STUB artifacts. All key links WIRED. Data flows end-to-end. The sole previous human-verification item (CR-01) is closed by commit 63fdff4 and confirmed by reading the implementation and its two dedicated tests.

**WR-05 (tracked non-blocking known issue):** `move()` clamps X/Y independently against the virtual-desktop bounding union. On staggered multi-monitor setups this can create a dead zone on no physical screen. The target machine is single-monitor; equal-height two-monitor configurations are unaffected. This is documented in `02-HUMAN-UAT.md` (pending, non-blocking) and does not touch any of the five success criteria. It is carried forward as a known issue for future hardening, not a gap blocking the phase goal.

---

_Verified: 2026-06-17T02:15:00Z_
_Verifier: Claude (gsd-verifier)_
_Re-verification of: 2026-06-17T01:31:00Z initial report_
