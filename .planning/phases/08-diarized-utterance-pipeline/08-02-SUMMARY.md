---
phase: 08-diarized-utterance-pipeline
plan: 02
subsystem: stt
tags: [stt, diarization, utterance, deepgram, seam, timer-safety]
requires:
  - "08-01: IUtteranceEvent seam contract, classifyUtterance, pickModalSpeakerIndex + UtteranceAccumulator, SpeakerMap"
provides:
  - "Diarization-enabled Deepgram live connect (diarize:'true' + utterance_end_ms:'1000')"
  - "Message-type switch (Results/UtteranceEnd/Metadata/SpeechStarted) with accumulate-then-commit"
  - "One classified, Person N-attributed utterance emitted per finalized turn through the ISttProvider seam (QA-01 + QA-07 emission half, D-01)"
  - "DeepgramSttGateway.clearSpeakers() for the D-05 clear-transcript path (Plan 03 wires it)"
affects:
  - "Plan 03 (Wave 3) wires gateway.on('utterance', …) + clearSpeakers() into index.ts and the Q/A panel"
tech-stack:
  added: []
  patterns:
    - "Message-type discrimination on the Deepgram v5 live union (type='Results'|'UtteranceEnd'|…)"
    - "Accumulate is_final runs → commit one utterance on speech_final (D-01), UtteranceEnd fallback"
    - "Gateway owns SpeakerMap + UtteranceAccumulator so all @deepgram/sdk coupling stays in one file (D-09)"
    - "D-11 timer-safety invariant: state-gate + try/catch → emitError on every socket-touching timer"
    - "Defensive untrusted-payload parse (optional-chain every field, ?? ''/?? []) (T-4-04)"
key-files:
  created: []
  modified:
    - src/main/stt/deepgram-stt.gateway.ts
    - src/main/stt/deepgram-stt.gateway.test.ts
    - .planning/todos/done/260620-deepgram-keepalive-crash.md
decisions:
  - "commitPendingUtterance is the sole emit('utterance') site; empty-commit no-op guarantees no double-commit"
  - "is_final:true Results no longer emit a transcript event — they accumulate into the committed utterance (stale test updated to the new D-01 contract)"
  - "Task 2 required no new gateway source: the D-11 audit confirmed the existing keep-alive guard is the only socket-touching timer and Task 1 added none"
requirements: [QA-01, QA-07]
metrics:
  duration: ~15m
  completed: 2026-07-06
  tasks: 2
  files: 3
---

# Phase 8 Plan 02: Diarized Utterance Pipeline Gateway Wiring Summary

Wired the Plan 01 core units (accumulator, speaker map, classifier) into the live Deepgram v5 socket so `DeepgramSttGateway` now enables diarization + end-of-utterance and emits exactly one speaker-attributed, Q/S-classified `utterance` per finalized turn through the `ISttProvider` seam — while keeping the D-02 interim `transcript` line intact and preserving the D-11 timer-safety invariant that closes the keep-alive crash (todo 260620).

## What Was Built

- **Diarized live connect (Task 1, QA-01):** Added `diarize: 'true'` and `utterance_end_ms: '1000'` to `client.listen.v1.connect({...})` (string-literal query params, matching the existing `interim_results`/`smart_format` convention). Deliberately did NOT add `utterances` (batch-only, a no-op on the live socket per RESEARCH).
- **Untrusted-payload shape extension (Task 1, T-4-04):** Extended the local defensive `IDeepgramMessage` with `type?`, `speech_final?`, and `channel.alternatives[].words?: Array<{ word?; punctuated_word?; speaker? }>` — every field optional so a malformed payload never drives control flow.
- **Message-type switch + accumulate-then-commit (Task 1, D-01):** Rewrote `handleMessage` to discriminate on `type`: `UtteranceEnd` → `commitPendingUtterance()` (fallback); non-`Results` types (`Metadata`/`SpeechStarted`) ignored; interim `Results` (`is_final` falsy) still emit the D-02 `transcript` line unchanged; `is_final` runs `append` to the accumulator; a `speech_final` run finalizes the turn. Added `commitPendingUtterance()` as the SOLE `emit('utterance', …)` site — it drains the accumulator (no-op returning early when empty, Pitfall 4 double-commit guard), resolves the modal per-word speaker index to a stable `Person N` via the gateway-owned `SpeakerMap`, classifies the text, and emits one fully-labeled `IUtteranceEvent`. Added `clearSpeakers()` (resets `SpeakerMap` + accumulator) for the D-05 clear path Plan 03 will wire.
- **D-11 audit + regression/verification coverage (Task 2):** Audited every `setInterval`/`setTimeout` callback. Finding: the only socket-touching timer is `startKeepAlive` (already `state === 'connected'`-gated + try/catch → `emitError`); `scheduleReconnect`'s callback calls no `send*`; Task 1 introduced no new timer (`commitPendingUtterance` runs inside the SDK `message` callback and calls no `send*`). The invariant holds unchanged, so Task 2 needed no new gateway source — only coverage. Added a connect-args test (`diarize`/`utterance_end_ms` present, no `utterances`) and a malformed-diarized-payload no-throw/commits-nothing test; the pre-existing keep-alive-races-a-closed-socket regression stays green. Closed todo 260620.

## Task Commits

| Task | Name | Commit(s) | Files |
| ---- | ---- | --------- | ----- |
| 1 | Diarize + message switch + accumulate-commit | `dc5b826` (test/RED), `026d395` (feat/GREEN) | deepgram-stt.gateway.ts, deepgram-stt.gateway.test.ts |
| 2 | D-11 audit + regression/defensive-parse coverage | `18a6464` (test) | deepgram-stt.gateway.test.ts |
| — | Close todo 260620 | `e028f0b` (chore) | .planning/todos/done/260620-deepgram-keepalive-crash.md |

## Verification Results

- `npx vitest run src/main/stt/deepgram-stt.gateway.test.ts`: **25 tests passed** (interim line, one-utterance-per-speech_final, no-over-commit-per-is_final, UtteranceEnd fallback, no-double-commit on trailing UtteranceEnd, Person N attribution + Q/S classification, undiarized neutral bucket, Metadata/SpeechStarted ignored, connect-args, malformed-payload no-throw, keep-alive regression).
- `npx vitest run` (full suite): **179 tests passed** (23 files) — Plan 01 units still green with the gateway consuming them.
- `npm run typecheck` (node + web): **exit 0**.
- Actual `import … from '@deepgram/sdk'` statements in non-test `src`: **only `deepgram-stt.gateway.ts`** (D-09/QA-07 seam discipline; `stt-provider.interface.ts` matches only in JSDoc prose, `*.test.ts` is the mock).
- `npx oxlint` on both touched files: clean (no diagnostics).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Updated a stale test encoding the old is_final→transcript contract**
- **Found during:** Task 1 (GREEN)
- **Issue:** The pre-existing test `should emit a final transcript when is_final is true` asserted that an `is_final:true` Results emits a `transcript` event with `isFinal:true`. Under the new D-01 contract (this plan's explicit behavior spec), an `is_final:true` run no longer emits a `transcript` — it accumulates into the committed utterance; only interim (`is_final:false`) results stay on the D-02 live line. The old assertion now encodes incorrect behavior.
- **Fix:** Rewrote the test as `should not emit a transcript for an is_final run and instead commit it on speech_final`, asserting no `transcript` and one committed `utterance`.
- **Files modified:** src/main/stt/deepgram-stt.gateway.test.ts
- **Commit:** `026d395`

**2. [Rule 3 - Blocking] Retyped the connect mock to capture the options argument**
- **Found during:** Task 2 (connect-args test)
- **Issue:** The existing `mockConnect` was typed `() => Promise<FakeV1Socket>` and the mock forwarded args via `mockConnect(...(args as []))`, erasing the connect options — so `mock.calls[0][0]` was a type error and unusable for the connect-args assertion.
- **Fix:** Retyped `mockConnect` to `(options?: Record<string, unknown>) => Promise<FakeV1Socket>` and forwarded the options argument directly; kept `mockResolvedValue(fakeSocket)` working.
- **Files modified:** src/main/stt/deepgram-stt.gateway.test.ts
- **Commit:** `18a6464`

Both are in-scope corrections directly caused by this plan's changes; no architectural (Rule 4) decisions were needed.

## TDD Gate Compliance

- **Task 1** (behavior-adding): RED (`dc5b826`, 5 utterance-emitting tests failing) → GREEN (`026d395`, all 23 passing). Verified in git log: `test(...)` precedes `feat(...)`.
- **Task 2** (audit + coverage, no new behavior): the D-11 fix already existed and is proven by the pre-existing regression; the new tests (connect-args, malformed-payload) are verification coverage that passed against the Task 1 source, so this task is a `test(...)` commit with no separate `feat` (correctly — it adds no new runtime behavior).

Note: `MVP_MODE`/`TDD_MODE` runtime-gate flags were not passed by the orchestrator, so the MVP+TDD halt gate did not apply; the RED/GREEN cycle was still followed because the tasks declare `tdd="true"`.

## D-11 Audit Finding

All `setInterval`/`setTimeout` callbacks in `deepgram-stt.gateway.ts` were audited:
- `startKeepAlive` (`setInterval`) — calls `sendKeepAlive`, already guarded by the `state === 'connected'` gate + try/catch → `emitError`. **Compliant.**
- `scheduleReconnect` (`setTimeout`) — callback only clears its own handle and calls `void this.connect()` (which has its own try/catch); it calls no `connection.send*`. **Compliant (not a throw site).**
- Task 1 added **no new timer**: `commitPendingUtterance` runs inside the SDK `message` callback, not a timer, and calls no `send*`.

The D-11 invariant holds unchanged. **Todo 260620 (Deepgram keep-alive crash) is closed** and moved to `.planning/todos/done/`.

## Known Stubs

None. The `utterance` event is fully emitted and covered; `clearSpeakers()` is a complete method intentionally not yet wired into a hotkey — Plan 03 (Wave 3) wires it into the Ctrl+Alt+K clear-transcript path in `index.ts`, as stated in the objective and in the seam docs.

## Self-Check: PASSED

Modified files verified present:
- FOUND: src/main/stt/deepgram-stt.gateway.ts
- FOUND: src/main/stt/deepgram-stt.gateway.test.ts
- FOUND: .planning/todos/done/260620-deepgram-keepalive-crash.md

Commits verified present in git log: `dc5b826`, `026d395`, `18a6464`, `e028f0b`.
