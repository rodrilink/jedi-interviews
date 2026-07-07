---
phase: 11-auto-answer-trigger
plan: 01
subsystem: ai
tags: [electron, ai-orchestrator, auto-answer, deepgram, priority-queue, debounce]

# Dependency graph
requires:
  - phase: 10-priority-answer-queue
    provides: two-lane priority queue, RequestSource, single-in-flight gate, mode-keyed burst debounce (D-06), bounded cap + drop-oldest-auto eviction
  - phase: 08-diarized-utterance-pipeline
    provides: IUtteranceEvent with classification (question/statement), the on('utterance') seam, re-key attach helper
  - phase: 05-ai-orchestration
    provides: assemblePrompt pull-on-run grounding, ANSWER_MODEL, the jedi:ai push chain
provides:
  - Main-side auto-answer trigger — a classified-question utterance auto-enqueues a grounded answer into the 'auto' lane with no keypress
  - Content-keyed auto-lane burst dedup reconciling Phase 10's mode-keyed D-06 (distinct questions each answer; identical repeat collapses)
  - source field on the thinking push (main-side half of the auto badge; renderer badge lands in Plan 02)
  - Boot-reorder so the orchestrator is constructed before wireSttPipeline (D-03) with re-key survival
affects: [11-02-auto-answer-badge, phase-12-off-directed-mode]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Composite burst-collapse key: manual keys on bare mode; auto keys on `mode#auto <normalized-content>` in a disjoint namespace"
    - "Orchestrator threaded through wireSttPipeline into BOTH attachSttGatewayHandlers call sites (boot + re-key) for Pitfall-3 re-attach survival"

key-files:
  created: []
  modified:
    - src/main/ai/ai-orchestrator.ts
    - src/main/ai/ai-orchestrator.test.ts
    - src/main/index.ts
    - src/preload/index.ts
    - src/renderer/src/components/ai-panel.tsx

key-decisions:
  - "D-01 reconcile: burstTimers keyed on a composite string, not the bare AiMode. Manual stays mode-only (byte-for-byte Phase 10); auto composes mode#auto + normalized (trim/lowercase/collapse-whitespace) content."
  - "Keyless auto (contentKey undefined) falls back to a defined `<no-content>` sentinel INSIDE the #auto namespace, so it never collides with the manual bare-mode key."
  - "Boot-reorder moves the whole AI-stack block above wireSttPipeline (D-04 discretion: simplest over late-bound ref); orchestrator threaded as a wireSttPipeline parameter and forwarded to both attach sites."
  - "source field added ONLY to the thinking push variant across all three IAiPushEvent duplicates (main/preload/renderer); renderer badge rendering deferred to Plan 02."

patterns-established:
  - "Content-aware debounce collapse for a mode that always shares one AiMode (auto answers) via a composite Map key + a disjoint source namespace."

requirements-completed: [AA-01, AA-02]

# Metrics
duration: 9min
completed: 2026-07-07
---

# Phase 11 Plan 01: Auto-Answer Trigger (Main Side) Summary

**A classified-question utterance now auto-enqueues a grounded answer into the Phase-10 'auto' lane with no keypress — reusing the exact assemblePrompt/ANSWER_MODEL path as the manual Ctrl+Alt+A, with content-keyed burst dedup and a source-carrying thinking push.**

## Performance

- **Duration:** ~9 min
- **Started:** 2026-07-07T18:04:57Z
- **Completed:** 2026-07-07T18:13:32Z
- **Tasks:** 3
- **Files modified:** 5

## Accomplishments
- Reconciled Phase 10's mode-keyed burst debounce (D-06) into a composite content-aware key (D-01): two distinct question texts each answer; an identical repeated question within the burst window collapses to one; manual mode-only collapse is preserved byte-for-byte; a keyless auto never collides with the manual key space.
- Added `source: RequestSource` to the `thinking` push variant (D-04) and mirrored it across all three structural `IAiPushEvent` duplicates (main/preload/renderer) so the renderer badge (Plan 02) can distinguish auto vs manual.
- Applied the D-03 boot-reorder (orchestrator constructed before `wireSttPipeline`) and threaded the live orchestrator through both `attachSttGatewayHandlers` call sites — the boot attach and the re-key attach — so a re-keyed Deepgram socket still auto-triggers against the live reference (Pitfall 3).
- Wired the auto-trigger inside the shared `on('utterance')` handler: `classification === 'question'` fires `trigger('answer', 'auto', utterance.text)`; statements never fire; manual path unchanged.

## Task Commits

Each task was committed atomically:

1. **Task 1 (RED): failing auto-lane dedup + source tests** - `49820e4` (test)
2. **Task 1 (GREEN): content-keyed dedup + source on thinking push** - `720a0e9` (feat)
3. **Task 2: boot-reorder + auto-trigger wiring in index.ts** - `b13140a` (feat)
4. **Task 3: auto-trigger integration + grounding-parity tests** - `ab5a4a9` (test)

_Task 1 followed TDD (RED test commit → GREEN implementation commit). Task 2's verification is structural (typecheck + grep) — no main-side test harness exists for index.ts. Task 3 is test-only._

## Files Created/Modified
- `src/main/ai/ai-orchestrator.ts` - Composite `burstKey` (manual mode-only vs auto mode#auto+content), `trigger`/`enqueue` extended with optional `contentKey`, `burstTimers` re-keyed to `Map<string, …>`, `source` added to the thinking push variant + both `pushAi` thinking calls.
- `src/main/index.ts` - AI-stack construction moved above `wireSttPipeline` (D-03); `aiOrchestrator` threaded through `wireSttPipeline` into both attach sites; auto-trigger added to the shared `on('utterance')` handler.
- `src/preload/index.ts` - Added `RequestSource` type + `source` field on the thinking variant (structural mirror).
- `src/renderer/src/components/ai-panel.tsx` - Added `RequestSource` type + `source` field on the thinking variant (structural mirror; rendering deferred to Plan 02).
- `src/main/ai/ai-orchestrator.test.ts` - New `content-keyed auto-lane dedup (D-01)`, `source on the thinking push (D-04)`, and `auto-trigger (AA-01/AA-02)` describe blocks (dedup, keyless-auto isolation, source parity, SC1/SC2/SC5).

## Decisions Made
- Chose a single composite-string `Map` key over a second parallel timer map — simplest, keeps one eviction/cleanup path, and makes the manual/auto disjointness explicit in `burstKey`.
- Normalized the auto content key (trim + lowercase + inner-whitespace collapse) so trivially-different renderings of the same question still collapse within the burst window.
- Moved the whole AI-stack block up (D-04 discretion) rather than late-binding a ref — matches the plan's preferred approach and keeps every orchestrator dep constructed before STT wiring.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Mirrored the `source` field into the preload + renderer `IAiPushEvent` duplicates**
- **Found during:** Task 1 (source on the thinking push)
- **Issue:** `IAiPushEvent` is structurally duplicated in three separately-bundled locations (main/preload/renderer). Adding `source` only to main would leave the preload + renderer copies structurally divergent; `npm run typecheck` runs all three tsconfig projects and the acceptance criterion requires it to exit 0.
- **Fix:** Added a `RequestSource` type + the `source: RequestSource` field on the `thinking` variant in `src/preload/index.ts` and `src/renderer/src/components/ai-panel.tsx`, keeping all three declarations structurally identical. No rendering logic added (badge deferred to Plan 02 per PATTERNS.md).
- **Files modified:** src/preload/index.ts, src/renderer/src/components/ai-panel.tsx
- **Verification:** `npm run typecheck` exits 0 (both node + web projects); full suite 218/218 green.
- **Committed in:** `720a0e9` (Task 1 GREEN commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** The mirror was anticipated by PATTERNS.md ("add it in ALL THREE locations"); required for typecheck parity across the process boundary. No scope creep — rendering deferred to Plan 02 as planned.

## Issues Encountered
- Prettier's repo-wide format:check flags ~30 pre-existing non-conformant files. Applied prettier only to the files I edited. One pre-existing test line (`report-don't-throw`) that prettier wanted to re-quote was reverted in the Task 2 step to keep that commit scoped to index.ts; it was subsequently normalized in the Task 3 test commit along the file. All out-of-scope repo-wide format issues were left untouched (SCOPE BOUNDARY).

## Manual verification

**Live re-key check (ROADMAP SC1 — behavioral half, NOT yet run by a human):** With a live session, trigger a Deepgram re-key (save a new key via Ctrl+Alt+S / Settings so `rekeyDeepgram` runs), then produce a classified question in the meeting audio and confirm an auto answer still streams into the AI panel. This proves the re-key path re-attached the LIVE orchestrator, not a stale reference (D-03 Pitfall 3). This check requires a live Deepgram key + real meeting audio and could not be automated — `attachSttGatewayHandlers` is module-private and constructs a real `DeepgramSttGateway`, so re-key survival was verified STRUCTURALLY here (both call sites, including the one inside `rekeyDeepgram`, forward the same `aiOrchestrator` parameter — confirmed by grep). The live behavioral confirmation remains for on-machine UAT.

## Known Stubs
None — no stubs introduced. The renderer `source` field is a declared, populated type field (main pushes it); only the badge *rendering* is deferred to Plan 02, which is scoped by design (PATTERNS.md), not a stub.

## Next Phase Readiness
- Plan 02 (renderer auto badge) can consume the `source` field now present on every `thinking` push.
- Phase 12 (Off / directed-at-me mode) is the user escape hatch for the deliberate "AI calls user-triggered only" reversal (T-11-01, accept-by-design). Cost stays bounded by the Phase-10 debounce + single-in-flight + bounded cap until then.
- Outstanding: the live re-key behavioral UAT above.

## Self-Check: PASSED

- Files verified present: 11-01-SUMMARY.md, src/main/ai/ai-orchestrator.ts, src/main/index.ts
- Commits verified: 49820e4, 720a0e9, b13140a, ab5a4a9
- Full test suite: 218/218 green (24 files); `npm run typecheck` exits 0

---
*Phase: 11-auto-answer-trigger*
*Completed: 2026-07-07*
