---
phase: 10-priority-answer-queue
verified: 2026-07-07T08:23:03Z
status: gaps_found
score: 9/10 must-haves verified
overrides_applied: 0
gaps:
  - truth: "A finished request's late gateway delta never bleeds into the next queued entry (D-11) — proven by a two-request-in-sequence regression test"
    status: failed
    reason: >
      The four gateway handlers (`text`, `done`, `error`, `abort`) guard ONLY on `this.active ===
      undefined`, not a positive match against the active request's `requestId`. In the two-lane
      queue's normal back-to-back execution, when request 1 reaches a terminal, `clearActive()`
      clears `active` and `startNext()` immediately sets request 2 as the new active request — all
      synchronously, within the same handler invocation. If request 1's shared-emitter stream then
      fires a straggler `text` (or a duplicate `done`/`error`) event AFTER this point, the
      `this.active === undefined` guard is false (request 2 is active), so request 1's straggler
      delta is appended to request 2's `text` buffer and pushed/logged under request 2's id — the
      exact cross-request bleed D-11 and the phase's own threat model (T-10-05) exist to prevent.
      This is a committed, unaddressed code-review finding (CR-01, 10-REVIEW.md, critical), not a
      hypothetical: the vulnerable guard pattern (`if (this.active === undefined) { return; }`
      with no `requestId` comparison) is present verbatim at ai-orchestrator.ts:473, :494, :508,
      :524, and the review's own async-capture comparison points out the fix pattern already used
      elsewhere in the same file (`flushDelta` at :565 and `startCodeChallenge` at :429/:440 DO
      compare `requestId !== this.active.requestId`; the four gateway handlers do not). The
      "proven by a two-request-in-sequence regression test" clause is also unmet: the two existing
      tests under "request-id guard / no cross-bleed (Pitfall 1 / D-11)"
      (ai-orchestrator.test.ts:228-267) only cover (a) a straggler arriving in the IDLE gap
      (`active === undefined`, between a terminal and the next start) and (b) that request 2 starts
      with a clean text buffer — neither test drives a straggler event from request 1 arriving
      AFTER request 2 has already become active, which is the actual bleed scenario the two-lane
      queue introduces. This was confirmed by direct execution: `npx vitest run
      src/main/ai/ai-orchestrator.test.ts` is 29/29 green, but green here does not mean the
      invariant holds — it means the failure mode is untested, exactly as the code review states.
    artifacts:
      - path: "src/main/ai/ai-orchestrator.ts"
        issue: "wireGatewayHandlers' 'text' (:468-490), 'done' (:492-505), 'error' (:507-521), and 'abort' (:523-533) handlers guard only on `this.active === undefined`, omitting a positive `this.active.requestId === <event's originating requestId>` check, unlike `flushDelta` (:564-567) and `startCodeChallenge`'s async continuations (:429, :440) in the same file."
      - path: "src/main/ai/ai-orchestrator.test.ts"
        issue: "The 'no cross-bleed' describe block (:228-267) tests the idle-gap straggler and the clean-start-buffer cases only; it does not include a test that fires a request-1 gateway event AFTER request 2 is already the active request, which is the back-to-back bleed scenario the two-lane queue makes routine and that CR-01 identifies as unguarded."
    missing:
      - "Thread the requestId through the gateway (tag stream()/events with the request id, or capture a per-stream closure over the reserved requestId) so each of the four handlers can positively match the incoming event to `this.active.requestId` and drop it otherwise — mirroring the existing `flushDelta`/`startCodeChallenge` pattern already in the file."
      - "Add a regression test that starts request 1, lets it reach 'done' (which starts request 2 via startNext), then emits a request-1-originated 'text' (or duplicate 'done'/'error') AFTER request 2 is active, and asserts request 2's accumulated text/history/push contains only request 2's own content."
      - "Fold in WR-01 (10-REVIEW.md) while fixing this: a duplicate terminal event for an already-superseded stream must also be dropped by the same positive-match guard, not just a straggler 'text'."
---

# Phase 10: Priority Answer Queue Verification Report

**Phase Goal:** Replace the AI orchestrator's single-in-flight "drop if busy" guard with a priority answer queue so an auto-answer and a manual answer can both be requested without racing: a manual Ctrl+Alt+A request preempts queued auto-answers, neither an auto nor a manual request cancels an in-flight stream, and a burst of requests is debounced + run single-in-flight so it never spawns parallel Claude calls. Delivered as a pure orchestrator refactor with no auto-trigger source yet (a test/manual double-press proves the queue behavior).
**Verified:** 2026-07-07T08:23:03Z
**Status:** gaps_found
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Nothing cancels an in-flight stream: re-press of same mode or a different mode mid-stream ENQUEUES instead of aborting (D-01/D-03) | VERIFIED | `trigger()` (ai-orchestrator.ts:231-250) deletes the old cancel blocks and calls `enqueue()` unconditionally after the empty-span guard; no code path calls `cancelActive()`/`stream.abort()` from `trigger`. Tests "cross-mode enqueues without cancelling" (:170-201) and "double-press enqueues" (:101-136) assert `gateway.abort` NOT called and both requests eventually stream. 4/4 relevant tests pass. |
| 2 | Firing two same-mode requests while one streams enqueues the second; both stream to completion in sequence, never dropped (D-02) | VERIFIED | Test `ai-orchestrator.test.ts:116-135` drives this exactly: asserts `stream` called once immediately after the second trigger (non-overlap), then twice only after `'done'` is emitted. Passes. |
| 3 | A manual request placed while auto items are queued runs next after the in-flight stream finishes, ahead of all queued autos, without aborting (D-05) | VERIFIED | `placeInLane`/`dequeue` (ai-orchestrator.ts:294-339) drain `pendingManual` fully before `pendingAuto`. Test `manual preempts queued autos (D-05/SC2)` (:203-225) enqueues two autos then a differently-moded manual, drives the in-flight to done, and asserts the manual (identified by its distinct model) runs second and `gateway.abort` was never called. Passes. |
| 4 | A rapid same-mode burst inside the debounce window collapses to a single queued request (D-06) | VERIFIED | `enqueue()` (ai-orchestrator.ts:263-283) uses a per-mode `burstTimers` map; a pending timer for the same mode short-circuits (no second reservation). Test `burst collapse (D-06/SC3)` (:138-167) fires three same-mode triggers before advancing timers and asserts exactly one `stream()` call; a separate test confirms different modes are NOT collapsed. Both pass. |
| 5 | At most one gateway stream() call is ever active; the next queued item starts only after a terminal event (D-07) | VERIFIED | `startNext()` (ai-orchestrator.ts:347-359) returns immediately if `this.active !== undefined`; it is invoked only from `enqueue`'s debounce-timer callback and from the `done`/`error`/code-challenge-capture-fault terminal paths after `clearActive()`. Every relevant test snapshots `stream` call counts before/after driving terminals and observes non-overlap. Passes. |
| 6 | A single Ctrl+Alt+A/T/C press with an empty queue produces the same grounded result as today; existing green tests stay green (D-10) | VERIFIED | `src/main/index.ts` is byte-for-byte unchanged since immediately before Phase 10 work began (`git diff --stat fa5e489~1..HEAD -- src/main/index.ts` produces no output) and still calls `trigger(mode)` relying on the new `source='manual'` default. The retained D-10 tests (empty-span, active-context injection ×3, trailing-edge debounce, single-press latency, code-challenge happy path/routing/report-don't-throw) all pass unchanged. |
| 7 | The pending queue is bounded by a named single-digit cap; overflow drops the oldest queued AUTO, manuals never evicted, eviction silent (D-08/D-09) | VERIFIED | `MAX_PENDING_QUEUE = 5` exported with `why` TSDoc (ai-orchestrator.ts:81); `evictIfOverCap()` (:315-325) drops `pendingAuto.shift()` while over cap and stops (leaving manuals) if no auto remains. Three tests (:517-587) assert bound-respecting eviction, no `jedi:ai` push for evicted items, and zero manual evictions even past the cap. All pass. (Note: IN-03 in the review flags the auto-overflow test's `<=` assertion as weaker than an exact `toBe`, but the cap logic itself is verified correct by code inspection and the exact-bound manual test.) |
| 8 | A finished request's late gateway delta never bleeds into the next queued entry (D-11) — proven by a two-request-in-sequence regression test | **FAILED** | See Gaps below. The four gateway handlers guard only on `this.active === undefined`, not a positive requestId match; the back-to-back bleed case is unguarded and untested. Confirmed by direct code reading (ai-orchestrator.ts:468-533) and corroborated by the committed CR-01 finding in 10-REVIEW.md. |
| 9 | The abort machinery (cancelActive, 'abort' handler, 'cancelled' push type, IAiStream.abort) still exists in the codebase, unused (D-12) | VERIFIED | All four still present: `cancelActive` (:602-613), `'abort'` handler (:523-533), `'cancelled'` push variant (:108), `IAiStream.abort` referenced (:28, :140). Reachable via the new dormant public seam `cancelActiveRequest()` (:586-588), which `index.ts` never calls (grep confirms no reference in index.ts). `grep -c cancelActive` = 5. |
| 10 | The empty-span guard and the code-challenge empty-span bypass still gate before enqueue (D-13) | VERIFIED | `trigger()` (:231-250) checks `mode !== 'code-challenge' && span.trim().length === 0` and returns before ever calling `enqueue()`; code-challenge is explicitly exempted. Tests at :65-98 and :407-417 (both directions) pass. |

**Score:** 9/10 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/main/ai/ai-orchestrator.ts` | Priority-queue orchestrator: two-lane FIFO enqueue, single-in-flight run loop, mode-keyed burst debounce, bounded cap + drop-oldest-auto eviction; abort machinery retained dormant | ⚠️ VERIFIED WITH DEFECT | All structural elements exist and are wired (`enqueue`, `placeInLane`, `dequeue`, `startNext`, `evictIfOverCap`, `MAX_PENDING_QUEUE`, `BURST_DEBOUNCE_MS`). The D-11 requestId guard on the four gateway handlers is incomplete (CR-01) — see gap. |
| `src/main/ai/ai-orchestrator.test.ts` | Queue behavior tests + reversed cancel-semantics tests + retained green regression tests | ⚠️ VERIFIED WITH GAP | 29/29 tests pass, covering double-press, burst-collapse, manual-preempts-auto, single-in-flight non-overlap, silent-eviction, and reversed cancel-semantics. The "no-cross-bleed" tests do not cover the back-to-back bleed scenario (only idle-gap and clean-start-buffer). |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `AiOrchestrator.trigger` | `AiOrchestrator.enqueue` | trigger enqueues instead of start-or-cancel | WIRED | `trigger()` calls `this.enqueue(mode, source)` unconditionally after the empty-span guard (:249); old cancel blocks fully removed. |
| gateway `'done'`/`'error'` terminal handlers | `AiOrchestrator.startNext` (drain-to-next) | start next queued item after clearActive() | WIRED (but under-guarded) | Both handlers call `this.clearActive()` then `this.startNext()` (:499/:504, :515/:520). The link is wired and functionally drains the queue, but because the handlers themselves lack a positive requestId match, a straggler event racing this transition can corrupt the newly-started request (CR-01). |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| AA-05 | 10-01-PLAN.md | Priority queue replacing drop-if-busy; manual preempts queued autos; nothing cancels in-flight; new requests queue and run in order | ✓ SATISFIED (with caveat) | Two-lane FIFO, enqueue-never-cancel, and manual-preempts-auto are all directly verified in code and tests (truths 1-3, 7). The requirement's core queuing/priority mechanics work. The D-11 no-bleed defect (truth 8) is adjacent to AA-05's "run in order" guarantee — the ORDER is correct, but a finished request's stray delta can corrupt the NEXT request's content, which undermines "run in order" cleanly. Not a full AA-05 blocker, but the defect sits inside the requirement's blast radius. |
| AA-06 | 10-01-PLAN.md | Debounce + single-in-flight so a burst never spawns parallel Claude calls; auto-answer cost stays bounded | ✓ SATISFIED | Burst debounce (mode-keyed, 200ms) and the single-in-flight gate (`startNext` returns while `active !== undefined`) are both directly verified in code and by passing tests (truths 4-5). No parallel `stream()` calls are possible under the current run-loop structure. This requirement's core guarantee does not depend on the requestId-guard defect (that defect corrupts content, not call-parallelism). |

Both AA-05 and AA-06 are declared in PLAN frontmatter and match REQUIREMENTS.md exactly (lines 86-87, 169-170, 181-182). No orphaned requirements for Phase 10 — REQUIREMENTS.md maps only AA-05/AA-06 to Phase 10.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| src/main/ai/ai-orchestrator.ts | 473, 494, 508, 524 | Guard checks `this.active === undefined` only, omitting a positive requestId match (inconsistent with `flushDelta`/`startCodeChallenge` in the same file) | 🛑 BLOCKER | This is CR-01 from the committed code review — a critical, unresolved finding directly contradicting the phase's own D-11 must-have and T-10-05 threat-model mitigation. |
| src/main/ai/ai-orchestrator.ts | 237-246 | Empty-span guard bypasses the burst debounce entirely (WR-02, review) | ℹ️ INFO | Not a Phase 10 must-have; noted in review as a UX inconsistency (a fumbled double-tap on empty transcript floods duplicate `empty` entries) but does not violate AA-05/AA-06 or any of the 10 must-haves. Non-blocking for this phase's goal. |
| src/main/ai/ai-orchestrator.ts | 231-249, 381-382 | Pull-on-run span re-read is not re-guarded for emptiness once a text-mode request is dequeued (WR-03, review) | ℹ️ INFO | Not a Phase 10 must-have; a real but separate cost-discipline gap (AI-06/D-13 adjacent) not covered by this phase's must_haves list. Non-blocking for this phase's goal. |
| src/main/ai/ai-orchestrator.test.ts | 535-541 | `toBeLessThanOrEqual` bound is weaker than the provable exact bound (IN-03, review) | ℹ️ INFO | Test-quality nit; does not affect whether the cap/eviction behavior itself is correct (verified independently by code inspection and the exact-bound manual test at :586). |

No `TBD`/`FIXME`/`XXX` debt markers found in either modified file.

### Human Verification Required

None. All ten must-haves are resolvable by direct code inspection, grep, and the existing automated test suite — no visual, real-time, or external-service behavior is involved in this pure main-side refactor.

### Gaps Summary

Nine of ten must-haves are genuinely and directly verified against the code: the two-lane priority queue, enqueue-never-cancel semantics, burst debounce, single-in-flight run loop, bounded cap with silent drop-oldest-auto eviction and manual cap-exemption, the byte-for-byte-unchanged single-press path, the dormant (but reachable) abort machinery, and the empty-span/code-challenge-bypass guard are all real, wired, and covered by passing tests (29/29 green).

The one failing must-have is the phase's own headline invariant: D-11 (no late-delta cross-bleed), which the plan explicitly calls out as needing "a two-request-in-sequence regression test." The delivered code's gateway handlers (`text`/`done`/`error`/`abort`) only check whether a request is active at all, not whether the event belongs to the CURRENTLY active request. This omission is asymmetric with the rest of the file — `flushDelta` and `startCodeChallenge`'s async continuations both do the positive requestId comparison correctly — making it a missed spot rather than a considered design choice. The two-lane queue's whole point is back-to-back execution (request 2 starts the instant request 1 clears), which is exactly the scenario this gap leaves unguarded. This was independently identified and documented in the committed 10-REVIEW.md (CR-01, critical) before this verification ran, and no fix commit has landed since. The SUMMARY.md's claim that "D-11 (requestId guard / no cross-bleed)" was "Preserved" and that the D-11 regression was "closed" in Task 3 is not supported by the code — the two tests added for D-11 test adjacent-but-different invariants (idle-gap drop, clean-start buffer) and do not exercise the actual back-to-back bleed path.

This gap is squarely Phase 10's responsibility, not deferred to a later phase: Phase 11's own success criteria (ROADMAP.md, Phase 11 SC5) state "the Phase 10 guarantees hold with a real auto-trigger driving them" — Phase 11 is built on the assumption that Phase 10's queue guarantees, including no-cross-bleed, are already solid. Fixing this now (before Phase 11 wires a real, higher-frequency auto-trigger onto the same queue) is materially cheaper than fixing it after.

---

_Verified: 2026-07-07T08:23:03Z_
_Verifier: Claude (gsd-verifier)_
