---
phase: 08-diarized-utterance-pipeline
reviewed: 2026-07-06T23:02:15Z
depth: standard
files_reviewed: 11
files_reviewed_list:
  - src/main/index.ts
  - src/main/overlay-window.manager.ts
  - src/main/stt/deepgram-stt.gateway.ts
  - src/main/stt/deepgram-stt.gateway.test.ts
  - src/main/stt/question-classifier.utility.ts
  - src/main/stt/question-classifier.utility.test.ts
  - src/main/stt/speaker-map.ts
  - src/main/stt/speaker-map.test.ts
  - src/main/stt/stt-provider.interface.ts
  - src/main/stt/utterance-accumulator.utility.ts
  - src/main/stt/utterance-accumulator.utility.test.ts
findings:
  critical: 1
  warning: 4
  info: 3
  total: 8
status: issues_found
---

# Phase 8: Code Review Report

**Reviewed:** 2026-07-06T23:02:15Z
**Depth:** standard
**Files Reviewed:** 11
**Status:** issues_found

## Summary

Phase 8 adds a diarized-utterance pipeline: the Deepgram gateway now accumulates `is_final`
word runs, commits one speaker-attributed, locally-classified `IUtteranceEvent` per turn, and
main appends those to a shared session list that rides the existing `jedi:transcript` push. The
new pure/stateful units (speaker map, accumulator, classifier) are clean, well-tested, and
follow the IDEXX conventions (typed test objects, AAA comments, no key logging).

The pipeline in isolation is sound — but the change to `DeepgramSttGateway.handleMessage`
silently severed the rolling-transcript feed that the rest of the app depends on. `is_final`
runs are now buffered into the accumulator and NEVER re-emitted as `transcript` events, so
`TranscriptBuffer.finals` is never populated again. That breaks both the overlay's rolling
final-transcript display AND the AI orchestrator's `recentSince()` span — meaning the AI
answer/talking-points modes now always hit the empty-span guard and refuse to call Claude. This
is the app's core value and it is regressed. The unit tests pass because no test covers the
`index.ts` wiring, and the gateway tests actively codify the new (broken) behavior with
`expect(transcripts).toEqual([])`.

## Critical Issues

### CR-01: `is_final` runs are no longer emitted as transcript events — rolling transcript buffer and AI span are now permanently empty

**File:** `src/main/stt/deepgram-stt.gateway.ts:280-292`
**Issue:**
Before Phase 8, `handleMessage` emitted a `transcript` event with `isFinal: true` for every
final result, which `attachSttGatewayHandlers` (`index.ts:343-351`) fed into
`buffer.appendFinal(event.text)`. The Phase 8 rewrite emits a `transcript` event ONLY for
interim results (`message.is_final !== true`); for `is_final` runs it now only buffers into the
accumulator and, on `speech_final`/`UtteranceEnd`, emits an `utterance`:

```typescript
if (message.is_final !== true) {
    if (text.length > 0) {
        this.emit('transcript', { text, isFinal: false });   // interim only
    }
    return;
}
this.accumulator.append(alternative?.words ?? [], text);      // finals never re-emitted
if (message.speech_final === true) {
    this.commitPendingUtterance();
}
```

No code path in `src/main` now emits `isFinal: true` (`grep "isFinal: true"` → no matches).
Consequences that ship broken:
- `index.ts:344 if (event.isFinal) buffer.appendFinal(...)` is now dead code —
  `TranscriptBuffer.finals` is never populated, so `renderable().finalText` is always `''` and
  the overlay's rolling finalized transcript never accumulates.
- `AiOrchestrator.trigger()` reads `this.transcriptBuffer.recentSince(RECENT_SPAN_MS)`
  (`ai-orchestrator.ts:151`); with `finals` empty this is always `''`, so every `answer` and
  `talking-points` press hits the D-11 empty-span guard (`ai-orchestrator.ts:156`) and makes NO
  Claude call. The primary product feature is disabled.
- The last interim string before a turn commits is never cleared (nothing calls
  `setInterim('')` or `appendFinal` on commit), so the stale partial lingers on the overlay.

Neither the AI orchestrator nor `TranscriptBuffer` was modified this phase (confirmed via diff),
so nothing was migrated to read the new `utterances` list as a span source. No integration test
covers the `index.ts` wiring, so the whole suite passes while the app is functionally broken.

**Fix:** Keep feeding the rolling buffer from finals while ALSO driving the utterance pipeline.
Emit a final `transcript` event on each committed turn (or on each `is_final` run), so
`appendFinal` still runs. For example, emit the committed text on commit:

```typescript
private commitPendingUtterance(): void {
    const committed = this.accumulator.commit();
    if (committed === undefined) {
        return;
    }
    // Keep the rolling transcript buffer / AI span fed: the committed turn is the finalized text.
    if (committed.text.trim().length > 0) {
        this.emit('transcript', { text: committed.text, isFinal: true });
    }
    const speakerIndex = pickModalSpeakerIndex(committed.words);
    const { speaker, isDiarized } = this.speakerMap.label(speakerIndex);
    this.emit('utterance', { text: committed.text, speaker, isDiarized, classification: classifyUtterance(committed.text) });
}
```

Then update `deepgram-stt.gateway.test.ts` (the tests that assert `transcripts).toEqual([])`
for `is_final`/`speech_final` runs at lines 186 and 359-360 codify the regression and must be
revised) and add an integration test that asserts a `speech_final` turn results in a non-empty
`buffer.renderable().finalText` / `recentSince()` so this cannot silently regress again.

## Warnings

### WR-01: Empty/whitespace `is_final` runs produce empty utterance cards and malformed joined text

**File:** `src/main/stt/deepgram-stt.gateway.ts:289` and `src/main/stt/utterance-accumulator.utility.ts:91-115`
**Issue:**
`handleMessage` calls `this.accumulator.append(alternative?.words ?? [], text)` for every
`is_final` run WITHOUT checking `text.length`. An empty final run (`text === ''`, `words === []`)
still pushes `''` into `textRuns`, making the accumulator non-empty. On commit,
`this.textRuns.join(' ')` produces a string with extra/leading/trailing spaces (e.g.
`['hi', '', 'there'].join(' ')` → `'hi  there'`), and a run of only empty finals yields an
utterance with `text: ''`. That emits an empty Q/A card (`speaker: 'Speaker'`,
`classification: 'statement'`) with no content.
**Fix:** Skip empty finals at the source and/or trim on commit:

```typescript
if (message.is_final === true && text.length > 0) {
    this.accumulator.append(alternative?.words ?? [], text);
}
```
and in `commitPendingUtterance`, guard: `if (committed.text.trim().length === 0) return;`.

### WR-02: Last interim is never cleared on turn commit — stale partial lingers on the overlay

**File:** `src/main/stt/deepgram-stt.gateway.ts:290-292` (with `index.ts:346-347`)
**Issue:**
When a turn finalizes via `speech_final` (or `UtteranceEnd`), the gateway commits the utterance
but emits nothing that clears the transcript buffer's interim. The buffer's `interim` is only
overwritten by the next `setInterim` and only cleared by `appendFinal` (which no longer runs — see
CR-01) or `clear()`. Between the end of one turn and the first interim of the next, the overlay
keeps showing the previous turn's last partial line.
**Fix:** Once CR-01 is fixed by emitting `{ text, isFinal: true }` on commit, `appendFinal` will
clear the interim (`transcript-buffer.ts:76`). If CR-01 is fixed a different way, emit an explicit
interim-clearing signal on commit so the overlay does not show stale partials.

### WR-03: `pickModalSpeakerIndex` recomputes over the whole turn's words on every commit, and the accumulator retains every word for the turn

**File:** `src/main/stt/utterance-accumulator.utility.ts:91-96`, `src/main/stt/deepgram-stt.gateway.ts:309`
**Issue:**
`append` pushes one `{ speaker }` object per word for the entire turn; `commit` hands the full
array to `pickModalSpeakerIndex`, which builds a `Map` and scans all words. For the modal-speaker
decision only per-index counts are needed — the per-word list is retained purely to recompute the
mode at commit. This is a correctness-adjacent robustness concern (not raw perf, which is out of
scope): a pathologically long turn (Deepgram can stream a long monologue before `speech_final`)
grows `words` unbounded within the turn with no ceiling, unlike `TranscriptBuffer` which has
explicit hard caps (`MAX_SEGMENTS`, `MAX_TOTAL_CHARS`). A stuck/never-firing `speech_final`
(observed in real Deepgram streams; `utterance_end_ms` is the fallback but relies on the
`UtteranceEnd` message arriving) means the accumulator never drains.
**Fix:** Maintain a running `Map<number, count>` in the accumulator via `append` instead of
retaining every word, and expose the modal index directly from `commit`. This bounds per-turn
memory to the distinct-speaker count and removes the recompute.

### WR-04: Gateway tests assert the regressed behavior, locking in CR-01

**File:** `src/main/stt/deepgram-stt.gateway.test.ts:186, 359-360, 380-382`
**Issue:**
Multiple tests assert `expect(transcripts).toEqual([])` for `is_final`/`speech_final` runs and
verify only that an `utterance` is emitted. These tests pass against the broken behavior in CR-01
and would need to change once the rolling-buffer feed is restored — so the suite gives false
confidence that the pipeline is complete. There is no test asserting that a finalized turn feeds
`TranscriptBuffer` / the AI span, which is the exact contract that broke.
**Fix:** After fixing CR-01, revise these assertions to expect a final `transcript` event on
commit, and add a gateway-level test (or a small `index.ts` wiring integration test) asserting a
committed turn yields non-empty `finalText`.

## Info

### IN-01: Classifier keeps a leading apostrophe, so contraction-initial words never match openers

**File:** `src/main/stt/question-classifier.utility.ts:68`
**Issue:**
`trimmed.toLowerCase().replace(/^[^a-z']+/, '')` intentionally preserves a leading `'`, so a
sentence like `"'Course we are"` yields `firstWord === "'course"`, which never matches
`QUESTION_OPENERS`. This is a harmless edge (defaults to `'statement'`, D-06) but the retained
apostrophe in the strip class has no upside for the FIRST character.
**Fix:** Strip a leading apostrophe too for the opener check: `.replace(/^[^a-z]+/, '')`, or
document why the leading `'` is intentionally kept.

### IN-02: `sendKeepAlive`/`sendCloseStream` typed as `message: object` but always called with `{}`

**File:** `src/main/stt/deepgram-stt.gateway.ts:35-36, 355, 419`
**Issue:**
The local `IDeepgramLiveSocket` types these as `(message: object)` yet every call site passes
`{}`. The parameter carries no meaning at any call site. Not introduced this phase, but adjacent
to the reviewed diff.
**Fix:** If the SDK requires no payload, type the local shim methods as `(): void` to match how
the gateway actually uses them; otherwise document what a non-empty payload would mean.

### IN-03: `IUtteranceEvent` list rides every high-frequency transcript push, resent in full each time

**File:** `src/main/index.ts:350, 359, 364` and `src/main/overlay-window.manager.ts:96-111`
**Issue:**
Each `jedi:transcript` push spreads `{ ...buffer.renderable(), utterances, ... }`, sending the
entire growing `utterances` array on every interim result (many per second) and every audio-level
tick (~15 fps). The array reference is shared and the payload is structured-cloned across IPC on
each send. Correctness is fine (renderer is a pure view), but the full-array resend on
high-frequency channels is a design smell that will grow with session length. Flagged as info
since performance is out of v1 scope; noting because it compounds with WR-01 (empty cards inflate
the array).
**Fix:** Consider pushing utterances on their own lower-frequency channel or sending only the
delta (new utterances since last push) rather than the full list on every interim/level tick.

---

_Reviewed: 2026-07-06T23:02:15Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
