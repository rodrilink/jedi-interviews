---
phase: 08-diarized-utterance-pipeline
plan: 03
subsystem: stt
tags: [stt, utterance, overlay, ipc, diarization, re-key, clear-together]
requires:
  - "08-02: gateway 'utterance' event (one IUtteranceEvent per committed turn) + DeepgramSttGateway.clearSpeakers()"
  - "08-01: IUtteranceEvent seam contract"
provides:
  - "IOverlayTranscript extended additively with utterances: IUtteranceEvent[] (rides the existing read-only jedi:transcript channel)"
  - "gateway.on('utterance') binding inside attachSttGatewayHandlers (re-key safe — boot + re-key both attach it)"
  - "Main-owned session-scoped committed-utterance list, grown per committed turn, drained on Ctrl+Alt+K"
  - "clear-transcript (Ctrl+Alt+K) D-05 clear-together: buffer.clear() + utterances drain + sttGateway.clearSpeakers() so Person N restarts at Person 1"
affects:
  - "Phase 9 renders the card-based Q/A panel from the IOverlayTranscript.utterances stream"
tech-stack:
  added: []
  patterns:
    - "Additive IPC payload extension: new field on the existing one-way push channel, no new control surface"
    - "Shared by-reference session list threaded through wire/attach/build the same way the TranscriptBuffer is"
    - "Re-key safety: the utterance binding lives in the shared attach helper so a re-keyed gateway re-attaches it (Pitfall 3)"
    - "D-05 clear-together: transcript buffer + utterance list + speaker map reset in one hotkey handler"
key-files:
  created: []
  modified:
    - src/main/overlay-window.manager.ts
    - src/main/index.ts
decisions:
  - "The committed-utterance list is emptied IN PLACE (utterances.length = 0) rather than reassigned, so the single shared array reference stays authoritative across wireSttPipeline, attachSttGatewayHandlers, and buildHandlers"
  - "clearSpeakers() is called on the module-level re-pointable sttGateway ref (not a captured local) so a re-keyed gateway instance is the one reset (D-07 instance-swap safety)"
  - "The utterance binding is placed in attachSttGatewayHandlers (not wireSttPipeline) so the re-key path re-attaches it (Pitfall 3) — mirroring the transcript/state bindings"
requirements: [QA-01, QA-02, QA-07]
metrics:
  duration: ~15m
  completed: 2026-07-06
  tasks: 2
  files: 2
---

# Phase 8 Plan 03: Diarized Utterance Pipeline Overlay Wiring Summary

Completed the vertical slice to the overlay: the gateway's committed `utterance` events now flow through the main process onto the EXISTING read-only `jedi:transcript` push channel as an additive payload field, and Ctrl+Alt+K resets the speaker map alongside the transcript buffer so `Person N` numbering restarts at `Person 1`. No new renderer→main control channel was added — the utterance stream rides the one-way transcript push, and `index.ts` still imports no `@deepgram/sdk` (QA-07).

## What Was Built

- **Additive overlay payload (Task 1, QA-01):** Extended `IOverlayTranscript` in `overlay-window.manager.ts` with one new field `utterances: IUtteranceEvent[]` (JSDoc: committed, speaker-attributed, classified utterances, oldest first — consumed by the Phase 9 card panel). Imported `IUtteranceEvent` from the STT seam (extended the existing `import type { SttConnectionState }` line), NOT `@deepgram/sdk`. The four existing fields (`finalText`, `interimText`, `connectionState`, `audioLevel`) are unchanged so the current HUD keeps working while Phase 9 migrates the panel. No new channel constant — the field rides `TRANSCRIPT_CHANNEL` (`jedi:transcript`) via the unchanged `pushTranscript`. The D-08 "text + state only, never the Deepgram key or any secret" contract note was updated to explain the additive field (an `IUtteranceEvent` carries only text/speaker/classification — no secret).
- **Utterance binding + speaker reset (Task 2, QA-01/QA-02/D-05):** In `index.ts`:
  - Added a single authoritative main-owned `const utterances: IUtteranceEvent[] = []` in `app.whenReady()`, mirroring how `buffer` is the authoritative transcript store. Threaded it BY REFERENCE into `wireSttPipeline`, `attachSttGatewayHandlers`, and `buildHandlers` exactly the way `buffer` is threaded.
  - Added `gateway.on('utterance', (utterance) => { utterances.push(utterance); pushTranscript(...) })` INSIDE `attachSttGatewayHandlers` (alongside the existing `on('transcript')`/`on('connection-state-change')`), so the live re-key path (`rekeyDeepgram`) re-attaches it too — a re-keyed socket would otherwise emit utterances to no listener and the Q/A stream would freeze (Pitfall 3).
  - Every one of the five `pushTranscript(...)` call sites (transcript handler, utterance handler, connection-state handler, the throttled audio-level push in `wireSttPipeline`, and the clear handler) now passes `utterances` in the payload.
  - Extended the `'clear-transcript'` handler (Ctrl+Alt+K, D-05): after `buffer.clear()` it drains the list in place (`utterances.length = 0`) AND calls `sttGateway?.clearSpeakers()` on the module-level re-pointable ref (so a re-keyed gateway's SpeakerMap + accumulator are the ones reset), then pushes the emptied snapshot with `utterances: []`. Person N restarts at Person 1.
  - No `@deepgram/sdk` import added to `index.ts`; no new `ipcMain.handle`/`ipcMain.on`/`webContents.send` channel for utterances.

## Task Commits

| Task | Name | Commit(s) | Files |
| ---- | ---- | --------- | ----- |
| 1 | Additively extend the overlay transcript payload | `0d2d532` (feat) | overlay-window.manager.ts |
| 2 | Wire utterance binding + Ctrl+Alt+K speaker reset (re-key safe) | `3ece163` (feat) | index.ts |

## Verification Results

- `npm test` (full suite): **179 tests passed** (23 files), exit 0 — run bare, not piped through a masking filter for the gate; the tail shown was for readability only after the runner reported its own pass/fail.
- `npm run typecheck` (node + web): **exit 0** — every `pushTranscript` call site supplies the new `utterances` field project-wide.
- `grep -c "@deepgram/sdk" src/main/index.ts` → **0**; `grep -c "@deepgram/sdk" src/main/overlay-window.manager.ts` → **0** (both consume the seam type only, QA-07/D-09).
- `rg "from '@deepgram/sdk'" src --files-with-matches` → **only `src/main/stt/deepgram-stt.gateway.ts`** (`index.ts` and `overlay-window.manager.ts` absent — seam discipline intact).
- `gateway.on('utterance', …)` binding is present exactly once and lives inside `attachSttGatewayHandlers` (line 357, between the transcript push and the connection-state binding) — re-key safe.
- The `'clear-transcript'` handler calls `buffer.clear()`, `utterances.length = 0`, and `sttGateway?.clearSpeakers()` before pushing `utterances: []` (D-05).
- No new `ipcMain.handle`/`ipcMain.on`/`webContents.send` channel was introduced for utterances (the pre-existing `jedi:copy-selection` and four `settings:*` channels are unchanged).
- `npx oxlint` on both touched files: clean (no diagnostics).

## Deviations from Plan

None — the plan executed exactly as written. Both tasks are pure `type="auto"` (not `tdd="true"`), so no RED/GREEN cycle applied; the existing gateway unit suite plus the project-wide typecheck are the behavior gate for this wiring-only slice. No auto-fixes (Rules 1–3) and no architectural decisions (Rule 4) were needed.

## Threat Surface Scan

No new security-relevant surface was introduced. Per the plan threat register: the utterance list crosses to the overlay over the EXISTING one-way `jedi:transcript` channel (no reverse control channel), carrying only `IUtteranceEvent` fields (text/speaker/classification) — no secret (T-8-07 mitigated); no `ipcMain.handle`/`ipcMain.on`/new channel was added (T-8-08 mitigated); the main-owned list is session-scoped and drained on Ctrl+Alt+K (T-8-09 accepted, unbounded-growth is bounded in practice and by the clear chord); no package installs (T-8-SC — no slopcheck needed).

## Known Stubs

None. The utterance stream is fully wired end-to-end into the overlay payload on both the boot and re-key paths, and Ctrl+Alt+K resets transcript + utterances + Person N together. The renderer-side card panel that RENDERS `IOverlayTranscript.utterances` is intentionally deferred to Phase 9 (per this plan's objective — this phase is the data layer only; the payload is populated and pushed, the visual card panel is the next phase's work).

## Self-Check: PASSED

Modified files verified present:
- FOUND: src/main/overlay-window.manager.ts
- FOUND: src/main/index.ts

Commits verified present in git log: `0d2d532`, `3ece163`.
