---
phase: 10-priority-answer-queue
reviewed: 2026-07-07T08:13:06Z
depth: standard
files_reviewed: 2
files_reviewed_list:
  - src/main/ai/ai-orchestrator.ts
  - src/main/ai/ai-orchestrator.test.ts
findings:
  critical: 1
  warning: 3
  info: 3
  total: 7
status: issues_found
---

# Phase 10: Code Review Report

**Reviewed:** 2026-07-07T08:13:06Z
**Depth:** standard
**Files Reviewed:** 2
**Status:** issues_found

## Summary

Reviewed the priority-answer-queue refactor of `AiOrchestrator` (two-lane FIFO, mode-keyed burst
debounce, single-in-flight run loop, bounded auto-eviction) and its unit test. The intentional design
decisions (D-01..D-13: enqueue-never-cancel, dormant abort machinery, silent auto-eviction,
byte-for-byte single-press path) were treated as ground truth and not flagged.

The queue/eviction/dequeue mechanics are sound: eviction is correct FIFO drop-oldest-auto with the
manual cap-exemption early return, `dequeue` correctly drains manual-before-auto, and the run-loop
gate maps the shared emitter to exactly one live request during the idle→active transition.

However, the refactor's headline invariant — the D-11 monotonic-requestId guard that is supposed to
prevent a finished stream's late deltas from bleeding into the next queued entry — is **only
partially implemented**. The `'text'`, `'done'`, `'error'`, and `'abort'` handlers guard on
`this.active === undefined` but do NOT compare the event to the active request's `requestId`, even
though their own doc comments (and D-11) claim they do. This protects the idle gap between requests
but not the back-to-back case that the two-lane queue makes routine. The `flushDelta` path IS
requestId-guarded, making the omission an internal inconsistency, and the regression test does not
exercise the uncovered case.

## Critical Issues

### CR-01: Gateway `text`/`done`/`error`/`abort` handlers omit the requestId guard, allowing cross-request delta bleed (violates D-11)

**File:** `src/main/ai/ai-orchestrator.ts:468-534`

**Issue:** D-11 and the in-code comments state that *every* gateway handler drops events whose id is
not the currently-running request, so a finished stream's late deltas can never bleed into the next
queued entry. The implementation does not do this. All four handlers guard only on
`this.active === undefined`:

```typescript
this.gateway.on('text', (textDelta: string) => {
    if (this.active === undefined) {  // <-- no requestId comparison
        return;
    }
    // ...
    this.active.text += textDelta;   // appends to WHATEVER request is now active
    this.scheduleDeltaFlush(this.active.requestId);
});
```

With the new two-lane queue, requests run back-to-back: when request 1 reaches `done`, the handler
calls `clearActive()` then `startNext()`, which immediately sets `active` to request 2. If request 1's
shared-emitter stream emits a straggler `'text'` (or a duplicate terminal) *after* request 2 is
already active, the `active === undefined` guard is false (request 2 is active), so request 1's
straggler text is appended to request 2's buffer and pushed under request 2's id — exactly the
cross-bleed D-11 exists to prevent. The idle-gap straggler test (`:229-244`) only covers the
`active === undefined` path; no test emits a request-1 event *after* request 2 becomes active, so the
gap is untested. This is the specific failure mode the phase's threat model calls out ("late-delta
bleed").

Note the asymmetry that makes this an internal inconsistency, not just a missing feature:
`scheduleDeltaFlush`/`flushDelta` (`:541-576`) DO re-check `requestId !== this.active.requestId`, and
`startCodeChallenge` (`:429`, `:440`) DO guard on `this.active.requestId !== requestId`. Only the raw
gateway handlers were left unguarded — the comment at `:468-472` even describes a requestId guard the
code never applies.

**Fix:** Have each handler carry/compare the active requestId. Since the gateway events don't carry an
id, capture the active request at handler entry and gate on it — or (cleaner) tag each `stream()` call
with its requestId and have the gateway echo it. Minimal in-place fix that matches the existing
`flushDelta` pattern:

```typescript
this.gateway.on('text', (textDelta: string) => {
    const active = this.active;
    // Drop events from a superseded stream: only the currently-running request accumulates (D-11).
    if (active === undefined) {
        return;
    }
    // ... (existing first-token log + append against `active`)
});
```

If the gateway can emit for the *previous* stream while a *new* one is active, the guard must be a
positive id match, which requires threading the requestId through the gateway. Recommended: add a
`requestId` to `stream()`/events (or subscribe per-stream) so `done`/`error`/`text` can be matched to
`this.active.requestId` and dropped otherwise. Add a regression test that emits a request-1 `text`
AFTER request 2 has started and asserts request 2's delta contains only its own text.

## Warnings

### WR-01: Terminal handlers can fire a second time for the same stream and corrupt the next request

**File:** `src/main/ai/ai-orchestrator.ts:492-521`

**Issue:** Same root cause as CR-01, distinct symptom. If a gateway emits `done` (or `error`) and then
a second terminal, the first `done` clears `active` and `startNext()` may start request 2; the second
terminal then finds request 2 active, calls `clearActive()` + `startNext()` on it, prematurely
terminating request 2 and appending request 1's id/mode under a `done`/`error` history entry for a
request that never actually ran. The single `active === undefined` guard does not distinguish "no
request" from "a different request." A well-behaved gateway emits one terminal per stream, so this is a
robustness gap rather than a guaranteed crash — but the orchestrator is documented as report-don't-throw
and defensively guarded, and it is not defended here.

**Fix:** Fold into the CR-01 fix — gate every terminal handler on a positive requestId match so a
stray/duplicate terminal for a superseded stream is dropped.

### WR-02: Empty-span presses bypass the burst debounce, spawning one history entry + push per press

**File:** `src/main/ai/ai-orchestrator.ts:237-246`

**Issue:** The empty-span guard returns before `enqueue`, so it never consults `burstTimers`. A rapid
double/triple-tap of `Ctrl+Alt+A` on an empty transcript appends a separate `empty` history entry and
pushes a separate `empty` event per press, whereas the same burst on a non-empty span collapses to one
request (D-06). D-13 does say the empty-span guard gates "before enqueue," so gating placement is
intentional — but the *user-visible burst-collapse behavior* is then inconsistent between the empty and
non-empty paths (a fumbled double-tap floods the panel with duplicate "No recent transcript" rows). The
non-empty path treats a fumbled double-tap as a single action; the empty path does not.

**Fix:** Either debounce the empty path on the same mode-keyed window, or dedup consecutive `empty`
entries. Simplest: check `this.burstTimers.has(mode)` (or "last entry is an `empty` of this mode within
the window") before appending the placeholder, so a burst yields one placeholder like the non-empty
path. If the current behavior is deliberate, add a code comment stating the empty path intentionally
skips the burst window so a future reader does not "fix" it.

### WR-03: Pull-on-run can stream a text mode against an empty span even though the empty guard passed at press time

**File:** `src/main/ai/ai-orchestrator.ts:231-249, :381-382`

**Issue:** `trigger` checks `span.trim().length === 0` at press time and reserves the request, but the
actual prompt span is re-read at run time (`:381`, pull-on-run). For a queued text-mode request behind
a long stream, the transcript buffer's time-window pruning can empty the span between press and run.
The run path does not re-apply the empty-span guard, so a text-mode request that was non-empty at press
can reach `gateway.stream` with an empty span — a wasted Claude call that produces an ungrounded answer,
directly against the D-13 empty-span intent and the phase's cost-blowout threat. (Code-challenge is
correctly exempt.)

**Fix:** Re-check the span emptiness for non-code-challenge modes inside `startRequest` after the
pull-on-run read (`:381`); on empty, take the empty-span terminal path (append `EMPTY_SPAN_TEXT`, push
`empty`) and `startNext()` instead of calling `gateway.stream`. Add a test: enqueue a text request
behind a running stream, prune the buffer to empty, finish the running stream, assert no second
`gateway.stream` call.

## Info

### IN-01: First-token latency log fires for a code-challenge whose stream has not started

**File:** `src/main/ai/ai-orchestrator.ts:482-486`

**Issue:** During `startCodeChallenge`'s async capture window, `active` is set with a no-op placeholder
stream. If any `'text'` event arrives in that window (only possible via the CR-01 straggler path), the
`text` handler logs a `first-token` latency line and accumulates text for a stream that has not begun.
Resolved for free by the CR-01 requestId fix; noted so it is not missed.

**Fix:** Covered by CR-01. Optionally also gate the first-token log on `this.active.stream` being the
real (non-placeholder) stream.

### IN-02: Burst timers are never cleared on shutdown or `cancelActive`

**File:** `src/main/ai/ai-orchestrator.ts:189, :277-282`

**Issue:** `burstTimers` entries self-delete when they fire, but there is no path to clear pending burst
timers on teardown (the dormant `cancelActive`, or a future clean-shutdown). A pending `setTimeout`
would fire post-shutdown and call `placeInLane`/`startNext` on a torn-down orchestrator. Low impact for
a single-instance main-process object, but worth a `dispose()`/clear when the abort machinery is
activated for the deferred cancel key (D-12).

**Fix:** Add a private `clearBurstTimers()` that `clearTimeout`s and clears the map, and call it from
any future shutdown/cancel-all path.

### IN-03: Test asserts a `<=` bound where an exact bound is provable, weakening the eviction guarantee

**File:** `src/main/ai/ai-orchestrator.test.ts:535-541`

**Issue:** The auto-overflow test drains and asserts `stream.mock.calls.length` is
`toBeLessThanOrEqual(MAX_PENDING_QUEUE + 1)`. The eviction contract is exact (running item + at most
`MAX_PENDING_QUEUE` survivors), so a stronger `toBe(MAX_PENDING_QUEUE + 1)` would catch an
over-eviction regression (dropping too many) that the `<=` assertion silently passes. As written the
test also passes if eviction wrongly drops everything.

**Fix:** Assert the exact expected stream count for the overflow scenario (mirroring the manual test at
`:586` which correctly uses `toBe(manualCount + 1)`).

---

_Reviewed: 2026-07-07T08:13:06Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
