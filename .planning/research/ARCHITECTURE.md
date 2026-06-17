# Architecture Research

**Domain:** Windows Electron meeting/interview assistant — transparent always-on-top overlay with live STT + on-demand AI
**Researched:** 2026-06-16
**Confidence:** HIGH (core process-boundary and audio-capture facts verified against Electron docs, Deepgram docs, and multiple corroborating sources)

## Standard Architecture

The single hard constraint that dictates everything else: **system-audio loopback capture can only run in a renderer (web) context.** `getDisplayMedia` is a `navigator.mediaDevices` API and does not exist in the main process. The main process only *authorizes* loopback (via `setDisplayMediaRequestHandler` returning `audio: 'loopback'`); the actual `MediaStream`, the `AudioContext`, and the `AudioWorklet` that produces PCM frames all live in a renderer.

The second decision that shapes the layout: **the STT and Anthropic clients live in MAIN, not the renderer.** Reasons: (1) API keys never enter a web context, (2) no CORS/CSP friction on the Deepgram and Anthropic websockets/HTTP, (3) the long-lived STT websocket survives renderer reloads during development, (4) screenshot capture (`desktopCapturer`) and global hotkeys already live in main, so the AI orchestration sits next to its triggers. This means PCM frames flow *renderer → main* over IPC, and transcript/AI tokens flow *main → renderer* back.

### System Overview

```
┌──────────────────────────────────────────────────────────────────────┐
│  MAIN PROCESS (Node, has secrets, owns OS integration)                 │
│  ┌────────────┐ ┌──────────────┐ ┌──────────────┐ ┌────────────────┐  │
│  │ WindowMgr  │ │ HotkeyService│ │ ScreenshotSvc│ │ ConfigStore     │  │
│  │ overlay BW │ │ globalShortcut│ │ desktopCapt. │ │ electron-store  │  │
│  └────────────┘ └──────┬───────┘ └──────┬───────┘ └───────┬─────────┘  │
│  ┌──────────────────┐  │ trigger        │ image          │ context     │
│  │ STT Client       │  ▼                ▼                ▼             │
│  │ (IStt provider)  │ ┌────────────────────────────────────────────┐  │
│  │ Deepgram WS      │ │ AI Orchestrator                             │  │
│  └───────┬──────────┘ │ - prompt assembly (transcript span+context) │  │
│          │ words      │ - mode selection (answer/talkpoints/code)   │  │
│          ▼            │ - Anthropic streaming client                │  │
│  ┌──────────────────┐ └───────────────────┬────────────────────────┘  │
│  │ TranscriptBuffer │◄────────────────────┘ reads recent span         │
│  │ (rolling, timed) │                                                  │
│  └──────────────────┘                                                  │
│        ▲ PCM frames (IPC)            │ transcript + AI tokens (IPC)    │
└────────┼─────────────────────────────┼──────────────────────────────-─┘
         │                             │
   ┌─────┴─────────────────────────────▼─────────────────────────────┐
   │  PRELOAD (contextBridge — the ONLY IPC surface, no Node leak)    │
   │  window.api = { audio.*, transcript.on*, ai.on*, ctx.*, ui.* }   │
   └─────▲─────────────────────────────┬─────────────────────────────┘
         │                             │
┌────────┼─────────────────────────────▼──────────────────────────────┐
│  RENDERER (Chromium web context — the ONLY place getDisplayMedia runs)│
│  ┌──────────────────────┐   ┌────────────────────────────────────┐   │
│  │ Audio Capture        │   │ Overlay UI (React/Svelte/vanilla)  │   │
│  │ getDisplayMedia →     │   │ - rolling transcript view          │   │
│  │ AudioContext →        │   │ - AI response stream view          │   │
│  │ AudioWorklet →        │   │ - Session Context panel            │   │
│  │ Float32→PCM16 16kHz   │   │ - opacity/position (no focus!)     │   │
│  └──────────┬───────────┘   └────────────────────────────────────┘   │
│             └─ posts PCM frames out via preload → main                 │
└───────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Process | Responsibility | Typical Implementation |
|-----------|---------|----------------|------------------------|
| WindowManager | MAIN | Create/configure overlay `BrowserWindow`; opacity, move, show/hide; non-focus-stealing config | `BrowserWindow` + `setIgnoreMouseEvents` |
| HotkeyService | MAIN | Register OS-global shortcuts; map each to a mode trigger or UI action | `globalShortcut.register` |
| ScreenshotService | MAIN | Capture screen frame on demand for the vision path | `desktopCapturer.getSources({types:['screen']})` |
| STT Client (`ISttProvider`) | MAIN | Open streaming websocket, push PCM in, emit timestamped words out | `@deepgram/sdk` listen-live, or `ws` |
| TranscriptBuffer | MAIN | Append words, keep a rolling time/word-bounded buffer, expose "last N seconds/words" span | In-memory ring buffer keyed by word timing |
| AIOrchestrator | MAIN | On hotkey: pick mode, assemble prompt from transcript span + active context (+ image), stream Claude tokens | `@anthropic-ai/sdk` `messages.stream` |
| ConfigStore | MAIN | Persist API keys, session context, settings | `electron-store` (encrypted for keys) |
| AudioCapture | RENDERER | Acquire loopback `MediaStream`, run AudioWorklet, emit PCM16@16kHz frames to main | Web Audio + AudioWorklet |
| Overlay UI | RENDERER | Render transcript + streaming AI output + context panel; never grab focus | React/Svelte/vanilla TS |
| Preload bridge | PRELOAD | Expose a typed, minimal `window.api`; the only renderer↔main channel | `contextBridge.exposeInMainWorld` |

## Recommended Project Structure

electron-vite's convention (`src/main`, `src/preload`, `src/renderer`) is the discovery default and needs zero config. Layer inside each process by feature, mirroring the IDEXX layered style (service/gateway suffixes) so business logic stays out of IPC handlers and OS-API calls stay out of services.

```
src/
├── main/
│   ├── index.ts                         # app lifecycle, wires services, registers IPC
│   ├── window/
│   │   └── overlay-window.factory.ts    # BrowserWindow config (transparent, focusable:false)
│   ├── hotkeys/
│   │   └── hotkey-registration.service.ts
│   ├── audio/
│   │   └── loopback-request.handler.ts  # setDisplayMediaRequestHandler → audio:'loopback'
│   ├── stt/
│   │   ├── stt-provider.interface.ts    # ISttProvider — THE SEAM
│   │   ├── deepgram-stt.gateway.ts       # implements ISttProvider
│   │   ├── whisper-stt.gateway.ts        # future local impl (stub for v1)
│   │   └── transcript-buffer.service.ts # rolling timestamped buffer
│   ├── ai/
│   │   ├── ai-orchestrator.service.ts    # mode dispatch + stream lifecycle
│   │   ├── prompt-assembly.service.ts    # transcript span + context → messages
│   │   ├── anthropic.gateway.ts          # Claude streaming, model selection
│   │   └── modes/                        # answer / talking-points / code-challenge
│   ├── screenshot/
│   │   └── screenshot-capture.service.ts
│   ├── context/
│   │   └── session-context.repository.ts # electron-store read/write
│   ├── config/
│   │   └── secrets.repository.ts         # API keys (encrypted)
│   └── ipc/
│       ├── channels.ts                   # channel-name constants (shared via @shared)
│       └── *.ipc.ts                      # ipcMain handlers, thin — delegate to services
├── preload/
│   └── index.ts                          # contextBridge: typed window.api surface
├── renderer/
│   ├── index.html
│   └── src/
│       ├── audio/
│       │   ├── audio-capture.controller.ts   # getDisplayMedia + AudioContext wiring
│       │   └── pcm-downsampler.worklet.ts    # Float32→PCM16, 48k→16k
│       ├── components/                        # transcript view, ai-response view, context panel
│       ├── overlay-app.tsx
│       └── ipc-client.ts                      # thin wrapper over window.api
└── shared/
    ├── types/                             # IPC payload types, ISession DTOs
    └── ai-modes.enum.ts                   # AiModes enum (plural, per naming standard)
```

### Structure Rationale

- **`main/stt/` holds the seam.** `stt-provider.interface.ts` is the abstraction; `deepgram-stt.gateway.ts` and a future `whisper-stt.gateway.ts` implement it. The orchestrator/buffer depend on the interface, never on Deepgram directly.
- **`shared/` carries IPC payload types and enums** so main, preload, and renderer agree on the wire contract at compile time — critical because the renderer↔main boundary is otherwise untyped.
- **`ipc/` handlers are thin** (the resolver analog): they validate and delegate to services, holding no business logic — same discipline as the backend resolver/service split.

## Architectural Patterns

### Pattern 1: Audio capture in renderer, processing in main

**What:** Renderer owns the `MediaStream` and AudioWorklet (the only place it can live); main owns STT. PCM16 frames are shipped renderer→main.
**When to use:** Always — it's forced by `getDisplayMedia` being web-only and by keeping the STT key out of the web context.
**Trade-offs:** + secrets isolated, connection survives renderer reload; − every audio frame crosses the IPC boundary (~20–50 frames/sec). Mitigate by chunking: the worklet accumulates ~100ms of PCM16@16kHz (~3.2KB) before posting, not every 128-sample quantum. Use `ArrayBuffer`/transferable payloads, and a dedicated high-frequency channel separate from UI events.

```typescript
// renderer: authorize happens in main; renderer just asks for it
const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
// video:true is REQUIRED even for audio-only on Windows — drop the video track after.
stream.getVideoTracks().forEach((t) => t.stop());

const audioContext = new AudioContext({ sampleRate: 16000 }); // request 16k directly
const source = audioContext.createMediaStreamSource(stream);
await audioContext.audioWorklet.addModule(workletUrl);
const worklet = new AudioWorkletNode(audioContext, 'pcm-downsampler');
source.connect(worklet);
worklet.port.onmessage = (e) => window.api.audio.pushFrame(e.data); // PCM16 ArrayBuffer → main
```

```typescript
// main: authorize loopback (this is the part that makes it system audio, not mic)
session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    desktopCapturer.getSources({ types: ['screen'] }).then((sources) => {
        callback({ video: sources[0], audio: 'loopback' });
    });
});
```

### Pattern 2: Provider interface (STT seam)

**What:** A minimal streaming contract the orchestrator depends on, with Deepgram as the v1 implementation and Whisper swappable later.
**When to use:** Any external capability the project explicitly plans to replace — STT here (Whisper is a documented fallback in PROJECT.md).
**Trade-offs:** + clean swap, testable with a mock provider; − must keep the interface vendor-neutral (no Deepgram-shaped types leaking through).

```typescript
export interface ISttProvider {
    start(config: { sampleRate: number; encoding: 'linear16' }): Promise<void>;
    pushAudio(frame: ArrayBuffer): void;            // PCM16 chunk
    onTranscript(handler: (event: ITranscriptEvent) => void): void; // word + timing + isFinal
    stop(): Promise<void>;
}
// DeepgramSttGateway implements ISttProvider; WhisperSttGateway implements it later.
```

### Pattern 3: Hotkey → orchestrator → streaming render (one-way token push)

**What:** A global shortcut fires in main, the orchestrator reads the current transcript span + active context, opens an Anthropic stream, and pushes tokens to the renderer over an event channel; the renderer appends them as they arrive.
**When to use:** All three AI modes share this skeleton, differing only in prompt assembly and model choice (Haiku for answer/talking-points, Opus for code-challenge).
**Trade-offs:** + responsive, no renderer round-trips during streaming; − requires a request-id so the renderer can route concurrent/cancelled streams. Hotkey re-press should cancel the in-flight stream.

```typescript
globalShortcut.register('Alt+1', () => aiOrchestrator.run(AiModes.ANSWER_QUESTION));
// orchestrator: span = transcriptBuffer.recentSpan({ seconds: 45 });
//               messages = promptAssembly.build(mode, span, context.active(), image?);
//               for await (const token of anthropic.stream(messages, model)) webContents.send('ai:token', { id, token });
```

## Data Flow

### Continuous transcription flow

```
System audio (Windows WASAPI loopback)
    │  setDisplayMediaRequestHandler → audio:'loopback'   [MAIN authorizes]
    ▼
getDisplayMedia MediaStream            [RENDERER]
    ▼  AudioContext(16kHz) → AudioWorklet
Float32 → PCM16, chunk ~100ms          [RENDERER worklet thread]
    ▼  window.api.audio.pushFrame(buf)  → IPC channel "audio:frame"
STT Client.pushAudio(frame)            [MAIN]
    ▼  Deepgram websocket
ITranscriptEvent (word, start, end, isFinal)
    ▼  TranscriptBuffer.append()
webContents.send("transcript:update", words)  → IPC
    ▼
Rolling transcript view re-render      [RENDERER]
```

### On-demand AI flow

```
User presses Alt+1 / Alt+2 / Alt+3     [OS → MAIN globalShortcut]
    ▼
AIOrchestrator.run(mode)
    ├─ TranscriptBuffer.recentSpan()                 (transcript context)
    ├─ SessionContext.active()                       (pasted notes/snippets/links)
    └─ ScreenshotService.capture()   [mode=code only] (image block)
    ▼  PromptAssembly.build(mode, span, context, image?)
Anthropic.stream(messages, model)      (Haiku fast / Opus for code)
    ▼  token-by-token
webContents.send("ai:token", {id, token})  → IPC
    ▼
AI response view appends tokens        [RENDERER]
```

### IPC channel map

| Channel | Direction | Payload | Notes |
|---------|-----------|---------|-------|
| `audio:frame` | renderer → main | `ArrayBuffer` (PCM16) | high-frequency; transferable; chunked ~100ms |
| `audio:start` / `audio:stop` | renderer → main | `{}` | lifecycle of capture |
| `transcript:update` | main → renderer | `ITranscriptEvent[]` | interim + final words |
| `ai:request` | main-internal | (from hotkey, not renderer) | triggered by `globalShortcut` |
| `ai:token` | main → renderer | `{ id, token }` | streaming; id for routing/cancel |
| `ai:done` / `ai:error` | main → renderer | `{ id, ... }` | stream terminus |
| `ctx:get` / `ctx:save` / `ctx:setActive` | renderer ↔ main | `ISessionContextDto` | context panel CRUD |
| `ui:setOpacity` / `ui:move` / `ui:toggle` | renderer ↔ main / hotkey → main | `{}` | window control |

### Session context shape

```typescript
export interface ISessionContextDto {
    sessionReferenceId: string;          // ULID
    name: string;
    notes: string;                       // freeform pasted text
    snippets: { label: string; content: string }[];  // repo/ticket excerpts
    links: { label: string; url: string }[];          // v1: stored only; v2: fetched
    isActive: boolean;
    updatedAt: string;                   // ISO-8601 (Luxon)
}
```

Persisted via `electron-store` (JSON in userData). `PromptAssembly` reads the single active session and injects `notes` + `snippets` (and link labels) into a system/context block ahead of the transcript span. Links are stored as data only in v1 — the shape already anticipates the documented v2 URL-fetcher, so adding a fetcher means populating snippet-like content from a URL, no schema change.

## Build Order (dependency-ordered phases)

Each phase produces something runnable, and each depends only on what precedes it. This is the recommended roadmap spine.

| # | Phase | Builds | Depends on | Why this order |
|---|-------|--------|------------|----------------|
| 1 | **Overlay shell** | electron-vite scaffold; transparent, frameless, always-on-top, **`focusable:false`**, `skipTaskbar`; preload bridge skeleton; renderer renders a placeholder | — | Proves the hardest non-functional requirement (never steals focus) before any feature exists. Nothing else is testable without a window. |
| 2 | **Global hotkeys + window control** | `globalShortcut` registration; hotkeys to show/hide, move, change opacity | Phase 1 (a window to control) | Establishes the keyboard-only control loop end-to-end; cheap, high-confidence. |
| 3 | **Audio capture + live transcript** | loopback request handler (main); `getDisplayMedia` + AudioWorklet PCM pipeline (renderer); `ISttProvider` + Deepgram gateway; TranscriptBuffer; transcript view | Phases 1–2 (window + IPC + a way to start capture) | The continuous backbone. The `ISttProvider` seam goes in *here*, from day one, so Deepgram is never load-bearing. |
| 4 | **AI orchestration — modes 1 & 2** | AIOrchestrator, PromptAssembly, Anthropic gateway, streaming token render; hotkeys for "answer question" and "suggest talking points" | Phase 3 (needs transcript span) | First real user value. Text-only modes; reuses the transcript buffer already streaming. |
| 5 | **Session context store + panel** | electron-store repository, context panel UI, active-session selection, injection into PromptAssembly | Phase 4 (something to inject into) | Grounds the AI output. Deliberately after AI works, so you can see grounding improve. |
| 6 | **Screenshot + vision (mode 3)** | ScreenshotService (`desktopCapturer`), image block in PromptAssembly, Opus model path, "solve code challenge" hotkey | Phases 4–5 (orchestrator + prompt assembly + context) | Reuses the entire AI path; only adds an image source and a model switch. Last because it's the most isolated addition. |
| 7 | **Hardening (optional)** | API-key settings UI, encrypted secrets, STT reconnect/backoff, stream cancel-on-re-press, Whisper gateway stub | All | Robustness once the feature set is proven. |

**Critical dependency notes:**
- Phase 1's `focusable: false` is the single most important config and must be validated first — if the overlay steals focus the product fails its core promise.
- Phase 3 must introduce `ISttProvider` even though only Deepgram exists, or the seam never gets built (retrofitting an interface after Deepgram is wired everywhere is the classic failure).
- Phases 4 and 6 share PromptAssembly and the Anthropic gateway; build mode 1 first to shake out the streaming/IPC token plumbing, then 2 and 6 are incremental.

## Threading & Event-Loop Considerations

| Concern | Mechanism |
|---------|-----------|
| **Overlay never steals focus** | `BrowserWindow({ transparent:true, frame:false, alwaysOnTop:true, focusable:false, skipTaskbar:true, show:true })`. `focusable:false` is the key — the window can render and update without ever becoming the foreground/focused window, so the meeting app keeps keyboard focus. Use `win.setAlwaysOnTop(true, 'screen-saver')` for true top-most over fullscreen meeting apps. |
| **Click-through** | `win.setIgnoreMouseEvents(true, { forward: true })` so clicks pass to the meeting window; toggle off only when the context panel needs interaction (and even then prefer keyboard, per the requirement). |
| **Global hotkeys stay responsive** | `globalShortcut` callbacks run on the main thread's event loop. Keep them non-blocking: a hotkey handler must only *kick off* async work (open a stream) and return — never `await` STT/AI synchronously inside the handler, or you stall every other shortcut. |
| **Audio doesn't block the UI/main loop** | PCM extraction runs on the **AudioWorklet thread** (separate from renderer main thread) at 128-sample quanta. The renderer main thread only forwards already-chunked buffers. The STT websocket in main is async I/O — it never blocks the event loop. |
| **IPC volume** | Chunk PCM to ~100ms before posting (not per quantum) and use transferable `ArrayBuffer`s, so the renderer→main hop is ~10 messages/sec, not ~375. Keep audio on its own channel separate from transcript/UI events. |
| **Stream cancellation** | Tag each AI stream with a request id; a hotkey re-press aborts the in-flight Anthropic stream (`AbortController`) before starting a new one, so the main loop isn't juggling overlapping streams. |

## Anti-Patterns

### Anti-Pattern 1: Trying to capture system audio in the main process

**What people do:** Look for a main-process API to grab `getDisplayMedia`/loopback audio.
**Why it's wrong:** `navigator.mediaDevices` does not exist in main; loopback capture is fundamentally a web-context capability. Main can only *authorize* it via `setDisplayMediaRequestHandler`.
**Do this instead:** Capture in a renderer, ship PCM frames to main over IPC.

### Anti-Pattern 2: Putting the Deepgram/Anthropic keys and websockets in the renderer

**What people do:** Open the STT/AI websocket directly from the overlay UI for "simplicity."
**Why it's wrong:** Leaks API keys into a web context, fights CORS/CSP, and the connection dies on every renderer reload.
**Do this instead:** Keep both clients in main; renderer only sends audio and receives transcript/AI events through the preload bridge.

### Anti-Pattern 3: Requesting audio-only from getDisplayMedia

**What people do:** Call `getDisplayMedia({ audio: true, video: false })`.
**Why it's wrong:** On Windows this throws `NotSupportedError` — desktop audio capture requires a video track.
**Do this instead:** Request `{ video: true, audio: true }`, then immediately stop and discard the video track.

### Anti-Pattern 4: Hard-wiring Deepgram throughout, adding an interface "later"

**What people do:** Call the Deepgram SDK directly from the transcript/orchestration code, planning to abstract it once Whisper is needed.
**Why it's wrong:** Deepgram-shaped types leak into the buffer and orchestrator; the retrofit becomes a rewrite.
**Do this instead:** Define `ISttProvider` in Phase 3 and depend only on it.

### Anti-Pattern 5: A focusable overlay window

**What people do:** Default `BrowserWindow` (focusable) and try to manage focus reactively.
**Why it's wrong:** Showing or updating the window steals keyboard focus from the meeting app — directly violating the core requirement.
**Do this instead:** `focusable: false` + `skipTaskbar: true` from the start; all control via `globalShortcut`.

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| Deepgram | Streaming websocket from MAIN; `linear16` PCM @ 16kHz | Match `sample_rate` to what the worklet emits (16000). Behind `ISttProvider`. Needs reconnect/backoff (Phase 7). |
| Anthropic | Streaming HTTP (`messages.stream`) from MAIN; Haiku 4.5 fast modes, Opus 4.8 code mode | Vision mode sends a screenshot image block. Confirm current model IDs / streaming / image input via the `claude-api` skill at implementation time. |
| Windows audio | `setDisplayMediaRequestHandler` → `audio:'loopback'` (no native binary) | Native WASAPI helper is the documented fallback if loopback proves flaky. |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| renderer ↔ main | IPC via preload `contextBridge` only | Typed payloads from `shared/types`; channel names from `shared` constants. |
| AudioWorklet ↔ renderer main thread | `MessagePort` (`worklet.port`) | Worklet posts chunked PCM16; renderer forwards to main. |
| AIOrchestrator ↔ STT | Direct (both in main) via TranscriptBuffer | Orchestrator reads spans; never talks to the STT gateway directly. |
| Orchestrator ↔ STT provider | `ISttProvider` interface | The swap seam (Deepgram → Whisper). |

## Sources

- [Electron desktopCapturer / loopback audio docs](https://www.electronjs.org/docs/latest/api/desktop-capturer) — HIGH
- [electron-audio-loopback (npm) — loopback on Windows 10+ without drivers](https://www.npmjs.com/package/electron-audio-loopback) — MEDIUM (corroborates Windows loopback + video-required quirk)
- [Electron issue: getDisplayMedia audio requires video on Windows](https://github.com/electron/electron/issues/37293) — MEDIUM
- [electron-vite recommended project structure](https://electron-vite.org/guide/) — HIGH
- [Deepgram encoding (linear16 / sample rate)](https://developers.deepgram.com/docs/encoding) — HIGH
- [Deepgram determining audio format for live streaming](https://developers.deepgram.com/docs/determining-your-audio-format-for-live-streaming-audio) — HIGH
- [AudioWorklet integration & Float32→PCM16 conversion](https://deepwiki.com/realtime-ai/realtime-audio-sdk/3.1-audioworklet-integration) — MEDIUM
- [Electron click-through window (setIgnoreMouseEvents)](https://www.geeksforgeeks.org/click-through-window-in-electronjs/) — MEDIUM
- [Electron frameless/transparent window docs](https://www.electronjs.org/docs/latest/api/frameless-window) — HIGH

---
*Architecture research for: Windows Electron overlay meeting/interview assistant*
*Researched: 2026-06-16*
