# Phase 5: AI Orchestration (Answer + Talking Points) - Context

**Gathered:** 2026-06-18
**Status:** Ready for planning

<domain>
## Phase Boundary

Deliver the first real user value: on a mode hotkey, a **streaming, keyboard-scrollable AI answer or set of talking points**, grounded in the **recent transcript span**, rendered on the overlay so it's readable in the flow of conversation — without the overlay ever taking focus. Covers requirements **AI-01** (answer a question from the recent transcript), **AI-02** (talking points about the project work being discussed), **AI-04** (token-by-token streaming render), **AI-05** (keyboard-scrollable output).

**Locked upstream (do NOT re-litigate):**
- **All AI orchestration runs in the Electron main process; the renderer is a pure one-way view.** The Anthropic SDK, prompt assembly, transcript-span read, and stream lifecycle live in main; the renderer only renders pushed AI text + state. No renderer→main control surface (Phase 1/4 boundary; IN-01).
- **`TranscriptBuffer.recentSince(ms)` is the span read API and already exists** (`src/main/stt/transcript-buffer.ts`). The buffer window is 90s (`WINDOW_MS`); Phase 5 reads a ~60s sub-span. Do not rebuild the buffer.
- **The Anthropic API key is sourced from an env var / local untracked dev config read in main only** — never in the renderer, never logged, never committed (honors SET-03; mirrors the Phase 4 Deepgram-key pattern D-08). Phase 6's `safeStorage`-backed key entry replaces the *source* later without touching the gateway.
- **Claude tiers:** `claude-haiku-4-5` (fast) and `claude-opus-4-8` (hard). Exact current model IDs and the streaming API shape (`messages.stream()`, `content_block_delta` / `text_delta`) are confirmed via the **`claude-api` skill at research/build time** (ROADMAP research flag: "Phase 5 API shape").
- **Session Context (CTX-01..04) is Phase 6, NOT here.** Phase 5 grounds on the transcript span only. **AI-06 (full grounding) is mapped to Phase 6**, not Phase 5 — but the prompt assembler is built WITH the context seam now (see D-13).
- **Hotkeys register through `HotkeyRegistrarService`** by adding `IHotkeyChord` entries to `HOTKEY_CHORDS` (`src/main/hotkey-registrar.service.ts`); a missing handler surfaces in `register().failed` (CTL-03). New chords get the 02-03-style Teams/Zoom/VS Code conflict re-check.
- The 3-plan ROADMAP shape (05-01 orchestrator+prompt+gateway / 05-02 mode hotkeys+span / 05-03 streaming render+scroll+cancel+latency log) is the agreed breakdown; planner refines.

</domain>

<decisions>
## Implementation Decisions

### AI Output Surface
- **D-01:** AI answers render in a **dedicated, always-on AI panel** on the overlay — a NEW content surface, NOT inside the `DebugHud` and NOT coupled to the HUD toggle (Ctrl+Alt+H). This is the "dedicated always-on content surface" Phase 4 explicitly deferred to Phase 5 (Phase 4 D-05). The AI answer is the product, so it stays visible regardless of the debug HUD state. The live transcript remains where it is (inside the toggleable HUD).
- **D-02:** The AI panel is a **bounded stacked history**: each request appends a new entry (newest at the bottom), so prior answers remain scrollable rather than being wiped on each request. History is bounded the way `TranscriptBuffer` is (last-N-entries and/or total-char ceiling) so it can never grow unbounded; planner sets the exact bounds. A clear-AI-history hotkey is in scope (mirrors the clear-transcript chord pattern) — planner picks the chord and conflict-tests it.
- **D-03:** **Each history entry has a small header** — the mode that produced it (`Answer` / `Talking points`) plus a relative time — and the panel **auto-scrolls (sticks) to the newest entry** while streaming, reusing the DebugHud `stickToBottomRef` follow/pause pattern (`debug-hud.tsx:72-107`): scrolling up via hotkey pauses auto-follow, returning to the bottom re-arms it.
- **D-04:** **In-flight and failure states live inline in the entry**, not in a separate status bar. A new entry shows a `thinking…` state until the first token, then streams text token-by-token. On error the entry shows a short inline message (e.g. `AI error: <reason>`). On cancel the entry is marked `(cancelled)`. Token append is **debounced** (~30–60ms, planner tunes) so high-frequency `text_delta` events don't spam the renderer — same rationale as the high-frequency interim-transcript push.

### Mode Hotkeys & Cancel
- **D-05:** Two new Ctrl+Alt mode chords added to `HOTKEY_CHORDS`: **`Ctrl+Alt+A` = Answer (AI-01)** and **`Ctrl+Alt+T` = Talking points (AI-02)**. `A`/`T` are outside the locked conflict-tested set {J, arrows, [, ], H, Q, K, PgUp, PgDn}; planner re-verifies both against Teams/Zoom/VS Code on the target machine (02-03 protocol) with a documented fallback if either collides. Both are `discrete` chords.
- **D-06:** **Re-pressing a mode chord while its own stream is in flight cancels that stream cleanly** (satisfies success criterion 5 literally — "re-pressing a mode hotkey cancels"). Same chord toggles start/cancel; no separate cancel chord.
- **D-07:** **Only one AI request is ever active at a time.** Pressing the *other* mode chord mid-stream **cancels the current stream and immediately starts the new one** (cancel-current-start-new). No concurrent API calls. Cancellation must abort the in-flight stream cleanly (planner uses the SDK's abort mechanism / `AbortController`).
- **D-08:** **AI-05 scrollback uses a focused-panel model.** There is a **main-owned "active panel" flag** (transcript vs AI panel), pushed to the renderer like `hudVisible` (the renderer stays a pure view). A new chord **`Ctrl+Alt+F` cycles focus** between the two panels (toggle for two panels; extensible later). A **small corner indicator** shows which panel is active. The existing **`Ctrl+Alt+PgUp/PgDn` scroll whichever panel is active**, replacing the Phase-4 "PgUp/PgDn always scroll the transcript" behavior. Default active panel on launch = **AI panel** (the product). Planner re-verifies `Ctrl+Alt+F` against Teams/Zoom/VS Code.

### Transcript Span & Model Routing
- **D-09:** Both modes read the **same ~60s recent finalized window** via `transcriptBuffer.recentSince(60_000)` (planner sets exact ms as a named constant). Matches the ROADMAP default and the 90s buffer window with headroom.
- **D-10:** **Per-mode model tiering, as a per-mode constant:** **Answer mode → `claude-haiku-4-5`** (quick, latency-first); **Talking points → `claude-opus-4-8`** (more synthesis, quality over a slightly higher latency). The model ID is a named per-mode constant so a mode can be re-tiered later (e.g. drop talking points to Haiku) without rework. **Latency watch:** if Opus first-token latency breaks the "in the flow of conversation" feel during the 05-03 latency logging, the planner/user may re-tier talking points to Haiku — flagged, not assumed.
- **D-11:** **Empty-span guard:** if the ~60s recent span is empty (silence or just-cleared buffer), **do NOT call the API.** Append a panel entry like `No recent transcript to act on` for immediate, zero-cost feedback. The empty check happens in main before the gateway call.

### Prompt Design & Context Seam
- **D-12:** **Two distinct system prompts, one per mode.** **Answer mode** produces a **direct, concise, spoken-style answer** (a few scannable sentences) and is instructed to **infer the most-recent question in the transcript span** (likely directed at the user) and answer it — no extra UI/marker needed. **Talking-points mode** produces **3–5 short bullet points** about the project work being discussed. Planner/researcher drafts both prompts, consulting the `claude-api` skill for streaming + prompt-shape best practices.
- **D-13:** **The prompt assembler is built WITH the Phase-6 context seam now (CTX-04), empty in Phase 5.** The assembler takes a **structured "grounding context" input** (the future notes / ticket text / repo snippets / links) **plus the transcript span**, and produces the final prompt. In Phase 5 the context input is empty/absent; Phase 6 fills it through the **same parameter** with no signature change at any call site. This mirrors how `ISttProvider` was defined before Deepgram existed — define the seam first, fill it later.

### Claude's Discretion
- **Exact debounce interval** for token append (D-04), **exact ~60s span value** (D-09), and the **AI-history bounds** (D-02) — planner picks grounded defaults as named constants.
- **AI-panel ↔ transcript height split** on the 460×700 overlay and the panel's exact styling/position (below the HUD per the agreed mock) — planner/UI decides; the overlay is `resizable:false` so layout is fixed.
- **Clear-AI-history chord letter** (D-02) and **`Ctrl+Alt+F` / `A` / `T` fallback letters** if any collide in the conflict re-check.
- **Cancellation mechanism** (`AbortController` vs SDK stream `.abort()`) per the `claude-api` skill (D-07).
- **Latency-logging format** for hotkey→first-token (ROADMAP 05-03) — planner chooses (likely a `console`/main-log line, never to the renderer).
- **AnthropicGateway interface shape** — lean: mirror the `ISttProvider`/`DeepgramSttGateway` precedent (a thin seam over `@anthropic-ai/sdk` with a streaming method emitting text deltas + done/error, key injected via constructor, never read from `process.env` inside the gateway).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope & requirements
- `.planning/ROADMAP.md` §"Phase 5: AI Orchestration (Answer + Talking Points)" — goal, the 5 success criteria (incl. #5 re-press-cancels), the 3 plans (orchestrator+prompt+gateway / mode hotkeys+span / streaming render+scroll+cancel+latency log), and the **Notes** (confirm Haiku/Opus IDs + streaming shape via the `claude-api` skill; AI-06 grounding is Phase 6; bounded recent finalized window to control latency/context bloat).
- `.planning/REQUIREMENTS.md` §"AI Assistance" — AI-01 (answer from recent transcript), AI-02 (talking points from recent transcript), AI-04 (token-by-token streaming render), AI-05 (keyboard-scrollable). **Note:** AI-03 (vision/code-challenge) is Phase 7 and AI-06 (full Session-Context grounding) is Phase 6 — out of scope here.
- `.planning/PROJECT.md` — Key Decisions (Claude Opus 4.8 hard / Haiku 4.5 fast, tiered for cost/quality; hotkey-driven AI triggers, no auto-detect; paste-based context store upgradeable later) and the focus-discipline / cost / privacy constraints.

### Stack & implementation guidance (READ for the SDK shape)
- **`claude-api` skill** — MUST be consulted at research/build time for current model IDs (`claude-opus-4-8`, `claude-haiku-4-5`), `client.messages.stream({ model, max_tokens, messages })`, consuming `content_block_delta` `text_delta` events for the streaming overlay, abort/cancel mechanics, and prompt-shape best practices (D-10/D-12/D-07). This is the authoritative source — ignore model/streaming details memorized elsewhere.
- `CLAUDE.md` (project root) §"@anthropic-ai/sdk" — `@anthropic-ai/sdk@0.104.2`, `messages.stream()` + SSE delta events; run in main (key out of the renderer). §"What NOT to Use" — keys never in the renderer; encrypt with `safeStorage` in main (the Phase-6 source swap). §Version Compatibility — pre-1.0 but API-stable.

### Prior-phase decisions this phase builds on
- `.planning/phases/04-stt-pipeline-live-transcript/04-CONTEXT.md` — the main-owns-IO/state + renderer-is-a-one-way-view boundary; D-05 (dedicated always-on content surface explicitly DEFERRED to Phase 5 — now D-01 here); the `ISttProvider` seam pattern (precedent for the AnthropicGateway seam and the D-13 context seam); the bounded-`TranscriptBuffer` pattern (precedent for the D-02 bounded AI history); D-08 env/dev-config key sourcing (precedent for the Anthropic key source).
- `.planning/phases/02-global-hotkeys-window-control/02-CONTEXT.md` + `02-HOTKEY-CONFLICT-TEST.md` — the `HotkeyRegistrarService`, the finalized conflict-tested Ctrl+Alt chord set, and the `register()`-result-checking / HUD-surfacing pattern the new `A`/`T`/`F`/clear-AI chords reuse and must be conflict-tested against (D-05/D-08).
- `.planning/phases/01-overlay-shell-existential-behaviors/01-CONTEXT.md` — the `contextIsolation`/`sandbox`/typed-preload boundary and the single read-only one-way push model the AI panel render extends.
- `.planning/STATE.md` §Accumulated Context — Phase 1 GO at Electron 35.7.5; the main-side native-module / by-convention-singleton precedents; the 04-* IPC and channel notes.

### Code to extend / build on (see code_context)
- `src/main/stt/transcript-buffer.ts` — `recentSince(ms)` is the Phase 5 span read (D-09); `renderable()` and the bounding logic are the templates for the bounded AI history (D-02).
- `src/main/overlay-window.manager.ts` — `TRANSCRIPT_CHANNEL`/`pushTranscript`/`SCROLL_TRANSCRIPT_CHANNEL`/`pushScrollTranscript` and the module-level main-owned flags (`hudVisible`, `isOverlayVisible`) are the templates for a new AI-output channel/push and the main-owned active-panel flag (D-01/D-08).
- `src/main/hotkey-registrar.service.ts` — `HOTKEY_CHORDS` is where `Ctrl+Alt+A`/`T`/`F` (and clear-AI) are added (D-05/D-08).
- `src/renderer/src/components/debug-hud.tsx` — the `onTranscript` subscribe + `stickToBottomRef` follow/pause + hotkey-scroll handler are the exact patterns the AI panel reuses (D-03/D-08); the AI panel is a NEW component/section rendered outside the HUD-toggle gate (D-01).
- `src/main/stt/stt-provider.interface.ts` + `deepgram-stt.gateway.ts` — the seam + thin-gateway precedent for `IAiGateway`/`AnthropicGateway` and the streaming-events shape (Claude's Discretion).
- `src/main/config/load-dotenv.utility.ts` — the existing env-loading utility for the Anthropic key source (D-08-equivalent).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`TranscriptBuffer.recentSince(ms)`** (`src/main/stt/transcript-buffer.ts:106`) — already returns the space-joined finalized text within a look-back window; the orchestrator calls it with ~60s (D-09). `renderable()` + `prune()` are the model for the bounded AI history (D-02).
- **`HotkeyRegistrarService` / `HOTKEY_CHORDS`** (`src/main/hotkey-registrar.service.ts`) — proven uiohook(+globalShortcut fallback) registrar; the new mode/focus/clear chords register exactly like the Phase 2/4 chords with `register().failed` surfacing (D-05/D-08).
- **`pushTranscript` / `TRANSCRIPT_CHANNEL` / `pushScrollTranscript` / `SCROLL_TRANSCRIPT_CHANNEL`** (`src/main/overlay-window.manager.ts:40-210`) — the one-way main→renderer push + teardown-guard pattern the AI-output push and the active-panel-focus push copy.
- **Main-owned-flag pattern** (`hudVisible`, `isOverlayVisible` with set/get + carried in `pushStatus`) — the template for the main-owned active-panel flag (D-08).
- **DebugHud transcript render** (`debug-hud.tsx:76-107`) — `onTranscript` subscribe (returns unsubscribe, cleaned up in `useEffect`), `stickToBottomRef` auto-follow/pause, and the `onScrollTranscript` hotkey handler — all reused by the AI panel (D-03/D-08).

### Established Patterns
- **Main owns IO/state; renderer is a pure one-way view.** Orchestrator, gateway, prompt assembly, span read, stream lifecycle, and the AI history all live in main; the renderer renders pushed AI entries + active-panel flag. No renderer→main control channel.
- **Seam-first, fill-later** (`ISttProvider` defined before Deepgram) — applied twice here: the `AnthropicGateway` behind a thin seam, and the prompt assembler's empty context slot (D-13).
- **Thin gateway over a vendor SDK** (`DeepgramSttGateway`) — constructor-injected key (never `process.env` inside the gateway), never logs/emits/IPCs the key, surfaces errors via events rather than throwing. The `AnthropicGateway` follows the same shape.
- **By-convention singletons** (no TSyringe in main) — orchestrator/gateway instantiated once in `index.ts`, like every other main service.
- **Bounded buffers with hard ceilings** (`TranscriptBuffer` time + segment + char bounds) — the AI history is bounded the same way (D-02).
- **`backgroundThrottling:false`** is already set — streaming continues while the overlay is unfocused (it always is).
- **Strict TS / IDEXX standards** — explicit return types, single quotes, 4-space, TSDoc on exports; co-located Vitest for unit-testable pieces (prompt assembler, empty-span guard, history bounding are unit-testable; live streaming is not).

### Integration Points
- **Mode hotkey (main) → AIOrchestrator (main) → reads `TranscriptBuffer.recentSince` (main) → PromptAssembly (main, empty context slot) → `AnthropicGateway` streaming (main) → AI-output push → AI panel render.** All main-side except the final push.
- **`AnthropicGateway` ← (Phase 6) → Session Context** fills the D-13 prompt-assembler context slot; ← (Phase 7) → vision/code-challenge reuses the entire AI path, adding only an image source + Opus switch (ROADMAP Phase 7 note).
- **New dependency:** `@anthropic-ai/sdk@0.104.2` — pure JS, runs in main. No native module (unlike `uiohook`/`naudiodon`), so no `@electron/rebuild` step.

</code_context>

<specifics>
## Specific Ideas

- **The overlay layout (agreed mock):** the existing HUD (status + live transcript, toggled by Ctrl+Alt+H) on top; a **dedicated, always-on AI answer panel** below it that streams the response and is never hidden by the HUD toggle. The AI panel is the product surface; the HUD is debug/reference.
- **Focused-panel scrolling is the user's explicit design:** rather than per-region scroll chords, there's one active panel at a time, `Ctrl+Alt+F` cycles which, a **corner indicator** shows the active panel, and the existing `Ctrl+Alt+PgUp/PgDn` scroll the active one. This keeps the chord count down while satisfying AI-05 for both regions.
- **Stacked AI history (not replace):** the user wants prior answers to remain scrollable with per-entry mode+time headers — a running log of what the AI produced this session, bounded so it can't grow forever.
- **Latency is a first-class concern:** Haiku for the answer path specifically to keep it "in the flow"; Opus reserved for the heavier talking-points synthesis, but flagged for re-tiering if the 05-03 latency logging shows Opus is too slow to feel live.
- This phase is the **first real user value** in the project — everything before it (overlay, hotkeys, capture, transcript) was scaffolding for this moment.

</specifics>

<deferred>
## Deferred Ideas

- **Session Context grounding (notes / ticket text / repo snippets / links injected into the prompt)** — Phase 6 (CTX-01..04, AI-06). The prompt-assembler context seam is built now (D-13) but left empty; no context-store code is written in Phase 5.
- **`safeStorage`-backed Anthropic/Deepgram key entry + settings window** — Phase 6 (SET-01/SET-02). Phase 5 uses an env/dev-config key source (D-08-equivalent).
- **Vision / code-challenge mode (screenshot → Opus solution)** — Phase 7 (AI-03). It reuses the entire Phase 5 AI path, adding only an image source and an Opus model switch; nothing vision-specific is built now.
- **Concurrent multi-mode streams** — rejected for v1 (D-07: single active request). Revisit only if a real need appears.
- **Per-mode span tuning (different look-back for answer vs talking points)** — considered, deferred; both use ~60s now (D-09). Easy to split later since the span is a per-call argument.
- **Auto-detecting questions and answering unprompted** — explicitly out of scope for v1 (PROJECT.md / REQUIREMENTS AI-V2-01); answer mode infers the latest question only when the user presses the hotkey (D-12).

### Reviewed Todos (not folded)
None — no pending todos matched this phase (STATE.md "Pending Todos: None yet").

</deferred>

---

*Phase: 5-AI Orchestration (Answer + Talking Points)*
*Context gathered: 2026-06-18*
