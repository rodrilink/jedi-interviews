---
status: partial
phase: 11-auto-answer-trigger
source: [11-VERIFICATION.md]
started: 2026-07-07T19:28:47Z
updated: 2026-07-07T19:28:47Z
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

## Summary

total: 2
passed: 0
issues: 0
pending: 2
skipped: 0
blocked: 0

## Gaps
