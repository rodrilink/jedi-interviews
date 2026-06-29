# Phase 4: STT Pipeline + Live Transcript - Pattern Map

**Mapped:** 2026-06-17
**Files analyzed:** 13 (6 new, 6 modified/reworked, 1 deleted set)
**Analogs found:** 13 / 13 (every new file has a same-codebase analog)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/main/stt/stt-provider.interface.ts` (NEW) | interface | event-driven | `src/main/hotkey-registrar.service.ts` (`IHotkeyRegistrationResult` + EventEmitter conventions in `*.test.ts`) | role-match |
| `src/main/stt/deepgram-stt.gateway.ts` (NEW) | gateway / service | streaming (event-driven) | `src/main/hotkey-registrar.service.ts` (native-event-source wrapper, register-result, no-throw, by-convention singleton) | role-match |
| `src/main/stt/transcript-buffer.ts` (NEW) | utility/state holder | transform / batch | `src/renderer/src/audio/rms.utility.ts` (pure, unit-tested) + injected-clock pattern | role-match |
| `src/main/audio/pcm-resample.utility.ts` (NEW) | utility | transform | `src/renderer/src/audio/rms.utility.ts` (pure `.utility.ts`, exact suffix + style) | exact |
| `src/main/audio/audio-capture.service.ts` (NEW) | service | streaming (file/device-I/O) | `src/main/hotkey-registrar.service.ts` (native addon loaded in main, idempotent lifecycle, by-convention singleton) | role-match |
| `*.test.ts` for the above (NEW, co-located) | test | — | `src/renderer/src/audio/rms.utility.test.ts` + `src/main/hotkey-registrar.service.test.ts` (Vitest, AAA, EventEmitter/`vi.mock` stand-ins) | exact |
| `src/main/overlay-window.manager.ts` (MOD) | manager | request-response (one-way push) | itself — extend `IOverlayStatus`/`pushStatus`; add `jedi:transcript` channel + `pushTranscript`; remove `audioLevel`/`setAudioLevel` (IN-01) | self (extend) |
| `src/main/hotkey-registrar.service.ts` (MOD) | service | event-driven | itself — add a 10th `IHotkeyChord` to `HOTKEY_CHORDS` (clear-transcript, D-07) | self (extend) |
| `src/renderer/src/components/debug-hud.tsx` (MOD) | component | request-response (one-way view) | itself — add transcript rows; subscribe to `onTranscript`; WR-03 unsubscribe in `useEffect` cleanup | self (extend) |
| `src/preload/index.ts` (MOD) | preload bridge | request-response | itself — add `onTranscript` (returning unsubscribe, WR-03); remove `reportAudioLevel`/`AUDIO_LEVEL_CHANNEL` (IN-01) | self (extend) |
| `src/main/index.ts` (MOD) | handler/bootstrap | — | itself — replace `installAudioPipeline`/`setDisplayMediaRequestHandler` with main-side capture init (WR-01/WR-02), wire capture→resample→gateway→buffer→push | self (rework) |
| `src/renderer/src/services/audio-capture.service.ts` (DELETE) | — | — | — retired per D-02/IN-01 | n/a |
| `src/renderer/src/audio/rms-meter.worklet.ts` (DELETE) | — | — | — retired per D-02/IN-01 (also drop its rollup entry in `electron.vite.config.ts`) | n/a |

## Pattern Assignments

### `src/main/audio/pcm-resample.utility.ts` (utility, transform)

**Analog:** `src/renderer/src/audio/rms.utility.ts` — exact same `.utility.ts` contract: pure, idempotent, no side effects, no classes/state, TSDoc on every export with `@param`/`@returns`.

**Style pattern to copy** (`rms.utility.ts:14-26`): single exported function, explicit return type, 4-space indent, empty/edge-case guard first (`if (frame.length === 0) return 0;`), `for` loop with named index (no single letters beyond `index`). Replicate this for `downmixToMonoFloat32`, `resampleLinear`, `float32ToInt16` (bodies given in RESEARCH Pattern 2, lines 237-281).

**Sample-rate assertion (ROADMAP rule / D-02):** add an exported guard that throws loudly when declared `inRate !== getDeviceFormat().sampleRate`. Use a typed error, not bare `Error` per IDEXX error-handling — but note this is a local Electron app with no `ipay-common-lib`; the existing code (`preload/index.ts:73`) throws a plain `Error` for an unrecoverable invariant, so a plain `Error` with a descriptive message is the established local precedent for "fail loudly on a broken invariant."

**Test analog:** `rms.utility.test.ts` — `describe('pcm-resample.utility', ...)`, AAA comments on their own lines, explicit `Float32Array`/`Buffer` type annotations on arrange objects, `toBeCloseTo` for float comparisons, dedicated edge-case tests (empty buffer, mono passthrough when `inRate === outRate`, rate-mismatch throws).

---

### `src/main/stt/transcript-buffer.ts` (utility/state holder, transform)

**Analog:** `rms.utility.ts` for purity/test-style; RESEARCH Pattern 3 (lines 284-326) for the exact class shape.

**Clock-injection pattern (for deterministic tests):** constructor takes `private readonly now: () => number = Date.now` (RESEARCH line 299). This mirrors the by-convention dependency-injection style used in main (constructor injection, no TSyringe — see `HotkeyRegistrarService` constructor `hotkey-registrar.service.ts:97`).

**Interim discipline:** interim text is *replaced* (`setInterim`), never appended; only `appendFinal` commits to the pruned array. Hard ceilings (`MAX_SEGMENTS`, `MAX_TOTAL_CHARS`) plus the time window (`WINDOW_MS`) — three independent bounds per D-06. `clear()` is the TRN-04 hotkey target.

**Test analog:** `rms.utility.test.ts` structure + inject a fake clock (`let nowMs = 0; const buffer = new TranscriptBuffer(() => nowMs)`). Cover: prune-by-time, prune-by-segment-ceiling, prune-by-char-ceiling, `clear()` empties, `recentSince()` window selection.

---

### `src/main/stt/stt-provider.interface.ts` (interface, event-driven — define FIRST per TRN-05)

**Analog:** `hotkey-registrar.service.ts:17-22` (`IHotkeyRegistrationResult`) for the local interface-naming and TSDoc convention; RESEARCH lines 431-444 for the exact `ISttProvider` shape.

**Naming convention** (IDEXX naming-conventions.md + local code): interfaces are `I`-prefixed PascalCase (`IHotkeyRegistrationResult`, `IOverlayStatus`). Apply: `ISttProvider`, `ISttTranscriptEvent`. The connection-state union is a `type` (`SttConnectionState`), matching the local `type HotkeyLayer = 'uiohook' | 'globalShortcut' | 'none'` precedent (`hotkey-registrar.service.ts:8`).

**Event-emitter style** (RESEARCH line 437-444): `start()`/`stop()`/`sendAudio(pcm)` + overloaded `on(event, listener)`. Matches Deepgram v5's `connection.on('message')` and the codebase's existing EventEmitter usage (uiohook is an EventEmitter; the registrar test wraps a `FakeUiohook extends EventEmitter` — `hotkey-registrar.service.test.ts:11`). A Node `EventEmitter` subclass is the idiomatic local implementation vehicle.

---

### `src/main/stt/deepgram-stt.gateway.ts` (gateway, streaming/event-driven)

**Analog:** `hotkey-registrar.service.ts` — the established "wrap a native/external event source in a main-process class, never throw on a transport failure, surface state instead" pattern.

**No-throw / graceful-degradation pattern to copy** (`hotkey-registrar.service.ts:107-117`): `register()` try/catches the native attach and returns a result object rather than throwing; on failure it routes to a fallback and *reports* `failed` labels. The gateway mirrors this: `connection.on('error', ...)` and `on('close', ...)` emit `connection-state-change` / `error` events and trigger backoff reconnect — the gateway NEVER lets a socket error crash the app (RESEARCH Pitfall 4, anti-pattern at line 341/221).

**By-convention singleton (no TSyringe in main)** — copy the `@remarks` discipline verbatim in spirit (`hotkey-registrar.service.ts:75-78`): "The IDEXX `@singleton()` decorator is NOT applicable here: the Electron main process has no TSyringe DI container. This service is instantiated exactly once in `index.ts` and treated as a singleton by convention." Apply the same note to the gateway and `AudioCaptureService`.

**teardown() pattern** (`hotkey-registrar.service.ts:123-133`): a `teardown()` that releases the resource (there: `uIOhook.stop()` / `globalShortcut.unregisterAll()`; here: `sendCloseStream()` + `connection.close()` + clear keep-alive timer). Called from `app.on('window-all-closed')` in `index.ts:131-133` alongside `hotkeyRegistrar?.teardown()`.

**Deepgram v5 body:** RESEARCH Pattern 1 (lines 187-231) — verified against installed `@deepgram/sdk@5.4.0`. Key sourced in main only (D-08); never `console.log` the key (security V6).

**Test analog:** `hotkey-registrar.service.test.ts` — `vi.mock('@deepgram/sdk', ...)` returning a `FakeV1Socket extends EventEmitter` exactly as the registrar test does for uiohook (`hotkey-registrar.service.test.ts:11-53`); drive `open`/`message`/`close`/`error` and assert emitted gateway events + interim-vs-final mapping (TRN-02/03/05).

---

### `src/main/audio/audio-capture.service.ts` (service, streaming/device-I/O)

**Analog:** `hotkey-registrar.service.ts` (native addon in main, by-convention singleton, `teardown()`) + RESEARCH lines 408-429 (`native-recorder-nodejs` `AudioRecorder` usage) + retired `src/renderer/src/services/audio-capture.service.ts` for the lifecycle shape to carry over.

**Idempotent start() (WR-02):** the retired renderer service stored `this.stream`/`this.audioContext` handles (`audio-capture.service.ts:28-32`). Carry the *handle-storage* idea forward but ADD the early-return guard it lacked: `if (this.recorder) return;` at the top of `start()` so React Strict-Mode re-entry / double-boot can't leak a capture handle (WR-02, RESEARCH Pitfall 5 line 400).

**Empty-device guard (WR-01):** the moot `sources[0]` guard in `index.ts:73` becomes an explicit `getDevices('output').length === 0` guard that surfaces to the HUD rather than throwing blindly (RESEARCH lines 413-417). Same defensive spirit as the registrar's "report, don't throw."

**Data flow:** `recorder.on('data', buffer)` → `downmixToMonoFloat32` → `resampleLinear` → `float32ToInt16` → `sttProvider.sendAudio(int16)`; optionally `computeRms` for the main meter (see Shared Patterns / OQ-3).

---

### `src/main/overlay-window.manager.ts` (MOD — extend the push manager)

**Self-analog — the one-way main→renderer push is already here.** Copy the `STATUS_CHANNEL` + `buildStatus` + `pushStatus` triad (`overlay-window.manager.ts:38-39, 144-169`) to add a sibling for transcript:

- Add `export const TRANSCRIPT_CHANNEL = 'jedi:transcript';` next to `STATUS_CHANNEL` (line 39).
- Add `export interface IOverlayTranscript { finalText: string; interimText: string; connectionState: SttConnectionState; }` mirroring `IOverlayStatus` (line 11).
- Add `pushTranscript(window, payload)` mirroring `pushStatus` exactly — including the `isDestroyed()`/`webContents.isDestroyed()` guard (`overlay-window.manager.ts:163-169`) since transcript pushes also fire async, possibly mid-teardown.
- **Remove (IN-01):** the `audioLevel` field from `IOverlayStatus` (lines 31-35), `lastAudioLevel` (line 70), `setAudioLevel` (lines 79-81), and the `audioLevel:` line in `buildStatus` (line 153). If the main meter is kept (OQ-3), re-add `audioLevel` sourced from main-computed RMS instead of renderer — the field stays, only its origin changes.

**Module-level mutable-state + setter pattern** (`overlay-window.manager.ts:53-63` `lastHotkeyResult`/`setHotkeyStatus`): if connection-state or transcript is held at module level for `buildStatus`/`buildTranscript`, follow this exact "module-level `let` + exported setter + read in build fn" shape.

---

### `src/main/hotkey-registrar.service.ts` (MOD — add the clear chord, D-07)

**Self-analog.** Add one entry to the `HOTKEY_CHORDS` array (`hotkey-registrar.service.ts:53-63`), e.g. `{ label: 'clear-transcript', keycode: UiohookKey.K, accelerator: 'Ctrl+Alt+K', kind: 'discrete' }` (OQ-2: planner finalizes the letter, avoiding J/arrows/[/]/H/Q, and re-runs the Phase 2 conflict check). No registrar code changes — `bindViaUiohook`/`dispatchUiohookKeydown`/`bindViaGlobalShortcut` already iterate `HOTKEY_CHORDS` generically, and `register()` already aggregates the result (lines 143-235). The new handler is added to `buildHandlers` in `index.ts:24-42` and calls `transcriptBuffer.clear()` + `pushTranscript`.

**Test analog:** extend `hotkey-registrar.service.test.ts` — add the new keycode to the `KEYCODE` map and the `vi.mock('uiohook-napi')` `UiohookKey` block (`hotkey-registrar.service.test.ts:26-53`), then assert the clear handler fires via `emitCtrlAltKeydown`.

---

### `src/preload/index.ts` (MOD — add transcript subscription, WR-03, IN-01)

**Self-analog.** Add `onTranscript` mirroring `onStatus` (`preload/index.ts:49-51`) BUT return an unsubscribe fn (WR-03):

```typescript
onTranscript(callback: (t: IOverlayTranscript) => void): () => void {
    const listener = (_event: IpcRendererEvent, t: IOverlayTranscript): void => callback(t);
    ipcRenderer.on(TRANSCRIPT_CHANNEL, listener);
    return (): void => ipcRenderer.removeListener(TRANSCRIPT_CHANNEL, listener);
}
```

Apply the SAME unsubscribe fix to the existing `onStatus` (WR-03) — currently it registers an inline listener with no removal (`preload/index.ts:49-51`). **Remove (IN-01):** `AUDIO_LEVEL_CHANNEL` (line 26) and the `reportAudioLevel` method (lines 53-64) — the renderer→main write channel is retired; this shrinks the write surface to zero (RESEARCH security line 560). Declare `IOverlayTranscript` locally (preload is bundled separately — same reason `IOverlayStatus` is re-declared, `preload/index.ts:6-9`).

---

### `src/renderer/src/components/debug-hud.tsx` (MOD — transcript render, WR-03)

**Self-analog.** The HUD already subscribes in a `useEffect` (`debug-hud.tsx:71-73`). Apply WR-03: capture the returned unsubscribe and call it in cleanup:

```typescript
useEffect(() => {
    const offStatus = window.jedi?.onStatus((next) => setStatus(next));
    const offTranscript = window.jedi?.onTranscript((t) => setTranscript(t));
    return (): void => { offStatus?.(); offTranscript?.(); };
}, []);
```

**Render pattern:** add transcript rows beneath the existing `<dl className="debug-hud__grid">` (lines 91-112). Final text normal, interim dimmed/italic (D-04) — e.g. a `debug-hud__interim` class. Visibility is already coupled to `hudVisible` (lines 77-80), satisfying D-05 with no extra work. Add a `data-testid` per naming-conventions (`cell-transcript-final`, `cell-transcript-interim`, `cell-connection-state`). **Remove (IN-01):** the `audioLevel` field from the local `IOverlayStatus` (lines 16-17), `formatAudioMeter`/`AUDIO_METER_CELLS` (lines 20-37), and the `Audio` row (lines 108-111) — UNLESS the main meter is kept (OQ-3), in which case keep the row and `formatAudioMeter` and only re-source the value.

---

## Shared Patterns

### Main-owned state, renderer is a one-way view
**Source:** `src/main/overlay-window.manager.ts` (`pushStatus`, lines 163-169) + `src/preload/index.ts` (`onStatus`, lines 49-51) + `src/renderer/src/components/debug-hud.tsx` (lines 68-86).
**Apply to:** the entire transcript path. Capture, resample, socket, buffer all in main; renderer renders pushed `IOverlayTranscript` only. The `jedi:audio-level` write channel is the lone prior exception and is being removed (IN-01) — restore the strictly one-way boundary.
```typescript
// pushTranscript mirrors pushStatus exactly, including the teardown guard:
if (window.isDestroyed() || window.webContents.isDestroyed()) return;
window.webContents.send(TRANSCRIPT_CHANNEL, payload);
```

### Native-source wrapper in main: no-throw, report state, teardown
**Source:** `src/main/hotkey-registrar.service.ts` (`register()` lines 107-117; `teardown()` lines 123-133; `@remarks` no-TSyringe note lines 75-78).
**Apply to:** `DeepgramSttGateway` and `AudioCaptureService`. Wrap external/native event sources; never throw on a transport/device failure — emit a state event and let the app keep running. Expose `teardown()`, call it from `app.on('window-all-closed')` in `index.ts:131-138`.

### By-convention singleton wired at the entry point
**Source:** `src/main/index.ts:118-121` (registrar instantiated once in `whenReady`) + `hotkey-registrar.service.ts:75-78`.
**Apply to:** the gateway, capture service, and buffer — instantiate each exactly once in `index.ts` `app.whenReady()`, wire them together there (capture→resample→gateway→buffer→`pushTranscript`), resolve dependencies at this entry point only (no service-locator mid-method).

### Pure `.utility.ts` + co-located Vitest (AAA, typed arrange)
**Source:** `src/renderer/src/audio/rms.utility.ts` + `rms.utility.test.ts`.
**Apply to:** `pcm-resample.utility.ts` and `transcript-buffer.ts`. No side effects, explicit return types, TSDoc on exports, edge-case-first guards. Tests: `describe`/`it`, AAA comments on their own lines (no trailing explanation), explicit type annotations on all arrange objects, `toBeCloseTo` for floats.

### EventEmitter test stand-in via `vi.mock`
**Source:** `src/main/hotkey-registrar.service.test.ts:11-53` (`FakeUiohook extends EventEmitter`, `vi.mock('uiohook-napi', ...)`, `vi.mock('electron', ...)`).
**Apply to:** `deepgram-stt.gateway.test.ts` — `FakeV1Socket extends EventEmitter`, `vi.mock('@deepgram/sdk')`; mock `native-recorder-nodejs` the same way for any capture-service test. Drive events, assert emitted gateway events. `beforeEach(() => vi.clearAllMocks())`.

### Secret handling (Deepgram key, D-08 / SET-03)
**Source:** the absence of any secret on `IOverlayStatus`/`jedi:status` (`overlay-window.manager.ts:8-9` "never secrets") + `preload/index.ts:36-39` (no secret-bearing channels).
**Apply to:** the gateway reads the key from env/untracked dev-config in main only; the key never crosses IPC, never enters a payload, never `console.log`. The one-way `jedi:transcript` channel carries text only.

## No Analog Found

None. Every new file maps to an existing same-codebase analog (pure-utility shape, native-wrapper service shape, one-way push manager, or co-located Vitest). The only genuinely novel surface is the third-party API bodies (Deepgram v5, `native-recorder-nodejs`), which are specified directly in RESEARCH (Patterns 1-4, Code Examples lines 187-445) and verified against installed types — the planner should pull those bodies from RESEARCH while applying the local structural patterns above.

## Retired / Dead Code (D-02 / IN-01 — remove during rework)

| File / Symbol | Location | Action |
|---------------|----------|--------|
| `AudioCaptureService` (renderer) | `src/renderer/src/services/audio-capture.service.ts` | DELETE |
| `rms-meter.worklet.ts` | `src/renderer/src/audio/rms-meter.worklet.ts` | DELETE |
| Worklet rollup entry | `electron.vite.config.ts` (`assets/rms-meter.worklet.js`) | Remove the now-unused input |
| `jedi:audio-level` channel + handler | `src/main/index.ts` (`installAudioPipeline`, `ipcMain.on('jedi:audio-level')`, lines 61-84) | Remove; replace with main-side capture init |
| `setDisplayMediaRequestHandler` / `desktopCapturer` | `src/main/index.ts:1, 62-78` | Remove (Chromium path NO-GO, Phase 3) |
| `reportAudioLevel` + `AUDIO_LEVEL_CHANNEL` | `src/preload/index.ts:25-26, 53-64` | Remove (IN-01) |
| `audioLevel`/`setAudioLevel`/`lastAudioLevel` | `src/main/overlay-window.manager.ts:31-35, 70, 79-81, 153` | Remove (or re-source from main if meter kept, OQ-3) |
| `formatAudioMeter` + Audio row | `src/renderer/src/components/debug-hud.tsx:20-37, 108-111` | Remove (or re-source if meter kept, OQ-3) |
| `computeRms` math | `src/renderer/src/audio/rms.utility.ts` | REUSE — move/import into main for the optional main-computed meter (D-02 follow-on); do not delete |

## Metadata

**Analog search scope:** `src/main/` (overlay-window.manager, hotkey-registrar, index, window-control), `src/preload/`, `src/renderer/src/` (components, audio, services), all `src/**/*.test.ts`.
**Files scanned:** 9 read in full + 4 test/glob references.
**Pattern extraction date:** 2026-06-17
