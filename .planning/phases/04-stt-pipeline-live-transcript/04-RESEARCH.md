# Phase 4: STT Pipeline + Live Transcript - Research

**Researched:** 2026-06-17
**Domain:** Windows native system-audio (WASAPI loopback) capture in Electron main + streaming STT (Deepgram v5 live WebSocket) + bounded rolling transcript
**Confidence:** HIGH on Deepgram v5 API shape and the resample/buffer logic (verified against installed package types); MEDIUM on the WASAPI native-module package choice (a concrete prebuilt-binary path exists and is verified to ship a `win32-x64` binary, but the leading candidate is young/low-download — a human go/no-go run is mandatory before building on it).

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01 (in-main-process native addon):** WASAPI capture runs as a native addon loaded **directly in the Electron main process** (same as `uiohook-napi` today), NOT a child process. PCM stays in-process. Accepted trade-off: a native capture crash takes down the app. This still honors "never touches Chromium screen capture."
- **D-02 (resample in main; retire renderer audio path):** Down-mix + resample to **16 kHz mono Int16 (linear16) PCM happens in main TypeScript** via a unit-testable `.utility.ts`. The renderer `rms-meter.worklet.ts` + `audio-capture.service.ts` are **removed** — one audio path, entirely in main, no renderer Web Audio. `rms.utility.ts` math is reusable for a main-computed level meter.
- **D-03 (native-module risk — DE-RISK FIRST):** Plain `naudiodon` does not expose loopback devices; the original plan was the `naudiodon-loopback` (Axiver) fork, which requires `@electron/rebuild` against the Electron 35.7.5 ABI. Same native-module risk class as `uiohook-napi` (MSVC from-source rebuild FAILED in Phase 2; only the prebuilt N-API binary loaded). **Researcher must confirm a working binary/rebuild path on this machine BEFORE the pipeline is built on it.** (See Open Question OQ-1 — research found a **better** package than the Axiver fork; the go/no-go check still stands.)
- **D-04 (transcript in DebugHud):** Transcript renders **inside the existing toggleable `DebugHud`** (extend it), NOT a new content surface. Interim text visually distinct from finalized (dimmed/italic).
- **D-05 (transcript coupled to HUD toggle):** Toggling the HUD off hides the transcript too. Dedicated content surface deferred to Phase 5.
- **D-06 (time-bounded buffer):** The transcript buffer is bounded by a **time window** (keep the last N minutes of finalized transcript, drop older), NOT word/segment count. Aligns with Phase 5's ~60s span selection. Planner sets N and ensures a hard memory ceiling.
- **D-07 (clear hotkey via existing registrar):** Clear-transcript is a **new Ctrl+Alt chord through `HotkeyRegistrarService`** with the same `register()`-result checking and HUD surfacing. Planner picks the letter (avoiding the finalized J / arrows / `[` `]` / H / Q set) and re-checks vs Teams/Zoom/VS Code. Clearing wipes the main-side `TranscriptBuffer`; overlay reflects the empty buffer via the push.
- **D-08 (key sourcing):** Phase 4 sources the Deepgram key from an **env var or a local untracked dev config read in main** — never in renderer, never in logs, never committed (honors SET-03). Phase 6's `safeStorage` replaces the source later without touching the gateway.
- **Locked upstream:** Built-in `getDisplayMedia` loopback is NO-GO on this machine (Phase 3 gate). Deepgram **v5** API only (ignore v3/v4). The overlay is `focusable:false`; renderer is a read-only `jedi:status` view. Settings window is Phase 6, not here. The 4-plan ROADMAP shape (seam+gateway / PCM pipeline / buffer+clear / reconnect+render) is the agreed shape.

### Claude's Discretion
- **Audio level meter fate:** recompute RMS in main from captured PCM (reusing `rms.utility.ts`) and keep the HUD `Audio:` row, OR drop the meter. **Lean: keep a main-computed meter** — distinguishes "audio flowing but silent" from "capture broken" during quiet stretches; planner may drop it.
- **Transcript IPC topology:** dedicated `jedi:transcript` channel vs reusing `jedi:status`. **Lean: dedicated one-way main→renderer transcript channel** — interim results fire many times/sec and would bloat the status payload. Stay one-way main→renderer either way.
- **TranscriptBuffer location:** **Lean strongly to main** — the websocket and capture both live in main, and Phase 5's main-side AI reads a span from it.
- **`ISttProvider` interface style:** **Lean event-emitter** — `start()`/`stop()`/`sendAudio(pcm)` plus typed events (`transcript` interim/final, `connection-state-change`, `error`), matching Deepgram v5's connection event model. (Researcher confirmed the v5 event shape — see below.)
- **Reconnect gap handling:** **Lean to drop PCM during the gap** for v1 (discard incoming PCM while disconnected, resume on reconnect). Planner may choose bounded-buffer-and-flush instead. Connection state surfaces on the overlay either way.
- Reconnect backoff curve (initial delay, max delay, jitter) and the exact connection-state values surfaced on the overlay.

### Deferred Ideas (OUT OF SCOPE)
- Dedicated always-on transcript content surface decoupled from the HUD toggle — Phase 5.
- `safeStorage`-backed key entry + settings window — Phase 6 (SET-01/SET-02).
- Local Whisper `ISttProvider` implementation — v2 (STT-V2-01); the seam is built here, no Whisper code now. (A Whisper stub gateway is noted for Phase 7.)
- Bounded-buffer-and-flush of PCM across reconnect gaps — only if the v1 drop-during-gap lean proves inadequate; not built speculatively.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| TRN-01 | Captured audio streamed to STT; live transcript updates on overlay | WASAPI capture (native addon, main) → resample utility (main) → `DeepgramSttGateway.sendMedia()` → `TranscriptBuffer` → dedicated `jedi:transcript` push → HUD render. Verified Deepgram v5 live-client shape (below). |
| TRN-02 | Transcript shows interim (partial) and final results | Deepgram v5 `message` event carries `ListenV1Results` with `is_final?: boolean`. Interim = `is_final` falsy; final = `is_final === true`. Render interim dimmed/italic (D-04). |
| TRN-03 | STT connection auto-reconnects if it drops mid-session | v5 `connect()` uses a built-in `ReconnectingWebSocket` (`reconnectAttempts`, default 30) PLUS the `close`/`error` events let the gateway implement its own backoff + a `connection-state-change` event surfaced on the overlay. |
| TRN-04 | Clear by hotkey; buffer auto-capped to bounded size | New Ctrl+Alt chord via `HotkeyRegistrarService` (D-07) calls `TranscriptBuffer.clear()`. Time-windowed bounding (D-06) with a hard segment/char ceiling. Both unit-testable. |
| TRN-05 | STT reached only through `ISttProvider` so backend is swappable | Event-emitter `ISttProvider` seam (`start`/`stop`/`sendAudio`/typed events) defined first; `DeepgramSttGateway` implements it; consumers (TranscriptBuffer feed, Phase 5 AI) depend on the interface only. |

</phase_requirements>

## Summary

The entire Phase 4 architecture is forced by one prior fact: on this machine, every Chromium `getDisplayMedia` capture path is silent (DXGI desktop-duplicator failure, Phase 3 NO-GO). Capture, resampling, the Deepgram socket, and the rolling buffer therefore all live in the **main process** — which happens to align perfectly with the existing main-owns-state / renderer-is-a-view boundary. The renderer's audio path (`audio-capture.service.ts`, `rms-meter.worklet.ts`) is dead code to be removed.

Two load-bearing de-risks dominate this phase. **(1) The native WASAPI module.** The CONTEXT's named candidate, the `naudiodon-loopback` (Axiver) fork, is **GitHub-only, not on npm, and requires `node-gyp` from-source compilation** — which means MSVC, which **failed on this machine in Phase 2**. Research found a materially better option: **`native-recorder-nodejs`**, which ships a **prebuilt `win32-x64` N-API binary directly inside the npm tarball** (`prebuilds/win32-x64/NativeAudioSDK.node`) and is **N-API/ABI-stable across all Electron versions** (so it does NOT need `@electron/rebuild` and does NOT need MSVC). It exposes exactly the API this phase needs: `getDevices('output')`, `getDeviceFormat(id)` (the actual sample rate / channels — required to satisfy the "assert declared == actual rate" rule), and an `AudioRecorder` EventEmitter that emits `'data'` Buffers of 16-bit LE PCM at the device's native rate (likely 48 kHz stereo). **Caveat:** it is young (created Nov 2025) and low-download (~60/week) — a supply-chain caution. The plan MUST gate it behind a one-time human go/no-go capture test before any pipeline is built on it, exactly as `uiohook` was gated. The in-main-process decision (D-01) remains viable with this package since the prebuilt binary loads in-process under Electron 35.7.5.

**(2) The Deepgram v5 live client.** Verified directly against the installed `@deepgram/sdk@5.4.0` type definitions (not from stale tutorials): `new DeepgramClient({ apiKey })` → `await client.listen.v1.connect({ model: 'nova-3', encoding: 'linear16', sample_rate: 16000, channels: 1, interim_results: true })` → returns a `V1Socket` with `.on('open'|'message'|'close'|'error')`, `.sendMedia(ArrayBuffer|ArrayBufferView)`, `.sendKeepAlive()`, `.sendCloseStream()`, `.close()`, `.waitForOpen()`, and a `readyState` getter. Transcript text is at `message.channel.alternatives[0].transcript` with `message.is_final`. The remaining work — down-mix 48 kHz stereo → 16 kHz mono Int16 in a pure `.utility.ts`, the time-bounded `TranscriptBuffer`, and reconnect/backoff with a surfaced connection state — is all standard, unit-testable, and low-risk.

**Primary recommendation:** Plan 04-01 first proves the native capture module on-machine (human go/no-go on `native-recorder-nodejs`) AND defines the `ISttProvider` + `DeepgramSttGateway` seam. Only after the capture gate passes do the resample pipeline, buffer, and reconnect/render plans build on it. Use `native-recorder-nodejs` (prebuilt N-API binary, no MSVC) over the Axiver `naudiodon-loopback` fork (from-source, MSVC-blocked on this machine).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| System-audio (WASAPI loopback) capture | Main (native addon) | — | D-01: in-process native addon; Chromium renderer path is dead (Phase 3). |
| PCM down-mix + resample to 16 kHz mono Int16 | Main (`.utility.ts`) | — | D-02: pure, unit-testable; renderer Web Audio retired. |
| Deepgram WebSocket (live STT) | Main (gateway behind `ISttProvider`) | — | Key must stay out of renderer (D-08); socket lifecycle is IO/state = main. |
| Rolling transcript buffer (time-bounded) | Main (`TranscriptBuffer`) | — | D-06; Phase 5 AI (main) reads a span; one source of truth. |
| Reconnect + backoff + connection state | Main (gateway) | — | Socket lives in main; state pushed read-only to renderer. |
| Clear-transcript hotkey | Main (`HotkeyRegistrarService`) | — | D-07; reuses Phase 2 passive-hook registrar. |
| Transcript + connection-state render | Renderer (`DebugHud`) | — | D-04/D-05: pure one-way view of pushed state. |
| Transcript IPC transport | Main → Renderer (dedicated `jedi:transcript` channel) | — | One-way main→renderer; high-frequency, kept off `jedi:status`. |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@deepgram/sdk` | `5.4.0` | Streaming STT over WebSocket (main process) | Official Deepgram SDK; v5 live client verified against installed types. Pure JS — no native build. `[VERIFIED: npm registry]` (existence + version) / `[CITED: developers.deepgram.com/docs/live-streaming-audio]` (API). |
| `native-recorder-nodejs` | `1.2.0` | WASAPI loopback (system audio) capture as an in-main-process native addon | Ships a **prebuilt `win32-x64` N-API `.node` in the npm tarball** (no MSVC, no `@electron/rebuild`); N-API = ABI-stable across all Electron versions; exposes `getDevices('output')` + `getDeviceFormat()` + `AudioRecorder` emitting 16-bit-LE PCM. **`[ASSUMED]`** — discovered via WebSearch; registry-verified but young/low-download; MUST pass on-machine go/no-go before adoption. See Package Legitimacy Audit + OQ-1. |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `electron-store` | `11.0.2` (already a dep) | (Not required by Phase 4 directly) | Key sourcing in Phase 4 is env var / untracked dev config (D-08), NOT electron-store. Listed only to note it is present; do not add key persistence here. |
| `@electron/rebuild` | `^4.0.1` (already a dev dep) | Rebuild native modules against the Electron ABI | **Not needed for `native-recorder-nodejs`** (N-API prebuilt). Needed only if a fallback non-N-API native module is ever chosen. |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `native-recorder-nodejs` | `naudiodon-loopback` (Axiver fork — the CONTEXT's named candidate) | **GitHub-only (not on npm), `node-gyp rebuild` from source = MSVC required = FAILS on this machine** (proven by uiohook in Phase 2). Bundles PortAudio but still compiles. Avoid unless a prebuilt path is found. |
| `native-recorder-nodejs` | `audiotee` (npm `0.0.7`) | 2025-recommended, clean API, but it is a **child-process sidecar wrapper around a prebuilt CLI executable**, not an in-process addon — would contradict D-01 (in-main-process) and reintroduce child-process PCM-framing plumbing. Viable as the D-01 fallback if the in-process addon fails (see OQ-1). slopcheck note: no source repo linked. |
| `native-recorder-nodejs` | `application-loopback` (npm `1.2.7`) | Per-process (PID-targeted) WASAPI capture, not whole-system loopback; wrong granularity for "capture everything the meeting plays." |
| `native-recorder-nodejs` | plain `naudiodon@2.3.6` | Does NOT expose loopback devices (D-03 confirmed) and is `node-gyp` from-source — both disqualifying. |
| Deepgram built-in `ReconnectingWebSocket` only | Gateway-level manual reconnect with custom backoff | The SDK's auto-reconnect handles transport drops, but a gateway-level state machine is still needed to surface `connection-state-change` to the overlay (TRN-03) and to drive the drop-PCM-during-gap policy. Use both: SDK reconnect for transport, gateway state for UX. |

**Installation:**
```bash
npm install @deepgram/sdk@5.4.0 native-recorder-nodejs@1.2.0
# No rebuild step: native-recorder-nodejs ships a prebuilt win32-x64 N-API binary.
# (Contrast: uiohook-napi required `npm run rebuild`; this package does not.)
```

**Version verification (performed this session):**
- `@deepgram/sdk` → `npm view` returns `5.4.0` (matches CLAUDE.md). `[VERIFIED: npm registry]`
- `native-recorder-nodejs` → `npm view` returns `1.2.0`, modified `2026-01-29`, created `2026-11-26` [sic — registry `time.created` shows 2025-11-26]. Tarball inspection confirmed `prebuilds/win32-x64/NativeAudioSDK.node` is present and the loader `require()`s it directly. `[ASSUMED]` (registry existence ≠ trust; see audit).

## Package Legitimacy Audit

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| `@deepgram/sdk` | npm | mature | ~639k/wk | github.com/deepgram/deepgram-js-sdk | [OK] | Approved |
| `native-recorder-nodejs` | npm | new (created 2025-11-26) | ~63/wk | github.com/Yidadaa/Native-Recorder-NodeJS | [OK] ("not exactly popular") | **Flagged — planner MUST add a `checkpoint:human-verify` capture go/no-go before any pipeline is built on it (mirrors the uiohook native-module gate).** |
| `audiotee` | npm | new (`0.0.7`) | low | none linked | [OK] ("no source repository linked") | Fallback only (child-process sidecar; contradicts D-01). Re-audit if promoted. |
| `application-loopback` | npm | `1.2.7` | low | github.com/WerdoxDev/application-loopback | [OK] | Not selected (per-process, wrong granularity). |

**Packages removed due to slopcheck [SLOP] verdict:** none.
**Packages flagged as suspicious [SUS]:** none by slopcheck, but `native-recorder-nodejs` is independently flagged here as **low-trust by maturity/downloads**. The disposition above (human-verify checkpoint) is the mitigation. The binary is bundled in the tarball, so no install-time network fetch occurs; still, the planner should pin the exact version and commit the lockfile, and the human gate validates the binary actually loads and captures on this machine.

> slopcheck `0.6.1` was available and run this session; all four candidates returned `[OK]`. The `native-recorder-nodejs` flag is a research judgment (age/downloads + the fact it was discovered via WebSearch), not a slopcheck verdict — hence `[ASSUMED]` in the stack table and the mandatory human checkpoint.

## Architecture Patterns

### System Architecture Diagram

```
                            ELECTRON MAIN PROCESS
  ┌──────────────────────────────────────────────────────────────────────┐
  │                                                                        │
  │  native-recorder-nodejs (AudioRecorder, in-process N-API addon)        │
  │    AudioRecorder.getDevices('output') → pick default output device     │
  │    AudioRecorder.getDeviceFormat(id)  → {sampleRate, channels, ...}     │
  │         │  .on('data', Buffer)  ── 16-bit LE PCM, device-native rate    │
  │         ▼      (likely 48 kHz stereo)                                   │
  │  pcm-resample.utility.ts (PURE, unit-tested)                           │
  │    downmix stereo→mono + resample → 16 kHz mono Int16                   │
  │    ASSERT declared sampleRate === getDeviceFormat().sampleRate          │
  │         │  Int16Array chunks (~100 ms cadence)                          │
  │         ├───────────────► rms.utility.computeRms() ──► (optional)       │
  │         │                                            main audio-level   │
  │         ▼                                            → jedi:status row  │
  │  ISttProvider (seam)  ◄── consumers depend on THIS, not Deepgram        │
  │    DeepgramSttGateway implements ISttProvider                          │
  │      new DeepgramClient({ apiKey })   (key from env/dev-config, D-08)   │
  │      conn = await client.listen.v1.connect({ model:'nova-3',           │
  │              encoding:'linear16', sample_rate:16000, channels:1,        │
  │              interim_results:true })                                    │
  │      conn.sendMedia(int16.buffer)                                       │
  │      conn.on('message'|'open'|'close'|'error')                          │
  │         │  emits: 'transcript'{text,isFinal} | 'connection-state-change'│
  │         ▼                                                               │
  │  TranscriptBuffer (main, time-bounded, hard ceiling)                   │
  │    append(final) → drop segments older than N minutes                  │
  │    interim held separately (replaced, never accumulated)               │
  │    clear()  ◄──── HotkeyRegistrarService (new Ctrl+Alt chord, D-07)    │
  │         │  renderable window {finalText, interimText, connState}        │
  │         ▼                                                               │
  │  push over dedicated one-way channel:  jedi:transcript                  │
  └─────────────────────────────────┬──────────────────────────────────────┘
                                     │ contextBridge (read-only)
                                     ▼
                            RENDERER (DebugHud)
              renders finalText (normal) + interimText (dimmed/italic)
              + connection-state indicator; hidden when HUD toggled off (D-05)
```

### Recommended Project Structure
```
src/main/
├── stt/
│   ├── stt-provider.interface.ts        # ISttProvider + event payload types (TRN-05, define FIRST)
│   ├── deepgram-stt.gateway.ts          # implements ISttProvider over @deepgram/sdk v5
│   └── transcript-buffer.ts             # time-bounded rolling buffer (D-06) + .test.ts
├── audio/
│   ├── audio-capture.service.ts         # wraps native-recorder-nodejs AudioRecorder (main)
│   └── pcm-resample.utility.ts          # downmix+resample 48k stereo → 16k mono Int16 + .test.ts
├── index.ts                             # bootstrap: init capture, wire gateway→buffer→push
├── overlay-window.manager.ts            # add jedi:transcript channel + payload; remove jedi:audio-level (IN-01)
└── hotkey-registrar.service.ts          # add clear-transcript chord (D-07)

src/renderer/src/
├── components/debug-hud.tsx             # extend: transcript + connection-state rows (D-04/D-05); fix onStatus unsub (WR-03)
└── (DELETE) audio/rms-meter.worklet.ts, services/audio-capture.service.ts   # D-02 retirement
                                         # rms.utility.ts: MOVE/REUSE math in main (D-02 follow-on)
```

### Pattern 1: Verified Deepgram v5 live transcription (main process)
**What:** Open a live connection, stream Int16 PCM, consume interim/final messages.
**When to use:** The `DeepgramSttGateway` body.
**Example:**
```typescript
// Source: VERIFIED against installed @deepgram/sdk@5.4.0 type defs (V1Client.ConnectArgs,
// V1Socket, ListenV1Results) + CITED https://developers.deepgram.com/docs/live-streaming-audio
import { DeepgramClient } from '@deepgram/sdk';

const client = new DeepgramClient({ apiKey }); // apiKey from env/dev-config (D-08), main-only

const connection = await client.listen.v1.connect({
    model: 'nova-3',
    encoding: 'linear16',   // ListenV1Encoding.Linear16 (verified enum)
    sample_rate: 16000,     // required & only read when encoding is provided (verified doc)
    channels: 1,
    interim_results: true,  // accepts boolean | 'true' (verified union type)
    // optional but useful for a meeting aid:
    smart_format: true,     // punctuation/formatting
    // reconnectAttempts defaults to 30 (built-in ReconnectingWebSocket)
});

connection.on('open', () => {/* emit connection-state-change: 'connected' */});

connection.on('message', (message) => {
    // message.type === 'Results' (ListenV1Results)
    const alt = message.channel?.alternatives?.[0];
    const text = alt?.transcript ?? '';
    if (text.length === 0) return;
    const isFinal = message.is_final === true; // interim when falsy (TRN-02)
    // emit 'transcript' { text, isFinal }
});

connection.on('close', () => {/* emit 'disconnected'; gateway backoff + reconnect (TRN-03) */});
connection.on('error', (err) => {/* emit 'error'; do NOT crash the app */});

// stream PCM (Int16Array → its ArrayBuffer):
connection.sendMedia(int16Chunk.buffer); // sendMedia(ArrayBuffer | ArrayBufferView)

// keep-alive during silence so Deepgram doesn't close the socket on idle:
// connection.sendKeepAlive({}) on a timer (~5–8s) when no audio is flowing.

// teardown:
// connection.sendCloseStream({}); connection.close();
```

### Pattern 2: Down-mix + resample to 16 kHz mono Int16 (pure utility)
**What:** Convert device-native PCM (likely 48 kHz stereo, 16-bit LE from `native-recorder-nodejs`) to 16 kHz mono Int16 for `encoding: 'linear16', sample_rate: 16000`.
**When to use:** `pcm-resample.utility.ts` — pure, idempotent, unit-tested (IDEXX `.utility.ts` rules).
**Example:**
```typescript
// Source: ASSUMED (standard DSP) — linear interpolation resample is adequate for STT.
// native-recorder-nodejs emits a Node Buffer of interleaved 16-bit LE samples.

/** Read interleaved Int16 LE stereo Buffer → mono Float32 in [-1, 1]. */
export function downmixToMonoFloat32(pcm: Buffer, channels: number): Float32Array {
    const frames = pcm.length / 2 / channels;          // 2 bytes/sample
    const out = new Float32Array(frames);
    for (let frame = 0; frame < frames; frame++) {
        let sum = 0;
        for (let channel = 0; channel < channels; channel++) {
            const sample = pcm.readInt16LE((frame * channels + channel) * 2);
            sum += sample / 32768;                      // normalize to [-1, 1)
        }
        out[frame] = sum / channels;                    // average channels = downmix
    }
    return out;
}

/** Linear-interpolation resample mono Float32 from inRate → outRate. */
export function resampleLinear(input: Float32Array, inRate: number, outRate: number): Float32Array {
    if (inRate === outRate) return input;
    const ratio = inRate / outRate;
    const outLength = Math.floor(input.length / ratio);
    const out = new Float32Array(outLength);
    for (let index = 0; index < outLength; index++) {
        const position = index * ratio;
        const left = Math.floor(position);
        const right = Math.min(left + 1, input.length - 1);
        const fraction = position - left;
        out[index] = input[left] * (1 - fraction) + input[right] * fraction;
    }
    return out;
}

/** Float32 [-1,1] → Int16 LE for Deepgram linear16. */
export function float32ToInt16(input: Float32Array): Int16Array {
    const out = new Int16Array(input.length);
    for (let index = 0; index < input.length; index++) {
        const clamped = Math.max(-1, Math.min(1, input[index]));
        out[index] = clamped < 0 ? clamped * 32768 : clamped * 32767;
    }
    return out;
}
```
**Note on the "assert declared == actual rate" rule (ROADMAP Notes):** call `AudioRecorder.getDeviceFormat(deviceId)` at start and assert `format.sampleRate` equals the rate you pass to `resampleLinear` as `inRate`. If the device reports an unexpected rate, fail loudly (do NOT silently mis-resample → garbled transcript). The resample target (`16000`) is what you declare to Deepgram as `sample_rate`.

### Pattern 3: Time-bounded TranscriptBuffer (D-06)
**What:** Keep only the last N minutes of finalized transcript; hold one current interim separately; hard ceiling.
**When to use:** `transcript-buffer.ts` — main-owned, unit-tested.
**Example:**
```typescript
// Source: ASSUMED (standard ring-by-time pattern). Inject a clock for deterministic tests.
interface ITranscriptSegment { text: string; at: number; } // at = epoch ms (final segment)

const WINDOW_MS = 90_000;        // N minutes — planner sets; ≥ Phase 5's ~60s span + headroom
const MAX_SEGMENTS = 400;        // hard ceiling so a stuck clock can't grow unbounded
const MAX_TOTAL_CHARS = 20_000;  // second hard memory ceiling

export class TranscriptBuffer {
    private finals: ITranscriptSegment[] = [];
    private interim = '';
    public constructor(private readonly now: () => number = Date.now) {}

    public appendFinal(text: string): void {
        this.finals.push({ text, at: this.now() });
        this.interim = '';
        this.prune();
    }
    public setInterim(text: string): void { this.interim = text; }
    public clear(): void { this.finals = []; this.interim = ''; }       // TRN-04 hotkey

    private prune(): void {
        const cutoff = this.now() - WINDOW_MS;
        this.finals = this.finals.filter((segment) => segment.at >= cutoff);
        while (this.finals.length > MAX_SEGMENTS) this.finals.shift();
        let total = this.finals.reduce((sum, s) => sum + s.text.length, 0);
        while (total > MAX_TOTAL_CHARS && this.finals.length > 0) {
            total -= (this.finals.shift() as ITranscriptSegment).text.length;
        }
    }
    /** Phase 5 reads a recent span by time. */
    public recentSince(ms: number): string {
        const cutoff = this.now() - ms;
        return this.finals.filter((s) => s.at >= cutoff).map((s) => s.text).join(' ');
    }
    public renderable(): { finalText: string; interimText: string } {
        return { finalText: this.finals.map((s) => s.text).join(' '), interimText: this.interim };
    }
}
```

### Pattern 4: Reconnect with backoff + surfaced state (TRN-03)
**What:** The SDK's `ReconnectingWebSocket` handles transport drops; the gateway tracks a coarse connection state for the overlay and applies the drop-PCM-during-gap policy.
**Example:**
```typescript
// Source: ASSUMED (standard exp-backoff) + CITED (reconnectAttempts is a verified ConnectArgs field).
type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'error';
// Lean backoff: initial 500 ms, ×2, max 8 s, ±20% jitter. (Used only if the gateway drives its own
// reconnect on 'close'; if relying on the SDK's built-in reconnect, just mirror its state.)
// Drop-PCM-during-gap (D-06 lean): in sendAudio(), early-return when state !== 'connected'.
```

### Anti-Patterns to Avoid
- **Running capture or the Deepgram socket in the renderer.** Forbidden by D-01/D-02/D-08 and impossible on this machine (Phase 3). All of it is main-side.
- **Choosing `naudiodon-loopback` (Axiver) or any `node-gyp` package.** From-source build = MSVC = fails on this machine (Phase 2 precedent). Use the prebuilt N-API package.
- **Trusting `native-recorder-nodejs` blind.** Young/low-download. Gate with a human capture go/no-go first.
- **Accumulating interim results.** Interim text is replaced on each `message`, not appended; only `is_final` segments are committed to the buffer (otherwise the transcript duplicates and grows).
- **Skipping the sample-rate assertion.** A wrong `inRate` silently produces pitch-shifted, mis-aligned audio → garbage transcript with no error. Assert against `getDeviceFormat()`.
- **No keep-alive during silence.** Deepgram closes idle sockets; send `sendKeepAlive({})` on a timer when no PCM is flowing, or the connection drops during quiet stretches and churns reconnects.
- **Bloating `jedi:status` with interim transcript.** Interim fires many times/sec; use the dedicated `jedi:transcript` channel (discretion lean).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| WASAPI loopback capture | A custom C++ WASAPI addon | `native-recorder-nodejs` (prebuilt N-API) | COM/WASAPI lifecycle, device enumeration, format negotiation, and the prebuilt-binary toolchain are deep; this machine can't even compile it. |
| Live STT WebSocket protocol | A raw `ws` client to `api.deepgram.com/v1/listen` | `@deepgram/sdk@5` `listen.v1.connect` | The SDK already wraps auth, query-param encoding, keep-alive helpers, and a `ReconnectingWebSocket`. CLAUDE.md mandates the SDK. |
| WebSocket reconnect | A bespoke reconnect loop from scratch | SDK's built-in `ReconnectingWebSocket` (`reconnectAttempts`) + a thin gateway state machine for UX | Transport-level reconnect is already implemented; you only add the surfaced `connection-state-change`. |
| Resampling | A polyphase/FIR resampler library | Inline linear interpolation in a `.utility.ts` | STT tolerates linear interpolation; a DSP lib is overkill and adds a native/build dependency. (Reconsider only if transcript quality suffers.) |

**Key insight:** The two genuinely hard problems (native audio capture, the streaming protocol) are solved by mature/official packages; the bespoke code is just glue (resample, buffer, IPC push) and is all pure and unit-testable. The risk is concentrated entirely in proving the one young native package works on this machine.

## Runtime State Inventory

> This phase is partly a rename/retirement of the Phase 3 renderer audio path (D-02, IN-01), so the inventory applies.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — Phase 4 persists nothing; key comes from env/dev-config (D-08), buffer is in-memory only. Verified by reading CONTEXT D-08 and the absence of any electron-store write in scope. | None. |
| Live service config | Deepgram account/API key (external service). Sourced from env var or untracked local dev config at runtime (D-08); not in git. | Document the env var name in plan; ensure `.gitignore` covers any dev-config file. |
| OS-registered state | None new. Existing uiohook hotkey registration is reused for the clear chord (D-07) — no new OS registration beyond one more keycode in the existing hook. | None beyond adding the chord. |
| Secrets/env vars | New: a Deepgram API key env var / dev-config entry (D-08). Must never reach renderer, logs, or commits (SET-03). | Plan adds the read in main only; verify no `console.log` of the key. |
| Build artifacts / dead code | **Renderer audio path is now dead:** `src/renderer/src/audio/rms-meter.worklet.ts`, `src/renderer/src/services/audio-capture.service.ts` (D-02). The rollup worklet entry in `electron.vite.config.ts` (`assets/rms-meter.worklet.js`) and the `jedi:audio-level` IPC (`ipcMain.on('jedi:audio-level')` in `index.ts`, `reportAudioLevel` in `preload/index.ts`, `AUDIO_LEVEL_CHANNEL`) are orphaned (IN-01). `rms.utility.ts` math is REUSED (move to main per D-02 follow-on). | **Remove** the two renderer files + the worklet rollup entry + the `jedi:audio-level` channel/handler/preload method (IN-01). The renderer `getDisplayMedia`/`setDisplayMediaRequestHandler` in `index.ts` is also dead (Chromium path NO-GO) and should be removed in the same rework. Watch `electron.vite.config.ts` for the now-unused worklet input. |

**Nothing found in category:** Stored data — None (verified, in-memory only). OS-registered state — None new (verified).

## Common Pitfalls

### Pitfall 1: Assuming `naudiodon-loopback` is installable
**What goes wrong:** Plan installs `naudiodon-loopback`; `npm install` triggers `node-gyp rebuild`; no MSVC → build fails → no binary → app can't capture.
**Why it happens:** The CONTEXT named the Axiver fork before research; it is GitHub-only and from-source.
**How to avoid:** Use `native-recorder-nodejs` (prebuilt N-API). Verify `node_modules/native-recorder-nodejs/prebuilds/win32-x64/NativeAudioSDK.node` exists after install.
**Warning signs:** `node-gyp`, `MSB`, `cl.exe`, or `gyp ERR!` in install output.

### Pitfall 2: Sample-rate mismatch → garbled transcript with no error
**What goes wrong:** You assume 48 kHz but the device is 44.1 kHz (or 16-bit vs the addon's `rawBitDepth`); the resampler uses the wrong `inRate`; Deepgram receives pitch/timing-shifted audio and returns nonsense — silently.
**Why it happens:** Output format is "device-native rate on Windows," not fixed.
**How to avoid:** Call `getDeviceFormat(deviceId)` and assert `inRate === format.sampleRate` and `channels === format.channels` before resampling (ROADMAP rule). Fail loudly on mismatch.
**Warning signs:** Transcript is consistently wrong words / wrong cadence while RMS looks healthy.

### Pitfall 3: Deepgram closes the socket during silence
**What goes wrong:** A quiet stretch (no one talking) → no PCM sent → Deepgram idle-times-out → `close` → reconnect churn.
**Why it happens:** Streaming connections require periodic data or keep-alive.
**How to avoid:** `connection.sendKeepAlive({})` on a ~5–8s timer whenever no audio chunk was sent in the interval. (Verified method on `V1Socket`.)
**Warning signs:** Repeated `close`/reconnect in logs during silent periods.

### Pitfall 4: In-process native crash kills the app (D-01 accepted trade-off)
**What goes wrong:** A bug in the addon segfaults the whole Electron main process — overlay vanishes mid-meeting.
**Why it happens:** D-01 chose in-process for simplicity; there is no process isolation.
**How to avoid:** Wrap `AudioRecorder.start()`/device calls in try/catch (JS-level errors), guard `getDevices('output')` returning empty (WR-01 equivalent), make `start()` idempotent (WR-02), and surface capture errors to the HUD rather than throwing. A native segfault can't be caught — this is the documented accepted risk; the human go/no-go gate is the mitigation. If it proves unstable, the `audiotee` child-process sidecar is the escape hatch (OQ-1).
**Warning signs:** App exits with no JS stack trace during capture.

### Pitfall 5: React Strict Mode double-mount leaks listeners / double-starts capture
**What goes wrong:** `DebugHud`'s `useEffect` subscribes to `onStatus`/`onTranscript` twice; capture `start()` called twice.
**Why it happens:** Strict Mode double-invokes effects in dev; the current `onStatus` has no unsubscribe (WR-03).
**How to avoid:** `onStatus`/`onTranscript` must **return an unsubscribe fn** (store the `ipcRenderer` listener and `removeListener` in cleanup, WR-03). Capture `start()` must early-return if already capturing (WR-02). These are folded todos — implement them in this phase.
**Warning signs:** Duplicate transcript rendering; growing listener count.

## Code Examples

### Enumerate the system-audio output device and assert its format (main)
```typescript
// Source: VERIFIED against installed native-recorder-nodejs@1.2.0 dist/index.d.ts
import { AudioRecorder } from 'native-recorder-nodejs';

const outputs = AudioRecorder.getDevices('output');     // WASAPI render/output endpoints
if (outputs.length === 0) {
    // WR-01 equivalent: no capturable device — surface to HUD, do not throw blindly.
    throw new Error('No system-audio output device available for loopback capture.');
}
const device = outputs.find((d) => d.isDefault) ?? outputs[0];
const format = AudioRecorder.getDeviceFormat(device.id); // { sampleRate, channels, bitDepth, rawBitDepth }

const recorder = new AudioRecorder();
recorder.on('data', (buffer: Buffer) => {
    // 16-bit LE PCM at format.sampleRate / format.channels (device-native on Windows).
    // → downmixToMonoFloat32(buffer, format.channels) → resampleLinear(_, format.sampleRate, 16000)
    //   → float32ToInt16(_) → sttProvider.sendAudio(int16)
});
recorder.on('error', (error: Error) => {/* surface to HUD; never crash */});
await recorder.start({ deviceType: 'output', deviceId: device.id }); // loopback capture
```

### ISttProvider seam (define FIRST, TRN-05)
```typescript
// Source: ASSUMED (shape chosen to match the verified Deepgram v5 event model).
export interface ISttTranscriptEvent { text: string; isFinal: boolean; }
export type SttConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'error';

export interface ISttProvider {
    start(): Promise<void>;
    stop(): Promise<void>;
    sendAudio(pcm: Int16Array): void;          // drops internally when not connected (D-06 lean)
    on(event: 'transcript', listener: (e: ISttTranscriptEvent) => void): void;
    on(event: 'connection-state-change', listener: (state: SttConnectionState) => void): void;
    on(event: 'error', listener: (error: Error) => void): void;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Deepgram v3/v4 `listen.transcription.live()`, `transcript` event | v5 `client.listen.v1.connect()` (async) + `message` event with `type` check | SDK v5 (breaking) | Use v5 only; v3/v4 tutorials are wrong for this codebase. Verified against installed `5.4.0`. |
| Chromium `getDisplayMedia({audio:'loopback'})` for system audio | Native WASAPI addon in main (`native-recorder-nodejs`) | This project, Phase 3 NO-GO | The Chromium path is dead on this machine (DXGI failure). |
| `naudiodon` / `naudiodon-loopback` (node-gyp from source) | Prebuilt N-API addon (no MSVC, no rebuild) | — | Removes the MSVC build dependency that blocks this machine. |
| `ScriptProcessorNode` for PCM conversion | Pure main-process resample utility (no Web Audio at all) | D-02 | Renderer Web Audio retired entirely; conversion is plain TS, unit-tested. |

**Deprecated/outdated:**
- Renderer audio path (`audio-capture.service.ts`, `rms-meter.worklet.ts`, `jedi:audio-level`): retired (D-02/IN-01).
- `nova-2`/`nova` models: `nova-3` is current and verified in the enum; use it.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `native-recorder-nodejs@1.2.0` reliably captures whole-system loopback on THIS machine under Electron 35.7.5 | Standard Stack / OQ-1 | High — it's the capture foundation. Mitigated by the mandatory human go/no-go gate (do FIRST, before pipeline). |
| A2 | The device emits ~48 kHz stereo 16-bit LE (so downmix+resample to 16 kHz mono is needed) | Patterns 2 | Low/Medium — the `getDeviceFormat()` assertion catches any deviation; code reads the real format, doesn't hardcode it. |
| A3 | Linear-interpolation resample is good enough for Deepgram accuracy | Don't Hand-Roll / Pattern 2 | Low — standard for STT; revisit only if transcripts degrade. |
| A4 | `connection.sendMedia(int16.buffer)` accepts the Int16Array's ArrayBuffer directly | Pattern 1 | Low — signature is `ArrayBuffer | Blob | ArrayBufferView` (verified); Int16Array is an ArrayBufferView, so passing the view itself also works. |
| A5 | Deepgram idle-closes silent sockets; keep-alive needed | Pitfall 3 | Low — documented Deepgram behavior; `sendKeepAlive` is a verified method. |
| A6 | The Deepgram client auto-supplies `Authorization` on `connect()` from `apiKey` (the required `Authorization` ConnectArg is filled by the auth provider) | Pattern 1 | Low — `HeaderAuthProvider` with `PARAM_KEY:'apiKey'` is verified; official docs show `connect({ model })` without a manual Authorization. Confirm at build time. |
| A7 | N = ~90s window for `TranscriptBuffer` (planner sets exact value ≥ Phase 5's ~60s span) | Pattern 3 | Low — tunable; D-06 leaves N to the planner. |

## Open Questions

1. **OQ-1 — Does `native-recorder-nodejs` actually capture system loopback on this MSI machine under Electron 35.7.5? (THE de-risk, do first)**
   - What we know: It ships a prebuilt `win32-x64` N-API binary in the npm tarball; N-API is ABI-stable across Electron versions; the loader `require()`s the bundled `.node` with no install-time network fetch; the README claims Windows WASAPI output capture and Electron support. slopcheck `[OK]`.
   - What's unclear: (a) the binary loads under Electron 35.7.5's specific runtime in-process; (b) it captures real non-silent loopback (not just mic) on this hardware; (c) stability under continuous capture (D-01 in-process crash risk).
   - Recommendation: Plan 04-01 includes a **`checkpoint:human-verify` capture spike** — install, load the addon in main, `getDevices('output')`, start capture on the default output, compute main-side RMS, and confirm a non-zero signal while media plays (mirrors the Phase 3 gate, but now via WASAPI). Record a short go/no-go note. **If NO-GO:** fall back to `audiotee` as a **child-process sidecar** (accepting the D-01 deviation — child process — and the extra PCM-framing plumbing). Do NOT build the resample/gateway/buffer plans until this passes.

2. **OQ-2 — Exact clear-transcript chord (D-07).**
   - What we know: Must be Ctrl+Alt + a letter not in {J, arrows, [, ], H, Q}; registered through `HotkeyRegistrarService`; conflict-re-checked vs Teams/Zoom/VS Code.
   - Recommendation: Suggest `Ctrl+Alt+K` (clear) or `Ctrl+Alt+X`; planner finalizes and re-runs the Phase 2 conflict check on the target machine. Add a cheat-sheet row in `DebugHud`.

3. **OQ-3 — Keep or drop the main-computed audio meter (D-02 follow-on discretion).**
   - What we know: `rms.utility.computeRms()` is reusable; the meter distinguishes "silent but capturing" from "broken."
   - Recommendation: Keep it for this phase (audio is the load-bearing risk; the meter is cheap and aids the OQ-1 spike). Drop later if the transcript itself proves sufficient. Feed it over `jedi:status` (low-frequency, ~12 Hz) — keep transcript on its own channel.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Electron | App shell / main process | ✓ | 35.7.5 (pinned) | — |
| Prebuilt MSVC / Visual Studio Build Tools | Only if a from-source native module is chosen | ✗ | — | Avoid from-source modules; use prebuilt N-API (`native-recorder-nodejs`). |
| `@electron/rebuild` | Non-N-API native modules | ✓ (dev dep) | ^4.0.1 | Not needed for the chosen package. |
| Deepgram API key | `DeepgramSttGateway` | ⚠ user-supplied | — | None — required for a live transcript (success criterion 1). Sourced via env/dev-config (D-08). |
| Network egress to `api.deepgram.com` | Live STT | ⚠ assumed | — | None for v1 (Whisper local is v2). |
| `native-recorder-nodejs` prebuilt `win32-x64` binary | WASAPI capture | ⚠ ships in tarball; **load-on-this-machine UNVERIFIED** | 1.2.0 | `audiotee` child-process sidecar (OQ-1). |

**Missing dependencies with no fallback:**
- A valid Deepgram API key and network egress — required to demonstrate the live transcript. The planner should make the human-verify capture spike (OQ-1) independent of the key (RMS-only) so capture can be gated even before a key is configured.

**Missing dependencies with fallback:**
- MSVC build tools — avoided entirely by choosing the prebuilt N-API package.
- In-process addon stability — `audiotee` child-process sidecar is the documented escape hatch.

## Validation Architecture

> `workflow.nyquist_validation` is `true` in config.json — this section is included.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 3.2.4 (already configured) |
| Config file | `vitest.config.ts` (`environment: 'node'`, `include: ['src/**/*.test.ts']`) |
| Quick run command | `npx vitest run src/main/audio/pcm-resample.utility.test.ts` (specific file) |
| Full suite command | `npm test` (`vitest run`) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| TRN-01 (resample) | 48 kHz stereo Buffer → 16 kHz mono Int16 sample count & values | unit | `npx vitest run src/main/audio/pcm-resample.utility.test.ts` | ❌ Wave 0 |
| TRN-01 (rate assert) | mismatched declared vs actual rate throws | unit | same file | ❌ Wave 0 |
| TRN-02 | interim (`is_final` falsy) vs final mapping from a mock `ListenV1Results` | unit | `npx vitest run src/main/stt/deepgram-stt.gateway.test.ts` (mock the SDK socket) | ❌ Wave 0 |
| TRN-03 | gateway emits `connection-state-change` on `open`/`close`/`error`; backoff schedule | unit | `npx vitest run src/main/stt/deepgram-stt.gateway.test.ts` | ❌ Wave 0 |
| TRN-04 (bounding) | segments older than N pruned; hard ceilings enforced (inject clock) | unit | `npx vitest run src/main/stt/transcript-buffer.test.ts` | ❌ Wave 0 |
| TRN-04 (clear) | `clear()` empties buffer; clear chord handler calls it | unit | `transcript-buffer.test.ts` + `hotkey-registrar.service.test.ts` (extend) | partial (registrar test exists) |
| TRN-05 | consumers depend only on `ISttProvider`; `DeepgramSttGateway` satisfies it | unit (type-level + mock) | `npx vitest run src/main/stt/deepgram-stt.gateway.test.ts` | ❌ Wave 0 |
| TRN-01 (live, end-to-end) | real Deepgram transcript appears on overlay | **manual** | human run with a real key + audio | n/a — not unit-testable |
| TRN-01 (capture, on-machine) | WASAPI loopback produces non-silent PCM | **manual** (OQ-1 gate) | human go/no-go capture spike | n/a — not unit-testable |

### Sampling Rate
- **Per task commit:** the specific `npx vitest run <file>` for the unit-testable seam touched.
- **Per wave merge:** `npm test` (full Vitest suite).
- **Phase gate:** Full suite green before `/gsd:verify-work`; PLUS the two manual gates (capture go/no-go, live-transcript demo) recorded.

### Wave 0 Gaps
- [ ] `src/main/audio/pcm-resample.utility.test.ts` — covers TRN-01 (downmix, resample, rate assertion)
- [ ] `src/main/stt/transcript-buffer.test.ts` — covers TRN-04 (time bounding, ceilings, clear)
- [ ] `src/main/stt/deepgram-stt.gateway.test.ts` — covers TRN-02/03/05 (interim/final mapping, state events, seam) with a mocked `V1Socket`
- [ ] Extend `src/main/hotkey-registrar.service.test.ts` — clear-transcript chord wiring (D-07)
- [ ] No framework install needed (Vitest present). No `conftest`-equivalent needed; mock the Deepgram SDK and the native addon at module boundary.

## Security Domain

> `security_enforcement` is not set in config.json (absent = enabled). Included.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | No user auth in this phase. |
| V3 Session Management | no | No sessions. |
| V4 Access Control | no | Single local user. |
| V5 Input Validation | yes | Validate/coerce data crossing IPC and the native-addon boundary: transcript payload is text only; the (optional) audio-level scalar is already coerced via `setAudioLevel` (non-finite → 0). Treat Deepgram `message` payloads defensively (`?.` chains; empty-transcript guard). |
| V6 Cryptography | yes (key handling) | Deepgram key never in renderer/logs/commits (SET-03/D-08). Phase 6 adds `safeStorage`; Phase 4 reads from env/untracked dev-config in main only. Do not log the key or full request URLs that embed it. |

### Known Threat Patterns for Electron + native addon + cloud STT
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| API key leakage to renderer/logs/commits | Information Disclosure | Read key in main only; never push it over IPC; gitignore dev-config; no `console.log(key)`; one-way read-only `jedi:transcript` carries text only. |
| Supply-chain (young native package executing in-process) | Tampering/Elevation | slopcheck `[OK]` + human capture gate + pinned version + committed lockfile; prebuilt binary is in-tarball (no install-time fetch). |
| Untrusted data over IPC controlling flow | Tampering | Transcript channel is one-way main→renderer, render-only; renderer cannot send control messages (boundary preserved; `jedi:audio-level` write channel removed per IN-01, shrinking the write surface to zero). |
| Audio (privacy) sent to a third party (Deepgram) | Information Disclosure | Accepted for v1 per PROJECT constraints; documented; Whisper-local is the v2 privacy fallback behind the same seam. |

## Sources

### Primary (HIGH confidence)
- Installed `@deepgram/sdk@5.4.0` type definitions (inspected from the npm tarball this session): `V1Client.ConnectArgs`, `V1Socket` (`on('open'|'message'|'close'|'error')`, `sendMedia`, `sendKeepAlive`, `sendCloseStream`, `close`, `waitForOpen`, `readyState`), `ListenV1Results` (`is_final`, `channel.alternatives[].transcript`), `ListenV1Encoding.Linear16`, `ListenV1Model.Nova3`, `HeaderAuthProvider` (`apiKey` auth) — HIGH.
- Installed `native-recorder-nodejs@1.2.0` `dist/index.d.ts` + tarball contents (`prebuilds/win32-x64/NativeAudioSDK.node`, `dist/bindings.js` loader): `AudioRecorder`, `getDevices`, `getDeviceFormat`, `RecordingConfig{deviceType:'output'}`, `'data'`/`'error'` events, 16-bit LE PCM, N-API prebuild loading — HIGH (for API shape; on-machine load UNVERIFIED = OQ-1).
- npm registry (`npm view`): `@deepgram/sdk@5.4.0`, `native-recorder-nodejs@1.2.0`, `naudiodon@2.3.6` (gypfile, `install: node-gyp rebuild`), `audiotee@0.0.7`, `application-loopback@1.2.7` — HIGH.
- slopcheck `0.6.1` (run this session) — all four candidates `[OK]` — HIGH.
- Project files: CLAUDE.md (§@deepgram/sdk, §System audio loopback, §What NOT to Use, §Version Compatibility), 03-LOOPBACK-GATE.md, all Phase 4 CONTEXT + ROADMAP + STATE; existing source (`index.ts`, `overlay-window.manager.ts`, `hotkey-registrar.service.ts`, `preload/index.ts`, `debug-hud.tsx`, `rms.utility.ts`, `audio-capture.service.ts`) — HIGH.

### Secondary (MEDIUM confidence)
- https://developers.deepgram.com/docs/live-streaming-audio and /docs/transcribe-meetings-in-realtime — v5 `connect()` async, `waitForOpen()`, `message` event, `createConnection()` alias — MEDIUM (corroborates the verified types).
- https://github.com/Yidadaa/Native-Recorder-NodeJS (README) — Windows WASAPI output capture, N-API ABI stability, Electron support claim — MEDIUM.
- https://github.com/Axiver/naudiodon-loopback — confirms the Axiver fork is `node-gyp` from-source, bundles PortAudio, no prebuilt binaries — MEDIUM (basis for rejecting it).

### Tertiary (LOW confidence)
- WebSearch result describing `native-recorder-nodejs` "prebuilt binaries for Electron 29-40" and `audiotee` as the 2025-recommended sidecar — LOW (corroborated for `native-recorder-nodejs` by direct tarball inspection; `audiotee` sidecar nature corroborated by its `huxinhai/audiotee-wasapi` CLI repo).

## Metadata

**Confidence breakdown:**
- Standard stack (Deepgram v5): HIGH — verified against installed types + official docs.
- Standard stack (WASAPI capture package): MEDIUM — concrete prebuilt-binary path verified in the tarball, but on-machine load/capture unverified (OQ-1) and package is young/low-download.
- Architecture / patterns: HIGH — forced by prior decisions + verified APIs; resample/buffer are standard.
- Pitfalls: HIGH — derived from the verified APIs and the documented Phase 2/3 native-module + DXGI precedents.

**Research date:** 2026-06-17
**Valid until:** ~2026-07-17 for Deepgram v5 (stable SDK); re-verify `native-recorder-nodejs` at plan time (young package — version may move; re-run the legitimacy gate).

## RESEARCH COMPLETE
