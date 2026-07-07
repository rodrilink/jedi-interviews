---
phase: 10-priority-answer-queue
reviewed: 2026-07-07T09:05:23Z
depth: standard
files_reviewed: 4
files_reviewed_list:
  - src/main/ai/ai-gateway.interface.ts
  - src/main/ai/anthropic-ai.gateway.ts
  - src/main/ai/ai-orchestrator.ts
  - src/main/ai/ai-orchestrator.test.ts
findings:
  critical: 0
  warning: 1
  info: 1
  total: 2
status: issues_found
---

# Phase 10 (10-02 gap-closure): Code Review Report

**Reviewed:** 2026-07-07T09:05:23Z
**Depth:** standard
**Files Reviewed:** 4
**Status:** issues_found

## Summary

This is the GAP-CLOSURE change (plan 10-02) that fixes CR-01/WR-01 from `10-REVIEW.md` — the D-11
late-delta cross-request bleed. The fix threads a monotonic `requestId` end-to-end and positively
matches it in every gateway event handler.

**The fix is CORRECT and COMPLETE.** I verified this against the primary risk (a partial fix that
silently reintroduces the bleed) with the following evidence:

1. **`requestId` added to `IAiPromptRequest`** (interface line 42) and populated at BOTH gateway
   call sites in the orchestrator: text/talking-points (`ai-orchestrator.ts:384`) and code-challenge
   (`ai-orchestrator.ts:434`). No stream is started without an id.
2. **Every gateway emit path echoes the id — all FIVE:** `text` (gateway:88), `abort` (gateway:89),
   `error` via `emitError` (gateway:90, 127), `done` (gateway:96), and the synchronous-construction
   `catch` path (gateway:103 → `emitError(error, request.requestId)`). There is NO un-tagged emit
   path. `emitError` now takes `requestId` and forwards it (gateway:125-129).
3. **All FOUR `wireGatewayHandlers` handlers positively match** `eventRequestId !== this.active.requestId`
   (or `requestId !== this.active.requestId` for `text`): `text` (line 475), `done` (line 497),
   `error` (line 514), `abort` (line 533). None left as a bare `active === undefined` check. This
   mirrors the pre-existing pattern in `flushDelta` (line 574) and `startCodeChallenge` (lines 429, 440).
4. **The two new regression tests exercise the STRONG after-req2-active scenario, not a weaker
   idle-gap case.** Both `should drop a request-1-tagged text delta that arrives after request 2 is
   active` (line 271) and `should drop a duplicate terminal ... after request 2 is active (WR-01)`
   (line 305) first emit req1's `done` (which synchronously starts req2 via `clearActive` + `startNext`),
   THEN emit the req1-tagged straggler while req2 is the active request. This is precisely the
   `active !== undefined` case the old code missed.
5. **Mutation-verified.** Weakening the `done`/`error`/`abort` guards to `active === undefined` (dropping
   the positive match) fails the WR-01 test. Weakening the `text` guard fails the after-req2 delta test.
   The tests genuinely pin the fix; they are not vacuous.
6. **No false-negative from `requestId: undefined`.** All 28 `gateway.emit(...)` calls in the test
   carry an explicit requestId sourced from `mock.calls[N]?.[0].requestId`. If a mock call were
   absent the expression throws a TypeError (crashing the test), so a missing id fails loudly rather
   than silently passing `undefined`. I confirmed distinct ids flow (req1 != req2) via `++this.requestSeq`.
7. `npx tsc --noEmit` passes (the widened `on(...)` overloads break no consumer — `index.ts` was
   intentionally not modified per D-10, and its only `gateway.on('error', ...)` is the SEPARATE
   Deepgram STT gateway, unaffected). All 31 orchestrator tests pass.

Intentional/locked design (dormant abort machinery, enqueue-never-cancel, silent auto-eviction,
`index.ts` unmodified) was respected and NOT flagged.

## Warnings

### WR-01: Test extraction of `requestId` uses unsafe optional chaining (17 new occurrences)

**File:** `src/main/ai/ai-orchestrator.test.ts` (lines 130, 164, 195, 218, 280, 312, 314, 338, 357, 377, 383, 446, 526, 555, 569, 602, 606, 650, 654 — 23 total, ~17 net-new in this change)
**Issue:** The pervasive pattern `(gateway.stream.mock.calls[N]?.[0] as IAiPromptRequest).requestId`
combines an optional chain (`?.[0]`) with an immediate property access. oxlint flags every one as
`no-unsafe-optional-chaining`: if `mock.calls[N]` is `undefined`, `?.[0]` short-circuits to
`undefined` and `.requestId` throws a `TypeError` at runtime. The `as IAiPromptRequest` cast is
compile-time-only and does not prevent this. The count grew from 6 to 23 with this change.

This does NOT mask a false-negative on the new regression tests — a missing mock call throws and
FAILS the test rather than silently passing `requestId: undefined` (I confirmed this is the failure
mode, and the current `lint` script `oxlint .` reports these as warnings only, exit 0, so the gate
still passes). But per IDEXX code-standards ("All code must pass `npm run lint`") and to keep the
regression tests robust to future refactors, the extraction should be non-optional and asserted.

**Fix:** Extract each request via a small typed helper that asserts the call exists, e.g.:
```typescript
function requestIdOf(gateway: FakeAiGateway, callIndex: number): number {
    const call = gateway.stream.mock.calls[callIndex];
    if (call === undefined) {
        throw new Error(`no gateway.stream call at index ${callIndex}`);
    }
    return (call[0] as IAiPromptRequest).requestId;
}
```
Then replace `(gateway.stream.mock.calls[0]?.[0] as IAiPromptRequest).requestId` with
`requestIdOf(gateway, 0)`. This removes every `no-unsafe-optional-chaining` warning and turns a
missing-call scenario into an explicit, readable failure.

## Info

### IN-01: `firstTokenLogged` latency-log branch is not asserted for the after-req2-active straggler

**File:** `src/main/ai/ai-orchestrator.ts:484-488` / `src/main/ai/ai-orchestrator.test.ts:271-303`
**Issue:** The `text` handler's D-10 first-token latency log (lines 484-488) sits AFTER the requestId
guard, so a superseded straggler can never trigger a spurious latency line for the wrong request —
which is correct behavior. The new after-req2 delta test (line 271) asserts no delta bleeds, but does
not additionally assert that the req1 straggler produced no `[ai] first-token` line under req2. The
existing `should log a fresh first-token line for each queued request` test (line 368) covers the
happy-path per-request logging, so this is only a completeness gap, not a defect.
**Fix:** Optional — in the after-req2 straggler test, spy on `console.log` and assert the straggler
emits no `[ai] first-token` line, closing the last observable side-effect of a mis-attributed delta.

---

_Reviewed: 2026-07-07T09:05:23Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
