---
status: partial
phase: 02-global-hotkeys-window-control
source: [02-VERIFICATION.md, 02-REVIEW.md]
started: 2026-06-17T00:00:00Z
updated: 2026-06-17T00:00:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. Discrete-chord hold behavior (CR-01 / D-01 contract)
expected: Holding a discrete chord (e.g. `Ctrl+Alt+J` show/hide, or `Ctrl+Alt+Q` quit) fires the action ONCE on the leading edge and maintains the held state — it does not repeat on the OS auto-repeat stream. (Move/opacity ARE intended to repeat on hold per D-01; only discrete actions should be guarded.)
result: resolved
note: Fixed in code + covered by tests (commit 63fdff4). `dispatchUiohookKeydown` now branches on `chord.kind`: discrete chords use a `heldDiscreteKeycodes` leading-edge guard (fire once per press, ignore auto-repeat until `keyup` clears the held key); repeat chords (move/opacity) still fire on every keydown (D-01). Tests assert a held discrete chord fires once across two keydowns, fires again after a keyup, and that repeat chords fire per keydown.

### 2. Move-clamp across mismatched/offset monitors (WR-05)
expected: The overlay can never be moved fully off all physical screens, even on a multi-monitor setup with mismatched heights or vertical offsets.
result: [pending]
note: `virtualDesktopBounds()` clamps X and Y independently against the union of all display work areas; staggered monitors can create a dead zone on no physical screen. Single-monitor setups are unaffected. Untested.

## Summary

total: 2
passed: 1
issues: 0
pending: 1
skipped: 0
blocked: 0

## Gaps

- CR-01 (discrete-chord auto-repeat strobe) fixed in commit 63fdff4: leading-edge guard for discrete chords + keyup clear, repeat chords unchanged. Test #1 now resolved and covered by automated tests.
