---
status: partial
phase: 08-diarized-utterance-pipeline
source: [08-VERIFICATION.md]
started: 2026-07-06T23:59:00Z
updated: 2026-07-06T23:59:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. Live 2-speaker session: Person N stability + Ctrl+Alt+K reset
expected: With two real speakers on a live Deepgram session, distinct `Person 1` / `Person 2` utterances reach the overlay; each voice keeps its `Person N` label across the session; after Ctrl+Alt+K the next utterance for any voice is labeled `Person 1` again.
result: [pending]

### 2. Live AI-hotkey confirmation end-to-end (post CR-01 fix)
expected: With real recent speech in the buffer, pressing `ai-answer` / `ai-talking-points` mid-meeting produces a streamed Claude response — NOT the "No recent transcript to act on" empty-span placeholder.
result: [pending]

## Summary

total: 2
passed: 0
issues: 0
pending: 2
skipped: 0
blocked: 0

## Gaps
