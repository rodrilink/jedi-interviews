---
id: 260618-hud-session-date-and-duration-timer
created: 2026-06-18
source: live 30-min test session (user feedback)
severity: enhancement
area: renderer/overlay
relates_to_phase: 5
---

# HUD: show session date + a running session-duration timer

Requested during a ~30-minute live test session.

**Want:** In the HUD section, show two things:
1. **Session date** — the date the current session started.
2. **Session duration timer** — a running clock the user can glance at to see
   how long the current session has been going (e.g. `00:31:12`), so during a
   long meeting/interview they know elapsed time at a glance.

**Why it matters:** The user ran a 30-minute session and wanted to track
elapsed time without leaving the overlay or checking another app — fits the
"never leave the meeting window" discipline.

**Where to look (suspected):**
- `src/renderer/src/components/debug-hud.tsx` — the HUD status area is the
  natural home; render a small date + `mm:ss`/`hh:mm:ss` line.
- Main owns IO/state and the renderer is a pure one-way view, so the session
  start time should be a **main-owned value pushed to the renderer** (like
  `hudVisible`/`isOverlayVisible` carried in the status push), not computed
  from a renderer-side `Date.now()` at mount. The renderer ticks the elapsed
  display locally from the pushed start timestamp.
- Decide what "session start" means: app launch, first audio capture, or first
  transcript — needs a one-line product decision before implementing.

**Notes:**
- Per project date/time standards, prefer Luxon over raw `Date` for any
  formatting/elapsed math in the (main-side) source of truth.
- Small, low-risk; a good candidate for a `/gsd-quick` task or to fold into a
  Phase 5/6 HUD touch-up. Capture only for now.
