---
phase: 05-ai-orchestration-answer-talking-points
plan: 03
subsystem: ai
tags: [electron-ipc, react, hotkeys, keyboard-scroll, latency, anthropic]

# Dependency graph
requires:
  - phase: 05-ai-orchestration-answer-talking-points
    plan: 01
    provides: AiOrchestrator (single-in-flight, requestId guard, debounced delta push, cross-mode cancel D-07), IAiPushEvent + jedi:ai channel + onAi bridge, always-on AiPanel with its own scroll ref + stickToBottomRef, per-mode model constants (ANSWER_MODEL/TALKING_POINTS_MODEL)
  - phase: 05-ai-orchestration-answer-talking-points
    plan: 02
    provides: Ctrl+Alt+T talking-points + Ctrl+Alt+G clear-AI chords, two-column overlay layout, HOTKEY_CHEAT_SHEET rows
provides:
  - Main-owned activePanel flag ('transcript' | 'ai', default 'ai') in IOverlayStatus + setActivePanel/getActivePanel, carried in buildStatus and pushed read-only to the renderer (D-08)
  - Ctrl+Alt+F focus-cycle chord (HOTKEY_CHORDS + index.ts handler) that flips the flag and re-pushes status
  - Active-panel-routed scroll: the single jedi:scroll-transcript channel is routed in the renderer by the pushed flag (debug-hud scrolls transcript when 'transcript'; ai-panel scrolls its list when 'ai')
  - Corner active-panel indicator (icon-active-panel) in the AI panel + hud.css
  - Hotkey-to-first-token latency logging in the orchestrator ([ai] first-token mode=<mode> model=<model> latencyMs=<n>), main-log-only, keyed on requestId (D-10)
  - Cheat-sheet: Focus panel (Ctrl+Alt+F) row + Scroll active panel relabel
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Main-owned UI-routing flag pushed read-only, renderer routes a shared IPC channel by the flag (activePanel mirrors the hudVisible triplet; one scroll channel, renderer-side routing — no second channel)"
    - "Live-value ref to dodge the stale-closure trap in an empty-deps useEffect subscription (activePanelRef updated inside onStatus so the once-wired scroll handler reads the current flag)"
    - "First-token latency instrumentation on the active-request struct (startMs + firstTokenLogged), logged once on the first text delta, keyed on the existing requestId guard"

key-files:
  created:
    - .planning/phases/05-ai-orchestration-answer-talking-points/05-03-SUMMARY.md
  modified:
    - src/main/overlay-window.manager.ts
    - src/main/hotkey-registrar.service.ts
    - src/main/index.ts
    - src/preload/index.ts
    - src/renderer/src/components/debug-hud.tsx
    - src/renderer/src/components/ai-panel.tsx
    - src/renderer/src/assets/hud.css
    - src/main/ai/ai-orchestrator.ts
    - src/main/ai/ai-orchestrator.test.ts

decisions:
  - "activePanel default 'ai' on launch (D-08): a freshly triggered AI answer is the most likely first scroll target"
  - "Kept a single scroll channel (jedi:scroll-transcript); routing decided in the renderer by the pushed flag rather than adding a second per-panel channel (D-08 intent)"
  - "console.log for the latency line: the main process has no logger and deliberately avoids payload logging (index.ts:131-135 precedent); console.log is the minimal main-log-only sink"

metrics:
  duration: ~25m
  completed: 2026-06-18
  tasks_completed: 2
  tasks_total: 3
  status: paused-at-checkpoint
---

# Phase 5 Plan 03: Keyboard Scrollback Under the Focused-Panel Model Summary

Main-owned `activePanel` flag with a corner indicator, `Ctrl+Alt+F` focus cycle, the single `Ctrl+Alt+PgUp/PgDn` scroll channel routed in the renderer to the active panel, and hotkey-to-first-token latency logging — wired and unit-verified; the on-machine focused-panel / scrollback / cross-mode-cancel / latency-feel verification is paused at the blocking human-verify checkpoint.

## What was built

**Task 1 — activePanel flag + Ctrl+Alt+F + active-panel-routed scroll (commit `7da094a`)**
- `overlay-window.manager.ts`: added `activePanel: 'transcript' | 'ai'` to `IOverlayStatus`, a module-level `let activePanel = 'ai'` (D-08 default), `setActivePanel`/`getActivePanel`, and carried `activePanel` in `buildStatus()` — mirroring the `hudVisible` triplet exactly.
- `hotkey-registrar.service.ts`: added the `focus-cycle` chord (`Ctrl+Alt+F`, `discrete`) to `HOTKEY_CHORDS`.
- `index.ts`: wired the `focus-cycle` handler (`setActivePanel(getActivePanel() === 'ai' ? 'transcript' : 'ai'); pushStatus(window)`), mirroring the `getOverlayVisible()` branch. The existing `scroll-transcript-up`/`-down` handlers are unchanged — routing now lives in the renderer.
- `preload/index.ts`: added `activePanel` to the local `IOverlayStatus`.
- `debug-hud.tsx`: added `activePanel` to its local `IOverlayStatus`; guarded `onScrollTranscript` so it scrolls the transcript only when `activePanel === 'transcript'` (via an `activePanelRef` updated inside `onStatus` to avoid the empty-deps stale-closure trap); cheat-sheet gains `Focus panel` (Ctrl+Alt+F) and the `Scroll` row is relabeled `Scroll active panel`.
- `ai-panel.tsx`: subscribed to `onStatus` (track the flag) and `onScrollTranscript` (scroll its list only when `activePanel === 'ai'`, reusing the debug-hud scroll-step + stick-to-bottom re-arm); renders a corner `icon-active-panel` indicator off the flag.
- `hud.css`: `.ai-panel` made `position: relative`; added `.ai-panel__active-indicator` pill styling with a brighter `[data-active-panel='ai']` state.

**Task 2 — hotkey-to-first-token latency logging (commit `d8bca2b`)**
- `ai-orchestrator.ts`: added `model`, `startMs`, and `firstTokenLogged` to the active-request struct. `startMs` is captured immediately before `gateway.stream(...)`. On the FIRST text delta, one main-log line is emitted: `[ai] first-token mode=<mode> model=<model> latencyMs=<n>`. Logged exactly once per stream and keyed on the active request — the existing Pitfall-1 requestId guard means an aborted stream's late delta never logs, and a cross-mode cancel-and-restart (D-07) gets its own measurement. Only `mode`/`model`/`latencyMs` are logged; never the transcript text, key, or error payload, and never pushed to the renderer (T-5-10).
- `ai-orchestrator.test.ts`: +4 tests — log-once on first delta, mode/model/latencyMs fields present, stale-aborted-stream late delta does NOT log, and a fresh first-token line for the new stream after a cross-mode switch.

Cross-mode cancel-current-start-new (D-07) was already wired in 05-01; it is re-verified intact by the existing `cancel-current-start-new across modes` test plus the new cross-mode latency test.

## Verification

- `npx vitest run` — 14 files, **107 tests passed** (103 baseline + 4 new orchestrator latency tests).
- `npm run lint` (oxlint) — clean, exit 0.
- Latency log discipline: no code logs a key; the only `apiKey`/`x-api-key` token in `ai-orchestrator.ts` is a pre-existing security comment (see Deviations).

## Deviations from Plan

### Out-of-scope / pre-existing (documented, not fixed)

**1. `npm run format:check` fails repo-wide on a pre-existing CRLF baseline.**
- **Found during:** Task 1 verification.
- **Issue:** `prettier --check .` flags 54 files including ones never touched in this plan (`tsconfig.json`, `env.d.ts`, `vitest.config.ts`, etc.). The working-copy files are CRLF while git's normalized blobs are LF, so on-disk `--check` reports style mismatches for already-committed-clean files (confirmed: `git show HEAD:tsconfig.json | prettier --check --stdin-filepath` is CLEAN, but the on-disk file FAILS). This is a repo line-ending configuration issue, not caused by 05-03.
- **Action:** Out of scope (SCOPE BOUNDARY). Logged to `deferred-items.md`. My own modified files WERE made Prettier-clean (`prettier --write` on the 9 touched files; each re-verified CLEAN individually), so no NEW format violations were introduced. The `format:check` acceptance criterion cannot pass at the whole-repo level until the pre-existing CRLF baseline is normalized (a repo-wide `prettier --write` or `.gitattributes`/`core.autocrlf` fix).

### Acceptance-criterion grep notes (no functional deviation)

- `grep -c "setActivePanel" src/main/index.ts` returns **2**, not the planned 1: Prettier reflowed the `overlay-window.manager` import into a multi-line block, so `setActivePanel` appears once in the import list and once in the handler. The handler wiring (the load-bearing usage) is present and correct.
- `grep -L "apiKey\|x-api-key\|process.env.ANTHROPIC" src/main/ai/ai-orchestrator.ts` does NOT list the file because line 231 contains a pre-existing (05-01) security comment mentioning `x-api-key` ("NEVER the raw error payload … it can embed x-api-key"). No code logs a key; the T-5-10 property (log only mode/model/latencyMs, main-log-only) holds. The grep is a heuristic that catches the explanatory comment, not an actual leak.

## Known Stubs

None introduced. `pushHistorySnapshot()` in `ai-orchestrator.ts` remains an intentional no-op (carried from 05-01); the terminal `done`/`error`/`cancelled`/`empty` pushes already deliver the authoritative entry text and the renderer reconciles its bounded mirror there. The scrollback work in this plan operates on the renderer's existing local entry mirror (it scrolls the rendered DOM list), so a full history-snapshot reconciliation push was not required to satisfy AI-05. The hook is left in place for any future bounded-list reconciliation need.

## Checkpoint Status: PAUSED (blocking human-verify)

Task 3 is a `checkpoint:human-verify` (`gate="blocking"`) requiring on-machine verification that is NOT unit-testable (the overlay is `focusable:false`; live streaming + keyboard routing + latency feel need the target Windows machine). Per executor policy, on-machine results are NOT fabricated. The build work (Tasks 1-2) is complete and committed; the checkpoint awaits the user's "approved" with the Ctrl+Alt+F conflict result and observed Haiku/Opus first-token latencies. See the structured checkpoint message returned to the orchestrator.

## Self-Check: PASSED
- src/main/overlay-window.manager.ts — FOUND (activePanel triplet + buildStatus)
- src/main/hotkey-registrar.service.ts — FOUND (focus-cycle chord)
- src/main/index.ts — FOUND (focus-cycle handler)
- src/preload/index.ts — FOUND (activePanel in IOverlayStatus)
- src/renderer/src/components/debug-hud.tsx — FOUND (guarded scroll + cheat-sheet)
- src/renderer/src/components/ai-panel.tsx — FOUND (scroll guard + icon-active-panel)
- src/renderer/src/assets/hud.css — FOUND (indicator CSS)
- src/main/ai/ai-orchestrator.ts — FOUND (first-token latency logging)
- src/main/ai/ai-orchestrator.test.ts — FOUND (+4 latency tests)
- commit 7da094a — FOUND
- commit d8bca2b — FOUND
