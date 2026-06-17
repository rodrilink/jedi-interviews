---
phase: 03-audio-loopback-spike
reviewed: 2026-06-17T00:00:00Z
depth: standard
files_reviewed: 12
files_reviewed_list:
  - src/main/index.ts
  - src/main/overlay-window.manager.ts
  - src/preload/index.ts
  - src/renderer/src/App.tsx
  - src/renderer/src/components/debug-hud.tsx
  - src/renderer/src/assets/hud.css
  - src/renderer/src/audio/rms.utility.ts
  - src/renderer/src/audio/rms.utility.test.ts
  - src/renderer/src/audio/rms-meter.worklet.ts
  - src/renderer/src/services/audio-capture.service.ts
  - src/renderer/src/env.d.ts
  - electron.vite.config.ts
findings:
  critical: 0
  warning: 3
  info: 2
  total: 5
status: issues_found
---

# Phase 03: Code Review Report

**Reviewed:** 2026-06-17
**Depth:** standard
**Files Reviewed:** 12
**Status:** issues_found

## Summary

Phase 03 built the system-audio loopback capture seam end-to-end: `getDisplayMedia` -> AudioWorklet RMS
meter -> `jedi:audio-level` IPC -> `setAudioLevel` -> `jedi:status` push -> HUD `Audio:` row. The
overall implementation is well-structured. The RMS math is correct and unit-tested. Both documented
threat mitigations are present and effective: T-03-01 (URL-scoped grant) is enforced at line 65 of
`index.ts`; T-03-02 (`Number.isFinite` coercion) is enforced at line 80 of `overlay-window.manager.ts`.
Security posture is sound. No critical issues found.

Three warning-level defects were identified: an unguarded array access that will crash `getDisplayMedia`
in the renderer if no screen source is found, a missing idempotency guard on `AudioCaptureService.start()`
that leaks resources under React Strict Mode's double-invoke behavior in dev, and a `preload.onStatus`
API design that makes IPC listener cleanup structurally impossible, causing listener accumulation during
HMR-driven remounts.

---

## Warnings

### WR-01: Unguarded `sources[0]` in `desktopCapturer.getSources` — causes `getDisplayMedia` to reject

**File:** `src/main/index.ts:73`

**Issue:** `desktopCapturer.getSources({ types: ['screen'] })` is called inside
`setDisplayMediaRequestHandler`. Its result is immediately accessed as `sources[0]` with no length
check. If the array is empty (headless environments, driver failures, or race conditions during
startup), `sources[0]` is `undefined` and `callback({ video: undefined, audio: 'loopback' })` is
issued. Electron's handler then has no valid video source to pair with the loopback audio grant, causing
the renderer's `getDisplayMedia` call to reject with a `NotFoundError`. This propagates as a caught
error in `App.tsx` (silenced with `console.error`), leaving the HUD audio row permanently at `—`.

**Fix:**

```typescript
void desktopCapturer.getSources({ types: ['screen'] }).then((sources) => {
    if (sources.length === 0) {
        // No screen source found; deny the request so the renderer gets a clear error.
        callback({});
        return;
    }
    callback({ video: sources[0], audio: 'loopback' });
});
```

---

### WR-02: `AudioCaptureService.start()` is not idempotent — leaks `MediaStream` and `AudioContext` under React Strict Mode

**File:** `src/renderer/src/services/audio-capture.service.ts:44`

**Issue:** `start()` has no guard against concurrent or re-entrant invocation. React Strict Mode (the
default in Vite dev) double-invokes effects: it mounts, runs cleanup, then remounts. The cleanup calls
`stop()`, but `stop()` checks `this.audioContext !== undefined` before closing. Because `start()` is
`async`, the `await getDisplayMedia(...)` has not yet returned when the synchronous cleanup fires —
`this.stream` and `this.audioContext` are still `undefined` at that moment, so `stop()` is a no-op.
The second `start()` call then runs. Both calls eventually assign their results to the same
`this.stream` / `this.audioContext` fields (second assignment wins), leaving the first `MediaStream`
and `AudioContext` with no stored reference — they cannot be stopped or closed and are permanently
leaked until the page is torn down.

In production the single-mount lifecycle avoids this, but the bug is latent and will surface on any
future re-render context that re-mounts `App` (HMR, Strict Mode, navigation).

**Fix:** Add an early-return guard so concurrent calls are safely dropped:

```typescript
public async start(): Promise<void> {
    // Guard against concurrent or re-entrant invocation — only one capture session at a time.
    if (this.stream !== undefined || this.audioContext !== undefined) {
        return;
    }

    const stream = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true });
    // ... rest of start() unchanged
}
```

---

### WR-03: `preload.onStatus` wraps the callback in an anonymous function — listener removal is structurally impossible, causing listener accumulation on HMR remounts

**File:** `src/preload/index.ts:49-51` and `src/renderer/src/components/debug-hud.tsx:71-73`

**Issue:** `onStatus` registers the listener as an anonymous wrapper:

```typescript
ipcRenderer.on(STATUS_CHANNEL, (_event, status) => callback(status));
```

The anonymous function reference is never stored or returned, so there is no way for the caller to
pass the same reference to `ipcRenderer.removeListener` later. The `DebugHud` `useEffect` passes
no cleanup function, so the listener is never removed. In Electron's dev HMR workflow, each renderer
module reload remounts `DebugHud`, adding another permanent listener to the same channel. After
ten HMR cycles, `setStatus` is called ten times per status push — the state updates are redundant
but the accumulation is unbounded. In production this component mounts once, so the practical impact
is a single listener per process lifetime, but the API design makes correct cleanup impossible.

**Fix:** Change `onStatus` to return an unsubscribe function, storing the wrapper so it can be
removed. Update `DebugHud`'s effect to call it on cleanup.

In `src/preload/index.ts`:

```typescript
onStatus(callback: (status: IOverlayStatus) => void): () => void {
    const handler = (_event: IpcRendererEvent, status: IOverlayStatus): void => callback(status);
    ipcRenderer.on(STATUS_CHANNEL, handler);
    return () => ipcRenderer.removeListener(STATUS_CHANNEL, handler);
},
```

In `src/renderer/src/components/debug-hud.tsx`:

```typescript
useEffect(() => {
    const unsubscribe = window.jedi?.onStatus((next: IOverlayStatus) => setStatus(next));
    return () => {
        unsubscribe?.();
    };
}, []);
```

Note: the `JediApi` type in `src/preload/index.d.ts` (which re-exports `typeof jediApi`) will pick
up the updated return type automatically; no manual edit needed there.

---

## Info

### IN-01: `ipcMain.on('jedi:audio-level')` listener is never removed — orphaned after window destroy

**File:** `src/main/index.ts:80-83`

**Issue:** `installAudioPipeline` registers an `ipcMain.on` handler that closes over the `window`
reference. It is never removed. If the overlay window is destroyed and a new one created (the
`activate` branch at line 124-128 runs if all windows are closed), the old handler continues to
receive `jedi:audio-level` messages and calls `pushStatus(oldWindow)`. `pushStatus` guards
`isDestroyed()`, so there is no crash, but the accumulated dead handler does nothing useful and
the new window never receives audio level pushes from subsequent renderer messages (because they
fire on the old handler which routes to the old destroyed window, not the new one). On Windows,
the `window-all-closed` handler quits the app before `activate` can fire, so this is inert for
the v1 target. Still, the handler should be removed on window close for correctness.

**Fix:** Store the handler reference and remove it on the window's `close` event, or use
`ipcMain.handle` / `ipcMain.once` patterns when the channel has a one-window lifetime.

---

### IN-02: `console.error` in `App.tsx` — intentional but flags per project lint rules

**File:** `src/renderer/src/App.tsx:30`

**Issue:** `console.error('Audio loopback capture failed to start', error)` is present. This is
intentional — the plan documents that capture failure should not crash the HUD. However, `oxlint`
with the `no-console` rule (common in frontend configs) may flag it. The error is useful during
the Phase 03 spike; Phase 4 should replace it with a structured error state surfaced in the HUD
(e.g. an `audioError` field on `IOverlayStatus`) so the failure is observable without a console.

**Fix (Phase 4):** Add an `audioError: string | null` field to `IOverlayStatus`, set it via a
new `setAudioError` setter in main, and display it in the HUD `Audio:` row when non-null. Remove
the `console.error` call.

---

## Threat Model Verification

| Threat | Mitigation Required | Present | Location | Verdict |
|--------|---------------------|---------|----------|---------|
| T-03-01 — loopback grant scoped to local renderer only | `request.frame?.url !== window.webContents.getURL()` deny check | Yes | `src/main/index.ts:65` | PASS |
| T-03-02 — non-finite IPC payload coerced to 0 | `Number.isFinite(level) ? level : 0` in `setAudioLevel` | Yes | `src/main/overlay-window.manager.ts:80` | PASS |

Both threat mitigations are correctly implemented. `contextIsolation: true` and `sandbox: true` are
unchanged from Phase 1/2 (`src/main/overlay-window.manager.ts:203-204`). No new secret exposure or
injection surfaces introduced.

---

_Reviewed: 2026-06-17_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
