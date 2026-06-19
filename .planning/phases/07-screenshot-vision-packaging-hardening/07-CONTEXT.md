# Phase 7: Screenshot Vision + Packaging & Hardening - Context

**Gathered:** 2026-06-19
**Status:** Ready for planning

<domain>
## Phase Boundary

Deliver the **third AI mode** — press a hotkey, capture a screenshot of a code challenge, and get a
**streaming AI solution** grounded in the active session context — PLUS a **runnable, hardened Windows
`.exe`** on which the three existential behaviors (transparent overlay, never steals focus, invisible to
screen-share) still hold. Covers requirements **AI-03** (screenshot → AI code-challenge solution) and
**PKG-01** (packaged Windows executable with transparency / focus / content-protection intact).

The phase has two distinct concerns under one roof:
1. **Vision mode** — a new capture path + an image-carrying extension of the existing Phase-5 AI seam.
2. **Packaging & hardening** — `electron-builder` portable `.exe`, native-module bundling, an on-machine
   verification gate, and the ROADMAP 07-03 hardening set.

**Locked upstream (do NOT re-litigate):**
- **Vision reuses the ENTIRE Phase-5 AI path.** The orchestrator, gateway seam (`IAiGateway`), prompt
  assembler, streaming render, single-in-flight + cancel semantics, AI-panel scroll/focus model — all are
  built and proven. Vision adds only: an image source, an optional image on the prompt request, a vision
  system prompt, an Opus model route, and a dedicated output panel. It does NOT redesign the AI path.
- **All AI orchestration + image work runs in the Electron MAIN process; the renderer is a pure one-way
  view (IN-01).** The screenshot capture, downscale, base64 encoding, prompt assembly, and stream lifecycle
  live in main. The renderer only renders pushed AI/vision text + state. No renderer→main control surface
  for the overlay.
- **Single-in-flight invariant holds across ALL THREE modes (Phase 5 D-06/D-07).** One `AiOrchestrator`,
  one active request at a time. Re-pressing the vision chord mid-stream cancels it; pressing another mode
  mid-vision-stream cancels vision and starts the new one. No concurrent Opus + Haiku calls.
- **Anthropic key sourcing is settled (Phase 6 D-08): `safeStorage` wins → `.env` fallback → `''`.** Vision
  uses the same already-keyed `AnthropicGateway`; no new key path.
- **The grounding seam is filled (Phase 6 D-10):** the orchestrator pulls the active session context fresh
  at each trigger via `getActiveContext()`. Vision grounds through this same provider — no new wiring.
- **Hotkeys register through `HotkeyRegistrarService` / `HOTKEY_CHORDS`** (`src/main/hotkey-registrar.service.ts`).
  Taken Ctrl+Alt letters: J, Left/Right/Up/Down, [, ], H, Q, K, PageUp/PageDown, A, T, G, F, S. The new
  screenshot chord gets the 02-03 Teams/Zoom/VS Code conflict re-check like every other chord.
- **Content protection is already on the overlay** (`setContentProtection(true)`, re-applied after every
  show — `overlay-window.manager.ts:336,395`). The overlay is therefore naturally excluded from its own
  screenshot capture (success criterion 2). Do NOT add separate exclusion logic — verify the existing
  protection covers the capture path.
- **A minimal portable `electron-builder.yml` already exists** from the Phase 1 transparency smoke test
  (portable Windows target). Phase 7 extends it for the full PKG-01 package; it is NOT a greenfield config.
- The ROADMAP 3-plan shape (07-01 ScreenshotService + downscale + image block + Opus routing + chord /
  07-02 electron-builder packaging + packaged-build verification + hardware-accel fallback / 07-03 latency
  instrumentation + SmartScreen doc + hotkey-config recovery) is the agreed breakdown; planner refines.

**Mode:** mvp — ship the working screenshot-solve and a runnable portable `.exe` verified on the target
machine. Drop the Whisper stub (v2; the `ISttProvider` seam is already proven by TRN-05).

**RESEARCH FLAG (ROADMAP):** "Phase 7 API shape" — the **`claude-api` skill MUST be consulted at
research/build time** for the current vision request shape (image content-block format, base64 with NO
data-URL prefix, supported media types), the `claude-opus-4-8` model id, and streaming + max-tokens
guidance. This is the authoritative source; ignore vision/model details memorized elsewhere.

</domain>

<decisions>
## Implementation Decisions

### Screenshot Capture — target, exclusion, trigger (AI-03)
- **D-01:** **Capture the monitor the OVERLAY sits on**, resolved via
  `screen.getDisplayMatching(overlayWindow.getBounds())` (or `getDisplayNearestPoint` on the overlay's
  center). This is deterministic, needs **no native foreground-window lookup** (the project avoids extra
  native surface), and works while the meeting app holds focus and the overlay never does. The user parks
  the overlay on the screen showing the challenge, then presses the chord. Capture uses `desktopCapturer`
  (the standard path; success criterion mentions desktopCapturer) for that one display.
- **D-02:** **The overlay excludes itself from the capture via the EXISTING content protection.** The
  overlay already runs `setContentProtection(true)`, re-applied after every show. The planner VERIFIES
  this protection excludes the overlay from the `desktopCapturer` capture path (it excludes the overlay
  from screen-share, which is the same Windows mechanism); no separate hide/exclude logic is added. If a
  gap is found, the documented fallback is a brief hide-capture-reshow, but content protection is the
  expected sufficient mechanism.
- **D-03:** **Trigger = `Ctrl+Alt+C`** ("capture" / "code challenge"). One-shot per press (a `discrete`
  chord). `C` is outside the locked conflict-tested set; the planner re-verifies it against Teams/Zoom/
  VS Code per the 02-03 protocol with a documented fallback letter if it collides. It adds to
  `HOTKEY_CHORDS` exactly like every other chord (handler wired in `index.ts`, missing-handler surfaces in
  `register().failed` / CTL-03).

### Vision Request Shape — image seam, downscale, model, grounding (AI-03)
- **D-04:** **Carry the image via an OPTIONAL image field on the existing `IAiPromptRequest`** (e.g.
  `image?: { base64: string; mediaType: string }`). The `PromptAssembler` builds Anthropic **content
  blocks** `[{ type: 'image', source: {...} }, { type: 'text', text: ... }]` when an image is present, and
  the current plain-string user content when it is absent. The `AnthropicGateway.stream()` passes
  `messages: [{ role: 'user', content }]` where `content` is either the string (text modes) or the block
  array (vision). **One seam, no new gateway method**, backward-compatible with answer/talking-points. This
  mirrors the Phase-5 "extend the existing seam, don't fork it" discipline. (The `claude-api` skill confirms
  the exact block shape and that the base64 has **no `data:` URL prefix**.)
- **D-05:** **Downscale happens in MAIN, before the gateway.** The `ScreenshotService` captures, downscales
  the image to **≤1568px on the long edge** (success criterion 2), and produces base64 (no data-URL prefix)
  + the media type, handing the ready image to the orchestrator. All image work stays main-side (IN-01); no
  renderer canvas, no extra IPC round-trip. The planner picks the lightest main-side resize (e.g.
  `nativeImage.resize`).
- **D-06:** **Model = `claude-opus-4-8`** for the code-challenge mode, as a per-mode named constant (mirrors
  Phase 5 D-10's per-mode model constants so it can be re-tiered later without rework). The ROADMAP routes
  vision/hard solving to Opus; confirm the exact id via the `claude-api` skill.
- **D-07:** **Vision IS grounded.** The code-challenge prompt includes **the captured image + the active
  session context (via the same `getActiveContext()` provider) + the recent transcript span**. The image is
  the problem, the session context grounds the answer in the real work (success criterion 1 explicitly says
  "grounded in the active session context"), and the transcript span is included because **the interviewer
  may narrate constraints aloud** that aren't in the screenshot. A vision-specific system prompt instructs
  the model to solve the code challenge shown in the image. The empty-span guard does NOT block vision (the
  image alone is enough to act on) — planner ensures vision triggers even with an empty transcript span.

### Vision Output & UX — dedicated panel, history, focus, layout (AI-03/AI-04/AI-05)
- **D-08:** **A DEDICATED vision panel**, separate from the answer/talking-points AI panel. Code solutions
  are long and contain code blocks, so they read better isolated rather than stacked with short answers.
  The solution streams token-by-token into this panel (AI-04), reusing the Phase-5 streaming/`thinking…`/
  error/cancel inline-state render (D-04 of Phase 5) and the debounced-append pattern.
- **D-09:** **The vision panel keeps its OWN bounded stacked history** (same bound style as the AI panel /
  `TranscriptBuffer` — last-N-entries and/or char ceiling, planner sets it) so prior solutions remain
  scrollable, and it **joins the `Ctrl+Alt+F` focus-cycle as a THIRD target** (transcript → AI → vision).
  The existing `Ctrl+Alt+PgUp/PgDn` scroll whichever panel is active (Phase 5 D-08 focused-panel model,
  extended from two panels to three). The corner active-panel indicator gains the vision state.
- **D-10:** **The vision panel is shown only when it is active / has content.** It takes over the AI-panel
  region (overlays/replaces it) while focused or streaming; otherwise the Phase-5 layout (HUD + AI panel)
  is unchanged. This avoids permanently shrinking the answer panel on the fixed **460×700, `resizable:false`**
  overlay — a permanent three-way split would make code output unreadably cramped. Exact visibility/takeover
  behavior is a UI-phase detail (this phase has a UI hint).
- **D-11:** **Same single-in-flight orchestrator across all three modes** (Phase 5 D-06/D-07, unchanged).
  `code-challenge` is added as a third `AiMode`; re-pressing `Ctrl+Alt+C` mid-stream cancels it; pressing
  answer/talking-points mid-vision cancels vision and starts the new one. One active request, ever.

### Packaging & Hardening — installer, verification, native modules, 07-03 set (PKG-01)
- **D-12:** **Ship a PORTABLE `.exe`** (single self-contained, double-click to run, no install step). Matches
  the existing `electron-builder.yml` portable target and the "personal single-user tool" framing
  (CLAUDE.md / PROJECT.md). No NSIS installer / uninstaller / Start-menu machinery for v1 (avoids a second
  SmartScreen prompt and extra surface). NSIS remains a documented later option.
- **D-13:** **Verification is an ON-MACHINE MANUAL GATE with a committed VERIFICATION.md**, same style as
  the Phase 1 `01-04` GO/NO-GO gate. Build the portable `.exe`, run it on the target Windows 11 machine, and
  human-verify: (a) the overlay renders **transparent**, (b) it **never steals focus** from the active app,
  (c) it is **absent from screen-share** (content protection holds), and (d) a real **screenshot-solve**
  works end-to-end in the packaged build. These three existential behaviors are inherently human-judged
  (the Phase 1 precedent), so the gate is manual; record the result + the pinned Electron version.
- **D-14:** **Native modules must be correctly bundled.** `uiohook-napi` AND `native-recorder-nodejs` are
  native `.node` addons — they must be **`asarUnpack`'d** (extracted from the asar so the OS can load them)
  and **rebuilt for the Electron ABI** (`@electron/rebuild`, already a dependency / `npm run rebuild`).
  If they are not unpacked/rebuilt, hotkeys and audio capture **silently break in the package** while
  working in dev — this is a load-bearing packaging risk the verification gate (D-13) must catch.
- **D-15:** **Full ROADMAP 07-03 hardening set is in scope:**
  - **Latency instrumentation** — hotkey→first-token timing (extend the Phase-5 latency log to the vision
    mode; log in main, never to the renderer).
  - **SmartScreen documentation** — the unsigned portable `.exe` triggers a Windows SmartScreen warning;
    document this as **accepted friction** (how to click through "Run anyway") rather than buying a code
    signing certificate for a personal tool (success criterion 4).
  - **Hardware-acceleration fallback** — a documented/coded path to disable GPU acceleration
    (`app.disableHardwareAcceleration()`) if transparency rendering glitches on the target machine in the
    packaged build (CLAUDE.md flags transparent-window rendering fragility).
  - **Hotkey-config recovery** — graceful behavior if hotkey registration fails in the package (the
    `register().failed` surfacing already exists per CTL-03; harden the recovery/visibility path).
- **D-16:** **The Whisper stub gateway is DROPPED from Phase 7.** Local Whisper is explicitly v2 / out of
  scope (REQUIREMENTS, PROJECT.md), and the `ISttProvider` seam already proves swappability (TRN-05). A stub
  adds surface with zero v1 user value. (ROADMAP 07-03 listed it; this discussion removes it.)

### Claude's Discretion
- **Exact downscale algorithm / library** (`nativeImage.resize` vs a small image lib) and the exact
  long-edge handling (only-if-larger; preserve aspect ratio) — planner picks the lightest main-side path
  (D-05), confirming the Anthropic-recommended max dimension via the `claude-api` skill.
- **Exact `IAiPromptRequest.image` field shape** and how `PromptAssembler` branches string-vs-blocks — planner
  designs it to keep answer/talking-points byte-for-byte unchanged (D-04).
- **The vision system prompt wording** — planner/researcher drafts it (solve the code challenge in the image,
  spoken/usable-code style), consulting the `claude-api` skill, same DRAFT-tunable caveat as the Phase-5
  prompts.
- **Vision-panel bounds, exact takeover/visibility animation, and corner-indicator styling** — UI-phase /
  planner (D-08/D-09/D-10); the overlay is `resizable:false` so layout is fixed.
- **The fallback chord letter** if `Ctrl+Alt+C` collides in the conflict re-check (D-03).
- **The `MAX_TOKENS` for vision** — planner sets a per-mode constant (code solutions are longer than answers);
  confirm a sane ceiling via the `claude-api` skill.
- **electron-builder specifics** — `asarUnpack` glob patterns for the two native modules, `buildResources`
  layout, app icon, portable artifact name (D-12/D-14).
- **Whether content protection needs the hide-capture-reshow fallback** (D-02) — planner decides after
  verifying the existing protection covers the `desktopCapturer` path.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope & requirements
- `.planning/ROADMAP.md` §"Phase 7: Screenshot Vision + Packaging & Hardening" — goal, the 4 success
  criteria (screenshot→streaming solution grounded in active context; overlay excluded from its own
  screenshot + downscale ≤1568px long edge + vision/Opus routing; runnable Windows `.exe` with transparency/
  focus/content-protection intact on the target machine; latency instrumented + SmartScreen documented as
  accepted friction), the 3 plans (07-01 ScreenshotService + downscale + image block + Opus + chord / 07-02
  packaging + packaged-build verification + hardware-accel fallback / 07-03 latency + SmartScreen doc +
  hotkey-config recovery), and the **Notes** (vision reuses the entire Phase-5 AI path adding only an image
  source + Opus switch; confirm vision request shape + model IDs via the `claude-api` skill — research flag
  "Phase 7 API shape"; base64 image field has NO data-URL prefix; PKG-01 fully owned here, the Phase 1
  packaged smoke only de-risked transparency rendering; standard electron-builder NSIS patterns).
- `.planning/REQUIREMENTS.md` §"AI Assistance" **AI-03** (screenshot → AI code-challenge solution) and
  §"Packaging" **PKG-01** (runnable Windows executable with transparency/focus/content-protection intact).
  **Note:** all other AI/CTX/SET/OVL/TRN requirements are Complete in Phases 1–6.
- `.planning/PROJECT.md` — Key Decisions (Claude Opus 4.8 for hard code-challenge solving; hotkey-driven AI
  triggers; paste-based grounding context — vision grounds on the same store) and the focus-discipline /
  privacy / cost / "personal single-user tool" constraints (the portable-`.exe` and SmartScreen-friction
  decisions follow from these).

### Stack & implementation guidance (READ for the SDK + packaging shape)
- **`claude-api` skill** — MUST be consulted at research/build time (ROADMAP research flag "Phase 7 API
  shape") for: the **vision content-block shape** (`{ type: 'image', source: { type: 'base64', media_type,
  data } }` with **NO `data:` URL prefix**), the `claude-opus-4-8` model id, supported image media types and
  the recommended max dimension (≤1568px long edge), streaming + `max_tokens` for vision. Authoritative —
  ignore vision/model details memorized elsewhere (D-04/D-05/D-06).
- `CLAUDE.md` (project root) §"@anthropic-ai/sdk" — `@anthropic-ai/sdk@0.104.2`, screenshot mode sends a
  user message with content blocks `[{ type: 'image', source: { type: 'base64', data, media_type } }, { type:
  'text', text }]`; §"Screenshot capture (code-challenge mode)" + "desktopCapturer vs screenshot-desktop"
  (desktopCapturer is the default; screenshot-desktop only for multi-monitor full-res edge cases); §"Overlay
  window configuration" (`setContentProtection(true)` excludes the overlay from capture — D-02);
  §"electron-builder" (`26.15.3`, NSIS/portable for Windows; decoupled from electron-vite); §Version
  Compatibility / §"What NOT to Use" (pin Electron 35.x — already at 35.7.5; native modules rebuilt against
  the Electron ABI — D-14); §"Stack Patterns by Variant" (`setAlwaysOnTop(true,'screen-saver')`, enable
  content protection, hardware-accel fragility for transparent windows — D-15).

### Prior-phase decisions this phase builds on
- `.planning/phases/05-ai-orchestration-answer-talking-points/05-CONTEXT.md` — **the ENTIRE AI path vision
  reuses**: the `IAiGateway`/`AnthropicGateway` thin-seam (D-04 extends `IAiPromptRequest`, not the gateway
  method); the `AiOrchestrator` single-in-flight + cancel semantics (D-06/D-07 → reused unchanged as D-11);
  the `PromptAssembler` (`IAssembleInput`/`assemblePrompt` — D-04 adds the image branch); the per-mode model
  constant pattern (D-10 → D-06 here); the always-on AI panel + bounded AI history + `stickToBottomRef`
  follow/pause + focused-panel `Ctrl+Alt+F` scroll model (D-01/02/03/08 → the vision panel D-08/D-09/D-10
  extend to a third panel); the latency-log (extended in D-15); the empty-span guard (D-11, which vision
  bypasses per D-07).
- `.planning/phases/06-session-context-settings-window/06-CONTEXT.md` — the `getActiveContext()` provider /
  pull-on-trigger grounding (D-10 of Phase 6) that vision grounds through (D-07 here); the `IGroundingContext`
  + `formatContext()` the vision prompt reuses; the `safeStorage`-first key resolution (Phase 6 D-08) the
  already-keyed `AnthropicGateway` uses for vision (no new key path).
- `.planning/phases/01-overlay-shell-existential-behaviors/01-CONTEXT.md` + that phase's `VERIFICATION.md` /
  `01-04` gate — the **on-machine GO/NO-GO verification pattern** the packaged-build gate (D-13) mirrors; the
  `setContentProtection` + transparent/frameless/always-on-top/`focusable:false` overlay config the packaged
  build must preserve (D-02/D-13); the pinned Electron 35.7.5 the package targets; the early packaged
  transparency smoke test that this phase's full PKG-01 completes.
- `.planning/phases/02-global-hotkeys-window-control/02-CONTEXT.md` + `02-HOTKEY-CONFLICT-TEST.md` — the
  `HotkeyRegistrarService` / `HOTKEY_CHORDS` registration + `register().failed` surfacing the new
  `Ctrl+Alt+C` chord adds to and must be conflict-tested against (D-03); the native `uiohook-napi`
  rebuild discipline the packaging step must preserve (D-14).
- `.planning/phases/04-stt-pipeline-live-transcript/04-CONTEXT.md` (+ `03-LOOPBACK-GATE.md` / PROJECT.md) —
  the `native-recorder-nodejs` WASAPI capture that is the SECOND native module to `asarUnpack`/rebuild in the
  package (D-14); the main-owns-IO / renderer-one-way-view boundary the screenshot/downscale path keeps (D-05).

### Code to extend / build on (see code_context)
- `src/main/ai/ai-gateway.interface.ts` — `IAiPromptRequest` gets the optional `image` field; `AiMode`
  gains `'code-challenge'` (D-04/D-11). The event-emitter contract is unchanged.
- `src/main/ai/anthropic-ai.gateway.ts` — `stream()` (`messages: [{ role:'user', content }]`, line ~73)
  builds `content` as either the string or the image+text block array (D-04); the live-rekey path is reused
  as-is.
- `src/main/ai/prompt-assembler.ts` — `assemblePrompt`/`IAssembleInput`/`formatContext` (the four-field
  `IGroundingContext`) — add the image branch + the vision system prompt; text modes stay byte-for-byte
  identical (D-04/D-07).
- `src/main/ai/ai-orchestrator.ts` — `trigger(mode)` (line ~?, the single `assemblePrompt` call site) gains a
  `code-challenge` path that captures+downscales the screenshot, passes the image into `assemblePrompt`, and
  routes Opus; the single-in-flight/cancel logic is reused unchanged (D-05/D-06/D-07/D-11). Constructor may
  gain a `ScreenshotService` (or a capture closure) the same way it took `getActiveContext`.
- `src/main/overlay-window.manager.ts` — `setContentProtection(true)` (lines 336, 395) is the overlay
  self-exclusion (D-02); `createOverlayWindow()` bounds feed `screen.getDisplayMatching` for the active
  monitor (D-01); the `pushAi`/AI-output channel pattern is the template for a vision-output push (D-08).
- `src/main/hotkey-registrar.service.ts` — `HOTKEY_CHORDS` is where `Ctrl+Alt+C` is added (D-03);
  `register().failed` surfacing reused; native rebuild discipline preserved in packaging (D-14).
- `src/renderer/src/components/debug-hud.tsx` (+ the Phase-5 AI panel component) — the streaming render +
  `stickToBottomRef` follow/pause + focused-panel scroll the vision panel reuses and extends to a third
  panel (D-08/D-09/D-10).
- `electron-builder.yml` (repo root) — the existing minimal portable config to extend for PKG-01:
  `asarUnpack` for `uiohook-napi` + `native-recorder-nodejs`, build resources, icon (D-12/D-14).
- `package.json` — `"package": "electron-vite build && electron-builder --win"` and `"rebuild":
  "electron-rebuild -f -w uiohook-napi"` (extend rebuild to cover `native-recorder-nodejs` too — D-14).

No external ADRs/specs beyond the `.planning/` docs, `CLAUDE.md`, and the `claude-api` skill above —
requirements are fully captured in the decisions and the ROADMAP/REQUIREMENTS refs.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **The whole Phase-5 AI path** — `IAiGateway`/`AnthropicGateway` (thin seam over `@anthropic-ai/sdk`,
  event-emitter, report-don't-throw), `AiOrchestrator` (single-in-flight + abort + request-id guards),
  `prompt-assembler.ts` (`assemblePrompt`/`formatContext`/`IGroundingContext`), the bounded `AiHistory`, and
  the always-on AI panel render. Vision extends these; it builds almost nothing new on the AI side beyond an
  image branch and a vision prompt.
- **`getActiveContext()` provider** (Phase 6 D-10, wired at `index.ts:331`) — the orchestrator already pulls
  the active session context fresh at each trigger; vision grounding (D-07) reuses it with no new wiring.
- **`setContentProtection(true)`** (`overlay-window.manager.ts:336,395`) — the overlay's screen-share/capture
  exclusion is the same mechanism that excludes it from its own `desktopCapturer` screenshot (D-02).
- **`HotkeyRegistrarService` / `HOTKEY_CHORDS`** — the new `Ctrl+Alt+C` chord registers exactly like the
  Phase 2/4/5/6 chords with `register().failed` surfacing (D-03).
- **The Phase-5 focused-panel model** (`Ctrl+Alt+F` cycle + corner indicator + `Ctrl+Alt+PgUp/PgDn` scroll
  the active panel) — extends from two panels to three for the vision panel (D-09).
- **The existing portable `electron-builder.yml`** + `npm run package` + `npm run rebuild` — the packaging
  scaffold to extend, not create (D-12/D-14).
- **The Phase 1 `01-04` on-machine GO/NO-GO `VERIFICATION.md`** — the verification-gate template for the
  packaged-build check (D-13).

### Established Patterns
- **Main owns IO/state; the renderer is a pure one-way view (IN-01).** Screenshot capture, downscale, base64,
  prompt assembly, and stream lifecycle all live in main (D-05); the renderer renders pushed vision text +
  active-panel state.
- **Extend the seam, don't fork it** — the image rides an optional field on the existing `IAiPromptRequest`
  rather than a new `streamVision()` method, keeping the single gateway/orchestrator lifecycle (D-04). Same
  discipline as Phase 5/6 filling existing seams.
- **Single-in-flight across all modes** (Phase 5 D-06/D-07) — one orchestrator, one active request; vision is
  just a third mode under the same invariant (D-11).
- **Per-mode model as a named constant** (Phase 5 D-10) — `code-challenge → claude-opus-4-8` is a per-mode
  constant, re-tierable later (D-06).
- **Native modules rebuilt against the Electron ABI** (`uiohook-napi` already; `native-recorder-nodejs` is
  the second) and `asarUnpack`'d in the package — or hotkeys/audio silently break in the `.exe` (D-14).
- **On-machine human-judged GO/NO-GO gates for existential behaviors** (Phase 1, Phase 3) — the packaged-build
  transparency/focus/content-protection check is one of these (D-13).
- **Strict TS / IDEXX standards** — explicit return types, single quotes, 4-space, TSDoc on exports;
  co-located Vitest for unit-testable pieces (the downscale math / "only-if-larger, preserve aspect ratio"
  utility, the `assemblePrompt` image-branch, the active-monitor resolution are unit-testable; live capture,
  streaming, and the packaged build are integration/manual-gate level).

### Integration Points
- **Screenshot chord (main) → `ScreenshotService` capture the overlay's display (D-01) → downscale ≤1568px +
  base64 in main (D-05) → `AiOrchestrator.trigger('code-challenge')` → `assemblePrompt({ mode, span,
  context, image })` (D-04/D-07) → `AnthropicGateway.stream` with Opus (D-06) → vision-output push → dedicated
  vision panel render (D-08).** All main-side except the final push.
- **Vision grounding:** `getActiveContext()` (Phase 6) + `transcriptBuffer.recentSince` (Phase 5) + the
  captured image all feed the one prompt (D-07).
- **Packaging:** `npm run package` (electron-vite build → electron-builder portable) with `asarUnpack` for the
  two native modules (D-12/D-14) → run the `.exe` on the target machine → manual existential + screenshot-solve
  gate → committed `VERIFICATION.md` (D-13).
- **No new runtime dependency expected** — `desktopCapturer` + `nativeImage` are Electron built-ins; the AI
  SDK is already present; electron-builder is already a devDependency. (Planner confirms whether a small image
  lib beats `nativeImage.resize`, but the default is no new dep — D-05.)

</code_context>

<specifics>
## Specific Ideas

- **The screenshot grabs the monitor the overlay is parked on** — the user's workflow is "move the overlay
  to the screen with the challenge, press Ctrl+Alt+C." Deterministic, no native foreground lookup, works while
  the meeting app holds focus (D-01).
- **The overlay disappearing from its own screenshot is FREE** — the content protection that hides it from
  screen-share is the same Windows mechanism that hides it from `desktopCapturer`; verify, don't rebuild (D-02).
- **Vision is "answer/talking-points + an image"** — the user explicitly wants it to reuse the whole AI path;
  the only genuinely new pieces are the capture+downscale and a dedicated panel for the longer code output.
- **A dedicated vision panel because code is long** — code solutions don't read well stacked with one-line
  talking points; they get their own scrollable surface that only takes over the screen when active (D-08/D-10),
  preserving the small fixed 460×700 overlay's usability.
- **Vision still grounds on session context AND transcript** — the session context is the real-work grounding;
  the transcript is kept because an interviewer often narrates constraints aloud that aren't on screen (D-07).
- **Portable `.exe`, SmartScreen friction accepted** — this is a personal single-user tool, so an unsigned
  portable `.exe` with a documented "Run anyway" step beats buying a code-signing cert (D-12/D-15).
- **The packaged build must be human-verified on the machine** — transparency/focus/content-protection are the
  existential behaviors; a green build that black-boxes on screen-share or steals focus is a failure. Same gate
  discipline as Phase 1 (D-13).

</specifics>

<deferred>
## Deferred Ideas

- **Whisper / local STT stub gateway** — listed in ROADMAP 07-03 but DROPPED (D-16): local Whisper is v2 /
  out of scope, and the `ISttProvider` seam already proves swappability (TRN-05). No stub is built.
- **NSIS installer (Start-menu shortcut, uninstaller)** — v1 ships a portable `.exe` (D-12); NSIS is a
  documented later option if the tool ever needs a real install footprint.
- **Code signing certificate** — not for a personal tool; SmartScreen friction is documented and accepted
  instead (D-15). Revisit only if distributed beyond the owner.
- **Region-select / draw-a-rectangle screenshot** — rejected for v1: it needs a focusable selection surface,
  which conflicts with the keyboard-only / never-steal-focus discipline (capture is whole-monitor, D-01).
- **Capturing the OS-foreground window's monitor (native foreground lookup)** — rejected: adds native surface
  the project avoids; the overlay's own monitor is the deterministic proxy (D-01).
- **Permanent three-way panel split** — rejected: too cramped on the fixed 460×700 overlay; the vision panel
  takes over only when active (D-10).
- **Per-mode different grounding (vision reads different context fields than answer)** — not needed; all modes
  ground on the same active context via `getActiveContext()` (Phase 6 D-10). Easy to split later since context
  and image are per-call arguments.

### Reviewed Todos (not folded)
Three pending todos keyword-matched Phase 7 but were reviewed and NOT folded — all belong to earlier phases'
surfaces, and folding overlay/audio fixes into the vision+packaging phase would be scope creep:
- **`260617-code-review-audio-seam-warnings`** (WR-01/02/03) — `resolves_phase: 4`; audio-capture-seam
  warnings already addressed in Phase 4 (04-04). Not Phase 7.
- **`260618-hud-session-date-and-duration-timer`** — `relates_to_phase: 5`; a HUD/overlay enhancement
  (session date + duration timer). Renderer surface, not vision/packaging.
- **`260618-scrollbar-disappears-history-unreachable`** — `relates_to_phase: 5`; an AI-05 scrollback bug in
  the overlay's `stickToBottomRef`. A real bug, but it lives in the Phase-5 AI-panel surface; if it recurs in
  the vision panel (which reuses the same scroll model, D-09), the planner should fix it there — flag for the
  planner's awareness, but it is not Phase 7 scope on its own.

</deferred>

---

*Phase: 7-Screenshot Vision + Packaging & Hardening*
*Context gathered: 2026-06-19*
