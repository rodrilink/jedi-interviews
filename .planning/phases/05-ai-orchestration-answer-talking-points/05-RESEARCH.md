# Phase 5: AI Orchestration (Answer + Talking Points) - Research

**Researched:** 2026-06-18
**Domain:** Streaming LLM orchestration in the Electron main process (`@anthropic-ai/sdk` v0.104.2) + one-way overlay render
**Confidence:** HIGH (SDK shape, model IDs, abort mechanics verified against official Anthropic docs; codebase seams read directly)

> **Skill availability note (read first):** The CONTEXT.md and ROADMAP repeatedly designate the **`claude-api` skill** as the authoritative source for model IDs, the streaming shape, and abort mechanics. **That skill is NOT installed on this machine** — it exists in neither `./.claude/skills/` nor `~/.claude/skills/` (verified by directory listing + grep; only stale project-history references mention it). I therefore verified every SDK/model claim directly against the **official Anthropic documentation** (`platform.claude.com/docs`) and the **official TypeScript SDK helpers.md** instead. Those are equally or more authoritative than the skill. The planner should still attempt to load the `claude-api` skill at build time if it becomes available, but the facts below are confirmed and need no skill to act on.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Phase boundary / upstream locks (do NOT re-litigate):**
- All AI orchestration runs in the **Electron main process**; the renderer is a **pure one-way view**. SDK, prompt assembly, transcript-span read, and stream lifecycle live in main. **No renderer→main control surface** (IN-01).
- `TranscriptBuffer.recentSince(ms)` is the span read API and **already exists**. Buffer window is 90s; Phase 5 reads a ~60s sub-span. Do not rebuild the buffer.
- The Anthropic API key is sourced from an **env var / local untracked dev config read in main only** — never in the renderer, never logged, never committed (SET-03; mirrors Phase 4 Deepgram pattern). Phase 6's `safeStorage` entry replaces the *source* later without touching the gateway.
- Claude tiers: `claude-haiku-4-5` (fast), `claude-opus-4-8` (hard).
- **Session Context (CTX-01..04) is Phase 6, NOT here.** Phase 5 grounds on the transcript span only. AI-06 maps to Phase 6. The prompt assembler is built WITH the context seam now (D-13), empty in Phase 5.
- Hotkeys register through `HotkeyRegistrarService` by adding `IHotkeyChord` entries to `HOTKEY_CHORDS`; a missing handler surfaces in `register().failed` (CTL-03). New chords get the 02-03-style Teams/Zoom/VS Code conflict re-check.
- 3-plan shape: 05-01 orchestrator+prompt+gateway / 05-02 mode hotkeys+span / 05-03 streaming render+scroll+cancel+latency log.

**Implementation decisions:**
- **D-01:** AI answers render in a **dedicated, always-on AI panel** — a NEW content surface, NOT inside `DebugHud`, NOT coupled to the HUD toggle (Ctrl+Alt+H). Live transcript stays inside the toggleable HUD.
- **D-02:** AI panel is a **bounded stacked history** — each request appends a new entry (newest at bottom); prior answers remain scrollable. Bounded like `TranscriptBuffer` (last-N and/or total-char ceiling); planner sets exact bounds. A clear-AI-history hotkey is in scope.
- **D-03:** Each history entry has a **small header** (mode `Answer`/`Talking points` + relative time); the panel **auto-scrolls (sticks) to newest while streaming**, reusing the DebugHud `stickToBottomRef` follow/pause pattern; scrolling up pauses auto-follow, returning to bottom re-arms it.
- **D-04:** **In-flight and failure states live inline in the entry.** A new entry shows `thinking…` until first token, then streams token-by-token. On error: short inline `AI error: <reason>`. On cancel: `(cancelled)`. Token append is **debounced (~30–60ms, planner tunes)**.
- **D-05:** Two new chords: **`Ctrl+Alt+A` = Answer (AI-01)**, **`Ctrl+Alt+T` = Talking points (AI-02)**. Both `discrete`. Planner re-verifies both against Teams/Zoom/VS Code (02-03 protocol) with documented fallback.
- **D-06:** **Re-pressing a mode chord while its own stream is in flight cancels that stream cleanly** (success criterion 5). Same chord toggles start/cancel; no separate cancel chord.
- **D-07:** **Only one AI request is ever active at a time.** Pressing the *other* mode chord mid-stream **cancels the current and immediately starts the new one** (cancel-current-start-new). No concurrent API calls. Cancellation must abort the in-flight stream cleanly (SDK abort / AbortController).
- **D-08:** AI-05 scrollback uses a **focused-panel model.** Main-owned **"active panel" flag** (transcript vs AI), pushed to the renderer like `hudVisible`. New chord **`Ctrl+Alt+F` cycles focus**. Small **corner indicator** shows active panel. Existing `Ctrl+Alt+PgUp/PgDn` scroll **whichever panel is active** (replaces Phase-4 "PgUp/PgDn always scroll the transcript"). Default active panel on launch = **AI panel**. Planner re-verifies `Ctrl+Alt+F`.
- **D-09:** Both modes read the **same ~60s recent finalized window** via `transcriptBuffer.recentSince(60_000)` (planner sets exact ms as a named constant).
- **D-10:** **Per-mode model tiering as a per-mode constant:** Answer → `claude-haiku-4-5` (latency-first); Talking points → `claude-opus-4-8` (synthesis). Model ID is a named per-mode constant so a mode can be re-tiered later. **Latency watch:** Opus talking-points may be re-tiered to Haiku if 05-03 latency logging shows it's too slow — flagged, not assumed.
- **D-11:** **Empty-span guard:** if the ~60s span is empty, **do NOT call the API.** Append entry `No recent transcript to act on`. Empty check happens in main before the gateway call.
- **D-12:** **Two distinct system prompts, one per mode.** Answer mode: direct, concise, spoken-style answer (a few scannable sentences); infer the most-recent question in the span and answer it. Talking-points mode: 3–5 short bullets about the project work being discussed.
- **D-13:** **Prompt assembler built WITH the Phase-6 context seam now (CTX-04), empty in Phase 5.** Assembler takes a **structured "grounding context" input** + the transcript span → final prompt. Phase 5 context input is empty/absent; Phase 6 fills it through the **same parameter** with no signature change at any call site.

### Claude's Discretion
- Exact debounce interval (D-04), exact ~60s span value (D-09), AI-history bounds (D-02) — planner picks grounded defaults as named constants.
- AI-panel ↔ transcript height split on the 460×700 overlay; panel styling/position (below HUD per mock). Overlay is `resizable:false`, layout fixed.
- Clear-AI-history chord letter (D-02) and `Ctrl+Alt+F`/`A`/`T` fallback letters if any collide.
- Cancellation mechanism (`AbortController` vs SDK stream `.abort()`) per the claude-api skill (D-07).
- Latency-logging format for hotkey→first-token (likely a `console`/main-log line, never to the renderer).
- AnthropicGateway interface shape — lean: mirror `ISttProvider`/`DeepgramSttGateway`.

### Deferred Ideas (OUT OF SCOPE)
- Session Context grounding (notes/ticket/snippets/links into the prompt) — Phase 6. Seam built now, left empty; no context-store code in Phase 5.
- `safeStorage`-backed Anthropic/Deepgram key entry + settings window — Phase 6. Phase 5 uses env/dev-config key source.
- Vision / code-challenge mode (screenshot → Opus) — Phase 7. Reuses the entire Phase 5 path + an image source + Opus switch; nothing vision-specific built now.
- Concurrent multi-mode streams — rejected for v1 (D-07: single active request).
- Per-mode span tuning — deferred; both use ~60s now. Span is a per-call argument, easy to split later.
- Auto-detecting questions / answering unprompted — out of scope for v1; answer mode infers latest question only on hotkey (D-12).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| AI-01 | Answer an interview question drawn from the recent transcript span | Answer-mode system prompt (Code Examples §Answer Prompt) instructs Claude to infer the most-recent question and answer it; `claude-haiku-4-5` for latency (D-10); span via `recentSince` (D-09). |
| AI-02 | Talking points about the project work being discussed | Talking-points system prompt (Code Examples §Talking-Points Prompt) → 3–5 bullets; `claude-opus-4-8` (D-10). |
| AI-04 | Token-by-token streaming render | `client.messages.stream(...).on('text', (delta, snapshot) => ...)` emits per-token text deltas (Pattern 2); debounced push to a new `jedi:ai` channel (D-04). |
| AI-05 | Keyboard-scrollable output | Reuse DebugHud `stickToBottomRef` + `onScrollTranscript` pattern under a focused-panel model (D-08); `Ctrl+Alt+F` cycles active panel, `Ctrl+Alt+PgUp/PgDn` scroll active panel. |
</phase_requirements>

## Summary

This phase adds a single new pure-JS dependency, `@anthropic-ai/sdk@0.104.2` (already the current latest on npm), and three new main-process units behind clean seams: an `AnthropicGateway` (thin wrapper over `client.messages.stream(...)`, mirroring `DeepgramSttGateway`), a `PromptAssembler` (pure function: grounding-context + transcript-span → `{ system, messages }`, with the Phase-6 context slot built but empty per D-13), and an `AiOrchestrator` that owns the single-in-flight-request lifecycle (start/cancel/cancel-current-start-new) and pushes streamed text to the renderer over a new `jedi:ai` channel. The renderer gains a new always-on `AiPanel` component rendered **outside** the HUD-toggle gate, plus a main-owned `activePanel` flag and `Ctrl+Alt+F` focus-cycle that re-routes the existing PgUp/PgDn scroll.

All the load-bearing SDK facts are confirmed against official Anthropic docs: the streaming entry point is `client.messages.stream({ model, max_tokens, system, messages })`; per-token text arrives via `.on('text', (textDelta, textSnapshot) => …)`; clean cancellation is `stream.abort()` (equivalently `stream.controller.abort()`, or pass `{ signal }` from an `AbortController` in request options); `.on('error', …)` and `.on('abort', …)` surface failure/cancel; `await stream.finalText()` / `.done()` mark completion. The two model IDs are current: `claude-opus-4-8` and `claude-haiku-4-5` (alias of `claude-haiku-4-5-20251001`).

The codebase already provides every pattern Phase 5 needs: the thin-gateway/never-throw/key-in-constructor discipline (`DeepgramSttGateway`), the seam-first contract (`ISttProvider`), the one-way push + teardown-guard (`pushTranscript`), the main-owned flag carried in a status push (`hudVisible`), the stick-to-bottom + hotkey-scroll render pattern (`DebugHud`), the bounded-buffer pattern (`TranscriptBuffer`), and the debounce/throttle precedent (the 66ms audio-level throttle in `index.ts`). Phase 5 is overwhelmingly an *application* of existing patterns to a new vendor — low novelty, high confidence.

**Primary recommendation:** Build `AnthropicGateway` as an `EventEmitter` mirroring `DeepgramSttGateway` exactly (constructor-injected key, never reads `process.env`, never logs the key, surfaces errors via events). Consume `.on('text')` for deltas, `.on('error')`/`.on('abort')` for terminal states, and cancel via the per-stream `stream.abort()`. Keep all single-in-flight state in `AiOrchestrator`. Add one new `jedi:ai` push channel + one main-owned `activePanel` flag carried in the existing status push.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Anthropic streaming API call | Electron **main** | — | SDK + key live in main only (IN-01, SET-03); renderer never touches the key. |
| Prompt assembly (context + span → prompt) | Electron **main** | — | Business logic; reads `TranscriptBuffer` (main-owned) + future context store (main, Phase 6). |
| Transcript-span read | Electron **main** | — | `TranscriptBuffer.recentSince` is main-owned. |
| Single-in-flight stream lifecycle (start/cancel) | Electron **main** | — | State machine; no renderer→main control surface (D-07/IN-01). |
| Mode/focus/clear hotkeys | Electron **main** | — | `HotkeyRegistrarService` is main; passive uiohook hook never steals the meeting app's chords. |
| AI-output render (streamed text + entry headers) | **Renderer** | main (pushes) | Renderer is a pure view of pushed `jedi:ai` payloads. |
| Active-panel focus + scroll routing | Electron **main** (flag) | renderer (renders/scrolls) | Flag is main-owned (like `hudVisible`); renderer scrolls the active element on a pushed signal. |
| AI history bounding | Electron **main** | — | History state is main-owned (mirrors `TranscriptBuffer` bounds); renderer renders the snapshot. |

> **Tier-correctness note for the planner:** The AI *history* (bounded list of entries) should be main-owned, exactly like `TranscriptBuffer`, and pushed to the renderer as a snapshot — NOT accumulated in renderer React state as the source of truth. The renderer may keep a local mirror for rendering, but main owns the bound. This keeps D-02's "bounded so it can never grow unbounded" enforceable in one place and keeps the renderer a pure view (IN-01). The streaming-delta fast path is the one nuance: see Pitfall 4 for the recommended "append deltas in renderer during streaming, reconcile to the main-owned final entry on done" approach.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@anthropic-ai/sdk` | `0.104.2` | Claude Messages streaming in main | Official Anthropic SDK; `messages.stream()` helper gives token-by-token `.on('text')` events and a clean `.abort()`. Pinned per CLAUDE.md. `[VERIFIED: npm registry]` latest = 0.104.2. |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| (none new) | — | — | Everything else (EventEmitter, IPC, React, debounce) uses Node/Electron/React built-ins already in the repo. No debounce library — hand-rolling a trailing-edge timer is trivial and matches the existing 66ms throttle in `index.ts`. |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `client.messages.stream()` (helper) | `client.messages.create({ stream: true })` (raw async iterable) | The raw iterable uses slightly less memory and yields raw SSE events (`content_block_delta` / `text_delta`), but you must accumulate text and detect terminal states yourself. The `.stream()` helper gives `.on('text', delta => …)`, `.on('error')`, `.on('abort')`, `.finalText()`, and `.abort()` out of the box — strictly better for this overlay. **Use `.stream()`.** `[CITED: github.com/anthropics/anthropic-sdk-typescript/helpers.md]` |
| `stream.abort()` | `AbortController` + `{ signal }` in request options | Both work and `.abort()` is documented as "equivalent to `.controller.abort()`". `.abort()` is the leaner choice since the orchestrator already holds the stream handle; an external `AbortController` adds a second object to track. **Use `stream.abort()`** unless the planner wants a single signal shared with a future timeout. `[CITED: github.com/anthropics/anthropic-sdk-typescript/helpers.md]` |
| Per-mode model constants | A single model for both modes | D-10 locks per-mode tiering (Haiku/Opus). Keep as named per-mode constants for cheap re-tiering. |

**Installation:**
```bash
npm install @anthropic-ai/sdk@0.104.2
```
Pure JS — **no native module, no `@electron/rebuild` step** (unlike `uiohook-napi` / `native-recorder-nodejs`). `[VERIFIED: codebase — package.json has zero native postinstall for this dep]`

**Version verification (run at build time):**
```bash
npm view @anthropic-ai/sdk version    # confirm still 0.104.2 (verified 2026-06-18)
npm view @anthropic-ai/sdk@0.104.2 scripts.postinstall   # confirm no postinstall (expected: empty)
```

## Package Legitimacy Audit

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| `@anthropic-ai/sdk` | npm | First publish 2023-01-31; 0.104.2 published 2026-06-15 | Multi-million/wk (official Anthropic SDK) | github.com/anthropics/anthropic-sdk-typescript | ran, exited non-zero (see note) | **Approved** |

**Packages removed due to slopcheck [SLOP] verdict:** none.
**Packages flagged as suspicious [SUS]:** none.

> **slopcheck note:** `slopcheck` is installed but `slopcheck install @anthropic-ai/sdk --json` exited non-zero with no parseable output in this environment (likely a network/registry-access limitation in the sandbox, not a verdict). I therefore verified legitimacy directly: the package is the **official Anthropic first-party SDK** under the `@anthropic-ai` npm org, first published 2023-01-31 (3+ years old), with version 0.104.2 published 2026-06-15 and confirmed as the current `latest` via `npm view`. Source repo is `github.com/anthropics/anthropic-sdk-typescript`. This is not a slopsquat candidate. The planner may re-run `slopcheck` at build time when network access is available, but no `checkpoint:human-verify` gate is required for this single, well-known official package.

## Architecture Patterns

### System Architecture Diagram

```
  [Ctrl+Alt+A / Ctrl+Alt+T]  (uiohook passive hook, main)
            |
            v
   HotkeyRegistrarService  --(handler: 'answer' | 'talking-points')-->  AiOrchestrator (main)
                                                                              |
                          (D-06/D-07: re-press same chord = cancel;           |
                           other chord = cancel-current-start-new;            |
                           single in-flight stream)                           |
                                                                              v
                                         is there an in-flight stream for this mode?
                                          | yes -> stream.abort()  (entry marked "(cancelled)")
                                          | no  -> continue
                                                                              |
                                                                              v
                                    span = TranscriptBuffer.recentSince(~60_000)   (main)
                                                                              |
                                          span empty? --yes--> push "No recent transcript      (D-11)
                                          |  no                 to act on" entry; STOP (no API)
                                          v
                          PromptAssembler.assemble({ mode, span, context: <empty Phase 5> })   (D-12/D-13)
                                          |  -> { system, messages }
                                          v
                          AnthropicGateway.stream({ model<per-mode>, system, messages })   (main)
                                          |        model: Answer->haiku-4-5, Talking->opus-4-8  (D-10)
                                          |
              .on('text', delta) ---------+---------> debounce(~30-60ms) ---> push jedi:ai {append delta}
              .on('error', e)  -----------+---------> push jedi:ai {entry error: "<reason>"}
              .on('abort')     -----------+---------> push jedi:ai {entry: "(cancelled)"}
              .finalText()/.done() -------+---------> push jedi:ai {entry done; reconcile snapshot}
                                                                              |
                                                                              v
                                                  Renderer AiPanel (pure view, outside HUD gate)   (D-01)
                                                   - stacked bounded history, newest at bottom     (D-02)
                                                   - per-entry header: mode + relative time        (D-03)
                                                   - thinking… / streaming / error / cancelled     (D-04)
                                                   - stickToBottom follow/pause                     (D-03)

  [Ctrl+Alt+F] --> main flips activePanel flag --> pushStatus (carries activePanel) --> corner indicator
  [Ctrl+Alt+PgUp/PgDn] --> main reads activePanel --> push scroll signal to the active panel only   (D-08)
  [Ctrl+Alt+<clear-AI>] --> main clears AI history --> push emptied snapshot                          (D-02)
```

### Recommended Project Structure
Mirror the existing `src/main/stt/` layout with a sibling `src/main/ai/`:
```
src/main/ai/
├── ai-gateway.interface.ts     # IAiGateway seam (mirrors stt-provider.interface.ts)
├── anthropic-ai.gateway.ts     # AnthropicGateway implements IAiGateway (mirrors deepgram-stt.gateway.ts)
├── ai-orchestrator.ts          # single-in-flight lifecycle: start/cancel/cancel-current-start-new
├── prompt-assembler.ts         # pure: { mode, span, context } -> { system, messages }  (D-13 seam)
├── ai-history.ts               # bounded AI entry history (mirrors transcript-buffer.ts)  (D-02)
└── test/
    ├── prompt-assembler.test.ts
    ├── ai-history.test.ts
    └── ai-orchestrator.test.ts  # with a fake IAiGateway (FakeAiStream), like FakeV1Socket
src/renderer/src/components/
└── ai-panel.tsx                # NEW always-on panel, rendered outside the HUD-toggle gate (D-01)
```

### Pattern 1: Thin gateway over the vendor SDK (mirror `DeepgramSttGateway`)
**What:** `AnthropicGateway extends EventEmitter implements IAiGateway`. One method `stream(request)` that calls `client.messages.stream(...)`, wires the SDK stream events to typed gateway events, holds the active stream handle for `cancel()`, and **never throws** on a transport fault (surfaces via `error` event). Key injected via constructor; never read from `process.env` inside the gateway; never logged/emitted/IPC'd.
**When to use:** Always — it is the project's locked seam discipline (Claude's Discretion confirms "mirror the `ISttProvider`/`DeepgramSttGateway` precedent").
**Example:** see Code Examples §IAiGateway seam and §AnthropicGateway.

### Pattern 2: Streaming via the `.on('text')` helper, not raw SSE
**What:** `client.messages.stream({...}).on('text', (textDelta, textSnapshot) => …)` fires once per text delta. The SDK accumulates the snapshot for you. `.on('error', …)`, `.on('abort', …)`, `await .finalText()` / `.done()` complete the picture. This avoids hand-parsing `content_block_delta`/`text_delta` SSE frames.
**When to use:** Always for this overlay (token-by-token render, AI-04).
**Example:**
```typescript
// Source: github.com/anthropics/anthropic-sdk-typescript/helpers.md + platform.claude.com/docs/en/api/streaming
const stream = client.messages.stream({
    model: 'claude-haiku-4-5',
    max_tokens: 1024,
    system: systemPrompt,
    messages: [{ role: 'user', content: userContent }],
});
stream.on('text', (textDelta: string /* , textSnapshot: string */) => {
    // emit one token-ish chunk; orchestrator debounces the renderer push (D-04)
});
stream.on('error', (error) => { /* surface inline 'AI error: <reason>' (D-04) */ });
stream.on('abort', () => { /* mark entry '(cancelled)' (D-04/D-06) */ });
await stream.finalText(); // terminal: mark entry done
```

### Pattern 3: Cancel via the held stream handle (`stream.abort()`)
**What:** The orchestrator keeps the current `MessageStream` handle and one `mode` tag. To cancel: call `currentStream.abort()`. This fires the SDK's `'abort'` event (an `APIUserAbortError`) and stops the HTTP request cleanly. `.abort()` is documented as equivalent to `.controller.abort()`.
**When to use:** D-06 (re-press same chord cancels) and D-07 (other chord cancels-then-starts). Single-in-flight invariant: before starting any new stream, abort the current one if present.
**Example:** see Code Examples §AiOrchestrator cancel logic.

### Pattern 4: Main-owned flag carried in the existing status push (mirror `hudVisible`)
**What:** Add `activePanel: 'transcript' | 'ai'` to `IOverlayStatus` and a module-level flag + `setActivePanel`/`getActivePanel` in `overlay-window.manager.ts`, exactly like `hudVisible`. `Ctrl+Alt+F` flips it; `buildStatus` carries it; `pushStatus` delivers it. The corner indicator and the scroll routing are pure views of this flag.
**When to use:** D-08.

### Pattern 5: New one-way push channel (mirror `jedi:transcript`)
**What:** Add `AI_CHANNEL = 'jedi:ai'` + `pushAi(window, payload)` with the same `isDestroyed()` teardown guard, and mirror the preload `onAi(callback)` subscription returning an unsubscribe. High-frequency (debounced deltas), so keep it a **separate channel** from `jedi:status` — exactly the reasoning that split `jedi:transcript` out.
**When to use:** AI-04 render path.

### Anti-Patterns to Avoid
- **Reading the Anthropic key inside the gateway** (`process.env.ANTHROPIC_API_KEY` in `anthropic-ai.gateway.ts`). The Deepgram gateway takes the key via constructor and `index.ts` reads `process.env`. Do the same so Phase 6's `safeStorage` source-swap touches only `index.ts`. `[VERIFIED: codebase deepgram-stt.gateway.ts:80, index.ts:109]`
- **Throwing on an API/transport fault.** The whole gateway discipline is report-don't-throw via `error` events, with the `emitError` no-listener guard. A transient 529/overloaded must never crash main. `[VERIFIED: codebase deepgram-stt.gateway.ts:208-212]`
- **Pushing every `text_delta` straight to the renderer.** D-04 mandates a ~30–60ms debounce, same rationale as the 66ms audio-level throttle. Un-debounced, a fast Haiku stream floods IPC.
- **Accumulating AI history as renderer-owned source of truth.** Bound it in main (D-02) like `TranscriptBuffer`; the renderer renders a snapshot. (See the streaming-delta nuance in Pitfall 4.)
- **Putting the AI panel inside `DebugHud` / gating it on `hudVisible`.** D-01: it is a NEW always-on surface, rendered in `App.tsx` as a sibling of `DebugHud`, NOT inside it.
- **Allowing two concurrent streams.** D-07: single in-flight. Always abort the current before starting a new one.
- **Using `globalShortcut` for the new chords.** The locked discipline is the passive uiohook hook so the meeting app's accelerators are never consumed (CTL-02). New chords are just new `IHotkeyChord` rows in `HOTKEY_CHORDS`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Token-by-token text accumulation from the stream | A manual SSE parser over `content_block_delta`/`text_delta` | `stream.on('text', (delta, snapshot) => …)` | The SDK helper already parses frames, accumulates the snapshot, and exposes terminal events. `[CITED: helpers.md]` |
| Clean stream cancellation | A custom socket-tearing routine | `stream.abort()` (fires `'abort'`, stops the HTTP request) | Documented, equivalent to `controller.abort()`; no manual teardown. `[CITED: helpers.md]` |
| Final-message assembly | Concatenating deltas yourself and guessing when it's done | `await stream.finalText()` / `await stream.done()` | SDK resolves on `message_stop`. `[CITED: helpers.md]` |
| Backoff/retry on overloaded | A retry loop | (Phase 5: just surface the error inline.) The SDK has built-in retries for transient errors on the underlying request | Don't add a retry loop now; D-04 is "show `AI error: <reason>` inline." Keep it simple. `[CITED: github README — SDK auto-retries certain errors]` |
| Debounce | A debounce library | A trailing-edge `setTimeout` (≈10 lines), matching the 66ms throttle precedent | One new dependency is the budget; the existing `index.ts` throttle shows the house style. |

**Key insight:** The only genuinely new thing in Phase 5 is the Anthropic stream lifecycle, and the SDK's `.stream()` helper already solves the hard parts (delta parsing, snapshotting, abort, completion). Everything else is a re-application of an existing, proven codebase pattern. Resist building anything the helper or an existing pattern already covers.

## Common Pitfalls

### Pitfall 1: Stale single-in-flight state after cancel
**What goes wrong:** Orchestrator aborts the current stream but the `'abort'`/`'error'` handler from the *old* stream still pushes to the renderer, racing the new stream's `thinking…`/deltas — text from two requests interleaves in one entry.
**Why it happens:** Async events from an aborted stream can still fire after `abort()`; the orchestrator must bind each stream's handlers to *that stream's* entry id, not to a shared "current entry."
**How to avoid:** Tag every stream + its target history entry with a monotonic request id at start. In each handler, ignore the event if the request id is no longer the active one. (Mirrors the `stopped` guard in `DeepgramSttGateway.attachHandlers` close handler.)
**Warning signs:** A cancelled answer keeps appending tokens; `(cancelled)` followed by more text.

### Pitfall 2: Empty/whitespace span still calls the API
**What goes wrong:** `recentSince` returns `''` (or just spaces) right after a clear or during silence, and the orchestrator still calls Claude — wasting cost and showing a meaningless answer.
**Why it happens:** Forgetting the D-11 guard, or checking `=== ''` but not trimming whitespace-only joins.
**How to avoid:** D-11 guard in main *before* the gateway call: `if (span.trim().length === 0) { push "No recent transcript to act on" entry; return; }`. Unit-test it (it's pure).
**Warning signs:** "I don't have any transcript to work with" style answers; cost with no recent audio.

### Pitfall 3: Anthropic key missing → cryptic failure or leak
**What goes wrong:** Key absent → SDK throws on construct/first call; or someone logs the error object which embeds request headers.
**Why it happens:** No env var set; or logging the raw error (D-08 forbids key-adjacent logging — Deepgram gateway deliberately does NOT log the error payload, see `index.ts:131-135`).
**How to avoid:** Read `process.env.ANTHROPIC_API_KEY` in `index.ts` (after `loadDotenvFile`), pass to the gateway constructor. If empty, surface `AI error: missing API key` inline without logging the key. Never log the error payload from the AI `error` handler (mirror the Deepgram `error` no-payload-log policy). Add `ANTHROPIC_API_KEY` to the gitignored `.env` (see Runtime State Inventory).
**Warning signs:** App works for STT but every AI press shows an error; or an error log line containing `x-api-key`.

### Pitfall 4: Debounced deltas vs main-owned history reconciliation
**What goes wrong:** If main owns the full history snapshot and re-pushes the entire bounded list on every debounced delta, you push a large payload many times/sec — IPC bloat. If instead the renderer accumulates deltas locally, the main-owned bound (D-02) isn't authoritative for the in-progress entry.
**Why it happens:** Tension between "main owns the bound" (D-02) and "stream token-by-token cheaply" (D-04).
**How to avoid (recommended):** Push **incremental delta payloads** on `jedi:ai` during streaming (`{ type: 'delta', requestId, text }`), let the renderer append to the in-progress entry, and push a **terminal snapshot** (`{ type: 'done' | 'error' | 'cancelled', requestId, finalText }`) once. Main appends the final entry to its bounded history on `done` and re-pushes the bounded snapshot only on terminal/clear events — not per delta. This keeps per-delta payloads tiny AND keeps the bound authoritative at rest. Planner finalizes the exact payload discriminated-union shape.
**Warning signs:** Janky overlay under fast Haiku streams; CPU spike in the renderer; main re-serializing a 20k-char list 30×/sec.

### Pitfall 5: New chords collide with the meeting app
**What goes wrong:** `Ctrl+Alt+A`, `Ctrl+Alt+T`, `Ctrl+Alt+F`, or the clear-AI chord collides with a Teams/Zoom/VS Code accelerator on the target machine, so either the app eats it or the overlay action competes.
**Why it happens:** `A`/`T`/`F` are outside the locked conflict-tested set {J, arrows, [, ], H, Q, K, PgUp, PgDn} — they were never tested.
**How to avoid:** Re-run the 02-03 on-machine conflict protocol for each new chord with the meeting apps holding focus; document results in a phase test artifact; pick documented fallback letters if any collide (Claude's Discretion already reserves this).
**Warning signs:** A press does nothing, or triggers a Teams/Zoom/VS Code action instead.

### Pitfall 6: `max_tokens` too high → latency hit; too low → truncated answer
**What goes wrong:** A large `max_tokens` doesn't slow first-token but a verbose model can run long, hurting the "in the flow" feel; too small truncates a useful answer mid-sentence.
**Why it happens:** `max_tokens` is the hard output cap and is required.
**How to avoid:** Set a modest per-mode `max_tokens` named constant (answers are "a few scannable sentences" per D-12; talking points are 3–5 short bullets). The system prompt enforces brevity; `max_tokens` is the safety cap, not the brevity mechanism. Planner picks grounded defaults (e.g. ~300–500 for answer, ~400–600 for talking points) and may tune during 05-03 latency logging. `[CITED: platform.claude.com/docs — max_tokens is required and is a hard cap]`

## Code Examples

### IAiGateway seam (mirror `stt-provider.interface.ts`)
```typescript
// src/main/ai/ai-gateway.interface.ts  (NEW — pure contract, no SDK import)
// Pattern source: codebase src/main/stt/stt-provider.interface.ts

/** The two AI modes this phase ships (D-05/D-10/D-12). Extensible (Phase 7 adds a vision mode). */
export type AiMode = 'answer' | 'talking-points';

/** A single in-flight AI stream handle. The orchestrator holds one at a time (D-07). */
export interface IAiStream {
    /** Aborts this stream cleanly; fires the gateway 'abort' event (D-06/D-07). */
    abort(): void;
}

/** The assembled prompt the gateway sends (PromptAssembler output, D-13). */
export interface IAiPromptRequest {
    /** Per-mode model id, a named constant chosen by the orchestrator (D-10). */
    model: string;
    /** Hard output-token cap (Pitfall 6). */
    maxTokens: number;
    /** The mode's system prompt (D-12). */
    system: string;
    /** The user turn: transcript span (+ empty Phase-5 context slot, D-13). */
    userContent: string;
}

/**
 * The swappable AI-generation seam. Consumers (AiOrchestrator) depend on THIS, never on
 * `@anthropic-ai/sdk`. Mirrors ISttProvider: event-emitter style, report-don't-throw.
 */
export interface IAiGateway {
    /** Starts a streaming generation and returns its abort handle. Never throws on transport fault. */
    stream(request: IAiPromptRequest): IAiStream;
    /** Fires once per text delta (AI-04). */
    on(event: 'text', listener: (textDelta: string) => void): void;
    /** Fires once when the stream completes successfully, with the full text. */
    on(event: 'done', listener: (finalText: string) => void): void;
    /** Fires on a transport/API fault (surfaced, never thrown). */
    on(event: 'error', listener: (error: Error) => void): void;
    /** Fires when the stream was aborted via abort() (D-06). */
    on(event: 'abort', listener: () => void): void;
}
```
*Note: the planner may choose a per-call callback shape instead of a shared emitter to sidestep Pitfall 1 (cross-stream event bleed) — e.g. `stream(request, handlers)` returning `IAiStream`. Either is acceptable; the per-call-handlers variant makes the single-in-flight request-id discipline structurally easier. This is a planner refinement.*

### AnthropicGateway (mirror `deepgram-stt.gateway.ts`)
```typescript
// src/main/ai/anthropic-ai.gateway.ts  (NEW)
// SDK source: github.com/anthropics/anthropic-sdk-typescript/helpers.md
import Anthropic from '@anthropic-ai/sdk';
import type { IAiGateway, IAiPromptRequest, IAiStream } from './ai-gateway.interface';

export class AnthropicGateway implements IAiGateway {
    private readonly client: Anthropic;

    /** @param apiKey - Read in main only (D-08). Held for the client; never logged/emitted/IPC'd. */
    public constructor(apiKey: string) {
        this.client = new Anthropic({ apiKey });
    }

    public stream(request: IAiPromptRequest): IAiStream {
        const stream = this.client.messages.stream({
            model: request.model,
            max_tokens: request.maxTokens,
            system: request.system,
            messages: [{ role: 'user', content: request.userContent }],
        });
        stream.on('text', (textDelta: string) => this.emit('text', textDelta));
        stream.on('abort', () => this.emit('abort'));
        stream.on('error', (error) => this.emit('error', error instanceof Error ? error : new Error('AI stream error')));
        // Terminal success — finalText() resolves on message_stop.
        void stream.finalText().then((finalText) => this.emit('done', finalText)).catch(() => { /* error path already emitted */ });
        return { abort: (): void => stream.abort() };
    }
    // ... EventEmitter plumbing with the same no-'error'-listener guard as DeepgramSttGateway.emitError
}
```

### AiOrchestrator cancel logic (single-in-flight, D-06/D-07)
```typescript
// src/main/ai/ai-orchestrator.ts  (NEW)
// State: one current stream + its request id (Pitfall 1 guard).
public trigger(mode: AiMode): void {
    const span = this.transcriptBuffer.recentSince(RECENT_SPAN_MS); // D-09
    // D-11 empty-span guard, BEFORE any API call:
    if (span.trim().length === 0) {
        this.pushEntry({ mode, kind: 'empty' }); // "No recent transcript to act on"
        return;
    }
    // D-06: re-press same mode while its stream is in flight -> cancel, done.
    if (this.current && this.current.mode === mode) {
        this.current.stream.abort();
        return;
    }
    // D-07: other mode mid-stream -> cancel current, then start new.
    if (this.current) {
        this.current.stream.abort();
    }
    const requestId = ++this.requestSeq;
    const model = mode === 'answer' ? ANSWER_MODEL : TALKING_POINTS_MODEL; // D-10 per-mode constants
    const { system, userContent } = this.promptAssembler.assemble({ mode, span, context: undefined }); // D-13 empty slot
    const stream = this.gateway.stream({ model, maxTokens: MAX_TOKENS[mode], system, userContent });
    this.current = { mode, requestId, stream };
    // Handlers ignore events whose requestId !== this.current.requestId (Pitfall 1).
}
```

### Answer-mode system prompt (D-12 — DRAFT, planner refines)
```text
You are a real-time meeting assistant for the user during a live conversation.
You are given the last ~60 seconds of the conversation transcript.

Identify the most recent question in the transcript that appears to be directed at the user,
and answer THAT question directly. If no clear question is present, answer the most recent
point that seems to invite a response from the user.

Reply in a natural, spoken style the user could say aloud — a few short, scannable sentences.
Be direct and specific. Do not restate the question. Do not add preamble like "Sure" or
"Great question". Do not use markdown headers. If the transcript is ambiguous, give your single
best concise answer rather than asking for clarification.
```
*Provenance: `[ASSUMED]` — drafted from D-12's requirements + general prompt-shape guidance; not lifted from the (unavailable) claude-api skill. Needs user/planner confirmation before locking.*

### Talking-points system prompt (D-12 — DRAFT, planner refines)
```text
You are a real-time meeting assistant for the user during a live discussion of project work.
You are given the last ~60 seconds of the conversation transcript.

Produce 3 to 5 short talking points the user could raise about the project work being discussed.
Each point is one concise line (a sentence or fragment), phrased so the user could say it aloud.
Lead with the most relevant point. Be specific to what was actually discussed in the transcript;
do not invent details that are not implied. Output only the bullet points, one per line, each
prefixed with "- ". No preamble, no headers, no closing summary.
```
*Provenance: `[ASSUMED]` — drafted from D-12; needs user/planner confirmation before locking.*

### PromptAssembler seam (D-13 — context slot built, empty in Phase 5)
```typescript
// src/main/ai/prompt-assembler.ts  (NEW — pure, unit-tested)
export interface IGroundingContext {
    // Phase 6 fills these (CTX-01..04). Phase 5 passes undefined / an empty object.
    notes?: string;
    ticketText?: string;
    repoSnippets?: string;
    links?: string[];
}
export interface IAssembleInput {
    mode: AiMode;
    span: string;                 // transcriptBuffer.recentSince(RECENT_SPAN_MS)
    context?: IGroundingContext;  // EMPTY in Phase 5; same param Phase 6 fills (D-13)
}
export interface IAssembledPrompt { system: string; userContent: string; }

export function assemblePrompt(input: IAssembleInput): IAssembledPrompt {
    const system = input.mode === 'answer' ? ANSWER_SYSTEM_PROMPT : TALKING_POINTS_SYSTEM_PROMPT;
    // Phase 5: userContent is just the labeled transcript span. The context block is appended here
    // in Phase 6 with NO signature change at the call site (D-13).
    const contextBlock = formatContext(input.context); // returns '' when context is empty/undefined
    const userContent = `${contextBlock}Recent transcript (last ~60s):\n${input.span}`;
    return { system, userContent };
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `claude-3-*` / older model IDs in training-era tutorials | `claude-opus-4-8`, `claude-haiku-4-5` | 4.x generation; dateless pinned IDs since 4.6 | Use the exact current IDs; both verified current today. |
| Hand-parsing `content_block_delta` SSE in JS | `messages.stream().on('text', …)` helper | Stable in the TS SDK for many versions | Don't parse SSE manually. |
| `client.messages.create({ stream: true })` raw iterable | `messages.stream()` helper for app code | Helper is the recommended path | Helper gives abort + terminal events + snapshotting. |

**Deprecated/outdated:**
- Older Claude model IDs (`claude-3-5-*`, `claude-opus-4-1`) — `claude-opus-4-1` is deprecated (retires 2026-08-05). Use `claude-opus-4-8` / `claude-haiku-4-5`. `[CITED: platform.claude.com/docs/en/about-claude/models/overview]`

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The two DRAFT system prompts (answer + talking-points) match the user's intent | Code Examples §prompts | LOW — prompts are easy to tune; D-12 gives clear shape. Planner/user should confirm wording before locking. Not lifted from the claude-api skill (unavailable). |
| A2 | `ANTHROPIC_API_KEY` is the env var name to use for the key | Pitfall 3 / Runtime State Inventory | LOW — it's the SDK's conventional name and matches the Deepgram `DEEPGRAM_API_KEY` precedent; confirm with user. The SDK auto-reads `ANTHROPIC_API_KEY` if no key is passed, but D-08 mandates explicit constructor injection. |
| A3 | Recommended `max_tokens` defaults (~300–500 answer / ~400–600 talking points) | Pitfall 6 | LOW — safety caps only; system prompt enforces brevity. Planner tunes during 05-03 latency logging. |
| A4 | Debounce interval will land in the 30–60ms band (D-04) | Don't Hand-Roll / Pitfall 4 | LOW — D-04 already bounds this; planner picks the exact value as a named constant. |
| A5 | The push-deltas-incrementally + reconcile-on-done payload model is the right IPC shape | Pitfall 4 | MEDIUM — it satisfies both D-02 (main-owned bound) and D-04 (cheap deltas), but the exact discriminated-union payload is a planner decision; an alternate (push full snapshot, debounced harder) also works. |

**slopcheck unavailability** is documented in the Package Legitimacy Audit, not here, because the package itself is verified-legitimate by other means.

## Open Questions

1. **Exact `jedi:ai` payload shape (delta vs snapshot reconciliation).**
   - What we know: Pitfall 4 recommends incremental deltas during streaming + a terminal snapshot; main owns the bounded history (D-02).
   - What's unclear: the precise discriminated-union message shape and whether the in-progress entry id is allocated in main or echoed from the renderer.
   - Recommendation: Planner defines a small `IAiPushEvent` union (`thinking | delta | done | error | cancelled | history-snapshot`), each carrying `requestId`. Keep it main-allocated for the Pitfall-1 guard.

2. **`Ctrl+Alt+A`/`T`/`F` + clear-AI chord conflict results on the target machine.**
   - What we know: they're outside the locked conflict-tested set, so they MUST be re-tested (D-05/D-08, Pitfall 5).
   - What's unclear: whether any collides with Teams/Zoom/VS Code on the actual machine.
   - Recommendation: 05-02/05-03 runs the 02-03 protocol and documents a fallback letter per chord (Claude's Discretion reserves this).

3. **Whether Opus talking-points latency is acceptable "in the flow."**
   - What we know: D-10 flags re-tiering talking points to Haiku if 05-03 latency logging shows Opus too slow.
   - What's unclear: actual first-token latency on the user's network.
   - Recommendation: per-mode model is a named constant; instrument hotkey→first-token in 05-03 and let the user decide.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `@anthropic-ai/sdk` | All AI calls | ✗ (not yet installed) | target 0.104.2 | none — `npm install` it (pure JS, no rebuild) |
| Anthropic API key (`ANTHROPIC_API_KEY`) | All AI calls | unknown (user-supplied) | — | none — AI press shows `AI error: missing API key` inline until set (D-11-style graceful degradation) |
| Node `fetch` / network egress to api.anthropic.com | Streaming requests | ✓ (Electron 35 / Node 22) | — | none |
| `@electron/rebuild` for the new dep | — | n/a | — | NOT needed: `@anthropic-ai/sdk` is pure JS, no native module |

**Missing dependencies with no fallback:**
- `@anthropic-ai/sdk@0.104.2` must be installed (`npm install @anthropic-ai/sdk@0.104.2`). Pure JS — no `--ignore-scripts` quirk and no rebuild (unlike `native-recorder-nodejs` / `uiohook-napi`).
- A valid Anthropic API key in the env/`.env`; without it AI presses gracefully show an inline error rather than crashing.

## Validation Architecture

> nyquist_validation: `.planning/config.json` was not present at research time; treating as enabled (key absent = enabled).

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 3.2.4 (co-located, per IDEXX standards) `[VERIFIED: package.json]` |
| Config file | electron-vite / vitest config in repo root (existing; STT tests run under it) |
| Quick run command | `npx vitest run src/main/ai/<file>.test.ts` |
| Full suite command | `npx vitest run` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| AI-01 | Answer-mode prompt assembly (correct system prompt + labeled span) | unit | `npx vitest run src/main/ai/prompt-assembler.test.ts` | ❌ Wave 0 |
| AI-02 | Talking-points prompt assembly | unit | `npx vitest run src/main/ai/prompt-assembler.test.ts` | ❌ Wave 0 |
| D-11 | Empty-span guard skips the API call | unit | `npx vitest run src/main/ai/ai-orchestrator.test.ts` | ❌ Wave 0 |
| D-06/D-07 | Single-in-flight: re-press cancels; other mode cancels-then-starts; request-id guard | unit (fake gateway) | `npx vitest run src/main/ai/ai-orchestrator.test.ts` | ❌ Wave 0 |
| D-02 | AI history bounded (last-N / total-char ceiling) | unit | `npx vitest run src/main/ai/ai-history.test.ts` | ❌ Wave 0 |
| AI-04 | Token-by-token delta push (debounce trailing-edge) | unit | `npx vitest run src/main/ai/ai-orchestrator.test.ts` | ❌ Wave 0 |
| AI-04/AI-05 | Live streaming render + scrollback + focus-cycle | manual-only | on-machine verify (overlay is `focusable:false`; live stream not unit-testable) | n/a |

### Sampling Rate
- **Per task commit:** `npx vitest run src/main/ai/<touched-file>.test.ts`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green + on-machine live AI verify before `/gsd:verify-work`.

### Wave 0 Gaps
- [ ] `src/main/ai/prompt-assembler.test.ts` — covers AI-01/AI-02 (pure prompt assembly + empty context slot, D-13)
- [ ] `src/main/ai/ai-history.test.ts` — covers D-02 bounds (mirror `transcript-buffer` tests)
- [ ] `src/main/ai/ai-orchestrator.test.ts` — covers D-06/D-07/D-11/AI-04 with a `FakeAiGateway` (mirror the `FakeV1Socket` stand-in used for Deepgram)
- [ ] No framework install needed — Vitest already configured.

## Security Domain

> `security_enforcement` config not present at research time; treating as enabled. This phase handles a secret (the Anthropic key) and an external network call, so the security review is load-bearing.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | No app-level auth; the Anthropic key is the only credential. |
| V3 Session Management | no | No sessions. |
| V4 Access Control | no | Single-user desktop app. |
| V5 Input Validation | yes | Transcript span is plain text inserted into the prompt; cap its length (already bounded by `TranscriptBuffer` 20k-char ceiling). The Anthropic `error` payload is treated as untrusted and NOT logged with key-adjacent detail. |
| V6 Cryptography | yes (deferred to Phase 6) | Phase 5 key is env/dev-config plaintext (locked, D-08-equivalent); `safeStorage` (DPAPI) encryption is Phase 6. Never hand-roll key storage. |
| V7 Secret Management | yes | Key read in main only, constructor-injected, never logged/emitted/IPC'd, never crosses to the renderer (IN-01/SET-03). `.env` is gitignored. |

### Known Threat Patterns for {Electron main + LLM API}

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| API key leak to renderer / logs / git | Information Disclosure | Key only in main, constructor-injected; never logged, never on `jedi:*` channels; `.env` gitignored (mirror Deepgram D-08). |
| Logging an error object that embeds request headers (`x-api-key`) | Information Disclosure | Do not log the AI `error` payload (mirror `index.ts:131-135` Deepgram policy); show a sanitized `AI error: <reason>` inline only. |
| Prompt-injection via meeting audio (someone says "ignore your instructions") | Tampering | LOW risk for a single-user assist tool with no tool-use/actions; system prompt is fixed in main and not user-editable in Phase 5. Note for Phase 6 when user context is injected. |
| Unbounded transcript → oversized/expensive prompt | Denial of Service / cost | Span is the ~60s `recentSince` sub-window of an already-bounded buffer (90s / 400 segments / 20k chars). `max_tokens` caps output. AI calls are user-triggered only (cost control). |
| Renderer→main control channel abuse | Elevation of Privilege | None added: the renderer stays a pure view; AI triggers come from main-side hotkeys only (IN-01). |

## Sources

### Primary (HIGH confidence)
- `platform.claude.com/docs/en/about-claude/models/overview` — confirmed current model IDs: `claude-opus-4-8`, `claude-haiku-4-5` (alias of `claude-haiku-4-5-20251001`), pricing/latency tiers; `claude-opus-4-1` deprecated.
- `github.com/anthropics/anthropic-sdk-typescript/blob/main/helpers.md` — `MessageStream` events (`text`, `message`, `finalMessage`, `contentBlock`, `streamEvent`, `error`, `abort`, `connect`, `end`), `.abort()` (= `.controller.abort()`), `.done()`, `.finalText()`, `.finalMessage()`.
- `platform.claude.com/docs/en/api/streaming` — canonical TS `client.messages.stream({ model, max_tokens, messages }).on('text', …)` example; raw SSE `content_block_delta`/`text_delta` shape; `overloaded_error` event type.
- Codebase (read directly): `src/main/stt/{stt-provider.interface,deepgram-stt.gateway,transcript-buffer}.ts`, `src/main/overlay-window.manager.ts`, `src/main/hotkey-registrar.service.ts`, `src/main/index.ts`, `src/main/config/load-dotenv.utility.ts`, `src/preload/index.ts`, `src/renderer/src/{App.tsx,components/debug-hud.tsx}` — all the seams/patterns Phase 5 reuses.
- `npm view @anthropic-ai/sdk` — latest = 0.104.2 (published 2026-06-15); first publish 2023-01-31.

### Secondary (MEDIUM confidence)
- WebSearch (Anthropic SDK streaming / abort) — corroborates `stream.controller.abort()` and `{ signal }` request-option cancellation; corroborates SDK built-in retries.

### Tertiary (LOW confidence)
- None relied upon. (The designated `claude-api` skill was unavailable; all facts came from Primary sources instead.)

## Metadata

**Confidence breakdown:**
- Standard stack (single official SDK, pinned version): HIGH — verified on npm + official docs.
- SDK streaming + abort + model IDs: HIGH — verified against official Anthropic docs and the SDK's own helpers.md.
- Architecture/seam fit: HIGH — every pattern read directly in the existing codebase and is a 1:1 mirror of Phase 4.
- Prompts (D-12): MEDIUM — drafts that satisfy D-12's shape but should be confirmed by the user (claude-api skill unavailable).
- IPC payload shape (Pitfall 4): MEDIUM — recommended approach is sound but the exact union is a planner decision.

**Research date:** 2026-06-18
**Valid until:** ~2026-07-18 (30 days; stable official SDK + model IDs. Re-confirm model IDs if Anthropic ships a new generation, and `npm view @anthropic-ai/sdk version` at build time.)
