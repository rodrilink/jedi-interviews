---
phase: 11-auto-answer-trigger
reviewed: 2026-07-07T00:00:00Z
depth: standard
files_reviewed: 6
files_reviewed_list:
  - src/main/ai/ai-orchestrator.ts
  - src/main/ai/ai-orchestrator.test.ts
  - src/main/index.ts
  - src/preload/index.ts
  - src/renderer/src/components/ai-panel.tsx
  - src/renderer/src/assets/hud.css
findings:
  critical: 1
  warning: 3
  info: 3
  total: 7
status: issues_found
---

# Phase 11: Code Review Report

**Reviewed:** 2026-07-07
**Depth:** standard
**Files Reviewed:** 6
**Status:** issues_found

## Summary

Phase 11 wires an auto-answer trigger: a committed utterance classified as a question calls
`aiOrchestrator.trigger('answer', 'auto', utterance.text)` from inside `attachSttGatewayHandlers`,
feeding the Phase-10 priority queue's `'auto'` lane. The burst-debounce map is upgraded from a
mode-keyed `Map<AiMode,…>` to a composite string key (`burstKey`) so auto requests dedup on
normalized question content; the `source` field now rides the `thinking` push through all three
`IAiPushEvent` duplicates (orchestrator / preload / renderer) so the AI panel renders an `auto`
badge. The AI-stack construction block was moved above `wireSttPipeline` (boot-reorder) so the
orchestrator reference exists when the STT wiring closes over it, and the reference is threaded into
both the boot attach and the re-key attach paths.

The IPC boundary is clean: the three `IAiPushEvent` type duplicates match (`thinking` gains
`source: RequestSource`, `RequestSource = 'manual' | 'auto'` in each). The boot-reorder and re-key
threading of the live orchestrator reference are correct — no stale/dead closure. The composite
burst key correctly keeps manual and auto in disjoint key spaces.

The blocking issue is an **emit-ordering bug**: the STT gateway emits `'utterance'` *before* the
final `'transcript'` event that appends the turn's text to the transcript buffer, so
`trigger`'s synchronous empty-span guard sees a buffer that does NOT yet contain the question that
just triggered it. On the first question of a session (empty buffer), the auto-answer is dropped
with an "empty" placeholder instead of answering — the core feature silently fails on its first
invocation. This is entirely masked by the unit tests, which all pre-seed the span with `seedSpan`
and never exercise the real utterance→append ordering, and there is no integration test over the
`index.ts` wiring.

## Critical Issues

### CR-01: Auto-trigger empty-span guard evaluated against a buffer that does not yet contain the triggering question — first question of every session is dropped

**File:** `src/main/index.ts:398-400`, `src/main/ai/ai-orchestrator.ts:242-256`, `src/main/stt/deepgram-stt.gateway.ts:358-363`

**Issue:**
The gateway commits a turn in this order (`commitPendingUtterance`, gateway lines 358-363):
```ts
this.emit('utterance', utterance);                         // (1) fires FIRST
if (committed.text.trim().length > 0) {
    this.emit('transcript', { text: committed.text, isFinal: true });  // (2) appends to buffer
}
```
The Phase-11 `'utterance'` handler runs on (1):
```ts
if (utterance.classification === 'question') {
    aiOrchestrator.trigger('answer', 'auto', utterance.text);
}
```
`trigger` synchronously reads the span and applies the empty-span guard BEFORE the debounce:
```ts
const span = this.transcriptBuffer.recentSince(RECENT_SPAN_MS);
if (mode !== 'code-challenge' && span.trim().length === 0) {
    // append EMPTY_SPAN_TEXT placeholder, push 'empty', return — NO gateway call
}
```
Because (2) has not run yet, the just-asked question is not in `finals` (interim text is not part of
`recentSince`, transcript-buffer.ts:106-113). Consequences:

- **First question of a session (or first after Ctrl+Alt+K clear):** buffer is empty → guard fires →
  the request is short-circuited to an `EMPTY_SPAN_TEXT` placeholder entry and NO answer streams.
  The headline feature ("a question is asked → a grounded answer appears") fails on its very first
  use. Worse, the placeholder entry defaults to `source: 'manual'` in the renderer
  (`ai-panel.tsx:99`), so it doesn't even carry the `auto` badge — the user sees an unexplained
  "No recent transcript to act on" line.
- **Later questions:** the guard passes only because *prior* turns are in the buffer; the question
  that triggered the answer is still absent from the guard's span (though pull-on-run assembly at
  `startRequest`, after the 200 ms debounce, does pick it up once (2) has landed, so run-time
  grounding is coincidentally correct).

The unit tests never catch this: every orchestrator test calls `seedSpan(buffer, …)` (which is
`appendFinal`) BEFORE `trigger`, i.e. they simulate the post-append state that production does not
have at trigger time. No test covers the real `attachSttGatewayHandlers` ordering.

**Fix:** Do not rely on the transcript buffer already containing the triggering utterance. Options:

1. Include the utterance text in the guard/grounding directly. Since `trigger` already accepts the
   question as `contentKey`, feed it as span context so the guard cannot false-negative:
```ts
// index.ts — pass the committed text so the guard/grounding see it regardless of emit order
if (utterance.classification === 'question') {
    aiOrchestrator.trigger('answer', 'auto', utterance.text);
}
// ai-orchestrator.ts trigger(): auto requests are actionable from the question text alone —
// bypass the empty-span guard for 'auto' the same way 'code-challenge' bypasses it, OR
// evaluate the guard against `span + (contentKey ?? '')`:
const guardSource = source === 'auto' && contentKey ? `${span} ${contentKey}` : span;
if (mode !== 'code-challenge' && guardSource.trim().length === 0) { … }
```
2. Or reorder the gateway to emit the final `'transcript'` before `'utterance'` (append first, then
   trigger). This is a smaller change but couples the fix to gateway emit order, which the Phase-11
   code comment ("Utterances are already committed/final at emit, so no extra final-only guard is
   needed") wrongly assumes already holds for the buffer.

Add an integration-level test that emits `'utterance'` (question) on an empty buffer through the real
handler wiring and asserts `gateway.stream` IS called (an answer streams), guarding the ordering.

## Warnings

### WR-01: Auto-lane content dedup collapses only within a 200 ms window — provides no protection against Deepgram re-emitting a near-duplicate final, the stated motivation

**File:** `src/main/ai/ai-orchestrator.ts:305-327`, `321-326`

**Issue:** The composite `burstKey` makes auto dedup content-aware, but the collapse only holds while
the burst timer is live (`BURST_DEBOUNCE_MS = 200`); the timer deletes its key on the trailing edge
(line 322). An identical committed question that arrives >200 ms later enqueues a fresh Claude call.
Committed utterances are one-per-finalized-turn and are seconds apart in practice, so two genuinely
distinct askings correctly each answer — but the same is true of an accidental duplicate turn the
recognizer commits a few hundred ms apart: it will NOT collapse and will spend a second Claude call.
The content-key mechanism therefore only guards the sub-200 ms case, which for auto (turn-granularity)
input essentially never occurs — the feature adds surface area (normalization regex, disjoint
namespaces) for a race that the auto source does not actually produce. Verify this is the intended
scope; if duplicate-turn suppression is a real goal it needs a wider (last-N-answered-questions)
dedup, not a 200 ms window.

**Fix:** Either document that auto content-dedup is only a same-tick burst guard (and that
turn-to-turn duplicate suppression is out of scope), or track a small recent-answered-question set
with a longer TTL if duplicate committed turns are observed on-machine.

### WR-02: `index.ts` auto-trigger wiring has no test coverage — the untested seam is exactly where the CR-01 ordering bug lives

**File:** `src/main/index.ts:388-401`

**Issue:** The entire Phase-11 production wiring (the `'utterance'` handler's classification check and
`trigger('answer','auto',…)` call, plus the boot-reorder and re-key threading) is exercised only by
the orchestrator unit tests, which stand in for the real gateway with pre-seeded spans. There is no
test that drives a `DeepgramSttGateway`/fake through `attachSttGatewayHandlers` into the orchestrator,
so neither the emit-ordering contract (CR-01) nor the re-key re-attach of the auto-trigger is
verified. `attachSttGatewayHandlers` and `wireSttPipeline` are untested main-process functions.

**Fix:** Add a component/integration test that constructs the handler wiring with a fake gateway,
emits a question `'utterance'` (and the accompanying final `'transcript'`), and asserts an auto answer
streams; add a second that re-keys and asserts the re-attached handler still auto-triggers.

### WR-03: `empty` placeholder from an auto trigger renders as a manual entry, losing the auto attribution

**File:** `src/renderer/src/components/ai-panel.tsx:92-99`, `src/main/ai/ai-orchestrator.ts:252`

**Issue:** The `empty` push variant carries no `source` (orchestrator line 252 pushes
`{ type: 'empty', requestId, id, mode, at, text }` with no source), and the renderer hard-codes
`source: 'manual'` for empty entries (ai-panel.tsx:99). When an auto trigger hits the empty-span
guard (which, per CR-01, is currently the common case for the first question), the resulting
placeholder is indistinguishable from a manual empty result — the user cannot tell the app tried to
auto-answer and gave up. This compounds CR-01: not only is the answer dropped, the trace of the
auto attempt is erased. Even after CR-01 is fixed, any legitimately empty auto trigger loses its
lane attribution.

**Fix:** Thread `source` onto the `empty` variant (all three `IAiPushEvent` duplicates) and set the
entry's `source` from it in `reduceEntries`, so an auto empty placeholder still badges `auto`.
If the intent is that autos should never produce an empty placeholder, address it via CR-01's
guard-bypass instead.

## Info

### IN-01: Duplicated `@param gateway/window/buffer/utterances` block in the `attachSttGatewayHandlers` TSDoc

**File:** `src/main/index.ts:341-362`

**Issue:** The Phase-11 edit inserted a second copy of the `@param gateway`, `@param window`,
`@param buffer`, and `@param utterances` lines (lines 355-358) directly below the first set
(340-343), with the Phase-11 prose wedged between them. The doc block now documents the first four
params twice. Harmless but confusing and will trip doc generators.

**Fix:** Remove the duplicated `@param` lines (355-358); keep one set plus the Phase-11 prose and the
new `@param aiOrchestrator`.

### IN-02: Stale/contradictory comments on the AI hotkey handlers reference removed cancel-on-re-press semantics

**File:** `src/main/index.ts:150-152`, `171`

**Issue:** The `'ai-answer'` handler comment still says "single-in-flight cancel on re-press (D-06)"
and the `'capture-code-challenge'` comment says "single-in-flight cancel", but v1.2 (D-01) reversed
that: nothing cancels an in-flight stream (the orchestrator's own header documents this at lines
11-25). These comments describe behavior the code no longer has. Not touched by Phase 11 but adjacent
to the reviewed diff and actively misleading for anyone reading the auto-trigger path.

**Fix:** Update the comments to the queue-and-drain semantics (re-press enqueues, never cancels).

### IN-03: `RequestSource` / `IAiPushEvent` / `AiMode` re-declared in three files by hand — drift risk

**File:** `src/main/ai/ai-orchestrator.ts:94,103-114`; `src/preload/index.ts:95,103-112`; `src/renderer/src/components/ai-panel.tsx:11,17-26`

**Issue:** The `source` addition to `thinking` had to be made in three hand-maintained copies of the
same union. They currently match, but nothing enforces that — a future variant change (e.g. adding
`source` to `done`, per WR-03) must be replicated in three places or the renderer silently drops the
field. The sandbox-bundling rationale for not importing is legitimate, but a shared `.d.ts`/type-only
module or a structural-parity test would prevent divergence.

**Fix:** Extract the shared push-event union to a type-only module imported by all three, or add a
compile-time parity assertion; at minimum add a comment cross-linking the three definitions so an
editor of one is prompted to update the others.

---

_Reviewed: 2026-07-07_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
