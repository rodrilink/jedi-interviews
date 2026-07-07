# GSD Debug Knowledge Base

Resolved debug sessions. Used by `gsd-debugger` to surface known-pattern hypotheses at the start of new investigations.

---

## qa-panel-transcript-render — grey interim transcript grows then shrinks/disappears mid-turn
- **Date:** 2026-07-06
- **Error patterns:** interim text, grey, white, final, transcript, disappear, flicker, shrink, is_final, speech_final, UtteranceAccumulator, Deepgram, emit cadence, diarized utterance
- **Root cause:** Phase 8 rewrite (026d395) changed the Deepgram gateway's emit cadence — mid-turn `is_final` word runs are buffered silently in `UtteranceAccumulator` and emit NO transcript event until the whole turn commits at `speech_final`/`UtteranceEnd`. Deepgram resets its interim `transcript` field after each `is_final` run, so the renderer's grey interim line grows then shrinks/disappears mid-turn (finalized words held invisibly in the accumulator) and white text appears only once per whole turn. The still-live old rolling `finalText`/`interimText` renderer (Phase 9 card UI not built) surfaced this as the grey→white→disappear flicker. "No Q/S cards" was expected (Phase 9 not implemented), not part of the regression.
- **Lesson:** Deepgram streaming may return MULTIPLE `is_final:true` responses before a single `speech_final:true`, and it RESETS its interim `transcript` field after each `is_final` run. If you buffer `is_final` runs to produce one utterance per turn (the correct D-01 design), you must separately re-surface the accumulated turn-so-far as an interim event on each is_final append — otherwise any consumer rendering raw interim text will see the visible line shrink to Deepgram's post-reset fragment. Emit cadence changes in the gateway must be reconciled with what live consumers actually render.
- **Fix:** Added non-draining `UtteranceAccumulator.peek()` (space-joined buffered is_final runs) and a private `emitTurnInterim(liveFragment)` helper on `DeepgramSttGateway` that emits an interim (isFinal:false) transcript of `peek()` joined with the live fragment. Called on every is_final:false message (with the live fragment) and immediately after each is_final append (with empty fragment). Additive at the seam — D-01 one-utterance-per-turn and the CR-01 speech_final final re-emit both untouched; no index.ts, transcript-buffer.ts, or renderer changes.
- **Files changed:** src/main/stt/deepgram-stt.gateway.ts, src/main/stt/utterance-accumulator.utility.ts, src/main/stt/deepgram-stt.gateway.test.ts, src/main/stt/utterance-accumulator.utility.test.ts
---
