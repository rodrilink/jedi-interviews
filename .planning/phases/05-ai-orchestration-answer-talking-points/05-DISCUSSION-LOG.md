# Phase 5: AI Orchestration (Answer + Talking Points) - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-18
**Phase:** 5-AI Orchestration (Answer + Talking Points)
**Areas discussed:** AI output surface, Mode hotkeys & cancel, Span & model routing, Prompt design & seam

---

## AI Output Surface

### Where AI answers render

| Option | Description | Selected |
|--------|-------------|----------|
| Dedicated AI panel | Separate always-on AI surface, not tied to the HUD toggle (the Phase 4 D-05 deferral) | ✓ |
| Inside the DebugHud | Another section in the HUD, hidden by Ctrl+Alt+H along with the transcript | |

**User's choice:** Dedicated AI panel (always visible, below the HUD).

### On a new request

| Option | Description | Selected |
|--------|-------------|----------|
| Replace (clear prior) | Each request wipes the panel and streams fresh | |
| Replace + keep last visible | Effectively the same as replace | |
| Stack/history | Append answers in a scrollback log; prior answers stay scrollable | ✓ |

**User's choice:** Stack/history.

### History labeling & bounds

| Option | Description | Selected |
|--------|-------------|----------|
| Header per entry, bounded | Per-entry mode + time header, newest at bottom, auto-scroll, bounded like TranscriptBuffer, clearable | ✓ |
| Plain concatenation | Append with a divider, no header/mode label | |

**User's choice:** Header per entry, bounded.

### In-flight / failure states

| Option | Description | Selected |
|--------|-------------|----------|
| Inline status in entry | thinking…→stream→inline error / (cancelled), debounced token append, no separate status bar | ✓ |
| Separate status row | Dedicated loading/streaming/error line above the panel | |

**User's choice:** Inline status in entry.

---

## Mode Hotkeys & Cancel

### Re-press behavior

| Option | Description | Selected |
|--------|-------------|----------|
| Same chord toggles cancel | Pressing the mode chord again while streaming cancels it | ✓ |
| Dedicated cancel chord | Separate cancel key; mode chords only start | |

**User's choice:** Same chord toggles cancel.

### Pressing the other mode mid-stream

| Option | Description | Selected |
|--------|-------------|----------|
| Cancel current, start new | Single active request; switching cancels + restarts | ✓ |
| Ignore until free | Other mode is a no-op while a stream is active | |
| Allow concurrent | Two parallel streams | |

**User's choice:** Cancel current, start new (single active request).

### Mode chord letters

| Option | Description | Selected |
|--------|-------------|----------|
| A = answer, T = talking pts | Ctrl+Alt+A / Ctrl+Alt+T, mnemonic, unused | ✓ |
| Enter / Space | Big keys but collision-prone | |
| You decide | Planner picks, defaulting A/T | |

**User's choice:** Ctrl+Alt+A (answer), Ctrl+Alt+T (talking points).

### AI-panel scrollback (AI-05)

| Option | Description | Selected |
|--------|-------------|----------|
| Separate AI scroll chords | New chords scroll the AI panel independently | |
| Reuse PgUp/PgDn, scroll AI panel | Repurpose existing chords to the AI panel, transcript auto-sticks | |
| You decide | Planner picks simplest scheme | |

**User's choice (free text):** "Scroll only the active panel, add a chord to move among panels, add an indicator in one corner, then use PgUp/PgDn to scroll." → Reflected back and refined into a focused-panel model.

### Active-panel state & focus cycle

| Option | Description | Selected |
|--------|-------------|----------|
| Main-owned, single cycle chord | Main-owned active-panel flag pushed to renderer; one toggle chord; corner indicator; PgUp/PgDn scroll active; default = AI panel | ✓ |
| Main-owned, separate next/prev | Two chords (next/prev) — overkill for two panels | |

**User's choice:** Main-owned, single cycle chord.

### Focus-cycle chord letter

| Option | Description | Selected |
|--------|-------------|----------|
| Ctrl+Alt+F | F for focus, unused | ✓ |
| Ctrl+Alt+Tab | Natural but collision-prone on Windows | |
| You decide | Planner picks, leaning F | |

**User's choice:** Ctrl+Alt+F.

---

## Span & Model Routing

### Transcript span

| Option | Description | Selected |
|--------|-------------|----------|
| Same ~60s for both | Both modes read the last ~60s via recentSince() | ✓ |
| Per-mode spans | ~30s answer / ~90s talking points | |
| You decide | Planner picks, defaulting ~60s | |

**User's choice:** Same ~60s for both.

### Model tiering

| Option | Description | Selected |
|--------|-------------|----------|
| Haiku for both | Latency-first; Opus reserved for Phase 7 vision | |
| Haiku answer, Opus talking pts | Fast answer, higher-quality synthesis for talking points | ✓ |
| You decide | Planner routes, per-mode constant | |

**User's choice:** Haiku = answer, Opus = talking points (per-mode constant; re-tier talking points to Haiku if 05-03 latency logging shows Opus too slow).

### Empty span

| Option | Description | Selected |
|--------|-------------|----------|
| Skip call, show notice | No API call; panel shows "No recent transcript to act on" | ✓ |
| Call anyway | Wastes a call on silence | |
| Use wider fallback span | Fall back to the 90s buffer first | |

**User's choice:** Skip call, show notice.

---

## Prompt Design & Seam

### Context seam (CTX-04)

| Option | Description | Selected |
|--------|-------------|----------|
| Context slot, empty for now | Assembler takes a structured grounding-context input + transcript span; empty in Phase 5, filled by Phase 6 with no signature change | ✓ |
| Transcript-only, refactor later | Add context param in Phase 6, touching all call sites | |

**User's choice:** Context slot, empty for now.

### Output shape

| Option | Description | Selected |
|--------|-------------|----------|
| Answer=concise reply, TP=bullets | Per-mode system prompts: concise spoken-style answer / 3-5 bullets | ✓ |
| Both freeform | One general prompt, Claude decides format | |
| You decide | Planner drafts both prompts | |

**User's choice:** Answer = concise reply, Talking points = 3–5 bullets.

### Question identification (answer mode)

| Option | Description | Selected |
|--------|-------------|----------|
| Let Claude infer | Prompt instructs Claude to identify the most-recent question in the span and answer it | ✓ |
| Answer the whole span | Respond to the recent discussion generally | |
| You decide | Planner drafts the infer-latest-question prompt | |

**User's choice:** Let Claude infer the latest question.

---

## Claude's Discretion

- Exact debounce interval (token append), exact ~60s span value, AI-history bounds — named constants set by planner.
- AI-panel ↔ transcript height split and panel styling/position on the fixed 460×700 overlay.
- Clear-AI-history chord letter; A/T/F fallback letters if any collide in the conflict re-check.
- Cancellation mechanism (AbortController vs SDK stream .abort()) per the claude-api skill.
- Latency-logging format for hotkey→first-token (05-03).
- AnthropicGateway interface shape (lean: mirror ISttProvider/DeepgramSttGateway).

## Deferred Ideas

- Session Context grounding (notes/ticket/snippets/links) — Phase 6 (CTX-01..04, AI-06); seam built empty now.
- safeStorage key entry + settings window — Phase 6 (SET-01/SET-02).
- Vision / code-challenge mode — Phase 7 (AI-03); reuses the Phase 5 AI path.
- Concurrent multi-mode streams — rejected for v1 (single active request).
- Per-mode span tuning — deferred; both ~60s now.
- Auto-detecting questions unprompted — out of scope for v1; answer mode infers only on hotkey press.
