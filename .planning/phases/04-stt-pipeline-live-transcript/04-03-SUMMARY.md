---
phase: 04-stt-pipeline-live-transcript
plan: 03
subsystem: transcript
tags: [transcript-buffer, time-window, memory-ceiling, hotkey, uiohook, clear-transcript, vitest, main-process]

# Dependency graph
requires:
  - phase: 04-stt-pipeline-live-transcript
    plan: 01
    provides: "ISttProvider seam + the main-owned pure-utility/unit-test conventions (rms/pcm style mirrored here)"
  - phase: 02-global-hotkeys-window-control
    provides: "HotkeyRegistrarService (passive uiohook + globalShortcut fallback, register()-result checking, HUD surfacing) extended with the clear chord"
provides:
  - "TranscriptBuffer (TRN-04): main-owned, time-bounded rolling finalized transcript with three independent hard bounds; appendFinal/setInterim/clear/recentSince/renderable; injected clock"
  - "recentSince(ms) time-based span read for Phase 5's AIOrchestrator"
  - "clear-transcript Ctrl+Alt+K discrete chord registered through HotkeyRegistrarService (D-07)"
affects: [04-04-bootstrap-wiring, phase-05-ai-orchestrator]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Injected-clock buffer: constructor(now: () => number = Date.now) makes prune-by-time and recentSince deterministic in unit tests"
    - "Three independent hard bounds (time window + segment ceiling + char ceiling); the two count/char ceilings are clock-independent so a misbehaving clock cannot defeat them (T-4-06)"
    - "Interim replaced (never accumulated); only is_final segments committed"
    - "New hotkey = ONE entry in HOTKEY_CHORDS; generic bind/dispatch/fallback iteration + derived HOTKEY_ACTION_LABELS need no logic change (D-07 reuse)"

key-files:
  created:
    - "src/main/stt/transcript-buffer.ts (TranscriptBuffer + ITranscriptSegment + WINDOW_MS/MAX_SEGMENTS/MAX_TOTAL_CHARS exports)"
    - "src/main/stt/transcript-buffer.test.ts (8 unit tests, injected fake clock)"
  modified:
    - "src/main/hotkey-registrar.service.ts (one clear-transcript IHotkeyChord)"
    - "src/main/hotkey-registrar.service.test.ts (K keycode + mock; fire-once + missing-handler tests)"

key-decisions:
  - "WINDOW_MS = 90_000 (90s): >= Phase 5's ~60s recent-span plus headroom (A7/D-06)."
  - "MAX_SEGMENTS = 400 and MAX_TOTAL_CHARS = 20_000: the two clock-independent hard memory ceilings (T-4-06 DoS mitigation)."
  - "clear-transcript chord letter finalized as K (Ctrl+Alt+K) — not in the locked set {J, arrows, [, ], H, Q}; kind 'discrete'. On-machine Teams/Zoom/VS Code conflict re-check still PENDING for 04-04's manual verify (fall back to X if a conflict surfaces)."

requirements-completed: [TRN-04]

# Metrics
duration: 8min
completed: 2026-06-18
---

# Phase 4 Plan 03: Time-bounded TranscriptBuffer + Clear-Transcript Chord Summary

**Built the main-owned, time-bounded rolling `TranscriptBuffer` (TRN-04, D-06) with three independent hard memory bounds and an injected clock, and registered the clear-transcript `Ctrl+Alt+K` chord (D-07) through the existing `HotkeyRegistrarService` with no registrar-logic changes — both fully unit-tested, to be wired together in 04-04.**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-06-18T00:22:20Z
- **Completed:** 2026-06-18T00:31:00Z
- **Tasks:** 2 (Task 1 TDD: RED→GREEN; Task 2 chord + tests)
- **Files modified:** 4 (2 created, 2 modified)

## Accomplishments
- **`TranscriptBuffer` (TRN-04)** — main-owned, time-bounded (90s window), with two further clock-independent hard ceilings (400 segments, 20,000 chars) so the buffer can never grow unbounded even if the clock freezes or regresses (T-4-06 mitigation). `appendFinal` commits + clears interim + prunes; `setInterim` replaces (never accumulates); `clear()` empties; `recentSince(ms)` exposes the time-based span Phase 5's AI reads; `renderable()` returns `{ finalText, interimText }` for the 04-04 overlay push. Clock injected for deterministic tests (8/8 green).
- **clear-transcript chord (D-07)** — one new `discrete` `IHotkeyChord` (`Ctrl+Alt+K`) added to `HOTKEY_CHORDS`. No changes to `bindViaUiohook`/`dispatchUiohookKeydown`/`bindViaGlobalShortcut`/`register`; the generic iteration binds it and `register().failed` surfaces a missing handler (CTL-03) automatically; `HOTKEY_ACTION_LABELS` picks it up.
- **Full suite green:** 52/52 tests, `tsc --noEmit` clean.

## Task Commits

1. **Task 1: Time-bounded TranscriptBuffer (TRN-04)** — `da96a1c` (test, RED) → `4a12588` (feat, GREEN)
2. **Task 2: clear-transcript Ctrl+Alt+K chord (D-07)** — `048fc01` (feat)

**Plan metadata:** committed with this SUMMARY (docs: complete plan)

## Files Created/Modified
- `src/main/stt/transcript-buffer.ts` — `TranscriptBuffer` (appendFinal/setInterim/clear/recentSince/renderable), `ITranscriptSegment`, and exported `WINDOW_MS`/`MAX_SEGMENTS`/`MAX_TOTAL_CHARS` bounds; injected clock; private `prune` enforcing the three bounds in order.
- `src/main/stt/transcript-buffer.test.ts` — 8 tests: prune-by-time (drop + keep), segment ceiling, char ceiling, interim replaced, appendFinal clears interim, clear() empties, recentSince() window. Fake clock throughout.
- `src/main/hotkey-registrar.service.ts` — one `clear-transcript` chord entry (no other changes).
- `src/main/hotkey-registrar.service.test.ts` — `K` added to KEYCODE map + `UiohookKey` mock; fire-once-per-press test; missing-handler-in-`failed` test.

## Decisions Made
- **WINDOW_MS = 90_000 (90s)** — >= Phase 5's ~60s recent-span plus headroom (A7/D-06).
- **MAX_SEGMENTS = 400, MAX_TOTAL_CHARS = 20_000** — the two clock-independent hard memory ceilings; together with the time window they are the D-06 memory ceiling and the T-4-06 DoS mitigation.
- **Chord letter finalized as K (Ctrl+Alt+K), kind `discrete`** — outside the locked set {J, arrows, [, ], H, Q}; fires once per press. The plan's tests/source ship K; the on-machine conflict re-check vs Teams/Zoom/VS Code is **still pending for 04-04's manual verify** (fall back to X and update the array + cheat-sheet if a conflict is found).
- Followed RESEARCH Pattern 3 exactly (constants, segment shape, prune order, interim-replacement anti-pattern avoidance).

## Deviations from Plan
None — both tasks executed exactly as written. No bugs, missing functionality, or blocking issues encountered.

## Issues Encountered
None.

## Known Stubs
None. `TranscriptBuffer` is fully implemented and tested. The clear-transcript chord is fully registered; its handler (`transcriptBuffer.clear()`) is intentionally added in `index.ts` in 04-04 per the plan — a missing handler is surfaced in `register().failed` (CTL-03), not a silent stub.

## Threat Flags
None beyond the plan's existing threat register. T-4-06 (TranscriptBuffer unbounded growth) is mitigated as planned by the three independent bounds. T-4-07 (new hotkey collision/consumption) reuses the proven passive uiohook non-consumption (CTL-02) and `register()`-result HUD surfacing (CTL-03); the on-machine collision re-check is correctly deferred to 04-04's manual verify per D-07.

## Next Phase Readiness
- **04-04 (bootstrap wiring):** ready. Wire `buildHandlers` so `clear-transcript` → `transcriptBuffer.clear()`; instantiate `TranscriptBuffer` in `index.ts`; feed `ISttProvider` `transcript` events to `appendFinal`/`setInterim`; push `renderable()` over the transcript channel. **MUST during 04-04 manual verify:** re-run the Phase 2 conflict test for `Ctrl+Alt+K` vs Teams/Zoom/VS Code and add the cheat-sheet row in `DebugHud`; fall back to `X` if it collides.
- **Phase 5 (AIOrchestrator):** `recentSince(ms)` is the time-based span read; ~60s sits comfortably inside the 90s window.
- No blockers.

## Self-Check: PASSED

- FOUND: src/main/stt/transcript-buffer.ts
- FOUND: src/main/stt/transcript-buffer.test.ts
- FOUND: src/main/hotkey-registrar.service.ts (clear-transcript entry)
- FOUND commit: da96a1c (Task 1 RED)
- FOUND commit: 4a12588 (Task 1 GREEN)
- FOUND commit: 048fc01 (Task 2 chord)
- Tests: 8/8 transcript-buffer; 9/9 hotkey-registrar; full suite 52/52; tsc --noEmit clean.

---
*Phase: 04-stt-pipeline-live-transcript*
*Completed: 2026-06-18*
