---
phase: quick
plan: 260706-q4m
subsystem: stt-gateway
tags: [bugfix, stt, deepgram, transcript, ai-orchestrator, regression]
requires:
  - src/main/stt/stt-provider.interface.ts (ISttTranscriptEvent seam)
  - src/main/stt/transcript-buffer.ts (appendFinal side-effect)
  - src/main/index.ts (appendFinal branch consumer)
provides:
  - DeepgramSttGateway.commitPendingUtterance re-emits committed text as an additive isFinal:true transcript
affects:
  - AiOrchestrator span feed (AI-01/AI-02)
  - rolling finalized-transcript display (TRN-01/TRN-02)
tech-stack:
  added: []
  patterns:
    - additive seam-level event emission guarded on non-whitespace text (WR-01)
key-files:
  created: []
  modified:
    - src/main/stt/deepgram-stt.gateway.ts
    - src/main/stt/deepgram-stt.gateway.test.ts
decisions:
  - Emit the final transcript ADDITIVELY alongside the unchanged single utterance emit, keeping the D-01 one-utterance-per-turn contract intact.
  - Guard the transcript emit on committed.text.trim().length > 0 so a whitespace-only turn never pushes a junk empty segment into TranscriptBuffer.finals (WR-01).
  - No index.ts / transcript-buffer.ts change: appendFinal already clears the trailing interim, so restoring the emit also resolves WR-02.
metrics:
  duration: ~10m
  completed: 2026-07-06
  tasks: 2
  files: 2
---

# Phase quick Plan 260706-q4m: Fix CR-01 Re-emit Committed Utterances Summary

Restored the gateway's final-`transcript` re-emit so a finalized turn feeds `TranscriptBuffer.finals` again — reviving the buffer -> AI-orchestrator span feed that the app's core value depends on, without breaking the D-01 one-utterance-per-turn contract.

## What Changed

`DeepgramSttGateway.commitPendingUtterance` previously emitted a finalized turn ONLY as an `utterance` event (Phase 8 rewrite). Because it never emitted a final `transcript`, `index.ts`'s `if (event.isFinal) buffer.appendFinal(...)` branch was dead code, `TranscriptBuffer.finals` stayed permanently empty, and `AiOrchestrator.trigger()` always hit the empty-span guard and never called Claude (CR-01).

The fix adds one additive emit: after the existing `this.emit('utterance', utterance)`, the gateway now emits `{ text: committed.text, isFinal: true }` as an `ISttTranscriptEvent`, guarded on non-whitespace committed text. The utterance path is untouched.

## Tasks Completed

| Task | Name | Commits | Files |
| ---- | ---- | ------- | ----- |
| 1 | Emit additive isFinal:true transcript from commitPendingUtterance (TDD) | 1f4f02b (RED test), 77b0fef (GREEN impl) | src/main/stt/deepgram-stt.gateway.ts, .test.ts |
| 2 | Replace regression-encoding tests with restored-behavior + regression assertions | 1f4f02b (folded into RED commit) | src/main/stt/deepgram-stt.gateway.test.ts |

Note: Task 2's test edits were authored during Task 1's RED phase (they are the failing tests that drive the implementation), so they landed in the RED test commit `1f4f02b`. This keeps a clean RED -> GREEN gate sequence in git history.

## Test Changes (Task 2)

- Renamed `should not emit a transcript for an is_final run and instead commit it on speech_final` -> `should commit the turn AND re-emit it as a final transcript on speech_final`; changed `expect(transcripts).toEqual([])` to `expect(transcripts).toEqual([{ text: 'final words', isFinal: true }])`. The single-utterance assertion is unchanged.
- Added `should re-emit the committed turn as a final transcript so the buffer feed is non-empty (CR-01 regression)` — a multi-run diarized `speech_final` turn asserts exactly one utterance AND exactly one `isFinal:true` transcript with the space-joined committed text. This is the assertion that would have caught CR-01.
- Added `should re-emit a final transcript on an UtteranceEnd-fallback commit`.
- Added `should NOT emit a final transcript for a whitespace-only committed turn` (WR-01 guard).
- Kept `should not emit a transcript for an empty-text message` intact — still passes because the empty is_final run + WR-01 guard suppresses the emit.

## Verification

- `npm test`: 182/182 passed across 23 files (gateway suite: 28/28).
- `npm run typecheck`: passed (node + web).
- `grep -n "isFinal: true" src/main/stt/deepgram-stt.gateway.ts`: matches at lines 303 (JSDoc) and 330 (the emit).
- Files changed since base: only `deepgram-stt.gateway.ts` and `deepgram-stt.gateway.test.ts`. `index.ts`, `transcript-buffer.ts`, `ai-orchestrator.ts`, and `stt-provider.interface.ts` are UNCHANGED.
- No new `@deepgram/sdk` import outside the gateway; the emitted event is the seam-level `ISttTranscriptEvent` (QA-07/D-09 intact).

## Must-Haves Confirmed

- A `speech_final`/`UtteranceEnd` turn emits BOTH one `utterance` AND one final `transcript` on the same committed text — asserted.
- The final `transcript` carries `isFinal: true`, so the `appendFinal` branch runs — reached via the seam.
- A finalized turn with empty/whitespace committed text emits NO final transcript (WR-01) — asserted; the empty-text guard test was preserved, not weakened.
- Exactly one `utterance` per turn (D-01) — unchanged and asserted.

## TDD Gate Compliance

- RED: `1f4f02b` — `test(...)` commit; 3 restored-behavior tests failed as expected before the fix.
- GREEN: `77b0fef` — `feat/fix(...)` commit; all 28 gateway tests (and full 182) pass.
- REFACTOR: not needed.

## Deviations from Plan

None - plan executed exactly as written. (Task 2's test file was already fully edited in the TDD RED step of Task 1, so both tasks are covered by the two commits above; no separate Task 2 commit was required since the test file had no further changes.)

## Known Stubs

None.

## Self-Check: PASSED

- FOUND: src/main/stt/deepgram-stt.gateway.ts (emit at line 330)
- FOUND: src/main/stt/deepgram-stt.gateway.test.ts
- FOUND commit: 1f4f02b (RED test)
- FOUND commit: 77b0fef (GREEN fix)
