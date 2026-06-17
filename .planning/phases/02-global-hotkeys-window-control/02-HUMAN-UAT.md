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
result: [pending]
note: Per code (hotkey-registrar.service.ts:160-174), `dispatchUiohookKeydown` never reads `chord.kind`, so discrete chords currently fire on every keydown including auto-repeat. Holding show/hide strobes the overlay (~30 events/sec, non-deterministic final state). The human conflict test only exercised taps, so this was not caught on the target machine.

### 2. Move-clamp across mismatched/offset monitors (WR-05)
expected: The overlay can never be moved fully off all physical screens, even on a multi-monitor setup with mismatched heights or vertical offsets.
result: [pending]
note: `virtualDesktopBounds()` clamps X and Y independently against the union of all display work areas; staggered monitors can create a dead zone on no physical screen. Single-monitor setups are unaffected. Untested.

## Summary

total: 2
passed: 0
issues: 0
pending: 2
skipped: 0
blocked: 0

## Gaps
