---
id: 260620-deepgram-keepalive-crash
type: bug
status: pending
created: 2026-06-20
severity: high
resolves_phase: 8
source: error-1.png (on-machine, 2026-06-20)
---

# Deepgram keep-alive crashes the main process on a closed socket

## Symptom
Uncaught exception in the Electron MAIN process (crash dialog "A JavaScript error occurred in the main process"):

```
Uncaught Exception:
Error: Socket is not open.
    at WrappedListenV1Socket.assertSocketIsOpen (@deepgram/sdk/dist/...:19)
    at WrappedListenV1Socket.sendKeepAlive (@deepgram/sdk/dist/...:14)
    at Timeout._onTimeout (out/main/index.js:686:25)
    at listOnTimeout (node:internal/timers)
```

## Root cause (hypothesis)
The ~6s keep-alive timer (DeepgramSttGateway, Phase 04-02) fires `sendKeepAlive()` after the
Deepgram WebSocket has already closed/dropped (disconnected or mid-reconnect). The SDK's
`assertSocketIsOpen` throws synchronously, and the throw is INSIDE a `setTimeout`/`Timeout._onTimeout`
callback — so it escapes any surrounding try/catch and becomes an uncaught exception that crashes main.

## Fix direction
In the Deepgram gateway keep-alive timer: guard before calling sendKeepAlive — only send when the
connection state is `connected` (the gateway already tracks connecting/connected/reconnecting/
disconnected/error), and/or wrap the keep-alive call in try/catch so a closed-socket throw can never
escape the timer callback. Clear/stop the keep-alive interval on disconnect/error and restart it on
(re)open. Add a unit test: keep-alive tick while disconnected must NOT throw and must NOT crash.

## Notes
- Discovered during v1.0 on-machine testing (the empty-transcript / disconnected-STT sessions are the
  trigger condition). Not caught by tests because the unit suite never exercises a keep-alive tick
  against a closed socket.
- Candidate for v1.1.
