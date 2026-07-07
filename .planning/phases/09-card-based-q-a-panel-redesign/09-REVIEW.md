---
phase: 09-card-based-q-a-panel-redesign
reviewed: 2026-07-07T06:07:16Z
depth: standard
files_reviewed: 5
files_reviewed_list:
  - src/renderer/src/components/utterance-view.utility.ts
  - src/renderer/src/components/utterance-view.utility.test.ts
  - src/renderer/src/components/transcript-panel.tsx
  - src/renderer/src/assets/hud.css
  - src/preload/index.ts
findings:
  critical: 1
  warning: 3
  info: 4
  total: 8
status: partially_resolved
critical_resolved: 1
resolution_note: "CR-01 (Critical) fixed in commit a60da38 — reset now gates on next.utterances.length, not the rolling finalText window. 3 Warning + 4 Info remain as tracked non-blocking follow-ups."
---

# Phase 9: Code Review Report

**Reviewed:** 2026-07-07T06:07:16Z
**Depth:** standard
**Files Reviewed:** 5
**Status:** issues_found

## Summary

Phase 09 rebuilt the Q/A overlay panel as a card stack driven by the Phase 8 session-scoped `utterances` array over the existing read-only `jedi:transcript` bridge. The pure derivation utility (`deriveCardRows` / `personAccentColor` / `derivePeople`) is clean, DOM-free, well-typed, and correctly covered by tests. The XSS surface (T-09-01/T-09-04) is properly mitigated: every untrusted string — utterance text, speaker label, interim text, chip label — renders as React children, and there is no `dangerouslySetInnerHTML` anywhere. The no-inline-`style`, no-`src/main`-import, and no-new-channel constraints all hold.

However, there is one **BLOCKER**: the empty-push reset branch keys off `finalText`/`interimText` being empty, but `finalText` is a **time-bounded 90-second rolling window** while `utterances` is the **full un-pruned session list**. During normal operation (a lull in speech longer than the window, or the level-only push firing right after pruning) the panel wrongly wipes the entire committed card stack even though the main-side utterance list is intact. This is a correctness/data-loss defect in the live path, not just an edge case.

Secondary concerns: `key={index}` on the card list is fragile, the `18px` line-height scroll step is a hard-coded magic number decoupled from the actual card layout, and the reset branch is redundant with the direct render path.

## Critical Issues

### CR-01: Empty-text push wipes the entire committed card stack mid-session (finalText is a rolling window, utterances is not)

**Status:** ✅ RESOLVED in commit `a60da38` — the reset branch now gates on `next.utterances.length === 0` (the field main empties on Ctrl+Alt+K) instead of `next.finalText.length === 0`. Verified: typecheck:web clean, 13/13 utility tests, prettier + oxlint clean. Confirmed against `transcript-buffer.ts:30,122` (90s rolling window) and `src/main/index.ts:129,270` (utterances emptied only on real clear; level-tick push carries full utterances).

**File:** `src/renderer/src/components/transcript-panel.tsx:73-78`

**Issue:** The reset branch treats "`finalText` empty AND `interimText` empty" as the Ctrl+Alt+K clear signal and forces `setUtterances([])`, discarding `next.utterances` entirely:

```tsx
if (next.finalText.length === 0 && next.interimText.length === 0) {
    setUtterances([]);
    setInterimText('');
    return;
}
```

But `finalText` and `utterances` have **different lifetimes** on the main side:

- `finalText` comes from `TranscriptBuffer.renderable()`, a **time-bounded rolling window** — `WINDOW_MS = 90_000` (90s), plus `MAX_SEGMENTS`/`MAX_TOTAL_CHARS` ceilings (`src/main/stt/transcript-buffer.ts:30,36,42`). Older finalized segments are pruned. After ~90s without new final segments, `finalText` becomes `''`.
- `utterances` is the **full session-scoped list**, only emptied on the actual Ctrl+Alt+K handler (`src/main/index.ts:129`, `utterances.length = 0`). It is never time-pruned.

The main process pushes on several triggers, not just clear:
- a throttled **level-only push every ~66 ms** (`src/main/index.ts:268-270`),
- `connection-state-change` pushes (`src/main/index.ts:362-364`),
- and each transcript/utterance push.

So the moment the rolling window empties during a conversational lull (or immediately after a final commit clears the interim and the window has aged out), the very next ~66 ms level push carries `finalText: ''`, `interimText: ''`, but `utterances` = the full non-empty list. The panel then hits this branch and **erases every committed card** even though the authoritative main-side list still holds them. The people row collapses, the "Listening…" placeholder returns, and the whole session view is lost until the next new utterance re-populates one card. This is incorrect behavior on the live overlay, not a rare corner case — a 90-second pause in a meeting is normal.

**Fix:** Key the reset off the authoritative field the main side actually empties on clear (`utterances`), not the rolling-window text. The direct render path already handles both cases, so the simplest correct form is to drop the sentinel branch entirely:

```tsx
const offTranscript = window.jedi?.onTranscript((next: IOverlayTranscript) => {
    setInterimText(next.interimText);
    setConnectionState(next.connectionState);
    // Main pushes the FULL session-scoped list every push and empties it in place on Ctrl+Alt+K,
    // so rendering next.utterances directly is authoritative for both the live and cleared cases.
    setUtterances(next.utterances);
});
```

If an explicit clear branch is desired for clarity, gate it on `next.utterances.length === 0` (the field main actually resets), never on `finalText`:

```tsx
if (next.utterances.length === 0 && next.interimText.length === 0) {
    setUtterances([]);
    setInterimText('');
    return;
}
setUtterances(next.utterances);
```

Note the current branch is also internally redundant: `setUtterances([])` in the branch is exactly what `setUtterances(next.utterances)` would do when `next.utterances` is already `[]` on a real clear — the branch only *changes* behavior in the buggy case where `utterances` is non-empty but the text is empty.

## Warnings

### WR-01: Card list uses `key={index}` — index keys on a growing, order-significant list

**File:** `src/renderer/src/components/transcript-panel.tsx:160-161`

**Issue:** Committed cards are keyed by array index (`key={index}`), and the `data-testid` is also index-based (`row-utterance-${index}`). React index keys are an anti-pattern for lists whose length and content change over time: because the utterances list is append-only during a session, index N always maps to the same logical card *until* Ctrl+Alt+K resets the list, after which index N now refers to a completely different utterance. React will reuse the prior DOM node/subtree for that index instead of remounting, which can cause stale card content, incorrect `data-speaker-color` attribute reconciliation, and mis-targeted `data-testid`s across a clear-then-refill. It also defeats React's ability to reconcile efficiently if the derivation order ever changes. The `deriveCardRows` output carries enough to build a stabler key.

**Fix:** Prefer a key derived from stable per-utterance content rather than position, e.g. combine sequence + prefix + speaker (unique within a session render):

```tsx
key={`${row.prefix}${row.seq}-${row.speaker}`}
```

If a truly stable identity is needed across clears, add an `id` to `IUtteranceEvent` upstream. At minimum, do not use the raw array index.

### WR-02: Scroll step hard-codes a `3 * 18` line height that no longer matches the card layout

**File:** `src/renderer/src/components/transcript-panel.tsx:103-104`

**Issue:** The hotkey scroll advances by `const lineStep = 3 * 18;` — 3 lines of an assumed 18px line height. This magic number predates the redesign: the body is now a stack of padded cards (`padding: 10px 12px`, `gap: 8px`, `border-radius: 8px` per `hud.css:341-347`), not 18px text lines. The step is now decoupled from anything on screen — it may over- or under-scroll relative to a card, and the two `18`/`3` literals carry no named meaning. This is a correctness-adjacent quality issue: the "~3 lines" comment no longer describes what a press does.

**Fix:** Extract a named constant and, ideally, scroll by a fraction of the visible viewport so it stays correct regardless of card sizing:

```tsx
const SCROLL_STEP_PX = 54; // ~3 text lines; keep in sync with card metrics
// or, layout-independent:
const step = element.clientHeight * 0.4;
element.scrollTop += direction === 'down' ? step : -step;
```

### WR-03: `deriveCardRows(utterances)` is computed twice per render

**File:** `src/renderer/src/components/transcript-panel.tsx:125,129,157`

**Issue:** `const cardRows = deriveCardRows(utterances)` is computed at line 125, and the same value is used for `isEmpty` (line 129) and the `.map` (line 157) — that part is fine. But `derivePeople(utterances)` (line 126) re-walks the same array independently, and both derivations run on **every** render, including the ~15 fps level-only pushes that update `audioLevel`/`connectionState` but leave `utterances` unchanged. On a long session the utterance array can hold hundreds of entries (`MAX_SEGMENTS = 400` upstream), so both O(n) derivations re-run 15×/second against an unchanged input. This is correctness-neutral but wasteful on a latency-sensitive overlay. (Per review scope, pure performance is out of scope — flagged here as a robustness/maintainability concern because the derivations are recomputed on state that does not affect them.)

**Fix:** Memoize both derivations on `utterances` so they only recompute when the list actually changes:

```tsx
const cardRows = useMemo(() => deriveCardRows(utterances), [utterances]);
const people = useMemo(() => derivePeople(utterances), [utterances]);
```

## Info

### IN-01: People-chip `data-testid` collides for Person numbers sharing digits after `\D` stripping

**File:** `src/renderer/src/components/transcript-panel.tsx:148`

**Issue:** The chip testid strips all non-digits: `row-person-${person.speaker.replace(/\D/g, '')}`. For `'Person 1'` this yields `row-person-1`. This is fine for the current `Person N` scheme, but it silently couples the test id to digit extraction — a future speaker label like `'Person 1A'` or `'Speaker 12'` would collapse to a colliding/misleading id. The React `key` correctly uses the full `person.speaker`, so only the testid is affected.

**Fix:** Derive the suffix from the sequence the same way the key does, or keep the full speaker slug: `data-testid={`row-person-${person.speaker.replace(/\s+/g, '-').toLowerCase()}`}` → `row-person-person-1`.

### IN-02: Preload namespace comment claims "no renderer→main control channel (IN-01)" while a write channel exists

**File:** `src/preload/index.ts:176-181` (onAi TSDoc) vs `src/preload/index.ts:81-86,199-201` (copySelection)

**Issue:** The `onAi` doc block states "One-way only — there is NO renderer->main control channel (IN-01)", while the same file defines and exposes `copySelection`, an explicit `ipcRenderer.send` write to `jedi:copy-selection`. The namespace-level doc (lines 116-121) correctly describes `copySelection` as "a SINGLE narrow exception," so the two comments contradict each other. Not a Phase 09 change (the channel predates it) and not a defect in behavior, but the stale absolute claim is misleading for the untrusted-boundary review it invites. Confirmed the phase added no new channel — the panel only uses `onTranscript`/`onStatus`/`onScrollTranscript`.

**Fix:** Soften the `onAi` comment to "this subscription is one-way; the only renderer→main write on this surface is `copySelection`" to match the namespace doc.

### IN-03: Per-speaker color CSS is duplicated verbatim between card-speaker and person-chip

**File:** `src/renderer/src/assets/hud.css:388-422` and `:453-487`

**Issue:** The nine `[data-speaker-color='...']` color rules (`neutral`, `p0`–`p7`) are copy-pasted identically for `.transcript-panel__card-speaker` and `.transcript-panel__person-chip`. Any future palette change must be made in two places or the card label and its legend chip will drift out of sync — precisely the "row IS the color legend" invariant (D-06) the design depends on.

**Fix:** Collapse to a shared selector list, e.g. `.transcript-panel__card-speaker[data-speaker-color='p0'], .transcript-panel__person-chip[data-speaker-color='p0'] { color: … }`, or hoist the hue into a CSS custom property (`--speaker-p0`) referenced by both.

### IN-04: `personAccentColor` silently returns `neutral` for numbered speakers that fail the strict regex

**File:** `src/renderer/src/components/utterance-view.utility.ts:79-88`

**Issue:** `personAccentColor` only matches `/^Person (\d+)$/`. Any diarized speaker whose label deviates (extra whitespace, a different casing, or a future format like `'Person 10 '`) falls through to `neutral` — the same bucket as the undiarized `'Speaker'`. Because `deriveCardRows` still carries `isDiarized: true` for such a speaker, a diarized person could render with the neutral-grey color, visually indistinguishable from the undiarized bucket, while still appearing in the people row. Low risk given the upstream label is machine-generated, but the coupling between the regex and the exact upstream format is undocumented and untested for the malformed case.

**Fix:** Either broaden the parse (e.g. `/Person\s+(\d+)/`) or, since the upstream owns the format, add a code comment tying this regex to `src/main/stt/stt-provider.interface.ts` and a test asserting the neutral fallback is intentional for non-`Person N` input (partially covered by the existing `'Unknown'` test, but not for near-miss numbered labels).

---

_Reviewed: 2026-07-07T06:07:16Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
