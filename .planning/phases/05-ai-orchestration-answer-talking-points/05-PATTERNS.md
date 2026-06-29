# Phase 5: AI Orchestration (Answer + Talking Points) - Pattern Map

**Mapped:** 2026-06-18
**Files analyzed:** 13 (10 new, 3 modified)
**Analogs found:** 13 / 13 (12 with a concrete codebase analog; 1 pure-utility with a partial analog)

> Phase 5 is an explicit 1:1 mirror of the Phase 4 STT stack. Every new file has a real, line-referenced
> sibling in `src/main/stt/`, `src/main/`, `src/preload/`, or `src/renderer/`. The planner's `<read_first>`
> lists should point at the analog files named below.

## File Classification

| New/Modified File | New/Mod | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|---------|------|-----------|----------------|---------------|
| `src/main/ai/ai-gateway.interface.ts` | new | interface (seam) | streaming / contract | `src/main/stt/stt-provider.interface.ts` | exact |
| `src/main/ai/anthropic-ai.gateway.ts` | new | gateway | streaming (event-driven) | `src/main/stt/deepgram-stt.gateway.ts` | exact |
| `src/main/ai/prompt-assembler.ts` | new | utility (pure) | transform | (partial) `src/main/config/load-dotenv.utility.ts` (pure-fn shape) | role-match |
| `src/main/ai/ai-history.ts` | new | model (bounded store) | CRUD / append+prune | `src/main/stt/transcript-buffer.ts` | exact |
| `src/main/ai/ai-orchestrator.ts` | new | service | event-driven (lifecycle) | `wireSttPipeline` in `src/main/index.ts` + `DeepgramSttGateway` event wiring | role-match |
| `src/main/overlay-window.manager.ts` | mod | manager (IPC push) | request-response / push | `TRANSCRIPT_CHANNEL` + `pushTranscript` + `hudVisible` flag (same file) | exact (extend) |
| `src/main/hotkey-registrar.service.ts` | mod | service (hotkeys) | event-driven | existing `HOTKEY_CHORDS` entries (same file) | exact (extend) |
| `src/main/index.ts` | mod | handler (entry/wiring) | event-driven | `wireSttPipeline` + `buildHandlers` + `loadDotenvFile` (same file) | exact (extend) |
| `src/preload/index.ts` | mod | preload (IPC bridge) | request-response / push | `onTranscript` + `onScrollTranscript` (same file) | exact (extend) |
| `src/renderer/src/components/ai-panel.tsx` | new | component | streaming render | `src/renderer/src/components/debug-hud.tsx` | exact |
| `src/renderer/src/App.tsx` | mod | component (root) | composition | `App.tsx` (renders `DebugHud`; add sibling `AiPanel`) | exact (extend) |
| `src/main/ai/prompt-assembler.test.ts` | new | test | unit | `src/main/stt/transcript-buffer.test.ts` (pure, fake-clock style) | exact |
| `src/main/ai/ai-history.test.ts` | new | test | unit | `src/main/stt/transcript-buffer.test.ts` (bounds tests) | exact |
| `src/main/ai/ai-orchestrator.test.ts` | new | test | unit (fake gateway) | `src/main/stt/deepgram-stt.gateway.test.ts` (`FakeV1Socket`) | exact |

> **Test-location correction:** RESEARCH.md proposed `src/main/ai/test/*.test.ts`. The codebase convention is
> **co-located, NOT in a `test/` subdirectory** — every existing test sits beside its source
> (`src/main/stt/transcript-buffer.test.ts`, `deepgram-stt.gateway.test.ts`, `hotkey-registrar.service.test.ts`).
> Place the new tests at `src/main/ai/<name>.test.ts`, not under a `test/` folder. `[VERIFIED: Glob src/**/*.test.ts]`

## Pattern Assignments

### `src/main/ai/ai-gateway.interface.ts` (interface, streaming contract)

**Analog:** `src/main/stt/stt-provider.interface.ts` (read whole file — 92 lines, pure contract, no SDK import)

**Header/seam-doc pattern** (`stt-provider.interface.ts:1-14`): a file-level TSDoc block stating the seam's
purpose — "Every consumer depends on THIS interface, never on `@deepgram/sdk` directly" — and that it is a
pure contract file with no implementation and no vendor import. Mirror this exactly for `@anthropic-ai/sdk`.

**String-union mode type** (`stt-provider.interface.ts:35`):
```typescript
export type SttConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'error';
```
Copy this shape for `export type AiMode = 'answer' | 'talking-points';` (the comment notes the string-union
mirrors the `HotkeyLayer` precedent — keep that lineage note).

**Event-emitter contract + by-convention-singleton @remarks** (`stt-provider.interface.ts:37-92`): the
`ISttProvider` declares overloaded `on(event: 'transcript' | 'connection-state-change' | 'error', listener)`
signatures, each with its own TSDoc. The `@remarks` block (lines 37-44) states the implementation is a
by-convention singleton — "the Electron main process has no TSyringe DI container, so the IDEXX `@singleton()`
decorator does not apply here." Copy this `@remarks` verbatim into `IAiGateway`. RESEARCH.md §IAiGateway seam
(lines 296-338) already drafts the exact `on('text' | 'done' | 'error' | 'abort', …)` overloads.

> **Planner note (Pitfall 1):** RESEARCH.md:338 flags that a per-call-handlers variant — `stream(request, handlers)`
> returning `IAiStream` — makes the single-in-flight request-id discipline structurally easier than a shared
> emitter. Either is acceptable; the emitter version is the closer 1:1 mirror of `ISttProvider`.

---

### `src/main/ai/anthropic-ai.gateway.ts` (gateway, streaming/event-driven)

**Analog:** `src/main/stt/deepgram-stt.gateway.ts` (read whole file — 344 lines; the canonical thin-gateway pattern)

**Imports + `extends EventEmitter implements I…`** (`deepgram-stt.gateway.ts:1-4, 67`):
```typescript
import { EventEmitter } from 'events';
import { DeepgramClient } from '@deepgram/sdk';
import type { ISttProvider, ISttTranscriptEvent, SttConnectionState } from './stt-provider.interface';
// ...
export class DeepgramSttGateway extends EventEmitter implements ISttProvider {
```
Mirror as: `import Anthropic from '@anthropic-ai/sdk';` + `export class AnthropicGateway extends EventEmitter implements IAiGateway`.

**Constructor-injected key, NEVER `process.env` inside the gateway** (`deepgram-stt.gateway.ts:76-82`):
```typescript
/**
 * @param apiKey - The Deepgram API key, read in main only (D-08). Held in memory for the client;
 *   never logged, emitted, or sent over IPC.
 */
public constructor(private readonly apiKey: string) {
    super();
}
```
This is the load-bearing D-08 pattern — copy the constructor shape and the TSDoc warning verbatim (swap
"Deepgram" → "Anthropic"). The class-level TSDoc (lines 47-65) also documents the key discipline and the
by-convention-singleton remark; mirror it.

**The report-don't-throw `emitError` no-listener guard** (`deepgram-stt.gateway.ts:200-212`) — copy this method exactly:
```typescript
private emitError(error: Error): void {
    if (this.listenerCount('error') > 0) {
        this.emit('error', error);
    }
}
```
Node's EventEmitter throws synchronously if `'error'` is emitted with no listener; the gateway must surface a
transport fault without crashing main even before a consumer subscribes. The Anthropic gateway needs the same
guard for its `.on('error')` → `emit('error')` wiring.

**Vendor-event → typed-event wiring** (`deepgram-stt.gateway.ts:176-198`, `attachHandlers`): the Deepgram socket's
`open`/`message`/`close`/`error` are mapped to the gateway's typed events. The Anthropic equivalent (RESEARCH.md
§AnthropicGateway, lines 355-368) wires `stream.on('text', …)` → `emit('text')`, `stream.on('abort')` →
`emit('abort')`, `stream.on('error', …)` → `emitError(...)`, and `void stream.finalText().then(...)` → `emit('done')`.
Use the same `error instanceof Error ? error : new Error('…')` normalization seen at `deepgram-stt.gateway.ts:164`.

**Held handle for teardown/cancel** (`deepgram-stt.gateway.ts:68, 312-326` `teardownConnection`): the gateway holds
`private connection: IDeepgramLiveSocket | undefined` and tears it down inside a try/catch that swallows faults.
The Anthropic gateway holds the active `MessageStream` and exposes cancel via the returned `IAiStream.abort()` →
`stream.abort()` (RESEARCH Pattern 3 / line 367). The teardown-never-throws discipline (lines 320-325) applies.

---

### `src/main/ai/prompt-assembler.ts` (utility, pure transform)

**Analog (partial):** `src/main/config/load-dotenv.utility.ts:1-39` — the project's reference for a **pure,
side-effect-free, unit-testable exported function** with a TSDoc `@param`/`@returns`. There is no AI-prompt analog
(this is genuinely new logic), but the *shape* — a pure function returning a plain object, no class, no state,
no IO — matches `parseDotenv`. Per IDEXX code-standards, this is a `.utility.ts`-class file; planner may keep it
named `prompt-assembler.ts` to match RESEARCH's structure or rename to `prompt-assembler.utility.ts` for the suffix
convention (note the divergence for the planner).

**Pure-function + explicit-return-type pattern** (`load-dotenv.utility.ts:11`):
```typescript
export function parseDotenv(contents: string): Record<string, string> {
```
RESEARCH.md §PromptAssembler seam (lines 431-456) gives the exact target signature:
```typescript
export function assemblePrompt(input: IAssembleInput): IAssembledPrompt { ... }
```
with `IGroundingContext` (D-13 empty-in-Phase-5 context slot), `IAssembleInput { mode, span, context? }`, and
`IAssembledPrompt { system, userContent }`. The two DRAFT system prompts are in RESEARCH.md lines 402-429 (marked
`[ASSUMED]` — planner/user confirms wording before locking). `formatContext(undefined)` must return `''` so Phase 6
fills the same param with NO call-site change (D-13).

**Seam-first-fill-later lineage:** mirror the doc note in `stt-provider.interface.ts:5-9` ("the Deepgram backend
can be swapped … as long as the new provider emits the same typed events") to explain the empty D-13 context slot.

---

### `src/main/ai/ai-history.ts` (model, bounded append+prune store)

**Analog:** `src/main/stt/transcript-buffer.ts` (read whole file — 147 lines; the canonical bounded-buffer pattern)

**Hard-ceiling constants + the three-bound doctrine** (`transcript-buffer.ts:26-42`):
```typescript
export const WINDOW_MS = 90_000;
export const MAX_SEGMENTS = 400;
export const MAX_TOTAL_CHARS = 20_000;
```
The AI history is bounded the same way (D-02): pick `MAX_ENTRIES` (last-N) and/or `MAX_TOTAL_CHARS` as named
exported constants. The file-level TSDoc (lines 1-16) explains *why* multiple independent ceilings exist ("can
never grow unbounded even if the injected clock misbehaves") — mirror that rationale.

**Append + prune** (`transcript-buffer.ts:74-78` `appendFinal`, `133-146` `prune`):
```typescript
public appendFinal(text: string): void {
    this.finals.push({ text, at: this.now() });
    this.interim = '';
    this.prune();
}
// prune(): drop-by-time, then shift() while over segment ceiling, then shift() while over char ceiling
```
The AI history `append(entry)` pushes a new entry then `prune()`s to the last-N / char ceiling with the same
`while (… > MAX …) this.entries.shift()` loop. Each entry carries the mode + a timestamp (D-03 header).

**Injected clock for deterministic tests** (`transcript-buffer.ts:62-66`):
```typescript
public constructor(private readonly now: () => number = Date.now) {}
```
Copy this exactly so `ai-history.test.ts` can drive relative-time headers and time-based bounds deterministically.

**Snapshot read for the push** (`transcript-buffer.ts:120-125` `renderable()`): returns the renderable snapshot
the manager pushes. The AI history exposes a `snapshot()` (bounded entry list) read by the orchestrator's
terminal/clear push (RESEARCH Pitfall 4: re-push the full snapshot only on terminal/clear, not per delta).

**`clear()`** (`transcript-buffer.ts:94-97`): wired to the clear hotkey. The AI history needs the identical
`clear()` for the new clear-AI-history chord (D-02).

---

### `src/main/ai/ai-orchestrator.ts` (service, single-in-flight stream lifecycle)

**Analogs:** `wireSttPipeline` in `src/main/index.ts:106-161` (event-wiring + push pattern) and the event-binding
discipline in `deepgram-stt.gateway.ts:176-198`. No single file is a full analog — this is the assembly point —
but RESEARCH.md §AiOrchestrator cancel logic (lines 373-399) gives the exact target `trigger(mode)` method.

**Event-handler → buffer → push wiring** (`index.ts:116-135`):
```typescript
gateway.on('transcript', (event: ISttTranscriptEvent) => {
    if (event.isFinal) { buffer.appendFinal(event.text); } else { buffer.setInterim(event.text); }
    pushTranscript(window, { ...buffer.renderable(), connectionState, audioLevel });
});
gateway.on('error', () => { /* never logged with payload (D-08) */ });
```
The orchestrator binds `gateway.on('text' | 'done' | 'error' | 'abort')` to debounced/terminal pushes on the new
AI channel, with the **request-id guard** (Pitfall 1): ignore an event whose `requestId !== this.current.requestId`.
This mirrors the `if (this.stopped) return;` guard in the Deepgram `close` handler (`deepgram-stt.gateway.ts:186-189`).

**Span read + empty-span guard (D-09/D-11)** — `transcriptBuffer.recentSince(RECENT_SPAN_MS)` from
`transcript-buffer.ts:106-113`, then RESEARCH.md:377-383:
```typescript
const span = this.transcriptBuffer.recentSince(RECENT_SPAN_MS);
if (span.trim().length === 0) { this.pushEntry({ mode, kind: 'empty' }); return; } // D-11, before any API call
```

**Single-in-flight cancel logic (D-06/D-07)** — RESEARCH.md:384-398: re-press same mode → `abort()` and return;
other mode → `abort()` current then start new; allocate a monotonic `requestId = ++this.requestSeq`; per-mode
model constant `ANSWER_MODEL` / `TALKING_POINTS_MODEL` (D-10) and `MAX_TOKENS[mode]` (Pitfall 6).

**Debounce** — hand-rolled trailing-edge `setTimeout`, modeled on the 66ms throttle in `index.ts:140-148`
(`if (nowMs - lastLevelPushMs >= 66) { lastLevelPushMs = nowMs; push… }`). No debounce library (RESEARCH
Don't-Hand-Roll). Planner picks the exact 30–60ms interval as a named constant (D-04).

**By-convention singleton** — instantiated once in `index.ts` like `sttGateway` / `audioCapture`
(`index.ts:25-26, 109-110`).

---

### `src/main/overlay-window.manager.ts` (manager — MODIFY: add AI channel + push + activePanel flag)

**Analog:** same file — the `TRANSCRIPT_CHANNEL` / `pushTranscript` and `hudVisible`-flag patterns.

**New one-way push channel — copy `TRANSCRIPT_CHANNEL` + `pushTranscript`** (`overlay-window.manager.ts:36-47, 179-194`):
```typescript
export const TRANSCRIPT_CHANNEL = 'jedi:transcript';
// ...
export function pushTranscript(window: BrowserWindow, payload: IOverlayTranscript): void {
    if (window.isDestroyed() || window.webContents.isDestroyed()) {
        return;
    }
    window.webContents.send(TRANSCRIPT_CHANNEL, payload);
}
```
Add `export const AI_CHANNEL = 'jedi:ai';` + `pushAi(window, payload: IAiPushEvent)` with the **identical
teardown guard** (`isDestroyed()` on both window and webContents). The TSDoc on `TRANSCRIPT_CHANNEL` (lines 36-40)
explains *why* it is a separate channel from `jedi:status` (high-frequency traffic) — the AI deltas are
high-frequency too, so reuse that justification (RESEARCH Pattern 5).

**Scroll-signal channel — copy `SCROLL_TRANSCRIPT_CHANNEL` + `pushScrollTranscript`** (`overlay-window.manager.ts:42-50, 196-210`):
The existing scroll signal forwards `'up'|'down'`. For D-08, scroll routing now depends on the active panel; the
planner either keeps `pushScrollTranscript` and lets the renderer route by active-panel, or adds a panel-scoped
signal. Reuse this exact push shape + guard.

**Main-owned `activePanel` flag — copy the `hudVisible` flag triplet** (`overlay-window.manager.ts:92-116` +
`buildStatus` line 161 + the `IOverlayStatus` field at line 29):
```typescript
let hudVisible = true;
export function setHudVisible(visible: boolean): void { hudVisible = visible; }
export function getHudVisible(): boolean { return hudVisible; }
// buildStatus(): return { …, hudVisible };
```
Add `activePanel: 'transcript' | 'ai'` to `IOverlayStatus` (line 13-30), a module-level `let activePanel = 'ai'`
(D-08 default = AI panel), `setActivePanel`/`getActivePanel`, and carry it in `buildStatus` (line 153-163). This
is RESEARCH Pattern 4 — a 1:1 mirror of `hudVisible`. The corner indicator and scroll routing are pure views of it.

---

### `src/main/hotkey-registrar.service.ts` (service — MODIFY: add A/T/F + clear-AI chords)

**Analog:** same file — the existing `HOTKEY_CHORDS` rows.

**Add rows to `HOTKEY_CHORDS`** (`hotkey-registrar.service.ts:53-76`). The clear-transcript row (lines 63-69) is
the exact template, including the inline comment documenting the conflict-test obligation:
```typescript
{ label: 'clear-transcript', keycode: UiohookKey.K, accelerator: 'Ctrl+Alt+K', kind: 'discrete' },
```
Add (planner re-verifies letters per Pitfall 5 / 02-03 protocol, with documented fallbacks — D-05/D-08):
```typescript
{ label: 'ai-answer',         keycode: UiohookKey.A, accelerator: 'Ctrl+Alt+A', kind: 'discrete' },
{ label: 'ai-talking-points', keycode: UiohookKey.T, accelerator: 'Ctrl+Alt+T', kind: 'discrete' },
{ label: 'focus-cycle',       keycode: UiohookKey.F, accelerator: 'Ctrl+Alt+F', kind: 'discrete' },
{ label: 'clear-ai',          keycode: UiohookKey.<picked>, accelerator: 'Ctrl+Alt+<picked>', kind: 'discrete' },
```
All `discrete` (D-05). **No registrar logic changes** — `bindViaUiohook`/`dispatchUiohookKeydown`/
`bindViaGlobalShortcut` (lines 156-248) iterate `HOTKEY_CHORDS` generically; a missing handler surfaces in
`register().failed` (CTL-03), exactly like every other chord (lines 159-163, 232-237). The cheat-sheet array in
`debug-hud.tsx:41-49` should get matching rows.

---

### `src/main/index.ts` (handler — MODIFY: instantiate AI stack, wire handlers, read key)

**Analog:** same file — `wireSttPipeline` (106-161), `buildHandlers` (42-68), the key-load + singleton pattern.

**Read the Anthropic key in main only, after `loadDotenvFile`** (`index.ts:109, 163-167`):
```typescript
loadDotenvFile(resolve(app.getAppPath(), '.env'));      // line 167 — runs before any process.env read
// ...
const gateway = new DeepgramSttGateway(process.env.DEEPGRAM_API_KEY ?? '');   // line 109
```
Mirror: `new AnthropicGateway(process.env.ANTHROPIC_API_KEY ?? '')`. The empty-key path surfaces an inline
`AI error: missing API key` (Pitfall 3) — never log the key or the error payload (the Deepgram `error` handler at
lines 131-135 is the precedent: payload is deliberately NOT logged). Add `ANTHROPIC_API_KEY` to the gitignored `.env`.

**Module-level by-convention singletons** (`index.ts:18-26`): add `let aiGateway`, `let aiOrchestrator` alongside
`hotkeyRegistrar`/`audioCapture`/`sttGateway`, and tear them down in `window-all-closed` (lines 196-208) like
`sttGateway?.stop()`.

**Wire AI handlers into `buildHandlers`** (`index.ts:42-68`): the new `ai-answer`/`ai-talking-points`/`focus-cycle`/
`clear-ai` labels map to handlers calling `aiOrchestrator.trigger('answer')`, `.trigger('talking-points')`,
`setActivePanel(...)` + `pushStatus`, and `aiHistory.clear()` + `pushAi(snapshot)` — exactly as `clear-transcript`
(lines 58-63) calls `buffer.clear()` + `pushTranscript(...)`. Reuse the `getOverlayVisible()`-style main-owned-flag
branch for the focus-cycle (lines 44-50).

---

### `src/preload/index.ts` (preload — MODIFY: expose `onAi` subscription)

**Analog:** same file — `onTranscript` (87-94) and `onScrollTranscript` (103-110).

**Copy the `onTranscript` subscription verbatim** (`preload/index.ts:87-94`):
```typescript
onTranscript(callback: (transcript: IOverlayTranscript) => void): () => void {
    const listener = (_event: IpcRendererEvent, transcript: IOverlayTranscript): void => callback(transcript);
    ipcRenderer.on(TRANSCRIPT_CHANNEL, listener);
    return (): void => { ipcRenderer.removeListener(TRANSCRIPT_CHANNEL, listener); };
},
```
Add `onAi(callback: (event: IAiPushEvent) => void): () => void` on the same `jediApi` object, plus a local
`const AI_CHANNEL = 'jedi:ai';` (lines 38-48) and a locally-declared `IAiPushEvent` interface mirroring the main
payload (preload is bundled separately — declare, don't import; see the `IOverlayTranscript` note at lines 20-36).
The returned-unsubscribe contract (WR-03) and the one-way main→renderer discipline (lines 50-60) are mandatory —
**no renderer→main control channel** (IN-01). The `JediApi` type (line 113) picks up the new method automatically.

---

### `src/renderer/src/components/ai-panel.tsx` (component, streaming render — NEW)

**Analog:** `src/renderer/src/components/debug-hud.tsx` (read whole file — 177 lines; the canonical render+scroll pattern)

**Subscribe-in-useEffect returning a combined cleanup** (`debug-hud.tsx:76-98`):
```typescript
useEffect(() => {
    const offStatus = window.jedi?.onStatus((next) => setStatus(next));
    const offTranscript = window.jedi?.onTranscript((next) => setTranscript(next));
    const offScroll = window.jedi?.onScrollTranscript((direction) => { /* scroll */ });
    return (): void => { offStatus?.(); offTranscript?.(); offScroll?.(); };
}, []);
```
`AiPanel` subscribes to `window.jedi.onAi(...)` (and `onStatus` for the `activePanel` flag), capturing each
unsubscribe and calling all on cleanup (WR-03, no leak under Strict Mode).

**`stickToBottomRef` follow/pause + hotkey scroll** (`debug-hud.tsx:71-91`, the exact pattern D-03 reuses):
```typescript
const stickToBottomRef = useRef<boolean>(true);
const offScroll = window.jedi?.onScrollTranscript((direction) => {
    const element = transcriptRef.current;
    if (element === null) { return; }
    const lineStep = 3 * 18;
    element.scrollTop += direction === 'down' ? lineStep : -lineStep;
    stickToBottomRef.current = element.scrollTop + element.clientHeight >= element.scrollHeight - 4;
});
```
**Auto-stick on new content** (`debug-hud.tsx:102-107`):
```typescript
useEffect(() => {
    const element = transcriptRef.current;
    if (element !== null && stickToBottomRef.current) {
        element.scrollTop = element.scrollHeight;
    }
}, [transcript?.finalText, transcript?.interimText]);
```
Copy both blocks; the dependency array keys off the in-progress AI entry text. Scroll only fires when this panel
is the `activePanel` (D-08) — guard the scroll handler on the pushed flag.

**Rendered OUTSIDE the HUD-toggle gate (D-01):** `DebugHud` returns `null` when `!hudVisible` (`debug-hud.tsx:111-114`).
`AiPanel` must NOT do this — it is always-on. It is rendered as a **sibling of `DebugHud` in `App.tsx`**, not inside it.

**Per-entry header + inline states (D-03/D-04):** each history entry renders a small header (mode `Answer`/
`Talking points` + relative time) and an inline state (`thinking…` / streaming text / `AI error: <reason>` /
`(cancelled)`). Use `data-testid` per IDEXX naming (e.g. `card-ai-panel`, `row-ai-entry-${id}`) like the HUD's
`data-testid="card-transcript"` (line 159) and `row-hotkey-${entry.id}` (line 169).

---

### `src/renderer/src/App.tsx` (root component — MODIFY: add `AiPanel` sibling)

**Analog:** same file (24 lines). Currently `return <DebugHud />;` (line 23). D-01 requires `AiPanel` as a
**sibling** of `DebugHud`, NOT a child — render both under a fragment so the AI panel is unaffected by the
`hudVisible` gate. Update the file-level TSDoc (lines 5-21) to describe the new always-on AI surface.

---

### Tests (NEW — co-located, beside source, Vitest)

> Quick run: `npx vitest run src/main/ai/<file>.test.ts`. Full suite: `npx vitest run`. `[VERIFIED: package.json "test": "vitest run", vitest 3.2.4]`

#### `src/main/ai/prompt-assembler.test.ts` (covers AI-01/AI-02, D-13)
**Analog:** `src/main/stt/transcript-buffer.test.ts` (pure-function, AAA, explicit-type style). Assert each mode
selects the correct system prompt, the user content embeds the labeled span, and `context: undefined` produces an
empty context block (D-13 seam). All inputs literal, no mocks (it's pure).

#### `src/main/ai/ai-history.test.ts` (covers D-02 bounds)
**Analog:** `src/main/stt/transcript-buffer.test.ts:43-74` (hard-ceiling tests) + `:118-134` (injected fake clock).
Copy the `let nowMs = 0; const history = new AiHistory(() => nowMs)` fake-clock idiom (transcript-buffer.test.ts:16-17)
and the `while (over ceiling) shift()` boundary assertions (lines 44-73). Test append, last-N eviction, char ceiling,
relative-time header derivation, and `clear()`.

#### `src/main/ai/ai-orchestrator.test.ts` (covers D-06/D-07/D-11/AI-04)
**Analog:** `src/main/stt/deepgram-stt.gateway.test.ts` — specifically the **`FakeV1Socket`** pattern (lines 19-32)
and the `vi.mock` SDK substitution (lines 38-50). Build a **`FakeAiGateway`** the same way: an `EventEmitter`
subclass with `stream = vi.fn()` returning a `{ abort: vi.fn() }`, so the orchestrator's real `gateway.on('text'|
'done'|'error'|'abort')` wiring is exercised and tests can drive deltas/terminal events by `fakeGateway.emit(...)`.
Mirror the `vi.clearAllMocks()` + `vi.useFakeTimers()` setup (lines 64-74) to test the debounce trailing-edge.
Test the D-11 empty-span guard (no `stream()` call), D-06 re-press-aborts, D-07 other-mode cancel-then-start, and
the Pitfall-1 request-id guard (an aborted stream's late event does not append to the new entry). The
"never-log-the-key" assertion (lines 306-331) is the template for asserting the orchestrator/gateway never logs the
Anthropic key or error payload.

## Shared Patterns

### Report-don't-throw via events (never crash main on a vendor fault)
**Source:** `src/main/stt/deepgram-stt.gateway.ts:200-212` (`emitError` no-listener guard), `:163-166` (catch →
emit → continue), and `src/main/index.ts:131-135` (error handler that does NOT log the payload).
**Apply to:** `anthropic-ai.gateway.ts` and `ai-orchestrator.ts`. A 529/overloaded must surface as an inline
`AI error: <reason>` entry, never a thrown exception, never a logged key-adjacent payload (D-08, Security V7).

### Constructor-injected secret, read in main only
**Source:** `deepgram-stt.gateway.ts:76-82` (constructor) + `index.ts:109, 167` (`process.env` read after `loadDotenvFile`).
**Apply to:** `anthropic-ai.gateway.ts` constructor + the `index.ts` wiring. The key is never read inside the
gateway, never logged, never emitted, never crosses IPC. Phase 6's `safeStorage` swap touches only `index.ts`.

### One-way main→renderer push with teardown guard
**Source:** `overlay-window.manager.ts:188-194` (`pushTranscript`) + `preload/index.ts:87-94` (`onTranscript`).
**Apply to:** the new `jedi:ai` channel (`pushAi` / `onAi`) and the `activePanel` flag carried in `pushStatus`.
Every push guards `window.isDestroyed() || window.webContents.isDestroyed()`. No renderer→main control channel (IN-01).

### Main-owned UI flag carried in the status push
**Source:** `overlay-window.manager.ts:92-116` (`hudVisible` + set/get) + `:161` (carried in `buildStatus`) +
`debug-hud.tsx:111` (renderer derives view purely from the pushed flag).
**Apply to:** the `activePanel` flag (D-08). Renderer is a pure view; main owns the bound.

### Bounded buffer with hard ceilings + injected clock
**Source:** `transcript-buffer.ts:26-42` (constants), `:74-78` (append), `:133-146` (prune), `:62-66` (clock).
**Apply to:** `ai-history.ts` (D-02). Last-N and/or total-char ceiling so history can never grow unbounded.

### By-convention singleton (no TSyringe in main)
**Source:** the `@remarks` blocks in `stt-provider.interface.ts:37-44`, `deepgram-stt.gateway.ts:62-65`,
`transcript-buffer.ts:50-54`, `hotkey-registrar.service.ts:88-91`; instantiation at `index.ts:18-26, 109-110`.
**Apply to:** `AiGateway`, `AiOrchestrator`, `AiHistory` — instantiated once in `index.ts`, no `@singleton()`.

### Hand-rolled trailing-edge debounce (no library)
**Source:** the 66ms throttle in `index.ts:140-148`.
**Apply to:** the AI delta push (D-04, ~30–60ms). One `setTimeout`, ~10 lines — matches the house style.

### Co-located AAA Vitest with fake clock / fake vendor
**Source:** `transcript-buffer.test.ts` (fake clock) + `deepgram-stt.gateway.test.ts` (`FakeV1Socket` + `vi.mock`).
**Apply to:** all three new test files, placed beside their source (NOT in a `test/` subdirectory).

## No Analog Found

None. Every Phase 5 file maps to a concrete codebase analog. The single weakest match is `prompt-assembler.ts`
(no AI-prompt precedent in the repo), but its pure-function shape mirrors `load-dotenv.utility.ts` and its target
signature is fully specified in RESEARCH.md §PromptAssembler seam (lines 431-456).

## Metadata

**Analog search scope:** `src/main/stt/`, `src/main/`, `src/main/config/`, `src/preload/`, `src/renderer/src/`,
`src/renderer/src/components/`, and all co-located `*.test.ts`.
**Files scanned:** 11 source/analog files + 2 test analogs + package.json (read in full or in the relevant range).
**New dependency state:** `@anthropic-ai/sdk` is NOT yet in `package.json` (only `@deepgram/sdk@5.4.0` present);
`npm install @anthropic-ai/sdk@0.104.2` is a Wave-0 step. Pure JS — no `@electron/rebuild`. `[VERIFIED: grep package.json]`
**Pattern extraction date:** 2026-06-18
