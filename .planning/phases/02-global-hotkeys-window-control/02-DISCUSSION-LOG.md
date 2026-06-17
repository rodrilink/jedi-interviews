# Phase 2: Global Hotkeys + Window Control - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-17
**Phase:** 2-Global Hotkeys + Window Control
**Areas discussed:** Hotkey map & feel, Failure surfacing UX, Move/opacity bounds, HUD toggle & first-run

---

## Hotkey Map & Feel

### Repeat behavior (move/opacity)
| Option | Description | Selected |
|--------|-------------|----------|
| Hold-to-repeat | Press and hold to keep moving/fading; uiohook native key-repeat events | ✓ |
| Discrete press | Each press = one fixed step; predictable, no overshoot | |
| You decide | Planner picks based on uiohook handling | |

**User's choice:** Hold-to-repeat.

### Movement step
| Option | Description | Selected |
|--------|-------------|----------|
| Medium (~50px) | A few presses crosses a screen region | ✓ |
| Small (~20px) | Fine-grained precise placement | |
| Large (~100px) + fine modifier | Fast travel + Shift for precise step | |

**User's choice:** Medium (~50px).

### Opacity step
| Option | Description | Selected |
|--------|-------------|----------|
| 10% steps | Ten levels, quick to reach a comfortable level | ✓ |
| 5% steps | Finer control, more presses | |
| You decide | Planner picks within floor/ceiling | |

**User's choice:** 10% steps.

### Quit hotkey
| Option | Description | Selected |
|--------|-------------|----------|
| Yes, bind quit | Global hotkey to cleanly quit; no taskbar icon/close button otherwise | ✓ |
| No, keep minimal | Defer quit to later (e.g. Phase 6 settings) | |

**User's choice:** Yes, bind quit.

**Notes:** Action set locked at 5 groups (show/hide, move, opacity, HUD toggle, quit); exact chords left to conflict testing (see closing question).

---

## Failure Surfacing UX (CTL-03)

### Where to surface
| Option | Description | Selected |
|--------|-------------|----------|
| Persistent line in the HUD | `Hotkeys: OK/failed` row pushed over jedi:status; reuses Phase 1 IPC | ✓ |
| Console + log file | Dev console / log only; invisible during a meeting | |
| Native dialog on startup | Focusable messageBox at boot; steals focus | |

**User's choice:** Persistent line in the HUD.

### When detected
| Option | Description | Selected |
|--------|-------------|----------|
| At startup only | Register once at launch, check each result then | ✓ |
| Startup + live re-check | Also detect mid-session theft; harder with passive uiohook | |

**User's choice:** At startup only.

### On failure
| Option | Description | Selected |
|--------|-------------|----------|
| Launch, surface the failure | Bind what works, show which failed | ✓ |
| Try fallback, then surface | Attempt globalShortcut fallback before reporting | |

**User's choice:** Launch, surface the failure. (Captured in CONTEXT D-08: globalShortcut fallback is attempted when uiohook itself fails to attach; HUD reflects the active layer.)

---

## Move / Opacity Bounds

### Move edge/monitor behavior
| Option | Description | Selected |
|--------|-------------|----------|
| Clamp, keep fully on-screen | Stop at work-area edges of current display | |
| Allow crossing to other monitors | Move onto adjacent displays; clamp only at outermost desktop edges | ✓ |
| You decide | Planner picks; default never-lose-it | |

**User's choice:** Allow crossing to other monitors (clamp at outermost desktop edges only).

### Opacity range
| Option | Description | Selected |
|--------|-------------|----------|
| ~20% floor → 100% ceiling | Faint but never invisible; can go fully opaque | ✓ |
| 10% floor → 90% ceiling | Always slightly see-through, never fully solid | |
| 0% → 100% full range | Full range including invisible | |

**User's choice:** ~20% floor → 100% ceiling.

### Persistence
| Option | Description | Selected |
|--------|-------------|----------|
| Yes, persist both | Save position + opacity to electron-store, restore clamped | |
| No, reset each launch | Fixed default each launch | ✓ |

**User's choice:** No, reset each launch.

### First paint
| Option | Description | Selected |
|--------|-------------|----------|
| Start shown | Visible on launch with HUD up | ✓ |
| Start hidden | Launch hidden; reveal with show/hide | |

**User's choice:** Start shown.

---

## HUD Toggle & First-Run

### HUD role
| Option | Description | Selected |
|--------|-------------|----------|
| Status + hotkey cheat-sheet | Proof-of-life rows + bound-hotkey list + Hotkeys: status line | ✓ |
| Status only (+ failure line) | Minimal; existing rows + failure line | |
| You decide | Planner picks; must carry the status line | |

**User's choice:** Status + hotkey cheat-sheet.

### Toggle key
| Option | Description | Selected |
|--------|-------------|----------|
| Separate HUD toggle | Distinct chord toggles HUD content within the overlay | ✓ |
| No separate toggle yet | HUD shows whenever overlay does | |

**User's choice:** Separate HUD toggle.

### State owner
| Option | Description | Selected |
|--------|-------------|----------|
| Main process owns it | Main shows/hides + pushes visible flag over jedi:status; renderer pure view | ✓ |
| You decide | Planner decides split, preserving read-only IPC | |

**User's choice:** Main process owns it.

---

## Closing

### Default chords
| Option | Description | Selected |
|--------|-------------|----------|
| Leave to conflict testing | Capture constraints; plan 02-03 picks exact keys after testing Teams/Zoom/VS Code | ✓ |
| Lock the chords now | Write specific defaults into CONTEXT.md | |

**User's choice:** Leave to conflict testing (suggested starting set recorded in CONTEXT D-05 as guidance only).

## Claude's Discretion

- Exact default chords within the Ctrl+Alt family and locked action set (chosen during conflict testing).
- Hold-to-repeat cadence/throttle, exact pixel step if 50px feels off, HUD cheat-sheet layout and `Hotkeys:` line wording.
- Internal HotkeyService shape and the uiohook→globalShortcut fallback seam.
- Opacity step boundaries within 20%→100% and the default launch opacity.

## Deferred Ideas

- Mid-session "stolen chord" re-detection — rejected for v1 (passive uiohook, fixed chord set).
- Persisting window position/opacity — deferred; natural fit with Phase 6 settings/persistence.
- User-customizable hotkey remapping UI — already tracked as v2 (CTL-V2-01).
