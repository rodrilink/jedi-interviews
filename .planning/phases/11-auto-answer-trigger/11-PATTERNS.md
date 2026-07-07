# Phase 11: Auto-Answer Trigger - Pattern Map

**Mapped:** 2026-07-07
**Files analyzed:** 5 (all MODIFIED — this is a wiring change; no net-new source files)
**Analogs found:** 5 / 5 (every touch point has an in-repo precedent; the MANUAL path is the analog for the AUTO path)

> **Framing:** This phase invents no new shape. The manual `trigger('answer')` path — hotkey → orchestrator → queue → `pushAi` → `jedi:ai` → `AiPanel` — already exists end-to-end. Phase 11 taps a *second source* (the `gateway.on('utterance')` binding) into the SAME orchestrator entry point with `source: 'auto'`, and threads one new `source` field down the already-established push chain. Every pattern below points at the corresponding manual-path line to copy from.

---

## File Classification

| Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---------------|------|-----------|----------------|---------------|
| `src/main/index.ts` | wiring/entry-point | event-driven | the manual `'ai-answer'` chord (index.ts:153) + the `gateway.on('utterance')` binding (index.ts:357) | exact (same file) |
| `src/main/ai/ai-orchestrator.ts` | service (orchestrator) | event-driven / request-response | its own `trigger`/`enqueue` (lines 231/263) + the `IAiPushEvent` union (line 103) | exact (same file) |
| `src/main/stt/stt-provider.interface.ts` | interface (contract) | event-driven | `IUtteranceEvent` / `UtteranceClassification` (lines 44/53) — READ-ONLY reference for the trigger condition | exact (no edit expected) |
| `src/main/ai/prompt-assembler.ts` | utility (pure) | transform | `assemblePrompt` — reused byte-for-byte via pull-on-run (orchestrator.ts:382) | UNCHANGED (reuse only) |
| `src/renderer/src/components/ai-panel.tsx` (+ `src/preload/index.ts`, `src/main/overlay-window.manager.ts`) | component + bridge | request-response (one-way push) | the `mode`-field render path in `AiPanel` (ai-panel.tsx:222) | role-match (add `source` sibling to `mode`) |

---

## Pattern Assignments

### `src/main/index.ts` (wiring, event-driven)

**Analog:** the manual answer chord + the utterance binding, both already in this file.

**D-03 boot-reorder — the invariant to preserve.** Today the order in `app.whenReady()` is: `wireSttPipeline(...)` (index.ts:404) runs BEFORE `aiOrchestrator = new AiOrchestrator(...)` (index.ts:456-463). The auto-trigger must close over the orchestrator, so the orchestrator (and its deps) must be constructible first. The orchestrator's constructor dependencies, all already built earlier in the block, are:

```typescript
// index.ts:456-463 — the construction that must move ahead of wireSttPipeline
aiOrchestrator = new AiOrchestrator(
    aiGateway,                                   // built at :414 (needs apiKeyStore :383 + resolveApiKey)
    buffer,                                       // built at :394 (independent of STT)
    aiHistory,                                    // built at :415
    recordingPushAi,                              // closure built at :431 (needs `window` :390)
    () => contextRepo.activeAsGrounding(),        // contextRepo built at :388
    () => screenshotService.captureForOverlay(window) // screenshotService built at :420
);
```

None of these depend on `wireSttPipeline`'s return (`getConnectionState`). `getConnectionState` is only consumed later by `buildHandlers` (index.ts:554), which already runs AFTER orchestrator construction — so moving the AI-stack construction block (index.ts:406-463) to sit BEFORE `wireSttPipeline` (index.ts:404) satisfies both D-03 invariants. Per D-04 discretion, prefer moving the whole AI-stack block up (simplest) over threading a late-bound ref.

**The manual trigger to mirror** (index.ts:153) — the auto path is the non-hotkey twin of this one-liner:

```typescript
// index.ts:153 — manual answer chord (the shape the auto-trigger replicates, with source 'auto')
'ai-answer': (): void => aiOrchestrator.trigger('answer'),
```

**The utterance binding to extend (D-02/D-03)** — this is the exact seam the auto-trigger attaches to. It lives INSIDE `attachSttGatewayHandlers` (so re-key re-attaches it — Pitfall 3):

```typescript
// index.ts:357-360 — the current utterance binding (append + push only). The auto-trigger is added here.
gateway.on('utterance', (utterance: IUtteranceEvent) => {
    utterances.push(utterance);
    pushTranscript(window, { ...buffer.renderable(), utterances, connectionState: getConnectionState(), audioLevel: getAudioLevel() });
});
```

The Phase 11 addition inside this handler: after the existing push, `if (utterance.classification === 'question') aiOrchestrator.trigger('answer', 'auto', <content-key from utterance.text>)` (exact trigger signature is D-01 discretion — see below). Both `Person N` and neutral `'Speaker'` turns fire (D-02); `statement` does not.

**Pitfall 3 — the re-attach path (D-03 verification item).** `attachSttGatewayHandlers` is called TWICE: at boot (index.ts:250-258) and on live re-key (index.ts:294-302). The auto-trigger MUST live inside `attachSttGatewayHandlers` (alongside the existing `on('utterance')`), NOT in `wireSttPipeline`, so a re-keyed gateway still auto-triggers. To reach the orchestrator from inside the helper, thread it as a new parameter to `attachSttGatewayHandlers` and pass `aiOrchestrator` at BOTH call sites (mirror how `getAudioLevel` is already threaded through both). Boot-reorder (above) guarantees the orchestrator exists at the boot call site.

**Established closure-threading precedent** (index.ts:431/456-463) — `recordingPushAi`, the context provider, and the capture closure are all threaded into the orchestrator as closures from `index.ts` (no service-locator mid-method). The auto-trigger follows the same shape: bind the orchestrator at the entry point, close over it in the handler.

---

### `src/main/ai/ai-orchestrator.ts` (service, event-driven)

**Analog:** its own manual enqueue path — the `'auto'` lane, `RequestSource`, and single-in-flight gate already exist (built in Phase 10). Phase 11 supplies the real auto SOURCE and reconciles D-01.

**The entry point Phase 11 calls** (orchestrator.ts:231) — `source` already defaults to `'manual'`; the auto path passes `'auto'`:

```typescript
// orchestrator.ts:231 — trigger already accepts source; Phase 11 calls trigger('answer', 'auto')
public trigger(mode: AiMode, source: RequestSource = 'manual'): void {
```

**`RequestSource` — the discriminator already built** (orchestrator.ts:94):

```typescript
// orchestrator.ts:94
export type RequestSource = 'manual' | 'auto';
```

**D-01 reconcile — the burst debounce to modify** (orchestrator.ts:263-283). This is the crux. Phase 10's D-06 debounce keys on **mode** — every auto-answer is mode `answer`, so a naive same-mode collapse would silently drop a fast follow-up question. The change: the auto lane must de-dup on **question content**, not mode. Current code:

```typescript
// orchestrator.ts:263-283 — the mode-keyed burst debounce D-01 must reconcile
private enqueue(mode: AiMode, source: RequestSource): void {
    // Burst collapse (D-06): a pending timer for this mode means a rapid same-mode re-press folds
    // into the already-scheduled enqueue rather than queuing a second request.
    if (this.burstTimers.has(mode)) {
        return;
    }

    const requestId = ++this.requestSeq;
    const id = String(requestId);
    const startMs = Date.now();
    const item: IQueuedRequest = { mode, source, requestId, id, startMs };

    const timer = setTimeout(() => {
        this.burstTimers.delete(mode);
        this.placeInLane(item);
        this.startNext();
    }, BURST_DEBOUNCE_MS);
    this.burstTimers.set(mode, timer);
}
```

The `burstTimers` map is keyed `Map<AiMode, ...>` (orchestrator.ts:189). D-01 discretion (planner's call): carry a **content key** on the auto enqueue (normalized-text equality / short hash / trimmed prefix) and key the collapse on `mode + content` for auto (so two DIFFERENT questions each answer; an identical repeated question within the window collapses), while manual keeps the mode-only collapse behavior byte-for-byte (Phase 10 D-10). Likely mechanism: extend the `trigger`/`enqueue` signature with an optional `contentKey` and key `burstTimers` on a composite (or use a second map for the auto/content lane). Cost stays bounded by the single-in-flight gate (orchestrator.ts:349) + `MAX_PENDING_QUEUE` cap + drop-oldest-auto eviction (orchestrator.ts:315-325) — NOT by collapsing distinct questions.

**D-04 — the `IAiPushEvent.thinking` variant to extend** (orchestrator.ts:104). Add a `source: RequestSource` field to the `thinking` variant so the renderer can badge auto entries:

```typescript
// orchestrator.ts:104 — the thinking variant; source rides alongside mode/id/requestId/at
| { type: 'thinking'; requestId: number; id: string; mode: AiMode; at: number }
```

**Where the field gets its value** (orchestrator.ts:388) — the `thinking` push at run-start reads from the active request, which already carries `source` (`IActiveRequest.source`, orchestrator.ts:135; set at :385). Add `source` to the push:

```typescript
// orchestrator.ts:388 — the thinking push; add source: this.active.source (available in startRequest as `source`)
this.pushAi({ type: 'thinking', requestId, id, mode, at });
```

Note: `startRequest` already destructures `source` from the item (orchestrator.ts:376: `const { mode, source, requestId, id, startMs } = item;`), so the value is in scope. The `startCodeChallenge` `thinking` push (orchestrator.ts:423) also has `source` in scope and would carry it too (harmless — code-challenge is skipped by the panel).

---

### `src/main/stt/stt-provider.interface.ts` (interface — READ-ONLY reference, no edit expected)

**Analog:** the contract itself. The trigger CONDITION reads these existing fields (D-02):

```typescript
// stt-provider.interface.ts:44 — the classification the trigger checks
export type UtteranceClassification = 'question' | 'statement';
```

```typescript
// stt-provider.interface.ts:53-67 — the utterance shape; classification === 'question' fires, both speaker kinds (D-02)
export interface IUtteranceEvent {
    text: string;                       // ← the content-key source for D-01 dedup
    speaker: string;                    // 'Person N' or the neutral 'Speaker' bucket — BOTH fire (D-02)
    isDiarized: boolean;
    classification: UtteranceClassification; // === 'question' is the trigger condition
}
```

Utterances are already committed/final at the `on('utterance')` emit point, so no extra final-only guard is needed (D-02). No change to question *detection* — it stays local/no-AI (consumes the existing QA-03 classification; no per-utterance AI call).

---

### `src/main/ai/prompt-assembler.ts` (utility — UNCHANGED, reuse only)

**Analog:** itself. Grounding is byte-for-byte identical to the manual path via pull-on-run. The orchestrator already assembles through this exact path when a queued item RUNS:

```typescript
// orchestrator.ts:381-382 — pull-on-run grounding; the auto request assembles through the SAME path as manual
const span = this.transcriptBuffer.recentSince(RECENT_SPAN_MS);
const { system, userContent } = assemblePrompt({ mode, span, context: this.getActiveContext() });
```

`RECENT_SPAN_MS = 60_000` (prompt-assembler.ts:23) and `ANSWER_SYSTEM_PROMPT` (prompt-assembler.ts:32) are consumed unchanged. This guarantees SC 2 grounding parity — an auto answer carries the same mode (`answer`), model (`ANSWER_MODEL`), and grounding shape (active context + `RECENT_SPAN_MS` span) as a manual answer. **Do not modify this file.**

---

### `src/renderer/src/components/ai-panel.tsx` (+ preload + overlay-window.manager.ts) — the ONLY renderer touch (D-04)

**Analog:** the existing `mode`-field render path — `source` is a sibling field carried and rendered the same way `mode` is.

The `source` field must be declared in THREE mirrored `IAiPushEvent`/`thinking` locations (the type is intentionally duplicated across the process boundary — see below), then read in the renderer reducer + render.

**1. Preload mirror** (`src/preload/index.ts:101`) — add `source` to the `thinking` variant, mirroring main:

```typescript
// preload/index.ts:101 — mirror the new source field here (structural duplicate of main's IAiPushEvent)
| { type: 'thinking'; requestId: number; id: string; mode: AiMode; at: number }
```

**2. Renderer mirror** (`src/renderer/src/components/ai-panel.tsx:15`) — same addition:

```typescript
// ai-panel.tsx:15 — mirror the new source field here too
| { type: 'thinking'; requestId: number; id: string; mode: AiMode; at: number }
```

**3. Overlay-window.manager.ts** re-exports the type from the orchestrator (`overlay-window.manager.ts:6-8: export type { IAiPushEvent };`) — no edit needed there; it picks up the orchestrator's change automatically.

**4. Carry `source` onto the entry** — the reducer's `thinking` branch builds the panel entry (ai-panel.tsx:85). Add `source` to `IAiPanelEntry` (ai-panel.tsx:29-35) and set it here, mirroring how `mode` is carried:

```typescript
// ai-panel.tsx:85 — the thinking branch that creates an entry; add source alongside mode
return [...entries, { id: event.id, mode: event.mode, text: '', state: 'thinking', at: event.at }];
```

**5. Render the badge** — mirror the existing `mode`-label span in the entry header (ai-panel.tsx:221-224). A minimal `auto` tag/dot rendered conditionally next to the mode label:

```tsx
// ai-panel.tsx:221-224 — the entry header; add a tiny conditional auto badge next to the mode label (D-04)
<header className="ai-panel__entry-header">
    <span className="ai-panel__entry-mode">{MODE_LABEL[entry.mode]}</span>
    <span className="ai-panel__entry-time">{formatRelativeTime(entry.at, nowMs)}</span>
</header>
```

Badge styling (text tag vs dot vs icon) is D-04 discretion — keep it tiny, same panel, no layout change. A manual entry (`source: 'manual'`) shows no badge. Add a `data-testid` following the naming convention (e.g. `icon-auto-badge` or a `badge-`-style id). SC 3 "same rendering" is preserved: same panel, same streaming render, just annotated.

---

## Shared Patterns

### Closure-threading from the entry point (no service-locator)
**Source:** `src/main/index.ts:431` (recordingPushAi), `:456-463` (orchestrator construction), `:250-258`/`:294-302` (attachSttGatewayHandlers threading `getAudioLevel` through both call sites).
**Apply to:** the D-03 orchestrator-into-`attachSttGatewayHandlers` threading.
Bind dependencies at `app.whenReady()`; pass them as parameters/closures to the helpers. Never `container.resolve()` mid-method (there is no TSyringe container in main). Thread the orchestrator to BOTH `attachSttGatewayHandlers` call sites exactly as `getAudioLevel` is threaded today.

### Single-in-flight + monotonic requestId guard (Pitfall 1 / Phase 10 D-11)
**Source:** `src/main/ai/ai-orchestrator.ts:349` (gate), `:475`/`:497`/`:514` (positive request-id guards on text/done/error).
**Apply to:** nothing new — the auto path drives the SAME gateway emitter through the SAME `trigger`→`enqueue`→`startNext` path, so the existing guard already protects it. No new call site → no new guard needed. This is load-bearing context for the planner: auto answers cannot bleed into each other because the guard already exists.

### `source`-carrying data shape (already built in Phase 10)
**Source:** `IQueuedRequest.source` (orchestrator.ts:124), `IActiveRequest.source` (orchestrator.ts:135), set at `:275`/`:385`.
**Apply to:** the D-04 `thinking` push — `source` is already threaded through the queue and active request; Phase 11 only surfaces it on the push payload and in the renderer.

### Structural type duplication across the process boundary
**Source:** the `IAiPushEvent` union is declared identically in three places — `ai-orchestrator.ts:103`, `preload/index.ts:100`, `ai-panel.tsx:14` — because the sandboxed preload + renderer are bundled separately and must not import from main.
**Apply to:** the new `source` field on the `thinking` variant — add it in ALL THREE locations, keeping them structurally identical (as `AiMode` and `UtteranceClassification` already are).

---

## No Analog Found

None. Every touch point has a direct in-repo precedent — this phase is a pure wiring/annotation change over the fully-built manual path and the fully-built Phase 10 priority queue. The single piece of genuinely new logic (D-01 content-dedup for the auto lane) still extends the existing `enqueue`/`burstTimers` mechanism (orchestrator.ts:263-283) rather than inventing a new one.

---

## Metadata

**Analog search scope:** `src/main/` (index.ts, ai/, stt/), `src/preload/`, `src/renderer/src/components/`
**Files scanned:** index.ts, ai-orchestrator.ts, ai-orchestrator.test.ts, stt-provider.interface.ts, prompt-assembler.ts, overlay-window.manager.ts, preload/index.ts, ai-panel.tsx
**Pattern extraction date:** 2026-07-07
