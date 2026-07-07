---
phase: 08-diarized-utterance-pipeline
verified: 2026-07-06T23:45:00Z
status: human_needed
score: 8/8 must-haves verified
overrides_applied: 0
re_verification:
  previous_status: gaps_found
  previous_score: 7/8 (1 FAILED)
  gaps_closed:
    - "Committed/finalized speech still feeds the rolling TranscriptBuffer (and therefore the AI orchestrator's transcript span) — no regression of TRN-01/TRN-02/AI-01/AI-02 (CR-01)"
  gaps_remaining: []
  regressions: []
human_verification:
  - test: "Live 2-speaker session: confirm distinct Person 1 / Person 2 utterance cards reach the overlay payload, and Ctrl+Alt+K restarts numbering at Person 1"
    expected: "Person N labels stay stable per voice across the session; after Ctrl+Alt+K the next utterance for any voice is labeled Person 1 again"
    why_human: "Requires a live Deepgram session with two real speakers and on-machine hotkey verification; cannot be exercised by unit tests or static analysis (documented as Manual-Only in 08-03-PLAN.md's <verification> section)"
  - test: "Manually trigger 'ai-answer'/'ai-talking-points' mid-meeting and confirm a real Claude response appears instead of the empty-span placeholder, now that CR-01's fix has landed"
    expected: "With real recent speech in the buffer, pressing the AI hotkeys produces a streamed Claude response, not 'No recent transcript to act on'"
    why_human: "Requires a live Anthropic call end-to-end with real audio; the empty-span guard, the streaming path, and now the CR-01 fix are each covered by unit/integration-style tests in isolation, but the live gateway-to-buffer-to-orchestrator path with a real Deepgram socket has not been exercised end-to-end on the target machine"
---

# Phase 8: Diarized Utterance Pipeline Verification Report

**Phase Goal:** The transcript stream stops being one flat text blob and becomes a stream of discrete, speaker-attributed, classified utterances — each carrying a stable `Person N` label and a Question/Statement tag — delivered through the existing `ISttProvider` seam so nothing downstream is coupled to Deepgram. This is the data/seam layer the Phase 9 card UI consumes.

**Verified:** 2026-07-06T23:45:00Z
**Status:** human_needed
**Re-verification:** Yes — after CR-01 gap closure (quick task 260706-q4m, commits 1f4f02b / 77b0fef / 79f293c / 9b401fc)

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | A finalized utterance's text is classified Question/Statement by a pure local function, defaulting to Statement (D-06/D-07/D-08, QA-03) | VERIFIED (regression check — file unchanged) | `src/main/stt/question-classifier.utility.ts` — confirmed zero diff since prior verification (`git diff 43572b6 HEAD` on this file returns nothing); 7 Vitest cases still pass. |
| 2 | A run of diarized words yields a single utterance speaker via the modal per-word speaker index (QA-01 grouping core) | VERIFIED (regression check — file unchanged) | `src/main/stt/utterance-accumulator.utility.ts` unchanged since prior verification; 6 tests still pass. `UtteranceAccumulator.commit()` still drains one turn per commit with the empty-commit no-op. |
| 3 | First-seen Deepgram speaker index gets the next `Person N`; the same index keeps that label for the session (D-03, QA-02) | VERIFIED (regression check — file unchanged) | `src/main/stt/speaker-map.ts` unchanged; 3 tests still pass. |
| 4 | An undiarized utterance gets a neutral non-Person label and stays out of the numbered list (D-04) | VERIFIED (regression check — file unchanged) | `SpeakerMap.label(undefined)` behavior untouched; re-confirmed by the still-passing `should give an undiarized turn the neutral speaker with isDiarized false` gateway test (line 534). |
| 5 | Clearing the speaker map restarts Person N numbering at Person 1 (D-05) | VERIFIED (regression check — file unchanged) | `SpeakerMap.clear()` and its `index.ts:130` wiring (`sttGateway?.clearSpeakers()`) unchanged; `index.ts` confirmed zero diff since prior verification. |
| 6 | The `ISttProvider` seam carries a committed `IUtteranceEvent` (text + speaker + isDiarized + classification) with no `@deepgram/sdk` import in the contract file (D-09) | VERIFIED (regression check — file unchanged) | `src/main/stt/stt-provider.interface.ts` unchanged; the fix's new `ISttTranscriptEvent` emission reuses the pre-existing seam type (no new import, no Deepgram type crossing). |
| 7 | The live Deepgram gateway enables diarization + utterance-end and emits ONE classified, `Person N`-attributed `utterance` per finalized turn through the seam, with no double-commit (QA-01 observable half, D-01) | VERIFIED | `deepgram-stt.gateway.ts:179-180` diarize/utterance_end_ms unchanged; `commitPendingUtterance` (lines 313-333) still emits exactly ONE `utterance` per commit via `this.emit('utterance', utterance)` at line 327, BEFORE the new additive transcript emit — the D-01 one-utterance-per-turn contract is intact and independently re-confirmed by `should emit exactly one utterance per speech_final turn...` and `should emit exactly one utterance for a speech_final followed by a trailing UtteranceEnd` (both still passing, unmodified assertions on the utterance side). |
| 8 | Committed/finalized speech still feeds the rolling `TranscriptBuffer` (and therefore the AI orchestrator's transcript span) — no regression of TRN-01/TRN-02/AI-01/AI-02 | **VERIFIED (gap closed)** | `commitPendingUtterance` (`deepgram-stt.gateway.ts:313-333`) now ADDITIVELY emits `{ text: committed.text, isFinal: true }` as an `ISttTranscriptEvent` at line 330, guarded on `committed.text.trim().length > 0` (line 329, WR-01 mitigation for this code path). `grep -n "isFinal: true"` now finds the emit at line 330 (previously 0 matches). `index.ts:344 if (event.isFinal) buffer.appendFinal(event.text)` is reachable again — confirmed by direct read of `index.ts` (unchanged, zero diff since prior verification) and by the new gateway test `should re-emit the committed turn as a final transcript so the buffer feed is non-empty (CR-01 regression)` (line 190), which drives a real multi-run diarized `speech_final` sequence through `handleMessage` and asserts BOTH `utterances` (length 1) AND a non-empty `isFinal:true` transcript with the space-joined committed text — exactly the end-to-end assertion the prior verification and 08-REVIEW.md's CR-01 finding said was missing. `TranscriptBuffer.appendFinal` (`transcript-buffer.ts:74-78`) is unchanged and still populates `this.finals` + clears the trailing interim (also resolving WR-02 with no `transcript-buffer.ts`/`index.ts` change, as the quick-task SUMMARY claims — independently confirmed by reading `transcript-buffer.ts` unchanged). `AiOrchestrator.trigger()` (`ai-orchestrator.ts:151`) is unchanged and reads `transcriptBuffer.recentSince(RECENT_SPAN_MS)`, which is now non-empty after a real committed turn — the D-11 empty-span guard is no longer permanently latched. |

**Score:** 8/8 truths verified. Truths 1-6 were unaffected by this fix (confirmed via `git diff` showing zero changes to their backing files since the prior verification commit) and pass a regression sanity check; truth 7 is independently re-confirmed intact; truth 8 — the sole prior failure — is now closed and independently verified against live code, not the SUMMARY narrative.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/main/stt/stt-provider.interface.ts` | `IUtteranceEvent`/`UtteranceClassification`/`on('utterance')`, no Deepgram import, existing `transcript`/`ISttTranscriptEvent` unchanged | VERIFIED (unchanged) | Zero diff since prior verification. |
| `src/main/stt/question-classifier.utility.ts` (+ test) | Pure `classifyUtterance`, full Wave 0 coverage | VERIFIED (unchanged) | Zero diff; 7 tests pass. |
| `src/main/stt/utterance-accumulator.utility.ts` (+ test) | `pickModalSpeakerIndex` + `UtteranceAccumulator` with empty-commit no-op | VERIFIED (unchanged) | Zero diff; 6 tests pass. |
| `src/main/stt/speaker-map.ts` (+ test) | `SpeakerMap` with `label`/`clear`, D-03/D-04/D-05 | VERIFIED (unchanged) | Zero diff; 3 tests pass. |
| `src/main/stt/deepgram-stt.gateway.ts` | Diarize + message-switch + accumulator/speaker-map/classifier wiring + utterance emission + restored final-transcript emission + D-11 audit | VERIFIED | `commitPendingUtterance` now emits both `utterance` (unchanged) and an additive, whitespace-guarded `transcript` with `isFinal: true` (new, lines 329-332). The CR-01 regression is closed at the source. |
| `src/main/stt/deepgram-stt.gateway.test.ts` | Diarized-payload + UtteranceEnd + utterance-emission + no-double-commit + keep-alive + CR-01 regression coverage | VERIFIED | 28 tests pass (up from 25). The two previously-regression-encoding tests (`should not emit a transcript for an is_final run…`) were renamed/rewritten to assert the restored behavior; a dedicated CR-01 regression test (line 190) and an UtteranceEnd-fallback final-transcript test (line 216) and a whitespace-guard test (line 242) were added. |
| `src/main/overlay-window.manager.ts` | `IOverlayTranscript` extended additively with `utterances: IUtteranceEvent[]` | VERIFIED (unchanged) | Zero diff since prior verification. |
| `src/main/index.ts` | `gateway.on('utterance')` binding + `gateway.on('transcript')` → `appendFinal` branch + speaker reset wired into clear-transcript | VERIFIED | Zero diff — confirmed the `if (event.isFinal) buffer.appendFinal(...)` branch at line 344-345 required NO change; it was always correct, just unreachable until the gateway fix restored the producer. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `question-classifier.utility.ts` | `stt-provider.interface.ts` | imports `UtteranceClassification` | WIRED (unchanged) | Line 15, confirmed unchanged. |
| `deepgram-stt.gateway.ts` | `utterance-accumulator.utility.ts` | imports `pickModalSpeakerIndex` + `UtteranceAccumulator` | WIRED (unchanged) | Line 5; used in `commitPendingUtterance`. |
| `deepgram-stt.gateway.ts` | `question-classifier.utility.ts` | imports `classifyUtterance` | WIRED (unchanged) | Line 7; used at line 325. |
| `deepgram-stt.gateway.ts` | `speaker-map.ts` | `SpeakerMap` owned/injected | WIRED (unchanged) | Line 6, field at line 104, used at line 320. |
| `index.ts` | `deepgram-stt.gateway.ts` | `gateway.on('utterance', …)` + `gateway.clearSpeakers()` | WIRED (unchanged) | `on('utterance')` at line 357; `clearSpeakers()` call at line 130. |
| `index.ts` | `overlay-window.manager.ts` | `pushTranscript` carries the utterance list | WIRED (unchanged) | All `pushTranscript(...)` call sites pass `utterances`. |
| `deepgram-stt.gateway.ts` (finalized turn) | `transcript-buffer.ts` `appendFinal` (via `index.ts`'s `on('transcript')`) | `emit('transcript', {isFinal:true})` → `if (event.isFinal) buffer.appendFinal(...)` | **WIRED (gap closed)** | `commitPendingUtterance` now emits `isFinal: true` at line 330; `index.ts:344-345`'s `appendFinal` branch is reachable again. Independently confirmed by the passing CR-01 regression test and by reading both files' unchanged/changed lines directly — not by trusting the SUMMARY. |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|---------------------|--------|
| `IOverlayTranscript.utterances` (overlay push) | `utterances` array in `index.ts` | `gateway.on('utterance', …)` pushes real committed `IUtteranceEvent`s from live Deepgram diarized turns | Yes | FLOWING (unchanged) |
| `IOverlayTranscript.finalText` (overlay push) | `buffer.renderable().finalText` | `TranscriptBuffer.finals`, populated by `appendFinal`, now called from the reachable `if (event.isFinal)` branch, fed by the gateway's restored commit-time emit | **Yes — restored** | **FLOWING (gap closed)** |
| `AiOrchestrator.trigger()` transcript span | `transcriptBuffer.recentSince(RECENT_SPAN_MS)` | Same `TranscriptBuffer.finals`, now populated after each committed turn | Yes | **FLOWING (gap closed)** — traced `ai-orchestrator.ts:151` → `transcript-buffer.ts:106-113` (`recentSince`, reads `this.finals`) → `transcript-buffer.ts:74-78` (`appendFinal`, pushes into `this.finals`) → `index.ts:344-345` (`if (event.isFinal) buffer.appendFinal(...)`) → `deepgram-stt.gateway.ts:329-332` (the new emit). Every link in the chain is now live code, not dead code. |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full unit suite green | `npm test -- --run` | 23 files, 182 tests passed, exit 0 (independently re-run, not taken from SUMMARY) | PASS |
| Project typecheck clean | `npm run typecheck` (node + web) | exit 0, no errors (independently re-run) | PASS |
| `isFinal:true` emission now present in the gateway | `grep -n "isFinal: true" src/main/stt/deepgram-stt.gateway.ts` | 2 matches: line 303 (JSDoc), line 330 (the actual emit) | PASS — confirms CR-01 fix independently |
| `appendFinal` call site now reachable | `grep -rn "appendFinal" src/main` (non-test) | `index.ts:345`, gated on `event.isFinal`, which the gateway now sets `true` on every non-whitespace committed turn | PASS |
| No `@deepgram/sdk` import outside the gateway (D-09/QA-07 regression check) | `grep -c "@deepgram/sdk"` across seam-adjacent files | 0 real imports outside the gateway (unchanged) | PASS |
| Files touched by the fix match the claimed scope | `git diff 43572b6 HEAD --stat` (prior verification commit -> HEAD) | Only `deepgram-stt.gateway.ts` (+15/-0 approx) and `deepgram-stt.gateway.test.ts` (+75/-3 approx) plus quick-task planning docs and STATE.md changed | PASS — no other Phase 8 artifact was touched, so truths 1-7 needed only regression sanity, not full re-verification |

### Probe Execution

No `scripts/*/tests/probe-*.sh` probes exist in this repository and none are declared in the Phase 8 plans, SUMMARYs, or the quick-task SUMMARY. Step 7c SKIPPED (no probes declared or discoverable).

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|--------------|--------|----------|
| QA-01 | 08-02, 08-03 | Discrete per-speaker utterances via diarization + utterance segmentation | SATISFIED | The utterance layer is fully built, unit-tested, and wired to the overlay payload; the sibling regression that undermined the app's continuous-transcript/AI-span contract (CR-01) is now fixed and independently re-verified, so QA-01's "not one continuous text stream" intent is achieved WITHOUT collateral damage to the rest of the app. |
| QA-02 | 08-01, 08-03 | Stable `Person N` speaker map, same voice keeps same label all session | SATISFIED | Unchanged since prior verification; `SpeakerMap` fully implemented, unit-tested, wired to Ctrl+Alt+K reset. Live-session stability is the one item still needing human confirmation (see below). |
| QA-03 | 08-01 | Question/Statement classification, default Statement when unsure | SATISFIED | Unchanged; `classifyUtterance` fully implemented and unit-tested. |
| QA-07 | 08-01, 08-02, 08-03 | Utterance/speaker data flows through `ISttProvider` seam, backend-agnostic | SATISFIED | Seam extension remains clean; the CR-01 fix reuses the pre-existing `ISttTranscriptEvent` seam type rather than introducing a new one — no `@deepgram/sdk` leak into any consumer, confirmed by grep. |

No orphaned requirements: REQUIREMENTS.md traceability maps exactly QA-01/QA-02/QA-03/QA-07 to Phase 8, and all four appear in the union of the three plans' `requirements:` frontmatter (unchanged from prior verification).

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/main/stt/deepgram-stt.gateway.ts` | 289 | `accumulator.append` still called unconditionally for every `is_final` run, no `text.length > 0` guard at the append call site itself (WR-01, partial) | ℹ️ INFO (downgraded from prior WARNING) | The quick-task fix mitigates the user-visible consequence — a whitespace-only committed turn no longer produces a junk final-transcript event (guarded at line 329) or, per the passing `should NOT emit a final transcript for a whitespace-only committed turn` test. The underlying accumulator-level guard from WR-01's original suggested fix (guarding at the `append` call site, and trimming on commit for the `utterance` event itself) was not applied, so an all-whitespace turn could still in principle emit an empty-text `utterance` card — this is a Phase-9-visible cosmetic risk, not a Phase 8 must-have regression, and is unchanged in severity/scope from what was already flagged (not newly introduced by this fix). |
| `src/main/stt/deepgram-stt.gateway.ts` | 152-167 (WR-03, pre-existing) | `pickModalSpeakerIndex` recomputes over all retained words on every commit; no per-turn word-count ceiling | ℹ️ INFO (unchanged, pre-existing, out of CR-01 scope) | Noted in 08-REVIEW.md as a robustness concern, not addressed by this fix and not required to be — no change in status. |
| `src/main/stt/deepgram-stt.gateway.ts` | 349-351 (IN-03, pre-existing) | Full `utterances` array resent on every high-frequency transcript push | ℹ️ INFO (unchanged, pre-existing, out of CR-01 scope) | Performance-only concern, explicitly out of v1 scope per 08-REVIEW.md; unaffected by this fix. |

No unresolved `TBD`/`FIXME`/`XXX` debt markers found in any file modified by this fix or by Phase 8 overall (`grep -n "TBD|FIXME|XXX"` across `deepgram-stt.gateway.ts`, `deepgram-stt.gateway.test.ts`, `index.ts` returns nothing).

No blocker-level anti-patterns remain. The sole prior 🛑 BLOCKER (silently dropped `isFinal:true` emission) is resolved.

### Human Verification Required

### 1. Live diarized session — stable Person N labels + Ctrl+Alt+K reset

**Test:** Run a live 2-speaker meeting session; observe the utterance cards' `speaker` field in the overlay payload (or Phase 9's future UI) for both voices, then press Ctrl+Alt+K mid-session and speak again.
**Expected:** Each voice keeps a consistent `Person N` for the whole session; after the hotkey, the next utterance from either voice is labeled `Person 1`.
**Why human:** Requires a live Deepgram connection with two real distinguishable speakers and on-machine hotkey testing — explicitly called out as Manual-Only in `08-03-PLAN.md`'s `<verification>` section; cannot be exercised by unit tests. Unchanged from the prior verification — this item was never affected by the CR-01 fix.

### 2. Live confirmation that AI answer/talking-points modes work end-to-end after the CR-01 fix

**Test:** Speak for ~10-20 seconds in a live session, then press the answer or talking-points hotkey.
**Expected:** A real streamed Claude response appears, not the `EMPTY_SPAN_TEXT` ("No recent transcript to act on") placeholder.
**Why human:** The empty-span guard, the streaming path, and now the CR-01 fix's gateway-level emission are each covered by fast unit/integration-style tests (including the new end-to-end-in-spirit CR-01 regression test that drives real Deepgram-shaped events through `handleMessage` and asserts the buffer-feed contract). However, no automated test opens a real Deepgram socket and a real Anthropic stream together — the live gateway→buffer→orchestrator→Claude path on the target Windows machine has not been exercised end-to-end since the fix landed, and this is precisely the path the app's Core Value depends on.

### Gaps Summary

The prior verification's single blocking gap — CR-01 — is closed. Independent re-verification against the live codebase (not the quick-task SUMMARY) confirms:

1. `commitPendingUtterance` (`src/main/stt/deepgram-stt.gateway.ts:313-333`) now emits BOTH one `utterance` event (unchanged, D-01 intact) AND, guarded on non-whitespace committed text, one `ISttTranscriptEvent` with `isFinal: true` — additively, with no change to the single-utterance-per-turn contract.
2. `index.ts:344-345`'s `if (event.isFinal) buffer.appendFinal(event.text)` branch — confirmed unchanged and therefore now reachable — correctly receives this new emission, so `TranscriptBuffer.finals` fills again.
3. `AiOrchestrator.trigger()` (`ai-orchestrator.ts:151`), also unchanged, reads `transcriptBuffer.recentSince(RECENT_SPAN_MS)`, which is non-empty after a real committed turn, so the D-11 empty-span guard is no longer permanently latched for real sessions.
4. The fix is scoped exactly as claimed: `git diff` against the prior verification's commit shows only `deepgram-stt.gateway.ts` and `deepgram-stt.gateway.test.ts` changed (plus planning docs) — none of the seven previously-VERIFIED truths' backing files were touched, so they pass on regression sanity check alone.
5. The full test suite (182/182, independently re-run) and typecheck (independently re-run, clean) both pass. Unlike the prior verification's "confirmation bias" finding — where the green suite masked the regression because no test drove the real gateway→buffer path — this suite NOW contains a dedicated CR-01 regression test (`should re-emit the committed turn as a final transcript so the buffer feed is non-empty (CR-01 regression)`) that exercises exactly that path with a multi-run diarized `speech_final` sequence and asserts both the utterance and the final-transcript side effects. This closes the "tests encode the regression" pattern flagged previously — the tests now encode the CORRECT contract.

All 8 observable truths, all 8 required artifacts, and all 7 key links are VERIFIED. Requirements QA-01/QA-02/QA-03/QA-07 are all SATISFIED with no orphans. The only remaining unresolved items are the two pre-existing human-verification needs (live 2-speaker diarization stability + live end-to-end AI confirmation post-fix) — both were already flagged before this fix and neither is closeable by static analysis or unit tests; they require a live Deepgram/Anthropic session on the target machine. Per the decision tree, human verification items present (even with all automated truths passing) yields `human_needed` rather than `passed`.
