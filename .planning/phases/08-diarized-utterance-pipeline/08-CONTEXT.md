# Phase 8: Diarized Utterance Pipeline - Context

**Gathered:** 2026-07-06
**Status:** Ready for planning

<domain>
## Phase Boundary

The transcript stream stops being one flat text blob and becomes a stream of discrete, **speaker-attributed, question/statement-classified utterances**, delivered through the existing `ISttProvider` seam so nothing downstream is coupled to Deepgram. This is the data/seam layer the Phase 9 card UI consumes.

**In scope:** QA-01 (diarization + utterance segmentation on the Deepgram v5 connection), QA-02 (stable session-long `Person N` speaker map), QA-03 (local question/statement classification), QA-07 (all of it riding the `ISttProvider` seam). Plus the folded keep-alive-crash regression fix (todo 260620).

**Out of scope (Phase 9):** the card-based Q/A panel redesign, the visual Q-vs-S styling, and the people-list UI (QA-04/QA-05/QA-06). This phase produces the structured stream; Phase 9 renders it.
</domain>

<decisions>
## Implementation Decisions

### Utterance finalization & interim (QA-01)
- **D-01:** Commit an utterance to a finalized "card-ready" entry the moment Deepgram marks it final (`is_final` per utterance). Cards appear promptly, one per finalized utterance. The exact Deepgram signal (`is_final` vs `speech_final` vs `utterance_end`) is Claude's discretion at plan/research time — the required *behavior* is prompt, stable, one-entry-per-utterance commits.
- **D-02:** While an utterance is still being spoken (interim, not yet finalized), it is emitted as ONE distinct **live, unclassified** in-progress item — no speaker `Person N` number required, no Q/S classification, no card frame (Phase 9 renders it as a dimmed/italic "live" line). It resolves into a properly labeled finalized utterance on `is_final`. Only finalized utterances carry a `Q1`/`S3`-style sequence + classification. (Interim is still *replaced* in place, never accumulated — mirrors the existing `TranscriptBuffer.setInterim` discipline.)

### Speaker identity — stable `Person N` map (QA-02)
- **D-03:** Deterministic first-seen assignment: the first time a Deepgram speaker index appears, assign the next `Person N` (Person 1, Person 2, …). Same index → same `Person N` for the whole session. Accept the minor risk that Deepgram over-splitting one voice briefly yields an extra Person — simplest, deterministic, testable. No people-count cap.
- **D-04:** Utterances with **no diarization info** (Deepgram returns no speaker index) get a neutral label (e.g. `Unknown` / `Speaker`) and are kept OUT of the numbered `Person N` list — do not invent a person Deepgram didn't attribute, and do not merge into the last-known speaker.
- **D-05:** The speaker map is session-scoped state (held in main, alongside `TranscriptBuffer`) and **resets together with the transcript on Ctrl+Alt+K**, so `Person N` numbering restarts cleanly for the next session.

### Question/statement classification — local heuristic (QA-03)
- **D-06:** Classification is a **local, pure, unit-testable** heuristic — NO per-utterance AI call (honors the "AI calls are user-triggered only" constraint). Default to **Statement** when not confidently a question.
- **D-07:** A sentence is a Question if it ends with `?` (Deepgram `smart_format` supplies punctuation) OR starts with an interrogative (who/what/when/where/why/how/which) or an auxiliary/modal opener (do/does/did/is/are/can/could/would/will/should/have). Otherwise Statement. The exact opener/aux word list is Claude's discretion; `?` MUST count and borderline MUST default to Statement. Polite-imperative questions ("walk me through X") falling to Statement is acceptable by design.
- **D-08:** For a **multi-sentence utterance**, classify the whole card as a **Question if ANY sentence in it reads as a question** (split on sentence boundaries, run D-07 per sentence). Questions are the high-value signal — surface that a question is present rather than burying it. This composes with D-06's "default Statement": each per-sentence verdict defaults to Statement; the card is a Question only if at least one sentence clears the Question bar.

### Seam discipline (QA-07 / TRN-05)
- **D-09:** The utterance shape — text, stable speaker label, and Question/Statement classification — MUST be emitted through the existing `ISttProvider` seam (`src/main/stt/stt-provider.interface.ts`). Extend `ISttTranscriptEvent` (or add a sibling utterance event) to carry `speaker` + classification; do NOT couple consumers to `@deepgram/sdk`. No consumer imports the Deepgram SDK. A future Whisper provider must be able to emit the same contract.
- **D-10:** Keep the speaker-map and classification logic in **pure, injectable utilities** (mirrors the `pcm-resample.utility` + injected-clock pattern already used in the STT layer) so both are unit-tested without a live socket.

### Timer/callback safety (folded todo 260620)
- **D-11:** **Phase invariant:** no `setInterval`/`setTimeout` callback in the Deepgram gateway may throw an uncaught exception. Every timer callback wraps its socket calls so a closed-socket throw can never escape into an uncaught main-process exception. (Diarization changes message volume and may introduce new timers — this class-level rule covers them, not just keep-alive.)

### Claude's Discretion
- Exact Deepgram finalization signal to key the commit on (`is_final` / `speech_final` / `utterance_end`) — pick based on what `nova-3` + `utterances`/`diarize` actually emits (plan-time research: Context7 `/deepgram/deepgram-js-sdk`).
- The precise per-word `speaker` index / utterance-boundary payload shape from Deepgram (research item).
- The exact interrogative-opener / auxiliary-verb word list for D-07.
- The concrete extension shape of the seam event (extend `ISttTranscriptEvent` vs a new sibling utterance event) — as long as D-09 (seam-only, no Deepgram coupling) holds.

### Folded Todos
- **260620 — Deepgram keep-alive crashes main on a closed socket** (HIGH, `type: bug`, marked "candidate for v1.1"). Original problem: the ~6s keep-alive timer fired `sendKeepAlive()` after the socket closed; the SDK's `assertSocketIsOpen` threw synchronously inside a `Timeout._onTimeout` callback → uncaught main-process crash. **Fits this phase** because Phase 8 already reworks `deepgram-stt.gateway.ts` for diarization/utterances — same file, same socket. **Current state (verified 2026-07-06):** the gateway ALREADY gates `sendKeepAlive` on `state === 'connected'` AND wraps it in try/catch (`deepgram-stt.gateway.ts:242-264`), so the crash is very likely already fixed and the todo predates that hardening. **Phase 8 action (D-11 + regression):** add the missing regression test (keep-alive tick while disconnected must NOT throw and must NOT crash), audit for any OTHER unguarded timer callback, apply the D-11 blanket invariant, and close todo 260620 if no remaining gap is found.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Milestone & requirements
- `.planning/PROJECT.md` §Current Milestone v1.1 + §Key Decisions — the locked v1.1 decisions (diarization for speaker ID, stable Person N, local heuristic default-Statement) and the "AI calls are user-triggered only" constraint.
- `.planning/REQUIREMENTS.md` §Milestone v1.1 — QA-01…QA-07 (this phase owns QA-01, QA-02, QA-03, QA-07).
- `.planning/ROADMAP.md` §Phase 8 — goal, success criteria, and phase notes.

### Code to extend (the STT seam + Deepgram gateway)
- `src/main/stt/stt-provider.interface.ts` — the `ISttProvider` seam + `ISttTranscriptEvent` contract to extend with speaker + classification (QA-07/D-09). MUST stay Deepgram-agnostic.
- `src/main/stt/deepgram-stt.gateway.ts` — enable `diarize: true` + `utterances: true` on `client.listen.v1.connect(...)`; map per-utterance speaker/boundary payload; the keep-alive timer is at lines 242-264 (folded-todo target). `smart_format: 'true'` is already on (supplies `?` punctuation for D-07).
- `src/main/stt/transcript-buffer.ts` — `ITranscriptSegment { text, at }` + injected-clock + bounded-buffer pattern; the session speaker-map + utterance model live alongside this (D-05 clear-together on Ctrl+Alt+K).

### Folded todo
- `.planning/todos/pending/260620-deepgram-keepalive-crash.md` — the keep-alive crash (folded, D-11 + regression test).

### Deepgram API (plan-time research)
- Context7 `/deepgram/deepgram-js-sdk` — v5 live `listen.v1.connect` options for `diarize`/`utterances`, the `speaker` field in the results payload, and the finalization signals (`is_final`/`speech_final`/`utterance_end`). NOTE: the `claude-api` skill is NOT needed — classification is local, no AI call.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`ISttProvider` / `ISttTranscriptEvent`** (`src/main/stt/stt-provider.interface.ts`): the extension point — add speaker + classification to the transcript contract here; every consumer already programs against this seam.
- **`DeepgramSttGateway`** (`src/main/stt/deepgram-stt.gateway.ts`): already handles connect/reconnect/backoff, keep-alive (gated + try/catch), `smart_format`, `interim_results`, and defensive message parsing (`handleMessage`, T-4-04). Extend `connect()` options + `handleMessage` for diarization/utterances; the keep-alive guard is already the D-11 template.
- **`TranscriptBuffer`** (`src/main/stt/transcript-buffer.ts`): the injected-clock + bounded-buffer + `clear()` pattern; model the session speaker-map/utterance state on it and wire its reset into the same Ctrl+Alt+K clear path (D-05).
- **`pcm-resample.utility`** (existing, 04-01): the pure-utility + unit-test precedent for D-10 (pure speaker-map + classification utilities).

### Established Patterns
- **Report-don't-throw** on transport faults (gateway surfaces `error` events, never throws) — extends to D-11 (timer callbacks must not throw uncaught).
- **Interim replaced, never accumulated** (`TranscriptBuffer.setInterim`) — D-02's live in-progress line follows this.
- **Main-owned singletons by convention** (no TSyringe in the Electron main process) — the speaker-map/utterance model is instantiated once in `index.ts` and shared, like `TranscriptBuffer` and the gateway.
- **Defensive untrusted-payload parsing** (optional-chain every Deepgram field, T-4-04) — apply to the new `speaker`/utterance fields.

### Integration Points
- Deepgram `message` handler → typed seam event (now carrying speaker + classification) → main-owned utterance/speaker-map state → overlay push channel (consumed by Phase 9's redesigned panel over the existing read-only bridge; NO new renderer→main control channel).
- Ctrl+Alt+K clear path (existing `TranscriptBuffer.clear()` wiring in `index.ts`) → must also reset the speaker map (D-05).

</code_context>

<specifics>
## Specific Ideas

- Card label format target (rendered in Phase 9, but the data must support it): `Q1 - Person 1` / `S3 - Person 2` — so the finalized utterance needs (a) a stable `Person N` label, (b) a Q/S classification, and (c) enough info for a per-type sequence number (`Q1`, `S3`). Phase 8 must emit (a) and (b); the per-type sequence numbering can be derived in the consumer but the phase should ensure the classification + speaker are on every finalized utterance.
- The "default to Statement" bias (milestone) and "Question if ANY sentence is a question" (D-08) are intentionally combined and are NOT in conflict: D-08 raises a card to Question only when a per-sentence check (which itself defaults to Statement) clears the Question bar.

</specifics>

<deferred>
## Deferred Ideas

None raised during discussion — the conversation stayed within the phase's data/seam scope. (The card UI, Q/S visual styling, and people-list rendering are the already-planned Phase 9, not deferrals.)

### Reviewed Todos (not folded)
- **260617-code-review-audio-seam-warnings** (`resolves_phase: 4`): Phase 3 code-review warnings about the abandoned *Chromium audio-capture* seam (`desktopCapturer`, `AudioCaptureService`), not the STT/Deepgram seam Phase 8 touches. Already assigned to Phase 4. Not this phase's scope.
- **260618-hud-session-date-and-duration-timer** (area: renderer/overlay): a HUD/header feature — Phase 8 is main-process/data-only. Renderer concern; candidate for a UI phase or /gsd-quick, not Phase 8.
- **260618-scrollbar-disappears-history-unreachable** (area: renderer/overlay, relates_to_phase: 5): a cross-cutting scroll-affordance bug spanning the AI panel + transcript. A Phase 9 (Q/A panel redesign) candidate at best, not the Phase 8 data layer.

</deferred>

---

*Phase: 8-Diarized Utterance Pipeline*
*Context gathered: 2026-07-06*
