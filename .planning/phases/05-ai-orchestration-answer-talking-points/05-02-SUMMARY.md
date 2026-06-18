---
phase: 05-ai-orchestration-answer-talking-points
plan: 02
subsystem: ai
tags: [anthropic, claude, talking-points, hotkeys, electron-ipc, react]

# Dependency graph
requires:
  - phase: 05-ai-orchestration-answer-talking-points
    plan: 01
    provides: AiOrchestrator.trigger(mode), TALKING_POINTS_SYSTEM_PROMPT + assemblePrompt, AiHistory.clear()/snapshot(), IAiPushEvent union + jedi:ai channel + onAi bridge, always-on AiPanel, HOTKEY_CHORDS discrete-chord pattern, two-column overlay layout
provides:
  - Ctrl+Alt+T talking-points chord wired to aiOrchestrator.trigger('talking-points') (claude-opus-4-8 via per-mode constant)
  - Ctrl+Alt+G clear-AI chord wired to aiHistory.clear() + a new `cleared` IAiPushEvent that resets the renderer panel
  - `cleared` variant added to IAiPushEvent (orchestrator canonical / preload / renderer) + reduceEntries reset-to-empty case
  - Talking-points + Clear-AI rows in the HUD cheat-sheet
  - Talking-points prompt characterization assertions (D-12 wording, D-13 empty-context for both modes)
affects: [05-03-streaming-render-scroll-cancel]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Clear-panel as an explicit additive IAiPushEvent variant (`cleared`) the renderer reduces to [], rather than a history-snapshot (deferred to 05-03)"
    - "New mode/clear chords as additional HOTKEY_CHORDS rows with a pending-conflict-test inline note (mirrors clear-transcript / ai-answer)"

key-files:
  created:
    - .planning/phases/05-ai-orchestration-answer-talking-points/05-02-SUMMARY.md
  modified:
    - src/main/ai/prompt-assembler.test.ts
    - src/main/ai/ai-orchestrator.ts
    - src/main/hotkey-registrar.service.ts
    - src/main/index.ts
    - src/preload/index.ts
    - src/renderer/src/components/debug-hud.tsx
    - src/renderer/src/components/ai-panel.tsx
    - .planning/phases/05-ai-orchestration-answer-talking-points/deferred-items.md

key-decisions:
  - "Clear-AI panel-reset uses a new `cleared` IAiPushEvent variant (added to all three union declarations + a reduceEntries case returning []) instead of the plan's pseudo-coded `{ type: 'history-snapshot', entries }` — that variant does not exist in the 05-01 union and the renderer has no reducer case for it, so following the literal pseudo-code would push an event the renderer silently ignores and the panel would NOT clear (breaking must-have D-02). The `cleared` signal is the minimal addition consistent with the current renderer contract; the full bounded history-snapshot reconciliation push remains 05-03 scope (pushHistorySnapshot stays a no-op)."
  - "Talking-points DRAFT system prompt wording from 05-01 already satisfies D-12 (3-5 short bullets, project-work focus, `- ` prefix); no refinement was forced. Characterization assertions pin that shape so a future wording change cannot silently drop a D-12 property."
  - "New chord letters: T (talking-points) and G (clear-AI). G chosen because K already clears the transcript; both are OUTSIDE the 02-03 locked conflict-tested set and carry the pending-conflict-test inline note. The on-machine Teams/Zoom/VS Code re-check is the blocking Task 2 checkpoint."

requirements-completed: [AI-02]

# Metrics
duration: 11min
completed: 2026-06-18
---

# Phase 5 Plan 02: Talking-Points Mode + Clear-AI Chord Summary

**Ctrl+Alt+T now drives a second AI mode — 3-5 project-work talking-point bullets routed to claude-opus-4-8 through the existing single-in-flight orchestrator — and Ctrl+Alt+G clears the AI panel via a new `cleared` push event, with both chords listed in the HUD cheat-sheet and pending an on-machine conflict re-check (the blocking checkpoint).**

> STATUS: The build task (Task 1) is complete and committed. The final task is a BLOCKING human-verify checkpoint requiring on-machine conflict testing (Teams/Zoom/VS Code) of the new chords plus live talking-points/clear verification — none of which is unit-testable (the overlay is `focusable:false` and OS chord capture/live streaming cannot be asserted in a headless suite). Execution is PAUSED at that checkpoint awaiting the user's "approved" signal and the conflict-test outcome. STATE.md/ROADMAP.md are intentionally NOT modified (orchestrator owns those post-wave).

## Performance
- **Duration:** ~11 min (build task)
- **Tasks:** 1 build task complete (Task 1); 1 BLOCKING human-verify checkpoint pending
- **Files modified/created:** 8

## Accomplishments
- Extended `prompt-assembler.test.ts` with talking-points cases (suite now 9/9 green): per-mode prompt selection, span embedding under the labeled header for talking-points, D-12 wording characterization (3-5 bullets, `- ` prefix, project-work focus), and D-13 empty-context for talking-points mode.
- Added two HOTKEY_CHORDS rows — `ai-talking-points` (Ctrl+Alt+T) and `clear-ai` (Ctrl+Alt+G) — each with the pending-conflict-test inline note.
- Wired `buildHandlers`: `ai-talking-points` → `aiOrchestrator.trigger('talking-points')`; `clear-ai` → `aiHistory.clear()` then `pushAi(window, { type: 'cleared' })`.
- Added a `cleared` variant to `IAiPushEvent` in all three declarations (orchestrator canonical, preload, renderer) plus a `reduceEntries` `cleared` case that resets the panel to `[]`.
- Added `Talking points` (Ctrl+Alt+T) and `Clear AI` (Ctrl+Alt+G) rows to the HUD `HOTKEY_CHEAT_SHEET`.
- Full unit suite green (102 tests, no regressions); `npm run lint` (oxlint) clean.

## Task Commits
1. **Task 1: Talking-points prompt assertions + clear-AI-history wiring** — `d19b93b` (feat)

## Files Created/Modified
- `src/main/ai/prompt-assembler.test.ts` — +4 talking-points/D-13 assertions (9 tests total, green)
- `src/main/ai/ai-orchestrator.ts` — `cleared` added to the canonical `IAiPushEvent` union
- `src/main/hotkey-registrar.service.ts` — `ai-talking-points` (Ctrl+Alt+T) + `clear-ai` (Ctrl+Alt+G) chord rows
- `src/main/index.ts` — `ai-talking-points` + `clear-ai` handlers in `buildHandlers`; `ai-answer` simplified to a one-liner; `buildHandlers` param doc updated
- `src/preload/index.ts` — `cleared` variant on the preload `IAiPushEvent`
- `src/renderer/src/components/ai-panel.tsx` — `cleared` variant + `reduceEntries` reset-to-[] case
- `src/renderer/src/components/debug-hud.tsx` — Talking points + Clear AI cheat-sheet rows
- `.planning/phases/.../deferred-items.md` — logged the pre-existing Wave-1 typecheck failure

## Decisions Made
See `key-decisions` in frontmatter. Notably the `cleared`-event approach (instead of the plan's non-existent `history-snapshot` pseudo-code) to make Ctrl+Alt+G actually empty the panel under the current renderer contract.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Clear-AI uses a new `cleared` event, not the plan's `history-snapshot` pseudo-code**
- **Found during:** Task 1 (wiring the clear-ai handler against the real 05-01 union)
- **Issue:** The plan's `<interfaces>` block pseudo-coded `pushAi(window, { type: 'history-snapshot', entries: aiHistory.snapshot() })`. But the actual `IAiPushEvent` union shipped by 05-01 has NO `history-snapshot` variant, and the renderer's `reduceEntries` has no case for it (its `default` branch returns the list unchanged). The 05-01 SUMMARY explicitly defers the full-snapshot push to 05-03 (`pushHistorySnapshot` is a deliberate no-op). Following the literal pseudo-code would push an event the renderer silently ignores — the panel would NOT clear, breaking must-have D-02.
- **Fix:** Added a minimal `cleared` variant to all three `IAiPushEvent` declarations (orchestrator canonical / preload / renderer) and a `reduceEntries` `cleared` case returning `[]`. The handler pushes `{ type: 'cleared' }` after `aiHistory.clear()`. This empties both the main-owned history and the renderer mirror end-to-end, while leaving the full bounded `history-snapshot` reconciliation (with entry-by-entry merge) to 05-03 as planned.
- **Files modified:** src/main/ai/ai-orchestrator.ts, src/preload/index.ts, src/renderer/src/components/ai-panel.tsx, src/main/index.ts
- **Verification:** Full suite 102/102 green; lint clean; the renderer `cleared` case resets `entries` to `[]`.
- **Committed in:** `d19b93b`

---

**Total deviations:** 1 auto-fixed (1 bug). No architectural changes (Rule 4) were needed — the union extension is additive and consistent with the existing one-way `jedi:ai` contract.
**Impact on plan:** Makes Ctrl+Alt+G genuinely clear the panel (D-02) rather than being an inert push. No scope creep; the 05-03 snapshot reconciliation is untouched.

## Known Stubs
None that block the plan goal. The talking-points system prompt remains the 05-01 `[ASSUMED]` DRAFT wording — its shape satisfies D-12 and is now pinned by characterization assertions; the checkpoint invites the user to tune phrasing. `pushHistorySnapshot()` remains an intentional 05-01 no-op (full snapshot reconciliation is 05-03 scope).

## Deferred Issues
- **Repo-wide `format:check` CRLF drift (out of scope, inherited from 05-01):** `format:check` flags ~54 files (incl. untouched `tsconfig.json`, `VERIFICATION.md`, `vitest.config.ts`) — CRLF-only diff from `core.autocrlf=true` vs Prettier's `endOfLine: lf`. Every file this plan touched is Prettier-clean ignoring line endings (verified file-by-file). Logged to `deferred-items.md`.
- **Pre-existing typecheck failure in `sanitize-ai-error.utility.test.ts` (out of scope):** `npm run typecheck` reports 3 TS errors (TS2345/TS2749) in this Wave-1 test file — the `@anthropic-ai/sdk@0.104.2` typed-error subclass constructors are not assignable to the `typeof APIError` parameter of the test's helper. The file is **byte-identical to this plan's base commit** and was NOT touched by 05-02; none of 05-02's touched files produce any typecheck error. The vitest suite (esbuild, no type-check) passes all 7 of its cases. Logged to `deferred-items.md`; fix belongs to a 05-01 follow-up / dedicated `/gsd:quick`.

## Issues Encountered
- The acceptance criterion `grep -c "aiHistory.clear()" src/main/index.ts` returns 2, not 1: one match is the single executable call site (the new `clear-ai` handler), the other is a pre-existing 05-01 module-level docstring describing the shared-instance contract. The substance of the criterion (exactly one call site) is met; the inherited doc comment was left intact rather than mangled to satisfy a naive text count.

## Checkpoint Status (BLOCKING — human-verify)
Task 2 is an on-machine human-verify checkpoint that cannot be automated. It runs the 02-03 conflict-test protocol for Ctrl+Alt+A / Ctrl+Alt+T / Ctrl+Alt+G against Microsoft Teams, Zoom, and VS Code (each holding focus), confirms the HUD `Hotkeys` row shows `OK`, verifies a live `Ctrl+Alt+T` produces 3-5 streaming bullets, and verifies `Ctrl+Alt+G` empties the panel. Results must be recorded in a new `05-HOTKEY-CONFLICT-TEST.md` (which this executor did NOT fabricate — it requires real on-machine chord-capture observations and any fallback-letter decisions). Resume signal: "approved" with the conflict-test outcome (and any fallback letters used).

## Next Phase Readiness
- 05-03 (full scrollback / focus / cancel / latency log) is additive: the `cleared` event is in place, `IAiPushEvent` already carries the streaming variants, and `pushHistorySnapshot()` is the reserved hook for the full bounded-list reconciliation push.
- Blocker: the Task 2 human-verify checkpoint must be signed off (and `05-HOTKEY-CONFLICT-TEST.md` authored from real on-machine results) before `/gsd:verify-work`.

## Self-Check: PASSED
- All touched source files exist on disk and the new symbols are present: `ai-talking-points` + `clear-ai` in `hotkey-registrar.service.ts`; `trigger('talking-points')` (1) + `aiHistory.clear()` handler (1 call site) in `index.ts`; `cleared` variant in orchestrator/preload/renderer; Talking points + Clear AI rows in `debug-hud.tsx`.
- Task 1 commit `d19b93b` exists in git history.
- `npx vitest run` = 102/102 green; `npm run lint` clean.

---
*Phase: 05-ai-orchestration-answer-talking-points*
*Completed (build task): 2026-06-18*
