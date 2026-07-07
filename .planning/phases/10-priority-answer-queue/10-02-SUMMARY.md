---
phase: 10-priority-answer-queue
plan: 02
subsystem: ai
tags: [ai-orchestrator, gateway, event-emitter, request-id-guard, tdd, regression-test]

# Dependency graph
requires:
  - phase: 10-priority-answer-queue (plan 01)
    provides: the two-lane priority queue, single-in-flight orchestrator, shared gateway EventEmitter, and the requestId reserved per queued request
provides:
  - A requestId threaded end-to-end through the AI gateway seam (IAiPromptRequest field + echoed on every event)
  - Positive requestId matching in all four wireGatewayHandlers handlers (text/done/error/abort) — a superseded stream's late event is dropped
  - The D-11 no-cross-bleed invariant proven by a two-request-in-sequence regression test (req1-tagged event emitted while req2 active)
  - WR-01 fold-in: a duplicate terminal for a superseded stream no longer prematurely terminates the now-active request
affects: [phase-11 auto-trigger, priority-answer-queue, ai-orchestrator, ai-gateway]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Event-source request-id tagging: the shared EventEmitter echoes the originating request's monotonic id on every event so a once-wired handler can positively match it to the active request (D-11 / Pattern §8)"

key-files:
  created: []
  modified:
    - src/main/ai/ai-gateway.interface.ts
    - src/main/ai/anthropic-ai.gateway.ts
    - src/main/ai/ai-orchestrator.ts
    - src/main/ai/ai-orchestrator.test.ts

key-decisions:
  - "Approach (a) — tag events with their requestId — chosen over per-stream re-subscription (b): a one-field interface addition + trailing param on four events, keeping the shared once-wired emitter model unchanged"
  - "Handler event param named eventRequestId (done/error/abort) to avoid colliding with the destructured active-request requestId; the text handler uses the plain requestId param name (no local collision)"

patterns-established:
  - "Positive request-id guard on every gateway handler: if (this.active === undefined || eventRequestId !== this.active.requestId) return; — mirroring flushDelta and startCodeChallenge"

requirements-completed: [AA-05, AA-06]

# Metrics
duration: 12min
completed: 2026-07-07
---

# Phase 10 Plan 02: Priority Answer Queue Gap Closure Summary

**Threaded a monotonic requestId through the AI gateway seam so all four wireGatewayHandlers handlers positively match each event to the active request — closing the D-11 late-delta cross-bleed and the WR-01 duplicate-terminal race on the back-to-back priority queue.**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-07-07T08:47:00Z
- **Completed:** 2026-07-07T08:58:51Z
- **Tasks:** 2 (TDD RED → GREEN)
- **Files modified:** 4

## Accomplishments
- Added a `requestId` field to `IAiPromptRequest` and a trailing `requestId` param to the four `IAiGateway.on(...)` listener signatures; `AnthropicGateway.stream()` now echoes `request.requestId` on every `text`/`done`/`error`/`abort` emit (and through `emitError`).
- All four `wireGatewayHandlers` handlers now positively match the event's originating `requestId` to `this.active.requestId`, dropping any event from a superseded stream — mirroring the existing `flushDelta`/`startCodeChallenge` guards.
- Added a back-to-back no-cross-bleed regression test (req1-tagged `text` delta emitted AFTER req2 is active) and a duplicate-terminal drop test (WR-01), proving the invariant that the prior idle-gap tests could not.
- Updated all ~24 pre-existing gateway.emit call sites to pass the active request's id, keeping the full suite green (207 tests) without changing any existing test's intent.

## Task Commits

Each task was committed atomically (TDD RED → GREEN):

1. **Task 1: RED — failing back-to-back no-cross-bleed + duplicate-terminal regression tests** - `be8d1f1` (test)
2. **Task 2: GREEN — thread requestId through the gateway seam and positively guard all four handlers** - `25c06f8` (feat)

_Note: this is a `type: tdd` gap-closure plan; the RED commit precedes the GREEN commit._

## Files Created/Modified
- `src/main/ai/ai-gateway.interface.ts` - Added `requestId` field to `IAiPromptRequest`; added trailing `requestId` param to the four `on(...)` listener signatures with updated TSDoc.
- `src/main/ai/anthropic-ai.gateway.ts` - `stream()` captures `request.requestId` and echoes it on every `text`/`abort`/`done` emit; `emitError` takes and re-emits the id (T-5-02 no-payload discipline preserved).
- `src/main/ai/ai-orchestrator.ts` - Threaded `requestId` into both `gateway.stream({...})` calls (startRequest + startCodeChallenge); added the positive `!== this.active.requestId` guard to all four handlers; dormant `abort` handler kept its (now positive) guard (D-12).
- `src/main/ai/ai-orchestrator.test.ts` - Added the two RED regression tests; updated all ~24 existing emits to pass the active request's id (read from `gateway.stream.mock.calls[n][0].requestId`).

## Decisions Made
- **Approach (a) over (b):** tagged events with their requestId (one interface field + trailing param on four events) rather than per-stream re-subscription, which would have forced rewriting every suite emit into `stream.emit(...)` and making `IAiStream` an event source. Approach (a) keeps the shared once-wired emitter model and confines the behavior change to the four handlers.
- **`eventRequestId` param naming:** the `done`/`error`/`abort` handlers destructure `const { requestId, ... } = this.active`, so the inbound event id is named `eventRequestId` to avoid shadowing. The `text` handler has no such local, so its param is the plain `requestId`. Both forms satisfy the `!== this.active.requestId` acceptance grep.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- The RED state manifested as a behavioral failure (the straggler's stale text bled under request 2), not a compile error: Vitest transpiles TS without type-checking, so the not-yet-added `requestId` param on `emit()` was silently ignored at runtime in Task 1. This is a valid RED (one test failed, others passed) and matches the plan's "either a compile error … or the new assertions fail" acceptance. `npm run typecheck:node` (run in Task 2) is the type gate.
- Pre-existing `no-unsafe-optional-chaining` lint warnings (the file's established `mock.calls[n]?.[0] as IAiPromptRequest` idiom) increased in count as new emits reused the same pattern. These are warnings, not errors — `npm run lint` exits 0. Not refactored (out of scope; consistent with the file's existing convention).

## Verification Results
- `npx vitest run src/main/ai/ai-orchestrator.test.ts` → 31 tests pass (29 retained + 2 new).
- `npx vitest run` (full suite) → 207 tests pass (24 files).
- `npm run typecheck:node` → exits 0.
- `npm run lint` → exits 0 (warnings only).
- `git diff --stat 3ece163..HEAD -- src/main/index.ts` → empty (D-10 preserved, byte-for-byte).
- Acceptance greps: interface `requestId` = 13 (≥5); `!== this.active.requestId` in orchestrator = 6 (≥5); gateway `requestId` = 9 (≥4); `cancelActive` = 5 (≥5, D-12 dormant chain intact); `after request 2` = 2 (≥1).

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- The D-11 no-cross-bleed invariant is now real for back-to-back execution, not just the idle gap — Phase 11's higher-frequency auto-trigger can wire onto the same queue without re-opening the late-delta / duplicate-terminal race.
- No new dependency; no interface break to any other consumer (full suite green). The dormant abort machinery (D-12) is retained with a consistent positive guard for a future explicit-cancel seam.

## Self-Check: PASSED

- FOUND: `.planning/phases/10-priority-answer-queue/10-02-SUMMARY.md`
- FOUND commit: `be8d1f1` (Task 1 RED)
- FOUND commit: `25c06f8` (Task 2 GREEN)

---
*Phase: 10-priority-answer-queue*
*Completed: 2026-07-07*
