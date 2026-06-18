---
phase: 05-ai-orchestration-answer-talking-points
plan: 01
subsystem: ai
tags: [anthropic, claude, streaming, electron-ipc, react, hotkeys, sdk]

# Dependency graph
requires:
  - phase: 04-stt-pipeline-live-transcript
    provides: TranscriptBuffer.recentSince span read, jedi:transcript push pattern, DeepgramSttGateway seam discipline, loadDotenvFile key-source pattern
  - phase: 02-global-hotkeys-window-control
    provides: HotkeyRegistrarService + HOTKEY_CHORDS discrete-chord pattern
  - phase: 01-foundation
    provides: contextIsolation/sandbox preload bridge, overlay window, jedi:status channel
provides:
  - IAiGateway seam (AiMode / IAiStream / IAiPromptRequest) with no SDK import
  - AnthropicGateway over @anthropic-ai/sdk messages.stream (constructor-injected key, never reads env, never logs key)
  - Pure assemblePrompt with per-mode system prompts + empty D-13 grounding-context slot + RECENT_SPAN_MS
  - Bounded AiHistory (last-N + char ceiling) with clock-sourced entry timestamps
  - AiOrchestrator single-in-flight lifecycle (empty-span guard, re-press cancel, cross-mode cancel-start, request-id guard, debounced deltas)
  - jedi:ai one-way push channel + onAi preload bridge
  - Always-on AiPanel rendered outside the HUD toggle gate
  - Ctrl+Alt+A Answer chord wired end-to-end
affects: [05-02-talking-points-mode-span, 05-03-streaming-render-scroll-cancel, 06-session-context, 07-vision-code-challenge]

# Tech tracking
tech-stack:
  added: ["@anthropic-ai/sdk@0.104.2 (pure JS, no native rebuild)"]
  patterns:
    - "Thin AI gateway mirroring DeepgramSttGateway (EventEmitter, report-don't-throw, constructor-injected key)"
    - "Single-in-flight orchestrator with monotonic request-id guard against cross-stream event bleed"
    - "Main-owned bounded history pushed as authoritative; renderer mirrors deltas + reconciles on terminal"
    - "New high-frequency one-way jedi:ai channel separate from jedi:status (mirrors jedi:transcript split)"

key-files:
  created:
    - src/main/ai/ai-gateway.interface.ts
    - src/main/ai/anthropic-ai.gateway.ts
    - src/main/ai/prompt-assembler.ts
    - src/main/ai/ai-history.ts
    - src/main/ai/ai-orchestrator.ts
    - src/main/ai/prompt-assembler.test.ts
    - src/main/ai/ai-history.test.ts
    - src/main/ai/ai-orchestrator.test.ts
    - src/renderer/src/components/ai-panel.tsx
    - .env.example
  modified:
    - src/main/overlay-window.manager.ts
    - src/preload/index.ts
    - src/preload/index.d.ts
    - src/main/index.ts
    - src/main/hotkey-registrar.service.ts
    - src/renderer/src/App.tsx
    - src/renderer/src/assets/hud.css
    - package.json
    - package-lock.json
    - .gitignore

key-decisions:
  - "RECENT_SPAN_MS=60_000, DELTA_DEBOUNCE_MS=40 (in the locked 30-60ms band), MAX_AI_ENTRIES=50, MAX_AI_TOTAL_CHARS=20_000, max_tokens answer=400/talking-points=500 — grounded named-constant defaults"
  - "ANSWER_MODEL=claude-haiku-4-5, TALKING_POINTS_MODEL=claude-opus-4-8 (D-10 per-mode constants)"
  - "System prompts are [ASSUMED] DRAFT wording (claude-api skill unavailable); shape satisfies D-12, tunable post on-machine verify"
  - "IAiPushEvent discriminated union (thinking/delta/done/error/cancelled/empty) declared canonically in ai-orchestrator.ts; overlay-manager re-exports the type; preload + renderer declare it locally"
  - "Cancellation recorded synchronously in cancelActive() (not solely via the async SDK abort event) so a fake/real late delta can never bleed into a new entry"

patterns-established:
  - "AI seam: consumers depend on IAiGateway, never on @anthropic-ai/sdk"
  - "Always-on renderer surface as a sibling of DebugHud, never gated on hudVisible (D-01)"
  - "Per-mode model + max-token named constants for cheap re-tiering"

requirements-completed: [AI-01, AI-04]

# Metrics
duration: 78min
completed: 2026-06-18
---

# Phase 5 Plan 01: AI Orchestration Answer Slice Summary

**Ctrl+Alt+A reads the recent ~60s transcript span, streams a Claude Haiku answer token-by-token over a new jedi:ai channel, and renders it in an always-on AI panel — built on a full main-side AI stack (IAiGateway seam, pure prompt assembler, bounded history, single-in-flight orchestrator) so later plans are additive.**

> STATUS: All build tasks (0–3) complete and committed. The final task is a BLOCKING human-verify checkpoint requiring on-machine live verification (overlay is `focusable:false`; live streaming render is not unit-testable). Execution is PAUSED at that checkpoint awaiting the user's "approved" signal. STATE.md/ROADMAP.md are intentionally NOT modified (orchestrator owns those post-wave).

## Performance

- **Duration:** ~78 min
- **Started:** 2026-06-18T17:25:00Z
- **Completed (build tasks):** 2026-06-18T18:45:00Z
- **Tasks:** 4 build tasks complete (Task 0–3); 1 human-verify checkpoint pending
- **Files modified/created:** 20

## Accomplishments
- Installed `@anthropic-ai/sdk@0.104.2` (pure JS; verified no postinstall) and added three RED test stubs (Wave 0).
- Built the entire main-side AI stack behind clean seams: `IAiGateway`, `AnthropicGateway`, pure `assemblePrompt`, bounded `AiHistory`, single-in-flight `AiOrchestrator`.
- Wired the end-to-end Answer path: `jedi:ai` push channel + `onAi` bridge + always-on `AiPanel` + `Ctrl+Alt+A` chord.
- Full unit suite green (91 tests, no STT regressions); typecheck (node + web) and oxlint green.

## Task Commits

1. **Task 0: Install SDK + failing test stubs** - `81fd530` (test)
2. **Task 1: AI seam, prompt assembler, bounded history** - `868bc90` (feat, GREEN gate for two stubs)
3. **Task 2: AnthropicGateway + AiOrchestrator** - `6eb5c19` (feat, GREEN gate for orchestrator stub)
4. **Task 3: jedi:ai channel + onAi + AiPanel + Ctrl+Alt+A wiring** - `2ea91af` (feat)

_TDD gate sequence: Task 0 `test(...)` (RED) → Task 1 & Task 2 `feat(...)` (GREEN). RED was confirmed (STUBS-RED-AS-EXPECTED) before any source existed._

## Files Created/Modified
- `src/main/ai/ai-gateway.interface.ts` — IAiGateway seam (no SDK import)
- `src/main/ai/anthropic-ai.gateway.ts` — AnthropicGateway over messages.stream; key constructor-injected, never reads env/logs key
- `src/main/ai/prompt-assembler.ts` — pure assemblePrompt + 2 system prompts + RECENT_SPAN_MS + empty D-13 context slot
- `src/main/ai/ai-history.ts` — bounded AiHistory (MAX_AI_ENTRIES / MAX_AI_TOTAL_CHARS) with injected clock
- `src/main/ai/ai-orchestrator.ts` — single-in-flight lifecycle, request-id guard, ~40ms debounce, per-mode model/max-token constants, IAiPushEvent union
- `src/main/ai/{prompt-assembler,ai-history,ai-orchestrator}.test.ts` — unit coverage (FakeAiGateway + fake timers)
- `src/renderer/src/components/ai-panel.tsx` — always-on streaming panel (D-01/D-03/D-04)
- `src/main/overlay-window.manager.ts` — AI_CHANNEL + pushAi()
- `src/preload/index.ts` + `index.d.ts` — onAi bridge + IAiPushEvent type
- `src/main/index.ts` — shared aiHistory singleton, gateway from env, buildHandlers extended, ai-answer handler
- `src/main/hotkey-registrar.service.ts` — ai-answer (Ctrl+Alt+A) chord
- `src/renderer/src/App.tsx` + `hud.css` — render AiPanel sibling + panel styling/layout
- `.env.example` (+ `.gitignore` un-ignore) — documents ANTHROPIC_API_KEY
- `package.json` / `package-lock.json` — pinned `@anthropic-ai/sdk@0.104.2`

## Decisions Made
See `key-decisions` in frontmatter. Notably: span/debounce/history bounds and per-mode max_tokens fixed as named constants; system prompts are DRAFT wording pending user confirmation at the checkpoint.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Added `id` to IActiveRequest so terminal handlers typecheck**
- **Found during:** Task 3 (typecheck after wiring)
- **Issue:** The orchestrator's `done`/`error`/`abort` handlers and `cancelActive` destructured `id` from `this.active`, but `IActiveRequest` only declared `requestId`. Vitest (esbuild, no type-check) passed; `tsc` flagged 4 TS2339 errors.
- **Fix:** Added `id: string` to `IActiveRequest` and set it (`String(requestId)`) when the active request is constructed in `trigger`.
- **Files modified:** src/main/ai/ai-orchestrator.ts
- **Verification:** `npm run typecheck` exits 0 (node + web); full suite still 91/91 green.
- **Committed in:** `2ea91af` (Task 3 commit)

**2. [Rule 3 - Blocking] Un-ignored `.env.example` in .gitignore**
- **Found during:** Task 0
- **Issue:** The existing `.env.*` ignore rule also caught `.env.example`, so the secret-free template (required by the plan + acceptance criterion) could not be committed.
- **Fix:** Added `!.env.example` negation after the `.env.*` rule.
- **Files modified:** .gitignore
- **Verification:** `git check-ignore .env.example` no longer matches; file committed.
- **Committed in:** `81fd530` (Task 0 commit)

**3. [Rule 3 - Blocking] Installed the new SDK with `--ignore-scripts`**
- **Found during:** Task 0
- **Issue:** A plain `npm install @anthropic-ai/sdk@0.104.2` failed because the PRE-EXISTING `native-recorder-nodejs@1.2.0` dep ran its `prebuild-install || cmake-js` postinstall and `cmake-js` is unavailable on this machine (a known repo condition recorded in 04-01). This is the existing native dep's postinstall, NOT a legitimacy concern for the pure-JS Anthropic SDK (which has no postinstall — verified).
- **Fix:** Re-ran with `npm install @anthropic-ai/sdk@0.104.2 --ignore-scripts` (the documented house pattern for this repo's native dep), then reconciled the lockfile and pinned the version to exact `0.104.2`.
- **Files modified:** package.json, package-lock.json
- **Verification:** SDK version reads 0.104.2; `node -e` import path resolves; full suite green.
- **Committed in:** `81fd530` (Task 0 commit)

---

**Total deviations:** 3 auto-fixed (1 bug, 2 blocking). No architectural changes (Rule 4) were needed.
**Impact on plan:** All three were necessary to complete the planned work; no scope creep. The `id` fix hardens type safety on the streaming path.

## Known Stubs
None that block the plan goal. The two system prompts (`ANSWER_SYSTEM_PROMPT`, `TALKING_POINTS_SYSTEM_PROMPT`) are flagged in-code as `[ASSUMED]` DRAFT wording (the `claude-api` skill was unavailable at research time); their shape satisfies D-12 and they are functional. The checkpoint explicitly invites the user to tune the wording. The `pushHistorySnapshot()` reconciliation hook is an intentional no-op in 05-01 (the full-snapshot push lands in 05-03); terminal pushes already carry authoritative entry text.

## Deferred Issues
- **Repo-wide `npm run format:check` CRLF drift (out of scope):** `format:check` reports 43 files (including untouched `vitest.config.ts`, `tsconfig.json`, `VERIFICATION.md`) as needing Prettier. The diff is CRLF-only — `git config core.autocrlf=true` checks out CRLF while Prettier's default `endOfLine: lf` expects LF. Every file this plan touched is Prettier-clean ignoring line endings (verified file-by-file). Logged to `deferred-items.md`; recommend a dedicated `/gsd:quick` to set a repo line-ending policy. `npm run lint` and `npm run typecheck` both pass.

## Issues Encountered
- The acceptance criterion `node -e "require('@anthropic-ai/sdk/package.json').version"` fails because the SDK's `exports` map blocks the `./package.json` subpath. Verified the version (0.104.2) by reading the file directly instead — the substance of the criterion is met.
- The `grep -L process.env` / `grep -L "@anthropic-ai/sdk"` criteria are naive text matches that hit TSDoc comment prose, not code. Confirmed directly that the seam has zero import statements and the gateway has no executable `process.env` read — both threat-model intents (T-5-01) are satisfied.

## User Setup Required
**The Anthropic API key must be supplied locally before the checkpoint verification.**
- Add `ANTHROPIC_API_KEY=<your key>` to the gitignored `.env` (template documented in `.env.example`). Source: Anthropic Console → Settings → API keys.
- Without it, an AI hotkey press shows `AI error: missing API key` inline (no crash, key never logged).

## Checkpoint Status (BLOCKING — human-verify)
The final plan task is an on-machine human-verify checkpoint that cannot be automated (the overlay is `focusable:false` and live token streaming is not unit-testable). All build work is done and committed; the executor is paused awaiting the user's verification on the target machine (see the orchestrator-facing CHECKPOINT REACHED message). Resume signal: "approved" (optionally noting system-prompt wording to tune).

## Next Phase Readiness
- The entire main-side AI stack and the `jedi:ai` render path exist, so 05-02 (talking-points mode + span) and 05-03 (full scrollback/focus/cancel/latency log) are additive: `buildHandlers` already accepts `aiOrchestrator` + the shared `aiHistory` for the 05-02 `clear-ai` handler, and the `IAiPushEvent` union already includes a `history-snapshot` variant for 05-03.
- Blocker: the human-verify checkpoint must be signed off before `/gsd:verify-work`.

## Self-Check: PASSED
- All 7 spot-checked created files exist on disk (the five `src/main/ai/` modules, `ai-panel.tsx`, `.env.example`).
- All 4 task commits exist in git history: `81fd530`, `868bc90`, `6eb5c19`, `2ea91af`.

---
*Phase: 05-ai-orchestration-answer-talking-points*
*Completed (build tasks): 2026-06-18*
