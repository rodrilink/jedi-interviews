# Phase 1: Overlay Shell + Existential Behaviors - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-16
**Phase:** 1-Overlay Shell + Existential Behaviors
**Areas discussed:** On-machine verification, safeStorage round-trip proof, Overlay first-paint look, Electron version pinning

---

## On-Machine Verification

### Proving focus is never stolen
| Option | Description | Selected |
|--------|-------------|----------|
| Programmatic foreground-window log | App polls/logs the OS active window before/after show, asserts no change | |
| Manual visual checklist | Watch the meeting app title bar stay active while showing/moving the overlay; tick a written checklist | ✓ |
| Both — log + manual sign-off | Objective log plus visual check, both in a committed doc | |

**User's choice:** Manual visual checklist
**Notes:** Keeps the gate simple; relies on the title-bar active-state visual cue.

### Proving absence from screen capture
| Option | Description | Selected |
|--------|-------------|----------|
| Self screen-share + screenshot | Real Teams/Zoom/Game Bar share or system screenshot; confirm overlay fully absent (no black box); save proof | ✓ |
| Built-in capture self-test | In-app desktopCapturer grabs own screen for a one-button check | |
| Both | In-app self-test plus an external share screenshot as authoritative evidence | |

**User's choice:** Self screen-share + screenshot
**Notes:** This is the bit 35.0.1 famously broke; the saved screenshot is the gate evidence.

### Where verification evidence lives
| Option | Description | Selected |
|--------|-------------|----------|
| Committed VERIFICATION.md in repo | Checklist + recorded Electron patch + machine info + date + proof screenshot path | ✓ |
| PROJECT.md Key Decisions table | Flip rows to 'Verified' with the version | |
| Both | VERIFICATION.md plus a one-line PROJECT.md update | |

**User's choice:** Committed VERIFICATION.md in repo
**Notes:** Permanent, reviewable GO/NO-GO record.

---

## safeStorage Round-Trip Proof

| Option | Description | Selected |
|--------|-------------|----------|
| Encrypt+decrypt a fake key in main | Main-only safeStorage round-trip of a placeholder secret; assert equality | ✓ |
| Full IPC round-trip | Renderer triggers a typed channel; main holds the secret, returns only a boolean | |
| Both layered | Main-only crypto proof plus a minimal boolean-only IPC channel | |

**User's choice:** Encrypt+decrypt a fake key in main ("the most basic security")
**Notes:** User first asked *why* this belongs in Phase 1. Explained: the secret boundary must be wired into the scaffold before Phases 2–5 are built on the IPC layer, and a placeholder is used because no real keys exist until Phase 6. User then steered to the most basic proof only — no renderer/IPC secret channels in Phase 1; the full typed channel is designed in Phase 6. The structural boundary (contextIsolation, sandbox, typed contextBridge) is still wired now, just without secret-bearing channels.

---

## Overlay First-Paint Look

### What the empty overlay renders
| Option | Description | Selected |
|--------|-------------|----------|
| Tiny status HUD | Small panel: Electron version, content-protection state, window position; doubles as verification readout | ✓ |
| Faint border/dot only | Translucent border/corner dot, no text | |
| Fully invisible until content | Render nothing visible in Phase 1 | |

**User's choice:** Tiny status HUD

### HUD lifespan
| Option | Description | Selected |
|--------|-------------|----------|
| Keep as a toggleable debug HUD | Survives later, hidden by default, toggle wired in Phase 2 | ✓ |
| Phase-1 scaffolding, replace later | Exists only to pass the gate | |
| You decide | — | |

**User's choice:** Keep as a toggleable debug HUD
**Notes:** Shows by default in Phase 1 (no hotkeys yet); Phase 2 wires the toggle.

---

## Electron Version Pinning

### Pin style
| Option | Description | Selected |
|--------|-------------|----------|
| Exact pin + committed lockfile | Exact version (no ^/~) plus committed lockfile; byte-for-byte reproducible | ✓ |
| Exact pin only | Exact version, no lockfile handling | |
| You decide | — | |

**User's choice:** Exact pin + committed lockfile

### Packaged transparency smoke test scope
| Option | Description | Selected |
|--------|-------------|----------|
| Minimal: build, launch, eyeball transparency | Build once, launch the .exe, confirm transparent/frameless still renders | ✓ |
| Packaged + re-run full gate | Re-verify transparency + focus + content protection in the packaged build | |
| You decide | — | |

**User's choice:** Minimal — defer installer/signing/full gate re-verification to Phase 7 (PKG-01).

---

## Claude's Discretion

- Exact HUD layout/styling, VERIFICATION.md checklist wording, the placeholder-secret value and electron-store key, and the always-on-top level (`'screen-saver'` per CLAUDE.md) — left to planner/executor within the captured decisions.

## Deferred Ideas

None — discussion stayed within phase scope. Programmatic focus-watching, an in-app desktopCapturer self-test, full IPC secret channels, and full packaged-build re-verification were each considered and intentionally pushed to later phases or rejected as over-investment for this gate.
