---
phase: 11-auto-answer-trigger
plan: 02
subsystem: renderer
tags: [electron, renderer, ai-panel, auto-answer, badge, react]

# Dependency graph
requires:
  - phase: 11-auto-answer-trigger
    plan: 01
    provides: source field on the thinking IAiPushEvent push (main-side half) + RequestSource type mirrored onto the preload/renderer IAiPushEvent duplicates
  - phase: 05-ai-orchestration
    provides: the always-on AiPanel, the jedi:ai push chain, the streaming reduceEntries render path
provides:
  - Renderer auto badge (D-04) — an auto-answer entry renders a tiny "auto" tag next to the mode label; a manual entry renders none
  - source carried onto IAiPanelEntry so the panel entry knows its lane
affects: [phase-12-off-directed-mode]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Additive-only badge: source annotation renders inside the existing entry header (mode+badge grouped left via an inline-flex label wrapper, time right) so the space-between header layout is unchanged (SC 3)"

key-files:
  created: []
  modified:
    - src/renderer/src/components/ai-panel.tsx
    - src/renderer/src/assets/hud.css

key-decisions:
  - "D-04 render: badge is a short text tag ('auto') gated strictly on entry.source === 'auto'; manual entries render no badge (absence IS the manual state)."
  - "Empty (D-11 placeholder) entries default source to 'manual' in reduceEntries so the type is satisfied and they never render an auto badge."
  - "Wrapped mode label + badge in an inline-flex ai-panel__entry-label so the header's space-between (mode-left / time-right) layout is preserved — the badge sits beside the mode, not spread apart."

patterns-established:
  - "Lane-discriminator badge derived solely from source: 'manual' | 'auto' — renders no transcript text and no secret (T-11-07 mitigation)."

requirements-completed: [AA-01, AA-02]

# Metrics
duration: 6min
completed: 2026-07-07
---

# Phase 11 Plan 02: Auto-Answer Badge (Renderer Side) Summary

**Auto-answer entries now show a tiny "auto" badge in the EXISTING AI panel next to the mode label; manual entries render exactly as before — same panel, same jedi:ai push, same streaming render, just annotated (SC 3 preserved).**

## Performance

- **Duration:** ~6 min
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Carried `source: RequestSource` onto the local `IAiPanelEntry` and set `source: event.source` on the new entry in the `reduceEntries` `thinking` branch, so each rendered entry carries its lane (D-04). Empty (D-11) placeholders default to `'manual'` so they never badge.
- Rendered a tiny conditional `auto` badge (`data-testid="icon-auto-badge"`) in the entry header, gated strictly on `entry.source === 'auto'`. A `'manual'` entry renders no badge.
- Preserved SC 3: the badge is additive-only next to the existing mode label. `renderEntryBody`, the streaming delta/done/error paths, the list/scroll refs, and the panel structure are untouched. The header's `space-between` layout is kept by grouping mode + badge in an inline-flex `ai-panel__entry-label` wrapper so the relative-time span stays right-aligned.
- Added minimal `ai-panel__entry-badge` + `ai-panel__entry-label` CSS (a small uppercased inline tag) so the badge is visible without shifting layout.

## Task Commits

Each task was committed atomically:

1. **Task 1: carry source onto the AI panel entry (D-04)** - `6db8203` (feat)
2. **Task 2: render tiny auto badge on auto-answer entries (D-04)** - `1ff219b` (feat)

## Files Created/Modified
- `src/renderer/src/components/ai-panel.tsx` - Added `source: RequestSource` to `IAiPanelEntry`; set `source: event.source` in the `reduceEntries` `thinking` branch and `source: 'manual'` in the `empty` branch; rendered the conditional `auto` badge (with an `ai-panel__entry-label` wrapper around mode + badge) in the entry header.
- `src/renderer/src/assets/hud.css` - Added `.ai-panel__entry-label` (inline-flex wrapper) and `.ai-panel__entry-badge` (tiny uppercased inline tag) styling.

## Decisions Made
- The three-way structural `IAiPushEvent` duplicate already carried `source` on the `thinking` variant in preload and renderer — Plan 01 added it to all three copies as a blocking typecheck fix (documented in 11-01-SUMMARY.md, commit `720a0e9`). This plan therefore did NOT re-edit the preload `IAiPushEvent` union or the renderer union; the remaining renderer work was purely `IAiPanelEntry` + `reduceEntries` + the badge render. Task 1's "add source to the union" action was already satisfied upstream; the acceptance criteria (union carries source, entry carries source, reduceEntries sets source) are all met.
- Grouped the mode label and badge in an inline-flex `ai-panel__entry-label` so the header's existing `justify-content: space-between` (mode-left / time-right) is preserved rather than spreading three items — keeps "no layout change" literal.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Preload + renderer `IAiPushEvent` union `source` field already present**
- **Found during:** Task 1 (mirror source onto the preload + renderer thinking variant)
- **Issue:** The plan's Task 1 action instructs adding `source: RequestSource` + a `RequestSource` type to the preload and renderer `IAiPushEvent` unions. Reading both files showed Plan 01 had already added these (preload `RequestSource` at line 95 + `source` on the thinking variant at line 104; renderer `RequestSource` at line 11 + `source` on the thinking variant at line 18) as a documented blocking typecheck fix (11-01-SUMMARY.md).
- **Fix:** No edit needed on the union types or the `RequestSource` declarations — they were already correct and structurally identical to main. Only the still-missing renderer pieces were implemented: `source` on `IAiPanelEntry` and `source: event.source` in `reduceEntries`.
- **Files modified:** src/renderer/src/components/ai-panel.tsx (entry + reducer only; the preload file was not modified in this plan)
- **Verification:** `npm run typecheck` exits 0 (both node + web); the three `IAiPushEvent` copies stay aligned.
- **Committed in:** `6db8203` (Task 1)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** No scope change. The union mirror was already done upstream by Plan 01; the acceptance criteria are still fully satisfied (unions carry `source`, entry carries `source`, reducer sets it). `src/preload/index.ts` was consequently not re-committed in this plan — its `source` field landed in Plan 01's commit `720a0e9`.

## Threat Surface
- T-11-06 (no new control channel): honored — no new IPC channel, no renderer→main write. The renderer stays a pure view of the one-way `jedi:ai` push (IN-01).
- T-11-07 (badge leaking content): honored — the badge is derived solely from `source: 'manual' | 'auto'`; it renders no transcript text and no secret.
- T-11-08 (auto/manual conflation breaking SC 3): honored — the badge is additive-only next to the existing mode label; `renderEntryBody`, the delta/done/error paths, and the scroll refs are untouched (grep-confirmed).

## Known Stubs
None — the badge is fully wired: `source` is pushed by main (Plan 01), carried onto the entry, and rendered conditionally.

## Verification
- `npm run typecheck` exits 0 (both node + web projects; three `IAiPushEvent` copies structurally aligned).
- `npm run lint` exits 0 (warnings only, all in the pre-existing `ai-orchestrator.test.ts` from Plan 01 — out of scope; zero in the edited files).
- Full suite: 218/218 tests green (24 files).
- grep-confirmed: badge renders on `entry.source === 'auto'`; `renderEntryBody` and the list/scroll refs unchanged.

## Self-Check: PASSED

- Files verified present: 11-02-SUMMARY.md, src/renderer/src/components/ai-panel.tsx, src/renderer/src/assets/hud.css
- Commits verified: 6db8203, 1ff219b
- Typecheck 0, lint 0, 218/218 tests green

---
*Phase: 11-auto-answer-trigger*
*Completed: 2026-07-07*
