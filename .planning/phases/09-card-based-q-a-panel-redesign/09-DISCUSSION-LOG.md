# Phase 9: Card-Based Q/A Panel Redesign - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-06
**Phase:** 9-Card-Based Q/A Panel Redesign
**Areas discussed:** Card visual design, People list placement, Interim live line, Scroll / density / empty state

---

## Card visual design — Question vs Statement distinction

| Option | Description | Selected |
|--------|-------------|----------|
| Colored left accent bar | Same card, only a colored left stripe distinguishes questions | |
| Accent + tinted background | Left accent AND a tinted/brighter card background for questions; statements flat | ✓ |
| Icon/badge marker | A `?` badge in the header marks questions; card body identical | |

**User's choice:** Accent + tinted background
**Notes:** Question cards should pop hard against the dark translucent panel; statements recede. → CONTEXT D-01.

---

## Card visual design — Header label + speaker identity

| Option | Description | Selected |
|--------|-------------|----------|
| Per-speaker color + 'Speaker' label | Stable per-speaker color chips; undiarized reads `Q1 - Speaker` in neutral grey, kept out of people list | ✓ |
| Per-speaker color, hide undiarized number | Color chips, but undiarized drops speaker segment (just `Q1`) | |
| No speaker color, plain label | Plain-text speaker names; undiarized `Q1 - Speaker` grey | |

**User's choice:** Per-speaker color + 'Speaker' label
**Notes:** Speakers trackable at a glance via a stable color per `Person N`. Undiarized turns stay neutral grey and out of the numbered list (matches Phase 8 D-04). → CONTEXT D-03/D-04/D-05.

---

## People list placement

| Option | Description | Selected |
|--------|-------------|----------|
| Pinned header row, colored chips | Top row of colored chips (color legend doubles as people list); undiarized excluded | |
| Pinned header, chips + counts | Same top row, each chip shows utterance count `Person 1 (12)` | ✓ |
| Footer strip | Same chips pinned at panel bottom instead of top | |

**User's choice:** Pinned header, chips + counts
**Notes:** Pinned at top, colored chips (matching card header colors) with per-speaker utterance counts. → CONTEXT D-06/D-07/D-08.

---

## Interim live line

| Option | Description | Selected |
|--------|-------------|----------|
| Dimmed line pinned below last card | Single dimmed/italic live line, no frame, no label | |
| Ghost card placeholder | Faint/dashed card frame that solidifies into the real card on finalize | ✓ |
| Dimmed line, no auto-clear | Dimmed line that persists (dimmed) rather than blanking on quiet | |

**User's choice:** Ghost card placeholder
**Notes:** The interim should feel like the next card materializing — one continuous turn, card-consistent. Must preserve the recent grey-line-shrink fix (HEAD 87fbd19) so it doesn't flicker to empty. → CONTEXT D-09/D-10.

---

## Scroll / density / empty state — Density & timestamps

| Option | Description | Selected |
|--------|-------------|----------|
| Compact, no timestamps | Tight spacing, max cards visible, no time | |
| Compact, with relative time | Tight spacing + renderer-stamped timestamp per card | |
| Roomy, no timestamps | Generous spacing, easier reading, no time | ✓ |

**User's choice:** Roomy, no timestamps
**Notes:** Readability over density. Timestamps declined (no time field in `IUtteranceEvent`; deferred). → CONTEXT D-11 + Deferred.

---

## Scroll / density / empty state — Empty state

| Option | Description | Selected |
|--------|-------------|----------|
| Muted placeholder text | Dimmed "Listening…" hint; people row hidden until first speaker | ✓ |
| Connection-aware placeholder | Placeholder reflects STT connectionState (Connecting/Listening/Disconnected) | |
| Blank | Show nothing until the first card | |

**User's choice:** Muted placeholder text
**Notes:** Reassure the user the panel is live without coupling the empty state to connection detail. → CONTEXT D-12.

---

## Claude's Discretion

- Exact color palette for per-speaker accents and the question tint/accent (must read well on the dark translucent overlay; question tint distinguishable from speaker chip colors).
- Whether sequence numbers + counts are computed inline in render or via a memoized helper (must derive purely from the `utterances` array).
- Exact ghost-card styling treatment (dashed vs low-opacity solid).
- Whether the panel keeps its own accumulated array or renders directly from the pushed session-scoped `utterances` array (confirm against `pushTranscript` at plan time).

## Deferred Ideas

- **Per-card timestamps** — declined for this phase; `IUtteranceEvent` has no time field. Candidate for a later HUD/polish pass (relates to todo 260618-hud-session-date-and-duration-timer).
- **260618-scrollbar-disappears-history-unreachable** (reviewed, not folded) — cross-cutting AI+transcript scroll-affordance bug; the transcript-panel side may be verified during planning, but the AI-panel fix stays separate.
