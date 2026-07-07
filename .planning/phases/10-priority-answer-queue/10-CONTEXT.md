# Phase 10: Priority Answer Queue - Context

**Gathered:** 2026-07-07
**Status:** Ready for planning

<domain>
## Phase Boundary

Refactor the AI orchestrator (`src/main/ai/ai-orchestrator.ts`) from its current single-in-flight "drop if busy" model into a **priority answer queue** so a manual answer and (a future) auto-answer can both be requested without racing. Delivered as a **pure orchestrator refactor with NO auto-trigger source yet** — the auto source lands in Phase 11. A unit test (and a manual double-press) proves the queue behavior. Requirements: **AA-05, AA-06**.

**In scope:** the queue data structure + enqueue/dequeue/run loop, the single-in-flight execution gate, the debounce/dedup that collapses bursts, the bounded-cap + eviction policy, and re-specifying the v1.1 cancel semantics (D-06/D-07) for v1.2. The existing manual hotkey flows (`Ctrl+Alt+A` answer, `Ctrl+Alt+T` talking-points, `Ctrl+Alt+C` code-challenge) must behave identically for a single press.

**Out of scope (later phases):** the auto-answer trigger from question classification (Phase 11); the scope hotkey / directed-at-me heuristic (Phase 12); any renderer/UI change beyond what the existing `jedi:ai` push already does (the queue is main-side only).

</domain>

<decisions>
## Implementation Decisions

### Cancel semantics (re-specify D-06/D-07 for v1.2)
- **D-01:** **Nothing cancels an in-flight stream.** The in-flight answer always runs to completion (`done`/`error`) before the next queued item starts. This retires the v1.1 rule that a re-press aborted the stream.
- **D-02:** **Re-pressing the SAME mode mid-stream ENQUEUES another request** of that mode (it no longer cancels — old D-06 is retired). Subject to the same-mode debounce/dedup in D-06 below, so a rapid accidental double-tap collapses rather than double-queues.
- **D-03:** **Pressing a DIFFERENT mode mid-stream ENQUEUES it** (into the manual head lane, D-04) instead of the old D-07 cancel-and-restart. One stream still runs at a time; the other mode runs when the current finishes.
- **D-04-cancel:** **No cancel gesture exists in Phase 10.** There is no key that aborts a running stream. The escape hatch is deferred, not designed here (see Deferred Ideas).

### Queue ordering
- **D-05:** **Two-lane FIFO.** Manual requests run in press-order (FIFO) at the **head** of the queue; auto-answers run in arrival-order (FIFO) **behind all manuals**. A newly-enqueued manual goes *behind* already-queued manuals but *ahead of every* queued auto. (Phase 10 has no auto source yet, but the queue must implement both lanes so Phase 11 can feed the auto lane without touching this logic.) A manual never reorders ahead of an earlier manual (no LIFO).

### Debounce / dedup (AA-06)
- **D-06:** **Dedup key = mode, within the debounce window.** Repeated enqueue requests of the SAME mode arriving inside the debounce window collapse into a single queued request (e.g. a rapid double `Ctrl+Alt+A` produces ONE answer, not two). Different modes in quick succession are NOT collapsed — each is answered. This is what the ROADMAP's "double-press proves the queue" test asserts.
- **D-07:** **Single-in-flight execution gate is the hard invariant.** At most one gateway `stream()` call is ever active. The debounce collapses bursts *before* they reach the gateway; the run loop starts the next item only after the current stream reaches a terminal event. A unit test asserts `stream()` call count and non-overlap (SC 3).

### Bounded queue + eviction (AA-05 / SC 5)
- **D-08:** **Hard cap ≈ 5 pending items.** (Planner may fine-tune within a small single-digit range; keep it a named constant.) On overflow, **drop the oldest queued AUTO item first**; **manual requests are NEVER dropped/evicted.** If overflow occurs with no auto items to evict (all-manual backlog), the new item is still enqueued — manuals are exempt from the cap's eviction (the cap bounds runaway *auto* growth, which is the real risk once Phase 11 lands).
- **D-09:** **Dropped items are silent.** An evicted auto leaves NO user-facing trace (no "dropped" entry, no push). The glanceable overlay stays uncluttered. (Revisit if Phase 11/12 usage shows silent drops are confusing.)

### Preserve across the refactor (regression guards)
- **D-10:** **Backward-compatible single press.** A single `Ctrl+Alt+A` / `Ctrl+Alt+T` / `Ctrl+Alt+C` with an empty queue must produce a byte-for-byte identical grounded, streamed result to today (the one-item queue path == the old single-in-flight path). Existing orchestrator tests must stay green.
- **D-11:** **Preserve the monotonic `requestId` guard (Pitfall 1).** Every gateway handler (`text`/`done`/`error`/`abort`) must keep dropping events whose id is not the currently-running request, so a finished request's late deltas never bleed into the next queued entry. Add a regression test that runs two requests in sequence and asserts no cross-bleed.
- **D-12:** **Keep the stream-abort machinery DORMANT, not deleted.** The `stream.abort()` path, the `'abort'` gateway handler, and the `cancelled` push type stay in the codebase (unused in Phase 10) so a future explicit-cancel key or clean-shutdown abort can reuse them. Do not rip them out.
- **D-13:** **Empty-span guard and code-challenge bypass unchanged.** The D-11 empty-span placeholder (text modes) and the Phase 7 code-challenge-bypasses-empty-span rule (D-07) survive the refactor untouched — they gate *before* enqueue.

### Claude's Discretion
- Exact cap number within the small single-digit range (D-08), the debounce window duration (reuse/relate to the existing `DELTA_DEBOUNCE_MS = 40` rationale or pick a request-level window — planner's call), the internal queue data structure (two arrays vs one array with a priority field), and whether "thinking…" is pushed at enqueue time or at run-start time for queued items (as long as the single-press UX is unchanged, D-10).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements & roadmap
- `.planning/REQUIREMENTS.md` — AA-05 (priority queue: manual preempts queued autos, nothing cancels in-flight, new requests queue) and AA-06 (debounce + single-in-flight so a burst never spawns parallel Claude calls). Milestone v1.2 section.
- `.planning/ROADMAP.md` §"Phase 10: Priority Answer Queue" — the 5 success criteria + the threat model (cost blowout, unbounded growth, manual starvation, late-delta bleed, cancel-semantics regression). This CONTEXT resolves the gray areas the ROADMAP left open.

### Code being refactored (READ before planning)
- `src/main/ai/ai-orchestrator.ts` — the class being refactored. Current single-in-flight guard (`this.active !== undefined`), cancel-on-re-press (D-06, lines ~167-172), cross-mode cancel+restart (D-07, lines ~174-179), the `requestId` guard in every gateway handler (Pitfall 1), the delta debounce (`scheduleDeltaFlush`/`flushDelta`), and the code-challenge async-capture reserve path.
- `src/main/ai/ai-orchestrator.test.ts` — existing tests that MUST stay green (single-press behavior) + where the new queue tests go.
- `src/main/ai/ai-gateway.interface.ts` — `IAiGateway` / `IAiStream` seam the queue drives (fake it in tests, assert `stream()` call count).
- `src/main/ai/prompt-assembler.ts` — `assemblePrompt` + `RECENT_SPAN_MS`; grounding is unchanged (AI-06). Each queued item assembles its prompt when it RUNS (pull-on-run) vs when enqueued — planner decides, but a manual's grounding should reflect the moment it runs, consistent with today's pull-on-trigger.

### v1 constraint reversal context
- `.planning/PROJECT.md` §"Current Milestone: v1.2" — records that v1.2 reverses "AI calls are user-triggered only"; Phase 10 is the enabling layer (still no auto source, so no reversal is user-observable yet).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `AiOrchestrator.trigger(mode)` — the hotkey entry point (`src/main/index.ts` wires `Ctrl+Alt+A/T/C` to it). Becomes an ENQUEUE call rather than a start-or-cancel call.
- `IActiveRequest` shape — most fields (mode, requestId, id, stream, text, debounceTimer, model, startMs, firstTokenLogged) carry over to a queued/running item; a `source: 'manual' | 'auto'` discriminator is the natural addition for the two-lane priority (Phase 11 sets `'auto'`).
- The `requestId` monotonic guard + `clearActive()`/terminal handlers — the drain-to-next logic hooks in where `clearActive()` runs today (on `done`/`error`).
- `DELTA_DEBOUNCE_MS = 40` — the existing house debounce rationale (mirrors the 66ms audio throttle); the request-level burst debounce is a sibling concept.

### Established Patterns
- Single gateway emitter shared across requests → the `requestId` guard is load-bearing; the queue must preserve it (D-11).
- Main-owned state, one-way `jedi:ai` push (IN-01) — no renderer→main control channel; the queue is entirely main-side.
- Report-don't-throw on faults (code-challenge capture path) — terminal `error` entry, never a crash.

### Integration Points
- `src/main/index.ts` — where the orchestrator is constructed and hotkeys bind to `trigger`. Phase 11 will add an auto enqueue call from the `on('utterance')` binding; Phase 10 leaves index.ts wiring essentially unchanged (still just the three manual hotkeys).

</code_context>

<specifics>
## Specific Ideas

- The ROADMAP's own "double-press proves the queue" test is the canonical acceptance demo for Phase 10: fire two same-mode requests, observe BOTH stream to completion in sequence (not one dropped) — and a rapid burst collapses to one via the debounce (D-06/D-07).
- Manual-priority demo: with auto items queued (simulated in a test, since no real auto source yet), a manual request runs next after the in-flight stream finishes, ahead of the queued autos.

</specifics>

<deferred>
## Deferred Ideas

- **Explicit cancel key** — v1.2 removes cancel-on-re-press (D-01/D-04-cancel). A dedicated "cancel current stream" hotkey (reusing the dormant abort machinery, D-12) is a plausible future addition; not in v1.2 scope. Note for the backlog if the user wants an escape hatch after living with the queue.
- **Dropped-item visibility** — D-09 drops evicted autos silently; if silent drops prove confusing once Phase 11/12 auto-answers are live, revisit a muted "dropped (queue full)" marker.
- **Per-mode / per-lane cap tuning** — a single global cap (D-08) for now; separate auto vs manual caps could come later if usage warrants.

</deferred>
