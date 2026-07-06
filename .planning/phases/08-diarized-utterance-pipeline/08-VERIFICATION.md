---
phase: 08-diarized-utterance-pipeline
verified: 2026-07-06T23:24:25Z
status: gaps_found
score: 6/8 must-haves verified
overrides_applied: 0
gaps:
  - truth: "Committed/finalized speech still feeds the rolling TranscriptBuffer (and therefore the AI orchestrator's transcript span) — no regression of TRN-01/TRN-02/AI-01/AI-02"
    status: failed
    reason: "DeepgramSttGateway.handleMessage (src/main/stt/deepgram-stt.gateway.ts:280-293) now emits a 'transcript' event ONLY for interim (is_final falsy) Results, always with isFinal:false. An is_final run is appended to the accumulator and never re-emitted as a transcript event; commitPendingUtterance() only emits 'utterance', never 'transcript'. index.ts:344 (`if (event.isFinal) buffer.appendFinal(event.text)`) is therefore unreachable dead code. grep 'isFinal: true' across src/main/stt/deepgram-stt.gateway.ts returns zero matches. Because AiOrchestrator.trigger() (ai-orchestrator.ts:151) reads transcriptBuffer.recentSince(RECENT_SPAN_MS) as its ONLY span source, and TranscriptBuffer.finals is permanently empty, every answer/talking-points trigger hits the D-11 empty-span guard and makes no Claude call. This is a regression of already-shipped, previously-working functionality (AI-01/AI-02), not merely an unmet phase goal, and it also breaks the overlay's rolling finalized-transcript display (TRN-01/TRN-02) since renderable().finalText is now always ''."
    artifacts:
      - path: "src/main/stt/deepgram-stt.gateway.ts"
        issue: "handleMessage/commitPendingUtterance never emit a 'transcript' event for a finalized (is_final/speech_final/UtteranceEnd) turn — only the interim branch emits 'transcript', always isFinal:false"
      - path: "src/main/stt/deepgram-stt.gateway.test.ts"
        issue: "Lines ~165-188 assert the regressed behavior directly (`expect(transcripts).toEqual([])` for a speech_final turn), locking in the break rather than catching it"
      - path: "src/main/index.ts"
        issue: "Line 344-345 `if (event.isFinal) buffer.appendFinal(event.text)` is dead code post-Phase-8; no code path sets event.isFinal:true any more"
    missing:
      - "Emit a final/committed transcript signal (e.g. emit('transcript', { text: committed.text, isFinal: true }) inside commitPendingUtterance, per the code review's suggested fix) so TranscriptBuffer.appendFinal still runs and recentSince() is non-empty"
      - "Update the two-plus gateway tests that currently assert `transcripts` stays empty on a finalized turn to assert the restored transcript emission instead"
      - "Add an integration-level test (gateway -> index.ts wiring, or a gateway-level test) asserting a speech_final turn yields a non-empty buffer.renderable().finalText / recentSince(), so this class of regression cannot silently ship again"
      - "Decide how to clear the stale trailing interim on commit (WR-02) once the fix restores appendFinal's clear-interim side effect, or add an explicit clear signal"
deferred: []
human_verification:
  - test: "Live 2-speaker session: confirm distinct Person 1 / Person 2 utterance cards reach the overlay payload, and Ctrl+Alt+K restarts numbering at Person 1"
    expected: "Person N labels stay stable per voice across the session; after Ctrl+Alt+K the next utterance for any voice is labeled Person 1 again"
    why_human: "Requires a live Deepgram session with two real speakers and on-machine hotkey verification; cannot be exercised by unit tests or static analysis (documented as Manual-Only in 08-03-PLAN.md's <verification> section)"
  - test: "After the CR-01 fix lands, manually trigger 'ai-answer'/'ai-talking-points' mid-meeting and confirm a real Claude response appears instead of the empty-span placeholder"
    expected: "With real recent speech in the buffer, pressing the AI hotkeys produces a streamed Claude response, not 'No recent transcript to act on'"
    why_human: "Requires a live Anthropic call end-to-end with real audio; the empty-span guard and streaming path are unit-tested in isolation but the live gateway-to-buffer path is exactly what CR-01 found broken and no automated test currently exercises it end-to-end"
---

# Phase 8: Diarized Utterance Pipeline Verification Report

**Phase Goal:** The transcript stream stops being one flat text blob and becomes a stream of discrete, speaker-attributed, classified utterances — each carrying a stable `Person N` label and a Question/Statement tag — delivered through the existing `ISttProvider` seam so nothing downstream is coupled to Deepgram. This is the data/seam layer the Phase 9 card UI consumes.

**Verified:** 2026-07-06T23:24:25Z
**Status:** gaps_found
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | A finalized utterance's text is classified Question/Statement by a pure local function, defaulting to Statement (D-06/D-07/D-08, QA-03) | VERIFIED | `src/main/stt/question-classifier.utility.ts` — pure, no classes/state, `QUESTION_OPENERS` set, `/(?<=[.!?])\s+/` sentence split; 7 Vitest cases pass covering `?` terminal, interrogative opener, auxiliary opener, default-Statement, polite-imperative, multi-sentence any-question, empty string. |
| 2 | A run of diarized words yields a single utterance speaker via the modal per-word speaker index (QA-01 grouping core) | VERIFIED | `pickModalSpeakerIndex` in `src/main/stt/utterance-accumulator.utility.ts:49-68` — pure fold counting per-word `speaker`, returns `undefined` when none carry it (D-04); `UtteranceAccumulator.commit()` drains one turn per commit with an empty-commit no-op (Pitfall 4). 6 tests pass. |
| 3 | First-seen Deepgram speaker index gets the next `Person N`; the same index keeps that label for the session (D-03, QA-02) | VERIFIED | `src/main/stt/speaker-map.ts:40-50` — `label()` caches on first sight, `nextPersonNumber` only advances on a new index. 3 tests pass covering the 0→Person1, 1→Person2, 0-again→Person1 sequence. |
| 4 | An undiarized utterance gets a neutral non-Person label and stays out of the numbered list (D-04) | VERIFIED | `SpeakerMap.label(undefined)` returns `{ speaker: 'Speaker', isDiarized: false }` without incrementing the counter (`speaker-map.ts:41-43`); asserted in speaker-map.test.ts. |
| 5 | Clearing the speaker map restarts Person N numbering at Person 1 (D-05) | VERIFIED | `SpeakerMap.clear()` resets both `indexToPerson` and `nextPersonNumber = 1` (`speaker-map.ts:56-59`); wired to Ctrl+Alt+K via `sttGateway?.clearSpeakers()` in `index.ts:130`, which calls `speakerMap.clear()` + `accumulator.clear()` (`deepgram-stt.gateway.ts:324-327`). |
| 6 | The `ISttProvider` seam carries a committed `IUtteranceEvent` (text + speaker + isDiarized + classification) with no `@deepgram/sdk` import in the contract file (D-09) | VERIFIED | `src/main/stt/stt-provider.interface.ts` defines `IUtteranceEvent`, `UtteranceClassification`, and the `on('utterance', …)` overload alongside the unchanged `on('transcript', …)`/`ISttTranscriptEvent`. `grep -c "@deepgram/sdk"` returns 2 but both are JSDoc prose (not `import` statements) — confirmed by direct file read; zero real imports across all seam-adjacent files (`index.ts`, `overlay-window.manager.ts`, the four Plan-01 units) — only `deepgram-stt.gateway.ts` (+ its test mock) imports the SDK. |
| 7 | The live Deepgram gateway enables diarization + utterance-end and emits ONE classified, `Person N`-attributed `utterance` per finalized turn through the seam, with no double-commit (QA-01 observable half, D-01) | VERIFIED | `deepgram-stt.gateway.ts:179-180` sets `diarize: 'true'` + `utterance_end_ms: '1000'` alongside unchanged `interim_results`/`smart_format`; `handleMessage`/`commitPendingUtterance` (lines 266-318) discriminate message types, accumulate `is_final` runs, and commit exactly once per `speech_final` or `UtteranceEnd`-fallback turn with an empty-commit no-op guaranteeing no double-emit. 25 gateway tests pass covering this, and the committed utterance flows to the overlay via `index.ts:357-360` (`gateway.on('utterance', …)` inside the re-key-safe `attachSttGatewayHandlers`), landing in `IOverlayTranscript.utterances` (`overlay-window.manager.ts:110`) over the existing `jedi:transcript` channel. |
| 8 | Committed/finalized speech still feeds the rolling `TranscriptBuffer` (and therefore the AI orchestrator's transcript span) — no regression of TRN-01/TRN-02/AI-01/AI-02 | **FAILED** | See Gap below. `deepgram-stt.gateway.ts:280-293` emits `transcript` ONLY on the interim branch, always `isFinal:false`; no code path emits `isFinal:true` (`grep -n "isFinal: true" src/main/stt/deepgram-stt.gateway.ts` → 0 matches). `index.ts:344 if (event.isFinal) buffer.appendFinal(...)` is unreachable. `AiOrchestrator.trigger()`'s only span source, `transcriptBuffer.recentSince()`, is therefore always empty, permanently hitting the D-11 empty-span guard for `answer`/`talking-points`. |

**Score:** 7/8 truths verified as directly-scoped Phase 8 must-haves; 1 cross-cutting regression FAILED (independently confirmed, matches 08-REVIEW.md CR-01 exactly).

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/main/stt/stt-provider.interface.ts` | `IUtteranceEvent`/`UtteranceClassification`/`on('utterance')`, no Deepgram import, existing `transcript`/`ISttTranscriptEvent` unchanged | VERIFIED | All fields present exactly as specified; `ISttTranscriptEvent` untouched. |
| `src/main/stt/question-classifier.utility.ts` (+ test) | Pure `classifyUtterance`, full Wave 0 coverage | VERIFIED | 82-line pure module, 7 passing tests, no NLP dep, imports `UtteranceClassification` from the seam. |
| `src/main/stt/utterance-accumulator.utility.ts` (+ test) | `pickModalSpeakerIndex` + `UtteranceAccumulator` with empty-commit no-op | VERIFIED | 124-line module, 6 passing tests, no `@deepgram/sdk` import. |
| `src/main/stt/speaker-map.ts` (+ test) | `SpeakerMap` with `label`/`clear`, D-03/D-04/D-05 | VERIFIED | 60-line module, 3 passing tests, no `@deepgram/sdk` import. |
| `src/main/stt/deepgram-stt.gateway.ts` | Diarize + message-switch + accumulator/speaker-map/classifier wiring + utterance emission + D-11 audit | VERIFIED (with a critical wiring regression) | Diarization/utterance-end enabled, message switch implemented, utterance emission correct and de-duplicated — BUT the same rewrite silently dropped the final-transcript emission path (see Truth 8 FAILED above). Artifact exists and is substantive but is not "complete" against the app's actual prior contract. |
| `src/main/stt/deepgram-stt.gateway.test.ts` | Diarized-payload + UtteranceEnd + utterance-emission + no-double-commit + keep-alive regression coverage | VERIFIED (but encodes the regression) | 25 tests pass; two of them (`should not emit a transcript for an is_final run…`, ~line 165-188) directly assert the broken behavior as correct, per 08-REVIEW.md WR-04. |
| `src/main/overlay-window.manager.ts` | `IOverlayTranscript` extended additively with `utterances: IUtteranceEvent[]` | VERIFIED | Field present at line 110, four pre-existing fields unchanged, no new channel, no `@deepgram/sdk` import. |
| `src/main/index.ts` | `gateway.on('utterance')` binding + speaker reset wired into clear-transcript | VERIFIED | Binding present inside `attachSttGatewayHandlers` (re-key safe); `clear-transcript` handler drains `utterances`, calls `sttGateway?.clearSpeakers()`. No `@deepgram/sdk` import; no new IPC channel. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `question-classifier.utility.ts` | `stt-provider.interface.ts` | imports `UtteranceClassification` | WIRED | `import type { UtteranceClassification } from './stt-provider.interface'` at line 15. |
| `deepgram-stt.gateway.ts` | `utterance-accumulator.utility.ts` | imports `pickModalSpeakerIndex` + `UtteranceAccumulator` | WIRED | Line 5; both used in `commitPendingUtterance`/constructor field. |
| `deepgram-stt.gateway.ts` | `question-classifier.utility.ts` | imports `classifyUtterance` | WIRED | Line 7; used at line 315. |
| `deepgram-stt.gateway.ts` | `speaker-map.ts` | `SpeakerMap` owned/injected | WIRED | Line 6, field at line 104, used at line 310. |
| `index.ts` | `deepgram-stt.gateway.ts` | `gateway.on('utterance', …)` + `gateway.clearSpeakers()` | WIRED | `on('utterance')` at line 357 inside `attachSttGatewayHandlers` (re-key safe); `clearSpeakers()` call at line 130. |
| `index.ts` | `overlay-window.manager.ts` | `pushTranscript` carries the utterance list | WIRED | All five `pushTranscript(...)` call sites pass `utterances`. |
| `deepgram-stt.gateway.ts` (finalized turn) | `transcript-buffer.ts` `appendFinal` (via `index.ts`'s `on('transcript')`) | `emit('transcript', {isFinal:true})` → `if (event.isFinal) buffer.appendFinal(...)` | **NOT WIRED** | The gateway never emits `isFinal:true`; `index.ts:344-345`'s `appendFinal` branch is dead code. This is the CR-01 regression — a link that existed and worked before Phase 8, now silently severed. |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|---------------------|--------|
| `IOverlayTranscript.utterances` (overlay push) | `utterances` array in `index.ts` | `gateway.on('utterance', …)` pushes real committed `IUtteranceEvent`s from live Deepgram diarized turns | Yes | FLOWING |
| `IOverlayTranscript.finalText` (overlay push) | `buffer.renderable().finalText` | `TranscriptBuffer.finals`, populated only by `appendFinal`, called only from the now-dead `if (event.isFinal)` branch | **No — permanently empty string** | **DISCONNECTED** |
| `AiOrchestrator.trigger()` transcript span | `transcriptBuffer.recentSince(RECENT_SPAN_MS)` | Same `TranscriptBuffer.finals`, permanently empty post-Phase-8 | No | **DISCONNECTED** — every `answer`/`talking-points` trigger returns the `EMPTY_SPAN_TEXT` placeholder and makes zero Claude calls, confirmed by tracing `ai-orchestrator.ts:151-165` against the dead `appendFinal` path. |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full unit suite green | `npm test` | 23 files, 179 tests passed, exit 0 | PASS (but see Confirmation Bias Counter note below — passing suite does not cover the broken wiring) |
| Project typecheck clean | `npm run typecheck` (node + web) | exit 0, no errors | PASS |
| No `isFinal:true` emission anywhere in the gateway | `grep -n "isFinal: true" src/main/stt/deepgram-stt.gateway.ts` | 0 matches | FAIL — confirms CR-01 independently |
| `appendFinal` call sites | `grep -rn "appendFinal" src/main` (non-test) | Only `index.ts:345`, gated on `event.isFinal`, which is never `true` | FAIL — confirms the call site is unreachable |
| No `@deepgram/sdk` import outside the gateway | `grep -c "@deepgram/sdk"` across `index.ts`, `overlay-window.manager.ts`, all four Plan-01 units | 0 in all six files (2 JSDoc-only mentions in the interface file, not imports) | PASS |

**Confirmation Bias Counter (per verification thinking model):** The 179/179 green suite is misleading here. `ai-orchestrator.test.ts` seeds its span via a `seedSpan()` helper that calls `buffer.appendFinal(text)` **directly**, bypassing the gateway entirely (`ai-orchestrator.test.ts:22-25`). No test in the suite drives a real `speech_final`/`UtteranceEnd` gateway event and then asserts `buffer.renderable().finalText` or `recentSince()` is non-empty. The gateway's own test suite asserts the *opposite* — that finals produce no transcript event — which is exactly backwards from the pre-Phase-8 contract. This is precisely the "missing wiring" + "tests encode the regression" pattern the verification calibration corpus flags as the most common gap class.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|--------------|--------|----------|
| QA-01 | 08-02, 08-03 | Discrete per-speaker utterances via diarization + utterance segmentation | SATISFIED (utterance layer) / **AT RISK** (see regression) | The utterance pipeline itself is fully built and observable end-to-end to the overlay payload. However, QA-01's broader intent — "not one continuous text stream" — is undermined by the fact the *original* continuous-transcript feed (TRN-01/02) that the rest of the app depends on is now silently dead, and nothing replaced it as an AI span source. |
| QA-02 | 08-01, 08-03 | Stable `Person N` speaker map, same voice keeps same label all session | SATISFIED | `SpeakerMap` fully implemented, unit-tested, wired to Ctrl+Alt+K reset. |
| QA-03 | 08-01 | Question/Statement classification, default Statement when unsure | SATISFIED | `classifyUtterance` fully implemented and unit-tested per D-06/D-07/D-08. |
| QA-07 | 08-01, 08-02, 08-03 | Utterance/speaker data flows through `ISttProvider` seam, backend-agnostic | SATISFIED | Seam extension is clean; no `@deepgram/sdk` leak into any consumer. |

No orphaned requirements: REQUIREMENTS.md traceability maps exactly QA-01/QA-02/QA-03/QA-07 to Phase 8, and all four appear in the union of the three plans' `requirements:` frontmatter.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/main/stt/deepgram-stt.gateway.ts` | 280-293 | Silently dropped event emission (no `isFinal:true` transcript event on a finalized turn) | 🛑 BLOCKER | Confirmed regression of TRN-01/TRN-02/AI-01/AI-02 — the app's core value (grounded AI answers) is disabled for any real session; see CR-01. |
| `src/main/stt/deepgram-stt.gateway.test.ts` | ~165-188, ~359-382 | Tests assert the regressed behavior as correct | ⚠️ WARNING | Locks in the bug; gives false confidence the suite protects against this class of regression (WR-04 in review). |
| `src/main/stt/deepgram-stt.gateway.ts` | 289 | `accumulator.append` called unconditionally for every `is_final` run, no `text.length > 0` guard | ⚠️ WARNING | Empty/whitespace finals can produce empty-text `utterance` cards and malformed joined text on commit (WR-01 in review); not a blocker for the phase's own must-haves but will surface as visible junk cards in Phase 9's UI. |
| `src/main/stt/deepgram-stt.gateway.ts` | 290-292 (interaction with `index.ts:346-347`) | No interim-clearing signal on commit | ⚠️ WARNING | The last interim string before a turn commits is never cleared once CR-01 is present (WR-02); resolves naturally once CR-01's `appendFinal` path is restored, if restored via the `isFinal:true` emission approach. |

No unresolved `TBD`/`FIXME`/`XXX` debt markers found in the phase's modified files.

### Human Verification Required

### 1. Live diarized session — stable Person N labels + Ctrl+Alt+K reset

**Test:** Run a live 2-speaker meeting session; observe the utterance cards' `speaker` field in the overlay payload (or Phase 9's future UI) for both voices, then press Ctrl+Alt+K mid-session and speak again.
**Expected:** Each voice keeps a consistent `Person N` for the whole session; after the hotkey, the next utterance from either voice is labeled `Person 1`.
**Why human:** Requires a live Deepgram connection with two real distinguishable speakers and on-machine hotkey testing — explicitly called out as Manual-Only in `08-03-PLAN.md`'s `<verification>` section; cannot be exercised by unit tests.

### 2. Post-fix confirmation that AI answer/talking-points modes work end-to-end again

**Test:** After CR-01 is fixed, speak for ~10-20 seconds in a live session, then press the answer or talking-points hotkey.
**Expected:** A real streamed Claude response appears, not the `EMPTY_SPAN_TEXT` ("No recent transcript to act on") placeholder.
**Why human:** The empty-span guard and the streaming path are each unit-tested in isolation with directly-seeded buffers; the live gateway→buffer→orchestrator path is exactly the link CR-01 found severed, and no current automated test drives that path end-to-end with a real Deepgram-shaped event sequence.

### Gaps Summary

Phase 8's own scoped deliverable — the diarized-utterance pipeline (accumulator, speaker map, classifier, seam extension, gateway emission, overlay wiring) — is well-built, thoroughly unit-tested, and cleanly wired end-to-end for QA-02/QA-03/QA-07 and the utterance-emission half of QA-01. Those seven of eight observable truths verify cleanly against the actual codebase, not just the SUMMARY narrative.

However, independent verification confirms the code review's CR-01 finding exactly: the `DeepgramSttGateway.handleMessage` rewrite that added the utterance pipeline also silently removed the only code path that fed `TranscriptBuffer.appendFinal`. `grep` evidence is unambiguous — `isFinal: true` never appears in the gateway, and the `if (event.isFinal) buffer.appendFinal(...)` branch in `index.ts` is dead code. Because `AiOrchestrator.trigger()` has no other span source, this permanently disables the `answer` and `talking-points` AI modes (AI-01/AI-02) for any real session and also freezes the overlay's rolling finalized-transcript display (TRN-01/TRN-02). This is not merely an unmet Phase 8 must-have — it is a regression of previously-shipped, previously-working functionality that sits at the center of the project's stated Core Value ("a grounded, relevant AI response appears on the overlay ... in the flow of conversation"). No test in the 179-test green suite catches it because the AI-orchestrator tests seed the buffer directly (bypassing the gateway) and the gateway's own tests were rewritten to assert the broken behavior as correct.

This must be fixed (and covered by a regression test that exercises the real gateway→buffer→orchestrator path) before Phase 8 can be considered complete. The code review's suggested fix — emitting `{ text: committed.text, isFinal: true }` from `commitPendingUtterance` alongside the `utterance` event — is a reasonable, low-risk starting point, but the fix should also address the two related warnings (WR-01 empty-final guard, WR-02 stale-interim-on-commit) since they compound with the same code path.

---

_Verified: 2026-07-06T23:24:25Z_
_Verifier: Claude (gsd-verifier)_
