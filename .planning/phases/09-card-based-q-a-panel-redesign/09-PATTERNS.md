# Phase 9: Card-Based Q/A Panel Redesign - Pattern Map

**Mapped:** 2026-07-06
**Files analyzed:** 3 modified (1 primary rewrite + 1 CSS + 1 local interface), 3 read-only contracts
**Analogs found:** 3 / 3 (all in-repo, strong)

This is an IN-PLACE renderer redesign of a single React component. The primary work file already
exists (`transcript-panel.tsx`) and is both the file-to-modify AND one of its own best analogs (keep
its subscription/scroll/reset scaffolding, replace only the render body + local data shape). The
sibling `ai-panel.tsx` is the DIRECT structural analog for the new card stack (D-02).

## File Classification

| File | Change | Role | Data Flow | Closest Analog | Match Quality |
|------|--------|------|-----------|----------------|---------------|
| `src/renderer/src/components/transcript-panel.tsx` | modify (rewrite render body + local interface + add derivation helpers) | component (renderer panel) | event-driven push → view (one-way, read-only) | `src/renderer/src/components/ai-panel.tsx` (card stack) + its own current scaffolding | exact |
| `src/renderer/src/assets/hud.css` (`.transcript-panel__*` block ~309–340; add card rules) | modify (rework `.transcript-panel__*`, add card/people-row/ghost rules) | config (global stylesheet) | n/a | `.ai-panel__entry*` block (~343–409) | exact |
| local `IOverlayTranscript` interface inside `transcript-panel.tsx` (lines 9–18) | modify (add `utterances: IUtteranceEvent[]` + mirror `IUtteranceEvent`/`UtteranceClassification` locally) | interface (local mirror) | n/a | `IOverlayTranscript` in `overlay-window.manager.ts` (lines 96–111) + `AiMode`/`IAiPushEvent` local-mirror pattern in `ai-panel.tsx` (lines 8–23) | exact |
| `src/main/stt/stt-provider.interface.ts` | READ-ONLY (source of `IUtteranceEvent`/`UtteranceClassification` shape to mirror) | interface (contract) | n/a | — (authoritative) | — |
| `src/main/overlay-window.manager.ts` | READ-ONLY (source of the pushed `IOverlayTranscript` shape) | interface (contract) | n/a | — (authoritative) | — |
| `src/renderer/src/components/panel-labels.ts` | READ-ONLY (import `PANEL_LABEL`, `ActivePanel`) | config (constants) | n/a | — (authoritative) | — |

## Pattern Assignments

### `src/renderer/src/components/transcript-panel.tsx` (component, event-driven → view)

This file is rewritten in place. Three pattern sources feed it: (1) its OWN current
subscription/scroll/reset scaffolding — PRESERVE; (2) `ai-panel.tsx` — copy the card-stack JSX + list
scroll ref + entry mapping; (3) `stt-provider.interface.ts` — mirror `IUtteranceEvent` locally.

#### PRESERVE — scaffolding to keep verbatim (from current `transcript-panel.tsx`)

**Local-mirror interface pattern + extend it** (current lines 4–18). Keep the "declared locally because
the renderer is bundled separately from the preload" convention. ADD `utterances` and the two mirrored
types (see local-interface section below):

```typescript
interface IOverlayTranscript {
    finalText: string;
    interimText: string;
    connectionState: string;
    audioLevel: number;
    // ADD:
    utterances: IUtteranceEvent[];
}
```

**Active-panel ref pattern + scroll gate** (current lines 99–107, 132–153). Keep exactly — the scroll
subscription is wired once so the live `activePanel` must be mirrored into `activePanelRef`, and the
handler gates on `activePanelRef.current !== 'transcript'`:

```typescript
const [activePanel, setActivePanel] = useState<ActivePanel>('ai');
const activePanelRef = useRef<ActivePanel>('ai');
const stickToBottomRef = useRef<boolean>(true);
const transcriptRef = useRef<HTMLDivElement | null>(null);
// ...
const offScroll = window.jedi?.onScrollTranscript((direction) => {
    if (activePanelRef.current !== 'transcript') {
        return;
    }
    const element = transcriptRef.current;
    if (element === null) {
        return;
    }
    const lineStep = 3 * 18;
    element.scrollTop += direction === 'down' ? lineStep : -lineStep;
    stickToBottomRef.current = element.scrollTop + element.clientHeight >= element.scrollHeight - 4;
});
```

**onStatus wiring** (current lines 132–135) — unchanged:

```typescript
const offStatus = window.jedi?.onStatus((status) => {
    activePanelRef.current = status.activePanel;
    setActivePanel(status.activePanel);
});
```

**Empty-push reset** (current lines 114–122). Ctrl+Alt+K sends an all-empty push. EXTEND this branch to
also clear the utterance-derived state (D-12/D-13). Note main empties `utterances` in place on clear
(confirmed in `index.ts` line 129 `utterances.length = 0`, re-pushed line 133), so an empty push carries
`utterances: []` — the reset can simply read the pushed array:

```typescript
if (next.finalText.length === 0 && next.interimText.length === 0) {
    // reset panel-side state (now: cards derive from next.utterances which is [] here)
    return;
}
```

**Stick-to-bottom auto-follow effect** (current lines 165–170). Keep; change the dep array from
`[finalLog, interimText]` to whatever drives the card stack (the utterances array + interim):

```typescript
useEffect(() => {
    const element = transcriptRef.current;
    if (element !== null && stickToBottomRef.current) {
        element.scrollTop = element.scrollHeight;
    }
}, [/* utterances, interimText */]);
```

**Root `<section>` seams — KEEP the load-bearing testids/attributes** (current lines 172–179, D-13):

```tsx
<section className="transcript-panel" data-testid="card-transcript-panel" data-active={activePanel === 'transcript'} data-connection-state={connectionState}>
    <span className="transcript-panel__active-indicator" data-testid="icon-active-panel-transcript" data-active-panel={activePanel}>
        {PANEL_LABEL.transcript}
    </span>
    <h2 className="transcript-panel__title">{PANEL_LABEL.transcript}</h2>
    {/* people row + card body go here */}
</section>
```

#### REMOVE — no longer needed

- `reconcileFinalLog` (current lines 46–72) and its `finalLogRef`/`finalLog` state (lines 93–96) — the
  overlap-dedup of a rolling flat snapshot. Cards render from the structured `utterances` array which
  main pushes as the full session-scoped list each push (`index.ts` 358–359: `utterances.push(...)`
  then push the whole array), so no reconciliation is needed. (Confirms the D-open-question: render
  directly from the pushed `utterances`; do NOT keep a panel-side accumulator.)

#### COPY structure from `ai-panel.tsx` — the card stack (D-02)

**Scrollable list container + ref + `.map` of cards** (ai-panel lines 218–228). This is the exact
anatomy to replicate for the Q/A card stack. Note the `list-`/`row-` testid prefixes:

```tsx
<div className="ai-panel__entries" data-testid="list-ai-entries" ref={listRef}>
    {entries.map((entry) => (
        <article className={`ai-panel__entry ai-panel__entry--${entry.state}`} key={entry.id} data-testid={`row-ai-entry-${entry.id}`}>
            <header className="ai-panel__entry-header">
                <span className="ai-panel__entry-mode">{MODE_LABEL[entry.mode]}</span>
                <span className="ai-panel__entry-time">{formatRelativeTime(entry.at, nowMs)}</span>
            </header>
            <p className="ai-panel__entry-body">{renderEntryBody(entry)}</p>
        </article>
    ))}
</div>
```

New Q/A version: the container is `transcript-panel__body` (keep that classname + its `ref` +
`data-testid="card-transcript"`, so the scroll gate keeps working); each card is an `<article>` with a
header (`{Q|S}{seq} - {speaker}` label + colored speaker chip) and a `<p>` body (utterance text). Give
cards a class variant driven by classification (mirrors `ai-panel__entry--${entry.state}`), e.g.
`transcript-panel__card transcript-panel__card--question` / `--statement`. New testids per D-13 with
`card-`/`row-`/`list-` prefixes (e.g. `data-testid={\`row-utterance-${index}\`}`).

**Derivation-helper pattern** (ai-panel `MODE_LABEL` const lines 38–42, `formatRelativeTime` lines
52–62, `renderEntryBody` lines 116–127). These are module-level pure functions consumed in render — the
established place to put per-type sequence numbering (Q1/Q2 independent of S1/S2), per-speaker counts,
and deterministic per-`Person N` color assignment (D-03/D-04/D-07, Claude's-Discretion helper option).
Follow the same "small pure function, PascalCase-keyed `Record` for label maps" shape.

**Interim (ghost card) handling** (D-09/D-10). Current panel reads `interimText` into state (line 111)
and replaces in place — keep that discipline. Render one trailing ghost card AFTER the mapped
utterance cards when `interimText` is non-empty (no label, no accent, dashed/low-opacity frame). Do NOT
accumulate interim.

### `src/renderer/src/assets/hud.css` (config)

**Rework** the `.transcript-panel__*` body block (lines 309–340) — the flat `__final`/`__interim`
inline-text rules are being replaced by a card stack.

**Copy the `.ai-panel__entry*` block (lines 343–409) as the card template.** Reuse verbatim: the
scroll container + custom-scrollbar treatment, the stacked-entry hairline separator, the header
flex-between row, the body `white-space: pre-wrap; word-break: break-word`, and the state-variant
selector pattern.

Scroll container + custom scrollbar (lines 343–358) — the transcript body already has an identical
block (lines 314–331); keep whichever, they match:

```css
.ai-panel__entries {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    scrollbar-width: thin;
    scrollbar-color: rgb(148 163 184 / 50%) transparent;
}
.ai-panel__entries::-webkit-scrollbar { width: 6px; }
.ai-panel__entries::-webkit-scrollbar-thumb {
    background: rgb(148 163 184 / 50%);
    border-radius: 3px;
}
```

Card + header + body + state variant (lines 361–409) — the anatomy to clone for Q/A cards. NOTE D-11
asks for ROOMIER density than the AI panel's tight `padding: 6px 0` + hairline; the new cards should be
padded boxes (rounded, spaced), not hairline-separated rows — but keep the header-flex + body-wrap +
`--variant` selector structure:

```css
.ai-panel__entry {
    padding: 6px 0;
    border-top: 1px solid rgb(148 163 184 / 18%);
}
.ai-panel__entry:first-child { border-top: none; }
.ai-panel__entry-header {
    display: flex;
    justify-content: space-between;
    margin-bottom: 2px;
    font-size: 11px;
}
.ai-panel__entry-mode { color: rgb(196 181 253 / 100%); font-weight: 600; }
.ai-panel__entry-body {
    margin: 0;
    white-space: pre-wrap;
    word-break: break-word;
    color: rgb(226 232 240 / 100%);
}
/* state variant selector pattern — mirror for question/statement + ghost/interim */
.ai-panel__entry--thinking .ai-panel__entry-body {
    color: rgb(148 163 184 / 85%);
    font-style: italic;
}
```

Question-card accent+tint (D-01), per-speaker chip colors (D-04), and ghost-card dashed/low-opacity
frame (D-09) are Claude's-Discretion palette choices — but they MUST be expressed as CSS classes (no
inline `style` prop, per CLAUDE.md IDEXX rule + CONTEXT.md line 72). Empty-state placeholder (D-12): the
`.vision-panel__placeholder` rule (lines 411–416) is the exact muted-italic empty-line precedent to
copy:

```css
.vision-panel__placeholder {
    margin: 0;
    color: rgb(148 163 184 / 85%);
    font-style: italic;
}
```

Existing color tokens to reuse for consistency: base text `rgb(226 232 240 / 100%)`, muted
`rgb(148 163 184 / 85%)`, Q/A title accent `rgb(125 211 252 / 100%)` (transcript title, line 282),
focus accent `rgb(196 181 253 / ...)`.

### local `IOverlayTranscript` interface (interface mirror)

**Add `utterances` + mirror the two utterance types locally.** The authoritative shape is in
`overlay-window.manager.ts` (lines 96–111): `IOverlayTranscript.utterances: IUtteranceEvent[]`. The
renderer is bundled separately from main/preload, so — following the exact convention already used in
this repo — the types are re-declared locally rather than imported across the bundle boundary.

Precedent for local re-declaration is `ai-panel.tsx` lines 8–23 (`AiMode`, `IAiPushEvent` declared
locally "because the renderer is bundled separately from the preload; structurally mirrors ... in
main/preload"). Mirror `IUtteranceEvent` + `UtteranceClassification` the same way, from the READ-ONLY
authoritative source `stt-provider.interface.ts` (lines 44, 53–67):

```typescript
// mirror of UtteranceClassification (stt-provider.interface.ts:44)
type UtteranceClassification = 'question' | 'statement';

// mirror of IUtteranceEvent (stt-provider.interface.ts:53-67)
interface IUtteranceEvent {
    text: string;
    speaker: string;        // 'Person 1' | 'Person 2' | … | 'Speaker' (undiarized bucket)
    isDiarized: boolean;    // false => neutral 'Speaker' bucket (D-05); keep OUT of people list
    classification: UtteranceClassification; // 'question' => Q label + accent/tint; else 'statement'
}
```

These fields drive: `classification` → `Q`/`S` prefix + question accent (D-01/D-03); `speaker` → chip
label + (via `Person N` number) deterministic accent color (D-04); `isDiarized === false` → neutral grey
`Speaker` card, excluded from the people row (D-05/D-07). No sequence or color field exists on the
contract — both are derived in the panel (D-03/D-04, confirmed).

## Shared Patterns

### One-way read-only view (IN-01)
**Source:** `transcript-panel.tsx` doc lines 76–79; `ai-panel.tsx` doc lines 138–139.
**Apply to:** the whole redesign. The panel ONLY subscribes to `window.jedi?.onTranscript`,
`onStatus`, `onScrollTranscript`. It NEVER opens a renderer→main channel. Do not add one.

### Local type mirroring across the bundle boundary
**Source:** `ai-panel.tsx` lines 4–23; current `transcript-panel.tsx` lines 4–18.
**Apply to:** the added `utterances` field + `IUtteranceEvent`/`UtteranceClassification`. Re-declare
locally; do not import from `src/main/**`.

### `data-testid` seams (D-13, IDEXX naming)
**Source:** current `transcript-panel.tsx` (`card-transcript-panel`, `icon-active-panel-transcript`,
`card-transcript`); `ai-panel.tsx` (`list-ai-entries`, `row-ai-entry-${id}`).
**Apply to:** KEEP `card-transcript-panel`, `icon-active-panel-transcript`, and the body's
`card-transcript` (the scroll target). New elements use `card-`/`row-`/`list-` prefixes: e.g.
`row-utterance-${index}` per card, `list-people` / `row-person-${n}` for the people row/chips.

### Active-panel scroll gate + stick-to-bottom follow
**Source:** current `transcript-panel.tsx` lines 137–170 (identical shape in `ai-panel.tsx` 170–207).
**Apply to:** unchanged. The card body element must be the `ref` target so the gated scroll still works.

### Empty-push clear reset (Ctrl+Alt+K)
**Source:** current `transcript-panel.tsx` lines 114–122; main side `index.ts` 129/133 (`utterances.length = 0`
then re-push).
**Apply to:** extend the existing all-empty-push branch to reset card/people state. Since main pushes an
emptied `utterances: []`, rendering directly from the pushed array already handles this; keep the branch
as the explicit reset for interim/connection-derived state.

## No Analog Found

None. Every pattern this phase needs has a strong in-repo analog (the sibling `ai-panel.tsx` card stack,
the panel's own scaffolding, the `.ai-panel__entry*`/`.vision-panel__placeholder` CSS). No RESEARCH.md
fallback patterns are required.

## Metadata

**Analog search scope:** `src/renderer/src/components/`, `src/renderer/src/assets/hud.css`,
`src/main/stt/`, `src/main/overlay-window.manager.ts`, `src/main/index.ts`.
**Files scanned:** 7 (2 panel components, 1 CSS, 2 main contracts, index.ts pushTranscript flow, panel-labels).
**Existing component tests:** none for panels (only `rms.utility.test.ts`, `format-uptime.utility.test.ts`);
new tests, if written, extend the panel's testid seams rather than follow an existing panel-test analog.
**Pattern extraction date:** 2026-07-06
