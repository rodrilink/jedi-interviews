---
phase: 03-audio-loopback-spike
plan: 01
subsystem: audio-capture
tags: [audio, loopback, audioworklet, ipc, rms, electron, getDisplayMedia]
requires:
  - 'IOverlayStatus / STATUS_CHANNEL / pushStatus seam (Phase 1/2)'
  - 'DebugHud + jedi:status read-only push (Phase 1/2)'
  - 'Electron 35.7.5 native loopback (Phase 1 GO)'
provides:
  - 'AudioCaptureService: renderer system-audio loopback capture seam (Phase 4 audio source)'
  - 'rms-meter AudioWorklet posting RMS scalars to the main thread'
  - 'computeRms pure, unit-tested RMS utility'
  - 'audioLevel field on IOverlayStatus (all 3 sites) + setAudioLevel setter'
  - "First write-only renderer->main IPC channel: jedi:audio-level + reportAudioLevel"
  - 'Picker-free loopback grant via setDisplayMediaRequestHandler'
  - 'HUD Audio: row (cell-audio-level) with live number + block-bar meter'
affects:
  - 'src/main/index.ts (now installs the loopback grant + first ipcMain listener)'
  - 'src/preload/index.ts (boundary now has one write-only exception)'
  - 'electron.vite.config.ts (renderer now emits a dedicated worklet asset)'
tech-stack:
  added: []
  patterns:
    - 'AudioWorklet (not ScriptProcessorNode) for off-main-thread RMS'
    - 'getDisplayMedia({audio:true, video:true}) + discard video track (Windows loopback)'
    - 'Dedicated rollup input entry to emit a transpiled standalone worklet module'
    - 'Narrow write-only renderer->main IPC channel re-broadcast on the read-only status push'
key-files:
  created:
    - src/renderer/src/audio/rms.utility.ts
    - src/renderer/src/audio/rms.utility.test.ts
    - src/renderer/src/audio/rms-meter.worklet.ts
    - src/renderer/src/services/audio-capture.service.ts
    - src/renderer/src/env.d.ts
  modified:
    - src/main/overlay-window.manager.ts
    - src/main/index.ts
    - src/preload/index.ts
    - src/renderer/src/App.tsx
    - src/renderer/src/components/debug-hud.tsx
    - src/renderer/src/assets/hud.css
    - electron.vite.config.ts
decisions:
  - '03-01: AudioWorklet bundled as a dedicated rollup input entry with a fixed entryFileNames (assets/rms-meter.worklet.js); a bare .ts via ?url or new URL(import.meta.url) emits RAW untranspiled source the browser cannot execute'
  - '03-01: First write-only renderer->main IPC channel (jedi:audio-level) — Option 1 from PATTERNS; everything else stays one-way main->renderer'
  - '03-01: setDisplayMediaRequestHandler scoped to the local overlay webContents URL only; denies any other frame (T-03-01); useSystemPicker:false (D-03)'
  - '03-01: setAudioLevel coerces non-finite IPC input to 0 (T-03-02 untrusted-payload mitigation)'
  - '03-01: Audio HUD row = fixed 2-decimal number + 10-cell block-bar (█/░), monospaced .debug-hud__meter to avoid reflow (D-04)'
metrics:
  duration: 8min
  completed: 2026-06-17
---

# Phase 3 Plan 01: Audio Loopback Capture + Live RMS Meter Summary

Built the end-to-end system-audio loopback capture seam — renderer `getDisplayMedia` loopback -> AudioWorklet RMS -> first write-only `jedi:audio-level` IPC channel -> `setAudioLevel`/`pushStatus` -> HUD `Audio:` row — as real Phase 4 foundation, with the RMS math unit-tested and capture auto-starting picker-free at app ready.

## What Was Built

- **Pure RMS utility (`computeRms`)** — `sqrt(mean of squares)`, guards empty frame to 0; the unit-tested source of truth. Four Vitest AAA tests (silent->0, full-scale->1, empty->0, mixed frame) green.
- **`rms-meter` AudioWorklet** — `RmsMeterProcessor` reads the first input channel each quantum, inlines the same RMS math (worklet scope can't import project modules), posts the scalar via `this.port.postMessage`, returns `true` to stay alive. Structured so Phase 4 can extend it to 16 kHz Int16 PCM (D-05).
- **`AudioCaptureService`** — `getDisplayMedia({audio:true, video:true})` (video required on Windows), stops/discards the video track, wires `MediaStreamSource -> AudioWorkletNode('rms-meter')`, throttles level reports to ~12 Hz, forwards via `window.jedi.reportAudioLevel`. `stop()` tears down tracks + AudioContext. Auto-started from an `App.tsx` no-gesture `useEffect` with cleanup (D-03).
- **Worklet bundling** — dedicated rollup input entry in `electron.vite.config.ts` with a fixed `entryFileNames`, emitting a transpiled standalone `assets/rms-meter.worklet.js`; the service loads it via `new URL('assets/rms-meter.worklet.js', window.location.href)`.
- **Status + IPC + grant (main)** — `audioLevel` on `IOverlayStatus` in all three sites; `setAudioLevel` (coerces non-finite to 0) + `buildStatus` inclusion; `setDisplayMediaRequestHandler` granting `audio:'loopback'` picker-free, scoped to the local overlay webContents only; `ipcMain.on('jedi:audio-level')` -> `setAudioLevel` + `pushStatus`.
- **HUD `Audio:` row** — `formatAudioMeter` renders a 2-decimal number + 10-cell `█/░` bar; `data-testid="cell-audio-level"`; monospaced `.debug-hud__meter` CSS.

## Task Commits

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| 1 | Pure RMS utility + worklet processor (TDD) | b2eb5f7 | rms.utility.ts, rms.utility.test.ts, rms-meter.worklet.ts |
| 2 | Renderer capture seam + worklet bundling, auto-started | ecdf081 | audio-capture.service.ts, App.tsx, env.d.ts, preload/index.ts, electron.vite.config.ts |
| 3 | audioLevel field (4 sites) + loopback grant + HUD row | 65276bc | overlay-window.manager.ts, index.ts, preload/index.ts, debug-hud.tsx, hud.css |

## Verification

- `npx vitest run` — 22 tests pass (4 new RMS tests + existing 18).
- `npm run typecheck` (node + web) — clean.
- `npm run build` — main/preload/renderer bundles build; `out/renderer/assets/rms-meter.worklet.js` emitted as transpiled JS (verified no TypeScript syntax, contains `registerProcessor('rms-meter', ...)`).
- Task 3 grep gate — `audioLevel` in all sites, `setAudioLevel`, `jedi:audio-level` in preload + main, `setDisplayMediaRequestHandler`, `cell-audio-level` all present.
- `npm run format:check` (repo-wide) + `oxlint` — clean.
- Live meter behavior (moves while audio plays, reads ~0 when paused) is HUMAN-judged on-machine in 03-02 per D-06 — not asserted here.

## Deviations from Plan

### Auto-fixed / Adjustments

**1. [Rule 3 - Blocking issue] Worklet bundling: rollup input entry instead of `?url`/`new URL`**
- **Found during:** Task 2.
- **Issue:** Both `import x from '...worklet.ts?url'` and `new URL('...worklet.ts', import.meta.url)` made Vite treat the bare `.ts` as a static asset and emit/inline the **raw untranspiled TypeScript** (a `data:video/mp2t;base64,...` URL still containing `declare class`, type annotations) — which an AudioWorklet cannot execute.
- **Fix:** Declared the worklet as its own rollup input entry with a fixed `entryFileNames` (`assets/rms-meter.worklet.js`), forcing the TS->JS transform; the service references that stable path resolved against `window.location.href`.
- **Files:** electron.vite.config.ts, audio-capture.service.ts. **Commit:** ecdf081.

**2. [Rule 3 - Cross-task type dependency] `reportAudioLevel` preload method added in Task 2**
- **Found during:** Task 2.
- **Issue:** Task 2's `AudioCaptureService` calls `window.jedi.reportAudioLevel`, which would not typecheck (Task 2 acceptance requires clean `typecheck:web`) until the preload method exists — but the plan nominally lists the preload write-channel work under Task 3.
- **Fix:** Added the write-only `reportAudioLevel` method + `AUDIO_LEVEL_CHANNEL` constant to preload in Task 2 (the renderer-side half of the contract the seam depends on). The main-side `ipcMain.on` listener, the `audioLevel` status field in all sites, and the HUD row remained in Task 3 as planned.
- **Files:** src/preload/index.ts. **Commit:** ecdf081 (method) + 65276bc (status field).

**3. [Rule 2 - Threat mitigation T-03-02] Non-finite IPC input coercion**
- **Found during:** Task 3.
- **Issue:** `jedi:audio-level` is the first untrusted renderer->main payload; the threat register assigns `mitigate`.
- **Fix:** `setAudioLevel` coerces non-finite input to 0; the value feeds only the numeric HUD readout, never control flow/paths/eval. `setDisplayMediaRequestHandler` denies any frame whose URL differs from the overlay webContents (T-03-01).
- **Files:** overlay-window.manager.ts, index.ts. **Commit:** 65276bc.

**4. [Rule 3] New `src/renderer/src/env.d.ts`**
- Added a minimal `/// <reference types="vite/client" />` so the renderer picks up Vite client ambient types. Not in the plan's file list but required for clean renderer typing. **Commit:** ecdf081.

## Known Stubs

None. The capture path is fully wired; the only thing not exercised here is the on-machine live-signal judgement, which is 03-02's explicit scope (D-06).

## Threat Flags

None beyond the plan's `<threat_model>`. The new surface (`setDisplayMediaRequestHandler`, `ipcMain.on('jedi:audio-level')`) is exactly the registered T-03-01/T-03-02 surface and is mitigated as planned.

## Self-Check: PASSED

All created files present on disk (rms.utility.ts, rms.utility.test.ts, rms-meter.worklet.ts, audio-capture.service.ts, env.d.ts, 03-01-SUMMARY.md) and the transpiled worklet asset emitted (out/renderer/assets/rms-meter.worklet.js). All task commits verified in git log: b2eb5f7, ecdf081, 65276bc, 1ccbb0b.
