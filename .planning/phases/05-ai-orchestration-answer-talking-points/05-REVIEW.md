---
phase: 05-ai-orchestration-answer-talking-points
reviewed: 2026-06-18T00:00:00Z
depth: standard
files_reviewed: 14
files_reviewed_list:
  - src/main/ai/ai-gateway.interface.ts
  - src/main/ai/anthropic-ai.gateway.ts
  - src/main/ai/ai-orchestrator.ts
  - src/main/ai/prompt-assembler.ts
  - src/main/ai/ai-history.ts
  - src/main/ai/sanitize-ai-error.utility.ts
  - src/main/hotkey-registrar.service.ts
  - src/main/index.ts
  - src/main/overlay-window.manager.ts
  - src/preload/index.ts
  - src/preload/index.d.ts
  - src/renderer/src/components/ai-panel.tsx
  - src/renderer/src/components/debug-hud.tsx
  - src/renderer/src/components/format-uptime.utility.ts
findings:
  critical: 0
  warning: 4
  info: 3
  total: 7
status: issues_found
---

# Phase 5: Code Review Report

**Reviewed:** 2026-06-18
**Depth:** standard
**Files Reviewed:** 14
**Status:** issues_found

## Summary

Phase 5 adds the AI orchestration stack (gateway seam, Anthropic gateway, single-in-flight
orchestrator, prompt assembler, bounded history, error sanitizer) plus the renderer AI panel and the
A/T/G/F hotkeys. The **security posture is strong and matches T-5-02**: the Anthropic key is read only
at the `index.ts` key-load seam and constructor-injected; the gateway never reads `process.env`, never
logs the raw SDK error, and swallows the `finalText()` rejection with an explicit no-op so the
SDK error object (which can embed `x-api-key`/headers) is never logged; `sanitizeAiError` maps on
HTTP status and never echoes the raw body; the `jedi:ai` channel carries only AI text/state; the
preload bridge is strictly one-way (no renderer→main control surface, IN-01) and hard-fails if
`contextIsolation` is ever off. The single-in-flight invariant, request-id guard, debounce-timer
cleanup, and EventEmitter no-listener guard are all implemented correctly.

The findings below are all correctness/state-consistency and quality issues — no security blockers.
The most material is a **state divergence between the main-owned history and the renderer mirror when
`clear-ai` fires mid-stream** (WR-01): clearing the AI panel does not cancel the in-flight stream, and
the renderer silently drops the surviving stream's deltas because its target entry no longer exists.

## Warnings

### WR-01: `clear-ai` mid-stream orphans the in-flight stream and diverges main/renderer state

**File:** `src/main/index.ts:118-121` (handler) + `src/renderer/src/components/ai-panel.tsx:79-90` (reducer)
**Issue:** The `clear-ai` chord calls `aiHistory.clear()` and pushes `{ type: 'cleared' }`, but it does
**not** cancel the orchestrator's active stream (`aiOrchestrator` is not even passed to the handler).
If a stream is in flight when the user presses Ctrl+Alt+G:
- The renderer's reducer resets `entries` to `[]` (`case 'cleared'` returns `[]`).
- The orchestrator's `this.active` is untouched, so the stream keeps running. Its subsequent `delta`
  pushes hit `reduceEntries` `case 'delta'`, which does `entries.map(... entry.id === event.id ...)`.
  Because no entry with that id survives the clear, **every delta is silently dropped** and the entry
  never reappears on screen.
- On `done`, the orchestrator calls `this.history.append(...)` — so the main-owned history now holds an
  entry that the renderer never shows. Main's source-of-truth history and the renderer mirror diverge
  until the next user action, and the cleared panel silently "eats" a response the user is still paying
  for. This violates D-02's "main is the authoritative source the renderer mirrors."

**Why it matters:** Silent loss of a paid-for, in-flight AI response plus a persistent state divergence
between main and the renderer. Easy to hit: clear the panel while an answer is still streaming.
**Fix:** Cancel the active stream when clearing. Add a public cancel entry point to the orchestrator and
call it from the handler before clearing history:
```typescript
// ai-orchestrator.ts
/** Aborts any in-flight stream without recording a cancelled entry (used by the clear-AI chord). */
public abortActive(): void {
    if (this.active === undefined) {
        return;
    }
    this.active.stream.abort();
    this.clearActive();
}

// index.ts buildHandlers — pass aiOrchestrator in and:
'clear-ai': (): void => {
    aiOrchestrator.abortActive();
    aiHistory.clear();
    pushAi(window, { type: 'cleared' });
},
```
(If a `(cancelled)` record is undesirable after a full clear, use a dedicated abort path as above rather
than `cancelActive()`, which would push a `cancelled` event the renderer just cleared.)

### WR-02: Empty-span guard bypasses the single-in-flight invariant — does not cancel an active stream

**File:** `src/main/ai/ai-orchestrator.ts:135-147`
**Issue:** `trigger()` evaluates the D-11 empty-span guard and `return`s **before** the
`this.active !== undefined` checks. If a stream is already in flight and a later trigger reads an empty
span (e.g. the 60s window aged out, or `clear-transcript` ran), the orchestrator appends a fresh
`empty` entry and increments `requestSeq`, but leaves the active stream running untouched. The user now
sees an "empty" placeholder stacked while the prior stream is still streaming into its own (older)
entry — the single-in-flight mental model (re-press cancels) is silently violated for this path.
**Why it matters:** Inconsistent cancel semantics; a confusing two-live-entries UI state. It is a
narrow window (span must empty mid-stream) but reachable via `clear-transcript` during a stream.
**Fix:** Decide the intended semantics and make them explicit. If an empty-span trigger should still
honor single-in-flight, cancel first:
```typescript
public trigger(mode: AiMode): void {
    const span = this.transcriptBuffer.recentSince(RECENT_SPAN_MS);
    if (span.trim().length === 0) {
        if (this.active !== undefined) {
            this.cancelActive();
        }
        // ...existing empty-entry append/push
        return;
    }
    // ...rest unchanged
}
```
If the current behavior is intentional, document the why in the guard comment so it isn't read as a bug.

### WR-03: `MISSING_KEY_TEXT` is dead code and the documented "missing API key" behavior never occurs

**File:** `src/main/ai/ai-orchestrator.ts:50` (constant) + `.env.example:12-13` (documented behavior)
**Issue:** `MISSING_KEY_TEXT = 'AI error: missing API key'` is exported but referenced nowhere outside
its own declaration (confirmed by grep across `src/`). The wiring constructs the gateway with
`new AnthropicGateway(process.env.ANTHROPIC_API_KEY ?? '')`. The Anthropic SDK only falls back to
`process.env` when `apiKey === undefined`; an explicit **empty string is passed through as-is** and the
SDK constructor does not throw on it (only an async key-*setter* throws on empty — verified in
`node_modules/@anthropic-ai/sdk/client.js:74`). So with no key, the client is built with `apiKey: ''`,
the first request returns **401**, and `sanitizeAiError` maps that to `"authentication failed — check
your API key"`. The dedicated missing-key message is never emitted, yet `.env.example` and the
orchestrator's Pitfall-3 comment (line 49) promise `AI error: missing API key`.
**Why it matters:** Dead constant plus a documentation/behavior mismatch — an operator with no key gets
a misleading "authentication failed" message and the planned Pitfall-3 path is unimplemented.
**Fix:** Either implement the guard so the promise holds, or delete the dead constant and correct the
docs. Implementing it (preferred — clearer operator UX, avoids a doomed network round-trip):
```typescript
// ai-orchestrator.trigger(), after the empty-span guard, before assemblePrompt:
if (this.apiKeyMissing) {           // inject a boolean, or check a passed-in key length in index.ts
    const requestId = ++this.requestSeq;
    const id = String(requestId);
    this.history.append({ id, mode, text: MISSING_KEY_TEXT, kind: 'error' });
    this.pushAi({ type: 'error', requestId, id, text: MISSING_KEY_TEXT });
    return;
}
```
Or, if 401-mapping is deemed sufficient, remove `MISSING_KEY_TEXT` and fix the `.env.example` copy and
the line-49 comment to say "authentication failed — check your API key".

### WR-04: Renderer drops `delta`/`done`/`error` events whose entry id is unknown — no resilience path

**File:** `src/renderer/src/components/ai-panel.tsx:79-86`
**Issue:** The `delta`, `done`, `error`, and `cancelled` reducer cases `entries.map(...)` over the
current list and only update an entry whose `id` matches. If no entry with that id exists (the
`thinking`/`empty` push that would have created it was missed — e.g. dropped during a renderer reload,
HMR, or the WR-01 clear-mid-stream race), the event is **silently discarded** and the entry is never
created. There is no fallback that synthesizes the entry from a terminal event.
**Why it matters:** A missed leading event makes the whole response invisible with no error surfaced —
the renderer cannot self-heal from the main-owned authoritative state because the 05-01
`history-snapshot` reconciliation push is still a no-op (`pushHistorySnapshot`,
`ai-orchestrator.ts:334-337`). Compounds WR-01.
**Fix:** Make terminal/delta events self-healing — if no matching entry exists, append one rather than
dropping. For `delta`/`done`/`error`, fall through to a create when `entries.every((e) => e.id !== event.id)`.
The robust long-term fix is landing the deferred `history-snapshot` reconciliation so the renderer can
re-sync to main's authoritative list; until then, add the append-on-miss fallback.

## Info

### IN-01: `done` with empty final text and no accumulated deltas renders a blank entry body

**File:** `src/main/ai/ai-orchestrator.ts:218` + `src/renderer/src/components/ai-panel.tsx:103-113`
**Issue:** On `done`, `text = finalText.length > 0 ? finalText : this.active.text`. If the model returns
an empty completion and no deltas were accumulated, `text` is `''`; the renderer's `renderEntryBody`
default branch then renders an empty `<p>`. The entry shows a mode header and relative time with no
body — indistinguishable from a rendering glitch.
**Why it matters:** Minor UX confusion on a rare empty completion; not a correctness failure.
**Fix:** Substitute a placeholder when the resolved text is empty, e.g.
`const text = (finalText || this.active.text).trim() || '(no response)';`.

### IN-02: AI-panel scroll step uses a magic line-height that must stay in sync with CSS

**File:** `src/renderer/src/components/ai-panel.tsx:170` and `src/renderer/src/components/debug-hud.tsx:115`
**Issue:** `const lineStep = 3 * 18;` hard-codes an 18px line height in two components. The actual line
height is governed by CSS (`line-height: 1.5; font-size: 12px` → 18px today). If the CSS font-size or
line-height changes, the scroll step silently drifts out of sync with the rendered line height.
**Why it matters:** Maintainability — a magic number duplicated across two files, coupled to a CSS
value with no enforced link. Low risk, but a latent drift hazard.
**Fix:** Hoist to a shared named constant (e.g. `AI_SCROLL_LINE_STEP_PX`) with a comment tying it to the
CSS line height, or read `element.style`/computed line height. At minimum, a single shared constant.

### IN-03: `formatRelativeTime` is duplicated logic that belongs in the shared utility module

**File:** `src/renderer/src/components/ai-panel.tsx:50-60`
**Issue:** `formatRelativeTime` is an inline pure presentation function in the component, while the
sibling presentation helper `formatUptime` lives in its own `.utility.ts` with a test. Per the IDEXX
component-architecture standard, pure reusable formatting belongs in a `.utility.ts` (idempotent, no
side effects), and the project already follows that pattern for `format-uptime.utility.ts`.
**Why it matters:** Consistency with the established utility pattern and testability — the relative-time
formatter has boundary cases (`< 1s` → "now", the `< 60s` boundary, minute rounding) that warrant a unit
test like `format-uptime.utility.test.ts` has.
**Fix:** Extract to `src/renderer/src/components/format-relative-time.utility.ts` with explicit return
type and a matching `.test.ts`, mirroring `formatUptime`.

---

_Reviewed: 2026-06-18_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
