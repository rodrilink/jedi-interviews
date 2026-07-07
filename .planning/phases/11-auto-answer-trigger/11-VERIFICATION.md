---
phase: 11-auto-answer-trigger
verified: 2026-07-07T14:30:00Z
status: human_needed
score: 5/5 must-haves verified
overrides_applied: 0
human_verification:
  - test: "Live auto-answer in a meeting (SC 1 behavioral half): with a live Deepgram key + real meeting audio, ask a question aloud and confirm an auto answer streams into the AI panel with no keypress."
    expected: "A grounded answer appears token-by-token in the existing AI panel, badged 'auto', within a few seconds of the question being spoken — no hotkey pressed."
    why_human: "Requires a live Deepgram STT connection and real spoken audio; the full capture→classify→auto-trigger→stream path cannot be exercised without the running app and a live key. The automated half (orchestrator unit + CR-01 empty-buffer regression) is green."
  - test: "Live re-key survival (SC 1 / D-03 Pitfall 3): during a live session, save a new Deepgram key via Ctrl+Alt+S (Settings) so rekeyDeepgram runs, then ask a question and confirm an auto answer still streams."
    expected: "After the live re-key, a classified question still auto-triggers an answer into the panel — proving the re-key attach forwarded the live orchestrator, not a stale reference."
    why_human: "attachSttGatewayHandlers is module-private and constructs a real DeepgramSttGateway; there is no main-side test harness for index.ts. Re-key survival is verified structurally (both call sites, including the one inside rekeyDeepgram, forward the same aiOrchestrator parameter — confirmed by read/grep). The behavioral confirmation requires an on-machine re-key with live audio."
---

# Phase 11: Auto-Answer Trigger Verification Report

**Phase Goal:** Close the loop — when the live utterance stream classifies a turn as a question (the v1.1 QA-03 `classification: 'question'` tag), automatically enqueue an answer request into the Phase 10 priority queue so the same grounded answer content the manual `Ctrl+Alt+A` path produces (active Session Context + recent transcript span, AI-06) streams token-by-token into the existing AI panel — no keypress, no new panel, no new renderer→main control channel. The auto-trigger is a main-side wiring on the existing `gateway.on('utterance')` binding; it reuses the orchestrator, the grounding path, and the one-way `jedi:ai` push channel exactly as the manual path does.

**Verified:** 2026-07-07T14:30:00Z
**Status:** human_needed
**Re-verification:** No — initial verification (first VERIFICATION.md; a prior 11-REVIEW.md exists and its CRITICAL was fixed this session)

> **Mode note:** ROADMAP marks this phase `mode: mvp`, but the phase goal is a technical statement, not a User Story ("As a…, I want…, so that…"). The 5 ROADMAP Success Criteria are explicit, observable, and testable, so verification is performed goal-backward against those SCs (standard methodology) rather than a User Flow Coverage table. No scope was narrowed.

## Goal Achievement

### Observable Truths

| # | Truth (ROADMAP Success Criterion) | Status | Evidence |
| --- | --- | --- | --- |
| SC1 | A `classification: 'question'` utterance auto-enqueues an answer (no keypress) whose answer streams into the AI panel — verified live AND by a unit test | ✓ VERIFIED (automated) / ? human (live) | `index.ts:398-400` guards `classification === 'question'` → `aiOrchestrator.trigger('answer','auto',utterance.text)` inside the shared `attachSttGatewayHandlers`. Unit tests: `ai-orchestrator.test.ts:331` (one stream, non-empty span) + `:343`/`:356` (CR-01: still streams on an EMPTY buffer at trigger time). 47 orchestrator tests + 223 total pass. **Live-in-a-meeting half → human verification.** |
| SC2 | Auto answer = same content as manual `Ctrl+Alt+A`: same mode, model, grounded via the existing `assemblePrompt` path (AI-06), not a new prompt | ✓ VERIFIED | Auto and manual both enter the same `trigger('answer',…)` → `startRequest` → single `assemblePrompt({mode,span,context})` at `ai-orchestrator.ts:437`. `prompt-assembler.ts` untouched. Grounding-parity test `:407` asserts the auto `gateway.stream` request carries `model === ANSWER_MODEL` and byte-for-byte identical `system`/`userContent` vs the manual assembly. |
| SC3 | Answer streams token-by-token into the EXISTING AI panel via the same `jedi:ai` push + rendering; no new panel/surface | ✓ VERIFIED | No new IPC channel added; auto path drives the same orchestrator emitter and one-way `jedi:ai` push. Renderer `ai-panel.tsx` reuses the same `reduceEntries` + `renderEntryBody` streaming path; the D-04 badge (`:236-240`) is purely additive next to the mode label inside the single `card-ai-panel` section. No second AI surface. |
| SC4 | Statements never auto-trigger (only questions); detection introduces no per-utterance AI call | ✓ VERIFIED | Guard is strictly `classification === 'question'` (`index.ts:398`). `classifyUtterance` lives in `question-classifier.utility.ts` — a pure local heuristic; its only import is a type (`UtteranceClassification`), no network/AI call. Cost stays on answer generation only. |
| SC5 | Auto + manual coexist via the Phase 10 queue: manual `Ctrl+Alt+A` preempts queued autos; a burst is debounced + single-in-flight (no parallel calls) — with a real auto driver | ✓ VERIFIED | Manual handler `trigger('answer')` unchanged (`index.ts:153`). Preempt test `:430` (later manual runs ahead of two queued autos, no abort). Single-in-flight test `:450` (3 distinct auto questions → only one stream active at a time, count advances one-per-terminal, no abort). Content-dedup tests `:229-299` (distinct auto questions each answer; identical repeat collapses; keyless auto does not collide with the manual key space). |

**Score:** 5/5 truths verified in the codebase. SC1's live-in-a-meeting behavioral half is routed to human verification (the automated half holds).

### Required Artifacts

| Artifact | Expected | Status | Details |
| --- | --- | --- | --- |
| `src/main/ai/ai-orchestrator.ts` | Content-keyed auto-lane dedup + `source` on thinking/empty push; CR-01 guard fix | ✓ VERIFIED | `RequestSource` (`:94`); `IAiPushEvent` thinking (`:104`) + empty (`:109`) carry `source`; `burstKey` composite (`:291`) disjoint manual/auto namespaces; `trigger(mode,source,contentKey?)` (`:241`); **CR-01 fix `guardSource = span + contentKey` for auto (`:254`)**; WR-03 `source` on empty push (`:263`). |
| `src/main/index.ts` | Boot-reorder + auto-trigger threaded through both attach sites | ✓ VERIFIED | `new AiOrchestrator(` (`:499`) precedes `wireSttPipeline(` (`:512`); orchestrator threaded through `wireSttPipeline` params (`:237`) → boot attach (`:258-267`) AND re-key attach inside `rekeyDeepgram` (`:307-316`); auto-trigger in shared `on('utterance')` handler (`:398-400`). |
| `src/main/ai/ai-orchestrator.test.ts` | Auto-trigger dedup + grounding-parity + source + CR-01/WR-03 regression tests | ✓ VERIFIED | `describe('auto-trigger (AA-01/AA-02)')` (`:330`); CR-01 empty-buffer regression (`:343`,`:356`); guard-intact keyless (`:368`); WR-03 badge attribution (`:381`,`:394`); grounding parity (`:407`); preempt (`:430`); single-in-flight (`:450`). 47/47 pass. |
| `src/preload/index.ts` | `source` mirrored on thinking + empty variants; `RequestSource` exported | ✓ VERIFIED | `RequestSource` (`:95`); thinking (`:104`) + empty (`:109`) carry `source`. |
| `src/renderer/src/components/ai-panel.tsx` | `source` on entry + conditional auto badge, WR-03 empty carries source | ✓ VERIFIED | local `RequestSource` (`:11`); `IAiPanelEntry.source` (`:40`); `reduceEntries` sets `source: event.source` on thinking (`:91`) AND empty (`:100`, WR-03 — no longer hardcoded manual); badge on `entry.source === 'auto'` with `data-testid="icon-auto-badge"` (`:236-240`). |

### Key Link Verification

| From | To | Via | Status | Details |
| --- | --- | --- | --- | --- |
| `index.ts on('utterance')` | `aiOrchestrator.trigger('answer','auto',text)` | `classification === 'question'` guard | ✓ WIRED | `index.ts:398-400`, inside the shared `attachSttGatewayHandlers` (survives re-key). |
| `wireSttPipeline` | both `attachSttGatewayHandlers` call sites | `aiOrchestrator` parameter | ✓ WIRED | boot `:258-267` + re-key `:307-316`, same live reference. |
| gateway `commitPendingUtterance` | orchestrator guard | emit `'utterance'` before `'transcript'` | ✓ WIRED (CR-01 compensated) | `deepgram-stt.gateway.ts:358` emits utterance before transcript (`:362`) — the CR-01 root cause; `trigger` compensates via `guardSource = span + contentKey`. |
| orchestrator thinking/empty push | renderer badge | `source` on `IAiPushEvent` → `IAiPanelEntry.source` → `entry.source === 'auto'` | ✓ WIRED | Three structurally-identical `IAiPushEvent` copies aligned; renderer carries + renders. |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
| --- | --- | --- | --- | --- |
| `ai-panel.tsx` entries | `entries` (via `reduceEntries`) | `jedi:ai` push events from the orchestrator (`window.api.onAi` listener, `:169`) | Yes — real orchestrator pushes carry `source`, `text`, `mode` | ✓ FLOWING |
| auto answer content | `system`/`userContent` | `assemblePrompt` over `transcriptBuffer.recentSince` + active context (pull-on-run at `startRequest`) | Yes — real span + context, identical to manual (parity test) | ✓ FLOWING |
| auto badge | `entry.source` | `event.source` from thinking/empty push | Yes — `'auto'` for auto-triggered, `'manual'` otherwise | ✓ FLOWING |

### Behavioral Spot-Checks / Probe Execution

| Behavior | Command | Result | Status |
| --- | --- | --- | --- |
| Orchestrator suite (auto-trigger, CR-01, WR-03, parity, preempt, single-in-flight) | `npx vitest run src/main/ai/ai-orchestrator.test.ts` | 47 passed | ✓ PASS |
| Full test suite | `npx vitest run` | 24 files / 223 passed | ✓ PASS |
| Typecheck (node + web) | `npm run typecheck` | exit 0 | ✓ PASS |
| Lint | `npm run lint` | exit 0 (warnings only, pre-existing test optional-chaining) | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
| --- | --- | --- | --- | --- |
| AA-01 | 11-01, 11-02 | Classified question auto-generates the same grounded answer as manual Ctrl+Alt+A, no keypress | ✓ SATISFIED | SC1 + SC2 + SC4 evidence above; auto-trigger wiring + grounding parity + local classification guard. |
| AA-02 | 11-01, 11-02 | Auto answer streams into the existing AI panel (same surface/rendering), not a new panel | ✓ SATISFIED | SC3 evidence; same `jedi:ai` push + `reduceEntries`/`renderEntryBody`, additive badge only. |

REQUIREMENTS.md maps AA-01 and AA-02 to Phase 11 exclusively; both plans declare `requirements: [AA-01, AA-02]`. No orphaned or unaccounted requirement IDs for this phase.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| --- | --- | --- | --- | --- |
| `index.ts` | 151 | Stale comment "single-in-flight cancel on re-press (D-06)" (IN-02) — v1.2 no longer cancels | ℹ️ Info | Doc-only; code is correct (queue-and-drain). Adjacent to the auto path; misleading but non-functional. |
| `index.ts` | 341-362 | Duplicated `@param` block in `attachSttGatewayHandlers` TSDoc (IN-01) | ℹ️ Info | Doc-only; harmless, will trip doc generators. |
| 3 files | — | Hand-maintained `IAiPushEvent`/`RequestSource` duplicated across main/preload/renderer (IN-03) | ℹ️ Info | Currently aligned + typecheck-green; drift risk only. Sandbox-bundling rationale documented. |

No `TBD`/`FIXME`/`XXX` debt markers in the modified files. No stubs, empty implementations, or hardcoded-empty data on the goal path.

### Assessment of Prior Code-Review Findings (11-REVIEW.md)

| Finding | Severity | Disposition |
| --- | --- | --- |
| CR-01 — empty-span guard drops the first question of every session | CRITICAL | **FIXED** — `guardSource = span + contentKey` for auto (`ai-orchestrator.ts:254`) + regression tests (`:343`,`:356`). Root cause (gateway emit order) confirmed unchanged at `deepgram-stt.gateway.ts:358-362`; the orchestrator now compensates. Not a gap. |
| WR-03 — empty auto placeholder loses its `auto` badge | WARNING | **FIXED** — `source` on empty push (all three copies) + `reduceEntries` empty branch uses `event.source` (renderer `:100`) + tests (`:381`,`:394`). Not a gap. |
| WR-01 — content dedup is a same-tick 200ms burst guard only | WARNING | **Acceptable known-limitation.** Cost bounding (SC5/AA-06) is met by single-in-flight + `MAX_PENDING_QUEUE` cap + drop-oldest-auto eviction, not the 200ms window. Turn-to-turn duplicate suppression is explicitly out of scope. Not goal-blocking. |
| WR-02 — no integration test over the real `attachSttGatewayHandlers` wiring | WARNING | **Acceptable.** Wiring verified structurally (both call sites forward the live orchestrator, confirmed by read); the CR-01 regression test now exercises the exact empty-buffer emit-ordering the real wiring produces. Full behavioral coverage is the SC1 live-in-a-meeting human item. Not goal-blocking. |
| IN-01/IN-02/IN-03 | INFO | Doc/comment/type-drift cleanups; non-blocking. |

### Human Verification Required

1. **Live auto-answer in a meeting (SC1 behavioral half)** — ask a question aloud with a live Deepgram key; confirm a grounded answer streams into the AI panel, badged `auto`, with no keypress. Why human: needs a live STT connection + real spoken audio.
2. **Live re-key survival (SC1 / D-03 Pitfall 3)** — save a new Deepgram key mid-session (Ctrl+Alt+S) to run `rekeyDeepgram`, then ask a question; confirm an auto answer still streams. Why human: `attachSttGatewayHandlers` is module-private and builds a real gateway; re-key survival is verified structurally in code, behavioral confirmation needs on-machine re-key with live audio.

### Gaps Summary

No goal-blocking gaps. All 5 ROADMAP success criteria and both requirements (AA-01, AA-02) are satisfied in the codebase. The prior CRITICAL (CR-01) and the badge-attribution WARNING (WR-03) are both fixed and covered by new regression tests; 223 tests pass, typecheck and lint exit 0. The two remaining WARNINGs from code review (WR-01 dedup window, WR-02 integration-test coverage) are assessed as acceptable known-limitations that do not block the goal. The only outstanding items are the two live, on-machine behavioral confirmations for SC1 (auto-answer + re-key survival), which cannot be automated and are routed to human verification — the automated halves hold.

---

_Verified: 2026-07-07T14:30:00Z_
_Verifier: Claude (gsd-verifier)_
