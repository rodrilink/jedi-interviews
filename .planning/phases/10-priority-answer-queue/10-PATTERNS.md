# Phase 10: Priority Answer Queue - Pattern Map

**Mapped:** 2026-07-07
**Files analyzed:** 2 modified (1 source, 1 test) + 3 read-only reference seams
**Analogs found:** 8 / 8 (all in-file — this is a self-referential refactor)

This is a **pure refactor** of `src/main/ai/ai-orchestrator.ts`, not a greenfield build. Every new concept
(pending queue, enqueue, run-loop/drain, burst debounce, bounded cap + eviction, `source` discriminator) has its
closest analog **inside the same orchestrator or its test file**. Do NOT introduce new architecture, new files, or
new external dependencies. Map each new piece onto the existing shape and preserve the house conventions
(4-space indent, single quotes, explicit return types, `private readonly`/`private` fields, TSDoc `why`-comments,
no `any`, AAA test comments on their own lines).

## File Classification

| Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---------------|------|-----------|----------------|---------------|
| `src/main/ai/ai-orchestrator.ts` | service (main-process orchestrator) | event-driven, single-in-flight → queued | *itself* (current single-in-flight impl) | exact (in-file refactor) |
| `src/main/ai/ai-orchestrator.test.ts` | test | event-driven | *itself* (existing describe blocks) | exact (extend existing style) |

**Read-only seams (unchanged this phase — do NOT edit):**

| File | Role | Why it stays untouched |
|------|------|------------------------|
| `src/main/ai/ai-gateway.interface.ts` | interface | The `IAiGateway`/`IAiStream` seam the queue drives; the queue calls `stream()` exactly as today (D-07). |
| `src/main/ai/prompt-assembler.ts` | utility | Grounding unchanged (AI-06). Each queued item calls `assemblePrompt` when it RUNS (pull-on-run), matching today's pull-on-trigger. |
| `src/main/ai/ai-history.ts` | service | Terminal `append` seam unchanged; bounded-cap `prune()` is the analog for the queue's own cap (see Shared Patterns). |
| `src/main/index.ts` | handler wiring | `trigger(mode)` signature is preserved (D-10) so the three `Ctrl+Alt+A/T/C` one-liners (`index.ts:153,156,172`) are unchanged. |

---

## Pattern Assignments

### 1. `source: 'manual' | 'auto'` discriminator on the queued/running item (D-05)

**Role:** type addition · **Analog:** `IActiveRequest` interface, `ai-orchestrator.ts:76-96`

The current in-flight item shape. Every field (`mode`, `requestId`, `id`, `stream`, `text`, `debounceTimer`,
`pendingDelta`, `model`, `startMs`, `firstTokenLogged`) carries over to a queued/running item. The natural addition
is a `source` discriminator (Phase 11 sets `'auto'`; all Phase 10 triggers set `'manual'`).

```typescript
/** The active in-flight request: its mode, monotonic id, stream handle, and accumulated text. */
interface IActiveRequest {
    mode: AiMode;
    requestId: number;
    id: string;
    stream: IAiStream;
    text: string;
    debounceTimer: ReturnType<typeof setTimeout> | undefined;
    pendingDelta: boolean;
    model: string;
    startMs: number;
    firstTokenLogged: boolean;
}
```

**Convention to replicate:** Use the local string-union `type` style already used for `AiMode`
(`ai-gateway.interface.ts:25`) — `type RequestSource = 'manual' | 'auto'` or an inline union field. Prefix the queued-item
interface with `I` (house rule: `IActiveRequest`, `IAiHistoryEntry`). A queued item that has not yet started has no
live `stream` yet — mirror the code-challenge **reserve** pattern (§6) which already holds an `IActiveRequest` whose
`stream` is a `{ abort: (): void => undefined }` placeholder (`ai-orchestrator.ts:232`). Decide (Claude's Discretion,
D-08 note): a queued item likely stores the **inputs needed to build the stream at run time** (`mode`, `source`, and the
reserved `requestId`/`id`) rather than a live stream — because prompt assembly is pull-on-run.

---

### 2. Pending queue data structure + two lanes (D-05)

**Role:** state field · **Analog:** `private active: IActiveRequest | undefined` + `private requestSeq = 0` (`ai-orchestrator.ts:109-111`)

Current single-in-flight state. The refactor keeps `active` as the ONE running slot and adds a pending list beside it.

```typescript
export class AiOrchestrator {
    private active: IActiveRequest | undefined;
    private requestSeq = 0;
    private handlersWired = false;
```

**Convention to replicate:** New fields are `private`, initialized inline, documented with a `why` comment.
For the two-lane FIFO (manual head, auto tail), the discretion note (D-08) allows **two arrays** (`pendingManual`,
`pendingAuto`) OR **one array with insert-before-first-auto** logic. The `AiHistory.entries: IAiHistoryEntry[] = []`
field (`ai-history.ts:67`) is the analog for a private array of records with FIFO `shift()`/`push()` semantics.

---

### 3. `trigger(mode)` becomes an ENQUEUE call (D-02/D-03/D-10)

**Role:** method refactor · **Analog:** the current `trigger` body, `ai-orchestrator.ts:150-205`

`trigger` keeps its signature `public trigger(mode: AiMode): void` (D-10 — `index.ts` wiring unchanged). The
**empty-span guard** (`:156-165`) and the **code-challenge bypass** (`:186-190`) stay BEFORE enqueue (D-13). What changes:
the `active !== undefined` same-mode cancel (`:167-172`) and cross-mode cancel+restart (`:174-179`) blocks are
**deleted** and replaced with an enqueue call. If nothing is running, enqueue → drain immediately starts it; if
something is running, enqueue → it waits (D-01: nothing cancels in-flight).

```typescript
public trigger(mode: AiMode): void {
    const span = this.transcriptBuffer.recentSince(RECENT_SPAN_MS);

    // D-11 empty-span guard — BEFORE any gateway call. (unchanged, gates before enqueue)
    if (mode !== 'code-challenge' && span.trim().length === 0) {
        // ... push 'empty' entry, return
    }

    // DELETE the D-06 same-mode cancel and D-07 cross-mode cancel blocks here.
    // REPLACE with: this.enqueue(mode, 'manual'); (subject to burst debounce §5, cap §7)
}
```

**Convention to replicate:** The empty-span early-return block (`:156-165`) shows the house pattern for reserving a
`requestId`/`id`/`at`, appending to history, pushing, and returning — reuse verbatim. `assemblePrompt` and the
`this.gateway.stream({...})` call currently live inline in `trigger` (`:198-201`); they **move into the run/start step**
(§4) so grounding is pulled when the item RUNS (pull-on-run, per canonical_refs).

---

### 4. Run-loop / drain-to-next (start the next item on terminal) (D-01/D-07)

**Role:** private method (new) · **Analog:** `clearActive()` (`ai-orchestrator.ts:410-416`) + the terminal handlers `done`/`error` (`:305-330`)

The drain hook goes exactly where `clearActive()` runs today — on `done` and `error` (and the code-challenge capture
`error`, `:263`). Currently the terminal handlers call `clearActive()` then leave `active` undefined. The refactor:
after clearing, pull the next queued item (manual lane first, then auto) and start it.

```typescript
this.gateway.on('done', (finalText: string) => {
    if (this.active === undefined) {
        return;
    }
    const { requestId, id, mode } = this.active;
    const text = finalText.length > 0 ? finalText : this.active.text;
    this.clearActive();                        // <-- drain hook goes right after here
    this.history.append({ id, mode, text, kind: 'done' });
    this.pushAi({ type: 'done', requestId, id, text });
    this.pushHistorySnapshot();
    // NEW: this.startNext();  (dequeue head-of-queue and start its stream)
});
```

The **start** logic is the current `trigger` tail (`:192-204`): allocate `requestId`/`id`, pick `model`, call
`assemblePrompt(...)` (pull-on-run here), call `this.gateway.stream(...)`, set `this.active = {...}`, push `thinking`.
Extract this into a private `startRequest(item)` / `startNext()` method.

**Convention to replicate:** Single gateway-emitter model means `startNext` must NOT be called while `active` is still
set — the D-07 single-in-flight invariant. The existing handlers already guard `if (this.active === undefined) return;`
(`:286,306,319,333`); the drain must clear first, then start, so the emitter always maps to exactly one live request.
Code-challenge's async reserve (§6) means a dequeued code-challenge item starts its capture, not a stream, directly.

---

### 5. Request-level burst debounce keyed by mode (D-06)

**Role:** private method + timer field (new) · **Analog:** `scheduleDeltaFlush` / `flushDelta` + `DELTA_DEBOUNCE_MS` (`ai-orchestrator.ts:48, 350-385`)

The existing **delta** debounce is the sibling concept — trailing-edge `setTimeout`, coalesce, re-check on fire. The
new burst debounce collapses repeated same-mode enqueues within a window into ONE queued item (a rapid double
`Ctrl+Alt+A` → one answer). Model the timer + re-check the same way.

```typescript
export const DELTA_DEBOUNCE_MS = 40;   // <-- named-constant precedent for a new BURST window constant

private scheduleDeltaFlush(requestId: number): void {
    if (this.active === undefined) { return; }
    this.active.pendingDelta = true;
    if (this.active.debounceTimer !== undefined) { return; }   // <-- coalesce: don't reschedule
    this.active.debounceTimer = setTimeout(() => {
        this.flushDelta(requestId);
    }, DELTA_DEBOUNCE_MS);
}
```

**Convention to replicate:**
- Add a **named constant** (e.g. `BURST_DEBOUNCE_MS`) with a TSDoc `why` comment relating it to `DELTA_DEBOUNCE_MS`'s
  rationale (Claude's Discretion, D-08 note allows reuse or a request-level value).
- Dedup key = **mode** (D-06): track a per-mode pending-debounce timer (a small `Map<AiMode, Timer>` or per-mode
  fields), mirroring the `debounceTimer !== undefined` "already scheduled → collapse" guard.
- The `flushDelta` re-check pattern (`:373-374`: `if (this.active === undefined || requestId !== this.active.requestId) return;`)
  is the template for the "still want to enqueue when the timer fires" guard.
- Different modes are NOT collapsed (D-06) — key the debounce state by `mode`.
- Timer type is `ReturnType<typeof setTimeout> | undefined` (`:84`).
- **Tests use fake timers** (`vi.useFakeTimers()`, `beforeEach` `test:42`; `vi.advanceTimersByTime(200)`
  `test:389`) — the burst-collapse test drives the window this way.

---

### 6. Code-challenge async reserve within the queue (D-13)

**Role:** private method (preserve) · **Analog:** `triggerCodeChallenge` (`ai-orchestrator.ts:220-268`)

The code-challenge path reserves an `IActiveRequest` **synchronously with a placeholder stream**, then swaps in the
real stream after async capture, guarded by the request-id check. This is the closest analog for a queued item that is
not yet a live stream, and it must keep working: a dequeued code-challenge item starts capture, not `gateway.stream`.

```typescript
this.active = {
    mode: 'code-challenge', requestId, id,
    stream: { abort: (): void => undefined },   // placeholder until capture resolves
    // ...
};
this.pushAi({ type: 'thinking', requestId, id, mode: 'code-challenge', at });

void this.captureImage()
    .then((image) => {
        if (this.active === undefined || this.active.requestId !== requestId) { return; }  // request-id guard
        const { system, userContent } = assemblePrompt({ mode: 'code-challenge', span, context: this.getActiveContext(), image });
        this.active.stream = this.gateway.stream({ model: CODE_CHALLENGE_MODEL, maxTokens: MAX_TOKENS['code-challenge'], system, userContent });
    })
    .catch((error: unknown) => { /* report-don't-throw: error entry + clearActive + pushHistorySnapshot */ });
```

**Convention to replicate:** The catch-branch calls `this.clearActive()` (`:263`) on fault — that terminal path must
ALSO drain to the next queued item (§4), so a failed capture doesn't strand the queue. `span` for a queued
code-challenge is read/assembled at run time (pull-on-run).

---

### 7. Bounded cap + drop-oldest-auto eviction (D-08/D-09)

**Role:** private method (new) · **Analog:** `AiHistory.prune()` (`ai-history.ts:108-118`) + `MAX_AI_ENTRIES` constant (`:47`)

The bounded-history pruner is the direct analog: a named ceiling constant + a `while`-loop that `shift()`s the oldest
until within bound. The queue's eviction differs in policy — drop oldest **auto** only, never a manual (D-08), and
silently (no push, D-09).

```typescript
export const MAX_AI_ENTRIES = 50;   // <-- named-cap-constant precedent for a new QUEUE cap

private prune(): void {
    while (this.entries.length > MAX_AI_ENTRIES) {
        this.entries.shift();   // <-- FIFO drop-oldest
    }
    // ...
}
```

**Convention to replicate:**
- Add a **named constant** (e.g. `MAX_PENDING_QUEUE = 5`) with a TSDoc `why` comment (D-08: small single-digit).
- Eviction targets the **oldest auto** item, never manual (`entries.shift()` is the FIFO-oldest idiom; the queue
  finds and drops the oldest auto). If no auto exists (all-manual backlog), enqueue anyway — manuals are cap-exempt (D-08).
- Eviction is **silent** — do NOT push a `jedi:ai` event and do NOT append to history (D-09). Contrast with every
  terminal path which DOES push; this one deliberately does not.

---

### 8. Preserve the monotonic `requestId` guard across queued requests (D-11)

**Role:** invariant (preserve) · **Analog:** the four gateway handlers, `ai-orchestrator.ts:281-343` + `flushDelta` guard `:373-374`

Every gateway handler already starts with `if (this.active === undefined) return;` and the delta path re-checks
`requestId !== this.active.requestId`. With the queue running requests back-to-back on ONE shared emitter, this guard
is even more load-bearing: a finished request's late delta must never bleed into the NEXT dequeued entry.

```typescript
this.gateway.on('text', (textDelta: string) => {
    if (this.active === undefined) {          // late delta from a finished stream → dropped
        return;
    }
    // ...
    this.active.text += textDelta;
    this.scheduleDeltaFlush(this.active.requestId);
});
```

**Convention to replicate:** Keep `++this.requestSeq` (`:157,192,221`) as the sole monotonic id source so each dequeued
item gets a fresh id. Keep ALL four handler guards. **D-11 requires a NEW regression test:** run two requests in
sequence (request 1 `done`, request 2 dequeued and started), fire a late request-1 delta, assert it does not appear in
request 2's entry — model on the existing `request-id guard (Pitfall 1)` test (`test:140-156`).

---

### 9. Keep abort/`'abort'`/`cancelled` machinery DORMANT (D-12)

**Role:** dead-but-retained code (preserve) · **Analog:** `cancelActive()` (`:396-407`), the `'abort'` handler (`:332-342`), the `cancelled` push variant (`:68`), `IAiStream.abort` (`ai-gateway.interface.ts:28-31`), `AiEntryKind` `'cancelled'` (`ai-history.ts:23`)

Phase 10 removes cancel-on-re-press (D-01/D-04-cancel) but must NOT delete the abort machinery — a future explicit-cancel
key reuses it (D-12). `cancelActive` becomes unreferenced by `trigger` but stays in the file; the `'abort'` handler, the
`cancelled` push type, and `IAiStream.abort` all remain.

**Convention to replicate:** Leave these in place. If lint flags `cancelActive` as unused, keep it (add a TSDoc note that
it is dormant for a future cancel key, D-12) rather than deleting. Do NOT strip `type: 'cancelled'` from `IAiPushEvent`
or `'cancelled'` from `AiEntryKind`.

---

## Shared Patterns

### Single gateway-emitter → request-id guard (load-bearing)
**Source:** `ai-orchestrator.ts:281-343` (all four `gateway.on(...)` handlers)
**Apply to:** the run-loop (§4), the drain, and every terminal path.
One shared emitter serves all requests sequentially. Every handler MUST guard `active === undefined` and the delta path
MUST re-check `requestId`. This is the D-11 invariant and the single most important thing to preserve.

### Named-constant discipline with `why`-TSDoc
**Source:** `DELTA_DEBOUNCE_MS = 40` (`ai-orchestrator.ts:44-48`), `MAX_AI_ENTRIES = 50` (`ai-history.ts:42-47`)
**Apply to:** the new burst-debounce window (§5) and the new queue cap (§7).
Every tunable is a SCREAMING_SNAKE_CASE `export const` with a doc comment explaining the rationale — never a magic literal.

### Terminal → `clearActive()` → history.append → pushAi → pushHistorySnapshot sequence
**Source:** `done` handler `ai-orchestrator.ts:305-316`, `error` `:318-330`, capture-fault `:263-267`
**Apply to:** every place a request finishes. The drain-to-next (§4) hooks in AFTER this sequence. Order matters:
clear the running slot first (so the guard drops stragglers), record/push, THEN start the next.

### Test style: real EventEmitter fake + `stream` spy + fake timers
**Source:** `ai-orchestrator.test.ts:17-20` (`FakeAiGateway`), `:38-59` (`beforeEach`), `:22-25` (`seedSpan`)
**Apply to:** all new queue tests.

```typescript
class FakeAiGateway extends EventEmitter implements IAiGateway {
    public readonly abort = vi.fn<() => void>();
    public readonly stream = vi.fn<(request: IAiPromptRequest) => IAiStream>(() => ({ abort: this.abort }));
}
```

Assertions use `expect(gateway.stream).toHaveBeenCalledTimes(n)` (`test:95,121,136,348`) — the canonical
single-in-flight / non-overlap assertion (SC 3). Drive streams by `gateway.emit('text', ...)` / `gateway.emit('done', ...)`
and advance the debounce with `vi.advanceTimersByTime(200)` (`test:389`). All tests use AAA comments on their own lines
with no trailing explanation. Type test objects explicitly (`as IAiPromptRequest`, `test:247`).

**New tests required (from CONTEXT specifics + D-06/D-07/D-11):**
1. **Double-press proves the queue (D-02):** two same-mode `trigger`s with a running stream → BOTH stream to completion
   in sequence; assert `stream` called twice, non-overlapping (drive `done` between). (SC canonical demo.)
2. **Burst collapses (D-06):** rapid same-mode triggers inside the debounce window → assert `stream` called ONCE after
   `vi.advanceTimersByTime`.
3. **Manual preempts queued autos (D-05):** simulate queued auto items (via a test-visible enqueue path), enqueue a
   manual, finish the running stream → assert the manual runs before the autos.
4. **Cross-mode enqueues, does NOT cancel (D-01/D-03):** trigger answer, trigger talking-points mid-stream → assert
   `abort` NOT called and both run in sequence (this REPLACES the old `cancel-current-start-new` test at `test:125-138`,
   which must be updated to the new no-cancel semantics).
5. **No cross-bleed across sequential requests (D-11):** request 1 done, request 2 started, late request-1 delta →
   assert not in request 2's entry.
6. **Silent eviction (D-09):** overflow the auto lane → assert oldest auto dropped with NO `jedi:ai` push.

**Tests that must CHANGE (semantics reversed by D-01/D-02/D-03):**
- `single-in-flight cancel (D-06)` (`test:99-123`) — re-press no longer aborts; it enqueues.
- `cancel-current-start-new across modes (D-07)` (`test:125-138`) — cross-mode no longer aborts; it enqueues.
- The code-challenge re-press/cross-mode cancel tests (`test:325-349`) — same reversal.
These are the D-06/D-07 blocks being retired; update their expectations, don't just delete (keep coverage of the new
behavior).

**Tests that must stay GREEN unchanged (D-10 regression guards):**
- `empty-span guard` (`test:65-97`), `active-context injection` (`test:232-286`), `trailing-edge debounce`
  (`test:366-395`), the single-press latency-logging happy path (`test:158-192`), and the code-challenge
  happy-path/routing/report-don't-throw tests (`test:288-323, 351-363`).

---

## No Analog Found

None. Every new concept maps to an in-file analog (the orchestrator's own current structure or `AiHistory.prune`).
This is a self-referential refactor — the planner should NOT reach for RESEARCH.md patterns; the source of truth is the
existing orchestrator.

## Metadata

**Analog search scope:** `src/main/ai/` (orchestrator, gateway interface, prompt-assembler, history, tests), `src/main/index.ts` wiring.
**Files scanned:** 6
**Pattern extraction date:** 2026-07-07
