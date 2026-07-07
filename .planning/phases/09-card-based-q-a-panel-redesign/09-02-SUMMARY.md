---
phase: 09-card-based-q-a-panel-redesign
plan: 02
subsystem: ui
tags: [react, electron, transcript-panel, diarization, people-row, ghost-card, hud-css]

# Dependency graph
requires:
  - phase: 09-card-based-q-a-panel-redesign
    plan: "01"
    provides: "utterance-view.utility.ts (deriveCardRows + personAccentColor), the card-stack transcript-panel.tsx, and the per-speaker [data-speaker-color] CSS"
provides:
  - "utterance-view.utility.ts: pure derivePeople derivation (distinct Person N + counts + personAccentColor, 'Speaker' excluded, first-appearance order)"
  - "transcript-panel.tsx: pinned people row (counted colored chips = color legend), interim ghost card (replaced-not-accumulated), and empty-state 'Listening…' placeholder — all derived from the same pushed utterances + interimText"
  - "hud.css people-row/person-chip, ghost-card, and placeholder classes"
affects: [card-based-q-a-panel-redesign, transcript-panel]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "People list derived per-render by a pure DOM-free utility (derivePeople) reusing personAccentColor so the row IS the card color legend; no panel-side accumulator"
    - "Single interimText state drives one trailing ghost card (replaced in place, never a second interim state) so the forming turn never flickers/shrinks mid-turn (preserves HEAD 87fbd19 behavior)"
    - "Empty-state placeholder + hidden people row fall out of the existing empty-push reset (utterances -> [], interimText -> '') with no extra reset code"

key-files:
  created: []
  modified:
    - src/renderer/src/components/utterance-view.utility.ts
    - src/renderer/src/components/utterance-view.utility.test.ts
    - src/renderer/src/components/transcript-panel.tsx
    - src/renderer/src/assets/hud.css

key-decisions:
  - "09-02: derivePeople returns IPersonSummary { speaker, count, color } keyed by a first-appearance-ordered Map; isDiarized:false ('Speaker') utterances are skipped (D-05/D-07); color === personAccentColor(speaker) so the pinned row doubles as the color legend (D-06)."
  - "09-02: One trailing ghost card driven by the single interimText state (no second interim state, not keyed to remount) preserves the HEAD 87fbd19 no-flicker behavior; the old plain transcript-panel__interim span was removed in favor of the ghost card (D-09/D-10)."
  - "09-02: People row hidden when derivePeople is empty and a muted centered 'Listening…' placeholder shows when deriveCardRows AND interimText are both empty; both fall out of the existing empty-push reset (D-12), no new reset code, no new renderer->main channel (IN-01)."

patterns-established:
  - "Pattern: the pinned people row is a pure per-render derivation of the same utterances array (no accumulator), and its chip color is the shared per-speaker color legend"
  - "Pattern: forming-turn ghost card is a single-state view of interimText, replaced-not-accumulated, distinct from committed cards (dashed/faint, no label, no Q/S accent)"

requirements-completed: [QA-05, QA-06]

# Metrics
duration: ~30min
completed: 2026-07-07
---

# Phase 9 Plan 02: People Row, Interim Ghost Card, and Empty-State Placeholder Summary

**The Q/A panel now pins a compact people row of counted colored chips (`Person 1 (12)  Person 2 (5)`) that doubles as the per-speaker color legend, renders the in-progress turn as a faint unlabeled ghost card that resolves cleanly into a real card on finalize, and shows a muted "Listening…" placeholder when the session is empty — completing the card-based redesign (QA-05 + QA-06).**

## Performance

- **Duration:** ~30 min (across original session + this continuation)
- **Completed:** 2026-07-07
- **Tasks:** 3 (2 auto — one TDD — + 1 blocking human-verify checkpoint)
- **Files modified:** 4

## Accomplishments

- `utterance-view.utility.ts`: added pure `derivePeople(utterances): IPersonSummary[]` — distinct numbered speakers in first-appearance order with per-speaker utterance counts, the undiarized `'Speaker'` bucket excluded (D-05/D-07), each carrying `personAccentColor(speaker)` so the people row is the shared color legend (D-06). DOM-free, main-import-free.
- `utterance-view.utility.test.ts`: extended with 5 new AAA tests (empty input, first-appearance ordering with counts, `'Speaker'` excluded, Q+S both tally the same person, color === `personAccentColor`) — 13 total tests, the 8 prior 09-01 card-row tests stay green.
- `transcript-panel.tsx`: added three render elements over the already-subscribed `utterances` + `interimText` (no new subscription, no new channel):
  - **People row (QA-06/D-06/D-07/D-08):** `data-testid="list-people"` pinned between the title and the scroll body; each person a `row-person-{n}` chip carrying `data-speaker-color` and the exact `${speaker} (${count})` text; hidden when `derivePeople` returns empty (D-12).
  - **Interim ghost card (D-09/D-10):** one trailing `row-utterance-interim` article, no label / no Q/S accent, driven by the single `interimText` state (replaced-not-accumulated, no flicker within a turn — preserves HEAD 87fbd19). The old plain `transcript-panel__interim` span was removed.
  - **Empty-state placeholder (D-12):** muted centered `cell-transcript-placeholder` "Listening…" shown only when both `deriveCardRows(utterances)` and `interimText` are empty.
- `hud.css`: added `.transcript-panel__people` (compact wrap flex row, `flex:0 0 auto`, pinned above the scrolling body), `.transcript-panel__person-chip` (rounded pill reusing the per-speaker accent hues), `.transcript-panel__card--ghost` (dashed/low-opacity, no accent stripe/tint), and `.transcript-panel__placeholder` (muted-italic centered, cloned from `.vision-panel__placeholder`).
- All D-13 seams preserved (`card-transcript-panel`, `icon-active-panel-transcript`, `card-transcript` scroll target, active-panel scroll gate, stick-to-bottom follow on `[utterances, interimText]`); no new renderer→main channel (IN-01); no inline style, no `dangerouslySetInnerHTML` (T-09-04/T-09-05).
- **QA-06 met** (compact people list of counted colored chips, updating as new Person N appear, `'Speaker'` excluded). **QA-05 fully met** (question distinction from 09-01 reinforced by the shared per-speaker color legend in the people row).

## Task Commits

1. **Task 1 (RED): failing tests for derivePeople derivation** — `1478929` (test)
2. **Task 1 (GREEN): pure derivePeople people-list derivation** — `5dd8eb6` (feat)
3. **Task 2: people row, interim ghost card, empty-state placeholder** — `4b3795f` (feat)
4. **Checkpoint pause metadata** — `3a43e3c` (docs)

_Task 3 was a blocking human-verify checkpoint (no code): the user typed **"approved"**, satisfying it._

## Files Modified

- `src/renderer/src/components/utterance-view.utility.ts` — added pure `derivePeople` + `IPersonSummary`
- `src/renderer/src/components/utterance-view.utility.test.ts` — 5 new AAA derivePeople tests (13 total)
- `src/renderer/src/components/transcript-panel.tsx` — people row + interim ghost card + empty-state placeholder; removed old interim span
- `src/renderer/src/assets/hud.css` — people-row / person-chip / ghost-card / placeholder classes

## Decisions Made

See frontmatter `key-decisions`. Core: `derivePeople` is a pure first-appearance-ordered derivation reusing `personAccentColor` (row = color legend, `'Speaker'` excluded); one trailing ghost card driven by the single `interimText` state (no flicker, no second interim state); people-row-hidden and empty placeholder both fall out of the existing empty-push reset with no new reset code and no new IPC channel.

## Deviations from Plan

None — the plan executed exactly as written. No auto-fixes (Rules 1–3) were required; no architectural changes (Rule 4) arose; no authentication gates were hit.

## Issues Encountered

None.

## Automated Verification

- `npx vitest run src/renderer/src/components/utterance-view.utility.test.ts` → **13 passed** (exit 0) — 8 prior card-row tests + 5 new derivePeople tests.
- `npm run typecheck:web` → **passes** (panel + utility typecheck clean).

Both re-confirmed green in this continuation session before writing the summary.

## Checkpoint Result

Task 3 (blocking human-verify): **APPROVED** by the user. The people row (counted colored chips matching card hues, `'Speaker'` excluded, hidden when empty), the interim ghost card (no flicker, resolves cleanly into a labeled card on finalize), and the empty "Listening…" placeholder were confirmed on the live overlay, with all 09-01 affordances (Ctrl+Alt+F focus, Ctrl+Alt+PgUp/PgDn scroll, auto-follow, Ctrl+Alt+K clear, click-through, no focus steal) intact.

## Next Plan Readiness

- This is the final plan of Phase 09; the card-based Q/A panel redesign is complete (QA-04 in 09-01; QA-05 + QA-06 here).
- Phase 09 is now 2/2 plans done. No blockers.

## Self-Check: PASSED

- Modified files present: `utterance-view.utility.ts`, `utterance-view.utility.test.ts`, `transcript-panel.tsx`, `hud.css` — all present.
- Feature commits present in git history: `1478929`, `5dd8eb6`, `4b3795f` — all confirmed via `git log`.

---
*Phase: 09-card-based-q-a-panel-redesign*
*Completed: 2026-07-07*
