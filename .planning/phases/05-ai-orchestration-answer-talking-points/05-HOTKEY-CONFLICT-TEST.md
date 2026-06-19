---
status: accepted
phase: 05-ai-orchestration-answer-talking-points
plan: 05-02
date: 2026-06-18
protocol: 02-03 (passive uiohook non-consumption; overlay action fires AND focused app's own
  Ctrl+Alt accelerators still fire)
---

# Phase 05 — New-Chord Hotkey Conflict Test

Re-check of the AI chords added in Phase 5 against the locked, previously conflict-tested set
(see `02-HOTKEY-CONFLICT-TEST.md`). The Phase 2/4 chords (J, arrows, [ ], H, K, PgUp/PgDn, Q)
were already verified in 02-03 and are unchanged.

## New chords under test

| Action | Chord | Model / Effect |
|--------|-------|----------------|
| Answer | `Ctrl+Alt+A` | `claude-haiku-4-5` |
| Talking points | `Ctrl+Alt+T` | `claude-opus-4-8` |
| Clear AI | `Ctrl+Alt+G` | clears the AI panel (history + `cleared` push) |

## Result — USER ACCEPTED (2026-06-18)

The user verified the chords on the target Windows 11 machine and **approved** them:

- HUD `Hotkeys` row shows **OK** — all chords (A/T/G) bound at startup; none in `failed`.
- `Ctrl+Alt+A` streams a Haiku answer (verified, image-4).
- `Ctrl+Alt+T` streams 3–5 Opus talking-point bullets (verified, image-5: lifting-state-up bullets).
- `Ctrl+Alt+G` clears the AI panel.
- The cheat-sheet lists Answer / Talking points / Clear AI (verified, image-5).

No chord collision was reported in use. The user accepted the suggested defaults unchanged — no
fallback letters were needed (the planned fallbacks were: T→? , G→? if a collision had surfaced).

### Scope note (honest record)

The exhaustive per-application focus matrix (each chord tested with Microsoft Teams, Zoom, and
VS Code holding focus, confirming both overlay-fires AND app-accelerator-still-fires) was **not
independently executed/recorded** in this session — approval was granted on observed working
behavior. Because the chords ride the same passive uiohook hook proven non-consuming in 02-03
(CTL-02), regression risk is low. If a collision surfaces in real meeting use, pick a fallback
letter, update `HOTKEY_CHORDS` (hotkey-registrar.service.ts) + `HOTKEY_CHEAT_SHEET`
(debug-hud.tsx), and re-run this protocol.
