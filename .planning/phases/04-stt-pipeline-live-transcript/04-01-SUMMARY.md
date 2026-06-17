---
phase: 04-stt-pipeline-live-transcript
plan: 01
subsystem: audio
tags: [wasapi, loopback, native-addon, deepgram, stt, pcm, resample, electron, n-api]

# Dependency graph
requires:
  - phase: 03-audio-loopback-spike
    provides: "Chromium getDisplayMedia loopback NO-GO (DXGI duplicator failure) — forced the WASAPI-in-main pivot this plan de-risks"
  - phase: 02-global-hotkeys-window-control
    provides: "Native-module precedent (uiohook prebuilt N-API binary loads under Electron 35.7.5 where from-source fails) and the I-prefixed interface / by-convention-singleton conventions copied here"
provides:
  - "Validated in-process WASAPI loopback capture path (native-recorder-nodejs@1.2.0) — GO on this machine"
  - "ISttProvider seam (TRN-05): start/stop/sendAudio + transcript/connection-state-change/error events, Deepgram-agnostic"
  - "Pure unit-tested PCM utility (TRN-01): downmixToMonoFloat32, resampleLinear, float32ToInt16, assertSampleRate"
  - "Pinned deps + committed lockfile: native-recorder-nodejs@1.2.0, @deepgram/sdk@5.4.0"
affects: [04-02-deepgram-gateway, 04-03-buffer-feed, 04-04-bootstrap-wiring, phase-05-ai-orchestrator]

# Tech tracking
tech-stack:
  added:
    - "native-recorder-nodejs@1.2.0 (in-process WASAPI loopback capture, prebuilt win32-x64 N-API binary)"
    - "@deepgram/sdk@5.4.0 (live streaming STT, pure JS)"
  patterns:
    - "Provider seam first: consumers depend on ISttProvider, never @deepgram/sdk directly (TRN-05)"
    - "Pure unit-testable .utility.ts for all PCM conversion; loud-fail rate assertion guards silent garble"
    - "Native-module risk gated by a human go/no-go BEFORE any pipeline is built on it (uiohook lesson)"

key-files:
  created:
    - "src/main/stt/stt-provider.interface.ts (ISttProvider + ISttTranscriptEvent + SttConnectionState)"
    - "src/main/audio/pcm-resample.utility.ts (downmix/resample/convert + assertSampleRate)"
    - "src/main/audio/pcm-resample.utility.test.ts (8 unit tests)"
  modified:
    - "package.json (exact pins for native-recorder-nodejs + @deepgram/sdk)"
    - "package-lock.json (committed lockfile)"
    - ".gitignore (dev-secret files + throwaway *.scratch.* spikes)"

key-decisions:
  - "GO: native-recorder-nodejs@1.2.0 loads in-process under Electron 35.7.5 and captures non-silent WASAPI loopback PCM (sustained RMS 0.10-0.35, peak 0.35259, 1920-byte buffers). Reverses the Phase 3 Chromium NO-GO."
  - "Observed device format: 48000 Hz / 2 channels / 16-bit — record 48000 as the resample inRate for pcm-resample.utility."
  - "Install deviation: native-recorder-nodejs must be installed with `npm install --ignore-scripts` (prebuild-install finds no ABI match; cmake-js fallback unavailable; the tarball's bundled prebuilds/win32-x64/NativeAudioSDK.node loads by path)."
  - "04-04 design finding: capture must target the CURRENTLY-ACTIVE output device, NOT the isDefault one. `outputs.find(isDefault) ?? outputs[0]` is insufficient on this machine."

patterns-established:
  - "ISttProvider event-emitter seam mirrors Deepgram v5's connection.on('message') model so Whisper (v2) is a drop-in swap"
  - "assertSampleRate fails loudly on declared!=actual instead of producing a silently pitch-shifted transcript"

requirements-completed: [TRN-01, TRN-05]

# Metrics
duration: 106min
completed: 2026-06-17
---

# Phase 4 Plan 01: STT Seam + Resample Utility + WASAPI Capture Go/No-Go Summary

**Proved native-recorder-nodejs@1.2.0 captures non-silent WASAPI loopback in-process under Electron 35.7.5 (GO), and defined the two contracts every downstream plan builds on: the Deepgram-agnostic ISttProvider seam (TRN-05) and the pure, unit-tested PCM down-mix/resample utility with a loud sample-rate assertion (TRN-01).**

## Performance

- **Duration:** ~106 min (incl. the blocking human capture gate)
- **Started:** 2026-06-17T21:14:23Z
- **Completed:** 2026-06-17T23:02:25Z
- **Tasks:** 3 (Task 1 gated by human verify; Tasks 2-3 fully automated)
- **Files modified:** 6 (3 created, 3 modified)

## Accomplishments
- **Capture go/no-go: GO.** The single biggest phase unknown is de-risked. native-recorder-nodejs@1.2.0 loads as an in-process N-API addon under the pinned Electron 35.7.5 and captures genuinely non-silent system-audio loopback PCM (human-verified: sustained rolling RMS 0.10-0.35, peak 0.35259). This validates the WASAPI-in-main pivot the whole Phase 4 architecture depends on and reverses the Phase 3 Chromium-loopback NO-GO.
- **ISttProvider seam (TRN-05)** defined first, Deepgram-agnostic, so 04-02's gateway implements it and 04-03/04-04 + Phase 5's AI depend on the interface — not @deepgram/sdk.
- **Pure PCM utility (TRN-01)** with downmix/resample/convert and a loud declared-vs-actual rate assertion; 8 unit tests green, full suite 30/30, tsc clean.
- **Dependencies pinned and lockfile committed**; the throwaway capture spike was gitignored and deleted; no Deepgram key (or any secret) committed or logged.

## Task Commits

1. **Task 1: Install pinned native capture + Deepgram deps; gitignore dev secrets** - `dbae1bb` (chore) + human go/no-go GO
2. **Task 2: Define the ISttProvider seam (TRN-05)** - `ca4f097` (feat)
3. **Task 3: Pure PCM resample utility (TRN-01)** - `a1b0e67` (test, RED) → `f2c08ad` (feat, GREEN)

**Plan metadata:** committed with this SUMMARY (docs: complete plan)

## Files Created/Modified
- `src/main/stt/stt-provider.interface.ts` - ISttProvider + ISttTranscriptEvent + SttConnectionState contract; no implementation, no Deepgram import (TRN-05)
- `src/main/audio/pcm-resample.utility.ts` - downmixToMonoFloat32 / resampleLinear / float32ToInt16 / assertSampleRate, pure + idempotent (TRN-01)
- `src/main/audio/pcm-resample.utility.test.ts` - 8 unit tests: downmix (+ empty guard), 48k→16k length + 16k passthrough, asymmetric Int16 conversion + clamp, rate-mismatch throw
- `package.json` - exact pins: native-recorder-nodejs@1.2.0, @deepgram/sdk@5.4.0
- `package-lock.json` - committed lockfile
- `.gitignore` - dev-secret files (.env / *.local / dev-config) per D-08; throwaway *.scratch.* spike globs

## Decisions Made
- **GO on native-recorder-nodejs@1.2.0** (human-verified capture gate). In-process N-API load under Electron 35.7.5; non-silent loopback PCM; device format **48000 Hz / 2 ch / 16-bit**. The audiotee child-process sidecar fallback is NOT needed.
- **Record 48000 Hz as the resample inRate** for pcm-resample.utility — but the real pipeline must read it from `AudioRecorder.getDeviceFormat()` and pass it through `assertSampleRate`, never hardcode it.
- Followed the plan's interface shape and Pattern 2 utility bodies exactly.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] native-recorder-nodejs install requires `--ignore-scripts`**
- **Found during:** Task 1 (dependency install)
- **Issue:** `npm install native-recorder-nodejs@1.2.0` fails: the package's `install` hook is `prebuild-install || npm run build:native`. `prebuild-install` finds no prebuild matching the local Node ABI (`target=24.13.0`), then falls back to `cmake-js compile`, which is not installed → install errors out, nothing lands.
- **Fix:** Did NOT substitute another package (per the package-install-failure protocol — slopsquat/hallucination caution; the package was already a flagged young/low-download dependency). Inspected the published tarball: it ships `prebuilds/win32-x64/NativeAudioSDK.node` (279 KB), and the package's own loader `dist/bindings.js` `require()`s it **directly by path** — it does not need `prebuild-install` to have run. Installed via `npm install --ignore-scripts`, which lands the bundled binary cleanly. Pins set exact; lockfile committed.
- **Files modified:** package.json, package-lock.json
- **Verification:** `node_modules/native-recorder-nodejs/prebuilds/win32-x64/NativeAudioSDK.node` present; addon loads + captures in the Electron spike; human GO.
- **Committed in:** `dbae1bb`
- **FLAG for CI and 04-04:** any reinstall / clean CI checkout of this repo MUST run `npm install --ignore-scripts` (or otherwise tolerate the broken install hook) or the build will fail at the native-recorder-nodejs install step.

---

**Total deviations:** 1 auto-fixed (1 blocking). No package substitution; no scope creep.
**Impact on plan:** The install deviation is necessary to use the chosen, plan-pinned package; it changes the install command only, not the package or the architecture.

## Issues Encountered
- **First spike run looked like a NO-GO (silence).** The spike's `outputs.find(isDefault) ?? outputs[0]` selected "Headphones (WH-1000XM5)", which enumerated as the default but was **silent** — Windows was actually routing audio to "Speakers (Realtek(R) Audio)". Selecting the currently-active output device produced the non-silent signal (RMS 0.10-0.35) and turned the gate GO.
  - **CRITICAL DESIGN FINDING for 04-04 (flagged downstream):** the real capture pipeline MUST target the **currently-active** output device, NOT the `isDefault` one. The `isDefault` device is not necessarily where Windows is routing audio. `outputs.find(isDefault) ?? outputs[0]` is insufficient; 04-04 needs active-device selection (and ideally re-selection on device/route change), plus the WR-01 empty-device guard.

## Known Stubs
None. The ISttProvider file is an intentional contract (no implementation by design — 04-02's DeepgramSttGateway implements it). The resample utility is fully implemented and tested.

## Threat Flags
None beyond the plan's existing threat register. The young-native-package supply-chain risk (T-4-01) was the planned mitigation target and is now discharged by the human capture go/no-go (GO) plus exact pin + committed lockfile + in-tarball binary (no install-time network fetch). No Deepgram key sourced or logged in this plan (T-4-02 deferred to 04-02).

## User Setup Required
A Deepgram API key (`DEEPGRAM_API_KEY`, from https://console.deepgram.com/ → API Keys) is required later to demonstrate a live transcript (success criterion 1) — sourced from an env var / untracked local dev-config read in main only (D-08). NOT needed for this plan's capture go/no-go gate (RMS-only). The dev-config/.env files are already gitignored.

## Next Phase Readiness
- **04-02 (DeepgramSttGateway):** ready — implement `ISttProvider` over `@deepgram/sdk@5.4.0` (already installed). Key sourcing via env/dev-config (D-08).
- **04-04 (bootstrap wiring):** ready, with two MUST-honor findings recorded above — (1) install with `--ignore-scripts`, (2) select the currently-active output device, not `isDefault`. Use `getDeviceFormat()` → `assertSampleRate(format.sampleRate, 16000-target inRate)` → `downmixToMonoFloat32` → `resampleLinear(_, format.sampleRate, 16000)` → `float32ToInt16` → `sendAudio`.
- No blockers. audiotee sidecar fallback not needed (capture GO).

## Self-Check: PASSED

- FOUND: src/main/stt/stt-provider.interface.ts
- FOUND: src/main/audio/pcm-resample.utility.ts
- FOUND: src/main/audio/pcm-resample.utility.test.ts
- FOUND: node_modules/native-recorder-nodejs/prebuilds/win32-x64/NativeAudioSDK.node
- FOUND commit: dbae1bb (Task 1 deps)
- FOUND commit: ca4f097 (Task 2 seam)
- FOUND commit: a1b0e67 (Task 3 RED)
- FOUND commit: f2c08ad (Task 3 GREEN)
- Tests: 8/8 green for pcm-resample.utility.test.ts; full suite 30/30; tsc --noEmit clean.

---
*Phase: 04-stt-pipeline-live-transcript*
*Completed: 2026-06-17*
