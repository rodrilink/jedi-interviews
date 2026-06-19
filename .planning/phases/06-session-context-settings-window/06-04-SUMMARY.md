---
phase: 06-session-context-settings-window
plan: 04
subsystem: ai-orchestration
tags: [grounding, live-rekey, ipc, electron, anthropic, deepgram, pull-on-trigger, d-07, d-10]

# Dependency graph
requires:
  - phase: 06-session-context-settings-window
    plan: 01
    provides: four settings:* IPC channels (two were no-op context stubs), ApiKeyStoreService two-key store
  - phase: 06-session-context-settings-window
    plan: 02
    provides: SessionContextRepository activeAsGrounding()/getActive()/saveActive(); IGroundingContext mapping
  - phase: 05-ai-orchestration-answer-talking-points
    provides: AiOrchestrator (4-arg ctor), AnthropicGateway key-by-constructor, prompt-assembler context slot
  - phase: 04-stt-pipeline-live-transcript
    provides: DeepgramSttGateway key-by-constructor, wireSttPipeline boot wiring
provides:
  - "AiOrchestrator 5th ctor param getActiveContext + pull-on-trigger injection at trigger() (D-10)"
  - "AnthropicGateway.rekey(newKey) in-place SDK-client rebuild (D-07, Pattern 5b)"
  - "index.ts attachSttGatewayHandlers (boot + re-key reuse, Pitfall 3) + rekeyDeepgram instance swap"
  - "Capture callback re-pointed at module-level sttGateway (uninterrupted feed across re-key)"
  - "Fully-wired settings:get-context / settings:save-context (DTO-validated) + live re-key on settings:save-keys"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pull-on-trigger grounding provider: orchestrator reads getActiveContext() FRESH each trigger, zero cached state (D-10)"
    - "In-place gateway re-key (Anthropic): drop readonly, rebuild SDK client; orchestrator's readonly gateway ref + wired handlers untouched (Pattern 5b)"
    - "Instance-swap gateway re-key (Deepgram): stop -> new instance -> re-attach extracted handlers -> re-point module ref -> start (Pitfall 3)"
    - "Untrusted-IPC DTO validation at the handler boundary (T-06-14 Tampering): reject non-object, coerce each field, drop wrong types"

key-files:
  created: []
  modified:
    - src/main/ai/ai-orchestrator.ts
    - src/main/ai/ai-orchestrator.test.ts
    - src/main/ai/anthropic-ai.gateway.ts
    - src/main/index.ts

key-decisions:
  - "Live re-key on settings:save-keys wired in Task 2's commit (the rekey mechanism's first consumer) rather than Task 3, to keep each commit lint-clean (no assigned-but-unused rekeyDeepgram); behavior matches the plan's Task 3 acceptance exactly"
  - "Task 1 added a temporary () => undefined orchestrator provider in index.ts so the codebase typechecks between commits; Task 3 replaced it with () => contextRepo.activeAsGrounding()"
  - "settings:save-context skips parseLinks: the preload contract (settings.ts ISessionContextDto) sends links as a parsed string[], so the handler validates+filters the array rather than splitting newline text (matches the plan's 'if it sends links[], skip')"
  - "rekeyDeepgram is a closure created inside wireSttPipeline (where window/buffer/connectionState are in scope) and stored at module level so the save-keys handler can invoke it; connection-state is shared across re-keys via get/set accessors"

# Metrics
duration: 6min
completed: 2026-06-19
---

# Phase 6 Plan 04: Live Re-Key + Active-Context Grounding Summary

**The phase's end-to-end proof: every AI trigger pulls the active session context fresh (D-10, no restart), both API keys apply live on save (Anthropic in-place rebuild + Deepgram instance-swap with re-attached handlers, D-07), and the two context IPC handlers are fully wired with DTO validation — open settings, paste keys + context, save, and the very next trigger is grounded with the new keys.**

## Performance

- **Duration:** ~6 min (Tasks 1-3 automated)
- **Started:** 2026-06-19T15:49:01Z
- **Tasks:** 3 of 4 automated tasks complete; **Task 4 is a blocking human-verify checkpoint** (on-machine `npm run dev`) — NOT yet performed.

## Accomplishments (Tasks 1-3)

- **Task 1 (TDD) — Orchestrator context injection (D-10):** Added the 5th ctor param `getActiveContext: () => IGroundingContext | undefined` (TSDoc mirrors `pushAi`) and swapped line 165 from `context: undefined` to `context: this.getActiveContext()`. Pull-on-trigger = zero new mutable orchestrator state. Extended `ai-orchestrator.test.ts` with three cases: (1) filled context injects the four blocks into `userContent`; (2) `undefined` context is byte-for-byte equal to `assemblePrompt({ mode, span, context: undefined })` (Phase-5-identical fail-safe); (3) the provider is pulled at EACH trigger (a value change between two triggers is reflected in the second).
- **Task 2 — Live re-key (D-07):** `AnthropicGateway.rekey(newKey)` drops `readonly` on `client`/`apiKey` (Pitfall 4 / TS2540) and rebuilds the SDK client in place — the next `stream()` uses the new key; the orchestrator's `readonly gateway` ref + constructor-wired handlers are untouched (Pattern 5b). In `index.ts`: extracted the three `gateway.on(...)` bindings into `attachSttGatewayHandlers` (called on boot AND re-key, Pitfall 3); re-pointed the capture callback to `sttGateway?.sendAudio(pcm)` (the module-level re-pointable ref) so a live re-key keeps the running `AudioCaptureService` feeding the new socket; added `rekeyDeepgram` (stop -> new `DeepgramSttGateway(newKey)` -> re-attach handlers -> re-point module ref -> start). `settings:save-keys` now persists AND applies both keys live. No key is ever logged (grep gate = 0).
- **Task 3 — Context repo wiring + IPC handlers:** Instantiated `SessionContextRepository` as an entry-point singleton (D-09); replaced Task 1's temporary provider with `() => contextRepo.activeAsGrounding()`. `settings:get-context` -> `contextRepo.getActive()` (editor pre-fill). `settings:save-context` validates the untrusted DTO (rejects non-object, coerces each field, drops wrong types — T-06-14 Tampering) then `contextRepo.saveActive({ notes, ticketText, repoSnippets, links })`; the next AI trigger pulls it via the provider (D-06 immediate-active, no restart).

## How It Was Verified (automated)

- `npx vitest run src/main/ai/ai-orchestrator.test.ts src/main/ai/prompt-assembler.test.ts` — 25/25 green (RED confirmed first for the two injection-dependent cases; Phase-5-identical case proven by equality).
- `npm run typecheck` (node + web) — pass.
- `npm run lint` (oxlint) — pass.
- `npm test` (full suite) — 18 files / 133 tests green (was 130 before this plan's 3 new cases).
- `npm run build` (electron-vite) — main/preload/renderer all emitted.
- Grep gate (no key in logs): `grep -v '^#' src/main/index.ts src/main/ai/anthropic-ai.gateway.ts | grep -cE 'console\.(log|error|warn).*(apiKey|newKey|deepgram.*[Kk]ey|anthropic.*[Kk]ey)'` = **0**.
- Grep gate (`saveActive`): count = **1** (≥1 required).
- Source assertion: `ai-orchestrator.ts:165` reads `context: this.getActiveContext()` (no remaining `context: undefined`); `index.ts` constructs `AiOrchestrator(... , () => contextRepo.activeAsGrounding())`.

## Task Commits

1. **Task 1: orchestrator context injection (D-10, TDD)** — `32838e9` (feat)
2. **Task 2: live re-key both gateways (D-07)** — `678e9a2` (feat)
3. **Task 3: context repo + provider + context IPC handlers** — `1747097` (feat)

## TDD Gate Compliance

Task 1 followed RED -> GREEN. RED was confirmed by run output before the implementation: the two injection-dependent cases failed (`expected '...transcript...' to contain 'Use Postgres...'`) while the Phase-5-identical case passed (today's code already passed `context: undefined`). After adding the 5th param + line-165 swap, all 16 orchestrator cases + 9 prompt-assembler cases were green. Commit uses `feat(...)` (test + implementation in one task commit, sequential executor). No unexpected RED-phase passes for the injection behaviors.

## Deviations from Plan

- **[Rule 3 - Blocking] Temporary orchestrator provider in Task 1's commit.** Task 1's `npm run typecheck:node` acceptance would fail because `index.ts` still constructed the orchestrator with 4 args. Added `() => undefined` as the 5th arg in Task 1 (keeping every intermediate commit type-correct), then replaced it with `() => contextRepo.activeAsGrounding()` in Task 3. Behavior-identical to the plan; `() => undefined` is the documented Phase-5 fail-safe. Files: `src/main/index.ts`. Commits: `32838e9` (temp), `1747097` (final).
- **[Wiring placement] Live re-key on `settings:save-keys` wired in Task 2 rather than Task 3.** The plan lists the save-keys live re-key under Task 3's acceptance, but Task 2 builds the re-key mechanism (`rekey` + `rekeyDeepgram`). Wiring the handler to call them in Task 2's commit avoids an `oxlint` `no-unused-vars` error on `rekeyDeepgram` (assigned-but-never-read) in the intermediate commit. The final state matches the plan's Task 3 acceptance exactly (`settings:save-keys` calls both `apiKeyStore.save*` AND the live re-key paths). Files: `src/main/index.ts`. Commit: `678e9a2`.

## Known Stubs

None. Both previously-stubbed context channels (`settings:get-context` / `settings:save-context`, no-ops from 06-01) now have full bodies backed by `SessionContextRepository`.

## Threat Flags

None. The plan's threat register (T-06-13 key-in-logs, T-06-14 save-context DTO, T-06-16 re-key STT freeze) is addressed: re-key paths never log the key (grep gate 0); `settings:save-context` validates the DTO shape before `saveActive`; Deepgram re-key reuses the gateway's own connect/reconnect and re-attaches handlers (Pitfall 3). No new trust-boundary surface beyond the plan.

## Outstanding — Task 4 (blocking human-verify)

**Task 4 is a `checkpoint:human-verify` (`gate="blocking"`) that requires an on-machine `npm run dev` session and CANNOT be automated.** It is NOT yet performed. The human must:

1. `npm run dev`; with NO saved context, trigger Answer (Ctrl+Alt+A) — note the Phase-5 generic baseline.
2. Ctrl+Alt+S, paste meaningful context, Save; WITHOUT restart, trigger Answer — confirm the answer is observably MORE grounded (AI-06). Confirm clearing context returns to the generic baseline.
3. Keys tab: save a fresh Anthropic key — confirm the next Answer succeeds (no restart). Save a fresh Deepgram key while STT runs — confirm the live transcript pauses briefly then RESUMES (Pitfall 3 regression check), no app restart, no frozen connection-state.
4. Confirm the terminal printed no key value during the re-key.

Resume signal: "approved", or describe the failure.

## Self-Check: PASSED

- Files: all 4 modified files present on disk (`ai-orchestrator.ts`, `ai-orchestrator.test.ts`, `anthropic-ai.gateway.ts`, `index.ts`).
- Commits: `32838e9`, `678e9a2`, `1747097` all present in git log.
- Automated verification: vitest 133/133, typecheck (node+web), lint, build all green; both grep gates pass.

---
*Phase: 06-session-context-settings-window*
*Completed (automated tasks): 2026-06-19 — Task 4 human-verify pending*
