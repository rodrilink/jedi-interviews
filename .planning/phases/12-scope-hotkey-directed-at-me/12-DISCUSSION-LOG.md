# Phase 12: Scope Hotkey + Directed-at-Me - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-07
**Phase:** 12-scope-hotkey-directed-at-me
**Areas discussed:** User name source, Ambiguous-question bias, Overlay indicator, Scope-cycle chord, Other-addressee detection

---

## User name source (for the directed-at-me cue)

| Option | Description | Selected |
|--------|-------------|----------|
| Add a name field in Settings | Optional "Your name" field in the Settings window, persisted via electron-store; heuristic uses it as a strong 2nd-person cue, falls back to you/your + addressee-absence when blank | ✓ |
| Name-optional for v1.2 (no Settings change) | 2nd-person cues only; skip the name entirely; name field is a later enhancement | |
| Reuse existing context (no new field) | Pull a name from session-context notes; brittle — no reliable name in the current store | |

**User's choice:** Add a name field in Settings
**Notes:** No user-name setting existed before this phase (Settings persisted only API keys + session context). Name is optional; blank must not break the heuristic. Name must never be logged (threat model: PII in logs) — persist via the electron-store pattern, NOT safeStorage.

---

## Ambiguous-question bias (Directed-at-me scope)

| Option | Description | Selected |
|--------|-------------|----------|
| Answer ambiguous (lean recall) | Open-to-the-room questions auto-answer; Directed-at-me only filters OUT questions clearly aimed at someone else by name | ✓ |
| Skip ambiguous (lean precision) | Only answer on a positive 2nd-person/name cue; open-to-the-room does not fire | |

**User's choice:** Answer ambiguous (lean recall)
**Notes:** Directed-at-me narrows the firehose by removing other-directed questions, not by requiring a positive cue. All mode still answers everything; Off answers none.

---

## Overlay indicator presentation

| Option | Description | Selected |
|--------|-------------|----------|
| Small text label (e.g. 'Auto: All') | Compact read-only text row/badge: Auto: All / Auto: Directed / Auto: Off; matches HUD text-row style; reuses status-flag pattern | ✓ |
| Icon/dot with color | Colored dot per state, no words; minimal but requires learning the mapping | |
| Label + color | Text label plus color accent; most self-explanatory, more visual weight | |

**User's choice:** Small text label ('Auto: All')
**Notes:** Pushed over the existing jedi:status channel via a new `autoAnswerScope` flag on IOverlayStatus. No color for v1.2 (deferred as a possible later polish).

---

## Scope-cycle chord

| Option | Description | Selected |
|--------|-------------|----------|
| Ctrl+Alt+D ('directed'/scope) | Default to D (mnemonic 'directed'); outside the locked set; on-machine conflict re-test before finalizing | ✓ |
| Ctrl+Alt+U ('auto' scope) | Use U instead; also outside the locked set | |
| I'll specify the exact chord | User provides a specific chord | |

**User's choice:** Ctrl+Alt+D
**Notes:** Registered through HotkeyRegistrarService as a new discrete chord. MANDATORY on-machine Teams/Zoom/VS Code conflict re-test (02-03 protocol) as a human-verify GO/NO-GO before finalizing; fall back to a reserved letter (e.g. U) if it collides.

---

## Other-addressee detection (how "aimed at someone else" is detected)

| Option | Description | Selected |
|--------|-------------|----------|
| Named-other cue, excluding your name | Skip only when there's a vocative/direct address to a name that is NOT yours; capitalized-name-in-address patterns minus the configured name; everything else answers | ✓ |
| Only skip on explicit vocative comma pattern | Skip only the tightest leading/trailing 'Name,' vocative; misses looser phrasings | |
| Keep it minimal — 2nd-person + your-name only | No other-addressee detection at all; weakest filter, Directed ≈ All in multi-person meetings | |

**User's choice:** Named-other cue, excluding your name
**Notes:** App diarizes only as Person 1/2/… (no real names) and only the user's own name is configured, so "aimed at someone else" = a direct-address vocative to a non-user name. Conservative about skipping (consistent with lean-recall). Pure + unit-testable.

---

## Claude's Discretion

- Scope state-machine shape (enum + cycle fn vs. index into a 3-tuple) and where the `autoAnswerScope` flag lives (main-side holder vs. orchestrator), provided Off suppresses at source and cycle order holds.
- The precise regex/token rules inside the directed-at-me utility (opener sets, vocative patterns, name normalization), provided D-02/D-03 behavior holds and it stays a pure no-AI function.
- Settings field placement/label + config key name for the persisted name; pull-on-run vs. cached read — provided the name is never logged.
- Whether the scope gate is inline at index.ts:398 or a small extracted helper — provided the manual Ctrl+Alt+A path stays byte-for-byte unchanged.

## Deferred Ideas

- Color-coded scope indicator (text-only for v1.2).
- Persisting last-used scope across sessions (v1.2 defaults to All each session start).
- User-customizable hotkey remapping (CTL-V2-01, v2).
- Auto-firing talking-points / code-challenge under scope (only `answer` auto-fires in v1.2).
- Three todo.match-phase hits (audio-seam warnings, HUD session timer, scrollbar history) — keyword-only matches, reviewed and NOT folded.
