---
slug: qa-panel-transcript-render
status: resolved
trigger: |
  Q/A panel renders transcript incorrectly: paragraphs start as grey (interim) text,
  sometimes turn white (final), sometimes disappear entirely, and no Question/Statement
  cards ever appear. Audio capture works normally. Regression likely in the Phase 8
  diarized-utterance pipeline / recent CR-01 re-emit fix.
created: 2026-07-06
updated: 2026-07-06
---

# Debug Session: qa-panel-transcript-render

## Symptoms

- **Expected behavior:** Diarized utterances render on the overlay as stable Q/S cards
  (e.g. `Q1 - Person 1`, `S3 - Person 2`); interim (grey) text should finalize cleanly
  into committed (white) utterance text, and question vs statement classification should
  produce distinct Question/Statement panels.
- **Actual behavior:** Paragraphs begin as grey (interim) text, then *sometimes* turn
  white (final) and *sometimes disappear entirely*. No Question nor Statement cards/panels
  ever appear. Audio capture itself works normally (meter moves, STT is flowing).
- **Error messages:** Not yet checked — DevTools console / terminal not inspected.
  Investigation should identify what to look for and instruct the user where to look.
- **Timeline:** Uncertain. Prime suspects are the Phase 8 diarized-utterance pipeline and
  the recent CR-01 "re-emit committed utterances as final transcript" quick task
  (commits 1f4f02b, 77b0fef, 05ebc66, 9b401fc). Use git history to bisect.
- **Reproduction:** `npm run dev` (electron-vite dev) with live system audio through the
  overlay.

## Context

- Project: Jedi Interviews (Electron + TS overlay meeting assistant), Windows only.
- Milestone v1.1 "Structured Q/A Panel" — Phase 8 (diarized-utterance-pipeline) EXECUTING,
  Phase 9 (card-based Q/A panel redesign) not yet done.
- **Important:** Phase 9 rebuilds `transcript-panel.tsx` into per-utterance Q/S cards and
  is NOT complete. So "no Q/S cards appear" may be partly *expected* if the card UI hasn't
  landed yet — the debugger must distinguish "pipeline emits classification but UI doesn't
  render cards (Phase 9 not built)" from "pipeline itself is broken." Confirm what the
  current `transcript-panel.tsx` is supposed to render at this commit.
- CR-01 fix re-emits committed utterances as final transcript events — a likely source of
  the grey→white→disappear flicker (duplicate/competing final vs interim events, or
  utterance keying/dedup issues in the renderer).

## Current Focus

- **hypothesis:** Phase 8 stopped emitting a `transcript` event for each `is_final` run
  (it now buffers them silently in `UtteranceAccumulator` and commits only on
  `speech_final`/`UtteranceEnd`). The current `transcript-panel.tsx` still renders the old
  `finalText`/`interimText` model, so within a multi-run turn the grey interim line grows
  then RESETS/shrinks each time Deepgram closes an `is_final` segment (its `transcript`
  field restarts for the next segment), while the finalized words sit invisibly in the
  accumulator. White text only appears when the whole turn commits at `speech_final`. This
  is the grey→white→disappear flicker. No Q/S cards is EXPECTED (Phase 9 UI not built).
- **reasoning_checkpoint:**
    - hypothesis: "The mid-turn is_final runs are no longer surfaced to the renderer;
      Deepgram resets its interim per is_final run, so the grey line disappears until the
      turn's speech_final commit re-emits the full turn as one final."
    - confirming_evidence:
        - "git show 026d395~1 handleMessage: EVERY Results msg emitted transcript
          (is_final:true → immediate appendFinal per run). Phase 8 026d395 replaced this
          with accumulator buffering; is_final runs no longer emit any transcript event."
        - "08-RESEARCH.md:222-225 cites Deepgram: 'Long utterances may have multiple
          is_final:true responses before speech_final:true … concatenate is_final
          transcripts into a buffer' — confirms interim resets per is_final segment."
        - "commitPendingUtterance re-emits the WHOLE committed turn as one isFinal:true
          transcript only at speech_final (CR-01, gateway line 329-332)."
        - "transcript-panel.tsx renders only finalText+interimText; no utterance/card
          rendering — Phase 9 not built, so 'no Q/S cards' is expected, not the regression."
    - falsification_test: "If mid-turn is_final runs DID still emit transcript events, the
      grey line would commit to white per-run and never shrink. git diff proves they don't."
    - fix_rationale: "Re-surface interim continuity WITHOUT breaking D-01 one-utterance-
      per-turn: emit the accumulator's in-progress joined text as an interim (isFinal:false)
      transcript after each is_final append, so the buffer's interim shows the full turn-so-
      far (finalized runs + live partial) instead of only Deepgram's post-reset fragment.
      The committed white text still lands once at speech_final via the existing CR-01
      final re-emit. Additive, seam-level, no consumer change."
    - blind_spots: "Whether Deepgram's post-is_final interim fragment is fully disjoint from
      the accumulated runs (if it overlaps, joining could duplicate a word at the seam);
      whether a long turn's accumulated interim grows unbounded (bounded by turn length —
      commit clears it). Live verification required to confirm the visual result."
- **next_action:** Fix applied and unit-verified (185/185 tests, typecheck + oxlint clean).
  AWAITING HUMAN VERIFY: run `npm run dev` with live system audio and confirm the grey interim
  line grows smoothly through a whole turn (no mid-turn shrink/disappear) and commits to white
  once per turn. If confirmed, archive session + append knowledge-base entry + commit.

## Evidence

- timestamp: 2026-07-06
  checked: transcript-panel.tsx (renderer) — what the Q/A panel actually renders at HEAD.
  found: It renders ONLY `finalLog` (accumulated finalText) as white + `interimText` as
    grey. There is NO utterance/card rendering, no consumption of the `utterances` array.
  implication: "No Q/S cards ever appear" is EXPECTED — Phase 9 (card UI) is not built. The
    real regression is confined to the grey (interim) / white (final) flicker. Do not chase
    missing cards.

- timestamp: 2026-07-06
  checked: git show 026d395~1 vs HEAD of deepgram-stt.gateway.ts handleMessage.
  found: Pre-Phase-8 handleMessage emitted a `transcript` event for EVERY non-empty Results
    message — is_final:false → interim, is_final:true → final. So each is_final run was
    appendFinal'd immediately and committed to white as the turn progressed. Phase 8
    (026d395) replaced this: is_final runs are buffered in UtteranceAccumulator and NO
    transcript event is emitted until speech_final/UtteranceEnd. Interim (is_final:false)
    still emits, but Deepgram resets its `transcript` field after each is_final run.
  implication: The grey interim line now grows then SHRINKS/RESETS every time an is_final
    run closes, because the finalized portion is held invisibly in the accumulator and the
    next interim only carries the new fragment. White text appears only once per whole turn
    at speech_final (via the CR-01 re-emit). This is the grey→white→disappear behavior.

- timestamp: 2026-07-06
  checked: 08-RESEARCH.md Pattern 2 (lines 219-241) and cited Deepgram docs.
  found: CITED developers.deepgram.com: "Long utterances may have multiple is_final:true
    responses before speech_final:true. Do not use speech_final alone … concatenate
    is_final transcripts into a buffer, then treat speech_final:true as utterance
    completion." The buffer-then-commit design is correct for producing ONE utterance per
    turn (D-01).
  implication: The pipeline (main) is behaving as designed for the FUTURE card UI. The
    regression is the mismatch between the new emit cadence and the OLD rolling
    finalText/interimText renderer that is still live at this commit (Phase 9 not landed).
    Fix: restore mid-turn visual continuity in the interim line without breaking D-01.

- timestamp: 2026-07-06
  checked: index.ts attachSttGatewayHandlers (lines 343-360) — how seam events map to buffer.
  found: `transcript` isFinal:true → buffer.appendFinal (clears interim); isFinal:false →
    buffer.setInterim. `utterance` → pushes into utterances[] and re-pushes snapshot. Every
    handler calls pushTranscript with buffer.renderable().
  implication: Emitting an interim (isFinal:false) transcript of the accumulated turn-so-far
    will flow straight into buffer.setInterim and render as grey continuity — no index.ts or
    renderer change needed. The final commit path (appendFinal) is untouched.

## Eliminated

- hypothesis: The bug is that no Question/Statement cards render (missing pipeline
  classification output).
  evidence: transcript-panel.tsx does not render cards or read the `utterances` array at
    all — Phase 9 card UI is not implemented yet. classifyUtterance IS run in the gateway
    and utterances ARE emitted/pushed; the data exists, only the card UI is absent (expected).
  timestamp: 2026-07-06

- hypothesis: The CR-01 re-emit created duplicate/competing final vs interim events causing
  the flicker.
  evidence: CR-01's final re-emit is purely additive and only fires once per committed turn
    at speech_final; appendFinal clears interim as designed. The flicker predates the white
    commit — it is the interim RESETTING mid-turn (finalized runs held in the accumulator),
    which is caused by the Phase 8 026d395 rewrite that stopped emitting per-is_final finals,
    NOT by the CR-01 re-emit. CR-01 actually restored the (turn-level) white commit.
  timestamp: 2026-07-06

## Resolution

root_cause: |
  Phase 8 rewrite (026d395) changed the gateway's emit cadence: mid-turn `is_final` word
  runs are now buffered silently in UtteranceAccumulator and emit NO transcript event until
  the whole turn commits at `speech_final`/`UtteranceEnd`. Deepgram resets its interim
  `transcript` field after each `is_final` run, so the renderer's grey interim line grows
  then shrinks/disappears mid-turn (the finalized portion is invisible, held in the
  accumulator), and white text only appears once per whole turn. The current
  transcript-panel.tsx still renders the old rolling finalText/interimText model (Phase 9
  card UI not built), so this new cadence surfaces as the grey→white→disappear flicker.
  "No Q/S cards" is expected (Phase 9 not implemented), not part of the regression.
fix: |
  Restored mid-turn interim continuity in DeepgramSttGateway.handleMessage WITHOUT breaking
  the D-01 one-utterance-per-turn contract. Added UtteranceAccumulator.peek() (space-joined
  buffered is_final runs, non-draining) and a new private emitTurnInterim(liveFragment)
  helper on the gateway that emits an interim (isFinal:false) transcript of
  `accumulator.peek()` joined with the live fragment. It is called (a) on every is_final:false
  message with the live fragment, and (b) immediately after each is_final run is appended
  (with an empty fragment) so the finalized-so-far text stays visible as grey while it sits in
  the accumulator. The grey line now shows the WHOLE turn as it builds instead of shrinking to
  Deepgram's post-is_final reset fragment. The committed white text still lands exactly once
  per turn via the unchanged CR-01 final re-emit at commitPendingUtterance (speech_final /
  UtteranceEnd). Interim stays replace-in-place (buffer.setInterim overwrites); no index.ts,
  transcript-buffer.ts, or renderer change. Additive at the seam — no consumer contract change.
verification: |
  UNIT (automated, done): npx vitest run — 185/185 pass (was 182; +3 new tests). npm run
  typecheck — clean (node + web). oxlint — clean. Prettier format:check drift is PRE-EXISTING
  (confirmed by stashing the fix: the same files warn on unmodified main; 29 unrelated files
  affected — a project-wide CRLF/LF drift, out of scope). New/changed tests:
    - deepgram-stt.gateway.test.ts: added "grey-continuity regression" (multi is_final run
      turn asserts interims = ['hello','hello there','hello there how','hello there how are you']);
      updated "commit AND re-emit final on speech_final" to expect the additive interim emit
      before the final. CR-01 isFinal-filtered assertions unchanged and still green.
    - utterance-accumulator.utility.test.ts: added peek() non-draining + empty-peek tests.
  LIVE (human, CONFIRMED 2026-07-06): User ran `npm run dev` with live multi-sentence audio.
    The grey interim line now grows smoothly through the whole turn with no mid-turn
    shrink/disappear, and commits to white once per turn. Cards absent as expected (Phase 9
    not built). Fix verified end-to-end.
files_changed:
  - src/main/stt/deepgram-stt.gateway.ts (emitTurnInterim helper + interim continuity in handleMessage)
  - src/main/stt/utterance-accumulator.utility.ts (added peek())
  - src/main/stt/deepgram-stt.gateway.test.ts (grey-continuity regression + updated final-emit test)
  - src/main/stt/utterance-accumulator.utility.test.ts (peek() tests)

## Specialist Review

- **Reviewer:** TypeScript specialist
- **Verdict:** LOOKS_GOOD — no file changes recommended.
- **Findings:** `peek()` / `emitTurnInterim()` correctly avoid seam duplication
  (append-before-peek ordering; the empty-string sentinel is guarded by the length filter)
  and never drain the accumulator, so D-01's one-utterance-per-turn contract and the CR-01
  final re-emit are both untouched. Types, TSDoc, and defensive-payload conventions match
  IDEXX standards throughout. Only a cosmetic note on the empty-string sentinel (already
  explained by the adjacent inline comment at the call site); no low-risk refinements
  warranted.
- **Date:** 2026-07-06
