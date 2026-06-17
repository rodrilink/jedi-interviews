---
phase: 02-global-hotkeys-window-control
verified: 2026-06-17T01:31:00Z
status: human_needed
score: 5/5 must-haves verified
overrides_applied: 0
re_verification: false
human_verification:
  - test: "Hold Ctrl+Alt+J for ~2 seconds and observe whether the overlay strobes (rapid show/hide) or fires exactly once"
    expected: "With the discrete-guard missing (CR-01), the overlay is expected to strobe at the OS key-repeat rate. The human conflict test only verified a tap, not a hold."
    why_human: "The CR-01 defect in dispatchUiohookKeydown (kind field never read) can only be confirmed as acceptable or blocking by the developer observing the actual hold behavior on the target machine. Automated tests assert the strobe behavior is present (show/hide called 2x for 2 keydowns) but do not evaluate whether that is acceptable for this phase."
---

# Phase 2: Global Hotkeys + Window Control — Verification Report

**Phase Goal:** The complete keyboard-only control loop — show/hide, move, and opacity — operating globally while a meeting app holds focus, with hotkey registration failures detected and surfaced.
**Verified:** 2026-06-17T01:31:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths (Roadmap Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | The user can show and hide the overlay by global hotkey while another application holds focus, and content protection is re-applied on every show. | ✓ VERIFIED (with WARNING) | `WindowControlActionsService.showOverlay()` delegates to `showOverlay()` wrapper (overlay-window.manager.ts:255-264) which re-applies `setContentProtection(true)` on every call. The show/hide handler in `index.ts:26-32` branches on `getOverlayVisible()`. Tap path works. WARNING: CR-01 — holding the chord strobes (see Anti-Patterns). Human conflict test (signed 2026-06-17) verified a tap. |
| 2 | The user can move the overlay around the screen using only the keyboard. | ✓ VERIFIED | `WindowControlActionsService.move()` (window-control.actions.ts:145-158) reads position, applies ±50px delta, clamps against `virtualDesktopBounds()` union of all display work areas, calls `window.setPosition()`. Wired into `HotkeyRegistrarService` via `buildHandlers` in index.ts. Tests pass (8/8 in window-control.actions.test.ts). |
| 3 | The user can raise and lower the overlay's opacity by keyboard. | ✓ VERIFIED | `stepOpacity()` (window-control.actions.ts:166-173) applies ±0.1 delta clamped to [0.2, 1.0], rounded to 1 decimal. `opacityUp()`/`opacityDown()` thin wrappers wired in handler map. Tests pass. |
| 4 | Global hotkeys fire while a real meeting app (e.g. Teams or Zoom) is the focused window, without stealing that app's accelerators. | ✓ VERIFIED (human-verified) | CTL-02 empirically closed: `02-HOTKEY-CONFLICT-TEST.md` signed 2026-06-17 by rodrigo-gomez@idexx.com. All three apps (Teams, Zoom, VS Code) tested — column (a) all YES, column (b) all NO, column (c) all n/a/YES. uiohook passive hook confirmed active layer. This criterion was explicitly human-verified on the target machine per the phase instructions. |
| 5 | A hotkey that fails to register or conflicts is detected and surfaced to the user, never silently dropped. | ✓ VERIFIED | `HotkeyRegistrarService.register()` (hotkey-registrar.service.ts:98-108) aggregates `{ active, failed }` without throwing. `setHotkeyStatus(result)` feeds `lastHotkeyResult` into `buildStatus()`. `debug-hud.tsx:64` renders `cell-hotkey-status` showing `OK` or `N failed`. Tests 2 and 4 in hotkey-registrar.service.test.ts verify per-chord failure surfacing and both-layers-fail paths. All 6 registrar tests pass. |

**Score:** 5/5 truths verified (with one WARNING on SC-1 tap-vs-hold behavior)

---

### Deferred Items

None. All five roadmap success criteria are addressed in this phase.

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/main/hotkey-registrar.service.ts` | HotkeyRegistrarService — registers Ctrl+Alt set, aggregates results, wires hold-to-repeat | ✓ VERIFIED | 210 lines. Contains `class HotkeyRegistrarService`, `IHotkeyRegistrationResult`, `HOTKEY_ACTION_LABELS`. Registered uiohook keydown listener, globalShortcut fallback, teardown(). |
| `src/main/hotkey-registrar.service.test.ts` | Vitest coverage of 6 behaviors including failure surfacing and fallback | ✓ VERIFIED | Contains `vi.mock('uiohook-napi'`, `vi.mock('electron'`, uses `await import(` after mock setup. 6/6 tests pass. |
| `src/main/window-control.actions.ts` | WindowControlActionsService — show/hide, move-with-clamp, opacity-step, HUD-toggle, quit | ✓ VERIFIED | 202 lines. Contains `class WindowControlActionsService` with all six handler types, all `isDestroyed()`-guarded. |
| `src/main/window-control.actions.test.ts` | Vitest coverage of clamping math, opacity bounds, hide/show routing, HUD-toggle | ✓ VERIFIED | Contains `WindowControlActionsService`. 8/8 tests pass (includes isDestroyed no-op test). |
| `src/main/overlay-window.manager.ts` | IOverlayStatus extended with hotkeys + hudVisible; hideOverlay(); isOverlayVisible state | ✓ VERIFIED | Contains `hotkeys: { active: string; failed: string[] }` and `hudVisible: boolean` in IOverlayStatus (lines 11-28). Exports `hideOverlay`, `setHudVisible`, `getHudVisible`, `setHotkeyStatus`, `setOverlayVisible`, `getOverlayVisible`. |
| `.planning/phases/02-global-hotkeys-window-control/02-HOTKEY-CONFLICT-TEST.md` | Per-app conflict matrix with all three result columns, Final chord set, sign-off | ✓ VERIFIED | All 5 action groups × 3 apps × 3 columns filled all-pass. Final chord set present. Signed by rodrigo-gomez@idexx.com on 2026-06-17. |
| `src/renderer/src/components/debug-hud.tsx` | IOverlayStatus.hotkeys + hudVisible (third declaration); cell-hotkey-status; row-hotkey-* cheat-sheet | ✓ VERIFIED | IOverlayStatus declared with both `hotkeys` and `hudVisible` fields. `cell-hotkey-status` present (line 83). `HOTKEY_CHEAT_SHEET` + `row-hotkey-{id}` rows for all 5 action groups (lines 24-30, 87-93). |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/main/index.ts` | `HotkeyRegistrarService` | instantiate after `app.whenReady`, `buildHandlers(actions)`, `register()`, teardown on `window-all-closed` | ✓ WIRED | `index.ts:72-74` instantiates `HotkeyRegistrarService(buildHandlers(windowControlActions))`, calls `register()`, feeds `setHotkeyStatus(result)`, calls `pushStatus(window)`. `index.ts:86` calls `hotkeyRegistrar?.teardown()`. |
| `src/main/index.ts` | `WindowControlActionsService` | real handlers injected, show/hide branches on `getOverlayVisible()` | ✓ WIRED | `index.ts:71` instantiates `WindowControlActionsService(window)`. `buildHandlers()` at lines 24-42 maps all 9 action labels to real methods. Show/hide branches at lines 27-31 on `getOverlayVisible()`. |
| `src/main/hotkey-registrar.service.ts` | `overlay-window.manager.ts (pushStatus)` | via `setHotkeyStatus(result)` then `pushStatus(window)` in index.ts | ✓ WIRED | `setHotkeyStatus` exported from overlay-window.manager.ts:53, called in index.ts:74. `lastHotkeyResult` flows into `buildStatus()` at line 125. |
| `src/main/window-control.actions.ts` | `showOverlay` | show handler delegates to `showOverlay(window)` | ✓ WIRED | `window-control.actions.ts:72` calls `showOverlay(this.window)`. No `.show()` or `.focus()` call in file. |
| `src/main/window-control.actions.ts` | `screen.getAllDisplays()` | `virtualDesktopBounds()` method | ✓ WIRED | `window-control.actions.ts:183` calls `screen.getAllDisplays()`, unions work areas into min/max bounds, used in `move()` at lines 152-155. |
| `src/renderer/src/components/debug-hud.tsx` | `status.hotkeys` | `cell-hotkey-status` row rendered from pushed payload | ✓ WIRED | `debug-hud.tsx:64` derives `hotkeyLabel` from `status.hotkeys.failed.length`. Rendered at line 83 in `data-testid="cell-hotkey-status"` dd element. |
| `src/renderer/src/components/debug-hud.tsx` | `status.hudVisible` | HUD content derived from pushed flag (D-15) | ✓ WIRED | `debug-hud.tsx:56` sets `hudVisible = status ? status.hudVisible : visible`. Returns `null` when `!hudVisible` at line 57-59. |
| `src/preload/index.ts` | `IOverlayStatus` | second identical declaration carries `hotkeys` + `hudVisible` | ✓ WIRED | `preload/index.ts:10-18` declares `IOverlayStatus` with both fields identically. `onStatus` bridge unchanged. |
| `src/main/hotkey-registrar.service.ts` chord constants | `02-HOTKEY-CONFLICT-TEST.md` Final chord set | finalized chords match the document | ✓ WIRED | HOTKEY_CHORDS at lines 53-63: `Ctrl+Alt+J`, arrows, `[`/`]`, `H`, `Q` — exactly matches Final chord set in the conflict-test document. PLACEHOLDER wording absent (removed in 02-03). |
| `src/renderer/src/components/debug-hud.tsx` `row-hotkey-*` | finalized chords | cheat-sheet labels match final set | ✓ WIRED | `HOTKEY_CHEAT_SHEET` at lines 24-30 shows `Ctrl+Alt+J`, `Ctrl+Alt+Arrows`, `Ctrl+Alt+[ / ]`, `Ctrl+Alt+H`, `Ctrl+Alt+Q`. |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `debug-hud.tsx` | `status.hotkeys` | `HotkeyRegistrarService.register()` → `setHotkeyStatus()` → `buildStatus()` → `pushStatus()` → `ipcRenderer.on` → `onStatus` → `setStatus()` | Yes — real uiohook/globalShortcut registration outcome | ✓ FLOWING |
| `debug-hud.tsx` | `status.hudVisible` | `setHudVisible()` in `toggleHud()` → `buildStatus()` → `pushStatus()` | Yes — real main-owned boolean flag | ✓ FLOWING |
| `debug-hud.tsx` | `status.contentProtection` | `contentProtectionEnabled` set in `showOverlay()` / `blur` handler → `buildStatus()` | Yes — real window state | ✓ FLOWING |
| `debug-hud.tsx` | `status.position` | `window.getPosition()` in `buildStatus()` | Yes — real Electron window position | ✓ FLOWING |

---

### Behavioral Spot-Checks

Step 7b skipped — the app requires Electron runtime to start and cannot be checked with a single static command. The human conflict test (signed 2026-06-17) serves as the live behavioral verification for the core control loop.

---

### Probe Execution

No probes declared in PLAN files or found under `scripts/*/tests/`. Phase uses human-verify checkpoints (Task 1 in 02-01 and 02-03) as the live verification gates. Both checkpoints are signed off in the SUMMARYs as pre-approved.

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| CTL-02 | 02-01-PLAN, 02-03-PLAN | Hotkeys work while another app holds focus (non-consumption) | ✓ SATISFIED | `uiohook-napi` passive hook wired in `HotkeyRegistrarService`. Empirically verified on target machine: `02-HOTKEY-CONFLICT-TEST.md` signed 2026-06-17. |
| CTL-03 | 02-01-PLAN, 02-03-PLAN | Registration failures surfaced, never silently dropped | ✓ SATISFIED | `register()` aggregates `{ active, failed }` without throwing. `cell-hotkey-status` in HUD shows `OK` / `N failed`. Test 2 and 4 verify the failure path. |
| OVL-03 | 02-02-PLAN | Adjust overlay opacity by keyboard | ✓ SATISFIED | `opacityUp()`/`opacityDown()` in `WindowControlActionsService` step ±0.1 clamped to [0.2, 1.0]. Wired via `buildHandlers`. |
| OVL-05 | 02-02-PLAN, 02-03-PLAN | Show/hide overlay by global hotkey | ✓ SATISFIED (with WARNING) | Show/hide handler wired; tap path verified on target machine. WARNING: hold path strobes (CR-01). |
| CTL-01 | 02-02-PLAN | Move overlay by keyboard only | ✓ SATISFIED | `moveLeft/Right/Up/Down` wired; 50px step; outermost virtual-desktop clamp; cross-monitor allowed. |

All five Phase 2 requirements are satisfied. No orphaned requirements found — REQUIREMENTS.md traceability table maps OVL-03, OVL-05, CTL-01, CTL-02, CTL-03 exactly to Phase 2.

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/main/hotkey-registrar.service.ts` | 160-174 | `dispatchUiohookKeydown` never reads `chord.kind` — `ActionKind: 'discrete'` guard declared but unenforced | ⚠️ Warning (CR-01) | Holding show/hide or quit chords strobes at OS auto-repeat rate (~30/sec). Tap behavior (one press → one toggle) works correctly and was the only pattern exercised in the signed human conflict test. Does not block the phase goal but violates D-01 contract for discrete actions. |
| `src/main/window-control.actions.ts` | 145-158, 182-201 | `virtualDesktopBounds()` unions X and Y independently — on monitors of mismatched heights, the clamp can place the window in a gap between physical screens | ⚠️ Warning (WR-05) | With equal-height monitors the clamp works correctly (the tested case). With staggered monitors the overlay could land off all physical screens — the "never lose the overlay" guarantee (D-10) is partially undermined. Untested; single-display and equal-height two-display tests do not exercise this path. |
| `src/renderer/src/components/debug-hud.tsx` | 50-52 | `useEffect` subscribes to `onStatus` with no cleanup function; `onStatus` in preload registers a non-removable `ipcRenderer.on` listener | ℹ️ Info (WR-03) | Under React StrictMode dev, the effect fires twice registering two listeners per mount. No functional impact in production single-mount lifecycle; does not affect a success criterion. |
| `src/main/hotkey-registrar.service.ts` | 132-151 | `bindViaUiohook` calls `uIOhook.on` and `uIOhook.start()` on every `register()` call without guarding re-entry; a second call stacks duplicate listeners | ℹ️ Info (WR-01/WR-02) | `register()` is called exactly once in production (index.ts:73) so the latent risk is not exercised. Does not affect a success criterion for this phase. |

No `TBD`, `FIXME`, or `XXX` debt markers found in phase-modified files.

---

### Human Verification Required

#### 1. Discrete-chord hold behavior (CR-01 assessment)

**Test:** With the app running (`npm run dev`), hold `Ctrl+Alt+J` for approximately 2 seconds.
**Expected (per D-01 contract):** The overlay should toggle once (show or hide) and remain in that state for the duration of the hold.
**Actual (per code):** The `dispatchUiohookKeydown` never reads `chord.kind`; the show/hide handler fires on every uiohook keydown event including OS auto-repeat (~30 events/sec), causing rapid strobe. The test file explicitly asserts `show/hide` is called 2 times for 2 keydowns (line 199), confirming the strobe behavior is present.
**Why human:** Only the developer can decide whether the strobe behavior is (a) an acceptable known limitation for this phase, given that the tap case works correctly and the human conflict test used taps, or (b) a defect that must be fixed before the phase is considered complete. If the developer accepts the strobe, an override should be added. If not, CR-01's fix (`heldDiscreteKeycodes` guard + keyup clearing + test update) must be applied.
**Why not auto-closed by the conflict test:** The signed conflict test (`02-HOTKEY-CONFLICT-TEST.md`) records a tap on each chord — "press every placeholder chord" — and does not include a hold test. CTL-02 non-consumption (the focus-discipline criterion) is fully verified. The discrete-guard question is separate.

---

### Gaps Summary

No blockers. All five roadmap success criteria are VERIFIED at the code level. No MISSING or STUB artifacts found. All key links are WIRED and data flows end-to-end.

One human verification item remains open regarding CR-01's discrete-chord hold behavior. The tap path for show/hide, which is the documented usage pattern and the path tested in the live conflict test, works correctly. The hold path strobes due to the missing `ActionKind` guard in `dispatchUiohookKeydown`. The developer must decide whether this constitutes an acceptable gap or requires a fix before the phase is closed.

The WR-05 staggered-monitor dead-zone is a warning: it is not exercised by any test and cannot be verified without hardware, but it is a narrower robustness gap than a success-criterion failure (the single-display and equal-height two-display cases — the expected configuration for this machine — work correctly per tests).

---

_Verified: 2026-06-17T01:31:00Z_
_Verifier: Claude (gsd-verifier)_
