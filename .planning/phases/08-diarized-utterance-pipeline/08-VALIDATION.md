---
phase: 8
slug: diarized-utterance-pipeline
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-06
---

# Phase 8 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest (existing — `deepgram-stt.gateway.test.ts` + `transcript-buffer.test.ts` present; `FakeV1Socket` harness reusable) |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run src/main/stt/<file>.test.ts` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~15 seconds (unit-only, no live socket) |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run src/main/stt/<touched-file>.test.ts`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 20 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| TBD | 01 | 1 | QA-03 | — | Local heuristic; no AI call; default Statement | unit | `npx vitest run src/main/stt/question-classifier.utility.test.ts` | ❌ W0 | ⬜ pending |
| TBD | 01 | 1 | QA-02 | V5 | Modal per-word speaker index; undefined when no diarization | unit | `npx vitest run src/main/stt/speaker-map.test.ts` | ❌ W0 | ⬜ pending |
| TBD | 01 | 1 | QA-02 / D-04 / D-05 | — | First-seen→Person N stable; neutral bucket excluded; clear() resets | unit | `npx vitest run src/main/stt/speaker-map.test.ts` | ❌ W0 | ⬜ pending |
| TBD | 01 | 1 | QA-01 | V5 | Accumulate `is_final` runs, commit on `speech_final`; `UtteranceEnd` fallback; no double-commit | unit | `npx vitest run src/main/stt/utterance-accumulator.utility.test.ts` | ❌ W0 | ⬜ pending |
| TBD | 02 | 2 | QA-01 / QA-07 | V5 | `diarize`+`utterance_end_ms` on connect; message-type switch; `utterance` seam emission | unit | `npx vitest run src/main/stt/deepgram-stt.gateway.test.ts` | ⚠️ extend | ⬜ pending |
| TBD | 02 | 2 | QA-07 | — | No `@deepgram/sdk` import outside the gateway | unit + grep | `rg "@deepgram/sdk" src --files-with-matches` (gateway only) | ⚠️ manual grep | ⬜ pending |
| TBD | 02 | 2 | D-11 | V7 | Keep-alive tick while socket not open does NOT throw/crash | unit | `npx vitest run src/main/stt/deepgram-stt.gateway.test.ts` | ✅ (`:274`) | ⬜ pending |
| TBD | 02 | 2 | D-11 / T-4-04 | V5 | Defensive parse: malformed/partial diarized payload never throws | unit | `npx vitest run src/main/stt/deepgram-stt.gateway.test.ts` | ⚠️ extend | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*
*Task IDs are assigned by the planner; this map is keyed by requirement + behavior until PLAN.md sets them.*

---

## Wave 0 Requirements

- [ ] `src/main/stt/question-classifier.utility.test.ts` — QA-03 (D-07 `?`/opener rules, D-08 multi-sentence Question-if-any, borderline→Statement)
- [ ] `src/main/stt/speaker-map.test.ts` — QA-02 + D-04 (neutral bucket excluded) + D-05 (`clear()` resets numbering), modal per-word index
- [ ] `src/main/stt/utterance-accumulator.utility.test.ts` — QA-01 (accumulate `is_final` runs, commit on `speech_final`, `UtteranceEnd` fallback, empty-commit no-op / no-double-commit)
- [ ] Extend `src/main/stt/deepgram-stt.gateway.test.ts` — diarized-payload parse, `UtteranceEnd`/message-type discrimination, `utterance` seam emission (keep-alive regression already present at `:274`)
- [ ] No framework install needed — Vitest + `FakeV1Socket` harness already exist and are reusable

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| nova-3 actually populates per-word `speaker` + `?` terminal punctuation on the live socket | QA-01/QA-02/QA-03 | Requires a live Deepgram connection with 2+ real speakers; cannot be asserted from unit tests against `FakeV1Socket` | With a real key, run a session with two speakers; enable the one-time key-redacted debug raw-payload log; confirm `words[].speaker` present and interrogatives end with `?`. Lock the parse only after this confirms. |
| Ctrl+Alt+K resets `Person N` numbering in a live session | QA-02/D-05 | End-to-end hotkey → main → overlay path is not unit-covered | Start session, let ≥2 people speak (Person 1/Person 2 appear), press Ctrl+Alt+K, confirm next utterance restarts at Person 1. |
| Discrete per-speaker utterances reach the overlay (not one concatenated blob) | QA-01 | Overlay push channel is a live-integration surface | Observe separate utterance events rendering as distinct live→finalized items during a real session. |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (3 new util test files + 1 gateway-test extension)
- [ ] No watch-mode flags (`vitest run`, never `vitest --watch`)
- [ ] Feedback latency < 20s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
