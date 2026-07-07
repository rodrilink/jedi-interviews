---
phase: 09-card-based-q-a-panel-redesign
plan: 01
subsystem: ui
tags: [react, electron, transcript-panel, diarization, utterances, hud-css]

# Dependency graph
requires:
  - phase: 08-diarized-utterance-pipeline
    provides: "IUtteranceEvent stream (speaker, isDiarized, classification) pushed session-scoped over the read-only jedi:transcript bridge"
provides:
  - "utterance-view.utility.ts: pure deriveCardRows + personAccentColor derivation (per-type Q/S sequencing, deterministic per-speaker palette-slot tokens)"
  - "transcript-panel.tsx rebuilt in place: renders each committed utterance as a labeled card ({seq} - {speaker}), questions visually distinct from statements"
  - "hud.css card / question-variant / statement-variant / per-speaker-color CSS classes"
affects: [09-02, card-based-q-a-panel-redesign, transcript-panel]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure DOM-free derivation utility (node-vitest env) feeding the panel; palette-slot tokens (p0..p7/neutral) instead of raw CSS colors to keep the utility CSS-free and honor the no-inline-style rule"
    - "Panel renders directly from the pushed session-scoped utterances array (no panel-side accumulator); main empties utterances in place on Ctrl+Alt+K so an empty push resets cards"

key-files:
  created:
    - src/renderer/src/components/utterance-view.utility.ts
    - src/renderer/src/components/utterance-view.utility.test.ts
  modified:
    - src/renderer/src/components/transcript-panel.tsx
    - src/renderer/src/assets/hud.css
    - src/preload/index.ts

key-decisions:
  - "09-01: Card rows derived by a pure DOM-free utility (deriveCardRows) with per-type independent Q/S counters over list order; personAccentColor returns enumerable palette-slot tokens (p0..p7 wrap-by-modulo, neutral for undiarized) so hues live in hud.css [data-speaker-color] rules (inline style forbidden)."
  - "09-01: Panel reads next.utterances directly each push (no accumulator); reconcileFinalLog/finalLog removed; empty-push branch retained to also clear interim/derived state. Question cards get accent stripe + tint, statements stay flat (D-01)."
  - "09-01 deviation: extended the preload IOverlayTranscript TYPE mirror (src/preload/index.ts) with utterances + local IUtteranceEvent/UtteranceClassification mirrors — Phase 8 already pushes utterances at runtime but the preload bridge type mirror was stale (typecheck:web TS2345). No new IPC channel; field rides the existing read-only jedi:transcript push."

patterns-established:
  - "Pattern: per-type session-scoped sequence labels ({prefix}{seq} - {speaker}) derived from list order, not stored per-utterance"
  - "Pattern: per-speaker color as data-speaker-color palette-slot attribute + hud.css rule, never inline style"

requirements-completed: [QA-04]

# Metrics
duration: ~35min
completed: 2026-07-07
---

# Phase 9 Plan 01: Card-Based Q/A Panel (Committed Cards) Summary

**The Q/A panel now renders each committed utterance from the Phase 8 stream as its own labeled card (`Q1 - Person 1` / `S3 - Person 2`), with question cards visually distinct (accent stripe + tint) and each Person N in a stable per-speaker color — the flat finalLog text blob is gone.**

## Performance

- **Duration:** ~35 min (across original session + continuation)
- **Completed:** 2026-07-07
- **Tasks:** 3 (2 auto/TDD + 1 blocking human-verify checkpoint)
- **Files modified/created:** 5

## Accomplishments

- `utterance-view.utility.ts`: pure `deriveCardRows` (per-type Q/S sequencing, exact `{prefix}{seq} - {speaker}` label, per-row `speakerColor`) + `personAccentColor` (deterministic `p0..p7`/`neutral` palette-slot tokens) — DOM-free, main-import-free, 8 passing unit tests.
- `transcript-panel.tsx` rebuilt IN PLACE: renders `deriveCardRows(utterances)` as `<article>` cards labeled by header chip; `reconcileFinalLog`/`finalLogRef`/`finalLog` removed; drives off `next.utterances` directly. All D-13 seams preserved (`card-transcript-panel`, `icon-active-panel-transcript`, `card-transcript` scroll target, active-panel scroll gate, stick-to-bottom follow retargeted to `[utterances, interimText]`).
- `hud.css`: roomy padded `.transcript-panel__card` cloned from `.ai-panel__entry`; `--question` accent stripe + tinted background vs neutral `--statement`; per-speaker `[data-speaker-color='pN']` hues + `[data-speaker-color='neutral']` grey.
- QA-04 met (per-utterance cards labeled `{seq} - {speaker}` with per-type session-scoped sequencing). QA-05 partially met (question cards visually distinct) — completion tracked alongside 09-02.

## Task Commits

1. **Task 1 (RED): failing test for card-row derivation** - `e50f965` (test)
2. **Task 1 (GREEN): pure card-row derivation utility** - `4dd27d1` (feat)
3. **Task 2: render committed utterances as labeled Q/A cards** - `8585c97` (feat)
4. **Checkpoint pause metadata** - `5b09ca0` (docs)

_Task 3 was a blocking human-verify checkpoint (no code): the user typed **"approved"**, satisfying it._

## Files Created/Modified

- `src/renderer/src/components/utterance-view.utility.ts` - pure `deriveCardRows` + `personAccentColor` derivation
- `src/renderer/src/components/utterance-view.utility.test.ts` - 8 AAA unit tests (empty, single question label, per-type sequencing S1/Q1/S2/Q2, undiarized neutral, color stability + distinctness, neutral bucket)
- `src/renderer/src/components/transcript-panel.tsx` - card-stack render body from pushed utterances; reconcileFinalLog removed
- `src/renderer/src/assets/hud.css` - card / question-variant / statement-variant / per-speaker-color classes
- `src/preload/index.ts` - preload IOverlayTranscript type mirror extended with `utterances` + local `IUtteranceEvent`/`UtteranceClassification` (deviation, below)

## Decisions Made

See frontmatter `key-decisions`. Core: pure derivation utility with palette-slot tokens (not raw CSS colors) to satisfy the CSS-free-utility + no-inline-style constraints; panel renders directly from the pushed session-scoped `utterances` array with no accumulator.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Extended the preload IOverlayTranscript type mirror with utterances**
- **Found during:** Task 2 (panel rebuild)
- **Issue:** Phase 8 already pushes `utterances` at runtime, but the preload bridge's `IOverlayTranscript` TYPE mirror (`src/preload/index.ts`) was stale — the panel consuming `next.utterances` failed `npm run typecheck:web` with TS2345.
- **Fix:** Extended the preload's local `IOverlayTranscript` mirror with `utterances: IUtteranceEvent[]` and added local `IUtteranceEvent` / `UtteranceClassification` mirror types (matching the ai-panel/transcript-panel local-mirror convention). No new IPC channel — the field rides the existing read-only `jedi:transcript` push.
- **Files modified:** `src/preload/index.ts`
- **Verification:** `npm run typecheck:web` passes.
- **Committed in:** `8585c97` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking type-mirror sync).
**Impact on plan:** Necessary to typecheck the panel against the runtime payload Phase 8 already emits. No new trust boundary or IPC surface (T-09-02 disposition preserved). No scope creep.

## Issues Encountered

None beyond the deviation above.

## Automated Verification

- `npx vitest run src/renderer/src/components/utterance-view.utility.test.ts` → **8 passed** (exit 0).
- `npm run typecheck:web` → **passes** (panel + utility + preload mirror typecheck clean).

## Checkpoint Result

Task 3 (blocking human-verify): **APPROVED** by the user. Card labels, question distinction, per-speaker color stability, and preserved scroll/clear/focus affordances confirmed on the live overlay.

## Next Plan Readiness

- Committed-card foundation is live; 09-02 adds the interim/ghost card, people list, empty-state placeholder, and completes QA-05 / covers QA-06.
- No blockers.

## Self-Check: PASSED

All created files present; all three feature commits (e50f965, 4dd27d1, 8585c97) present in git history.

---
*Phase: 09-card-based-q-a-panel-redesign*
*Completed: 2026-07-07*
