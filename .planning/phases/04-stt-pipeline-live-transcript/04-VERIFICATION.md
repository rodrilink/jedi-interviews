---
phase: 04-stt-pipeline-live-transcript
verified: 2026-06-18T01:25:00Z
status: passed
score: 5/5 must-haves verified
overrides_applied: 0
---

# Phase 04: STT Pipeline + Live Transcript — Verification Report

**Phase Goal:** A live rolling transcript on the overlay, streamed through a swappable provider seam, that survives dropped connections and never grows unbounded.
**Verified:** 2026-06-18T01:25:00Z
**Status:** PASSED
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Captured audio is streamed to Deepgram and a live transcript updates on the overlay | VERIFIED | `AudioCaptureService.start()` feeds `Int16Array` PCM to `DeepgramSttGateway.sendAudio()` via a closure in `wireSttPipeline`. Gateway `transcript` events call `pushTranscript(window, ...)` over `jedi:transcript`. `DebugHud` subscribes via `window.jedi.onTranscript`. Human-confirmed live on target machine. |
| 2 | The transcript shows interim (partial) results that resolve into final results as they arrive | VERIFIED | `gateway.on('transcript')` in `index.ts` branches on `event.isFinal`: finals call `buffer.appendFinal()`, interims call `buffer.setInterim()`. `DebugHud` renders `finalText` in `.debug-hud__transcript-final` and `interimText` in `.debug-hud__interim` (dimmed/italic class). Human-confirmed interim renders visually distinct from final. |
| 3 | If the STT connection drops mid-session it reconnects automatically with backoff, and connection state is visible on the overlay | VERIFIED | `DeepgramSttGateway` handles `socket.on('close')` → emits `connection-state-change 'reconnecting'` → calls `scheduleReconnect()` with exponential backoff (500 ms initial, ×2, 8 s cap, ±20% jitter). SDK `reconnectAttempts: 0` makes the gateway the single reconnect authority (prevents dual-engine thrash). `DebugHud` renders `connectionState` in `data-testid="cell-connection-state"`. Human-confirmed forced-drop reconnect during live gate. |
| 4 | The user can clear the transcript by hotkey, and the buffer is automatically capped to a bounded size | VERIFIED | `HOTKEY_CHORDS` includes `{ label: 'clear-transcript', keycode: UiohookKey.K, accelerator: 'Ctrl+Alt+K', kind: 'discrete' }`. `buildHandlers` maps it to `buffer.clear()` + immediate `pushTranscript`. `TranscriptBuffer` enforces three independent hard bounds: `WINDOW_MS = 90_000`, `MAX_SEGMENTS = 400`, `MAX_TOTAL_CHARS = 20_000`. Human-confirmed Ctrl+Alt+K empties transcript on target machine. |
| 5 | Speech-to-text is reached only through an ISttProvider interface, so the Deepgram backend can be swapped without touching consumers | VERIFIED | `stt-provider.interface.ts` exports `ISttProvider`, `ISttTranscriptEvent`, `SttConnectionState` with zero `@deepgram/sdk` imports. `DeepgramSttGateway extends EventEmitter implements ISttProvider` — the only file importing `@deepgram/sdk`. `index.ts` depends on `ISttTranscriptEvent` and `SttConnectionState` types from the interface file, not from the SDK. No consumer outside the gateway imports `@deepgram/sdk`. |

**Score: 5/5 truths verified**

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/main/stt/stt-provider.interface.ts` | ISttProvider seam (TRN-05) | VERIFIED | Exports `ISttProvider`, `ISttTranscriptEvent`, `SttConnectionState`. Zero `@deepgram/sdk` imports. Full TSDoc on every member. 93 lines, substantive. |
| `src/main/audio/pcm-resample.utility.ts` | Resample + rate assertion (TRN-01) | VERIFIED | Exports `downmixToMonoFloat32`, `resampleLinear`, `float32ToInt16`, `assertSampleRate`. Pure functions, explicit return types, TSDoc. `assertSampleRate` throws a descriptive `Error` on mismatch. |
| `src/main/audio/pcm-resample.utility.test.ts` | Unit coverage for all resample behaviors | VERIFIED | 8 tests passing — covers downmix (incl. empty-buffer guard), resample (48k→16k length, 16k→16k passthrough), float32ToInt16 conversion, and rate-mismatch throw. |
| `src/main/stt/deepgram-stt.gateway.ts` | DeepgramSttGateway implements ISttProvider | VERIFIED | `class DeepgramSttGateway extends EventEmitter implements ISttProvider`. Deepgram v5 live connection (`listen.v1.connect`), reconnect/backoff, keep-alive with socket-not-open guard, teardown. 345 lines, fully substantive. |
| `src/main/stt/deepgram-stt.gateway.test.ts` | Gateway unit coverage | VERIFIED | 15 tests passing — covers connected-on-open, interim/final mapping, empty-text skip, drop-PCM-when-disconnected, sendMedia-when-connected, key-not-logged, close→reconnect (fake timers), error-does-not-throw. |
| `src/main/stt/transcript-buffer.ts` | Time-bounded rolling buffer (TRN-04) | VERIFIED | `class TranscriptBuffer`. Three independent bounds: `WINDOW_MS=90_000`, `MAX_SEGMENTS=400`, `MAX_TOTAL_CHARS=20_000`. `appendFinal`, `setInterim` (replace, not accumulate), `clear`, `recentSince`, `renderable`. Injected clock for deterministic tests. |
| `src/main/stt/transcript-buffer.test.ts` | Buffer unit coverage | VERIFIED | 8 tests passing — covers prune-by-time, prune-by-segment-ceiling, prune-by-char-ceiling, interim-replaced (not accumulated), appendFinal-clears-interim, clear()-empties, recentSince() window. |
| `src/main/audio/audio-capture.service.ts` | Main-process WASAPI wrapper | VERIFIED | `class AudioCaptureService`. Idempotent `start()` (WR-02 early-return guard), empty-device guard (WR-01), `JEDI_CAPTURE_DEVICE` override, `getDeviceFormat`-driven resample chain, `recorder.on('error')` never-crash, `teardown()`. 161 lines. |
| `src/main/index.ts` | Bootstrap wiring | VERIFIED | `wireSttPipeline()` instantiates `DeepgramSttGateway`, `AudioCaptureService`, `TranscriptBuffer` once in `app.whenReady`. Wires all three gateway events. `buildHandlers` includes `clear-transcript`, `scroll-transcript-up`, `scroll-transcript-down`. `window-all-closed` tears down capture + gateway. |
| `src/main/overlay-window.manager.ts` | TRANSCRIPT_CHANNEL + pushTranscript | VERIFIED | Exports `TRANSCRIPT_CHANNEL = 'jedi:transcript'`, `IOverlayTranscript { finalText, interimText, connectionState, audioLevel }`, `pushTranscript(window, payload)` with `isDestroyed()` guard. Mirrors `pushStatus` discipline exactly. |
| `src/preload/index.ts` | onTranscript subscription with unsubscribe | VERIFIED | `onTranscript(callback)` returns `() => ipcRenderer.removeListener(TRANSCRIPT_CHANNEL, listener)`. `onStatus` also returns unsubscribe. `reportAudioLevel` / `AUDIO_LEVEL_CHANNEL` (renderer→main write) are absent — confirmed by grep returning only a comment mention. |
| `src/renderer/src/components/debug-hud.tsx` | Transcript render + cleanup | VERIFIED | `window.jedi.onTranscript(...)` subscription with `offTranscript?.()` in useEffect cleanup. Renders `data-testid="cell-transcript-final"`, `cell-transcript-interim"` (`.debug-hud__interim` class for dimmed/italic), `cell-connection-state"`. Audio meter retained (OQ-3 reversal per user request). |
| `src/main/config/load-dotenv.utility.ts` | .env loader for Deepgram key | VERIFIED | `loadDotenvFile(path)` reads and parses a gitignored `.env`, applying values to `process.env` without overwriting shell-exported vars. Called at top of `app.whenReady()` before `wireSttPipeline`. |
| `src/main/hotkey-registrar.service.ts` | clear-transcript Ctrl+Alt+K chord | VERIFIED | `HOTKEY_CHORDS` includes `{ label: 'clear-transcript', keycode: UiohookKey.K, accelerator: 'Ctrl+Alt+K', kind: 'discrete' }`. Also adds `scroll-transcript-up` (PageUp, repeat) and `scroll-transcript-down` (PageDown, repeat). |
| `.gitignore` | .env covered | VERIFIED | Lines 23-24: `.env` and `.env.*` are gitignored. No `DEEPGRAM_API_KEY` value present in the committed tree. |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/main/stt/deepgram-stt.gateway.ts` | `ISttProvider` | `implements ISttProvider` | WIRED | Line 67: `export class DeepgramSttGateway extends EventEmitter implements ISttProvider` |
| `src/main/stt/deepgram-stt.gateway.ts` | `@deepgram/sdk listen.v1.connect` | Live WebSocket message events | WIRED | Line 136: `await client.listen.v1.connect({ ... })`. `reconnectAttempts: 0` disables SDK reconnect; gateway is sole authority. |
| `src/main/index.ts` | `AudioCaptureService → DeepgramSttGateway → TranscriptBuffer → pushTranscript` | Wired once in `app.whenReady` | WIRED | `wireSttPipeline()` chains: capture `sendPcm` sink → `gateway.sendAudio(pcm)` → `gateway.on('transcript')` → `buffer.appendFinal/setInterim` → `pushTranscript(window, ...)` |
| `src/renderer/src/components/debug-hud.tsx` | `window.jedi.onTranscript` | One-way main→renderer subscription with unsubscribe cleanup | WIRED | Line 78: `const offTranscript = window.jedi?.onTranscript(...)`. Cleanup at line 95: `offTranscript?.()` |
| `src/preload/index.ts` | `jedi:transcript` channel | `ipcRenderer.on` returning `removeListener` | WIRED | `onTranscript` registers and returns unsubscribe. `TRANSCRIPT_CHANNEL = 'jedi:transcript'` matches `overlay-window.manager.ts`. |
| `src/main/hotkey-registrar.service.ts` | `clear-transcript` | Handler wired in `buildHandlers` in `index.ts` | WIRED | `buildHandlers` maps `'clear-transcript'` to `buffer.clear()` + `pushTranscript`. Hotkey chord registered as `Ctrl+Alt+K`. |
| `src/main/stt/transcript-buffer.ts` | Three hard bounds | `prune()` enforces all three independently | WIRED | `prune()` applies time filter, then `while finals.length > MAX_SEGMENTS`, then `while total > MAX_TOTAL_CHARS`. Clock-independent ceilings prevent growth even with a misbehaving clock. |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `debug-hud.tsx` | `transcript` (IOverlayTranscript) | `window.jedi.onTranscript` → `jedi:transcript` IPC channel → `pushTranscript` in main → `buffer.renderable()` + live RMS | `buffer.appendFinal(event.text)` / `buffer.setInterim(event.text)` populated from real Deepgram `message` events | FLOWING |
| `debug-hud.tsx` | `connectionState` | `transcript.connectionState` set by `gateway.on('connection-state-change')` emitting `SttConnectionState` string | Real Deepgram socket lifecycle events (`open` → `connected`, `close` → `reconnecting`) | FLOWING |
| `debug-hud.tsx` | `audioLevel` | `computeRmsInt16(pcm)` in main capture sink, pushed in `pushTranscript` payload | Real WASAPI PCM samples from `native-recorder-nodejs` | FLOWING |

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| 72 tests passing | `npm test` | `72 passed (10 files)` | PASS |
| TypeScript compiles clean (node) | `npm run typecheck:node` | Exit 0, no errors | PASS |
| TypeScript compiles clean (web) | `npm run typecheck:web` | Exit 0, no errors | PASS |
| Lint clean | `npm run lint` | Exit 0, no oxlint violations | PASS |
| Renderer audio-capture.service.ts deleted | `ls src/renderer/src/services/` | Directory does not exist | PASS |
| rms-meter.worklet.ts deleted | `ls src/renderer/src/audio/` | Only `rms.utility.ts` and `rms.utility.test.ts` remain | PASS |
| No `@deepgram/sdk` import outside gateway | grep across `src/` | Only `deepgram-stt.gateway.ts` (implementation) and `deepgram-stt.gateway.test.ts` (mock) import the SDK | PASS |
| No TBD/FIXME/XXX debt markers | grep across `src/main` and `src/renderer` | No matches | PASS |
| No Deepgram key logged | grep for `console.log.*apiKey\|key\|DEEPGRAM` | No matches in main process files | PASS |
| Renderer→main write surface is zero | grep for `reportAudioLevel\|jedi:audio-level` in `src/` | Only found in a comment in `preload/index.ts` (documenting removal); no live IPC handler | PASS |

---

### Probe Execution

Step 7c: SKIPPED — no `scripts/*/tests/probe-*.sh` files found in the repository. Phase 04 has a human live-verification gate (04-04 Task 4) that substitutes as the on-machine probe; its results are human-confirmed below.

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|---------|
| TRN-01 | 04-01, 04-02, 04-04 | Captured audio streamed to STT; live transcript on overlay | SATISFIED | Full capture→resample→Deepgram→buffer→overlay pipeline wired in `index.ts`. 72 unit tests covering each component. Human-confirmed live. |
| TRN-02 | 04-02, 04-04 | Interim (partial) and final results shown as they arrive | SATISFIED | Gateway `handleMessage()` sets `isFinal: message.is_final === true`. `DebugHud` renders final in `.debug-hud__transcript-final`, interim in `.debug-hud__interim`. Human-confirmed visual distinction. |
| TRN-03 | 04-02, 04-04 | Auto-reconnect with backoff if STT connection drops | SATISFIED | `scheduleReconnect()` with 500ms→8s exponential backoff + ±20% jitter. `reconnectAttempts:0` makes gateway sole reconnect authority. State transitions surfaced on overlay. Human-confirmed forced-drop recovery. |
| TRN-04 | 04-03, 04-04 | Clear by hotkey; buffer automatically capped | SATISFIED | `Ctrl+Alt+K` → `buffer.clear()` → `pushTranscript`. Three bounds: `WINDOW_MS=90_000`, `MAX_SEGMENTS=400`, `MAX_TOTAL_CHARS=20_000`. Human-confirmed clear fires. |
| TRN-05 | 04-01 | ISttProvider seam so Deepgram can be swapped | SATISFIED | `stt-provider.interface.ts` has zero SDK imports. `DeepgramSttGateway implements ISttProvider`. Consumers (`index.ts`, Phase 5) depend only on the interface. |

**All 5 phase requirement IDs (TRN-01 through TRN-05) are SATISFIED.**

---

### Anti-Patterns Found

No blockers or warnings found.

| File | Pattern Checked | Result |
|------|----------------|--------|
| All `src/main/**` | TBD/FIXME/XXX debt markers | None found |
| All `src/renderer/**` | TBD/FIXME/XXX debt markers | None found |
| `deepgram-stt.gateway.ts` | `return null / return {} / return []` stubs | None; substantive implementation |
| `transcript-buffer.ts` | `return null / return {}` stubs | None; substantive implementation |
| `audio-capture.service.ts` | Empty handlers masking faults | None; `recorder.on('error')` calls `this.report(error)` |
| `debug-hud.tsx` | Hardcoded empty props disconnecting data | None; `transcript?.finalText ?? ''` is a display fallback, not a disconnected prop; data flows from real IPC subscription |
| `index.ts` | Dead renderer audio path | Fully retired: `installAudioPipeline`, `setDisplayMediaRequestHandler`, `jedi:audio-level` handler absent; confirmed by grep |

---

### Human Verification Required

All human verification was completed at the 04-04 blocking live gate by the user on the target machine (Windows 11, Electron 35.7.5). Items confirmed:

1. **Live rolling transcript** — Real transcript text rendered in DebugHud with system audio playing.
2. **Interim vs final visual distinction** — Interim text rendered dimmed/italic, distinct from finalized text.
3. **Connection state visible** — HUD `Connection` row showed `connected` during normal operation.
4. **Auto-reconnect** — Forced mid-session drop; state showed `reconnecting`, then returned to `connected` with backoff; transcript resumed.
5. **Audio meter** — RMS meter (0.1–0.38 range for speech) animated with system audio, confirmed capture is alive.
6. **Ctrl+Alt+K clear** — Transcript area emptied immediately on keypress.
7. **Ctrl+Alt+PageUp/PageDown scroll** — Keyboard-driven scroll with auto-follow-with-pause behavior.
8. **HUD coupled visibility** — Ctrl+Alt+H hid transcript with HUD content; toggle back restored it.
9. **No key in logs or committed tree** — Verified during gate; key rotated afterward.
10. **Chord conflict check** — Ctrl+Alt+K showed no collision with Teams/Zoom/VS Code; chord finalized as K.

No new human verification items remain.

---

### Gaps Summary

No gaps. All 5 must-have truths verified, all artifacts substantive and wired, all data flows connected to real sources, all requirement IDs satisfied, zero debt markers, zero dead-code remnants. Automated gate: 72/72 tests passing, typecheck clean on both tsconfig targets, oxlint clean.

One documented non-blocker from the 04-04 SUMMARY: `DebugHud` has no dedicated unit test (subscriptions and scroll logic are untested at the component level). The SUMMARY itself flags this as a candidate for a future frontend component test. It is not a gap against the phase success criteria — the criteria do not require a DebugHud component test, and the runtime behaviors it covers were human-verified live.

---

_Verified: 2026-06-18T01:25:00Z_
_Verifier: Claude (gsd-verifier)_
