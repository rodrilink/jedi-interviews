# Phase 8: Diarized Utterance Pipeline - Pattern Map

**Mapped:** 2026-07-06
**Files analyzed:** 8 (3 new + tests, 3 modified, 1 test-extend)
**Analogs found:** 8 / 8 (all in-repo — this phase extends existing STT-layer modules)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/main/stt/question-classifier.utility.ts` (NEW) | utility (pure) | transform | `src/main/audio/pcm-resample.utility.ts` | role-match (pure util) |
| `src/main/stt/question-classifier.utility.test.ts` (NEW) | test | transform | `src/main/audio/pcm-resample.utility.test.ts` | exact |
| `src/main/stt/utterance-accumulator.utility.ts` (NEW) | utility (pure) | transform / accumulate | `src/main/audio/pcm-resample.utility.ts` | role-match (pure util) |
| `src/main/stt/utterance-accumulator.utility.test.ts` (NEW) | test | transform | `src/main/audio/pcm-resample.utility.test.ts` | exact |
| `src/main/stt/speaker-map.ts` (NEW) | model / session state | event-driven / stateful | `src/main/stt/transcript-buffer.ts` | exact (injected-clock, bounded, `clear()`) |
| `src/main/stt/speaker-map.test.ts` (NEW) | test | stateful | `src/main/stt/transcript-buffer.test.ts` (see note) | role-match |
| `src/main/stt/stt-provider.interface.ts` (MODIFY) | interface / contract | contract | itself (`ISttTranscriptEvent` + `on(...)` overloads) | exact |
| `src/main/stt/deepgram-stt.gateway.ts` (MODIFY) | gateway | streaming / event-driven | itself (`handleMessage`, `startKeepAlive`) | exact |
| `src/main/index.ts` (MODIFY) | handler / bootstrap | wiring | itself (`TranscriptBuffer` instantiate + `clear-transcript`) | exact |
| `src/main/stt/deepgram-stt.gateway.test.ts` (EXTEND) | test | streaming | itself (`FakeV1Socket`, keep-alive regression `:274`) | exact |

> **Test co-location convention:** existing STT/audio tests live **next to** their source (`deepgram-stt.gateway.test.ts`, `pcm-resample.utility.test.ts`), NOT in a `test/` subdir. Follow this repo convention — do NOT use the IDEXX `test/` mirror. `transcript-buffer.test.ts` is referenced as the state-model test analog; if it is absent, model on `pcm-resample.utility.test.ts` (both use Vitest + AAA + explicit type annotations).

---

## Pattern Assignments

### `src/main/stt/question-classifier.utility.ts` (utility, transform)

**Analog:** `src/main/audio/pcm-resample.utility.ts`

**Pure-utility conventions to copy** (from the file header, lines 1-12):
- File-level JSDoc block stating the requirement IDs and the purity contract.
- Every export is a **standalone `export function`** — no classes, no state, no side effects, idempotent.
- Explicit return types and explicit param types on every export (IDEXX standard).
- 4-space indent, single quotes.

The purity/no-class discipline (verbatim from the header at `pcm-resample.utility.ts:11-12`):
```typescript
/**
 * Every function is pure and idempotent: no classes, no shared state, no side effects.
 */
```

**Export shape to mirror** (signature style, from `pcm-resample.utility.ts:53` / `:81`):
```typescript
export function resampleLinear(input: Float32Array, inRate: number, outRate: number): Float32Array { ... }
export function float32ToInt16(input: Float32Array): Int16Array { ... }
```

**Core pattern to implement** (from RESEARCH.md "Classification Heuristic", D-07/D-08 — pure, `?` mandatory, borderline defaults to Statement):
```typescript
const QUESTION_OPENERS = new Set([
    'who','what','when','where','why','how','which','whom','whose',
    'do','does','did','is','are','am','was','were',
    'can','could','would','will','shall','should','have','has','had','may','might','must',
]);

function sentenceIsQuestion(sentence: string): boolean {
    const trimmed = sentence.trim();
    if (trimmed.endsWith('?')) return true;                    // D-07: '?' MUST count
    const firstWord = trimmed.toLowerCase().replace(/^[^a-z']+/, '').split(/\s+/)[0] ?? '';
    return QUESTION_OPENERS.has(firstWord);
}

export function classifyUtterance(text: string): 'question' | 'statement' {
    const sentences = text.split(/(?<=[.!?])\s+/);              // D-08: local regex, no NLP dep
    return sentences.some(sentenceIsQuestion) ? 'question' : 'statement';
}
```
> Use the shared `UtteranceClassification` type from the seam file for the return type (see interface section) so the util and the seam agree.

**Constant naming:** module-level constants are SCREAMING_SNAKE_CASE (matches `DEEPGRAM_MODEL`, `WINDOW_MS`, `KEEP_ALIVE_INTERVAL_MS`).

---

### `src/main/stt/utterance-accumulator.utility.ts` (utility, transform/accumulate)

**Analog:** `src/main/audio/pcm-resample.utility.ts` (purity/signature style) + RESEARCH.md Pattern 2 & Pattern 3.

**Purity note:** RESEARCH names this a "pure util (D-10)" that buffers `is_final` word runs and emits on the commit signal. Two shapes are viable and both honor D-10:
- **Pure functions** (mirror `pcm-resample.utility.ts` exactly): `pickModalSpeakerIndex(words)` + a fold that groups words → `{ text, words[] }`.
- **A tiny stateful accumulator class** with `append(words, text)`, `commit(): { text, words } | undefined` (no-op/undefined when empty — Pitfall 4 double-commit guard), and `clear()`. If a class is used, mirror the `TranscriptBuffer` class-doc + `clear()` discipline below rather than the free-function style.

**Modal speaker index** (pure, verbatim-ready from RESEARCH.md Pattern 3):
```typescript
export function pickModalSpeakerIndex(words: ReadonlyArray<{ speaker?: number }>): number | undefined {
    const counts = new Map<number, number>();
    for (const w of words) {
        if (typeof w.speaker === 'number') counts.set(w.speaker, (counts.get(w.speaker) ?? 0) + 1);
    }
    if (counts.size === 0) return undefined; // D-04: no diarization info → neutral bucket
    let best: number | undefined;
    let bestCount = -1;
    for (const [idx, c] of counts) if (c > bestCount) { best = idx; bestCount = c; }
    return best;
}
```

**Double-commit guard (Pitfall 4):** `commit()` MUST be a no-op returning `undefined` when the accumulator is empty, so a trailing `UtteranceEnd` after a `speech_final` is harmlessly ignored.

---

### `src/main/stt/speaker-map.ts` (model, session state — event-driven/stateful)

**Analog:** `src/main/stt/transcript-buffer.ts` — the injected-clock + bounded + `clear()` + by-convention-singleton pattern. This is the closest structural match in the repo.

**Class-doc + by-convention-singleton note to copy** (from `transcript-buffer.ts:44-54`):
```typescript
/**
 * @remarks
 * The Electron main process has no TSyringe DI container, so this is not an `@singleton()`; it is
 * instantiated once in `index.ts` (04-04) and treated as a singleton by convention, mirroring
 * `HotkeyRegistrarService`.
 */
export class TranscriptBuffer {
    /** Retained finalized segments, oldest first. */
    private finals: ITranscriptSegment[] = [];
```
> `SpeakerMap` needs no injected clock (it is index-keyed, not time-keyed) — omit the `now` constructor arg unless a bound/TTL is added. Keep the same `@remarks` singleton-by-convention note verbatim in intent (update the file ref to 08).

**`clear()` pattern to copy verbatim in shape** (from `transcript-buffer.ts:90-97`):
```typescript
/**
 * Empties the buffer entirely — both finalized segments and the current interim. Wired to the
 * clear-transcript hotkey (TRN-04, D-07) via the handler in `index.ts` (04-04).
 */
public clear(): void {
    this.finals = [];
    this.interim = '';
}
```
`SpeakerMap.clear()` must reset BOTH the `index → Person N` map AND the next-person counter so numbering restarts at Person 1 (D-05).

**Core state pattern to implement** (D-03/D-04):
```typescript
export class SpeakerMap {
    private readonly indexToPerson = new Map<number, string>();
    private nextPersonNumber = 1;

    /** First-seen index → 'Person N' (stable for the session). undefined index → neutral 'Speaker' (D-04). */
    public label(speakerIndex: number | undefined): { speaker: string; isDiarized: boolean } {
        if (speakerIndex === undefined) {
            return { speaker: 'Speaker', isDiarized: false }; // D-04: neutral bucket, NOT a Person N
        }
        let person = this.indexToPerson.get(speakerIndex);
        if (person === undefined) {
            person = `Person ${this.nextPersonNumber++}`;      // D-03: deterministic first-seen
            this.indexToPerson.set(speakerIndex, person);
        }
        return { speaker: person, isDiarized: true };
    }

    public clear(): void {
        this.indexToPerson.clear();
        this.nextPersonNumber = 1;
    }
}
```

**Optional bounded-state note:** RESEARCH V5 says SpeakerMap growth is naturally small; only cap if hardening desired. `TranscriptBuffer`'s triple-bound (`WINDOW_MS`/`MAX_SEGMENTS`/`MAX_TOTAL_CHARS`, lines 30-42) is the precedent if a cap is wanted, but it is NOT required this phase.

---

### `src/main/stt/stt-provider.interface.ts` (interface, contract) — MODIFY

**Analog:** the file itself — `ISttTranscriptEvent` (lines 23-28) and the `on(...)` overload style (lines 74-91).

**Existing event-shape precedent to mirror** (lines 23-28):
```typescript
export interface ISttTranscriptEvent {
    /** The recognized transcript text for this update (may be the empty string between phrases). */
    text: string;
    /** `true` for a finalized segment; `false`/absent for an interim (partial) result. */
    isFinal: boolean;
}
```

**Existing `on(...)` overload style to mirror** (lines 74-82) — one overload per literal event name, each with a JSDoc `@param`:
```typescript
on(event: 'transcript', listener: (transcriptEvent: ISttTranscriptEvent) => void): void;
on(event: 'connection-state-change', listener: (state: SttConnectionState) => void): void;
```

**Extension to add** (D-09 / RESEARCH "Seam Extension" — sibling `utterance` event; NO `@deepgram/sdk` import in this file — see header lines 13-14):
```typescript
export type UtteranceClassification = 'question' | 'statement';

export interface IUtteranceEvent {
    /** Finalized utterance text (one turn). */
    text: string;
    /** Stable session label 'Person 1'|… or a neutral 'Speaker' when undiarized (D-04). */
    speaker: string;
    /** Whether this utterance has a Person N (false for the neutral bucket, D-04). */
    isDiarized: boolean;
    /** Local Q/S classification (D-06/D-07/D-08). */
    classification: UtteranceClassification;
}

// added to ISttProvider, alongside the existing overloads:
on(event: 'utterance', listener: (utterance: IUtteranceEvent) => void): void;
```
> Keep the existing `on('transcript', …)` for the D-02 interim live line — do NOT remove it. The seam header (lines 1-14) already documents the "no Deepgram import here" rule; preserve it.

---

### `src/main/stt/deepgram-stt.gateway.ts` (gateway, streaming/event-driven) — MODIFY

**Analog:** the gateway itself — its `IDeepgramMessage` defensive shape, `handleMessage` optional-chain parse, and `startKeepAlive` timer-safety pattern.

**Connect-options pattern to extend** (lines 136-153) — string-literal query params, add `diarize` + `utterance_end_ms`; do NOT add `utterances` (batch-only, RESEARCH):
```typescript
const connection = (await client.listen.v1.connect({
    model: DEEPGRAM_MODEL,
    encoding: 'linear16',
    sample_rate: TARGET_SAMPLE_RATE,
    channels: TARGET_CHANNELS,
    interim_results: 'true',   // keep — REQUIRED for utterance_end_ms
    smart_format: 'true',      // keep — supplies '?' + punctuated_word
    diarize: 'true',           // ADD (string, not boolean — matches the existing convention)
    utterance_end_ms: '1000',  // ADD — enables the UtteranceEnd fallback commit
    Authorization: '',
    reconnectAttempts: 0,
})) as unknown as IDeepgramLiveSocket;
```

**Defensive untrusted-payload parse to extend** (T-4-04 — current `handleMessage` at lines 221-229; extend `IDeepgramMessage` at lines 42-45 with the diarized/finalization fields):
```typescript
// Extend the local defensive shape (lines 42-45):
interface IDeepgramMessage {
    type?: string; // 'Results' | 'Metadata' | 'UtteranceEnd' | 'SpeechStarted'
    is_final?: boolean;
    speech_final?: boolean;
    channel?: {
        alternatives?: Array<{
            transcript?: string;
            words?: Array<{ word?: string; punctuated_word?: string; speaker?: number }>;
        }>;
    };
}
```
Existing optional-chain parse to mirror (lines 222-223) — every field optional-chained, `?? ''`/`?? []` fallbacks, never control flow:
```typescript
const text = message.channel?.alternatives?.[0]?.transcript ?? '';
```

**Message-type switch to add in `handleMessage`** (RESEARCH Pattern 1 & 2 — discriminate on `type`, interim vs accumulate-then-commit):
```typescript
private handleMessage(message: IDeepgramMessage): void {
    if (message.type === 'UtteranceEnd') {
        this.commitPendingUtterance();   // fallback commit; no-op if accumulator empty (Pitfall 4)
        return;
    }
    if (message.type !== undefined && message.type !== 'Results') {
        return;                          // ignore Metadata / SpeechStarted in v1
    }
    const alt = message.channel?.alternatives?.[0];
    const text = alt?.transcript ?? '';
    if (message.is_final !== true) {
        if (text.length > 0) this.emit('transcript', { text, isFinal: false }); // D-02 interim live line
        return;
    }
    this.accumulator.append(alt?.words ?? [], text);  // is_final run
    if (message.speech_final === true) this.commitPendingUtterance(); // D-01 one card per turn
}
```
> `commitPendingUtterance()` drains the accumulator, runs `pickModalSpeakerIndex` + `classifyUtterance`, resolves the `SpeakerMap` label, and emits the new `utterance` seam event. Whether the gateway owns the `SpeakerMap`/classification calls or emits raw and lets `index.ts` label is a plan-time choice — but keep ALL `@deepgram/sdk` coupling inside this file (D-09/QA-07).

**D-11 timer-safety template to replicate** (this is the canonical pattern — copy it for ANY new timer added, e.g. a commit-timeout). From `startKeepAlive`, lines 242-264:
```typescript
this.keepAliveTimer = setInterval(() => {
    if (this.audioSentSinceKeepAlive) { this.audioSentSinceKeepAlive = false; return; }
    if (this.state !== 'connected' || this.connection === undefined) { return; } // state gate
    try {
        this.connection.sendKeepAlive({});
    } catch (error) {
        // socket closed between the state check and the send (transport race) — surface, never crash
        this.emitError(error instanceof Error ? error : new Error('Deepgram keep-alive failed'));
    }
}, KEEP_ALIVE_INTERVAL_MS);
```
> D-11 audit: all four SDK send methods (`sendMedia`, `sendKeepAlive`, `sendFinalize`, `sendCloseStream`) call `assertSocketIsOpen()` which throws synchronously (RESEARCH). `UtteranceEnd` handling runs inside the SDK `message` callback and does NOT `send*`, so it is not a new throw site — but any new timer that touches the socket MUST use the state-gate + try/catch above. `teardownConnection` (lines 313-326) already shows the swallow-teardown-faults pattern.

**report-don't-throw:** transport faults go through `emitError` (lines 208-212, no-op when no `error` listener) — never `throw`.

---

### `src/main/index.ts` (handler/bootstrap, wiring) — MODIFY

**Analog:** the `TranscriptBuffer` instantiation + `clear-transcript` handler wiring in this same file.

**By-convention-singleton instantiation to mirror** (line 366, inside `app.whenReady().then`):
```typescript
// The authoritative rolling transcript buffer (main-owned, TRN-04). Wired into the STT pipeline
// below and wiped by the clear-transcript chord.
const buffer = new TranscriptBuffer();
```
Add `const speakerMap = new SpeakerMap();` in the same block, then thread it into `wireSttPipeline`/`attachSttGatewayHandlers` the SAME way `buffer` is threaded (lines 221, 241-248, 316-323) so a Deepgram re-key re-attaches against the same instance (Pitfall 3).

**Ctrl+Alt+K clear path to extend** (D-05) — the `clear-transcript` handler at lines 121-126 currently wipes only `buffer`; add `speakerMap.clear()` beside `buffer.clear()`:
```typescript
'clear-transcript': (): void => {
    buffer.clear();
    // ADD (D-05): reset Person N numbering so the next session restarts at Person 1
    // speakerMap.clear();
    pushTranscript(window, { ...buffer.renderable(), connectionState: getConnectionState(), audioLevel: 0 });
},
```
> `buildHandlers` (lines 98-105) takes `buffer` as a param; add `speakerMap` (or the utterance state holder) as a sibling param and pass it from `app.whenReady` the same way `buffer` is passed. The `clear-ai` handler (lines 152-155) shows the identical "mutate the main-owned store, then push" shape.

**New `utterance` event binding** — add a `gateway.on('utterance', …)` binding inside `attachSttGatewayHandlers` (alongside the existing `on('transcript')` at lines 324-332), so the re-key path re-attaches it too (Pitfall 3). It pushes the committed utterance to the overlay over the **existing** read-only transcript push channel — NO new renderer→main control channel (Integration Points, CONTEXT.md).

---

### `src/main/stt/deepgram-stt.gateway.test.ts` (test, streaming) — EXTEND

**Analog:** the test file itself — its `FakeV1Socket` harness (lines 19-32), the `vi.mock('@deepgram/sdk', …)` (lines 38-50), the `emitTranscriptMessage` helper (lines 54-61), and the keep-alive regression at `:274`.

**`FakeV1Socket` harness to reuse** (lines 19-32) — real `EventEmitter` subclass with `vi.fn()` spies for the send methods; add `sendFinalize` if the gateway starts calling it:
```typescript
class FakeV1Socket extends EventEmitter {
    public readonly sendMedia = vi.fn<(message: ArrayBuffer | ArrayBufferView) => void>();
    public readonly sendKeepAlive = vi.fn<(message: object) => void>();
    public readonly sendCloseStream = vi.fn<(message: object) => void>();
    public readonly connect = vi.fn<() => void>();
    public readonly waitForOpen = vi.fn<() => Promise<unknown>>(() => Promise.resolve(undefined));
    public readonly close = vi.fn<() => void>();
}
```

**Message-emit helper to extend** (lines 54-61) — add `speaker` per word, `speech_final`, and an `emitUtteranceEnd()` sibling:
```typescript
function emitResultsMessage(transcript: string, isFinal: boolean, opts?: {
    speechFinal?: boolean;
    words?: Array<{ punctuated_word?: string; speaker?: number }>;
}): void {
    fakeSocket.emit('message', {
        type: 'Results',
        is_final: isFinal,
        speech_final: opts?.speechFinal,
        channel: { alternatives: [{ transcript, words: opts?.words }] },
    });
}
function emitUtteranceEnd(): void {
    fakeSocket.emit('message', { type: 'UtteranceEnd', channel: [0], last_word_end: 1.2 });
}
```

**AAA + fake-timers + module-import conventions to keep** (from every test):
- `beforeEach`: `vi.clearAllMocks(); vi.useFakeTimers();` + fresh `FakeV1Socket` + `mockConnect.mockResolvedValue(fakeSocket)` (lines 64-70).
- `afterEach`: `vi.useRealTimers()` (line 73).
- Import the SUT inside each test: `const { DeepgramSttGateway } = await import('./deepgram-stt.gateway');` (so the `vi.mock` applies).
- Explicit type annotations on all test objects/arrays (`const transcripts: ISttTranscriptEvent[] = []`).
- AAA comments on their own lines, no trailing explanation.

**Keep-alive regression to KEEP (D-11, already present at `:274`)** — this is the template for any new "timer tick while socket not open must not throw" test:
```typescript
it('should not throw when a keep-alive tick races a socket that is not open', async () => {
    // Arrange
    const { DeepgramSttGateway } = await import('./deepgram-stt.gateway');
    const gateway = new DeepgramSttGateway(FAKE_API_KEY);
    gateway.on('error', () => undefined);
    fakeSocket.sendKeepAlive.mockImplementation(() => { throw new Error('Socket is not open.'); });
    // Act
    await gateway.start();
    fakeSocket.emit('open');
    // Assert
    await expect(vi.advanceTimersByTimeAsync(10_000)).resolves.not.toThrow();
});
```

**New tests to add:** `diarize`/`utterance_end_ms` present on the connect args; `UtteranceEnd` triggers a commit; one `utterance` per `speech_final` (no over-commit per `is_final`); no double-commit on `speech_final` then trailing `UtteranceEnd`; malformed diarized payload (missing `words`/`speaker`) never throws; `utterance` seam event carries `speaker` + `classification`.

**Pure-utility test analog for the three new `*.test.ts`** (`pcm-resample.utility.test.ts:1-2, 14-46`) — Vitest, one `describe` per source file with nested `describe` per exported function, AAA comments, explicit types, small hand-built input builders:
```typescript
import { describe, expect, it } from 'vitest';
import { classifyUtterance } from './question-classifier.utility';

describe('question-classifier.utility', () => {
    describe('classifyUtterance', () => {
        it('should classify a sentence ending in a question mark as a question', () => {
            // Arrange
            const text = 'Can you walk me through the design?';
            // Act
            const result = classifyUtterance(text);
            // Assert
            expect(result).toBe('question');
        });
    });
});
```

---

## Shared Patterns

### By-convention singletons (NO TSyringe in main)
**Source:** `transcript-buffer.ts:44-54`, `deepgram-stt.gateway.ts:62-66`, `stt-provider.interface.ts:44-53`
**Apply to:** `SpeakerMap` and any stateful accumulator.
Every main-process class carries the `@remarks` note: not an `@singleton()`, instantiated once in `index.ts`, "treated as a singleton by convention, mirroring `HotkeyRegistrarService`." Copy that note (updating the file ref to 08).

### Defensive untrusted-payload parse (T-4-04)
**Source:** `deepgram-stt.gateway.ts:41-45` (`IDeepgramMessage` local shape) + `:221-223` (`handleMessage` optional-chain).
**Apply to:** the diarized-payload parse (new `words[]`/`speaker` fields). Every Deepgram field optional-chained with `?? ''`/`?? []`; a malformed payload yields text/empty, never control flow.

### report-don't-throw + D-11 timer safety
**Source:** `deepgram-stt.gateway.ts:208-212` (`emitError`, no-op without listener), `:242-264` (state-gate + try/catch timer), `:313-326` (swallow teardown faults).
**Apply to:** the gateway's message/commit path and ANY new timer. Transport/socket faults surface via `error`, never `throw`; every timer callback that touches the socket uses the `state === 'connected'` gate + try/catch.

### Pure utility discipline (D-10)
**Source:** `pcm-resample.utility.ts:1-12` (header) + export style.
**Apply to:** `question-classifier.utility.ts`, `utterance-accumulator.utility.ts` (and the `pickModalSpeakerIndex` helper). Standalone `export function`s, no classes/state/side-effects, idempotent, explicit param + return types, SCREAMING_SNAKE_CASE module constants.

### Interim-replaced-never-accumulated (D-02)
**Source:** `transcript-buffer.ts:80-88` (`setInterim`) + `index.ts:324-332` (`on('transcript')` handler).
**Apply to:** the D-02 live in-progress line — emit interim text as a single replaced item, never appended.

### Vitest test conventions (universal)
**Source:** `deepgram-stt.gateway.test.ts` (mock/timers/harness) + `pcm-resample.utility.test.ts` (pure-util shape).
**Apply to:** all four test files. AAA comments on their own lines; explicit type annotations on every test object/array; `vi.clearAllMocks()` in `beforeEach`; fake timers with `useRealTimers` teardown for the gateway; co-located `*.test.ts` (NOT a `test/` subdir).

### Seam-only, no Deepgram coupling (D-09/QA-07)
**Source:** `stt-provider.interface.ts:1-14` header ("no Deepgram import live here") + the single-file `@deepgram/sdk` import at `deepgram-stt.gateway.ts:2`.
**Apply to:** every new file except the gateway. Only `deepgram-stt.gateway.ts` may import `@deepgram/sdk`. Verifiable via `rg "@deepgram/sdk" src --files-with-matches` returning only the gateway.

---

## No Analog Found

None. Every file in this phase either extends an existing STT-layer module or copies the pure-utility / bounded-state / gateway-test patterns already established in `src/main/stt/` and `src/main/audio/`.

## Metadata

**Analog search scope:** `src/main/stt/`, `src/main/audio/`, `src/main/index.ts`
**Files scanned:** `stt-provider.interface.ts`, `transcript-buffer.ts`, `deepgram-stt.gateway.ts`, `deepgram-stt.gateway.test.ts`, `pcm-resample.utility.ts`, `pcm-resample.utility.test.ts`, `index.ts` (targeted sections)
**Pattern extraction date:** 2026-07-06
</content>
</invoke>
