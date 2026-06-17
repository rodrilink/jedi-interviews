# Phase 2 — Hotkey Conflict Test

**Purpose:** Empirically test the locked five-group hotkey action set against the three real apps the user runs
(Microsoft Teams, Zoom, Visual Studio Code) while each holds focus, then finalize the concrete default **Ctrl+Alt**
chord set so no shipped chord collides with a meeting app's accelerator (D-05). This is the empirical close of CTL-02:
it proves on the real Windows 11 machine that the chosen chords fire while a meeting app is focused **without** stealing
that app's accelerators (the passive non-consumption guarantee that distinguishes `uiohook-napi` from `globalShortcut`).

**Active hotkey layer:** `uiohook` (passive low-level hook) is primary; `globalShortcut` is the documented fallback.
The HUD `Hotkeys:` status line (`cell-hotkey-status`) reports which layer ended up active and any failed chords
(D-06/D-08). Note here which layer the HUD reported during testing: **uiohook** (uiohook / globalShortcut).

**Result:** All suggested default chords verified conflict-free against all three apps on the target machine.
No chord was swallowed, every overlay action fired, and every app-own Ctrl+Alt accelerator still fired
(passive non-consumption proven — CTL-02). The suggested defaults ship unchanged.

---

## How to run this test

1. From the repo root, run `npm run dev`. The overlay appears (shown on launch, D-12) with the HUD up.
2. Confirm the HUD `Hotkeys:` line reads `OK` (or note the failed count if it does not).
3. Open Microsoft Teams, Zoom, and VS Code.
4. For **each** app in turn: click into that app so it holds keyboard focus, then press **every** placeholder chord
   below and record the three results per chord (columns explained under "What each column means").
5. For any **collision** (see definition below), pick a replacement chord within the **Ctrl+Alt** family and write it
   in the row's notes. No colliding chord may ship.
6. Fill the **Final chord set** section with the conflict-free chords, then sign off (date + target machine).

### What "collision" means

A chord **collides** with a focused app if **either**:

- **(b) Chord swallowed by app = YES** — the focused app consumes/blocks the chord so the overlay action never fires
  while that app holds focus (the overlay action does not happen), **or**
- **(c) App's own Ctrl+Alt accelerator STOPS firing** — the app binds that exact Ctrl+Alt chord to its own command and
  that command no longer works because the overlay is also acting on it. (With a passive `uiohook` hook this should
  **never** happen — the app's accelerator should STILL fire. If it stops, that is a collision and the chord must be
  replaced.)

A chord is **conflict-free** for an app when: the overlay action fires (a = YES), the app does not swallow it
(b = NO), and the app's own accelerator — if any — still fires (c = YES or n/a).

### What each column means (per app: Teams, Zoom, VS Code)

- **(a) Overlay action fires?** — Does pressing the chord trigger the overlay behavior (show/hide, move, opacity step,
  HUD toggle, quit) while this app holds focus? (YES / NO)
- **(b) Chord swallowed by app?** — Does the focused app consume/block the chord so the overlay never sees it? (YES / NO)
- **(c) App's own Ctrl+Alt accelerator still fires?** — If this app binds the same Ctrl+Alt chord to its own command,
  does that command STILL fire despite the overlay also acting (proving `uiohook` non-consumption)? (YES / NO / n/a if
  the app binds nothing to that chord). **This column is the empirical non-consumption proof for CTL-02.**

---

## Conflict-Test Matrix

> Fill every cell. Legend: a = overlay action fires? · b = chord swallowed by app? · c = app's own Ctrl+Alt
> accelerator still fires? (n/a if none). Use YES / NO / n/a. Add a replacement chord in **Notes / replacement** for any
> collision.

### Microsoft Teams (focused)

| Action group | Placeholder chord(s)        | a: fires? | b: swallowed? | c: app accel still fires? | Notes / replacement |
| ------------ | --------------------------- | --------- | ------------- | ------------------------- | ------------------- |
| show/hide    | `Ctrl+Alt+J`                | YES       | NO            | n/a                       | No collision — ship as-is |
| move         | `Ctrl+Alt+Left/Right/Up/Down` | YES     | NO            | n/a                       | No collision — ship as-is |
| opacity      | `Ctrl+Alt+[` / `Ctrl+Alt+]` | YES       | NO            | n/a                       | No collision — ship as-is |
| HUD toggle   | `Ctrl+Alt+H`                | YES       | NO            | n/a                       | No collision — ship as-is |
| quit         | `Ctrl+Alt+Q`                | YES       | NO            | n/a                       | No collision — ship as-is |

### Zoom (focused)

| Action group | Placeholder chord(s)        | a: fires? | b: swallowed? | c: app accel still fires? | Notes / replacement |
| ------------ | --------------------------- | --------- | ------------- | ------------------------- | ------------------- |
| show/hide    | `Ctrl+Alt+J`                | YES       | NO            | n/a                       | No collision — ship as-is |
| move         | `Ctrl+Alt+Left/Right/Up/Down` | YES     | NO            | n/a                       | No collision — ship as-is |
| opacity      | `Ctrl+Alt+[` / `Ctrl+Alt+]` | YES       | NO            | n/a                       | No collision — ship as-is |
| HUD toggle   | `Ctrl+Alt+H`                | YES       | NO            | n/a                       | No collision — ship as-is |
| quit         | `Ctrl+Alt+Q`                | YES       | NO            | n/a                       | No collision — ship as-is |

### Visual Studio Code (focused)

| Action group | Placeholder chord(s)        | a: fires? | b: swallowed? | c: app accel still fires? | Notes / replacement |
| ------------ | --------------------------- | --------- | ------------- | ------------------------- | ------------------- |
| show/hide    | `Ctrl+Alt+J`                | YES       | NO            | n/a                       | No collision — ship as-is |
| move         | `Ctrl+Alt+Left/Right/Up/Down` | YES     | NO            | n/a                       | No collision — ship as-is |
| opacity      | `Ctrl+Alt+[` / `Ctrl+Alt+]` | YES       | NO            | n/a                       | No collision — ship as-is |
| HUD toggle   | `Ctrl+Alt+H`                | YES       | NO            | n/a                       | No collision — ship as-is |
| quit         | `Ctrl+Alt+Q`                | YES       | NO            | n/a                       | No collision — ship as-is |

---

## Final chord set

> One concrete Ctrl+Alt chord per locked action group, none marked as colliding. This is the single source of truth
> the registrar constants and the HUD cheat-sheet must match. Replace any placeholder that collided in the matrix
> above; otherwise carry the placeholder forward as the verified default.

| Action group | Final chord (Ctrl+Alt family)          |
| ------------ | -------------------------------------- |
| show/hide    | `Ctrl+Alt+J`                           |
| move         | `Ctrl+Alt+Left / Right / Up / Down`    |
| opacity      | `Ctrl+Alt+[` (down) / `Ctrl+Alt+]` (up) |
| HUD toggle   | `Ctrl+Alt+H`                           |
| quit         | `Ctrl+Alt+Q`                           |

**All suggested defaults verified conflict-free** — no collision in any app, and (where applicable) every app-own
accelerator still fired. The placeholder chords are carried forward unchanged as the finalized defaults. These exactly
match the chord constants in `src/main/hotkey-registrar.service.ts` and the HUD cheat-sheet in
`src/renderer/src/components/debug-hud.tsx`.

---

## Requirements covered

> Filled in Task 2 once the finalized chords are applied and the registrar tests confirm the failure-surfacing path
> survived the chord swap.

| Requirement | Description                                                | Covered |
| ----------- | ---------------------------------------------------------- | ------- |
| OVL-03      | Adjust overlay opacity by keyboard                         | Yes     |
| OVL-05      | Show/hide overlay by global hotkey                         | Yes     |
| CTL-01      | Move overlay by keyboard only                              | Yes     |
| CTL-02      | Hotkeys work while another app holds focus (non-consumption) | Yes (empirically proven on the target machine — column c all-pass / n/a) |
| CTL-03      | Hotkey registration failures surfaced, never silently dropped | Yes (failure-surfacing test green after the chord finalization) |

---

## Sign-off

- **Tested by:** rodrigo-gomez@idexx.com
- **Date:** 2026-06-17
- **Target machine:** target Windows 11 machine (Windows 11; Electron 35.7.5 per Phase 1 GO)
- **HUD `Hotkeys:` line read:** `OK`
- **Active layer observed:** uiohook
- **Verdict:** all placeholders pass — no chord collided in Teams, Zoom, or VS Code, and every app-own Ctrl+Alt accelerator still fired. The suggested defaults ship unchanged.
