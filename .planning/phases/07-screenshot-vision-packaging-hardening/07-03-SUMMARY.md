---
phase: 07-screenshot-vision-packaging-hardening
plan: 03
subsystem: hardening
tags: [hardening, smartscreen, gpu-fallback, hotkey-recovery, ctl-03, latency, pkg-01, electron]

requires:
  - phase: 07-01
    provides: code-challenge AiMode + JEDI_DISABLE_GPU=1 top-level guard + the shared [ai] first-token latency log (startMs captured before async capture)
  - phase: 07-02
    provides: portable .exe GO 6/6 on-machine (PKG-01); JEDI_DISABLE_GPU + MAX_TOKENS code-challenge flagged as the 07-03 knobs
  - phase: 02
    provides: HotkeyRegistrarService / HOTKEY_CHORDS + register().failed -> setHotkeyStatus surfacing (CTL-03)
  - quick: 260619-mcv
    provides: the two new chords Ctrl+Alt+Y (copy) + Ctrl+Alt+M (interaction toggle), plus Ctrl+Alt+F focus-cycle — all already in HOTKEY_CHORDS
provides:
  - Main-process logging of the hotkey-registration outcome (active layer + failed-chord labels) at startup (CTL-03 hardened beyond the HUD-only surface)
  - docs/HARDENING.md — operational notes for SmartScreen friction, the GPU fallback, hotkey recovery, and latency
  - Confirmation (no new code) that the vision/code-challenge mode rides the existing [ai] first-token latency log
affects: []

tech-stack:
  added: []
  patterns:
    - "Surface a startup registration outcome to BOTH the HUD and the main log (labels only) so a packaged-build failure is never silently dropped (CTL-03)"
    - "Operational hardening lives in a committed docs/ note, not in code, for accepted-friction items (SmartScreen, opt-in GPU fallback)"
    - "Log discipline T-7-IL2: mode/model/latencyMs + failed-chord labels ONLY — never transcript, key, image base64, or error payload"

key-files:
  created:
    - docs/HARDENING.md
  modified:
    - src/main/index.ts

key-decisions:
  - "CTL-03 hardening = add a main-process startup log of the registrar outcome. The full chord set (incl. the post-Phase-2 additions capture-code-challenge / copy-code-challenge / toggle-interaction / focus-cycle) was ALREADY covered by register().failed -> setHotkeyStatus because bindViaUiohook/bindViaGlobalShortcut iterate the whole HOTKEY_CHORDS array; the only gap was that a failure was visible only on the easily-dismissed HUD, not in the logs. No registrar logic changed."
  - "The vision latency log required NO new code — the shared gateway 'text' handler logs `[ai] first-token mode=… model=… latencyMs=…` keyed on this.active.mode/model, which is 'code-challenge' for vision; startMs is captured before the async capture (07-01). Confirmed via the test-run log output."
  - "Reworded the JEDI_DISABLE_GPU guard comment to drop the literal 'whenReady' token before the disableHardwareAcceleration() call so the plan's naive placement-check (indexOf comparison) no longer false-positives on the explanatory comment. Code placement (top-level, before the real app.whenReady() at the bottom) was already correct from 07-01."

requirements-completed: [PKG-01]

duration: 9min
completed: 2026-06-19
---

# Phase 7 Plan 03: Hardening Set Summary

**Completed the PKG-01 hardening set: confirmed the JEDI_DISABLE_GPU=1 opt-in GPU fallback runs before app.ready and the vision mode rides the existing main-only first-token latency log (both no-new-code from 07-01), hardened the CTL-03 hotkey-registration-failure path by also logging the registrar outcome to the main process across the full current chord set, and documented SmartScreen "Run anyway" as accepted friction in `docs/HARDENING.md`.**

## What Was Built

- **CTL-03 main-process visibility (`src/main/index.ts`):** after `hotkeyRegistrar.register()` / `setHotkeyStatus(result)`, the outcome is now also logged to main — `console.warn('[hotkey] registration FAILED layer=… chords=…')` when any chord failed to bind, else `console.log('[hotkey] registration ok layer=… chords=N')`. This closes the gap where a packaged-build registration failure was visible only on the easily-dismissed HUD. The log carries only stable action **labels** (never a transcript/key/payload — T-7-IL2). The full current chord set was already iterated by the registrar (`bindViaUiohook`/`bindViaGlobalShortcut` loop the whole `HOTKEY_CHORDS` array), so the new chords `capture-code-challenge` (Ctrl+Alt+C), `copy-code-challenge` (Ctrl+Alt+Y), `toggle-interaction` (Ctrl+Alt+M), and `focus-cycle` (Ctrl+Alt+F) are all covered through `register().failed`. Imported `HOTKEY_ACTION_LABELS` for the ok-count log.
- **GPU fallback confirmed:** the `if (process.env.JEDI_DISABLE_GPU === '1') { app.disableHardwareAcceleration(); }` guard (added in 07-01) sits at the top of `index.ts`, before the real `app.whenReady()`. Its comment was reworded to drop the literal `whenReady` token so the plan's placement-check no longer false-positived; the code placement was already correct.
- **Vision latency confirmed (no new code):** the shared `gateway.on('text')` handler logs `[ai] first-token mode=… model=… latencyMs=…` keyed on `this.active.mode`/`model`, which is `code-challenge` for vision, with `startMs` captured before the async capture (07-01 / RESEARCH §6). The test run prints the log line, confirming the path fires.
- **`docs/HARDENING.md`:** SmartScreen "Run anyway" + "Unblock" steps as accepted friction (code signing out of scope); the `JEDI_DISABLE_GPU=1` opt-in fallback with PowerShell/cmd launch steps for the portable `.exe` and the electron#51363-irrelevant-on-35.7.5 note; the CTL-03 HUD-plus-main-log visibility across the full chord set with the Ctrl+Alt+C → V fallback letter; and the main-only first-token latency log covering vision with `MAX_TOKENS['code-challenge']=1500` as the truncation/latency knob. References the **still-pending** Ctrl+Alt+Y / Ctrl+Alt+M conflict re-check (quick task 260619-mcv) rather than claiming those chords are conflict-verified.

## Verification

- Task 1 placement check — `GPU guard placed before whenReady` (passes after the comment reword).
- Task 2 doc check — `hardening doc complete` (all of `SmartScreen`, `JEDI_DISABLE_GPU`, `Run anyway`, `Ctrl+Alt+C` present).
- `npm run typecheck` (node + web) — clean.
- `npm run lint` (oxlint) — clean.
- `npm test` — **153 passed / 20 files** (no regression). The run output confirms the `[ai] first-token …` latency log fires.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Reworded the GPU-guard comment to unblock the Task 1 placement check**
- **Found during:** Task 1 verification.
- **Issue:** the plan's automated check does `indexOf('disableHardwareAcceleration')` vs `indexOf('whenReady')` and fails if the GPU index is greater. The 07-01 guard comment contained the literal text `app.whenReady()` BEFORE the `disableHardwareAcceleration()` call, so the first `whenReady` match landed in the comment and the check false-positived ("GPU guard must precede whenReady") even though the actual `app.whenReady().then()` is at the bottom of the file.
- **Fix:** reworded the guard comment to say "before the app is ready" / "app.ready" (no `whenReady` token) so the first `whenReady` occurrence is now a later TSDoc reference, after the `disableHardwareAcceleration()` call. The runtime code placement was unchanged and already correct.
- **Files modified:** `src/main/index.ts`
- **Verification:** re-ran the check → `GPU guard placed before whenReady`.
- **Committed in:** `56c6409` (Task 1 commit).

---

**Total deviations:** 1 auto-fixed (1 blocking). No scope creep — the fix is a comment reword to satisfy a naive string-match verifier; the GPU guard behaviour and placement are unchanged from 07-01.

## Task Commits

1. **Task 1: harden CTL-03 + confirm GPU guard + vision latency** — `56c6409` (feat)
2. **Task 2: docs/HARDENING.md** — `610cd0b` (docs)

## Authentication Gates

None. No live keys were needed — Task 1 is a main-process log line and Task 2 is documentation. The end-to-end screenshot-solve (live ANTHROPIC_API_KEY) was already exercised at the 07-02 on-machine GO gate.

## Known Stubs

None. No code stubs introduced.

## Notes for Downstream

- **D-16 (Whisper stub) correctly NOT built** — dropped per CONTEXT D-16 (v2 / out of scope; the ISttProvider seam already proves swappability via TRN-05). No surface added.
- **Still-pending verification (carried, not resolved here):** the on-machine Teams/Zoom/VS Code conflict re-check for `Ctrl+Alt+Y` (copy) and `Ctrl+Alt+M` (interaction toggle) from quick task 260619-mcv remains **pending**; `docs/HARDENING.md` references it as pending rather than claiming those two chords are conflict-verified. `Ctrl+Alt+C` carries the 07-02 packaged re-check (fallback letter `V`).
- PKG-01 success criterion 4 (latency instrumented + SmartScreen documented as accepted friction) is satisfied by this plan plus the 07-02 GO record.

## Self-Check: PASSED

- `docs/HARDENING.md` exists on disk.
- `src/main/index.ts` contains the CTL-03 main-process log and the `JEDI_DISABLE_GPU` guard.
- Task commits `56c6409` and `610cd0b` present in `git log`.

---
*Phase: 07-screenshot-vision-packaging-hardening*
*Completed: 2026-06-19*
