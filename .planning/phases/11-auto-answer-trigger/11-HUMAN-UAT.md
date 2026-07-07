---
status: partial
phase: 11-auto-answer-trigger
source: [11-VERIFICATION.md]
started: 2026-07-07T19:28:47Z
updated: 2026-07-07T20:05:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. Live auto-answer in a meeting (SC 1 live half)
expected: With a real Deepgram key and spoken system audio, ask a question out loud early in a session (empty transcript buffer). An answer request auto-enqueues with no keypress and a grounded answer streams token-by-token into the existing AI panel, carrying the tiny `auto` badge. Confirms the CR-01 fix works against the real gateway emit ordering (not just the unit regression test).
result: [pending]

### 2. Live re-key survival mid-session (SC 5 / D-03 Pitfall 3 live half)
expected: Start a session, then re-key via Ctrl+Alt+S (live API-key change → `rekeyDeepgram` re-attaches the STT handlers). After re-key, ask a question out loud and confirm the auto-answer still fires (the re-attached `on('utterance')` handler still closes over the live orchestrator; no dead closure).
result: [pending]

### 3. Auto-answer shows the detected question (post-ship feedback, commit b6cc8aa)
expected: When an auto-answer streams into the panel, a small quoted caption of the detected question appears under the "Answer · auto" header, above the streamed answer (e.g. `"What database backs the ledger?"`). Confirms the user can tell WHICH spoken question each auto-answer addresses. A manual `Ctrl+Alt+A` answer shows NO caption. Check that a long/oddly-punctuated real-transcript question wraps readably.
result: [pending]

## Summary

total: 3
passed: 0
issues: 0
pending: 3
skipped: 0
blocked: 0

## Gaps
