# Phase 9: Card-Based Q/A Panel Redesign - Context

**Gathered:** 2026-07-06
**Status:** Ready for planning

<domain>
## Phase Boundary

Rebuild the Q/A panel (`src/renderer/src/components/transcript-panel.tsx`, the LEFT column of the 4-panel overlay row) IN PLACE: replace the single flat `finalLog`/`interimText` text blob with a scrollable stack of per-utterance cards — each labeled `Q1 - Person 1` / `S3 - Person 2`, questions visually distinct from statements — plus a compact people list of identified speakers.

The panel consumes the **already-shipped** Phase 8 structured stream: `IOverlayTranscript.utterances: IUtteranceEvent[]` (committed, speaker-attributed, classified turns) arrives on the SAME read-only `window.jedi.onTranscript` bridge, alongside the existing `interimText` (the live in-progress line). No new data channel is needed; Phase 8 landed the data additively.

**In scope:** QA-04 (per-utterance cards labeled sequence+speaker), QA-05 (Questions visually distinct), QA-06 (compact people list). Rendering only — the renderer-side view over the existing one-way channel.

**Out of scope:** the data layer (done in Phase 8 — diarization, `Person N` map, Q/S classification, the seam). No changes to `IUtteranceEvent`, the STT seam, or the main-process utterance/speaker-map logic. No new renderer→main control surface (IN-01). Mic capture, timestamps in the data model, and live ticket-fetching remain out (milestone-level deferrals).
</domain>

<decisions>
## Implementation Decisions

### Card visual design — Q vs S distinction (QA-04, QA-05)
- **D-01:** Question cards are distinct via **accent + tinted background**: a colored left accent stripe AND a subtly brighter/tinted card background so questions pop against the dark translucent panel. Statement cards stay neutral/flat (no accent, dimmer background). This is the primary "questions stand out at a glance" mechanism (QA-05).
- **D-02:** Card anatomy follows the existing `ai-panel__entry` pattern (header row + body): a header line with the label (`Q1 - Person 1`) and a body with the utterance text. Reuse that card's structure/CSS conventions rather than inventing a new one.

### Card header — label format & speaker identity (QA-04)
- **D-03:** Header label format is `{seq} - {speaker}` → `Q1 - Person 1`, `S3 - Person 2` (per roadmap). The `Q`/`S` prefix comes from `classification`; the number is a **per-type, session-scoped sequence** (Q1, Q2… independent of S1, S2…) **derived in the panel** from the utterance list order (Phase 8 emits classification + speaker on every finalized utterance but no sequence number — the consumer counts).
- **D-04:** Each numbered speaker (`Person 1`, `Person 2`, …) gets a **stable per-speaker accent color** on their name chip in the card header, so a speaker is trackable at a glance across cards. The color is assigned deterministically from the `Person N` number (stable for the session).
- **D-05:** Undiarized turns (Phase 8 `isDiarized === false`, neutral `'Speaker'` bucket, D-04 of Phase 8) render their label as `Q1 - Speaker` / `S3 - Speaker` in a **neutral grey** (no per-speaker color) and are kept OUT of the numbered people list (mirrors Phase 8 D-04 — do not invent a Person).

### People list (QA-06)
- **D-06:** The people list is a **compact row pinned at the TOP of the panel** (below the `Q/A` title, above the scrolling card body) — always visible while cards scroll. It renders each identified speaker as a small colored **chip in that speaker's accent color** (D-04), so the row doubles as the color legend.
- **D-07:** Each chip shows the speaker's **utterance count**: `Person 1 (12)  Person 2 (5)`. Counts derived in the panel from the utterance list. The `'Speaker'` (undiarized) bucket is NOT listed (D-05 / Phase 8 D-04).
- **D-08:** The people list updates as new `Person N` appear in the incoming utterance stream (derived from the same `utterances` array each render).

### Interim / live line (D-02 of Phase 8)
- **D-09:** The in-progress (not-yet-finalized) utterance — arriving as `interimText`, with no speaker/classification — renders as a **faint "ghost" card placeholder** at the BOTTOM of the card stack: low-opacity / dashed-border card frame, no label, no Q/S accent. When Deepgram finalizes the turn, the ghost is replaced by the real labeled+classified card. This keeps the stack visually card-consistent while reading clearly as "still forming."
- **D-10:** Interim is **replaced in place, never accumulated** (mirrors the existing `TranscriptBuffer.setInterim` discipline and the current panel's interim handling). The recent grey-line-shrink fix (HEAD `87fbd19`, re-surfacing the accumulated turn as interim) must be preserved in behavior: the ghost card should not flicker/shrink to empty between interim updates within a single turn.

### Scroll / density / empty state
- **D-11:** Card density is **roomy** — generous padding/spacing between cards for readability, fewer cards visible at once (over maximizing count). No per-card timestamps (`IUtteranceEvent` carries no time field; adding renderer-side timestamps is explicitly out of scope for this phase).
- **D-12:** Empty state (session start, or after Ctrl+Alt+K clears): show a **muted centered placeholder** (e.g. "Listening…" / "Waiting for speech") in the card body, with the pinned people row empty/hidden until the first `Person N` appears. Reassures the user the panel is live.
- **D-13:** Preserve ALL existing overlay affordances and seams on the redesigned panel (roadmap Success Criteria 4 & 5): keep `data-testid="card-transcript-panel"`, the active-panel indicator (`icon-active-panel-transcript`), and the shared Ctrl+Alt+PgUp/PgDn scroll routing gated on `activePanel === 'transcript'` (`onScrollTranscript`). Ctrl+Alt+K still clears cards + people list (the existing empty-push reset path). New testable elements get `data-testid` with `card-` / `row-` / `list-` prefixes. Overlay stays click-through and never takes focus; the panel remains a pure one-way view (IN-01) — NO new renderer→main channel.

### Claude's Discretion
- Exact palette / hue set for per-speaker accent colors (D-04) and the question tint/accent (D-01) — pick values that read well on the dark translucent overlay; ensure question tint is distinguishable from any speaker chip color.
- Whether the per-type sequence + per-speaker counts are computed inline in render or via a small memoized helper — implementation detail, as long as they derive purely from the `utterances` array (no new state channel).
- Exact ghost-card styling treatment (dashed vs low-opacity solid) for D-09, as long as it reads as "forming, unlabeled" and solidifies cleanly on finalize.
- Whether the full-session card list needs the panel to keep its own accumulated array or can render directly from the pushed `utterances` array (Phase 8 pushes the full session-scoped list each update — likely render directly; confirm at plan/research time against `pushTranscript` behavior in `index.ts`).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Milestone & requirements
- `.planning/PROJECT.md` §Current Milestone v1.1 — the structured-Q/A goal and the card-label target (`Q1 - Person 1`); §Constraints (focus discipline, keyboard-only, one-way view).
- `.planning/REQUIREMENTS.md` §Milestone v1.1 — QA-04, QA-05, QA-06 (this phase's requirements) and QA-07 (seam — already satisfied by Phase 8, must not be violated).
- `.planning/ROADMAP.md` §Phase 9 — goal, the 5 Success Criteria, and the Notes block (IN-PLACE redesign, keep data-testid seams, per-type sequence numbering, interim handling, IDEXX frontend conventions).

### Prior-phase context (the data contract this phase consumes)
- `.planning/phases/08-diarized-utterance-pipeline/08-CONTEXT.md` — the Phase 8 decisions that DEFINE the incoming stream: D-01 (one card per finalized utterance), D-02 (interim = live unclassified in-progress line, replaced not accumulated), D-03 (first-seen `Person N` assignment), D-04 (undiarized → neutral `'Speaker'`, out of the numbered list), D-06/07/08 (Q/S classification, default Statement).

### Code to rebuild (the panel + the data it receives)
- `src/renderer/src/components/transcript-panel.tsx` — the panel being rebuilt IN PLACE. Currently renders flat `finalLog` + `interimText`; keep the subscription wiring (`onTranscript`, `onStatus`, `onScrollTranscript`), the active-panel routing (D-08 scroll gate), the empty-push clear reset, and the `card-transcript-panel` / active-indicator seams. Replace the flat text body with the card stack + people row.
- `src/main/stt/stt-provider.interface.ts` — the `IUtteranceEvent { text, speaker, isDiarized, classification }` + `UtteranceClassification` contract the cards render. READ-ONLY for this phase (do not modify the seam).
- `src/main/overlay-window.manager.ts` (§`IOverlayTranscript`, ~line 90–110) — the bridge payload: `finalText`, `interimText`, `connectionState`, `audioLevel`, and the Phase-8-added `utterances: IUtteranceEvent[]`. The renderer must mirror this extended shape locally (the panel's local `IOverlayTranscript` interface currently lacks `utterances` — add it).
- `src/main/index.ts` (§`pushTranscript` calls, ~line 133/270/350/359) — how/when `utterances` is pushed (grows on each committed turn; emptied in place on Ctrl+Alt+K). Confirms the panel receives the full session-scoped utterance list each push.

### Styling & sibling patterns
- `src/renderer/src/assets/hud.css` (~line 203–410) — the panel/card styles. `.ai-panel__entry` / `__entry-header` / `__entry-mode` / `__entry-body` (line ~343–407) is the closest reusable card pattern (D-02). The existing `.transcript-panel__*` rules (title, active-indicator, body scroll, `__final`/`__interim`) are the ones being reworked. NOTE: this app uses a single global `hud.css`, not SCSS modules — the IDEXX "no inline `style` prop" rule still applies (all styling via CSS classes + `data-testid`).
- `src/renderer/src/components/panel-labels.ts` — `PANEL_LABEL` + `ActivePanel` type used for the title and active-panel routing.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`ai-panel.tsx` + `.ai-panel__entry*` CSS**: the sibling AI panel already renders a stack of cards (rounded translucent box, header row with a mode tag + time, body text, internal scroll, custom scrollbar). This is the direct visual/structural analog for the Q/A cards (D-02) — copy its card anatomy and scrollbar treatment.
- **`transcript-panel.tsx` subscription + reconciliation scaffolding**: the `onTranscript`/`onStatus`/`onScrollTranscript` wiring, the active-panel ref pattern (`activePanelRef`), the stick-to-bottom auto-follow, and the empty-push clear reset are all reusable — only the render body and the data it reads (flat text → `utterances` array + `interimText`) change. `reconcileFinalLog` (the flat-text overlap-dedup) is likely REMOVED, since cards render directly from the structured `utterances` array rather than reconciling a rolling flat snapshot.
- **`IUtteranceEvent`** (Phase 8): the per-card data — `text`, `speaker` (`'Person N'` or `'Speaker'`), `isDiarized`, `classification` (`'question' | 'statement'`). Everything a card needs except the derived sequence number and speaker color (both computed in the panel).

### Established Patterns
- **Pure one-way view (IN-01)**: the panel only subscribes to read-only channels; it never opens a renderer→main control channel. The redesign must stay one-way (roadmap SC 5).
- **Interim replaced, never accumulated** (Phase 8 D-02, current `setInterim` discipline): the ghost card (D-09) follows this — one live in-progress item, replaced each interim update, resolved on finalize.
- **`data-testid` on testable elements** (`card-`, `row-`, `list-` prefixes per roadmap Notes + IDEXX naming): new cards, the people row, and the people chips get testids for the panel's existing test coverage to extend.
- **Hotkey-driven scroll gated on active panel** (`activePanel === 'transcript'`): the card stack must remain keyboard-scrollable via the shared channel; preserve the gate (D-13).

### Integration Points
- Main pushes `IOverlayTranscript { finalText, interimText, connectionState, audioLevel, utterances }` on `onTranscript` → panel derives (a) card list from `utterances` (with per-type sequence + per-speaker color), (b) people row from the distinct `Person N` in `utterances` + counts, (c) ghost card from `interimText`.
- Ctrl+Alt+K → main empties the utterance list + pushes empty `finalText`/`interimText` (and empty `utterances`) → panel resets cards + people list (extend the existing empty-push reset).
- `onScrollTranscript` (gated on active panel) scrolls the card body; `onStatus` drives the active-panel highlight. Both preserved unchanged.

</code_context>

<specifics>
## Specific Ideas

- **Card label format is exact:** `Q1 - Person 1`, `S3 - Person 2` (space-hyphen-space). Undiarized: `Q1 - Speaker`.
- **People row example:** `Person 1 (12)  Person 2 (5)` as colored chips pinned at the panel top; chip color === that speaker's card-header name color (one color system, used in both places).
- **Question emphasis is deliberate** — questions are the high-value signal; the accent+tint (D-01) plus the `Q`-prefixed label should make a question card unmistakable at a glance while statements recede.
- **Ghost card is a "forming" affordance** — it should feel like the next card materializing, not a separate UI element, so the transition interim→committed reads as one continuous turn.

</specifics>

<deferred>
## Deferred Ideas

- **Per-card timestamps** — raised as a density option, declined for this phase (`IUtteranceEvent` has no time field; renderer-side stamping is a separate small feature). Candidate for a later HUD/polish pass — relates to pending todo `260618-hud-session-date-and-duration-timer`.

### Reviewed Todos (not folded)
- **260618-scrollbar-disappears-history-unreachable** (area: renderer/overlay, relates_to_phase 5) — a cross-cutting scroll-affordance bug across the AI + transcript panels, flagged in Phase 8's reviewed todos as "a Phase 9 candidate at best." NOT explicitly folded in this discussion; the scroll routing / stick-to-bottom behavior is being preserved (D-13), but the AI-panel side of that bug is out of this panel's scope. Planner may verify the transcript-panel scrollbar remains reachable after the card redesign; the AI-panel fix stays separate.

</deferred>

---

*Phase: 9-Card-Based Q/A Panel Redesign*
*Context gathered: 2026-07-06*
