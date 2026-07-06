# Phase 8: Diarized Utterance Pipeline - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-06
**Phase:** 8-Diarized Utterance Pipeline
**Areas discussed:** Utterance finalization + interim, Speaker identity rule, Keep-alive crash fix, Classification edge cases

---

## Folded Todo (cross-reference)

| Option | Description | Selected |
|--------|-------------|----------|
| Fold into Phase 8 | Fix the keep-alive crash (260620) in the same pass as the diarization rework — same file (deepgram-stt.gateway.ts), avoids a second edit + retest | ✓ |
| Keep separate | Leave as a standalone pending todo | |

**User's choice:** Fold into Phase 8
**Notes:** Todo 260620 (HIGH bug) touches the exact gateway file Phase 8 reworks. Three other todos matched by keyword score (0.6) but were NOT folded: 260617 (Phase-3 audio-capture seam, already resolves_phase:4), 260618-hud-timer and 260618-scrollbar (renderer/overlay — Phase 8 is data-only).

---

## Utterance finalization + interim

| Option | Description | Selected |
|--------|-------------|----------|
| On is_final per utterance | Commit a card the moment Deepgram marks an utterance final; interim shows as a live line until then | ✓ |
| On utterance_end / speech_final | Wait for the stronger end-of-utterance signal; fewer cleaner cards but laggier | |
| You decide | Let planner pick the exact Deepgram signal | (partial — exact flag left to Claude) |

**User's choice:** On is_final per utterance
**Notes:** Behavior is what matters (prompt, stable, one-entry-per-utterance); the exact flag (is_final vs speech_final vs utterance_end) is Claude's discretion at research time.

| Option | Description | Selected |
|--------|-------------|----------|
| Live line, unclassified | In-progress text as one distinct dimmed/italic live line, no Q/S badge, no card frame; resolves into a labeled card on final | ✓ |
| Provisional card | Full card immediately with tentative speaker + Q/S guess, updating in place (can flicker) | |
| Hide until final | Show nothing until finalized (loses live feedback) | |

**User's choice:** Live line, unclassified
**Notes:** Only finalized utterances get Q1/S3 labels; interim replaced in place, never accumulated (mirrors existing setInterim discipline).

---

## Speaker identity rule

| Option | Description | Selected |
|--------|-------------|----------|
| Each new index = new Person | First time a Deepgram index appears, assign next Person N; deterministic; accept minor over-split risk | ✓ |
| Cap the people count | Assign up to a small cap, then fold further indices into the last/nearest Person | |
| You decide | Planner chooses the mapping heuristic | |

**User's choice:** Each new index = new Person
**Notes:** Simple, deterministic, testable; no people-count cap. Resets on Ctrl+Alt+K.

| Option | Description | Selected |
|--------|-------------|----------|
| 'Unknown' / 'Speaker' label | Un-attributed utterances get a neutral label, kept out of the numbered Person list | ✓ |
| Attribute to last known Person | Reuse the previous speaker's Person N | |
| Default to Person 1 | Fold all un-attributed into Person 1 | |

**User's choice:** 'Unknown' / 'Speaker' label
**Notes:** Don't invent a person Deepgram didn't attribute; don't merge into last-known speaker.

---

## Keep-alive crash fix

| Option | Description | Selected |
|--------|-------------|----------|
| Treat as likely-fixed, add regression test | Current guard (state==='connected') + try/catch already prevents the crash; todo predates it. Add the missing regression test, audit for other unguarded timers, close todo if no gap | ✓ |
| Assume a real remaining gap, hunt for it | Treat crash as still live; actively investigate races where state reads connected but socket closed mid-send | |

**User's choice:** Treat as likely-fixed, add regression test
**Notes:** Verified 2026-07-06: deepgram-stt.gateway.ts:242-264 already gates + try/catches sendKeepAlive. The todo's crash stack points at exactly that call, so it very likely predates the hardening.

| Option | Description | Selected |
|--------|-------------|----------|
| Blanket rule: no timer callback may throw uncaught | Phase invariant: every setInterval/setTimeout callback in the gateway wraps socket calls so a throw can never escape | ✓ |
| Only the keep-alive path | Scope hardening narrowly to the keep-alive timer | |

**User's choice:** Blanket rule (D-11 phase invariant)
**Notes:** Diarization changes message volume and may add timers; the class-level rule is cheap insurance.

---

## Classification edge cases

| Option | Description | Selected |
|--------|-------------|----------|
| Punctuation + interrogative openers | Question if ends with '?' OR starts with who/what/when/where/why/how/which or an aux/modal (do/does/is/are/can/could/would/will/should/have); else Statement | ✓ |
| Punctuation only | Question only if ends with '?' | |
| You decide | Planner defines exact word list | (partial — word list left to Claude) |

**User's choice:** Punctuation + interrogative openers
**Notes:** '?' MUST count; borderline (e.g. polite-imperative "walk me through X") defaults to Statement by design. Exact opener/aux list is Claude's discretion.

| Option | Description | Selected |
|--------|-------------|----------|
| Question if ANY sentence is a question | Split into sentences; if any reads as a question, label the whole card a Question | ✓ |
| Classify by the last sentence | Use the final sentence's type | |
| Whole-utterance heuristic only | Run the check on the full utterance as one blob | |

**User's choice:** Question if ANY sentence is a question
**Notes:** Questions are the high-value signal — surface them rather than bury a mid-utterance question under a leading statement. Composes with "default Statement" (each per-sentence verdict defaults to Statement).

---

## Claude's Discretion

- Exact Deepgram finalization signal to key the commit on (is_final / speech_final / utterance_end) — research-time choice.
- The precise Deepgram diarization payload shape (per-word `speaker` index / utterance boundaries).
- The exact interrogative-opener / auxiliary-verb word list for classification.
- The concrete seam-extension shape (extend ISttTranscriptEvent vs a new sibling utterance event) — as long as the seam stays Deepgram-agnostic.

## Deferred Ideas

None — the discussion stayed within the phase's data/seam scope. (The card UI, Q/S visual styling, and people-list rendering are the already-planned Phase 9, not deferrals.)
