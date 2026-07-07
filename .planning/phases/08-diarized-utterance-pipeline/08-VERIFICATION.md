---
phase: 08-diarized-utterance-pipeline
verified: 2026-07-06T23:59:00Z
status: human_needed
score: 8/8 must-haves verified
overrides_applied: 0
re_verification:
  previous_status: human_needed
  previous_score: 8/8
  gaps_closed: []
  gaps_remaining: []
  regressions: []
human_verification:
  - test: "Live 2-speaker session: confirm distinct Person 1 / Person 2 utterance cards reach the overlay payload, and Ctrl+Alt+K restarts numbering at Person 1"
    expected: "Person N labels stay stable per voice across the session; after Ctrl+Alt+K the next utterance for any voice is labeled Person 1 again"
    why_human: "Requires a live Deepgram session with two real speakers and on-machine hotkey verification; cannot be exercised by unit tests or static analysis (documented as Manual-Only in 08-03-PLAN.md's <verification> section). Unaffected by the debug-session commit (87fbd19) — that fix touched only interim-line continuity, not speaker mapping."
  - test: "Manually trigger 'ai-answer'/'ai-talking-points' mid-meeting and confirm a real Claude response appears instead of the empty-span placeholder"
    expected: "With real recent speech in the buffer, pressing the AI hotkeys produces a streamed Claude response, not 'No recent transcript to act on'"
    why_human: "Requires a live Anthropic call end-to-end with real audio; the empty-span guard, the CR-01 final re-emit, and the debug-session's grey-continuity fix are each covered by unit tests in isolation, but the live gateway-to-buffer-to-orchestrator-to-Claude path has not been exercised end-to-end on the target machine since these two fixes landed."
---

# Phase 8: Diarized Utterance Pipeline Verification Report

**Phase Goal:** The transcript stream stops being one flat text blob and becomes a stream of discrete, speaker-attributed, classified utterances — each carrying a stable `Person N` label and a Question/Statement tag — delivered through the existing `ISttProvider` seam so nothing downstream is coupled to Deepgram. This is the data/seam layer the Phase 9 card UI consumes.

**Verified:** 2026-07-06T23:59:00Z
**Status:** human_needed
**Re-verification:** Yes — third pass, against current HEAD (commit `87fbd19`), one commit past the prior (pass 2) verification baseline (`43572b6`)

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | A finalized utterance's text is classified Question/Statement by a pure local function, defaulting to Statement (D-06/D-07/D-08, QA-03) | VERIFIED (unchanged) | `src/main/stt/question-classifier.utility.ts` not touched by the debug-session commit (absent from `git diff 43572b6 HEAD --stat`); 7 Vitest cases pass in the independently re-run suite. |
| 2 | A run of diarized words yields a single utterance speaker via the modal per-word speaker index (QA-01 grouping core) | VERIFIED | `pickModalSpeakerIndex` in `utterance-accumulator.utility.ts` is unchanged by the debug session (only `peek()` was added, a non-draining read); 2 `pickModalSpeakerIndex` tests + the modal-index accumulator test still pass. |
| 3 | First-seen Deepgram speaker index gets the next `Person N`; the same index keeps that label for the session (D-03, QA-02) | VERIFIED (unchanged) | `src/main/stt/speaker-map.ts` not touched by the debug-session commit; 3 tests pass; `deepgram-stt.gateway.ts:351` (`this.speakerMap.label(speakerIndex)`) unchanged call site inside `commitPendingUtterance`. |
| 4 | An undiarized utterance gets a neutral non-Person label and stays out of the numbered list (D-04) | VERIFIED (unchanged) | Confirmed by the still-passing gateway test `should give an undiarized turn the neutral speaker with isDiarized false` (line 561) — `{ speaker: 'Speaker', isDiarized: false }` for a wordless turn. |
| 5 | Clearing the speaker map restarts Person N numbering at Person 1 (D-05) | VERIFIED (unchanged) | `SpeakerMap.clear()` unchanged; `index.ts:130` (`sttGateway?.clearSpeakers()`) unchanged, called from the `clear-transcript` handler alongside `utterances.length = 0` and `buffer.clear()` (read directly, lines 127-133). |
| 6 | The `ISttProvider` seam carries a committed `IUtteranceEvent` (text + speaker + isDiarized + classification) with no `@deepgram/sdk` import in the contract file (D-09) | VERIFIED (unchanged) | `src/main/stt/stt-provider.interface.ts` not touched by the debug-session commit; `grep -c "@deepgram/sdk"` on it returns 2 (both are JSDoc prose, not `import` statements — confirmed by `grep -rn "from '@deepgram/sdk'" src` matching only `deepgram-stt.gateway.ts`). |
| 7 | The live Deepgram gateway enables diarization + utterance-end and emits ONE classified, `Person N`-attributed `utterance` per finalized turn through the seam, with no double-commit (QA-01 observable half, D-01) | VERIFIED | Read `deepgram-stt.gateway.ts:344-364` (`commitPendingUtterance`) directly at HEAD: `this.emit('utterance', utterance)` at line 358 is the ONLY `emit('utterance', …)` call site in the file (`grep -n "emit('utterance'"` returns exactly one match). The debug session's new `emitTurnInterim` calls (lines 288, 297) emit only `'transcript'` with `isFinal:false` — they never call `commitPendingUtterance` or touch the `'utterance'` emit path. `accumulator.commit()` (the empty-commit no-op guard) is unchanged. Independently re-confirmed by `should emit exactly one utterance per speech_final turn built from multiple is_final runs` and `should emit exactly one utterance for a speech_final followed by a trailing UtteranceEnd`, both passing. |
| 8 | Committed/finalized speech still feeds the rolling `TranscriptBuffer` (and therefore the AI orchestrator's transcript span) — no regression of TRN-01/TRN-02/AI-01/AI-02 (CR-01, closed pass 2) | **VERIFIED — CR-01 fix still intact at HEAD, re-traced independently** | Traced the full chain by reading live code, not summaries: `commitPendingUtterance` (`deepgram-stt.gateway.ts:344-364`) still emits `this.emit('transcript', { text: committed.text, isFinal: true })` at line 360-363, guarded on `committed.text.trim().length > 0` (WR-01 mitigation, unchanged) — this line was NOT touched by the debug-session commit. `index.ts:343-345`'s `gateway.on('transcript', …) { if (event.isFinal) buffer.appendFinal(event.text); … }` is unchanged and reachable (confirmed by direct read, lines 343-350). `TranscriptBuffer.appendFinal` (`transcript-buffer.ts:74-78`) is unchanged, pushes into `this.finals` and clears the trailing interim. `AiOrchestrator.trigger()` (`ai-orchestrator.ts:150-151`) is unchanged and reads `this.transcriptBuffer.recentSince(RECENT_SPAN_MS)` (`transcript-buffer.ts:106-113`, reads `this.finals`) — non-empty after a real committed turn. Independently re-confirmed by the still-passing `should re-emit the committed turn as a final transcript so the buffer feed is non-empty (CR-01 regression)` test (gateway test file, line 193) and `should re-emit a final transcript on an UtteranceEnd-fallback commit` (line 243). |

**Score:** 8/8 truths verified. Truths 1, 3, 4, 5, 6 are backed by files the debug-session commit did not touch (confirmed via `git diff 43572b6 HEAD --stat`, which lists only `deepgram-stt.gateway.ts`, `deepgram-stt.gateway.test.ts`, `utterance-accumulator.utility.ts`, `utterance-accumulator.utility.test.ts` as source changes) — regression-safe by construction. Truths 2, 7, 8 are backed by files the debug session DID modify; each was independently re-traced against the live HEAD source (not the SUMMARY/debug-doc narrative) and confirmed intact.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/main/stt/stt-provider.interface.ts` | `IUtteranceEvent`/`UtteranceClassification`/`on('utterance')`, no Deepgram import, `transcript`/`ISttTranscriptEvent` unchanged | VERIFIED (unchanged) | Untouched by the debug session; read directly, matches Plan 01's exact shape. |
| `src/main/stt/question-classifier.utility.ts` (+ test) | Pure `classifyUtterance`, full Wave 0 coverage | VERIFIED (unchanged) | Untouched; 7 tests pass. |
| `src/main/stt/utterance-accumulator.utility.ts` (+ test) | `pickModalSpeakerIndex` + `UtteranceAccumulator` with empty-commit no-op, PLUS a new non-draining `peek()` | VERIFIED | `peek()` (lines 111-113) returns `this.textRuns.join(' ')` without mutating state — read directly. `commit()`'s empty-commit no-op (lines 122-125) and `clear()` are byte-for-byte unchanged. 8 tests pass (was 6; +2 for `peek()`). |
| `src/main/stt/speaker-map.ts` (+ test) | `SpeakerMap` with `label`/`clear`, D-03/D-04/D-05 | VERIFIED (unchanged) | Untouched; 3 tests pass. |
| `src/main/stt/deepgram-stt.gateway.ts` | Diarize + message-switch + accumulator/speaker-map/classifier wiring + utterance emission + CR-01 final-transcript re-emit + new grey-continuity interim re-surfacing + D-11 audit | VERIFIED | Read the full file at HEAD. `commitPendingUtterance` (344-364) unchanged from pass 2 (utterance emit + guarded final re-emit). NEW: `emitTurnInterim(liveFragment)` (private method, lines 315-324) emits an `isFinal:false` transcript combining `accumulator.peek()` with the live fragment, called from `handleMessage` on every interim Results (line 288) and after every `is_final` append (line 297, empty fragment). This is additive to the D-02 live line and does not touch the `'utterance'` emit path or `commitPendingUtterance`. |
| `src/main/stt/deepgram-stt.gateway.test.ts` | Diarized-payload + UtteranceEnd + utterance-emission + no-double-commit + keep-alive + CR-01 regression + grey-continuity regression coverage | VERIFIED | 29 tests pass (up from 28 at pass 2; +1 for the new `should keep the interim line showing the whole turn-so-far across multiple is_final runs (grey-continuity regression)` test at line 219). The CR-01 regression test (line 193) and the `speech_final` + trailing-`UtteranceEnd` no-double-commit tests are present and unmodified in intent. |
| `src/main/overlay-window.manager.ts` | `IOverlayTranscript` extended additively with `utterances: IUtteranceEvent[]` | VERIFIED (unchanged) | Untouched by the debug session; read directly, field present at line 110, four existing fields intact. |
| `src/main/index.ts` | `gateway.on('utterance')` binding + `gateway.on('transcript')` → `appendFinal` branch + speaker reset wired into clear-transcript | VERIFIED (unchanged) | Untouched by the debug session; `on('utterance')` at line 357, `on('transcript')` → `appendFinal` branch at lines 343-345, `clearSpeakers()` call at line 130 — all read directly and confirmed present. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `question-classifier.utility.ts` | `stt-provider.interface.ts` | imports `UtteranceClassification` | WIRED (unchanged) | Untouched. |
| `deepgram-stt.gateway.ts` | `utterance-accumulator.utility.ts` | imports `pickModalSpeakerIndex` + `UtteranceAccumulator` | WIRED (unchanged) | Line 5; `commitPendingUtterance` (line 350) and `emitTurnInterim` (line 316, via `peek()`) both use it. |
| `deepgram-stt.gateway.ts` | `question-classifier.utility.ts` | imports `classifyUtterance` | WIRED (unchanged) | Line 7; used at line 356. |
| `deepgram-stt.gateway.ts` | `speaker-map.ts` | `SpeakerMap` owned/injected | WIRED (unchanged) | Line 6, field at line 104, used at line 351. |
| `index.ts` | `deepgram-stt.gateway.ts` | `gateway.on('utterance', …)` + `gateway.clearSpeakers()` | WIRED (unchanged) | `on('utterance')` at line 357; `clearSpeakers()` call at line 130. Untouched by debug session. |
| `index.ts` | `overlay-window.manager.ts` | `pushTranscript` carries the utterance list | WIRED (unchanged) | All `pushTranscript(...)` call sites pass `utterances`. Untouched. |
| `deepgram-stt.gateway.ts` (finalized turn) | `transcript-buffer.ts` `appendFinal` (via `index.ts`'s `on('transcript')`) | `emit('transcript', {isFinal:true})` → `if (event.isFinal) buffer.appendFinal(...)` | WIRED (CR-01 fix intact) | `commitPendingUtterance` emits `isFinal: true` at line 360-362 (unchanged since pass 2); `index.ts:343-345`'s `appendFinal` branch is reachable and unchanged. Independently re-confirmed by the passing CR-01 regression test. |
| `deepgram-stt.gateway.ts` (interim continuity, new) | `transcript-buffer.ts` `setInterim` (via `index.ts`'s `on('transcript')`) | `emitTurnInterim` → `emit('transcript', {isFinal:false})` → `buffer.setInterim(...)` | WIRED (new, verified) | `handleMessage`'s `isFinal:false` branch routes through the SAME existing `index.ts:346-347` `else { buffer.setInterim(event.text) }` path — no `index.ts` change was needed or made (confirmed: `index.ts` absent from the debug-session diff). The new emission rides the pre-existing D-02 interim contract. |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|---------------------|--------|
| `IOverlayTranscript.utterances` (overlay push) | `utterances` array in `index.ts` | `gateway.on('utterance', …)` pushes real committed `IUtteranceEvent`s from live Deepgram diarized turns | Yes | FLOWING (unchanged) |
| `IOverlayTranscript.interimText` (overlay push) | `buffer.renderable().interimText` | `TranscriptBuffer.setInterim`, now fed by BOTH Deepgram's raw interim fragment AND the new `emitTurnInterim`-combined turn-so-far text (accumulator `peek()` + live fragment) | Yes | FLOWING (new path added, verified via the grey-continuity regression test asserting the exact growing-string sequence `['hello', 'hello there', 'hello there how', 'hello there how are you']`) |
| `IOverlayTranscript.finalText` (overlay push) | `buffer.renderable().finalText` | `TranscriptBuffer.finals`, populated by `appendFinal`, fed by the gateway's `commitPendingUtterance` final re-emit (CR-01, unchanged this pass) | Yes | FLOWING (unchanged from pass 2) |
| `AiOrchestrator.trigger()` transcript span | `transcriptBuffer.recentSince(RECENT_SPAN_MS)` | Same `TranscriptBuffer.finals` | Yes | FLOWING (unchanged from pass 2) — chain re-traced this pass: `ai-orchestrator.ts:151` → `transcript-buffer.ts:106-113` → `transcript-buffer.ts:74-78` → `index.ts:344-345` → `deepgram-stt.gateway.ts:360-362`. Every link is live code at current HEAD. |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full unit suite green | `npm test -- --run` | 23 files, **185 tests passed**, exit 0 (independently re-run by the verifier in this pass) | PASS |
| Project typecheck clean | `npm run typecheck` (node + web) | exit 0, no errors (independently re-run) | PASS |
| `emit('utterance', …)` is the sole utterance emission site (D-01 non-regression) | `grep -n "emit('utterance'" src/main/stt/deepgram-stt.gateway.ts` | exactly 1 match, at line 358, inside `commitPendingUtterance` | PASS |
| No `@deepgram/sdk` import outside the gateway (D-09/QA-07 regression check) | `grep -rn "from '@deepgram/sdk'" src` | only `src/main/stt/deepgram-stt.gateway.ts` | PASS |
| Debug-session diff scope matches claim | `git diff 43572b6 HEAD --stat` | Only `deepgram-stt.gateway.ts`/`.test.ts` + `utterance-accumulator.utility.ts`/`.test.ts` (source) plus planning docs/STATE.md/debug-knowledge-base changed | PASS — confirms truths 1/3/4/5/6 needed only regression sanity |
| No debt markers in touched files | `grep -n -E "TBD\|FIXME\|XXX\|TODO\|HACK\|PLACEHOLDER"` across the 4 touched source/test files | no matches | PASS |

### Probe Execution

No `scripts/*/tests/probe-*.sh` probes exist in this repository and none are declared in the Phase 8 plans, SUMMARYs, or the debug-session doc. Step 7c SKIPPED (no probes declared or discoverable).

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|--------------|--------|----------|
| QA-01 | 08-02, 08-03 | Discrete per-speaker utterances via diarization + utterance segmentation | SATISFIED | Utterance layer fully built, wired to overlay, D-01 one-per-turn contract independently re-verified at current HEAD; unaffected in substance by the debug-session's interim-continuity fix (which only restores mid-turn grey-line visual continuity, additive at the seam). |
| QA-02 | 08-01, 08-03 | Stable `Person N` speaker map, same voice keeps same label all session | SATISFIED | `SpeakerMap` unchanged since pass 2; wired to Ctrl+Alt+K reset. Live-session stability remains the carried-forward human-verification item. |
| QA-03 | 08-01 | Question/Statement classification, default Statement when unsure | SATISFIED | `classifyUtterance` unchanged since pass 2; unit-tested. |
| QA-07 | 08-01, 08-02, 08-03 | Utterance/speaker data flows through `ISttProvider` seam, backend-agnostic | SATISFIED | Seam extension remains clean; the debug session's `emitTurnInterim`/`peek()` additions stay entirely inside the gateway and reuse the pre-existing `ISttTranscriptEvent` seam type — no new Deepgram-coupled type crosses the seam, confirmed by grep. |

No orphaned requirements: REQUIREMENTS.md traceability maps exactly QA-01/QA-02/QA-03/QA-07 to Phase 8, and all four appear in the union of the three plans' `requirements:` frontmatter (`08-01: QA-02/QA-03/QA-07`, `08-02: QA-01/QA-07`, `08-03: QA-01/QA-02/QA-07` — union = {QA-01, QA-02, QA-03, QA-07}, matching the task's stated Phase requirement IDs exactly).

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/main/stt/deepgram-stt.gateway.ts` | 293 | `accumulator.append` still called unconditionally for every `is_final` run, no `text.length > 0` guard at the append call site itself (WR-01, partial, pre-existing) | ℹ️ INFO (unchanged from pass 2) | Mitigated at the emission boundary (whitespace guard on the final re-emit, line 360; whitespace-only-turn test passes). Not newly introduced or worsened by the debug session. |
| `src/main/stt/deepgram-stt.gateway.ts` | ~350 (WR-03, pre-existing) | `pickModalSpeakerIndex` recomputes over all retained words on every commit; no per-turn word-count ceiling | ℹ️ INFO (unchanged, pre-existing, out of scope) | Noted in 08-REVIEW.md; unaffected by this pass's changes. |
| `src/main/index.ts` | ~349-359 (IN-03, pre-existing) | Full `utterances` array resent on every high-frequency transcript push | ℹ️ INFO (unchanged, pre-existing, out of v1 scope) | Performance-only concern; unaffected by this pass's changes. |

No unresolved `TBD`/`FIXME`/`XXX`/`TODO`/`HACK`/`PLACEHOLDER` debt markers found in any file touched by the debug-session commit or by Phase 8 overall.

No blocker-level anti-patterns found this pass.

### Human Verification Required

### 1. Live diarized session — stable Person N labels + Ctrl+Alt+K reset

**Test:** Run a live 2-speaker meeting session; observe the utterance cards' `speaker` field in the overlay payload (or Phase 9's future UI) for both voices, then press Ctrl+Alt+K mid-session and speak again.
**Expected:** Each voice keeps a consistent `Person N` for the whole session; after the hotkey, the next utterance from either voice is labeled `Person 1`.
**Why human:** Requires a live Deepgram connection with two real distinguishable speakers and on-machine hotkey testing — explicitly called out as Manual-Only in `08-03-PLAN.md`'s `<verification>` section; cannot be exercised by unit tests. Carried forward unchanged from pass 2 — the debug-session fix (commit `87fbd19`) only touched interim-line visual continuity, not speaker mapping, and did not exercise this item.

### 2. Live confirmation that AI answer/talking-points modes work end-to-end

**Test:** Speak for ~10-20 seconds in a live session, then press the answer or talking-points hotkey.
**Expected:** A real streamed Claude response appears, not the `EMPTY_SPAN_TEXT` ("No recent transcript to act on") placeholder.
**Why human:** The empty-span guard, the CR-01 final re-emit, and the debug session's grey-continuity fix are each covered by fast unit/integration-style tests in isolation. The debug session's own "LIVE (human, CONFIRMED)" note in `.planning/debug/resolved/qa-panel-transcript-render.md` confirms the VISUAL grey→white flicker fix was verified live, but does not confirm the AI hotkey path was re-exercised end-to-end with a real Anthropic call after these two fixes landed. This remains the one path the app's Core Value depends on that has not been confirmed live since CR-01 + the debug-session fix.

### Gaps Summary

No gaps found. This third verification pass, run independently against the live HEAD (commit `87fbd19`, one commit past the prior verification's baseline `43572b6`), confirms:

1. **CR-01 remains fixed.** `commitPendingUtterance` (`src/main/stt/deepgram-stt.gateway.ts:344-364`) still emits both the single `utterance` event (D-01 intact) and, additively, an `isFinal: true` transcript guarded on non-whitespace text. `index.ts:343-345`'s `appendFinal` branch is unchanged and reachable. `AiOrchestrator.trigger()` → `TranscriptBuffer.recentSince()` → `.finals` (populated by `appendFinal`) chain is fully live code, independently re-traced this pass — not assumed from the pass-2 report.
2. **The debug-session changes (commit `87fbd19`) did not regress D-01, the seam cleanliness, or the CR-01 final-transcript emission.** The new `UtteranceAccumulator.peek()` is non-draining (verified by direct read and by its dedicated unit tests). The new `DeepgramSttGateway.emitTurnInterim()` emits ONLY `isFinal:false` transcript events and never calls `commitPendingUtterance` or `this.emit('utterance', …)` — confirmed by reading the method body and by `grep -n "emit('utterance'"` returning exactly one match in the whole file (the pre-existing site inside `commitPendingUtterance`). No `@deepgram/sdk` import was added outside the gateway (`grep -rn "from '@deepgram/sdk'" src` still lists only the gateway file).
3. **All 8 observable truths verified.** Truths 1/3/4/5/6 are backed by files untouched since the pass-2 baseline (confirmed via `git diff 43572b6 HEAD --stat`) and pass on regression sanity; truths 2/7/8 are backed by files the debug session did modify and were independently re-traced against live HEAD source, not the debug-session doc's narrative.
4. **Test/typecheck counts independently reproduced, not trusted from the debug-session doc.** `npm test -- --run`: 185 tests passed, 23 files, exit 0 (matches the debug session's claimed count exactly). `npm run typecheck`: exit 0, clean for both node and web configs.
5. **No debt markers, no blocker anti-patterns, no orphaned requirements.**

The two human-verification items are carried forward unchanged — neither is affected by, nor resolved by, the debug-session fix (item 1 concerns speaker mapping, unaffected; item 2 concerns the live AI path, not re-exercised end-to-end by the debug session's "LIVE (human, CONFIRMED)" note, which only covers the visual interim-continuity fix). Per the decision tree, human verification items present (even with all 8 automated truths passing and zero gaps) yields `human_needed` rather than `passed`.
