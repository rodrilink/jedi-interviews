---
phase: 03-audio-loopback-spike
plan: 02
subsystem: audio-capture
tags: [audio, loopback, getDisplayMedia, dxgi, wasapi, naudiodon, go-no-go, gate]

# Dependency graph
requires:
  - phase: 03-01
    provides: 'Loopback capture seam + AudioWorklet RMS + live HUD Audio: row (the app under test)'
provides:
  - 'Committed 03-LOOPBACK-GATE.md GO/NO-GO record — NO-GO at Electron 35.7.5 on the target machine'
  - 'Phase 3 GO/NO-GO blocker RESOLVED in STATE.md'
  - 'Phase 4 capture direction: naudiodon WASAPI sidecar (built-in loopback abandoned)'
affects: [04-stt-pipeline, audio-capture, phase-4]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - 'On-machine human-judged GO/NO-GO gate recorded in a committed phase doc (mirrors Phase 1 VERIFICATION.md / Phase 2 conflict-test)'

key-files:
  created:
    - .planning/phases/03-audio-loopback-spike/03-LOOPBACK-GATE.md
  modified:
    - .planning/STATE.md
    - .planning/PROJECT.md

key-decisions:
  - 'Phase 3 NO-GO: built-in getDisplayMedia/Chromium loopback is silent on the target machine (MSI) — DXGI desktop-duplicator fails continuously, breaking the capture session; meter never moved above 0 on general media'
  - 'Full NO-GO, not the D-09 comms-device-routing partial (general media itself produced no signal, so the meeting-source test was moot)'
  - 'Phase 4 capture switches to the naudiodon WASAPI sidecar (separate process, never touches Chromium screen capture); AUD-01/AUD-02 requirement unchanged, only the mechanism'

patterns-established:
  - 'GO/NO-GO gate doc records machine, OS version, exact Electron version, per-source observed RMS behavior, root cause, approaches tried, and an explicit decision token — auditable/reproducible (T-03-05 repudiation mitigation)'

requirements-completed: [AUD-02]

# Metrics
duration: 6min
completed: 2026-06-17
---

# Phase 3 Plan 02: On-Machine Loopback GO/NO-GO Gate Summary

**Built-in `getDisplayMedia` system-audio loopback is NO-GO on the target machine — a continuous DXGI desktop-duplicator failure breaks the capture session and the HUD `Audio:` meter never left 0 on general media; Phase 4 will capture via the `naudiodon` WASAPI sidecar.**

## Performance

- **Duration:** ~6 min (Task 2; Task 1 was the human on-machine verification, complete prior)
- **Completed:** 2026-06-17
- **Tasks:** 2 (Task 1 human-verify checkpoint COMPLETE; Task 2 gate record + decision logging)
- **Files modified:** 3 (1 created, 2 modified)

## Accomplishments

- Recorded the committed `03-LOOPBACK-GATE.md` GO/NO-GO gate: machine (MSI), Windows 10.0.26200.8655, Electron **35.7.5**, both sources in order (Source 1 general media = stuck at 0 / no signal; Source 2 Teams/Zoom = not reached, with the reason), the DXGI root cause with the exact error strings, the three approaches tried-and-failed, and an explicit **NO-GO** decision plus the Phase 4 WASAPI-sidecar implication.
- Logged the decision in both required places (D-07): a Phase 3 NO-GO decision line in STATE.md Accumulated Context (superseding the earlier "built-in loopback chosen" line) and the "Phase 3 (GO/NO-GO)" blocker marked **RESOLVED 2026-06-17**.
- Updated the PROJECT.md Key Decisions table: the existing built-in-loopback row Outcome changed from "— Pending" to "✗ NO-GO", plus a new row adopting the `naudiodon` WASAPI sidecar for Phase 4. Annotated the Active system-audio requirement (kept Active; only the mechanism changed).

## Task Commits

1. **Task 1: On-machine two-source loopback verification (human-judged)** — completed by the human operator prior to this run; result reported verbatim as the gate evidence (no code commit — verification step).
2. **Task 2: Gate record + decision logged in STATE.md/PROJECT.md** — `docs(03-02): record loopback gate NO-GO (DXGI duplicator failure) + log decision in STATE/PROJECT`

**Plan metadata:** SUMMARY + ROADMAP/STATE progress (docs commit)

## Files Created/Modified

- `.planning/phases/03-audio-loopback-spike/03-LOOPBACK-GATE.md` — the committed GO/NO-GO gate record (NO-GO).
- `.planning/STATE.md` — Phase 3 NO-GO decision line; "Phase 3 (GO/NO-GO)" blocker RESOLVED.
- `.planning/PROJECT.md` — Key Decisions loopback row → NO-GO; new WASAPI-sidecar row; Active requirement annotated.

## Decisions Made

- **NO-GO recorded verbatim from Task 1.** General media (Source 1) produced no signal — the HUD `Audio:` row stayed stuck at 0 while media played. Source 2 (Teams/Zoom) was not reached because the pipeline never produced signal on general media, making the meeting-source test moot.
- **Root cause:** Chromium's screen-capture backend fails continuously with `DxgiDuplicatorController failed to capture desktop, error code Duplication failed` / `Failed to capture 1 frames within 500 milliseconds` (~every 0.75 s). Because `getDisplayMedia` couples the loopback audio track to the DXGI desktop-duplicator video capturer, the broken duplicator carries the audio session down with it (silent meter). Ruled out the common DXGI triggers — machine was on a physical screen, not RDP/locked/VM.
- **Three approaches all failed identically:** (1) built-in screen source + `audio:'loopback'`; (2) window source instead of screen source (a window source `window:397498:1` was confirmed chosen, yet the duplicator still errored — proving it engages independent of source choice); (3) the `electron-audio-loopback@1.0.6` shim. The shim and source-type change were reverted; the tree is back to committed 03-01 code.
- **Not D-09 (comms-device routing).** The partial case requires general media to work while only the meeting call fails. Here general media itself was silent → full NO-GO → `naudiodon` WASAPI-sidecar fallback for Phase 4.

## Deviations from Plan

None — plan executed exactly as written. The result was a NO-GO rather than a GO, but the gate's purpose is to record whichever outcome occurred; the NO-GO branch (D-09 / WASAPI sidecar) is part of the planned gate logic.

## Issues Encountered

None during Task 2 (documentation-only). The NO-GO finding itself is the empirical result the gate exists to surface — it is recorded, not "resolved", and it correctly redirects Phase 4 to the WASAPI sidecar.

## User Setup Required

None — no external service configuration required for this documentation/gate plan.

## Next Phase Readiness

- Phase 4 has an unambiguous signal: **do not** use built-in `getDisplayMedia` loopback on this machine; build the `naudiodon` WASAPI-sidecar capture path instead. The 03-01 audio-capture seam is the insulation point, so the source swap should not touch transcript/AI code.
- Concern carried forward: `naudiodon@2.3.6` is a native module (PortAudio bindings) requiring a rebuild against the Electron ABI — Phase 4 must budget for the native-build step (the same `@electron/rebuild` discipline used for `uiohook-napi` in Phase 2). The dependency is introduced only now that the gate has returned NO-GO (per the threat register, not installed speculatively).

## Self-Check: PASSED

- `03-LOOPBACK-GATE.md` present on disk; `03-02-SUMMARY.md` present on disk.
- Gate+docs commit `4096ec4` verified in git log.
- Plan gate node check (Electron 35.7.5 + GO/NO-GO token in gate, Phase 3 in STATE.md, loopback in PROJECT.md) exits 0.

---
*Phase: 03-audio-loopback-spike*
*Completed: 2026-06-17*
