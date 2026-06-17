---
id: 260617-code-review-audio-seam-warnings
created: 2026-06-17
source: 03-REVIEW.md (Phase 3 code review)
severity: warning
resolves_phase: 4
---

# Phase 3 code-review warnings to address in Phase 4

The Phase 3 code review (`.planning/phases/03-audio-loopback-spike/03-REVIEW.md`) found
3 Warnings (0 Critical). None blocked the gate, but two touch the audio capture seam that
Phase 4 will replace with the WASAPI sidecar — fold these in when reworking capture:

- **WR-01** — `desktopCapturer.getSources` result `sources[0]` is unguarded in
  `src/main/index.ts`. If empty, `callback({ video: undefined, ... })` makes
  `getDisplayMedia` reject silently. Add a `sources.length === 0` → `callback({})` guard.
  (Moot on the NO-GO machine, but the WASAPI path should have an equivalent empty-source guard.)
- **WR-02** — `AudioCaptureService.start()` is not idempotent: under React Strict Mode's
  double-invoke, the synchronous cleanup runs before the first `start()` await resolves, so
  `stop()` no-ops and the first `MediaStream`/`AudioContext` leak. Add an early-return guard
  (`if (this.stream !== undefined || this.audioContext !== undefined) return;`). Carry this
  discipline into the Phase 4 capture rework.
- **WR-03** — `preload.onStatus` wraps the callback in an anonymous function that can never be
  removed; `DebugHud`'s `useEffect` has no cleanup, so HMR/remounts accumulate listeners.
  Return a stored unsubscribe fn from `onStatus` and call it in the effect cleanup.

Info (not tracked here): IN-01 orphaned `ipcMain.on('jedi:audio-level')` listener,
IN-02 `console.error` in `App.tsx` → structured HUD error state.
