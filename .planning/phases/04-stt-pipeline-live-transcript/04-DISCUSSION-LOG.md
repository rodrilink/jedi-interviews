# Phase 4: STT Pipeline + Live Transcript - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-17
**Phase:** 4-STT Pipeline + Live Transcript
**Areas discussed:** WASAPI sidecar shape, Transcript IPC + render, Deepgram gateway + seam, Reconnect + bounded buffer

---

## WASAPI sidecar shape

### How should the WASAPI capture run?

| Option | Description | Selected |
|--------|-------------|----------|
| Separate child process | naudiodon(-loopback) in its own Node child process; PCM piped to main; native crash kills only the sidecar | |
| In-main native addon | naudiodon(-loopback) loaded directly in Electron main (like uiohook); simpler, no child-process plumbing; native crash takes down the app | ✓ |
| You decide | Defer to researcher/planner | |

**User's choice:** In-main native addon
**Notes:** Grounded with web search — plain `naudiodon` doesn't expose loopback; needs the `naudiodon-loopback` fork; native-module rebuild risk like uiohook. Still satisfies "never touches Chromium screen capture."

### Where should down-mix + resample to 16kHz mono Int16 PCM happen?

| Option | Description | Selected |
|--------|-------------|----------|
| In main (TS) + retire worklet | Resample in a main-process utility; remove renderer worklet + audio-capture.service; one audio path in main | ✓ |
| Configure naudiodon to 16kHz | Ask WASAPI for 16kHz mono directly; risk: WASAPI loopback usually only offers native mixer format | |
| You decide | Defer to researcher | |

**User's choice:** In main (TS) + retire worklet
**Notes:** rms.utility.ts math reusable for a main-computed meter.

### What happens to the `Audio:` level meter?

| Option | Description | Selected |
|--------|-------------|----------|
| Recompute in main, keep HUD row | Compute RMS in main from PCM; keep Audio: row as capture-alive signal; retire reportAudioLevel channel | |
| Drop the meter entirely | Remove Audio: row; transcript IS proof capture works | |
| You decide | Defer to planner | ✓ |

**User's choice:** You decide
**Notes:** Captured as Claude's Discretion with a lean toward keeping a main-computed meter (audio is the load-bearing risk; meter distinguishes silent-but-flowing from broken).

---

## Transcript IPC + render

### How should transcript data reach the overlay?

| Option | Description | Selected |
|--------|-------------|----------|
| Dedicated transcript channel | New one-way jedi:transcript channel, separate from jedi:status | |
| Reuse jedi:status | Add transcript fields to IOverlayStatus | |
| You decide | Defer to planner | ✓ |

**User's choice:** You decide
**Notes:** Discretion with a strong lean to a dedicated channel (high-frequency interim results would bloat/couple the status payload).

### Where does TranscriptBuffer live?

| Option | Description | Selected |
|--------|-------------|----------|
| Main (push view to overlay) | Authoritative buffer in main next to gateway; Phase 5 AI reads span directly | |
| Renderer-side buffer | Renderer accumulates segments; Phase 5 AI must pull back, fighting one-way boundary | |
| You decide | Defer to planner | ✓ |

**User's choice:** You decide
**Notes:** Discretion with a strong lean to main-side (architecture + Phase 5 main-side read both point there).

### What renders the live transcript on the overlay?

| Option | Description | Selected |
|--------|-------------|----------|
| New transcript overlay surface | Dedicated content component, separate from DebugHud | |
| Extend DebugHud | Add transcript to the existing DebugHud | ✓ |
| You decide | Defer to planner/UI | |

**User's choice:** Extend DebugHud
**Notes:** Deliberate scope-minimizing call; dedicated surface deferred to Phase 5 (which has a UI hint).

### Is transcript-follows-HUD-toggle acceptable for Phase 4?

| Option | Description | Selected |
|--------|-------------|----------|
| Acceptable — transcript follows HUD toggle | Transcript shows/hides with the HUD | ✓ |
| Transcript visible independent of HUD | Separate visibility flag for transcript vs debug rows | |
| You decide | Defer to planner | |

**User's choice:** Acceptable — transcript follows HUD toggle
**Notes:** Phase 5 can split out an always-on surface later.

---

## Deepgram gateway + seam

### What should the ISttProvider interface expose?

| Option | Description | Selected |
|--------|-------------|----------|
| Event-emitter style | start/stop/sendAudio + typed events (transcript, connection-state, error); matches Deepgram v5 | |
| Callback/stream interface | onTranscript/onStateChange callbacks or async iterator | |
| You decide | Defer to researcher | ✓ |

**User's choice:** You decide
**Notes:** Discretion leaning event-emitter (matches Deepgram v5 connection.on('message')); researcher confirms exact v5 shape.

### How should Phase 4 source the Deepgram API key?

| Option | Description | Selected |
|--------|-------------|----------|
| Env var / dev config now, Phase 6 swaps in | Key from env/untracked dev config in main; never renderer/logs/commits; Phase 6 safeStorage replaces source | ✓ |
| Minimal safeStorage entry now | Pull Phase 6 key storage forward — risks scope creep | |
| You decide | Defer to planner | |

**User's choice:** Env var / dev config now, Phase 6 swaps in
**Notes:** Keeps Phase 6 settings-UI scope out of Phase 4 while still proving a real live transcript.

---

## Reconnect + bounded buffer

### How should the transcript buffer be bounded?

| Option | Description | Selected |
|--------|-------------|----------|
| By time window (last N minutes) | Drop older than N minutes; aligns with Phase 5 ~60s span | ✓ |
| By segment/word count | Keep last N segments/words; deterministic size, less time-aligned | |
| You decide | Defer to planner | |

**User's choice:** By time window (last N minutes)
**Notes:** Planner sets N + a hard memory ceiling.

### What happens to PCM captured during a reconnect gap?

| Option | Description | Selected |
|--------|-------------|----------|
| Drop PCM during gap | Discard while disconnected, resume on reconnect; simplest, bounded | |
| Buffer PCM, flush on reconnect | Hold + flush; needs a bounded PCM queue; likely over-engineered for v1 | |
| You decide | Defer to planner | ✓ |

**User's choice:** You decide
**Notes:** Discretion leaning drop-during-gap for v1; connection state surfaces on the overlay either way.

### How should the clear-transcript hotkey be added?

| Option | Description | Selected |
|--------|-------------|----------|
| New Ctrl+Alt chord via existing registrar | New chord through HotkeyRegistrarService with register()-result checking; planner picks the letter | ✓ |
| You decide | Defer to planner | |

**User's choice:** New Ctrl+Alt chord via existing registrar
**Notes:** Planner picks a letter avoiding J/arrows/[]/H/Q and re-checks vs Teams/Zoom/VS Code.

---

## Claude's Discretion

- Audio level meter fate (keep main-computed vs drop) — lean: keep.
- Transcript IPC topology (dedicated channel vs reuse jedi:status) — lean: dedicated channel.
- TranscriptBuffer location — lean strongly: main-side.
- ISttProvider interface style — lean: event-emitter.
- Reconnect gap handling (drop vs buffer-and-flush) — lean: drop for v1.
- Reconnect backoff curve and exact connection-state values surfaced on the overlay.

## Deferred Ideas

- Dedicated always-on transcript content surface (decoupled from HUD) → Phase 5.
- safeStorage key entry + settings window → Phase 6.
- Local Whisper ISttProvider implementation → v2 (seam built now; Whisper stub noted for Phase 7).
- Bounded-buffer-and-flush of PCM across reconnect gaps → only if v1 drop proves inadequate.

## Folded Todos

- 260617-code-review-audio-seam-warnings (Phase 3 review warnings WR-01/02/03 + IN-01) — folded into the capture rework / DebugHud extension. See CONTEXT.md Folded Todos.
