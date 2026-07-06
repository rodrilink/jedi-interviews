---
phase: 08-diarized-utterance-pipeline
plan: 01
subsystem: stt
tags: [stt, diarization, utterance, speaker-map, classification, seam]
requires: []
provides:
  - "IUtteranceEvent + UtteranceClassification + on('utterance') seam contract (QA-07 contract half)"
  - "classifyUtterance pure local Q/S heuristic (QA-03)"
  - "pickModalSpeakerIndex + UtteranceAccumulator utterance grouping (QA-01 grouping core)"
  - "SpeakerMap stable Person N session state with clear() (QA-02)"
affects:
  - "Plan 02 (Wave 2) wires these units into DeepgramSttGateway + index.ts"
tech-stack:
  added: []
  patterns:
    - "Pure-utility discipline (no classes/state/side effects) for classifier + pickModalSpeakerIndex"
    - "By-convention singleton (@remarks note, no TSyringe) for SpeakerMap + UtteranceAccumulator"
    - "Seam-only contract with no @deepgram/sdk import (D-09)"
    - "Vitest AAA + explicit type annotations, co-located *.test.ts"
key-files:
  created:
    - src/main/stt/question-classifier.utility.ts
    - src/main/stt/question-classifier.utility.test.ts
    - src/main/stt/utterance-accumulator.utility.ts
    - src/main/stt/utterance-accumulator.utility.test.ts
    - src/main/stt/speaker-map.ts
    - src/main/stt/speaker-map.test.ts
  modified:
    - src/main/stt/stt-provider.interface.ts
decisions:
  - "classifyUtterance return type imported from the seam (UtteranceClassification), no local duplicate union"
  - "UtteranceAccumulator implemented as a stateful class (append/commit/clear) with empty-commit no-op, per the PATTERNS class variant"
  - "SpeakerMap.label(undefined) returns the neutral 'Speaker' bucket without advancing the Person counter"
metrics:
  duration: ~10m
  completed: 2026-07-06
  tasks: 3
  files: 7
---

# Phase 8 Plan 01: Diarized Utterance Pipeline Core Units Summary

Built the three pure/testable core units of the diarized-utterance pipeline (local Q/S classifier, modal-speaker utterance accumulator, stable Person N speaker map) and extended the `ISttProvider` seam to carry a committed `IUtteranceEvent` — all interface-first, socket-free, and unit-tested before any Deepgram wiring depends on them.

## What Was Built

- **Seam extension (Task 1, QA-07 contract half):** Added `UtteranceClassification = 'question' | 'statement'`, the `IUtteranceEvent` interface (`text`, `speaker`, `isDiarized`, `classification`), and a fourth `on(event: 'utterance', …)` overload on `ISttProvider`, sitting alongside the existing `on('transcript', …)` and `ISttTranscriptEvent` (still the D-02 interim live line). No `@deepgram/sdk` import in the contract (D-09).
- **Question/statement classifier (Task 2, QA-03):** `classifyUtterance(text)` — a pure module (no classes/state), splitting on the local `/(?<=[.!?])\s+/` regex (no NLP dep), returning `'question'` when any sentence ends in `?` (D-07) or opens with a `QUESTION_OPENERS` word, else `'statement'` (D-06 default-Statement bias; D-08 multi-sentence any-question).
- **Utterance accumulator + modal index (Task 3, QA-01):** pure `pickModalSpeakerIndex(words)` (returns `undefined` when undiarized, D-04) plus a stateful `UtteranceAccumulator` (`append`/`commit`/`clear`) whose `commit()` on an empty buffer is a no-op returning `undefined` (Pitfall 4 double-commit guard).
- **Speaker map (Task 3, QA-02):** `SpeakerMap` assigns each first-seen index a stable `Person N` (D-03), returns the neutral `Speaker` bucket for an undiarized turn without consuming a number (D-04), and `clear()` resets both the map and the counter so numbering restarts at Person 1 (D-05).

## Task Commits

| Task | Name | Commit(s) | Files |
| ---- | ---- | --------- | ----- |
| 1 | Extend ISttProvider seam | `9dd65d1` (feat) | stt-provider.interface.ts |
| 2 | Q/S classifier | `b7fc045` (test/RED), `1b0aadf` (feat/GREEN) | question-classifier.utility.ts (+test) |
| 3 | Accumulator + speaker map | `dc0d614` (test/RED), `c4714a8` (feat/GREEN) | utterance-accumulator.utility.ts, speaker-map.ts (+tests) |

## Verification Results

- `npx vitest run` on all three new test files: **16 tests passed** (7 classifier, 6 accumulator, 3 speaker map).
- `npx tsc --noEmit -p tsconfig.node.json --composite false`: **exit 0** (no errors project-wide; none in the four touched files).
- Actual `@deepgram/sdk` import statements in each of the four source files: **0** (D-09 seam discipline). Note: the seam header retains two pre-existing JSDoc *prose* mentions of `@deepgram/sdk` (documenting the no-Deepgram rule and the SDK version the shape mirrors) — these are comments, not imports, and pre-date this plan.

## Deviations from Plan

None — plan executed exactly as written. The plan explicitly allowed either a pure-function or a small stateful-class shape for the accumulator; the class variant (`append`/`commit`/`clear`) was chosen as the plan's `<action>` and `must_haves.artifacts` name `UtteranceAccumulator` directly.

## TDD Gate Compliance

Both behavior-adding tasks followed RED → GREEN:
- Task 2: `b7fc045` (test, failed on missing module) → `1b0aadf` (feat, all green).
- Task 3: `dc0d614` (test, failed on missing modules) → `c4714a8` (feat, all green).
Task 1 is a type-only contract extension (no runtime behavior); verified via `tsc --noEmit`.

## Known Stubs

None. All exports are fully implemented and covered by Wave 0 tests. These units are intentionally not yet wired into the live gateway — that is Plan 02's (Wave 2) scope, as stated in the objective.

## Self-Check: PASSED

Created files verified present:
- FOUND: src/main/stt/question-classifier.utility.ts (+ .test.ts)
- FOUND: src/main/stt/utterance-accumulator.utility.ts (+ .test.ts)
- FOUND: src/main/stt/speaker-map.ts (+ .test.ts)
- FOUND: src/main/stt/stt-provider.interface.ts (modified)

Commits verified present in git log: `9dd65d1`, `b7fc045`, `1b0aadf`, `dc0d614`, `c4714a8`.
