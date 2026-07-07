# Roadmap: Jedi Interviews

## Overview

Jedi Interviews is built dependency-first: the two existential, version-coupled Electron behaviors (never steal focus, invisible to screen share) are proven on the real machine before any feature exists, then keyboard control, then an isolated audio-loopback go/no-go spike, then the live STT transcript, then the first AI value (answer + talking points), then the grounding context store and settings window, and finally screenshot vision plus production packaging and hardening. Every phase produces a runnable, testable increment, and each load-bearing risk is surfaced and resolved before the work that depends on it is written.

**Milestone v1.1 — Structured Q/A Panel (Phases 8–9):** Turn the flat-text Q/A panel into structured, speaker-attributed cards. The data/seam layer lands first — Deepgram diarization + utterance segmentation, a session-long stable speaker map, and a local question-vs-statement heuristic, all carried through the existing `ISttProvider` seam so consumers stay backend-agnostic — then the card-based Q/A redesign is built in place on top of that structured stream.

**Milestone v1.2 — Auto-Answer for Detected Questions (Phases 10–12):** Close the loop from the v1.1 Q/A stream to the v1 AI answer path — when the classifier tags a live utterance as a question, automatically fire the same grounded answer `Ctrl+Alt+A` produces today, streamed into the *existing* AI panel. Built enabler-first: the orchestrator's single-in-flight "drop if busy" guard is replaced by a **priority queue** (manual preempts auto; nothing cancels an in-flight stream) with a debounce so a burst never spawns parallel Claude calls — the backend layer everything else feeds. Then the auto-trigger is wired from the `on('utterance')` classification into that queue and streamed into the existing AI panel. Then a single 3-state scope hotkey (**All → Directed-at-me → Off**, default All) plus an overlay mode indicator and a local, no-AI "directed-at-me" heuristic gate *which* questions auto-answer. Question **detection stays AI-free** throughout — it reuses/extends the v1.1 QA-03 heuristic in `src/main/stt/`; only **answer generation** is the AI call. **Deliberate constraint reversal:** this milestone reverses the v1 CLAUDE.md/PROJECT.md constraint *"AI calls are user-triggered only."* Auto-answers now fire off the live transcript stream, bounded by debounce + single-in-flight + the **Off** mode rather than by requiring a keypress. This supersedes the v2 item **AI-V2-01** ("auto-detect; suggest, never answer") — v1.2 answers, under user-controlled scope. Everything reuses the existing AI orchestrator, grounding path (AI-06, Phase 6), AI panel, and one-way `jedi:ai` / `jedi:status` push channels; no new panel and no new renderer→main control channel for the answer itself.

## Phases

**Phase Numbering:**

- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Overlay Shell + Existential Behaviors** - Transparent, non-focus-stealing, screen-share-invisible overlay on a pinned, on-machine-verified Electron build, with the secret/IPC boundary wired. (completed 2026-06-17)
- [x] **Phase 2: Global Hotkeys + Window Control** - Keyboard-only show/hide, move, and opacity control that works while a real meeting app holds focus, with registration failures surfaced. (completed 2026-06-17)
- [x] **Phase 3: Audio Loopback Spike** - Isolated go/no-go proof that system-audio loopback produces real, non-silent audio on the target machine. (completed 2026-06-17)
- [x] **Phase 4: STT Pipeline + Live Transcript** - Live rolling transcript with interim/final results, auto-reconnect, bounded buffer, and a swappable STT provider seam.
 (completed 2026-06-18)
- [x] **Phase 5: AI Orchestration (Answer + Talking Points)** - Streaming, keyboard-scrollable AI answers and talking points drawn from the recent transcript.
- [x] **Phase 6: Session Context + Settings Window** - A focusable settings window for API keys and a persisted context editor that grounds every AI prompt. (completed 2026-06-19)
- [x] **Phase 7: Screenshot Vision + Packaging & Hardening** - Screenshot-driven code-challenge solving and a runnable Windows .exe with transparency, focus discipline, and content protection intact. (completed 2026-06-19)
- [x] **Phase 8: Diarized Utterance Pipeline** - Per-speaker utterances with a stable `Person N` map and a local Question/Statement tag, all riding the existing STT provider seam. *(milestone v1.1)* (completed 2026-07-07 -- 8/8 verified; 2 live human-UAT items pending, see 08-HUMAN-UAT.md)
- [x] **Phase 9: Card-Based Q/A Panel Redesign** - The Q/A panel rebuilt in place as per-utterance cards (`Q1 - Person 1` / `S3 - Person 2`), questions visually distinct, with a compact people list. *(milestone v1.1)*
 (completed 2026-07-07)
- [ ] **Phase 10: Priority Answer Queue** - Replace the orchestrator's single-in-flight "drop if busy" guard with a priority queue (manual preempts auto, nothing cancels an in-flight stream) plus debounce + single-in-flight so a burst never spawns parallel Claude calls. *(milestone v1.2)*
 (verification: gaps_found — D-11 late-delta bleed open)
- [ ] **Phase 11: Auto-Answer Trigger** - Wire classified questions from the live utterance stream into the priority queue as auto-answers that stream token-by-token into the existing AI panel, grounded exactly like a manual answer. *(milestone v1.2)*
- [ ] **Phase 12: Scope Hotkey + Directed-at-Me** - A single 3-state scope hotkey (All → Directed-at-me → Off) with an overlay mode indicator, plus a local no-AI directed-at-me heuristic that narrows auto-answering in that mode. *(milestone v1.2)*

## Phase Details

### Phase 1: Overlay Shell + Existential Behaviors

**Goal**: A transparent, frameless, always-on-top overlay that never steals focus and is absent from screen share, running on a pinned and on-machine-verified Electron build, with the API-key security boundary established before any feature code.
**Mode:** mvp
**Depends on**: Nothing (first phase)
**Requirements**: OVL-01, OVL-02, OVL-04, OVL-06, SET-03
**Success Criteria** (what must be TRUE):

  1. The overlay renders transparent, frameless, and always-on-top over all other windows.
  2. While the overlay is visible and being controlled, the active meeting app's title bar never loses its focused (active) state — the overlay is `focusable:false` and shown only via `showInactive`.
  3. In a real screen-share self-test, the overlay is fully absent (not a black rectangle), and content protection is re-applied after every show.
  4. All of behaviors 1-3 are verified on the target Windows 11 machine against the pinned Electron 35.x patch version, and that version is recorded in the repo.
  5. The contextIsolation/sandbox/typed-preload boundary and `safeStorage` are wired so no secret can reach the renderer, logs, or committed files — verified by a placeholder round-trip.

**Plans**: 4 plans

Plans:
**Wave 1**

- [x] 01-01-PLAN.md — Scaffold electron-vite + TS + React (main/preload/renderer), ESM, exact-pin electron@35.7.5 + lockfile, contextIsolation/sandbox/typed-preload boundary, IDEXX lint/format

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 01-02-PLAN.md — Overlay WindowManager (transparent/frameless/always-on-top/focusable:false) + showOverlay() content-protection re-apply wrapper + read-only status channel + toggleable debug HUD (OVL-01/02/04)
- [x] 01-03-PLAN.md — Main-only safeStorage placeholder round-trip + `npm run verify:secret` PASS/FAIL; no renderer/IPC secret channel (SET-03)

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 01-04-PLAN.md — GO/NO-GO gate: on-machine focus + screen-share content-protection verification, committed VERIFICATION.md with exact pinned Electron patch, minimal packaged .exe transparency smoke (OVL-06)

**Notes**: GO/NO-GO GATE. "Verified on this machine" is the acceptance criterion, not an optional check (research flag: Phase 1 empirical). Start with the latest 35.x patch, verify BOTH content protection (no black box) AND that focus is never stolen, then pin and record the exact version; 35.0.1 is known-broken for content protection and the 40.x line for loopback. This phase also runs one early packaged smoke test purely to de-risk transparency rendering — the full PKG-01 packaging requirement is owned by Phase 7.

### Phase 2: Global Hotkeys + Window Control

**Goal**: The complete keyboard-only control loop — show/hide, move, and opacity — operating globally while a meeting app holds focus, with hotkey registration failures detected and surfaced.
**Mode:** mvp
**Depends on**: Phase 1
**Requirements**: OVL-03, OVL-05, CTL-01, CTL-02, CTL-03
**Success Criteria** (what must be TRUE):

  1. The user can show and hide the overlay by global hotkey while another application holds focus, and content protection is re-applied on every show.
  2. The user can move the overlay around the screen using only the keyboard.
  3. The user can raise and lower the overlay's opacity by keyboard.
  4. Global hotkeys fire while a real meeting app (e.g. Teams or Zoom) is the focused window, without stealing that app's accelerators.
  5. A hotkey that fails to register or conflicts is detected and surfaced to the user, never silently dropped.

**Plans**: 3 plans

Plans:

**Wave 1**

- [x] 02-01-PLAN.md — HotkeyRegistrarService via uiohook-napi (globalShortcut fallback): native install+rebuild, register()-result checking, Hotkeys: status line in the HUD (CTL-02, CTL-03)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 02-02-PLAN.md — WindowControlActionsService wired through the registrar: show/hide via showOverlay, 50px clamped move across monitors, 10% opacity steps, HUD toggle, quit (OVL-03, OVL-05, CTL-01)

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 02-03-PLAN.md — Conflict testing against Teams/Zoom/VS Code on the target machine; finalize the default Ctrl+Alt chord set (CTL-02, OVL-05, OVL-03, CTL-01)

**Notes**: Check the `register()` return from the first hotkey written. If the uiohook-napi native rebuild proves difficult on this machine, fall back to globalShortcut with conflict detection (research flag: Phase 2 evaluate rebuild). Standard patterns — no deeper research needed.

### Phase 3: Audio Loopback Spike

**Goal**: Prove, in isolation, that Electron system-audio loopback produces real non-silent audio on the target machine — a go/no-go gate before any STT code is written.
**Mode:** mvp
**Depends on**: Phase 2
**Requirements**: AUD-01, AUD-02
**Success Criteria** (what must be TRUE):

  1. The app captures the computer's system (loopback) audio via `setDisplayMediaRequestHandler` + `getDisplayMedia` with `video:true` present (the video track is discarded).
  2. A live RMS meter shows a non-zero signal while system audio plays, confirming the capture is not silent — verified on the target Windows 11 machine and the pinned Electron version from Phase 1.
  3. The spike result is recorded as a documented decision: proceed with built-in loopback, or trigger the WASAPI-sidecar fallback.

**Plans**: 2 plans

Plans:

**Wave 1**

- [x] 03-01-PLAN.md — Loopback capture seam + AudioWorklet RMS + live Audio: HUD row wired end-to-end via jedi:status; auto-start no-picker capture; unit-tested RMS utility (AUD-01)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 03-02-PLAN.md — On-machine human-judged two-source (general media + Teams/Zoom) go/no-go verification; committed 03-LOOPBACK-GATE.md + decision logged in STATE.md/PROJECT.md (AUD-02)

**Notes**: GO/NO-GO GATE. Loopback silence is the single biggest technical risk (research flag: Phase 3 spike gate). Keep this phase small and gate-like. `getDisplayMedia` with `audio:true, video:false` throws on Windows — `video:true` must be present. If the result is silence, the WASAPI-sidecar fallback changes the build plan for Phase 4. Do not start Deepgram integration until this gate passes.

### Phase 4: STT Pipeline + Live Transcript

**Goal**: A live rolling transcript on the overlay, streamed through a swappable provider seam, that survives dropped connections and never grows unbounded.
**Mode:** mvp
**Depends on**: Phase 3
**Requirements**: TRN-01, TRN-02, TRN-03, TRN-04, TRN-05
**Success Criteria** (what must be TRUE):

  1. Captured audio is streamed to Deepgram and a live transcript updates on the overlay.
  2. The transcript shows interim (partial) results that resolve into final results as they arrive.
  3. If the STT connection drops mid-session it reconnects automatically with backoff, and connection state is visible on the overlay.
  4. The user can clear the transcript by hotkey, and the buffer is automatically capped to a bounded size.
  5. Speech-to-text is reached only through an `ISttProvider` interface, so the Deepgram backend can be swapped (e.g. for local Whisper) without touching consumers.

**Plans**: 4 plans

Plans:

**Wave 1**

- [x] 04-01-PLAN.md — Capture go/no-go gate (native-recorder-nodejs, OQ-1) + ISttProvider seam + pure PCM resample/rate-assert utility (TRN-01, TRN-05) — GO (RMS 0.10-0.35, 48kHz/2ch/16-bit); 04-04 must target the active output device, not isDefault, and install with --ignore-scripts

**Wave 2** *(blocked on 04-01)*

- [x] 04-02-PLAN.md — DeepgramSttGateway implements ISttProvider: Deepgram v5 live client, interim/final, reconnect+backoff, keep-alive, key main-only (TRN-01, TRN-02, TRN-03, TRN-05)
- [x] 04-03-PLAN.md — Time-bounded TranscriptBuffer (hard memory ceiling) + clear-transcript Ctrl+Alt chord via HotkeyRegistrarService (TRN-04)

**Wave 3** *(blocked on 04-02 + 04-03)*

- [x] 04-04-PLAN.md — Wire capture→resample→gateway→buffer→jedi:transcript push + DebugHud render (interim distinct) + retire dead renderer audio path (D-02/IN-01, WR-01/02/03) + live verify (TRN-01..TRN-04)

**Notes**: Define `ISttProvider` and `DeepgramSttGateway` here, before anything else depends on STT output — the seam is cheap now and a rewrite later. Use Deepgram v5 (DeepgramClient, listen.v1.connect, sendMedia); ignore v3/v4 tutorials. Use AudioWorklet, not ScriptProcessorNode; assert that the declared sample rate equals the actual PCM rate.

### Phase 5: AI Orchestration (Answer + Talking Points)

**Goal**: The first real user value — on hotkey, a streaming AI answer or set of talking points drawn from the recent transcript, readable in the flow of conversation without leaving the meeting.
**Mode:** mvp
**Depends on**: Phase 4
**Requirements**: AI-01, AI-02, AI-04, AI-05
**Success Criteria** (what must be TRUE):

  1. By hotkey, the user gets an AI answer to an interview question drawn from the recent transcript span.
  2. By hotkey, the user gets AI-suggested talking points about the project work being discussed, drawn from the recent transcript span.
  3. AI responses stream token-by-token to the overlay (append-only, debounced) and are readable as they arrive.
  4. Responses longer than the visible overlay are fully readable via keyboard scrollback.
  5. Re-pressing a mode hotkey cancels an in-flight stream cleanly.

**Plans**: 3 plans

Plans:

**Wave 1**

- [x] 05-01-PLAN.md — End-to-end Answer slice: @anthropic-ai/sdk + Wave-0 test stubs, IAiGateway/AnthropicGateway, pure PromptAssembler (empty D-13 context slot), bounded AiHistory, single-in-flight AiOrchestrator (empty-span + request-id guards, debounced deltas), jedi:ai channel + always-on AiPanel, Ctrl+Alt+A (AI-01, AI-04)

**Wave 2** *(blocked on 05-01)*

- [x] 05-02-PLAN.md — Talking-points mode (Ctrl+Alt+T → Opus, 3-5 bullets), clear-AI chord (Ctrl+Alt+G), full new-chord 02-03 conflict re-test vs Teams/Zoom/VS Code (AI-02)

**Wave 3** *(blocked on 05-01 + 05-02)*

- [x] 05-03-PLAN.md — Focused-panel scrollback: main-owned activePanel flag + corner indicator + Ctrl+Alt+F cycle + active-panel-routed PgUp/PgDn, cross-mode cancel-current-start-new, hotkey→first-token latency logging (AI-05, D-07, D-08, D-10)

**Notes**: Confirm current claude-haiku-4-5 / claude-opus-4-8 model IDs and the streaming API shape via the claude-api skill at implementation time (research flag: Phase 5 API shape). AI-06 (grounding) is partially exercised here via the transcript span but is only fully satisfied once the Session Context store exists in Phase 6 — AI-06 is mapped to Phase 6. Trigger on a bounded recent finalized window to control latency and context bloat.
**UI hint**: yes

### Phase 6: Session Context + Settings Window

**Goal**: A focusable settings window that hosts API-key entry and a persisted context editor, with the active context injected into every AI prompt so output is grounded in the real work.
**Mode:** mvp
**Depends on**: Phase 5
**Requirements**: CTX-01, CTX-02, CTX-03, CTX-04, SET-01, SET-02, SET-04, AI-06
**Success Criteria** (what must be TRUE):

  1. The user can open a separate, normal focusable settings window by hotkey and enter/save Deepgram and Anthropic API keys (encrypted at rest via safeStorage).
  2. The user can paste and edit project context — notes, ticket text, repo snippets, reference links — in a dedicated editor reachable from that settings window.
  3. The session context persists locally across app restarts.
  4. Every AI call (all available modes) is grounded in the active session context plus the relevant transcript span, and the grounding improvement is observable versus Phase 5.
  5. The context store is structured (ULID-keyed `ISessionContextDto`) so a future URL-fetcher can populate it without a schema redesign.

**Plans**: 4 plans

Plans:

**Wave 1**

- [x] 06-01-PLAN.md — Focusable settings window + two-key safeStorage store + Ctrl+Alt+S chord + boot key precedence (D-08) + multi-renderer/preload build wiring + headless key round-trip (SET-01, SET-02)
- [x] 06-02-PLAN.md — SessionContextRepository over electron-store (ULID-keyed ISessionContextDto, activeAsGrounding/saveActive) + pure parseLinks utility + ulid dep (CTX-01, CTX-02, CTX-04)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 06-03-PLAN.md — Two-tab settings editor UI (Context landing + Keys), four fields, dirty indicator, explicit Save (CTX-01, SET-02, SET-04)
- [x] 06-04-PLAN.md — Inject active context into the orchestrator at trigger time (D-10) + live re-key both gateways (D-07) + fully wire the settings:* IPC handlers (CTX-02, CTX-03, AI-06, SET-02)

**Notes**: The overlay is `focusable:false` and cannot host text inputs, so key entry and context editing must live in this separate focusable window (avoids the focus-stealing pitfall). Design the `ISessionContextDto` schema for multiple named contexts from day one even though v1 ships one. Standard patterns — electron-store + contextBridge IPC are mature.
**UI hint**: yes

### Phase 7: Screenshot Vision + Packaging & Hardening

**Goal**: The third AI mode — screenshot a code challenge and get an AI solution — plus a runnable, hardened Windows executable on which transparency, focus discipline, and content protection still hold.
**Mode:** mvp
**Depends on**: Phase 6
**Requirements**: AI-03, PKG-01
**Success Criteria** (what must be TRUE):

  1. By hotkey, the user takes a screenshot and gets a streaming AI solution to the code challenge shown in it, grounded in the active session context.
  2. The overlay is excluded from its own screenshot, and the captured image is downscaled to ≤1568px long edge before being sent (vision/Opus routing).
  3. The app builds to a runnable Windows .exe on which transparency, focus discipline, and content protection still hold on the target machine.
  4. Latency is instrumented (hotkey→first-token budget) and SmartScreen behavior is documented as accepted friction.

**Plans**: 3 plans

Plans:

**Wave 1**

- [x] 07-01-PLAN.md — Vision slice: ScreenshotService (desktopCapturer active-monitor capture) + pure downscale utility (<=1568px, no data: prefix); optional image field on IAiPromptRequest + PromptAssembler image branch + VISION_SYSTEM_PROMPT; CODE_CHALLENGE_MODEL=claude-opus-4-8; Ctrl+Alt+C chord; dedicated vision panel + three-way focus cycle (AI-03)

**Wave 2** *(blocked on 07-01)*

- [x] 07-02-PLAN.md — Packaging slice: electron-builder portable .exe + asarUnpack globs for both native modules; on-machine GO/NO-GO gate (transparency/focus/content-protection + end-to-end screenshot-solve) + committed 07-VERIFICATION.md (PKG-01)

**Wave 3** *(blocked on 07-01 + 07-02)*

- [x] 07-03-PLAN.md — Hardening slice: vision latency instrumentation + opt-in JEDI_DISABLE_GPU hardware-accel fallback + hardened CTL-03 hotkey recovery + docs/HARDENING.md SmartScreen friction (Whisper stub DROPPED, D-16) (PKG-01)

**Notes**: Vision mode reuses the entire Phase 5 AI path; it adds only an image source and an Opus model switch, so it is last among features and the most expensive per call. Confirm the current Anthropic vision request shape and model IDs via the claude-api skill (research flag: Phase 7 API shape). Base64 image field must have no data-URL prefix. PKG-01 is fully owned here; the Phase 1 packaged smoke test only de-risked transparency rendering. Standard patterns for electron-builder NSIS.
**UI hint**: yes

### Milestone v1.1: Structured Q/A Panel (Phases 8-9) — ✅ SHIPPED 2026-07-07

Full phase details archived to [`.planning/milestones/v1.1-ROADMAP.md`](milestones/v1.1-ROADMAP.md).

- **Phase 8: Diarized Utterance Pipeline** (3 plans) — QA-01/02/03/07. Deepgram diarization + utterance segmentation, stable session-scoped `Person N` map, local Question/Statement heuristic, all through the `ISttProvider` seam. Code-verified; 2 live human-UAT items deferred (see STATE.md Deferred Items).
- **Phase 9: Card-Based Q/A Panel Redesign** (2 plans) — QA-04/05/06. Q/A panel rebuilt in place as per-utterance cards (`Q1 - Person 1` / `S3 - Person 2`), questions visually distinct, compact people-list color legend, interim ghost card, empty-state placeholder. 5/5 must-haves verified; both live checkpoints approved; threats 6/6 closed (09-SECURITY.md).

### Phase 10: Priority Answer Queue

**Goal**: Replace the AI orchestrator's single-in-flight "drop if busy" guard with a priority answer queue so an auto-answer and a manual answer can both be requested without racing: a manual `Ctrl+Alt+A` request preempts queued auto-answers, neither an auto nor a manual request cancels an in-flight stream, and a burst of requests is debounced + run single-in-flight so it never spawns parallel Claude calls. This is the enabling backend layer for the rest of v1.2 — the queue must exist before auto-answers can feed it — and it is delivered as a pure orchestrator refactor with no auto-trigger source yet (a test/manual double-press proves the queue behavior).
**Mode:** mvp
**Depends on**: Phase 9 (v1.1 complete), Phase 5/7 (the `AiOrchestrator` this refactors)
**Requirements**: AA-05, AA-06
**Success Criteria** (what must be TRUE):

  1. When one answer is already streaming and another answer request arrives, the second request is **enqueued** (not dropped, as today's `active !== undefined` guard does) and runs in order when the current stream finishes — verified by a unit test that fires two requests and observes both stream to completion in sequence.
  2. A **manual** `Ctrl+Alt+A` request placed while auto-answers are queued jumps ahead of those queued auto-answers (priority), but does **not** abort or cancel the answer currently streaming — the in-flight stream always finishes first, then the manual request runs next.
  3. A rapid burst of enqueue requests within a short debounce window collapses so that at most **one** Claude call is ever in flight at a time and duplicate/near-duplicate rapid requests do not each spawn a call — verified by a unit test asserting the gateway `stream()` is invoked the bounded number of times, never in parallel.
  4. The existing manual flows are unchanged from the user's point of view: a single `Ctrl+Alt+A` / `Ctrl+Alt+T` / `Ctrl+Alt+C` press still produces exactly the same grounded, streamed result it does today (the queue with one item behaves identically to the old single-in-flight path); talking-points and code-challenge modes still route through the orchestrator unchanged.
  5. The queue is bounded (a hard cap on pending items) so a long silence-free meeting can never grow the queue without limit; overflow is dropped oldest-auto-first, and manual requests are never dropped.

**Threat Model**:
- **Cost blowout / parallel calls (AA-06):** the whole point of the queue is a single-in-flight execution gate; a bug that lets two `stream()` calls overlap = double Claude spend. Mitigation: single-in-flight invariant is unit-tested by asserting `stream()` call count and non-overlap; the debounce collapses bursts before they reach the gateway.
- **Unbounded queue growth:** a meeting that never goes quiet could enqueue faster than answers drain. Mitigation: hard cap + drop-oldest-auto eviction (SC 5); manual requests exempt from eviction.
- **Manual starvation:** if auto-answers always jumped the queue in FIFO order, a manual press could wait behind a backlog. Mitigation: manual requests are inserted at queue **head** (priority), ahead of all queued auto items.
- **Late-delta bleed across queued requests:** the existing Pitfall-1 request-id guard must survive the refactor — a finished/aborted request's late gateway deltas must never attach to the next queued entry. Mitigation: preserve the monotonic `requestId` guard on every gateway handler; add a regression test.
- **Regression of the existing single-in-flight cancel semantics:** Phase 5's "re-press same mode cancels" (D-06) and cross-mode behavior must be reconciled with "nothing cancels an in-flight stream." Mitigation: this phase explicitly re-specifies cancel semantics for v1.2 (manual re-press no longer aborts an in-flight auto-stream; it enqueues) and documents the decision so downstream planning does not reintroduce the old abort.

**Plans**: 2 plans

Plans:

**Wave 1**

- [x] 10-01-PLAN.md — Refactor AiOrchestrator into a two-lane priority queue: enqueue-not-cancel semantics (D-01/02/03), single-in-flight run loop + mode-keyed burst debounce (AA-06), bounded cap + drop-oldest-auto eviction (AA-05); tests-first, dormant abort machinery preserved (D-12)
- [ ] 10-02-PLAN.md — Gap closure (D-11): thread the reserved requestId through the gateway seam and positively guard all four handlers (text/done/error/abort) so a superseded stream's late/duplicate event can never bleed into the next queued entry; proven by a two-request-in-sequence regression test (CR-01/WR-01)

### Phase 11: Auto-Answer Trigger

**Goal**: Close the loop — when the live utterance stream classifies a turn as a question (the v1.1 QA-03 `classification: 'question'` tag), automatically enqueue an answer request into the Phase 10 priority queue so the same grounded answer content the manual `Ctrl+Alt+A` path produces (active Session Context + recent transcript span, AI-06) streams token-by-token into the **existing** AI panel — no keypress, no new panel, no new renderer→main control channel. The auto-trigger is a main-side wiring on the existing `gateway.on('utterance')` binding; it reuses the orchestrator, the grounding path, and the one-way `jedi:ai` push channel exactly as the manual path does.
**Mode:** mvp
**Depends on**: Phase 10 (the priority queue that auto-answers feed)
**Requirements**: AA-01, AA-02
**Success Criteria** (what must be TRUE):

  1. When an utterance arrives with `classification: 'question'`, an answer request is automatically enqueued with **no keypress**, and its answer streams into the AI panel — verified live in a meeting and by a unit test that feeds a classified-question `IUtteranceEvent` and observes an answer request enqueued.
  2. The auto-generated answer is the **same content** the manual `Ctrl+Alt+A` path produces: same answer mode, same model, and grounded in the active Session Context + the recent transcript span (AI-06) — assembled through the existing `assemblePrompt` path, not a new prompt.
  3. The answer streams token-by-token into the **existing** AI panel using the same `jedi:ai` push + rendering as a manual answer; no new panel and no second AI surface is introduced.
  4. Utterances classified as `statement` never trigger an auto-answer (only `question` does), and question **detection introduces no per-utterance AI call** — it consumes the existing local QA-03 classification, so cost stays on answer generation only.
  5. An auto-answer and a manual answer coexist correctly through the Phase 10 queue: a manual `Ctrl+Alt+A` pressed while auto-answers are queued still preempts them, and a burst of detected questions is debounced + single-in-flight (no parallel calls) — the Phase 10 guarantees hold with a real auto-trigger driving them.

**Threat Model**:
- **Reversal of "AI calls are user-triggered only" (deliberate):** this is where the v1 constraint is actually reversed — answers now fire off the transcript stream. Mitigation is by design: cost is bounded by the Phase 10 debounce + single-in-flight + the Phase 12 **Off** mode; documented in the milestone overview and PROJECT.md as a deliberate, superseding decision (supersedes AI-V2-01).
- **Answer spam / cost from chatty meetings:** every classified question auto-answering could be noisy and expensive. Mitigation: Phase 10 debounce + bounded queue + single-in-flight; Phase 12 adds the scope narrowing (Directed-at-me) and the hard Off. In this phase, default scope is All (Phase 12 owns the gate) — so the debounce/queue must already be doing real work here.
- **Grounding drift vs the manual path:** if the auto path assembled its own prompt it could diverge from the manual answer. Mitigation: reuse the exact `assemblePrompt` + orchestrator answer path; a test asserts the auto request carries the same mode/model/grounding shape as a manual answer.
- **False-positive questions:** the QA-03 heuristic defaults borderline text to `statement`, so false questions are rare by design, but a mis-tag would spend a Claude call. Mitigation: accept the QA-03 default-to-statement bias as the guard; do not add AI to detection; the Off/Directed-at-me scopes (Phase 12) give the user a manual escape hatch.
- **Key-adjacent leakage on the auto path:** auto-answers hit the same gateway; the existing sanitize-error + main-only-key discipline must cover the auto path too. Mitigation: reuse the existing orchestrator error path (no new gateway call site); no auto-specific logging of transcript/key content.

**Plans**: TBD
**UI hint**: yes

### Phase 12: Scope Hotkey + Directed-at-Me

**Goal**: Give the user control over *which* questions auto-answer, via a single global hotkey that cycles auto-answer scope through three states — **All questions → Directed-at-me → Off** (default All) — with the current mode shown on the overlay, plus a local, no-AI "directed-at-me" heuristic (2nd-person cues: "you", the user's name, absence of another named addressee) that, in that scope, decides whether a detected question is aimed at the user so only those auto-answer. **Off** fully disables auto-answering for the session (for sensitive meetings). Question detection stays AI-free — the directed-at-me decision extends the local, pure, unit-tested utility pattern in `src/main/stt/` (alongside the QA-03 classifier); only answer generation is ever an AI call. The mode cycle is a new main-side hotkey handler and the indicator uses the existing status push pattern (like `activePanel` / `hudVisible`).
**Mode:** mvp
**Depends on**: Phase 11 (the auto-answer trigger this gates)
**Requirements**: AA-03, AA-04
**Success Criteria** (what must be TRUE):

  1. A single global hotkey cycles auto-answer scope **All → Directed-at-me → Off → All**, defaulting to **All** at session start, and the cycle works while a meeting app holds focus (like every other chord).
  2. The current scope is **visible on the overlay** at all times, pushed over the existing `jedi:status` channel using the same main-owned-flag / status-push pattern as `activePanel` and `hudVisible` — no new control channel.
  3. In **Off**, no question auto-answers at all — the auto-trigger from Phase 11 is fully suppressed for the session; the manual `Ctrl+Alt+A` path still works unchanged.
  4. In **Directed-at-me**, only questions the local heuristic judges as aimed at the user auto-answer (2nd-person cues such as "you", the user's configured name, and the absence of another named addressee); questions aimed at someone else do not — verified by a pure unit test over representative utterances. In **All**, every classified question auto-answers regardless of the heuristic.
  5. The directed-at-me decision adds **no per-utterance AI call** — it is a local pure function consistent with QA-03, and its result only gates the *answer* call; the heuristic itself never calls Claude.

**Threat Model**:
- **New-chord conflict with the meeting app (strong project pattern):** every new global chord in this project is conflict-checked on the target machine vs Teams/Zoom/VS Code (see Phases 2/5/6/7). The 3-state scope chord is new and MUST be re-checked on-machine — treat this as a human-verify GO/NO-GO item, not an assumption. Mitigation: pick a Ctrl+Alt chord, register through `HotkeyRegistrarService` (so `register()` failure surfaces via CTL-03), and run the standard on-machine conflict re-test before finalizing.
- **Off is not truly off (privacy for sensitive meetings):** if Off only hid the indicator but still fired answers, it would violate the whole point. Mitigation: Off must suppress the enqueue at the source (the Phase 11 auto-trigger checks scope before enqueuing); a test asserts zero `stream()` calls from the auto path while Off.
- **Directed-at-me false negatives/positives:** a heuristic that mislabels addressee could answer questions meant for others (noisy) or miss ones meant for the user. Mitigation: keep it a pure, unit-tested utility with representative cases; bias conservatively; accept that All mode is the fallback when the user wants everything, and the user's name is configurable to sharpen the 2nd-person cue.
- **User name as sensitive/PII in logs:** the directed-at-me heuristic reads the user's name; it must not leak into logs alongside transcript text. Mitigation: the name lives in the existing local config/context store, is used only in the pure heuristic, and is never logged (consistent with the existing no-transcript-logging discipline).
- **Mode indicator focus discipline:** the indicator renders on the `focusable:false` overlay and must not introduce any focusable element or new input. Mitigation: it is a read-only status view (like the existing HUD rows), pushed one-way; the mode-cycle input is a global hotkey, never an overlay control.

**Plans**: TBD
**UI hint**: yes

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Overlay Shell + Existential Behaviors | 4/4 | Complete   | 2026-06-17 |
| 2. Global Hotkeys + Window Control | 3/3 | Complete   | 2026-06-17 |
| 3. Audio Loopback Spike | 2/2 | Complete   | 2026-06-17 |
| 4. STT Pipeline + Live Transcript | 4/4 | Complete   | 2026-06-18 |
| 5. AI Orchestration (Answer + Talking Points) | 2/3 | In Progress|  |
| 6. Session Context + Settings Window | 4/4 | Complete   | 2026-06-19 |
| 7. Screenshot Vision + Packaging & Hardening | 3/3 | Complete   | 2026-06-19 |
| 8. Diarized Utterance Pipeline | 3/3 | Complete   | 2026-07-06 |
| 9. Card-Based Q/A Panel Redesign | 2/2 | Complete   | 2026-07-07 |
| 10. Priority Answer Queue | 1/1 | Complete   | 2026-07-07 |
| 11. Auto-Answer Trigger | 0/? | Not started | - |
| 12. Scope Hotkey + Directed-at-Me | 0/? | Not started | - |
