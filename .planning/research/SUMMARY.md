# Project Research Summary

**Project:** Jedi Interviews
**Domain:** Windows Electron transparent always-on-top overlay -- system-audio loopback, streaming STT, on-demand grounded LLM assistance
**Researched:** 2026-06-16
**Confidence:** HIGH on core architecture, stack, and features; MEDIUM on Electron version compatibility for loopback + content protection (empirical verification required)

## Executive Summary

Jedi Interviews is a personal Windows desktop overlay that sits invisibly over meeting/interview apps, transcribes system audio in real time, and on hotkey delivers grounded AI answers, talking points, or code-challenge solutions -- all without ever stealing keyboard focus. Products in this category (Cluely, Aura-AI, Natively, Interview Coder) have converged on the same core architecture: a non-focusable always-on-top Electron window with OS-level screen-share exclusion, global-hotkey control, a streaming STT backend piped to an LLM, and pasted session context for grounding. The recommended approach is to build on electron-vite + React + TypeScript with Electron pinned to a known-good 35.x build, @deepgram/sdk v5 for streaming STT behind an ISttProvider interface, and @anthropic-ai/sdk for Claude streaming -- using tiered model routing (Haiku for fast paths, Opus for vision/code).

The two hardest problems are platform-level Electron behaviors, not application logic: (1) the overlay must never steal focus (focusable:false + showInactive -- must be proven in Phase 1 before any feature); and (2) content protection (setContentProtection(true)) must hide the overlay from screen share without showing a black rectangle -- a regression introduced in Electron 35.0.1 that demands deliberate version pinning and empirical verification on the target machine. The single largest technical risk after those two is system-audio loopback: the 40.x Electron line has a known silence regression, video:true must be present in the getDisplayMedia call even though the video track is discarded, and the behavior must be confirmed on the target machine in an isolated spike before the STT pipeline is built.

The recommended build order -- overlay shell, hotkeys, audio/STT, AI modes 1+2, session context, screenshot/vision, hardening -- is dependency-ordered so every phase produces a runnable, testable increment and each existential risk (focus-stealing, screen-share invisibility, loopback silence) is surfaced and resolved before the feature work that depends on it.

## Key Findings

### Recommended Stack

The project builds on electron-vite@5 (dev tooling with HMR), electron-builder@26 (packaging), and React 18 in the renderer. Electron version must be pinned. Research recommends Electron 35.x (a specific known-good patch build, not 35.0.1 which has a content-protection regression) and explicitly warns against the 40.x line (loopback silence regression). Only upgrade from 35.x after re-running the loopback + content-protection smoke tests.

The two supporting libraries with the most implementation nuance are @deepgram/sdk@5.4.0 (v5 is a full API redesign -- DeepgramClient, listen.v1.connect, sendMedia -- ignore v3/v4 tutorials) and uiohook-napi@1.5.5 (passive low-level hook, never fights meeting apps for accelerators, unlike globalShortcut which steals keys OS-wide and silently fails on conflicts). electron-store@11 (ESM-only) handles prefs and session context; safeStorage (Electron built-in DPAPI) handles API key encryption. AudioWorklet (not the deprecated ScriptProcessorNode) must be used for PCM conversion to avoid audio drops when AI is streaming.

**Core technologies:**
- **Electron 35.x (pinned, empirically verified):** overlay windows, loopback audio authorization, screenshot -- the version line is load-bearing, not advisory
- **electron-vite 5 + electron-builder 26:** dev/build tooling -- purpose-built for the main/preload/renderer process split; avoids electron-forge experimental Vite plugin
- **React 18 (renderer):** overlay UI and session context panel -- pays off for streaming token rendering
- **@deepgram/sdk 5.4.0:** streaming STT via websocket -- v5 breaking redesign; run in main process to keep API key out of renderer
- **@anthropic-ai/sdk 0.104.2:** Claude streaming (messages.stream), vision image blocks -- Haiku 4.5 for fast paths, Opus 4.8 for code-challenge
- **uiohook-napi 1.5.5:** passive global hotkey hook -- does not steal/conflict with meeting-app accelerators; requires @electron/rebuild after install
- **electron-store 11 + safeStorage:** context persistence (plaintext JSON) and API key storage (OS-encrypted DPAPI)
- **AudioWorklet (Web Audio built-in):** Float32->Int16 PCM downsampling/chunking in the renderer audio thread, immune to main-thread jank

### Expected Features

Research confirms the PROJECT.md Active list is well-scoped and matches what real products in this category ship. Five table-stakes features were found that the requirements imply but do not name explicitly; all five must ship in v1:

1. **Content protection (screen-share invisibility):** The category defining feature. setContentProtection(true) maps to Windows WDA_EXCLUDEFROMCAPTURE. Must be re-applied after every show/showInactive call (Electron clears it on hide). Verify the overlay is fully absent (not a black box) in a real self-test share, per meeting app.
2. **Response scrollback + keyboard scroll:** Streamed answers overflow the visible area; without Alt+arrows scroll the tool is unusable in a keyboard-only overlay.
3. **STT auto-reconnect with backoff:** Deepgram websockets drop mid-meeting; silent death is unacceptable. Needs reconnect plus a visible connection-state indicator.
4. **Bounded rolling transcript buffer + clear-buffer hotkey:** Both automatic cap (by time/line count) and an explicit hotkey to reset between topics so stale context does not bleed into prompts.
5. **First-run / API-key entry via a separate focusable window:** Because the overlay is focusable:false, a plain input on the overlay cannot receive keyboard events. Key entry must be a normal focusable secondary window opened deliberately.

**Must have (table stakes):**
- Transparent always-on-top overlay, focusable:false, skipTaskbar:true, showInactive -- core premise
- Content protection (setContentProtection, re-applied on every show) -- category-defining
- Show/hide + move + opacity hotkeys -- basic keyboard usability
- Keyboard scroll of response pane (Alt+arrows) -- long answers are unreadable without it
- System-audio loopback to Deepgram live transcript with interim/final rendering
- STT auto-reconnect + bounded buffer + clear-buffer hotkey
- Three AI mode hotkeys (answer / talking-points / solve-screenshot) with streaming output
- Default transcript-span selection (last ~60s / last N finalized lines)
- Tiered model routing (Haiku for answer/talking-points, Opus for screenshot-solve)
- Session Context: paste/edit/persist a single context, injected into all mode prompts
- API-key entry window (separate focusable window) + connection/status indicator

**Should have (competitive differentiators):**
- Grounding via pasted project context (tickets, snippets, links) -- the real edge over generic chatbots
- Transcript-span picker (cycle 30/60/120s) -- no competing product solves this cleanly; genuine v1.x differentiator
- Brief vs. detailed answer toggle -- one hotkey; low cost, high meeting-flow value
- Multiple named Session Contexts -- store design should allow this from day one even if v1 ships one

**Defer (v2+):**
- Local Whisper STT -- cloud validates the loop first; ISttProvider seam already in place
- Speaker diarization / mic capture -- large audio rework, low marginal value
- URL-fetcher / OAuth Jira/GitHub integration -- paste covers 90%
- Local RAG memory across past meetings -- heavy build, unproven for a personal v1
- Post-meeting summaries / notetaker features -- a different product

### Architecture Approach

The architecture is dictated by two hard constraints: getDisplayMedia (loopback audio capture) is a web-context-only API and cannot run in the main process; and API keys must never enter a web context. The resulting shape is a three-process Electron model where the renderer owns MediaStream acquisition and AudioWorklet PCM conversion, the main process owns the Deepgram STT websocket, Anthropic streaming client, transcript buffer, screenshot capture, and global hotkeys, and the preload bridge (contextBridge) is the sole typed IPC surface. PCM frames flow renderer to main via a dedicated high-frequency IPC channel (chunked at ~100ms, transferable ArrayBuffers); transcript words and AI tokens flow main to renderer via event channels.

The ISttProvider interface is the critical seam: defined in Phase 3 from day one so DeepgramSttGateway implements it and WhisperSttGateway can replace it later without touching the orchestrator or transcript buffer. A SessionContextDto (ULID keyed, stores notes/snippets/link labels) persists in electron-store; its shape already anticipates a v2 URL-fetcher without schema change.

**Major components:**
1. **WindowManager (MAIN):** Creates/configures the overlay BrowserWindow with focusable:false, transparent:true, frame:false, skipTaskbar:true; manages opacity, position, show/hide via showInactive; re-applies content protection on every show
2. **HotkeyService (MAIN):** Registers OS-global shortcuts via uiohook-napi; maps hotkeys to mode triggers and window-control actions; always checks register() return value
3. **AudioCapture (RENDERER):** Acquires loopback MediaStream via getDisplayMedia with video:true and audio:true (video required on Windows), immediately stops the video track, runs AudioWorklet to convert Float32->Int16 PCM at 16kHz, posts chunked buffers to main
4. **STT Client / ISttProvider (MAIN):** Deepgram streaming websocket (linear16, 16kHz, interim_results:true); emits timestamped word events to TranscriptBuffer; auto-reconnect with backoff
5. **TranscriptBuffer (MAIN):** Rolling time/word-bounded ring buffer; exposes recentSpan({ seconds: N }) for prompt assembly; cleared by hotkey
6. **AIOrchestrator + PromptAssembly (MAIN):** On hotkey: selects mode, assembles prompt from transcript span + active session context (+ screenshot for code-challenge), streams Claude tokens to renderer; tagged with request-id for cancellation
7. **SessionContextRepository (MAIN):** electron-store read/write for ISessionContextDto; injected into every prompt
8. **Overlay UI (RENDERER):** React components for rolling transcript, AI response stream (append-only, debounced), status indicator; zero focusable DOM elements
9. **Settings Window (separate MAIN BrowserWindow):** Normal focusable window for API-key entry, context editing, hotkey configuration -- not part of the overlay

### Critical Pitfalls

1. **Overlay steals focus (existential):** Default BrowserWindow or use of win.show() steals focus from the meeting app. Prevention: focusable:false, skipTaskbar:true, show:false on creation; display with win.showInactive() ONLY; setAlwaysOnTop(true, screen-saver level); setIgnoreMouseEvents(true, { forward:true }); zero focusable DOM on the overlay; context editor in a separate focusable window. Verify by watching the meeting app title-bar active state -- it must never dim.

2. **Content protection regression (existential, version-coupled):** Electron 35.0.1 introduced a regression where setContentProtection(true) shows a black rectangle on Windows 11 instead of making the overlay absent. Also: win.hide() clears the protection on every call, so it must be re-applied in a wrapper that bundles showInactive + setContentProtection. Prevention: pin and empirically verify the Electron version; confirm overlay is fully absent (not blacked out) in a screen-share self-test per meeting app.

3. **System-audio loopback silence (single biggest technical risk):** getDisplayMedia with audio:true and video:false throws NotSupportedError on Windows. The 40.x Electron line has a documented silence regression. setDisplayMediaRequestHandler must resolve with a screen source plus audio:loopback. Prevention: spike loopback in isolation (RMS meter, non-zero signal confirmed) before writing any Deepgram code.

4. **ISttProvider seam missing at integration time (architectural):** Wiring Deepgram directly into the orchestrator and buffer causes Deepgram-shaped types to leak everywhere; retrofitting the interface later becomes a rewrite. Prevention: define ISttProvider and DeepgramSttGateway in Phase 3, before any other code depends on the STT output.

5. **PCM sample-rate mismatch / wrong encoding:** AudioContext.sampleRate defaults to 48000Hz on Windows; Deepgram linear16 needs the declared rate to exactly match the actual PCM rate. Float32->Int16 conversion with wrong scaling produces noise. Prevention: make declared rate and actual PCM rate identical and assert in code; use AudioWorklet not ScriptProcessorNode; batch at ~100ms chunks.

6. **API keys leaking to renderer (security, foundational):** Both STT and LLM clients must live exclusively in the main process. Prevention: set up safeStorage encryption and the contextBridge IPC boundary in the scaffold phase before any API call is written; contextIsolation:true, nodeIntegration:false, sandbox:true.

## Implications for Roadmap

The build order is dependency-ordered: each phase produces a runnable increment, surfaces its risk, and gates the next phase. The two existential requirements (focus discipline and content protection) must be proven before any feature work. Audio loopback must be spiked in isolation before the full STT pipeline is built.

### Phase 1: Overlay Shell + Existential Behaviors

**Rationale:** The core promise is never steals focus, invisible in screen share. If either behavior is broken, every feature built on top is worthless. These are also the most version-sensitive Electron behaviors -- verify them on the actual machine before writing a single line of product code. This phase also establishes the IPC boundary and security posture all subsequent phases depend on.

**Delivers:** Transparent, always-on-top, click-through, non-focusable overlay rendering a placeholder. Confirmed absent from screen share. Confirmed zero focus steal. API-key security boundary wired (contextIsolation, safeStorage, typed preload bridge). Electron version pinned and documented. One early packaged smoke-test to de-risk transparency rendering.

**Addresses:** Transparent always-on-top overlay, content protection, focus discipline, API-key security -- all P1 foundational

**Avoids:** Pitfalls 1 (focus stealing), 3 (content protection regression), 8 (key leakage), 9 (packaging transparency)

**Research flag:** Empirical verification required on the user machine. Verified on this machine is the phase acceptance criterion, not an optional check.

### Phase 2: Global Hotkeys + Window Control

**Rationale:** All overlay control is keyboard-only. This phase establishes the complete control loop (show/hide, move, opacity, content-protection re-application on show) before anything else is interactive.

**Delivers:** All window-control hotkeys working with a real meeting app focused. register() return always checked and surfaced. Content protection re-applied on every show via a showInactive wrapper.

**Addresses:** Show/hide, move, opacity hotkeys -- P1 table stakes

**Avoids:** Pitfall 4 (hotkey conflict/silent failure) -- check register() return from the first hotkey written; test with Teams and Zoom open

**Research flag:** Standard patterns -- no deeper research needed.

### Phase 3: Audio Loopback Spike + STT Pipeline

**Rationale:** System-audio loopback is the single largest technical risk. It must be validated in isolation before the full pipeline is built on top of it. The ISttProvider seam goes in here, not later -- this is the only moment it is cheap to add.

**Delivers:** Confirmed non-silent loopback on the pinned Electron version. ISttProvider interface + DeepgramSttGateway implementation. AudioWorklet PCM pipeline at correct rate/encoding. TranscriptBuffer (rolling, bounded, timed). Live rolling transcript on overlay with interim/final rendering. Auto-reconnect with backoff. Clear-buffer hotkey. Connection status indicator.

**Addresses:** System-audio loopback, live rolling transcript, STT auto-reconnect, bounded buffer, clear-buffer hotkey, connection indicator -- all P1

**Avoids:** Pitfall 2 (loopback silence -- spike first), Pitfall 5 (PCM mismatch -- assert rate in code, AudioWorklet)

**Research flag:** Loopback spike result may change the stack. Treat the spike as a go/no-go gate before Deepgram integration.

### Phase 4: AI Orchestration -- Modes 1 and 2 (Answer + Talking Points)

**Rationale:** First real user value. Text-only AI modes reuse the transcript buffer already streaming; no new audio plumbing. Establishes the streaming token IPC path, prompt assembly, and tiered model routing that Phase 6 will reuse.

**Delivers:** AIOrchestrator + PromptAssembly + AnthropicGateway. Hotkeys for answer question (Haiku) and suggest talking points (Haiku). Streaming token render on overlay (append-only, debounced). Keyboard scrollback of response pane. Default transcript-span selection (~60s). Stream cancellation on hotkey re-press.

**Addresses:** Three AI mode hotkeys (2 of 3), streaming response pane, keyboard scrollback, tiered model routing, default transcript-span selection -- all P1

**Avoids:** Pitfall 6 (latency -- trigger on recent finalized window, stream tokens, log hotkey->first-token timestamps), Pitfall 7 (context bloat -- bounded transcript window)

**Research flag:** Confirm current Haiku 4.5 and Opus 4.8 model IDs + streaming API shape via claude-api skill at implementation time.

### Phase 5: Session Context Store + Panel

**Rationale:** Context grounding is what makes AI output relevant rather than generic. Deliberately positioned after AI modes work so the improvement from grounding is immediately visible. ISessionContextDto schema should be designed for multiple named contexts from day one even though only one ships.

**Delivers:** SessionContextRepository (electron-store). Session context panel UI in a separate focusable window (required because overlay is focusable:false). Active-session selection. Notes/snippets/links pasted and persisted locally. Context injected into all mode prompts.

**Addresses:** Session Context (paste/edit/persist, grounded prompts), API-key entry window -- both P1

**Avoids:** Pitfall 1 (no focusable elements on overlay -- context editor is a separate window)

**Research flag:** Standard patterns -- electron-store + contextBridge IPC are well-documented.

### Phase 6: Screenshot + Vision (Mode 3 -- Solve Code Challenge)

**Rationale:** Reuses the entire AI path from Phase 4; only adds an image source and a model switch to Opus. Last among features because it is the most isolated addition and the most expensive per-call mode.

**Delivers:** ScreenshotService (desktopCapturer). Client-side downscale to <=1568px long edge (PNG, base64, no data-URL prefix). Image block in PromptAssembly. Opus routing for this mode. Overlay excluded from its own screenshot. Solve code challenge hotkey.

**Addresses:** Screenshot -> vision solve -- P1

**Avoids:** Pitfall 7 (oversized images -- downscale before sending; wrong encoding -- no data-URL prefix in base64 field)

**Research flag:** Confirm current Anthropic vision request shape and model IDs via claude-api skill at implementation time.

### Phase 7: Hardening + Packaging

**Rationale:** Robustness, security, and packaging correctness once the feature set is proven. A packaged smoke-test should run in Phase 1 to de-risk transparency; this phase completes the full production packaging pass.

**Delivers:** Packaged NSIS or portable .exe verified transparent on target machine. SmartScreen behavior documented (accept friction, no EV cert for personal tool). Hotkey configuration UI. Whisper stub gateway behind ISttProvider. Stream cancel-on-re-press polish. Latency instrumentation (hotkey -> first-token budget). Hardware-acceleration fallback if transparency renders black.

**Addresses:** Packaging/transparency/signing, hardening of every pitfall

**Avoids:** Pitfall 9 (black box in packaged builds), Pitfall 4 (configurable hotkeys as recovery from conflicts)

**Research flag:** Standard patterns for electron-builder NSIS.

### Phase Ordering Rationale

- Phases 1-2 before any audio or AI work: Focus discipline and content protection are version-coupled Electron behaviors that silently break every feature built after them.
- Phase 3 starts with an isolated spike: Loopback silence is the single biggest risk. Spike before integrating Deepgram so a version-pin change or WASAPI fallback does not invalidate STT code.
- ISttProvider in Phase 3, not later: Adding the abstraction after Deepgram is wired throughout is a rewrite. The seam is cheap here and expensive later.
- Phase 4 before Phase 5: AI modes with ungrounded prompts still demonstrate the streaming pipeline and latency characteristics. Seeing the improvement from grounding motivates the context work.
- Phase 6 last among features: Vision path reuses the entire Phase 4 AI path; it is the most isolated and most expensive per-call feature.
- Secret boundary in Phase 1, not Phase 7: contextIsolation, safeStorage, and the preload bridge are wired in the scaffold before any API call is written.

### Research Flags

Phases needing empirical verification or deeper research during planning/execution:

- **Phase 1 (empirical -- go/no-go):** Electron version selection for loopback + content-protection compatibility cannot be resolved by documentation alone. Verified on this machine is the phase acceptance criterion.
- **Phase 3 (spike gate):** Loopback behavior must be confirmed with an isolated spike before Deepgram integration begins. If the result is silence, the WASAPI sidecar fallback changes the build plan.
- **Phases 4 and 6 (API shape):** Confirm current Anthropic model IDs, streaming API shape, and vision block format via claude-api skill at implementation time.

Phases with well-documented standard patterns (skip additional research):

- **Phase 2:** uiohook-napi + globalShortcut fallback are well-documented.
- **Phase 5:** electron-store + contextBridge IPC patterns are mature.
- **Phase 7:** electron-builder NSIS packaging is standard.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All library versions verified via npm registry. Deepgram v5 and Anthropic SDK shapes confirmed via Context7. Only the Electron version pin is MEDIUM -- requires empirical verification on the target machine. |
| Features | HIGH | Multiple converging open-source products (Aura-AI, Natively, Open-Cluely) and commercial products (Cluely, Interview Coder) confirm feature-set consensus. The five implicit table-stakes features were identified from concrete Electron issue tracker sources. |
| Architecture | HIGH | Process-boundary layout is forced by API constraints (getDisplayMedia is web-only; keys must stay in main). Confirmed against Electron docs, Deepgram docs, and multiple corroborating sources. |
| Pitfalls | MEDIUM-HIGH | Focus/click-through, content-protection, and loopback pitfalls verified against the Electron GitHub issue tracker with specific issue numbers and commit references. Version-specific behaviors (35.0.1 content-protection regression, 40.x loopback silence) are confirmed. |

**Overall confidence:** HIGH for design decisions; MEDIUM for the Electron version pin (requires on-machine verification).

### Gaps to Address

- **Exact Electron 35.x patch version:** Research identifies 35.x as the target and 35.0.1 as broken for content protection. The specific patch version known-good for BOTH loopback AND content protection on Windows 11 must be identified empirically in Phase 1. Start with the latest 35.x patch and verify both behaviors before pinning.
- **Current Anthropic model IDs and vision schema:** claude-haiku-4-5 and claude-opus-4-8 are the project-specified identifiers. Confirm exact IDs and current image block format via claude-api skill at the start of Phase 4.
- **Hotkey default set:** Default accelerators must be tested for conflicts with Teams, Zoom, and VS Code on the user machine. Research flags Ctrl+Alt+key combos as lowest-risk; exact defaults should be validated in Phase 2.
- **uiohook-napi vs globalShortcut decision point:** uiohook-napi is recommended (passive hook, never conflicts) but requires a native rebuild against the Electron ABI. If the rebuild proves difficult on this machine, globalShortcut with conflict detection is the fallback. Evaluate in Phase 2.

## Sources

### Primary (HIGH confidence)

- /deepgram/deepgram-js-sdk (Context7) -- v5 DeepgramClient, listen.v1.connect, sendMedia, interim_results, is_final
- /anthropics/anthropic-sdk-typescript (Context7) -- messages.stream(), SSE delta events, base64 image content block shape
- https://www.electronjs.org/docs/latest/api/session -- setDisplayMediaRequestHandler, loopback/loopbackWithMute, Windows-only
- https://www.electronjs.org/docs/latest/api/frameless-window -- transparent/frame:false overlay configuration
- https://electron-vite.org/ -- electron-vite main/preload/renderer model, v5
- https://www.electronforge.io/config/plugins/vite -- Forge Vite plugin marked experimental
- https://developers.deepgram.com/docs/encoding -- linear16, sample-rate requirements
- https://developers.deepgram.com/docs/determining-your-audio-format-for-live-streaming-audio -- live streaming audio format
- https://docs.claude.com/en/docs/build-with-claude/vision -- image size limits (8000px max, ~1.15MP / 1568px recommendation, 32MB cap)
- npm registry (npm view) -- verified current versions of all dependencies

### Secondary (MEDIUM confidence)

- https://github.com/electron/electron/issues/49607 -- desktop audio silence regression, 4x4 video constraint workaround
- https://github.com/electron/electron/issues/45990, /45844, /46507, /32961, /47834 -- setContentProtection Windows regression (35.0.1 black rectangle, win.hide() clearing protection)
- https://github.com/electron/electron/issues/37293 -- getDisplayMedia audio requires video on Windows
- https://github.com/electron/electron/issues/27240, /8491 -- globalShortcut not reliably global, steals accelerators
- https://github.com/electron/electron/issues/13895 -- AltGr mis-mapped as ControlLeft on Windows
- https://github.com/electron/electron/issues/46369 -- Error 263 renderer crash on Windows 11
- https://github.com/alectrocute/electron-audio-loopback -- version range >=31.0.1, <39.0.0; built-in at 39+
- https://github.com/Rkcr7/Aura-AI -- open-source feature reference, keyboard scheme, WDA_EXCLUDEFROMCAPTURE usage
- https://github.com/Natively-AI-assistant/natively-cluely-ai-assistant -- open-source copilot feature list
- https://github.com/orgs/deepgram/discussions/740 -- Deepgram auth header, buffering guidance
- https://levelup.gitconnected.com/how-i-made-a-desktop-app-invisible-to-screen-sharing-electron-os-level-tricks-5734513c1e67 -- WDA_EXCLUDEFROMCAPTURE implementation
- https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation -- SmartScreen EV cert requirement since June 2023

### Tertiary (MEDIUM-LOW confidence)

- https://tooldirectory.ai/tools/cluely, https://navtools.ai/tool/cluely -- Cluely commercial feature set (vendor/directory descriptions)
- https://ophyai.com/best-ai-interview-copilot -- category feature-set consensus
- https://deepwiki.com/realtime-ai/realtime-audio-sdk/3.1-audioworklet-integration -- AudioWorklet Float32->PCM16 patterns

---
*Research completed: 2026-06-16*
*Ready for roadmap: yes*
