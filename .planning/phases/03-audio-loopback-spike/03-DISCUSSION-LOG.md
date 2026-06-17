# Phase 3: Audio Loopback Spike - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-17
**Phase:** 3-Audio Loopback Spike
**Areas discussed:** Spike location & lifecycle, RMS meter surfacing, Pass threshold & decision record, Test audio source

---

## Spike location & lifecycle

### Where the spike lives

| Option | Description | Selected |
|--------|-------------|----------|
| Standalone verify build | Mirror Phase 1's `verify:secret` — dedicated `verify:loopback` script + own vite config, isolated from out/main. | |
| Wired into the overlay app | Loopback capture in the real main/renderer; meter in the existing HUD. | ✓ |
| Separate hidden window | Dedicated hidden BrowserWindow for capture + meter. | |

**User's choice:** Wired into the overlay app
**Notes:** Diverges from the Phase 1 isolated-verify pattern — chosen deliberately.

### Code fate after the gate

| Option | Description | Selected |
|--------|-------------|----------|
| Foundation for Phase 4 | Build the real minimal audio-capture seam Phase 4 extends; RMS meter is a removable verification layer. | ✓ |
| Throwaway in-app spike | Wire in just enough to prove signal; spike-quality, rewritten in Phase 4. | |

**User's choice:** Foundation for Phase 4
**Notes:** Gate doubles as the first increment of the Phase 4 audio pipeline.

### Capture start mechanism

| Option | Description | Selected |
|--------|-------------|----------|
| Auto-start, suppress picker | `setDisplayMediaRequestHandler` returns loopback source directly (no picker, no focus steal); capture auto-starts at app ready. | ✓ |
| Hotkey-triggered start | Dedicated 'start capture' global hotkey; still picker-suppressed. | |
| You decide | Planner picks the cleanest no-focus-steal/no-picker trigger. | |

**User's choice:** Auto-start, suppress picker
**Notes:** Preserves OVL-02 focus/click-through contract.

---

## RMS meter surfacing

### Where the level shows

| Option | Description | Selected |
|--------|-------------|----------|
| DebugHud row | 'Audio:' row driven over read-only jedi:status, same as Hotkeys:. Number + block-char bar. | ✓ |
| Console/terminal log | Periodic RMS to terminal/devtools console. | |
| Both HUD + console | HUD row plus periodic console logging for a recordable numeric trace. | |

**User's choice:** DebugHud row
**Notes:** Reuses the established status-push seam from Phases 1/2.

### Audio processing path

| Option | Description | Selected |
|--------|-------------|----------|
| AudioWorklet | RMS computed in an AudioWorklet off the main thread; same worklet Phase 4 extends to emit 16kHz Int16 PCM. | ✓ |
| AnalyserNode loop | Web Audio AnalyserNode time-domain read in a rAF loop; verification-only. | |
| You decide | Planner picks; bias to AudioWorklet given foundation intent. | |

**User's choice:** AudioWorklet
**Notes:** Matches CLAUDE.md (avoid ScriptProcessorNode) and the foundation-for-Phase-4 decision.

---

## Pass threshold & decision record

### What counts as non-silent

| Option | Description | Selected |
|--------|-------------|----------|
| Clear visual non-zero | Meter visibly/sustainedly above zero while audio plays AND ~0 when paused (fake-meter sanity check). Human-judged, no hard gate. | ✓ |
| Fixed RMS threshold | Hard numeric threshold (e.g. RMS > 0.01 sustained ≥2s). | |
| You decide | Planner specifies threshold + sustain, includes paused-zero check. | |

**User's choice:** Clear visual non-zero
**Notes:** One-time human-verified gate, not an automated test; paused-reads-zero rules out a stuck meter.

### Decision record

| Option | Description | Selected |
|--------|-------------|----------|
| Dedicated gate doc + STATE | Committed `03-LOOPBACK-GATE.md` (machine, Electron version, RMS behavior, source, GO/NO-GO, fallback trigger) + STATE/PROJECT decision. | ✓ |
| VERIFICATION.md only | Record solely in the phase VERIFICATION.md. | |
| You decide | Planner picks the artifact as long as machine + Electron version + GO/NO-GO + fallback captured. | |

**User's choice:** Dedicated gate doc + STATE
**Notes:** Mirrors Phase 1 GO/NO-GO record and Phase 2 conflict-test doc.

---

## Test audio source

| Option | Description | Selected |
|--------|-------------|----------|
| Both: media + a real meeting | Prove signal with general media first, then confirm real Teams/Zoom call audio. | ✓ |
| General media only | Prove non-silent signal with any media playback. | |
| Meeting audio only | Test exclusively against Teams/Zoom call audio. | |

**User's choice:** Both: media + a real meeting
**Notes:** Catches the communication-device routing gotcha (Teams/Zoom may route call audio through a comms-specific render endpoint) before Phase 4. Media-works-but-meeting-doesn't = partial NO-GO pointing at device routing.

---

## Claude's Discretion

- Exact module/file shape and location of the audio-capture seam; how it composes with `overlay-window.manager.ts` and the `jedi:status` push.
- AudioWorklet internal RMS math, meter update cadence/throttle, exact visual form of the `Audio:` HUD row.
- MediaStream/AudioContext lifecycle and capture teardown on quit.
- Precise `getDisplayMedia` constraints beyond the locked `video:true`-present requirement, and how the discarded video track is stopped.

## Deferred Ideas

- 16 kHz mono Int16 PCM down-mix/resample for Deepgram — Phase 4 (TRN-01).
- `naudiodon` WASAPI sidecar implementation — only on a NO-GO.
- Mic capture / diarization — out of scope for v1 (system audio only).
- Start/stop capture hotkey — auto-start chosen for the spike.
