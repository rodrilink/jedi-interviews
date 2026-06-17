---
phase: 02-global-hotkeys-window-control
plan: 03
subsystem: window-control
tags: [electron, hotkeys, uiohook-napi, conflict-testing, react, vitest]

# Dependency graph
requires:
  - phase: 02-global-hotkeys-window-control
    plan: 01
    provides: "HotkeyRegistrarService + locked Ctrl+Alt chord registry (PLACEHOLDER); IHotkeyRegistrationResult { active, failed } failure-surfacing path (CTL-03); HUD Hotkeys: OK / N failed line"
  - phase: 02-global-hotkeys-window-control
    plan: 02
    provides: "Real window-control handler map injected into the registrar; DebugHud hotkey cheat-sheet (row-hotkey-*) mirroring the placeholder chords"
provides:
  - "Finalized, conflict-tested default Ctrl+Alt chord set (J / arrows / [ ] / H / Q) — empirically verified against Teams/Zoom/VS Code on the target Windows 11 machine, shipping unchanged"
  - "02-HOTKEY-CONFLICT-TEST.md: filled per-app matrix (all-pass), Final chord set, requirements-covered footer, dated sign-off"
  - "Registrar chord registry + HUD cheat-sheet TSDoc reworded from PLACEHOLDER to finalized conflict-tested defaults"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Empirical on-machine conflict testing (committed matrix) as the close-out gate for a default chord set — the documentation analog of the Phase 1 VERIFICATION.md GO/NO-GO discipline"
    - "Passive uiohook non-consumption (CTL-02) proven empirically: app-own Ctrl+Alt accelerators still fire while the overlay also acts on the same chord"

key-files:
  created:
    - .planning/phases/02-global-hotkeys-window-control/02-HOTKEY-CONFLICT-TEST.md
  modified:
    - src/main/hotkey-registrar.service.ts
    - src/main/hotkey-registrar.service.test.ts
    - src/renderer/src/components/debug-hud.tsx

key-decisions:
  - "All suggested default chords (Ctrl+Alt+J / arrows / [ ] / H / Q) verified conflict-free against Teams, Zoom, and VS Code on the target machine — no chord swap was needed; the placeholders ARE the finalized defaults"
  - "Non-consumption (CTL-02) confirmed on the real machine: every app-own Ctrl+Alt accelerator still fired (column c all-pass / n/a), proving the passive uiohook hook does not steal the meeting app's accelerators"
  - "Chord VALUES are unchanged from 02-01; this plan only removed PLACEHOLDER wording from the registrar registry, the test keycode comment, and the HUD cheat-sheet TSDoc, presenting the chords as the conflict-tested defaults (D-13)"

requirements-completed: [OVL-03, OVL-05, CTL-01, CTL-02, CTL-03]

# Metrics
duration: ~8min
completed: 2026-06-17
---

# Phase 2 Plan 03: Hotkey Conflict Testing + Default Chord Finalization Summary

**Empirically closed CTL-02 on the target Windows 11 machine: the locked Ctrl+Alt action set was tested against Teams, Zoom, and VS Code holding focus — every overlay action fired, no app swallowed a chord, and every app-own accelerator still fired (passive non-consumption proven) — so the suggested defaults ship unchanged, the PLACEHOLDER wording is gone, and the failure-surfacing path (CTL-03) survives the finalization.**

## Performance

- **Duration:** ~8 min (continuation agent, resumed from approved Task 1 human-verify checkpoint)
- **Completed:** 2026-06-17
- **Tasks:** 2 (Task 1 human-verify checkpoint pre-approved "all placeholders pass"; Task 2 auto)
- **Files modified:** 4 (1 created, 3 modified)

## Accomplishments
- Recorded the empirical conflict-test result in `02-HOTKEY-CONFLICT-TEST.md`: the per-app matrix (Teams / Zoom / VS Code) is filled all-pass across all three columns — (a) overlay action fires, (b) not swallowed, (c) app-own Ctrl+Alt accelerator still fires (or n/a) — proving passive uiohook non-consumption (CTL-02) on the target machine. Final chord set, requirements-covered footer, and a dated sign-off (2026-06-17, uiohook layer, HUD `Hotkeys: OK`) are complete.
- Finalized the chord set in code without changing any chord value (the human verified all placeholders pass): removed the "PLACEHOLDER pending 02-03" TSDoc note from the `HOTKEY_CHORDS` registry in `hotkey-registrar.service.ts`, citing the conflict-test doc; reworded the HUD cheat-sheet TSDoc in `debug-hud.tsx` to present the chords as the finalized defaults (D-13); refreshed the registrar test's keycode comment.
- Confirmed the CTL-03 failure-surfacing path survived the finalization: the registrar suite is 6/6 green (incl. the per-chord-failure-without-throw case), the full suite is 17/17, and `npm run typecheck` + `npm run lint` exit 0.

## Task Commits

Each logical task was committed atomically:

1. **Task 2: Finalize conflict-tested Ctrl+Alt chord defaults** (registrar + HUD + test) - `217afe0` (feat)
2. **Task 1: Record all-pass conflict-test result + sign-off** (02-HOTKEY-CONFLICT-TEST.md) - `08c0729` (docs)

**Plan metadata:** committed with this SUMMARY (docs: complete plan)

_The Task 1 human-verify checkpoint scaffold was committed by the prior executor (`7e1e9ed`); this continuation agent filled in the verified result. No TDD cycle in this plan — chord values were unchanged, so existing tests stayed green._

## Files Created/Modified
- `.planning/phases/02-global-hotkeys-window-control/02-HOTKEY-CONFLICT-TEST.md` - Filled per-app matrix (all-pass), completed Final chord set, requirements-covered footer (OVL-03/OVL-05/CTL-01/CTL-02/CTL-03), dated sign-off.
- `src/main/hotkey-registrar.service.ts` - `HOTKEY_CHORDS` TSDoc reworded from PLACEHOLDER to conflict-tested defaults citing the conflict-test doc; chord values unchanged.
- `src/main/hotkey-registrar.service.test.ts` - Keycode comment updated ("conflict-tested" rather than "placeholder"); assertions unchanged.
- `src/renderer/src/components/debug-hud.tsx` - `HOTKEY_CHEAT_SHEET` TSDoc reworded to present chords as finalized defaults (D-13); chord labels unchanged.

## Decisions Made
- **No chord swap needed.** The human ran the live conflict test on the target Windows 11 machine with Teams, Zoom, and VS Code each holding focus and reported "all placeholders pass." No chord collided in any app, and every app-own Ctrl+Alt accelerator still fired. Therefore the 02-01 suggested defaults (`Ctrl+Alt+J` show/hide, arrows move, `[`/`]` opacity, `H` HUD toggle, `Q` quit) ARE the finalized defaults — only the PLACEHOLDER wording was removed.
- **CTL-02 closed empirically.** Column (c) of the matrix (app's-own-accelerator-still-fires) is the non-consumption proof. It is all-pass / n/a across the three apps, confirming on the real machine that the passive uiohook hook observes the chords without stealing the meeting app's accelerators — the distinguishing guarantee over `globalShortcut`.
- **CTL-03 confirmed intact after finalization.** Because no chord value changed, the `{ active, failed }` aggregation and the per-chord-failure-without-throw test remained green (6/6 registrar, 17/17 full suite). The chord-string assertions were kept (not deleted) and still match the shipped set.

## Deviations from Plan

None - plan executed exactly as written. Task 1 was a human-verify checkpoint pre-approved ("all placeholders pass") before this continuation agent ran; Task 2 was the confirm-in-place path the plan anticipated ("If Task 1 found that all placeholders passed, this task confirms-in-place: keep the chords, drop the PLACEHOLDER wording").

## Issues Encountered
None.

## Known Stubs
None. The hotkey chords are now finalized (no longer placeholders); the action set, handlers, registrar, and HUD cheat-sheet all reflect the conflict-tested defaults. No stub patterns remain in the modified files.

## Threat Surface Review
- T-02-09 (a shipped chord colliding with a meeting app accelerator): **mitigated** — every chord was empirically tested against Teams/Zoom/VS Code across all three result columns; none collided, so no colliding chord ships (D-05).
- T-02-10 (info disclosure via the committed conflict-test doc): **mitigated** — `02-HOTKEY-CONFLICT-TEST.md` records only action labels, chord names, and pass/collide results; no keystroke content and no secrets.

## Next Phase Readiness
- Phase 2 is complete: the keyboard-only control loop (show/hide, move, opacity, HUD toggle, quit) ships with a conflict-free default Ctrl+Alt chord set, registration failures are surfaced (CTL-03), and non-consumption is proven (CTL-02). All five Phase 2 requirements (OVL-03, OVL-05, CTL-01, CTL-02, CTL-03) are satisfied.
- No blockers. The overlay's existential + control behaviors are in place ahead of Phase 3 (system-audio loopback).

## Self-Check: PASSED

- Created file verified on disk: `.planning/phases/02-global-hotkeys-window-control/02-HOTKEY-CONFLICT-TEST.md`.
- Task commits verified in git log: `217afe0` (Task 2 feat), `08c0729` (Task 1 docs).
- Verification: `npx vitest run` 17/17 pass (registrar 6/6 incl. CTL-03 failure-surfacing); `npm run typecheck` exits 0; `npm run lint` exits 0.

---
*Phase: 02-global-hotkeys-window-control*
*Completed: 2026-06-17*
