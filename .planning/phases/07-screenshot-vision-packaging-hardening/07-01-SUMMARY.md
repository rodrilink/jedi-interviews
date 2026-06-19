---
phase: 07-screenshot-vision-packaging-hardening
plan: 01
subsystem: vision
tags: [vision, screenshot, anthropic, ai-orchestration, electron, hotkeys, renderer]
requires:
  - The Phase-5 AI path (IAiGateway/AnthropicGateway, AiOrchestrator single-in-flight, PromptAssembler, AiHistory, AI panel)
  - getActiveContext() grounding provider (Phase 6 D-10)
  - setContentProtection(true) overlay self-exclusion (Phase 1, verified at the 07-02 gate)
  - HotkeyRegistrarService / HOTKEY_CHORDS + register().failed surfacing (Phase 2/4/5/6)
provides:
  - Ctrl+Alt+C screenshot-solve mode end-to-end (capture -> downscale -> Opus stream -> dedicated vision panel)
  - Pure fitLongEdge / toBase64Png downscale utility (VISION_MAX_LONG_EDGE=1568, prefix-free base64)
  - ScreenshotService active-monitor capture (getDisplayMatching + scaleFactor thumbnail + source-select)
  - Image seam on the AI path (optional IAiPromptRequest.image; assembler image branch; VISION_SYSTEM_PROMPT)
  - code-challenge AiMode under the single-in-flight orchestrator (CODE_CHALLENGE_MODEL=claude-opus-4-8)
  - Three-way focus cycle (transcript -> ai -> vision) + activePanel widened to 'vision'
  - Opt-in hardware-acceleration fallback (JEDI_DISABLE_GPU=1, top-level before app.ready)
affects:
  - src/main/ai/* (AiMode widened, content type widened — text modes byte-for-byte unchanged)
  - src/renderer (ai-panel excludes code-challenge entries; new vision-panel; activePanel mirrors widened)
tech-stack:
  added: []
  patterns:
    - "Extend the seam, don't fork it: vision rides an optional image field on IAiPromptRequest (no new gateway method)"
    - "Main owns all IO/state; renderer is a pure one-way view of jedi:ai (IN-01)"
    - "Per-mode named model + max-tokens constants (re-tierable)"
    - "By-convention singleton (no @singleton(); no TSyringe in main)"
    - "Report-don't-throw on a capture/transport fault (inline error entry, never crash main)"
    - "Co-located *.test.ts (no test/ subdir)"
key-files:
  created:
    - src/main/vision/downscale.utility.ts
    - src/main/vision/downscale.utility.test.ts
    - src/main/vision/screenshot.service.ts
    - src/main/vision/screenshot.service.test.ts
    - src/renderer/src/components/vision-panel.tsx
  modified:
    - src/main/ai/ai-gateway.interface.ts
    - src/main/ai/prompt-assembler.ts
    - src/main/ai/prompt-assembler.test.ts
    - src/main/ai/anthropic-ai.gateway.ts
    - src/main/ai/ai-orchestrator.ts
    - src/main/ai/ai-orchestrator.test.ts
    - src/main/hotkey-registrar.service.ts
    - src/main/index.ts
    - src/main/overlay-window.manager.ts
    - src/preload/index.ts
    - src/renderer/src/App.tsx
    - src/renderer/src/assets/hud.css
    - src/renderer/src/components/ai-panel.tsx
    - src/renderer/src/components/debug-hud.tsx
decisions:
  - "Threaded the capture seam into the orchestrator as a () => Promise<{base64,mediaType}> closure (6th constructor arg) — same pattern as getActiveContext; defaults to a rejecting stub so a mis-wired code-challenge surfaces inline rather than crashing."
  - "code-challenge reserves the request id + pushes thinking… SYNCHRONOUSLY before the async capture, so a re-press / cross-mode press during capture cancels the pending request (request-id guard drops the resolved capture) — single-in-flight holds across all three modes."
  - "ai-panel excludes code-challenge entries at the thinking/empty start (skip), so later delta/done by that id are no-ops there — clean dedicated-panel split with no new channel (D-08)."
  - "VisionPanel takes over the AI-panel region as an absolutely-positioned overlay in a new .overlay-column wrapper, shown only when active/streaming/has-content (D-10) — avoids a permanent 3-way split on the fixed 900x700 overlay."
  - "Vision API facts confirmed via the claude-api skill (Task 5, skill-confirms): claude-opus-4-8, image-before-text base64 block (no data: prefix), image/png, max_tokens 1500, 1568 downscale — no code changes."
metrics:
  duration_minutes: 17
  completed: 2026-06-19
  tasks: 5
  files: 19
---

# Phase 7 Plan 01: Screenshot Vision Slice Summary

Screenshot code-challenge solving on `Ctrl+Alt+C`: capture the overlay's monitor, downscale to <=1568px long edge in main, stream a `claude-opus-4-8` solution (grounded in active session context + transcript span) into a dedicated vision panel — riding the entire Phase-5 AI path via one optional `image` field.

## What Was Built

- **Pure downscale math (`downscale.utility.ts`):** `fitLongEdge` (only-if-larger, aspect-preserving) + `VISION_MAX_LONG_EDGE=1568` (with the Pitfall-5 comment that Opus allows 2576) + `toBase64Png` producing RAW prefix-free base64 via `.toPNG().toString('base64')` (no `data:` URL). Unit-tested incl. an explicit no-`data:`-substring assertion.
- **`ScreenshotService`:** `captureForOverlay(window)` resolves `screen.getDisplayMatching(overlay.getBounds())` (D-01), captures that display at real pixels (`thumbnailSize` scaled by `scaleFactor`, Pitfall 3), and selects the source via the pure unit-tested `selectSourceForDisplay` (match by `String(display.id)`, fallback `sources[0]`, `undefined` on empty). Report-don't-throw on no source.
- **Image seam on the AI path:** `AiMode += 'code-challenge'`; `IAiPromptRequest.userContent` widened to `string | Anthropic.ContentBlockParam[]` + optional `image`; `prompt-assembler` gained `VISION_SYSTEM_PROMPT` and an image branch that emits `[{image},{text}]` (image first) reusing the SAME context+span text block (D-07) — **text modes are byte-for-byte unchanged** (regression-tested). Gateway `content` type widened (no logic change; never logs the base64). Orchestrator: `CODE_CHALLENGE_MODEL='claude-opus-4-8'`, `MAX_TOKENS['code-challenge']=1500`, the empty-span guard bypassed for vision, and an async capture branch that holds single-in-flight across all three modes.
- **Wiring + UI:** `Ctrl+Alt+C` `capture-code-challenge` chord; `JEDI_DISABLE_GPU` top-level fallback; `ScreenshotService` constructed once and threaded as a capture closure into the orchestrator; three-way focus cycle (transcript -> ai -> vision) with `activePanel` widened to `'vision'` across main/preload/renderer; a dedicated `vision-panel.tsx` (bounded local history D-09, escaped `<pre>` code render — no raw-HTML injection, takeover layout D-10).

## Verification

- `npm test` — **153 passed / 20 files** (downscale math, source-select helper, assembler image branch + text-mode regression, orchestrator empty-span bypass + 3-mode cross-cancel + capture-fault).
- `npm run typecheck` (node + web) — clean.
- `npm run lint` (oxlint) — clean.
- Wiring assertion — prints `wiring ok` (chord in registrar, handler in index.ts, no raw-HTML injection in vision-panel).
- Live capture -> stream -> vision panel is manual/integration, deferred to the 07-02 packaged on-machine gate (D-13d).

## Deviations from Plan

None — plan executed as written. The four `type="auto"` tasks were implemented exactly per the task specs and pattern map; the `checkpoint:decision` (Task 5) resolved as `skill-confirms` (all six vision API facts confirmed via the claude-api skill, no code changes).

## Authentication Gates

None encountered during implementation. The end-to-end screenshot-solve requires a live `ANTHROPIC_API_KEY` (already configured per Phase 6 D-08: safeStorage -> .env -> '') and is exercised only at the 07-02 manual gate, not in this plan's unit scope.

## Known Stubs

None. The `captureImage` constructor arg defaults to a rejecting stub ONLY as a fail-safe when no capture seam is wired; in production `index.ts` always supplies the real `ScreenshotService` closure, so the live path is fully wired.

## Notes for Downstream (07-02 / 07-03)

- The `Ctrl+Alt+C` chord uses `C`, OUTSIDE the locked conflict-tested set — the 02-03 Teams/Zoom/VS Code re-check is pending at the 07-02 manual gate (documented fallback: `V` for "vision").
- Content-protection self-exclusion from `desktopCapturer` (D-02) is VERIFIED at the 07-02 gate, not coded here (Pitfall 1; hide-capture-reshow fallback documented if a gap is found).
- `JEDI_DISABLE_GPU=1` and the vision `max_tokens=1500` are the two knobs to exercise/tune at the 07-02 latency + hardware-accel gate.

## Self-Check: PASSED

All 5 created files exist on disk; all 4 per-task commits (`eb2010f`, `f2158c9`, `ece4c2b`, `028f3ec`) are present in the git log.
