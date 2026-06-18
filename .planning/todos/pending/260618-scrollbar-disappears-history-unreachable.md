---
id: 260618-scrollbar-disappears-history-unreachable
created: 2026-06-18
source: live 30-min test session (user feedback)
severity: bug
area: renderer/overlay
relates_to_phase: 5
---

# Scrollbar disappears over time; history becomes unreadable

Observed during a ~30-minute live test session.

**Symptom:** The scroll bar does not behave correctly — it disappears over
time, then reappears, but while it's gone the user cannot scroll back to see
the history (transcript and/or AI-panel scrollback).

**Why it matters:** Keyboard-scrollable history (AI-05) and the live transcript
are core to the overlay being usable "in the flow of conversation." If the
scrollbar/scroll affordance intermittently drops, long output and prior entries
become unreachable — directly undermining the Phase 5 scrollback success
criterion.

**Where to look (suspected):**
- `src/renderer/src/components/debug-hud.tsx` — the `stickToBottomRef`
  auto-follow/pause logic and the scroll handler (transcript region).
- The forthcoming Phase 5 `ai-panel.tsx` reuses that same stick-to-bottom +
  hotkey-scroll pattern (D-03/D-08), so whatever causes the disappearing
  scroll affordance likely affects both panels — fix once, apply to both.
- CSS in `src/renderer/src/assets/hud.css` — overflow/scrollbar styling on the
  transparent always-on-top overlay (transparent windows can render scrollbars
  oddly; an auto-hiding scrollbar may be the cause).

**Open questions for whoever picks this up:**
- Is the bar *visually* auto-hiding (CSS `overflow: auto` + OS overlay
  scrollbars) while scroll still works, or does the scroll position itself get
  reset/locked when it disappears?
- Does it correlate with the auto-follow re-arming when new content streams in
  (i.e. new tokens snap the view back to bottom and steal the user's scroll-up)?

Not yet reproduced or root-caused — capture only. Likely folded into Phase 5
(05-03 scrollback) or addressed as a follow-up quick fix once reproduced.
