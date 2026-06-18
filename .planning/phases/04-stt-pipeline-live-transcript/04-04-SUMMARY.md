---
phase: 04-stt-pipeline-live-transcript
plan: 04
subsystem: stt
tags: [deepgram, wasapi, electron, ipc, audio, transcript, react]

requires:
  - phase: 04-01
    provides: ISttProvider seam, pure pcm-resample.utility, WASAPI capture GO
  - phase: 04-02
    provides: DeepgramSttGateway (ISttProvider over @deepgram/sdk v5)
  - phase: 04-03
    provides: time-bounded TranscriptBuffer, clear-transcript chord
provides:
  - End-to-end main-side STT pipeline (capture -> resample -> Deepgram -> buffer -> overlay)
  - One-way jedi:transcript push and DebugHud transcript render (interim vs final, connection state)
  - Live main-computed audio meter on the overlay
  - Keyboard-driven transcript scroll (Ctrl+Alt+PageUp/PageDown)
  - .env loader for the Deepgram key (main-only)
affects: [05-ai-orchestration, 06-session-context-settings]

tech-stack:
  added: []
  patterns:
    - "Single main-side audio path: WASAPI in-process addon, no renderer Web Audio, no child process (D-01/D-02)"
    - "One-way main->renderer IPC only; zero renderer->main write surface (IN-01)"
    - "Hotkey-driven control for an unfocused overlay: scroll via global chord -> IPC signal -> renderer"
    - "Local dev secrets via gitignored .env loaded in main before process.env reads"

key-files:
  created:
    - src/main/audio/audio-capture.service.ts
    - src/main/audio/rms.utility.ts
    - src/main/config/load-dotenv.utility.ts
  modified:
    - src/main/index.ts
    - src/main/overlay-window.manager.ts
    - src/main/hotkey-registrar.service.ts
    - src/main/stt/deepgram-stt.gateway.ts
    - src/preload/index.ts
    - src/renderer/src/components/debug-hud.tsx
    - src/renderer/src/assets/hud.css
    - electron.vite.config.ts

key-decisions:
  - "OQ-3 reversed: re-added the audio meter (main-computed RMS) after the user wanted visible proof of capture during silence."
  - "Capture targets the currently-active output device via JEDI_CAPTURE_DEVICE override, not isDefault (04-01 finding made real)."
  - "Deepgram SDK auto-reconnect disabled (reconnectAttempts:0) — the gateway is the single reconnect authority."
  - "Clear-transcript chord kept as Ctrl+Alt+K (no conflict surfaced in on-machine testing)."
  - "Transcript scroll is hotkey-driven (Ctrl+Alt+PageUp/PageDown) because the overlay never takes focus."

patterns-established:
  - "main->renderer signal channels (jedi:transcript, jedi:scroll-transcript) with teardown guards and preload unsubscribe (WR-03)"
  - "Auto-follow-with-pause scroll: stick to newest text unless the user scrolled up to read history"

requirements-completed: [TRN-01, TRN-02, TRN-03, TRN-04]

duration: ~6h (including extensive on-machine live debugging)
completed: 2026-06-18
---

# Phase 4: STT Pipeline + Live Transcript — Plan 04-04 Summary

**A live rolling transcript of system audio now renders on the keyboard-only overlay, streamed main-side through capture → resample → Deepgram → bounded buffer, with a live audio meter, hotkey scroll, and auto-reconnect — verified on-machine.**

## Performance

- **Duration:** ~6 hours (3 automated tasks + a long blocking human live-verify gate with multiple on-machine debug cycles)
- **Tasks:** 4/4 (Task 4 was the human live-verification gate)
- **Files:** 9 modified, 3 created (+ test files)

## Accomplishments

- Wired the complete main-side pipeline: WASAPI capture → resample to 16 kHz mono → `DeepgramSttGateway` → `TranscriptBuffer` → one-way `jedi:transcript` push → `DebugHud` render (interim dimmed/italic vs final, connection-state row).
- Retired the dead renderer audio path entirely (D-02/IN-01): renderer `audio-capture.service.ts`, `rms-meter.worklet.ts`, the worklet rollup entry, and the `jedi:audio-level` channel are gone. Renderer→main write surface is now zero.
- Confirmed the full path live on the target machine: real transcript text, healthy audio (RMS 0.1–0.38), stable `connected` state, auto-reconnect.

## Task Commits

1. **Task 1: main AudioCaptureService + retire dead renderer path** — `eb55341` (feat)
2. **Task 2: jedi:transcript channel + DebugHud transcript render** — `89cd54a` (feat)
3. **Task 3: wire pipeline in index.ts + clean teardown** — `fe3b37f` (feat)
4. **Task 4: on-machine live verification** — human gate; drove the fixes below.

### Fixes found at the live-verify gate (each committed atomically)

- `145248e` fix(04-02): Deepgram connect option types (`interim_results`/`smart_format` are SDK string-literal unions) + `sendMedia` arg (pass the Int16Array view, not `.buffer`) — caught by the post-merge typecheck gate.
- `381eecf` fix(04-04): guard keep-alive against `Socket is not open.` (gate on `state==='connected'` + try/catch) — was crashing the main process a few seconds after launch.
- `dea32ce` fix(04-04): open the socket via `connection.connect()` (the SDK's `listen.v1.connect` returns an unopened socket) + load `.env` in main — fixed "connecting forever".
- `7ebc954` fix(04-04): select the active output device via `JEDI_CAPTURE_DEVICE` (the `isDefault` device was a silent headset while audio routed to the speakers) — fixed "connected but no transcript".
- `b53e18b` feat(04-04): main-computed live audio meter (reverses OQ-3 per user request).
- `1f445cf` feat(04-04): keyboard-driven transcript scroll (Ctrl+Alt+PageUp/PageDown) + bigger overlay (460×700).
- `e566a82` chore(04-04): remove temporary diagnostics after live verify.

(Also `reconnectAttempts:0` in `dea32ce`/`1f445cf` lineage: the SDK's built-in ReconnectingWebSocket was fighting the gateway's reconnect, causing connected/connecting/reconnecting thrash + N-API DEP0168 callback exceptions — disabling it made the gateway the sole reconnect authority.)

## Decisions Made

- **OQ-3 reversed — audio meter re-added.** The user wanted visible proof capture is alive during silence; the meter (main-computed RMS) is the cleanest signal and keeps the one-way IPC boundary.
- **Active-device capture.** `JEDI_CAPTURE_DEVICE` (case-insensitive name substring) override → default → first. The 04-01 finding that `isDefault` ≠ where Windows routes audio was real on this machine.
- **Single reconnect authority.** SDK `reconnectAttempts:0`; the gateway owns reconnect/backoff.
- **Clear chord stays Ctrl+Alt+K** (no conflict observed in testing).
- **Hotkey scroll** (Ctrl+Alt+PageUp/PageDown, repeat) because the overlay is never focused.

## Deviations from Plan

The plan's automated tasks executed as written. Task 4 (the human gate) surfaced a chain of real runtime bugs invisible to the SDK-mocked unit tests — socket-not-opened, socket-not-open keep-alive crash, missing `.env` load, wrong capture device, and SDK/gateway reconnect contention. Each was fixed with a regression test where unit-testable. The audio meter and keyboard scroll are user-requested scope added during the gate, both tested and gated.

## Issues Encountered

All resolved on-machine and verified by the user: "connecting forever" (unopened socket + no key), main-process crash (keep-alive on a not-open socket), connected-but-silent (wrong device), connection thrash + N-API DEP0168 (dual reconnect engines). Final live run: stable `connected`, live transcript, working meter, working keyboard scroll.

## User Setup Required

The Deepgram API key must be provided via a gitignored `.env` (`DEEPGRAM_API_KEY=...`) in the project root, or a shell env var. On a machine where the default output device is not where audio plays, set `JEDI_CAPTURE_DEVICE` to a substring of the active device name (e.g. `Realtek`). **Security:** the key shared during this session should be rotated at https://console.deepgram.com.

## Verification

- Automated: `npm run typecheck` (node+web), `npm run lint` (oxlint), `npm test` (72 tests), `npm run build` — all green.
- On-machine (human): live transcript renders with interim/final distinction; connection holds `connected`; audio meter moves with sound; Ctrl+Alt+K clears; Ctrl+Alt+PageUp/PageDown scroll; bigger overlay confirmed.

## Follow-ups / Tech Debt

- No unit test for `DebugHud` (presentational; subscriptions + scroll logic untested) — candidate for a frontend component test.
- Hotkey-driven overlay height resize was deferred (window is fixed 460×700 for now).
