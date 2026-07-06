# Phase 8: Diarized Utterance Pipeline - Research

**Researched:** 2026-07-06
**Domain:** Deepgram v5 live-streaming diarization + utterance segmentation; local Q/S classification; STT-seam extension
**Confidence:** HIGH (the Deepgram unknowns were resolved against the exact installed `@deepgram/sdk@5.4.0` type definitions plus official Deepgram docs)

## Summary

The single genuine external unknown for this phase — the exact shape of Deepgram v5's live diarization payload and which signal to key an utterance commit on — is now fully resolved, and it overturns one assumption baked into CONTEXT.md and CLAUDE.md.

**Headline finding (HIGH, verified against the installed SDK types):** On a **live** streaming connection there is **no `utterances` option and no per-utterance `speaker` field**. `utterances: true` is a *pre-recorded/batch-only* option — it is not present in `V1Client.ConnectArgs`. On the live socket, diarization is delivered **per word** at `channel.alternatives[0].words[].speaker` (an integer starting at 0), and utterance boundaries are delivered through the **finalization signals** (`is_final` / `speech_final`) and the separate **`UtteranceEnd`** message — not through an utterances array. The plan must therefore build utterance grouping itself from words + finalization signals; it cannot lean on a Deepgram-provided per-utterance object.

**Primary recommendation:** Enable `diarize: true` (keep `interim_results: 'true'` and `smart_format: 'true'` as they already are) and add `utterance_end_ms: '1000'` on the live `listen.v1.connect(...)`. Commit one "card-ready" utterance on **`speech_final === true`** as the primary signal, with **`UtteranceEnd`** as a fallback commit for the case where a `speech_final` never arrives (noisy audio). Group words between commits into a single utterance; derive its stable `Person N` from the **majority (modal) per-word speaker index** in that utterance; classify locally. Parse every Deepgram field with optional chaining and add a one-time raw-payload log behind a debug flag to confirm the live shape on the target machine before locking the parse.

Everything else in the phase (the `ISttProvider` seam, the gateway connect/handleMessage/keep-alive scaffolding, the `TranscriptBuffer` bounded-buffer + injected-clock + `clear()` pattern, main-owned singletons) is already implemented in-repo and well understood. The folded keep-alive-crash regression (todo 260620) is **already fixed and already tested** (`deepgram-stt.gateway.test.ts:274`); Phase 8's D-11 work is an audit + a class-level invariant, not a net-new fix.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Utterance finalization & interim (QA-01)**
- **D-01:** Commit an utterance to a finalized "card-ready" entry the moment Deepgram marks it final (per utterance). Cards appear promptly, one per finalized utterance. The exact Deepgram signal (`is_final` vs `speech_final` vs `utterance_end`) is Claude's discretion at plan/research time — the required *behavior* is prompt, stable, one-entry-per-utterance commits.
- **D-02:** While an utterance is still being spoken (interim, not yet finalized), it is emitted as ONE distinct **live, unclassified** in-progress item — no speaker `Person N` number required, no Q/S classification, no card frame. It resolves into a properly labeled finalized utterance on finalization. Only finalized utterances carry a `Q1`/`S3`-style sequence + classification. Interim is *replaced* in place, never accumulated (mirrors `TranscriptBuffer.setInterim`).

**Speaker identity — stable `Person N` map (QA-02)**
- **D-03:** Deterministic first-seen assignment: the first time a Deepgram speaker index appears, assign the next `Person N` (Person 1, Person 2, …). Same index → same `Person N` for the whole session. Accept the minor risk that Deepgram over-splitting one voice briefly yields an extra Person — simplest, deterministic, testable. No people-count cap.
- **D-04:** Utterances with **no diarization info** (no speaker index) get a neutral label (e.g. `Unknown` / `Speaker`) and are kept OUT of the numbered `Person N` list — do not invent a person Deepgram didn't attribute, and do not merge into the last-known speaker.
- **D-05:** The speaker map is session-scoped state (held in main, alongside `TranscriptBuffer`) and **resets together with the transcript on Ctrl+Alt+K**, so `Person N` numbering restarts cleanly for the next session.

**Question/statement classification — local heuristic (QA-03)**
- **D-06:** Classification is a **local, pure, unit-testable** heuristic — NO per-utterance AI call (honors "AI calls are user-triggered only"). Default to **Statement** when not confidently a question.
- **D-07:** A sentence is a Question if it ends with `?` (Deepgram `smart_format` supplies punctuation) OR starts with an interrogative (who/what/when/where/why/how/which) or an auxiliary/modal opener (do/does/did/is/are/can/could/would/will/should/have). Otherwise Statement. Exact opener/aux word list is Claude's discretion; `?` MUST count and borderline MUST default to Statement. Polite-imperative questions ("walk me through X") falling to Statement is acceptable by design.
- **D-08:** For a **multi-sentence utterance**, classify the whole card as a **Question if ANY sentence in it reads as a question** (split on sentence boundaries, run D-07 per sentence). Questions are the high-value signal. Composes with D-06's "default Statement".

**Seam discipline (QA-07 / TRN-05)**
- **D-09:** The utterance shape — text, stable speaker label, and Q/S classification — MUST be emitted through the existing `ISttProvider` seam. Extend `ISttTranscriptEvent` (or add a sibling utterance event) to carry `speaker` + classification; do NOT couple consumers to `@deepgram/sdk`. No consumer imports the Deepgram SDK. A future Whisper provider must be able to emit the same contract.
- **D-10:** Keep the speaker-map and classification logic in **pure, injectable utilities** (mirrors `pcm-resample.utility` + injected-clock) so both are unit-tested without a live socket.

**Timer/callback safety (folded todo 260620)**
- **D-11:** **Phase invariant:** no `setInterval`/`setTimeout` callback in the Deepgram gateway may throw an uncaught exception. Every timer callback wraps its socket calls so a closed-socket throw can never escape into an uncaught main-process exception.

### Claude's Discretion
- Exact Deepgram finalization signal to key the commit on (`is_final` / `speech_final` / `utterance_end`) — pick based on what `nova-3` + `utterances`/`diarize` actually emits. **→ Resolved in this research: see "The Finalization Signals" and D-01 recommendation.**
- The precise per-word `speaker` index / utterance-boundary payload shape from Deepgram. **→ Resolved: `channel.alternatives[0].words[].speaker`; boundaries via finalization signals, not an utterances array.**
- The exact interrogative-opener / auxiliary-verb word list for D-07. **→ Concrete recommended list below.**
- The concrete extension shape of the seam event (extend `ISttTranscriptEvent` vs a new sibling utterance event) — as long as D-09 holds. **→ Recommendation below (sibling event).**

### Deferred Ideas (OUT OF SCOPE)
None raised during discussion. The card UI, Q/S visual styling, and people-list rendering are **Phase 9** (QA-04/QA-05/QA-06), not deferrals. Reviewed-but-not-folded todos: 260617 (Phase 4 audio-seam warnings), 260618-hud-session-date, 260618-scrollbar (renderer/Phase 9 concerns).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| **QA-01** | Transcript captured as discrete per-speaker utterances (Deepgram diarization + utterance segmentation), not one continuous stream | `diarize: true` on live connect (VERIFIED option); utterance boundaries built from `speech_final`/`UtteranceEnd` + per-word grouping (`utterances` is batch-only — NOT available live). See "Standard Stack", "The Finalization Signals", "Pattern 1/2". |
| **QA-02** | Each utterance attributed to a stable `Person 1/2/…` for the whole session | Per-word `speaker` index at `channel.alternatives[0].words[].speaker`; derive utterance speaker by modal index; stable first-seen map (D-03). See "Speaker Attribution" + "Pattern 3". |
| **QA-03** | Each utterance classified Question/Statement by a local heuristic, default Statement | `smart_format: true` supplies `?` punctuation and `punctuated_word`; pure classification utility (D-07/D-08). See "Classification Heuristic". |
| **QA-07** | Utterance/speaker data flows through the existing `ISttProvider` seam; no consumer imports Deepgram | Extend the seam with a sibling `utterance` event carrying `text` + `speaker` + `classification`. See "Seam Extension". |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Enable diarization/utterance-end on the Deepgram socket | Main / STT gateway (`DeepgramSttGateway`) | — | Only the gateway touches `@deepgram/sdk`; connect options live here (D-09). |
| Parse per-word `speaker` + finalization signals from raw payload | Main / STT gateway | — | Untrusted-payload parsing (T-4-04) belongs where the SDK boundary is. |
| Group words → one utterance; pick modal speaker index | Main / pure utility | STT gateway (calls it) | Pure, unit-testable per D-10; gateway/model orchestrates. |
| Stable Deepgram-index → `Person N` map | Main / session state (alongside `TranscriptBuffer`) | pure utility | Session-scoped, resets on Ctrl+Alt+K (D-05); mapping logic is a pure util (D-10). |
| Q/S classification | Main / pure utility | — | Local, no AI call (D-06); pure + injectable (D-10). |
| Emit typed utterance event through the seam | Main / seam contract (`ISttProvider`) | — | Backend-agnostic contract (D-09/QA-07). |
| Render cards, Q/S styling, people list | **Renderer (Phase 9)** | — | Out of scope this phase. |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@deepgram/sdk` | `5.4.0` (installed; pinned) | Live streaming STT + diarization | Already the app's STT backend; v5 live socket is the seam impl. `[VERIFIED: node -e require('@deepgram/sdk/package.json').version → 5.4.0]` |

**No new packages are required for this phase.** Speaker-map, word-grouping, and classification are pure in-repo TypeScript utilities. Sentence splitting for D-08 is a small local regex utility — do NOT add an NLP library (see "Don't Hand-Roll").

**Version note:** installed `@deepgram/sdk` is `5.4.0`; latest published is `5.5.0` `[VERIFIED: npm view @deepgram/sdk version → 5.5.0, 2026-07-06]`. CLAUDE.md pins 5.4.0 and the gateway is verified against it — **do not upgrade in this phase**; all findings below are from the 5.4.0 type definitions actually installed.

### The Deepgram live connect options (VERIFIED against installed `V1Client.ConnectArgs`)

Source: `node_modules/@deepgram/sdk/dist/cjs/api/resources/listen/resources/v1/client/Client.d.ts` — `[VERIFIED: installed SDK 5.4.0 types]`

Options **present** on the live `ConnectArgs` and relevant here:

| Option | Type (installed) | Purpose | Recommendation for Phase 8 |
|--------|------------------|---------|----------------------------|
| `model` | `ListenV1Model` | model id | keep `'nova-3'` (already set) |
| `diarize` | `'true' \| 'false' \| string` | "Recognize speaker changes. Each word … assigned a speaker number starting at 0" | **set `'true'`** — string, not boolean (matches the existing string-literal convention in the gateway) |
| `interim_results` | `'true' \| 'false' \| string` | ongoing partial updates | keep `'true'` (already set) — **required** for `utterance_end_ms` |
| `smart_format` | `'true' \| 'false' \| string` | formatting incl. punctuation | keep `'true'` (already set) — supplies `?` and `punctuated_word` for D-07 |
| `utterance_end_ms` | `unknown` (docstring: "how long Deepgram will wait to send an UtteranceEnd message … Use with interim_results") | ms silence gap that triggers `UtteranceEnd` | **add `'1000'`** — enables the `UtteranceEnd` fallback commit signal |
| `endpointing` | `unknown` (docstring: "immediately finalizes … returns the transcript with a speech_final parameter set to true") | ms pause that triggers `speech_final` | leave at default (do not set); default endpointing already produces `speech_final` |
| `vad_events` | `'true' \| 'false' \| string` | emit `SpeechStarted` messages | optional; not needed for D-01/D-02 (skip for MVP) |

Options **NOT present** on the live `ConnectArgs` — critical:
- **`utterances`** — DOES NOT EXIST on `V1Client.ConnectArgs`. It is a pre-recorded/batch-only option. `[VERIFIED: absent from installed ConnectArgs; CITED: developers.deepgram.com/docs/diarization — utterances shown only for batch]`. **The CONTEXT.md/CLAUDE.md "`utterances: true` on the live connection" assumption is incorrect** — do not add it; it will be a no-op query param at best.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Group per-word `speaker` in the gateway | `multichannel` | multichannel splits *audio channels*, not speakers on one mixed loopback stream — wrong tool for diarization on a single mixed source |
| `speech_final` primary commit | `is_final` primary commit | `is_final` fires many times mid-turn (multiple per utterance) → would produce multiple cards per utterance, violating D-01's "one entry per utterance". `is_final` is the *interim→final* boundary, not the *turn* boundary |
| Local regex sentence split | `sentence-splitter`/`compromise`/`nlp.js` | Overkill dependency for a `?`/opener heuristic; adds supply-chain surface for a personal app. See "Don't Hand-Roll" |

## Package Legitimacy Audit

No external packages are installed in this phase. `@deepgram/sdk@5.4.0` is already a project dependency (added in Phase 4) and is not being changed. Slopcheck is therefore not applicable to new installs.

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| `@deepgram/sdk` (already installed, unchanged) | npm | mature | high | github.com/deepgram/deepgram-js-sdk | n/a (not a new install) | Pre-approved (Phase 4) |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Architecture Patterns

### System Architecture Diagram

```
Loopback PCM (Int16, 16 kHz mono)
        │  sendAudio(pcm)
        ▼
┌───────────────────────────────────────────────────────────────────┐
│ DeepgramSttGateway (main; the ONLY module importing @deepgram/sdk)  │
│   connect: { model:'nova-3', diarize:'true', interim_results:'true',│
│              smart_format:'true', utterance_end_ms:'1000', … }      │
│                                                                     │
│   on('message', msg) ──► switch(msg.type):                          │
│      'Results'  ──► words[] w/ .speaker, transcript, is_final,      │
│                     speech_final  ──► feed UtteranceAccumulator     │
│      'UtteranceEnd' ─────────────────► commit fallback              │
│      'Metadata' / 'SpeechStarted' ───► ignore (v1)                  │
└───────────────────────────────────────────────────────────────────┘
        │ interim words          │ speech_final===true OR UtteranceEnd
        │ (D-02 live line)       │ (commit one utterance — D-01)
        ▼                        ▼
┌──────────────────────┐   ┌──────────────────────────────────────────┐
│ interim emit          │   │ UtteranceAccumulator (pure util, D-10)   │
│ text only, no speaker │   │  buffers is_final Results words →        │
│ no class (D-02)       │   │  { text, wordsWithSpeaker[] }            │
└──────────────────────┘   └──────────────────────────────────────────┘
                                        │ finalized utterance
                                        ▼
             ┌──────────────────────────────────────────────────────┐
             │ pure utils (D-10, unit-tested w/o socket):            │
             │  pickModalSpeakerIndex(words) → number | undefined    │
             │  classifyUtterance(text) → 'question' | 'statement'   │
             └──────────────────────────────────────────────────────┘
                                        │
                                        ▼
             ┌──────────────────────────────────────────────────────┐
             │ SpeakerMap (session state, alongside TranscriptBuffer)│
             │  firstSeen index → Person N ; undefined → neutral     │
             │  .clear() wired into Ctrl+Alt+K path (D-05)           │
             └──────────────────────────────────────────────────────┘
                                        │ IUtteranceEvent
                                        ▼
             ISttProvider seam  ──►  main-owned utterance state  ──►
             existing read-only overlay push channel  ──►  Phase 9 panel
```

### Recommended Project Structure
```
src/main/stt/
├── stt-provider.interface.ts        # EXTEND: add IUtteranceEvent + on('utterance', …) (D-09)
├── deepgram-stt.gateway.ts          # EXTEND: diarize + utterance_end_ms; message switch; accumulator wiring; D-11 audit
├── transcript-buffer.ts             # unchanged (pattern donor)
├── utterance-accumulator.utility.ts # NEW pure util: buffer is_final words, emit on commit signal (D-10)
├── speaker-map.ts                   # NEW session state: index → Person N, neutral for undefined, clear() (D-03/D-04/D-05)
├── question-classifier.utility.ts   # NEW pure util: D-07/D-08 heuristic (D-10)
└── test/ (or co-located *.test.ts, matching existing convention)
    ├── utterance-accumulator.utility.test.ts
    ├── speaker-map.test.ts
    ├── question-classifier.utility.test.ts
    └── deepgram-stt.gateway.test.ts # EXTEND: diarized payload parse + keep-alive regression (already present)
```
Note: existing tests are **co-located** (`deepgram-stt.gateway.test.ts` next to source), NOT in a `test/` subdir — follow the existing repo convention, not the IDEXX `test/` mirror.

### Pattern 1: Message-type switch in `handleMessage`
**What:** The live socket delivers four message types (`Results`, `Metadata`, `UtteranceEnd`, `SpeechStarted`) on the same `'message'` event. The current gateway assumes every message is a `Results`. With diarization + `utterance_end_ms`, `UtteranceEnd` messages now arrive and must be handled distinctly.
**When to use:** Always, once `utterance_end_ms` is set.
```typescript
// Source: installed @deepgram/sdk@5.4.0 — Socket.d.ts
//   type Response = ListenV1Results | ListenV1Metadata | ListenV1UtteranceEnd | ListenV1SpeechStarted
// All four arrive on connection.on('message'). Discriminate on `type`.
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

private handleMessage(message: IDeepgramMessage): void {
    if (message.type === 'UtteranceEnd') {
        this.commitPendingUtterance(); // fallback commit (no preceding speech_final)
        return;
    }
    if (message.type !== undefined && message.type !== 'Results') {
        return; // ignore Metadata / SpeechStarted in v1
    }
    // ... Results handling (Pattern 2)
}
```

### Pattern 2: Interim vs. accumulate-then-commit (D-01 / D-02)
**What:** `is_final: true` can fire multiple times within one spoken turn; `speech_final: true` marks the end of the turn. Buffer the `is_final` word runs, emit interim (D-02) while `is_final` is falsy, and commit ONE utterance when `speech_final === true` (or on `UtteranceEnd` fallback).
```typescript
// Source: CITED developers.deepgram.com/docs/understand-endpointing-interim-results —
//   "Long utterances may have multiple is_final:true responses before speech_final:true.
//    Do not use speech_final alone to capture full transcripts; concatenate is_final
//    transcripts into a buffer, then treat speech_final:true as utterance completion."
const results = message.channel?.alternatives?.[0];
const text = results?.transcript ?? '';

if (message.is_final !== true) {
    // D-02: live, unclassified, no speaker number, replaced in place
    if (text.length > 0) this.emitInterim(text);
    return;
}

// is_final === true: append this finalized segment's words to the accumulator
this.accumulator.append(results?.words ?? [], text);

if (message.speech_final === true) {
    this.commitPendingUtterance(); // D-01: one card-ready utterance
}
```

### Pattern 3: Modal (majority) speaker index per utterance (D-03)
**What:** Because `speaker` is per-word, an utterance may contain words attributed to different indices (diarization jitter). Pick the **modal** index across the utterance's words as the utterance speaker. Words with no `speaker` field are ignored for the vote; if NO word has a speaker index, the utterance has no diarization → neutral label (D-04).
```typescript
// Pure util (D-10) — unit-testable without a socket.
export function pickModalSpeakerIndex(words: ReadonlyArray<{ speaker?: number }>): number | undefined {
    const counts = new Map<number, number>();
    for (const w of words) {
        if (typeof w.speaker === 'number') counts.set(w.speaker, (counts.get(w.speaker) ?? 0) + 1);
    }
    if (counts.size === 0) return undefined; // D-04: no diarization info
    let best: number | undefined;
    let bestCount = -1;
    for (const [idx, c] of counts) if (c > bestCount) { best = idx; bestCount = c; }
    return best;
}
```

### Classification Heuristic (D-07 / D-08)
**Recommended interrogative + auxiliary opener list** (Claude's discretion per D-07; `?` is mandatory, borderline defaults to Statement):
- Interrogatives: `who what when where why how which whom whose`
- Auxiliary/modal openers: `do does did is are am was were can could would will shall should have has had may might must`

```typescript
// Source: local heuristic (D-07/D-08). Pure util (D-10). smart_format supplies '?' + punctuated_word.
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
    // D-08: split on sentence boundaries; Question if ANY sentence is a question; else default Statement (D-06).
    const sentences = text.split(/(?<=[.!?])\s+/);
    return sentences.some(sentenceIsQuestion) ? 'question' : 'statement';
}
```
Note: with `smart_format: true`, `?` is reliably supplied when Deepgram detects an interrogative intonation/structure — but it is NOT guaranteed for every spoken question, which is exactly why the opener list is the second signal. `[CITED: developers.deepgram.com — smart_format applies punctuation]`. Confirm on-machine that `?` appears in `transcript`/`punctuated_word` (the debug log in "Common Pitfalls" covers this).

### Seam Extension (D-09 / QA-07) — recommendation
Prefer a **sibling `utterance` event** over overloading `ISttTranscriptEvent`, because the interim/live line (D-02, no speaker, no class) and the committed utterance (speaker + class) have genuinely different shapes; forcing both through one interface pushes optional-field noise onto every consumer.
```typescript
// Extend the pure contract file — NO Deepgram import here (D-09).
export type UtteranceClassification = 'question' | 'statement';

export interface IUtteranceEvent {
    /** Finalized utterance text (one turn). */
    text: string;
    /** Stable session label: 'Person 1' | 'Person 2' | … or a neutral 'Speaker'/'Unknown' when undiarized (D-04). */
    speaker: string;
    /** Whether this utterance is diarized (has a Person N) — false for the neutral bucket (D-04). */
    isDiarized: boolean;
    /** Local Q/S classification (D-06/D-07/D-08). */
    classification: UtteranceClassification;
}

// on the ISttProvider interface:
on(event: 'utterance', listener: (utterance: IUtteranceEvent) => void): void;
```
The existing `on('transcript', …)` stays for the D-02 interim live line (`isFinal:false`) so nothing downstream breaks; the new `on('utterance', …)` carries the committed cards. A future Whisper provider emits the same two events.

### Anti-Patterns to Avoid
- **Setting `utterances: true` on the live connect.** It is not a live option; it does nothing (or is silently dropped as an unknown query param). Utterance grouping is your responsibility from words + finalization signals.
- **Committing a card on every `is_final: true`.** Produces multiple cards per turn. Commit on `speech_final`/`UtteranceEnd` only.
- **Merging an undiarized utterance into the previous speaker (D-04 violation).** Keep it in the neutral bucket, out of the numbered list.
- **Accumulating interim text.** D-02 says replace-in-place, mirroring `TranscriptBuffer.setInterim`.
- **Any Deepgram import outside the gateway.** Breaks D-09/QA-07.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Detecting end-of-turn | A custom VAD / silence timer over PCM | Deepgram `speech_final` + `UtteranceEnd` (`utterance_end_ms`) | Deepgram already does word-timing-gap turn detection server-side; `UtteranceEnd` even ignores non-speech noise (door, ring, street). `[CITED: developers.deepgram.com/docs/understanding-end-of-speech-detection]` |
| Speaker separation | Any local audio clustering | Deepgram `diarize` | Diarization is a server feature; per-word `speaker` is delivered for free once enabled |
| Punctuation / `?` insertion | Custom punctuator | Deepgram `smart_format` (already on) | Supplies `?` and `punctuated_word` |

| Problem | DO Hand-Roll (intentionally) | Why |
|---------|------------------------------|-----|
| Sentence split for D-08 | Small local regex (`/(?<=[.!?])\s+/`) | An NLP dependency (`compromise`, `nlp.js`, `sentence-splitter`) is unjustified supply-chain surface for a `?`/opener heuristic in a personal app |
| Q/S classification | Local pure util (D-06) | Explicitly must NOT be an AI call ("AI calls are user-triggered only") |
| index→`Person N` map | Local session structure | Trivial, deterministic, and must reset with the transcript (D-05) |

**Key insight:** the phase's "utterance segmentation" is a *composition* of Deepgram signals (per-word speaker + `speech_final`/`UtteranceEnd`), not a single Deepgram object. Build the small grouping/classification/mapping utilities locally; lean on Deepgram for the hard parts (VAD, diarization, punctuation).

## Runtime State Inventory

This phase is code-only (extends existing main-process modules and the seam contract). It adds new in-memory session state (`SpeakerMap`) but persists nothing and registers nothing with the OS.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — the app persists no transcript/utterance data (`transcript-buffer.ts` header: "never persisted"). The new `SpeakerMap` is in-memory session state. | None |
| Live service config | None — the only external service is Deepgram; its behavior is controlled by connect-time query params in code, not by any external UI/DB config that lives outside git. | None |
| OS-registered state | None — no Task Scheduler / services / registry entries touched. | None |
| Secrets/env vars | `DEEPGRAM_API_KEY` is already read in main (`.env` in dev / `safeStorage` when packaged). This phase does NOT change key handling. | None |
| Build artifacts | None — no `pyproject.toml`/egg-info/binary artifacts; TypeScript rebuild via electron-vite is routine. `uiohook-napi` native rebuild is unaffected. | None |

**Nothing found in any category requiring migration** — verified against the code headers and CLAUDE.md persistence notes.

## Common Pitfalls

### Pitfall 1: Assuming a live `utterances` array / per-utterance speaker
**What goes wrong:** Plan tasks reference a `channel.alternatives[0]` per-utterance `speaker` or a top-level `utterances[]` that never arrives on the live socket → parse returns undefined, no cards ever commit.
**Why it happens:** Batch/pre-recorded docs and the CONTEXT/CLAUDE assumption of `utterances: true` bleed into live-connection expectations.
**How to avoid:** Speaker is **per word** (`words[].speaker`); utterance grouping is derived from finalization signals. Confirmed against installed SDK types.
**Warning signs:** No `utterance` events emitted despite audio flowing and interim text appearing.

### Pitfall 2: One card per `is_final` (over-commit)
**What goes wrong:** Multiple cards for a single spoken sentence.
**Why:** `is_final: true` fires repeatedly mid-turn.
**How to avoid:** Commit on `speech_final`/`UtteranceEnd`; accumulate `is_final` runs in between (Pattern 2).
**Warning signs:** Utterance count far exceeds spoken turns.

### Pitfall 3: `UtteranceEnd` never arrives (missing `interim_results`)
**What goes wrong:** The `UtteranceEnd` fallback commit never fires.
**Why:** `utterance_end_ms` **requires** `interim_results: true`. `[CITED: developers.deepgram.com — "When using utterance_end_ms, setting interim_results=true is also required"]`
**How to avoid:** Keep `interim_results: 'true'` (already set) alongside `utterance_end_ms: '1000'`.
**Warning signs:** In quiet audio, cards commit fine (via `speech_final`) but in noisy audio a turn never commits.

### Pitfall 4: Double-commit on `speech_final` then `UtteranceEnd`
**What goes wrong:** `UtteranceEnd` may follow a `speech_final` for the same turn → two commits.
**Why:** The docs note `UtteranceEnd` "may be followed" after `speech_final` and "can be ignored" in that case. `[CITED: developers.deepgram.com/docs/understanding-end-of-speech-detection]`
**How to avoid:** Make `commitPendingUtterance()` a no-op when the accumulator is empty (a `speech_final` commit already drained it), so the trailing `UtteranceEnd` is harmlessly ignored.
**Warning signs:** Occasional empty/duplicate cards after a turn.

### Pitfall 5: Diarization changes message volume/timers (D-11 scope)
**What goes wrong:** New `UtteranceEnd` messages + potentially new timers could reintroduce the closed-socket throw class.
**How to avoid:** Apply the D-11 blanket invariant — every timer callback wraps its `connection.send*` calls. Note that ALL four SDK send methods (`sendMedia`, `sendKeepAlive`, `sendFinalize`, `sendCloseStream`) call `assertSocketIsOpen()` which throws `Error("Socket is not open.")` synchronously. `[VERIFIED: Socket.js lines 94/98/102/106 + 144-150]`. `UtteranceEnd` handling itself runs inside the `message` handler (already inside the SDK's callback, not a timer) and does not `send*`, so it is not a new throw site — but any *new* timer added for a commit-timeout would be.
**Warning signs:** "A JavaScript error occurred in the main process" during reconnect/noisy sessions.

## Code Examples

### Verified live message discrimination
```typescript
// Source: VERIFIED @deepgram/sdk@5.4.0 Socket.d.ts —
//   type Response = ListenV1Results | ListenV1Metadata | ListenV1UtteranceEnd | ListenV1SpeechStarted
// ListenV1Results fields (VERIFIED ListenV1Results.d.ts):
//   type:'Results', is_final?, speech_final?, channel.alternatives[].{transcript, words[]}
//   words[].{ word, start, end, confidence, punctuated_word?, speaker? }   ← speaker is per-word, optional
// ListenV1UtteranceEnd (VERIFIED): { type:'UtteranceEnd', channel:number[], last_word_end:number }
```

### Defensive parse (T-4-04) of the diarized payload
```typescript
// Every field optional-chained; a malformed payload yields text/undefined, never a throw.
const alt = message.channel?.alternatives?.[0];
const words = alt?.words ?? [];
const speakerIndex = pickModalSpeakerIndex(words); // number | undefined (undefined ⇒ neutral, D-04)
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `@deepgram/sdk` v3/v4 `connection.on('Results')` string events + `LiveTranscriptionEvents` | v5 `client.listen.v1.connect(...)`, single `'message'` event with a discriminated `Response` union | v5 (breaking) | Already handled in-repo; this phase extends the same v5 socket |
| Guessing turn end from `is_final` | `speech_final` + `UtteranceEnd` (`utterance_end_ms`) | Deepgram streaming maturity | Reliable end-of-turn incl. noisy audio |
| v2 diarizer | v1 diarizer for streaming (v2 is batch-only; requesting v2 on stream errors) | current | Use default (v1) diarization on the live socket. `[CITED: developers.deepgram.com/docs/diarization]` |

**Deprecated/outdated:** any v3/v4 Deepgram tutorial (`DeepgramClient` init, event names, `is_final` handling all differ). Ignore.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `utterance_end_ms: '1000'` (1s) is a good default gap for meeting/interview cadence | Standard Stack / connect options | Too short → premature commits mid-sentence; too long → laggy cards. Tunable constant; verify on-machine. Deepgram docs suggest 1000ms as a common value. |
| A2 | Modal (majority) per-word speaker index is the right utterance-speaker rule under diarization jitter | Pattern 3 | If Deepgram splits mid-utterance often, modal may mis-attribute a genuinely two-speaker "utterance" — but `speech_final` turns are typically single-speaker, so risk is low. Pure util → easy to swap rule. |
| A3 | `smart_format` reliably emits `?` for spoken questions | Classification Heuristic | If `?` is often absent, classification leans entirely on the opener list (still functional; polite-imperative questions default to Statement, which D-07 accepts). Verify with the debug raw-payload log. |
| A4 | Sibling `utterance` event is the better seam extension than overloading `ISttTranscriptEvent` | Seam Extension | Planner may choose to overload instead; either satisfies D-09 as long as no Deepgram coupling leaks. Low risk. |

**Note:** the field paths and option availability (per-word `speaker`, four message types, `diarize`/`utterance_end_ms`/`endpointing` present, `utterances` absent, `assertSocketIsOpen` throw) are `[VERIFIED]` against the installed 5.4.0 types and are NOT assumptions. Only the tuning/design choices above are assumptions.

## Open Questions

1. **Exact on-machine live payload for nova-3 + diarize + smart_format together**
   - What we know: field paths and message union from the installed 5.4.0 TypeScript types (authoritative for shape) + official docs for behavior.
   - What's unclear: whether nova-3 populates `punctuated_word` and `?` as reliably as the docs imply, and whether `speaker` appears on interim (`is_final:false`) Results or only on finals.
   - Recommendation: the plan MUST include a one-time debug task that logs one raw `Results` and one `UtteranceEnd` payload (behind a debug flag, key-redacted) on the target machine before locking the parse — matches the T-4-04 defensive-parse posture. Then delete/disable the log.

2. **Does `speaker` appear on interim Results?** D-02 says the interim live line needs no speaker anyway, so even if `speaker` is absent on interims it does not block the phase — but confirm so the accumulator only trusts speaker indices from `is_final` word runs.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `@deepgram/sdk` | live diarization | ✓ | 5.4.0 (installed, pinned) | — |
| Deepgram account/API key | live connection | ✓ (existing app requirement) | — | none (STT is the core external dependency; no fallback in this phase) |
| Node/electron-vite build | TS build | ✓ | existing | — |
| Vitest | unit tests | ✓ | existing (`*.test.ts` present) | — |

**Missing dependencies with no fallback:** none new (Deepgram key already required by the app).
**Missing dependencies with fallback:** none.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (existing; `deepgram-stt.gateway.test.ts` + `transcript-buffer.test.ts` present) |
| Config file | electron-vite / vitest config (existing) |
| Quick run command | `npx vitest run src/main/stt/<file>.test.ts` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| QA-01 | `diarize` + `utterance_end_ms` set on connect; `Results`/`UtteranceEnd` discriminated; one utterance per turn | unit | `npx vitest run src/main/stt/deepgram-stt.gateway.test.ts` | ⚠️ EXISTS, extend |
| QA-01 | Accumulate `is_final` runs, commit on `speech_final`; `UtteranceEnd` fallback; no double-commit | unit | `npx vitest run src/main/stt/utterance-accumulator.utility.test.ts` | ❌ Wave 0 |
| QA-02 | Modal per-word speaker index; undefined when no diarization | unit | `npx vitest run src/main/stt/speaker-map.test.ts` (+ modal util) | ❌ Wave 0 |
| QA-02 | First-seen index→Person N stable; new index→next Person; neutral bucket excluded (D-04) | unit | `npx vitest run src/main/stt/speaker-map.test.ts` | ❌ Wave 0 |
| QA-02/D-05 | `SpeakerMap.clear()` resets numbering; wired to Ctrl+Alt+K | unit | `npx vitest run src/main/stt/speaker-map.test.ts` | ❌ Wave 0 |
| QA-03 | `?` ⇒ Question; opener ⇒ Question; borderline ⇒ Statement; multi-sentence Question-if-any (D-08) | unit | `npx vitest run src/main/stt/question-classifier.utility.test.ts` | ❌ Wave 0 |
| QA-07 | Utterance emitted via seam `on('utterance')`; no Deepgram import in consumers | unit + grep | `npx vitest run …` + `rg "@deepgram/sdk" src --files-with-matches` (only the gateway) | ❌ Wave 0 |
| D-11 | Keep-alive tick while socket not open does NOT throw/crash | unit | `npx vitest run src/main/stt/deepgram-stt.gateway.test.ts` | ✅ EXISTS (`:274`) |
| D-11 | Defensive parse: malformed/partial diarized payload never throws | unit | `npx vitest run src/main/stt/deepgram-stt.gateway.test.ts` | ⚠️ EXISTS, extend |

### Sampling Rate
- **Per task commit:** `npx vitest run src/main/stt/<touched-file>.test.ts`
- **Per wave merge:** `npm test`
- **Phase gate:** full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/main/stt/utterance-accumulator.utility.test.ts` — covers QA-01 (accumulate/commit/fallback/no-double-commit)
- [ ] `src/main/stt/speaker-map.test.ts` — covers QA-02 + D-04 + D-05 (modal index, stable map, neutral bucket, clear resets)
- [ ] `src/main/stt/question-classifier.utility.test.ts` — covers QA-03 (D-07/D-08)
- [ ] Extend `deepgram-stt.gateway.test.ts` — diarized-payload parse + `UtteranceEnd` handling + `utterance` seam emission (keep-alive regression already present at `:274`)
- [ ] No new framework install needed — Vitest + `FakeV1Socket` harness already exist and are reusable

## Security Domain

`security_enforcement` is not explicitly disabled in `.planning/config.json`; treated as enabled.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | No auth surface added; Deepgram key handling unchanged (main-only, never crosses IPC) |
| V3 Session Management | no | — |
| V4 Access Control | no | Local single-user desktop app |
| V5 Input Validation | **yes** | Untrusted Deepgram payload → optional-chain every field (T-4-04); malformed payload produces text/undefined, never control flow. Bounded state (SpeakerMap has no unbounded growth: a session's distinct speaker count is naturally small; if hardening desired, cap at a sane N and bucket overflow as neutral). |
| V6 Cryptography | no | No new secrets; `DEEPGRAM_API_KEY` handling unchanged |
| V7 Error Handling / Logging | **yes** | D-11 invariant (no uncaught throw from timer callbacks); never log the API key; the recommended debug raw-payload log MUST be key-redacted and behind a flag |

### Known Threat Patterns for this stack
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Malformed/hostile WS payload from the STT boundary | Tampering / DoS | Defensive optional-chain parse (T-4-04); no field drives control flow beyond null-checks |
| Closed-socket throw escaping a timer → main-process crash | Denial of Service | D-11 blanket invariant; all four `send*` methods are throw sites (`assertSocketIsOpen`) |
| Unbounded in-memory growth of session state | DoS | SpeakerMap bounded by natural speaker count; `TranscriptBuffer` already triple-bounded; utterance accumulator drains on every commit |
| API key leakage into logs/renderer/emitted payload | Information Disclosure | Key stays in main; never emitted; debug payload log redacts; existing test asserts key never logged (`:306`) |

## Sources

### Primary (HIGH confidence)
- **Installed `@deepgram/sdk@5.4.0` type definitions** (`node_modules/.../listen/resources/v1/`) — `V1Client.ConnectArgs` (option availability: `diarize`, `utterance_end_ms`, `endpointing`, `vad_events` present; `utterances` ABSENT), `ListenV1Results` (per-word `speaker`, `is_final`, `speech_final`, `punctuated_word`; no per-utterance speaker), `ListenV1UtteranceEnd`, `Socket.d.ts` `Response` union (4 message types), `ListenV1Diarize`/`ListenV1SmartFormat`/`ListenV1InterimResults`/`ListenV1UtteranceEndMs`/`ListenV1Endpointing` docstrings — VERIFIED (exact installed version)
- **Compiled `Socket.js`** — `assertSocketIsOpen()` throws `Error("Socket is not open.")` synchronously; guards `sendMedia`/`sendKeepAlive`/`sendFinalize`/`sendCloseStream` (lines 94/98/102/106/144-150) — VERIFIED
- `developers.deepgram.com/docs/understand-endpointing-interim-results` — `is_final` vs `speech_final`; "concatenate is_final into a buffer, treat speech_final as completion" — HIGH
- `developers.deepgram.com/docs/understanding-end-of-speech-detection` — `UtteranceEnd`/`utterance_end_ms`; requires `interim_results=true`; may follow `speech_final` (ignorable); ignores non-speech noise — HIGH
- `developers.deepgram.com/docs/diarization` — streaming speaker is per-word only; v2 diarizer not available for streaming — HIGH
- In-repo: `stt-provider.interface.ts`, `deepgram-stt.gateway.ts`, `transcript-buffer.ts`, `deepgram-stt.gateway.test.ts` (FakeV1Socket harness, keep-alive regression `:274`), CONTEXT.md, REQUIREMENTS.md, ROADMAP.md, CLAUDE.md — HIGH

### Secondary (MEDIUM confidence)
- `npm view @deepgram/sdk version` → 5.5.0 (latest; installed pinned at 5.4.0) — HIGH for the version number, informational only

### Tertiary (LOW confidence)
- None — all Deepgram claims resolved against the installed types and/or official docs.

## Metadata

**Confidence breakdown:**
- Standard stack / connect options: HIGH — verified against the exact installed 5.4.0 `ConnectArgs`
- Payload shape (per-word speaker, message types, finalization signals): HIGH — installed types + official docs agree
- D-11 throw semantics: HIGH — read the compiled `assertSocketIsOpen`
- Finalization-signal behavior (`is_final`/`speech_final`/`UtteranceEnd` timing): HIGH — official docs, cross-checked with types
- Classification heuristic / tuning constants: MEDIUM — design choices (Assumptions Log A1–A4)

**Research date:** 2026-07-06
**Valid until:** ~2026-08-06 (30 days; stable — findings are pinned to installed 5.4.0. Re-verify only if the SDK is upgraded.)
