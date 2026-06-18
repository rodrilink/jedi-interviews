---
phase: 04-stt-pipeline-live-transcript
plan: 02
subsystem: stt
tags: [deepgram, stt, websocket, reconnect, backoff, keep-alive, event-emitter, electron-main, secret-handling]

# Dependency graph
requires:
  - phase: 04-stt-pipeline-live-transcript
    plan: 01
    provides: "ISttProvider seam (TRN-05) — start/stop/sendAudio + transcript/connection-state-change/error events; this plan's gateway implements it"
provides:
  - "DeepgramSttGateway — the first (v1-only) ISttProvider implementation over @deepgram/sdk v5"
  - "Live Deepgram connection (linear16/16000/mono/interim_results) with interim vs final transcript mapping (TRN-01/TRN-02)"
  - "Auto-reconnect with bounded exponential backoff + jitter and coarse connection-state surfacing (TRN-03)"
  - "Keep-alive-during-silence + drop-PCM-while-disconnected (D-06) policy behind the seam"
  - "Main-only Deepgram key handling (D-08): never logged, never emitted, never IPC'd"
affects: [04-03-buffer-feed, 04-04-bootstrap-wiring, phase-05-ai-orchestrator]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Gateway implements ISttProvider only; consumers never import @deepgram/sdk (TRN-05)"
    - "Report-don't-throw transport discipline (mirrors HotkeyRegistrarService) — a fault surfaces via the error event, never crashes main"
    - "emitError no-ops when no listener is attached, so an early fault cannot trigger Node's unlistened-error throw"
    - "Locally-declared IDeepgramLiveSocket interface couples the gateway to only the socket shape it uses, and lets the test's FakeV1Socket satisfy it"

key-files:
  created:
    - "src/main/stt/deepgram-stt.gateway.ts (DeepgramSttGateway implements ISttProvider — v5 connect, reconnect/backoff, keep-alive, key-safe teardown)"
    - "src/main/stt/deepgram-stt.gateway.test.ts (12 unit tests: open->connected, interim/final, empty-text skip, error-no-throw, close->reconnect w/ fake timers, drop-PCM, sendMedia, keep-alive, teardown, key-not-logged)"
  modified: []

key-decisions:
  - "Backoff curve: initial 500ms, x2, capped at 8s, +/-20% jitter (RESEARCH Pattern 4). Backoff resets to 500ms on a successful 'open'."
  - "Connection-state values surfaced: connecting | connected | reconnecting | disconnected | error (the SttConnectionState union from 04-01). The gateway uses connecting/connected/reconnecting/disconnected in this plan; 'error' is reserved/available for a future hard-fail state. setState only emits on an actual transition."
  - "Deepgram key env var: DEEPGRAM_API_KEY — read in main at the call site (04-04) and passed to the gateway constructor; the gateway never reads process.env itself, so Phase 6 safeStorage can swap the source without touching the gateway."
  - "connect() passes Authorization: '' alongside model/encoding/etc — the @deepgram/sdk HeaderAuthProvider supplies the real auth header from apiKey; the empty per-call field merges out (verified against @deepgram/sdk@5.4.0)."
  - "Keep-alive only fires when no audio was streamed in the interval (~6s), so it never competes with live PCM but still prevents idle-close during silence."

requirements-completed: [TRN-01, TRN-02, TRN-03, TRN-05]

# Metrics
duration: 18min
completed: 2026-06-17
---

# Phase 4 Plan 02: DeepgramSttGateway Summary

**Implemented `DeepgramSttGateway`, the first `ISttProvider` over `@deepgram/sdk` v5: it opens a live linear16/16 kHz/mono/interim connection, maps each message to interim-vs-final transcript events, auto-reconnects with bounded exponential backoff while surfacing a coarse connection state, keeps the socket alive through silence, drops PCM while disconnected, and keeps the Deepgram key main-only — all behind the seam, proven by 12 unit tests with the SDK mocked at the module boundary.**

## Performance

- **Duration:** ~18 min
- **Started:** 2026-06-17T23:08:11Z
- **Completed:** 2026-06-17T23:26:57Z
- **Tasks:** 2 (both TDD, fully automated — no checkpoints, autonomous plan)
- **Files modified:** 2 (2 created, 0 modified)

## Accomplishments

- **DeepgramSttGateway implements ISttProvider (TRN-05)** over the verified `@deepgram/sdk@5.4.0` live client. Consumers depend only on the seam; the gateway is the only file that imports `@deepgram/sdk`, so a future Whisper provider is a drop-in swap.
- **Interim vs final mapping (TRN-02):** `message.channel?.alternatives?.[0]?.transcript ?? ''`, empty-text skipped, `isFinal = message.is_final === true`. Defensive optional-chaining keeps an untrusted Deepgram payload from ever driving control flow (T-4-04).
- **Auto-reconnect + surfaced state (TRN-03):** on `close` the gateway enters `reconnecting` and schedules a reconnect with exponential backoff (500 ms → ×2 → 8 ms cap) plus ±20% jitter; backoff resets on the next `open`. `connection-state-change` fires once per real transition.
- **Resilience:** the gateway NEVER throws on a transport fault — `error` is surfaced via the event (and `emitError` no-ops when nobody is listening, so an early fault cannot trip Node's unlistened-`error` throw). A keep-alive timer prevents Deepgram idle-close during silence (Pitfall 3); `sendAudio` early-returns while not connected (drop-PCM-during-gap, D-06 lean).
- **Key safety (D-08/T-4-02):** the key is a constructor arg held in memory only; no `console.*` call exists in the file; a dedicated test asserts the key string never appears in any console output across start/open/error/close.
- **Quality gates green:** `npx vitest run …gateway.test.ts` 12/12, full suite 42/42, `npx tsc --noEmit` clean, oxlint clean, both new files Prettier-clean.

## Task Commits

1. **Task 1: Wave 0 gateway test stub (RED)** — `99f5e01` (test) — 12 failing tests with `@deepgram/sdk` mocked via `FakeV1Socket extends EventEmitter`, fake timers for backoff/keep-alive.
2. **Task 2: Implement DeepgramSttGateway (GREEN)** — `8bd94ea` (feat) — all 12 behaviors green; no REFACTOR commit needed (implementation clean on first GREEN).

**Plan metadata:** committed with this SUMMARY (docs: complete plan).

## Files Created/Modified

- `src/main/stt/deepgram-stt.gateway.ts` — `DeepgramSttGateway extends EventEmitter implements ISttProvider`; v5 `listen.v1.connect`, message→transcript mapping, reconnect/backoff/jitter, keep-alive, `sendAudio` drop-while-disconnected, key-safe teardown, by-convention-singleton @remarks.
- `src/main/stt/deepgram-stt.gateway.test.ts` — 12 unit tests; SDK mocked at module boundary; AAA comments on their own lines; explicitly-typed arrange objects; no real network.

## Decisions Made

- **Backoff:** initial 500 ms, ×2, max 8 s, ±20% jitter; resets to 500 ms on a successful `open`.
- **Connection-state values:** `connecting | connected | reconnecting | disconnected | error` (the 04-01 `SttConnectionState` union). This plan drives connecting/connected/reconnecting/disconnected; `error` remains available for a future terminal-fail surfacing. `setState` emits only on a real transition.
- **Key env var:** `DEEPGRAM_API_KEY` — read by main at the 04-04 call site and injected into the constructor; the gateway never touches `process.env`, so Phase 6 `safeStorage` swaps the source without touching this file.
- **Auth:** `connect({ …, Authorization: '' })` — the SDK's `HeaderAuthProvider` fills the real header from `apiKey`; the empty per-call value merges out (verified in the installed v5 client implementation).
- **Local socket interface:** declared `IDeepgramLiveSocket` (the used subset) rather than importing `V1Socket`, keeping coupling minimal and letting the fake satisfy it.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical functionality] Guard the gateway's own `error` emit against the no-listener crash**
- **Found during:** Task 2 (GREEN — the key-not-logged test failed by *throwing* "boom").
- **Issue:** The gateway is an `EventEmitter`. Node throws synchronously when an `'error'` event is emitted with no `'error'` listener attached. Re-emitting a transport error before any consumer subscribed (or in a test that doesn't subscribe to `error`) would crash the main process — directly contradicting the ISttProvider contract ("surface errors here rather than throwing, so a transient STT fault never crashes the main process").
- **Fix:** Added a private `emitError(error)` that emits only when `listenerCount('error') > 0`; routed both the socket-`error` handler and the connect-failure path through it.
- **Files modified:** `src/main/stt/deepgram-stt.gateway.ts`
- **Commit:** `8bd94ea` (folded into the GREEN commit).

**Total deviations:** 1 auto-fixed (Rule 2, correctness/resilience). No package installs, no architectural changes, no scope creep.

## Issues Encountered

- None beyond the deviation above. The installed `@deepgram/sdk@5.4.0` types mark `connect`'s `Authorization` as required (RESEARCH A6 flagged the docs show it omitted); resolved by passing `Authorization: ''` (the auth provider supplies the real header) — verified against the v1 client's `mergeOnlyDefinedHeaders` implementation.

## Known Stubs

None. The gateway is fully implemented and unit-tested. It is wired into the runtime in 04-04 (bootstrap), which is by design — this plan's output is the unit-tested gateway, not its instantiation.

## Threat Flags

None beyond the plan's existing threat register. T-4-02 (key disclosure) is mitigated here (constructor-injected key, no `console.*`, key-not-logged test). T-4-04 (untrusted payload) mitigated via optional-chaining + empty-text guard. T-4-05 (idle-close DoS / reconnect churn) mitigated via keep-alive + bounded jittered backoff + never-throw. T-4-03 (audio→Deepgram privacy) is the accepted v1 disposition, unchanged.

## Deferred / Out-of-Scope

- `npm run format:check` flags three PRE-EXISTING files not touched by this plan (`src/main/index.ts`, `src/preload/index.ts`, `src/renderer/src/services/audio-capture.service.ts`). Logged to `.planning/phases/04-stt-pipeline-live-transcript/deferred-items.md`; `audio-capture.service.ts` is slated for retirement in 04-04 (D-02/IN-01), so its formatting is best handled there. Not fixed here per the scope boundary. Both 04-02 files are Prettier- and lint-clean.

## Next Plan Readiness

- **04-03 (buffer feed):** ready — feed `DeepgramSttGateway` (as `ISttProvider`) into the `TranscriptBuffer`; consume `transcript` (interim/final) and `connection-state-change` events.
- **04-04 (bootstrap wiring):** ready — instantiate the gateway once in `index.ts` with `new DeepgramSttGateway(process.env.DEEPGRAM_API_KEY ?? <dev-config read>)`, call `start()`, route resampled `Int16Array` PCM into `sendAudio`, and push connection state to the overlay. Remember the 04-01 carry-forward: install with `--ignore-scripts`; target the currently-active output device, not `isDefault`.
- No blockers. A live end-to-end transcript still needs a real `DEEPGRAM_API_KEY` + audio (the documented manual success-criterion gate), independent of this plan's unit coverage.

## Self-Check: PASSED

- FOUND: src/main/stt/deepgram-stt.gateway.ts
- FOUND: src/main/stt/deepgram-stt.gateway.test.ts
- FOUND commit: 99f5e01 (Task 1 RED)
- FOUND commit: 8bd94ea (Task 2 GREEN)
- Tests: 12/12 green for deepgram-stt.gateway.test.ts; full suite 42/42; tsc --noEmit clean; oxlint clean.
- Source assertions: `implements ISttProvider` present; `listen.v1.connect` present; zero `console.*` calls in the gateway.

## TDD Gate Compliance

RED (`test(04-02)`, `99f5e01`) precedes GREEN (`feat(04-02)`, `8bd94ea`) in git history. REFACTOR was not needed.

---
*Phase: 04-stt-pipeline-live-transcript*
*Completed: 2026-06-17*
