# Phase 3 — Loopback GO/NO-GO Gate

**Purpose:** Run the 03-01 app on the target Windows 11 machine at the pinned Electron version and
human-judge — by eye, from the HUD `Audio:` row, with no hard-coded numeric threshold (D-06) — whether
system-audio loopback produces real, non-silent audio (AUD-02). This is the load-bearing risk for the
whole project: loopback silence is the single biggest technical risk. Built-in loopback proceeds on GO;
the comms-device-routing interpretation (D-09) or the `naudiodon` WASAPI-sidecar fallback is triggered
otherwise. No Deepgram/STT code is written until this gate is recorded.

**Decision record style** mirrors the Phase 1 `01-PHASE-VERIFICATION.md` / root `VERIFICATION.md` and the
Phase 2 `02-HOTKEY-CONFLICT-TEST.md` on-machine evidence docs.

---

## Test environment

| Field             | Value                                                              |
| ----------------- | ------------------------------------------------------------------ |
| Machine           | MSI                                                                |
| OS                | Windows 11, Version 10.0.26200.8655                                |
| Electron version  | **35.7.5** (the pinned version; confirmed in the HUD readout)      |
| Session context   | Local, physical screen — **NOT** RDP, **NOT** a locked/VM session  |
| App under test    | 03-01 capture seam (`getDisplayMedia` loopback → AudioWorklet RMS → HUD `Audio:` row) |
| Judged by         | rodrigo-gomez@idexx.com                                            |
| Date              | 2026-06-17                                                         |

The "NOT RDP / NOT locked / NOT VM" note is deliberate: those are the common triggers for DXGI
desktop-duplicator failure, and they were ruled out here — the failure below is intrinsic to this
machine's capture backend, not an environment artifact.

---

## Two-source observation (D-08)

> Legend per D-06: GO requires the meter to **visibly and sustainedly move well above zero while audio
> plays** AND **read ~0 when audio is paused**. Sources are tested in order: general media first to prove
> the pipeline, then a real Teams/Zoom call to prove the product.

| # | Source                        | Meter while playing | Meter when paused | Result          |
| - | ----------------------------- | ------------------- | ----------------- | --------------- |
| 1 | General media (YouTube/Spotify/system sound) | **Stuck at 0** — never moved above zero while media played; no non-silent signal | n/a (never rose, so nothing to fall from) | **NO signal** |
| 2 | Real Teams/Zoom call          | **NOT REACHED**     | —                 | Moot            |

**Why Source 2 was not reached:** Source 1 is the pipeline-proving step. Because the pipeline produced no
signal at all on general media, the meeting-source test (which only distinguishes the comms-device-routing
case from working capture) was moot — there is nothing to route when the capture session itself carries no
samples. Per D-09 this is therefore **NOT** the partial-NO-GO / comms-device-routing case (which requires
general media to work while the meeting call does not); it is a full NO-GO at the general-media step.

---

## Root cause

Chromium's screen-capture backend fails **continuously** on this machine:

```
DxgiDuplicatorController failed to capture desktop, error code Duplication failed
Failed to capture 1 frames within 500 milliseconds
```

These fire repeatedly (~every 0.75 s). `getDisplayMedia` couples the loopback **audio** track to a screen
**video** capturer (the DXGI desktop duplicator). When the duplicator cannot capture, the entire capture
session is broken and the loopback audio track carries no samples — so the HUD `Audio:` meter stays at 0.
This is the documented "loopback silence" failure mode the gate exists to detect.

---

## Approaches tried — all exhausted, none fixed it

1. **Built-in path (screen source).** `setDisplayMediaRequestHandler` +
   `desktopCapturer.getSources({ types: ['screen'] })` + `audio:'loopback'` → DXGI error, silent meter.
2. **Window source instead of screen source.** Switched the granted video source from `'screen'` to a
   `'window'` source (window sources do not normally engage the desktop duplicator), with a screen
   fallback. Diagnostic logging confirmed window sources existed and a window source **was** chosen (e.g.
   `window:397498:1`), yet the DXGI duplicator **still** errored continuously → still silent. This proved
   the duplicator is engaged independent of our source-type choice.
3. **`electron-audio-loopback@1.0.6` shim (documented fallback).** Installed and wired (`initMain` +
   enable/disable bridge + enable → `getDisplayMedia` → discard video → disable). Same DXGI errors, still
   silent.

All three share Chromium's `getDisplayMedia` capture session, which on this machine cannot run because the
DXGI desktop duplicator fails. The shim and the source-type change have since been **REVERTED** — the
working tree is back to the committed 03-01 code; this record documents what was tried.

---

## Reproduction / evidence

On the MSI machine (Windows 10.0.26200.8655, Electron 35.7.5), running 03-01 in dev with the HUD visible:

- The HUD `Audio:` row stays at `0.00` with an empty block-bar the entire time general media plays.
- The main/renderer console emits, repeatedly every ~0.75 s:
  - `DxgiDuplicatorController failed to capture desktop, error code Duplication failed`
  - `Failed to capture 1 frames within 500 milliseconds`
- Behavior is identical across all three approaches above (built-in screen source, window source,
  `electron-audio-loopback` shim).

---

## Decision

### **NO-GO**

System-audio loopback via any `getDisplayMedia`/Chromium-based path is **NO-GO** on this machine. There is
no non-silent signal even on general media (the pipeline-proving source), so this is a full NO-GO — **not**
the partial NO-GO / comms-device-routing case (D-09), which only applies when general media works but the
meeting call does not.

### Phase 4 implication

Per the plan's D-09 / NO-GO rules, this NO-GO triggers the **`naudiodon` WASAPI-sidecar fallback** for
Phase 4: raw WASAPI loopback capture in a separate process, piped into the app. The WASAPI sidecar never
touches Chromium's screen capturer, so it is not subject to the DXGI desktop-duplicator failure that broke
every `getDisplayMedia` approach above. The requirement to capture system audio (AUD-01/AUD-02) is
unchanged — only the capture **mechanism** changes from built-in loopback to the WASAPI sidecar.

Because the STT pipeline sits behind the audio-capture seam built in 03-01 (the source feeding the Phase 4
`ISttProvider`), swapping the audio source to a WASAPI sidecar can be done without touching the
transcript/AI code — the seam is the insulation point.

---

## Sign-off

- **Judged by:** rodrigo-gomez@idexx.com
- **Date:** 2026-06-17
- **Target machine:** MSI (Windows 11, Version 10.0.26200.8655)
- **HUD-shown Electron version:** 35.7.5
- **Verdict:** **NO-GO** — built-in `getDisplayMedia` loopback is silent on this machine (DXGI
  desktop-duplicator failure); Phase 4 uses the `naudiodon` WASAPI sidecar.
