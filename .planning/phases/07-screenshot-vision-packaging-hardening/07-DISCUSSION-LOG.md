# Phase 7: Screenshot Vision + Packaging & Hardening - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-19
**Phase:** 7-Screenshot Vision + Packaging & Hardening
**Areas discussed:** Capture trigger & target, Vision request shape, Vision output & UX, Packaging & hardening

---

## Capture trigger & target

### What the screenshot grabs

| Option | Description | Selected |
|--------|-------------|----------|
| Full primary display | Whole primary monitor via desktopCapturer; simplest, deterministic, no picker | |
| Active monitor | Whichever monitor is "active"; better on multi-monitor | ✓ |
| Region select | Draw a rectangle; needs a focusable selection surface — conflicts with keyboard-only | |

**User's choice:** Active monitor

### How "active" is determined (overlay never holds focus)

| Option | Description | Selected |
|--------|-------------|----------|
| Monitor under the cursor | getDisplayNearestPoint(getCursorScreenPoint()); deterministic | |
| Monitor of foreground window | Needs native Windows foreground-window lookup — extra native surface | |
| Monitor the overlay sits on | screen.getDisplayMatching(overlay bounds); predictable, no native lookup | ✓ |

**User's choice:** Monitor the overlay sits on
**Notes:** Workflow is "park the overlay on the screen with the challenge, then press the chord." Avoids
the native foreground-window lookup the project otherwise avoids; works while the meeting app holds focus.

### Trigger chord

| Option | Description | Selected |
|--------|-------------|----------|
| Ctrl+Alt+C | "capture" / "code challenge"; free, mnemonic | ✓ |
| Ctrl+Alt+V | "vision"; Ctrl+V paste muscle-memory risk | |
| Ctrl+Alt+P | "picture" / "problem" | |

**User's choice:** Ctrl+Alt+C
**Notes:** Planner re-verifies against Teams/Zoom/VS Code per the 02-03 protocol; documented fallback if it
collides. Overlay self-excluded from the capture via the existing setContentProtection.

---

## Vision request shape

### Image seam

| Option | Description | Selected |
|--------|-------------|----------|
| Add optional image to the prompt request | Optional image field on IAiPromptRequest; PromptAssembler builds content blocks when present; one seam, backward-compatible | ✓ |
| New stream method on the gateway | Separate streamVision(); duplicates lifecycle/abort, splits single-in-flight | |
| Always content-blocks | Refactor all modes to always send blocks; touches working Phase 5 path for no functional gain | |

**User's choice:** Add optional image to the prompt request

### Model + grounding

| Option | Description | Selected |
|--------|-------------|----------|
| Opus 4.8 + grounded | claude-opus-4-8 AND inject active session context (success criterion 1) | ✓ |
| Opus 4.8, transcript+image only | Opus but skip session-context grounding — contradicts criterion 1 | |
| You decide later | Defer to researcher/planner | |

**User's choice:** Opus 4.8 + grounded

### Downscale location

| Option | Description | Selected |
|--------|-------------|----------|
| Main process, before the gateway | ScreenshotService captures + downscales ≤1568px + base64 (no data-URL prefix) in main | ✓ |
| Hidden renderer / offscreen canvas | Canvas resize in a renderer; against main-owns-IO, adds IPC round-trip | |
| You decide | Defer | |

**User's choice:** Main process, before the gateway

### Transcript span in the prompt?

| Option | Description | Selected |
|--------|-------------|----------|
| Image + context only | The screenshot is the problem; transcript is noise; simpler/cheaper | |
| Image + context + transcript | Also include the recent span — interviewer may narrate constraints aloud | ✓ |
| You decide | Defer | |

**User's choice:** Image + context + transcript

---

## Vision output & UX

### Output surface

| Option | Description | Selected |
|--------|-------------|----------|
| Third mode in the AI panel | code-challenge as a 3rd AiMode; streams into the same AI panel + same history | |
| Dedicated vision panel | Separate scrollable surface for code solutions | ✓ |
| You decide | Defer to UI-phase/planner | |

**User's choice:** Dedicated vision panel
**Notes:** Code solutions are long and contain code blocks, so they read better isolated than stacked with
short answers/talking-points.

### In-flight + cancel rules

| Option | Description | Selected |
|--------|-------------|----------|
| Same single-in-flight as Phase 5 | One orchestrator, one active request across all 3 modes (D-06/D-07) | ✓ |
| Vision is separately cancellable | Concurrent vision + answer; breaks single-in-flight (rejected in Phase 5 D-07) | |
| You decide | Defer | |

**User's choice:** Same single-in-flight as Phase 5
**Notes:** Coherent with the dedicated panel — separate surface, but one orchestrator/one active request.

### Vision-panel history + focus-cycle

| Option | Description | Selected |
|--------|-------------|----------|
| Own bounded history, joins focus-cycle | 3rd focus-cycle target (transcript → AI → vision); own stacked bounded history | ✓ |
| Latest-only, joins focus-cycle | Only the latest solution; still scrollable; loses prior solutions | |
| You decide | Defer | |

**User's choice:** Own bounded history, joins focus-cycle

### Layout on the fixed 460×700 overlay

| Option | Description | Selected |
|--------|-------------|----------|
| Vision panel shown only when active | Takes over the AI-panel region when focused/has content; Phase 5 layout otherwise unchanged | ✓ |
| Permanent three-way split | All three regions always visible, each smaller; cramped code output | |
| You decide | Defer to UI-phase | |

**User's choice:** Vision panel shown only when active

---

## Packaging & hardening

### Installer flavor

| Option | Description | Selected |
|--------|-------------|----------|
| Portable .exe | Single self-contained .exe, no install step; matches existing electron-builder.yml + single-user framing | ✓ |
| NSIS installer | Start-menu shortcut + uninstaller; second SmartScreen prompt; more surface | |
| Both portable + NSIS | Maximum flexibility, more build/verify surface | |

**User's choice:** Portable .exe

### Verification method

| Option | Description | Selected |
|--------|-------------|----------|
| On-machine manual gate | Build, run on target machine, human-verify transparency/focus/content-protection + a real screenshot-solve; committed VERIFICATION.md (Phase 1 01-04 style) | ✓ |
| Automated smoke + manual existential | Scripted launch smoke + the manual existential checks | |
| You decide | Defer | |

**User's choice:** On-machine manual gate

### Native modules + hardening depth

| Option | Description | Selected |
|--------|-------------|----------|
| Native unpack + the ROADMAP 07-03 set | asarUnpack + ABI rebuild for uiohook-napi + native-recorder-nodejs, PLUS latency instrumentation, SmartScreen doc, hardware-accel fallback, hotkey-config recovery | ✓ |
| Native unpack only | Just get native modules working + the verify gate; defer 07-03 items | |
| You decide | Defer | |

**User's choice:** Native unpack + the ROADMAP 07-03 set

### Whisper stub gateway (ROADMAP 07-03 item)

| Option | Description | Selected |
|--------|-------------|----------|
| Defer it | Local Whisper is v2/out of scope; ISttProvider seam already proves swappability (TRN-05) | ✓ |
| Include a minimal stub | No-op Whisper gateway to demonstrate the seam a second time | |
| You decide | Defer | |

**User's choice:** Defer it (dropped from Phase 7)

---

## Claude's Discretion

- Exact downscale algorithm/library and long-edge handling (only-if-larger, preserve aspect ratio).
- Exact `IAiPromptRequest.image` field shape and the PromptAssembler string-vs-blocks branch.
- The vision system prompt wording (DRAFT-tunable, via the claude-api skill).
- Vision-panel bounds, takeover/visibility behavior, corner-indicator styling (UI-phase).
- The fallback chord letter if Ctrl+Alt+C collides.
- The vision `MAX_TOKENS` constant.
- electron-builder specifics (asarUnpack globs, build resources, icon, artifact name).
- Whether content protection needs the hide-capture-reshow fallback for desktopCapturer.

## Deferred Ideas

- Whisper / local STT stub gateway — dropped (v2; seam proven by TRN-05).
- NSIS installer — documented later option; v1 is portable.
- Code signing certificate — SmartScreen friction accepted instead.
- Region-select screenshot — conflicts with keyboard-only / no-focus-steal.
- Capturing the OS-foreground window's monitor — rejected (native surface); overlay's own monitor is the proxy.
- Permanent three-way panel split — too cramped; vision panel takes over only when active.
- Per-mode different grounding — not needed; all modes share getActiveContext().

### Reviewed todos (keyword-matched, not folded)
- `260617-code-review-audio-seam-warnings` (WR-01/02/03) — resolves_phase 4, already handled in 04-04.
- `260618-hud-session-date-and-duration-timer` — relates_to_phase 5; HUD enhancement, not vision/packaging.
- `260618-scrollbar-disappears-history-unreachable` — relates_to_phase 5; AI-05 scrollback bug in the
  Phase-5 panel surface. Flagged for planner awareness since the vision panel reuses the same scroll model.
