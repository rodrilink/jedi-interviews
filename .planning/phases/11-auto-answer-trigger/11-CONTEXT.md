# Phase 11: Auto-Answer Trigger - Context

**Gathered:** 2026-07-07
**Status:** Ready for planning

<domain>
## Phase Boundary

Close the auto-answer loop: when the live utterance stream tags a committed turn as `classification: 'question'` (the v1.1 QA-03 local heuristic), automatically enqueue an **answer** request into the Phase 10 priority queue — `aiOrchestrator.trigger('answer', 'auto')` — so the same grounded answer content the manual `Ctrl+Alt+A` path produces (active Session Context + recent transcript span, AI-06) streams token-by-token into the **existing** AI panel. No keypress, no new panel, no new renderer→main control channel. Requirements: **AA-01, AA-02**.

**In scope:** the main-side auto-trigger wiring on the existing `gateway.on('utterance')` binding; feeding the Phase 10 `'auto'` lane; reconciling Phase 10's mode-keyed burst debounce so distinct questions each answer (see D-01); a **minimal** `source` annotation on the `jedi:ai` push so the renderer can show a tiny "auto" badge (see D-04). Reuses the orchestrator, the `assemblePrompt` grounding path, and the one-way `jedi:ai` push exactly as the manual path does.

**Out of scope (later phases):** the 3-state scope hotkey and the local "directed-at-me" heuristic (Phase 12 — default scope is **All** here, so the debounce/queue must already be doing real cost-control work); any change to question *detection* (it stays local/no-AI, consuming the existing QA-03 classification — question detection introduces NO per-utterance AI call); talking-points / code-challenge auto-triggering (only `answer` mode auto-fires).

</domain>

<decisions>
## Implementation Decisions

### De-dup for distinct questions (the behavioral crux)
- **D-01:** **Each distinct question gets its own answer.** Phase 10's D-06 burst debounce collapses same-**mode** requests within a window — but every auto-answer is mode `answer`, so a naive mode-keyed collapse would silently drop a fast follow-up question. The auto path must de-dup on **question content** (same/near-identical utterance text within the window collapses; two genuinely different questions each answer, subject to the single-in-flight queue + bounded cap for cost control). The planner MUST reconcile this with Phase 10's mode-keyed D-06 debounce — likely by carrying the question text (or a content key) on the auto enqueue so the dedup can compare content, not just mode. Cost stays bounded by the queue's single-in-flight gate + bounded cap (D-08 Phase 10) + the future Off mode (Phase 12), NOT by collapsing distinct questions.

### Which utterances fire
- **D-02:** **Fire on any `classification: 'question'`, both speaker kinds.** Both diarized (`Person N`) turns and the neutral `'Speaker'` bucket trigger — maximizes recall so a question isn't missed during a non-diarized span (common early in a loopback session). `statement` never fires (SC 4). Utterances are already committed/final at the `on('utterance')` emit point, so no extra final-only guard is needed. Self-authored questions are moot (loopback only, no mic).

### Trigger wiring seam
- **D-03:** **Reorder boot construction so the orchestrator exists before `wireSttPipeline`.** Today `wireSttPipeline` (index.ts:404) runs before the orchestrator is constructed (index.ts:414), and the `on('utterance')` binding lives inside `attachSttGatewayHandlers` (index.ts:357). Move orchestrator construction ahead of `wireSttPipeline` so the utterance binding can close over the orchestrator directly and call `trigger('answer', 'auto')` on a `question`. The planner MUST verify: (a) the boot sequence invariants still hold (dotenv load → `ApiKeyStoreService` → orchestrator deps: gateway/history/context provider/capture closure — all must be constructible before STT wiring), and (b) the **live re-key path** re-attaches the binding correctly (Pitfall 3 — a re-keyed socket must still auto-trigger, not emit to a dead closure). No new renderer→main channel.

### Auto-answer visibility
- **D-04:** **Tiny "auto" badge in the SAME AI panel.** Add a `source: RequestSource` (`'manual' | 'auto'`) field to the `jedi:ai` push payload (the `IAiPushEvent` `thinking` variant already carries `mode`/`id`/`requestId` — `source` rides alongside it, set from the running item's `source`) and a **minimal** renderer read that renders a small `auto` tag/dot on that entry. Same panel, same streaming render, no layout or behavior change — SC 3's "same rendering" is preserved (it is still the same stream, just annotated). This is the only renderer-touching change in the phase; keep it as small as possible. A manual answer carries `source: 'manual'` and shows no badge (or the absence is the manual state).

### Claude's Discretion
- The exact content-dedup mechanism for D-01 (normalized-text equality vs. a short hash vs. a trimmed prefix key) and how it threads onto the enqueue path — as long as distinct questions each answer and an identical repeated question within the window collapses.
- The precise boot-reorder shape in D-03 (move the whole AI-stack construction block up vs. construct just the orchestrator early and thread it in) — as long as both invariants in D-03 hold.
- The exact renderer badge styling for D-04 (text tag vs. dot vs. icon), within "tiny, same panel, no layout change."
- Whether the auto enqueue passes the utterance text via an extended `trigger` signature or a sibling method — planner's call, provided the manual `trigger(mode)` call sites in index.ts stay behavior-identical (Phase 10 D-10).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements & roadmap
- `.planning/REQUIREMENTS.md` — **AA-01** (auto-answer on detected questions, grounded like the manual path, into the existing panel) and **AA-02** (reuse the AI orchestrator + grounding path; no new prompt/panel). Milestone v1.2 section.
- `.planning/ROADMAP.md` §"Phase 11: Auto-Answer Trigger" — the 5 success criteria + threat model (constraint reversal, answer spam/cost, grounding drift, false-positive questions, key-adjacent leakage). This CONTEXT resolves the HOW-gray-areas the ROADMAP left open.
- `.planning/phases/10-priority-answer-queue/10-CONTEXT.md` — the queue this phase FEEDS. The `'auto'` lane (D-05), `source: 'manual' | 'auto'` discriminator (already built), single-in-flight gate (D-07), bounded cap + drop-oldest-auto eviction (D-08), silent eviction (D-09), and — critically — the mode-keyed burst debounce D-06 that Phase 11's D-01 must reconcile against.

### Code being wired (READ before planning)
- `src/main/index.ts` — the wiring owner. `attachSttGatewayHandlers` (~line 334) holds the `gateway.on('utterance')` binding (~line 357); `wireSttPipeline` (~line 404) is called BEFORE orchestrator construction (~line 414). D-03 reorders this. Note the re-key re-attach path (second `attachSttGatewayHandlers` call site ~line 294 — Pitfall 3).
- `src/main/ai/ai-orchestrator.ts` — `trigger(mode, source = 'manual')` (~line 231) is the enqueue entry point Phase 11 calls with `'auto'`. The `IAiPushEvent` union (~line 103) — the `thinking` variant is where D-04's `source` field rides. The `enqueue`/burst-debounce path (~line 263, D-06) is what D-01 must reconcile. `RequestSource` type (~line 94), `IQueuedRequest`/`IActiveRequest` shapes carry `source`.
- `src/main/stt/stt-provider.interface.ts` — `IUtteranceEvent` (`text`, `speaker`, `isDiarized`, `classification`) and `UtteranceClassification = 'question' | 'statement'` (~line 44). The `classification === 'question'` check is the trigger condition (D-02).
- `src/main/ai/prompt-assembler.ts` — `assemblePrompt` + `RECENT_SPAN_MS` (grounding is UNCHANGED, AI-06/SC 2; the auto path assembles through this exact path when it RUNS — pull-on-run, same as manual).
- The renderer AI-panel component that consumes `jedi:ai` / renders answer entries — the single minimal touch point for D-04's badge (planner: locate via the `jedi:ai` listener in `src/preload` / `src/renderer`).

### v1 constraint reversal context
- `.planning/PROJECT.md` §"Current Milestone: v1.2" — records that v1.2 **deliberately reverses** "AI calls are user-triggered only" (supersedes AI-V2-01). Phase 11 is where the reversal becomes user-observable; cost is bounded by debounce + single-in-flight + the future Off mode, not by a keypress.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `AiOrchestrator.trigger(mode, source = 'manual')` — Phase 10 already added the `source` param defaulting to `'manual'`; Phase 11 calls `trigger('answer', 'auto')`. The `'auto'` lane, eviction, and single-in-flight gate already exist and are unit-tested — Phase 11 supplies the missing real auto SOURCE.
- `IAiPushEvent.thinking` variant — already carries `mode`/`id`/`requestId`/`at`; `source` is a natural sibling field for the D-04 badge.
- The `gateway.on('utterance')` binding + shared `utterances` list — the exact stream to tap; the binding already fires once per committed, classified turn (QA-01/D-01).
- `assemblePrompt` pull-on-run grounding — reused byte-for-byte; guarantees D-01 (Phase 11 SC 2) grounding parity with the manual path.

### Established Patterns
- **Closures threaded from the entry point** (D-03) — `pushAi`, the context provider, and the capture closure were all threaded into the orchestrator as closures from `index.ts` (no service-locator mid-method). The auto-trigger follows the same shape: bind the orchestrator at the entry point and close over it in the utterance handler.
- **Single-in-flight + `requestId` guard (Pitfall 1 / Phase 10 D-11)** — load-bearing; the auto path drives the same gateway emitter, so the monotonic-id guard already protects it. No new call site → the sanitize-error + main-only-key discipline (threat model) already covers auto.
- **Re-key re-attach (Pitfall 3)** — `attachSttGatewayHandlers` is re-invoked on live re-key; the auto binding MUST survive re-attach (D-03 verification item).

### Integration Points
- `src/main/index.ts` `app.whenReady()` block — the boot sequence D-03 reorders. The single place the orchestrator, STT pipeline, and utterance binding all live.
- `IAiPushEvent` → preload → renderer AI panel — the one-way channel that gains a `source` field (D-04); the renderer's existing `jedi:ai` listener is the single minimal edit.

</code_context>

<specifics>
## Specific Ideas

- **Acceptance demo (SC 1/5):** feed a `classification: 'question'` `IUtteranceEvent` through the wired binding and observe an answer request enqueued into the `'auto'` lane with no keypress; feed a `statement` and observe NO enqueue. Then: with auto-answers queued, a manual `Ctrl+Alt+A` still preempts them, and a burst of DISTINCT detected questions each answer (single-in-flight, no parallel calls) while an identical repeated question collapses — proving D-01 reconciled against Phase 10's D-06.
- **Grounding-parity assertion (SC 2):** a test asserts the auto request carries the same mode (`answer`), model, and grounding shape (active context + `RECENT_SPAN_MS` span via `assemblePrompt`) as a manual answer.
- **D-04 is intentionally the ONLY renderer touch** — everything else is main-side wiring, matching the ROADMAP's framing.

</specifics>

<deferred>
## Deferred Ideas

- **3-state scope hotkey (All → Directed-at-me → Off) + local directed-at-me heuristic** — Phase 12. Phase 11 hard-codes default scope = All; the debounce/queue must already bound cost without the gate.
- **Auto-answering talking-points / code-challenge modes** — only `answer` auto-fires in v1.2; auto talking-points would be a future consideration, not this milestone.
- **Richer auto-vs-manual distinction** — D-04 keeps the badge tiny/minimal. A more prominent treatment (grouping, filtering, dismissing auto answers) is a future UI pass if the minimal badge proves insufficient.
- **Explicit cancel key** (carried from Phase 10 deferred) — still relevant once auto-answers make in-flight streams more frequent; reuses the dormant abort machinery (Phase 10 D-12). Not in v1.2.

</deferred>

---

*Phase: 11-auto-answer-trigger*
*Context gathered: 2026-07-07*
