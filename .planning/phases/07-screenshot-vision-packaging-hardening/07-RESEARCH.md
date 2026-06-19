# Phase 7: Screenshot Vision + Packaging & Hardening - Research

**Researched:** 2026-06-19
**Domain:** Electron vision capture (desktopCapturer + nativeImage), Anthropic vision API, electron-builder native-module packaging, transparent-window hardening
**Confidence:** HIGH (vision API, native-module loading, packaging) / MEDIUM (content-protection-vs-desktopCapturer exclusion behavior — needs on-machine verify)

## Summary

This phase has two halves. The **vision half** is almost entirely additive to the proven Phase-5
AI path: capture one display via `desktopCapturer`, downscale via `nativeImage.resize`, base64-encode
in main, and route an image+text content-block array through the existing `AnthropicGateway.stream()`
to `claude-opus-4-8`. The Anthropic vision request shape was confirmed directly against the official
Anthropic docs (the `claude-api` skill is NOT installed in this environment — see Assumptions Log A1):
the image block is `{ type: 'image', source: { type: 'base64', media_type, data } }`, base64 has **NO
`data:` prefix**, image-before-text ordering is recommended, and the in-use SDK `0.104.2`
`messages.stream({ messages:[{ role:'user', content: [...] }] })` accepts a content-block array
unchanged from the current string call.

**Critical correction discovered in the official docs:** `claude-opus-4-8` is a **high-resolution
model** — its native max edge is **2576px**, NOT 1568px. The CONTEXT/ROADMAP "≤1568px long edge"
target is a *locked product decision* (D-05, success criterion 2) and is still perfectly valid (it
stays well under the model limit and minimizes tokens/latency/cost). But the planner must NOT treat
1568 as the Opus model ceiling — it is a deliberate downscale floor we choose, and the assembler/
downscale code should encode 1568 as a named app constant with a comment that the model itself allows
2576. Sending 1568 is the safe, cheap, correct choice; do not "fix" it to 2576.

The **packaging half** carries the single biggest landmine, and research overturned the CONTEXT's
framing of it. Both native modules (`uiohook-napi`, `native-recorder-nodejs`) ship **N-API
prebuilds** loaded at runtime via `require(<absolute path into prebuilds/win32-x64/*.node>)`. Because
they are N-API, they are **ABI-stable across Electron versions** — `@electron/rebuild` is largely a
no-op for them and the real failure mode is NOT a missing rebuild (D-14's stated risk) but the
`.node` file being trapped inside `app.asar` where `fs.existsSync` + `require(absolutePath)` cannot
reach it. The fix is `asarUnpack` (which electron-builder's `smartUnpack` does automatically for
`*.node`, but we make it explicit and verify). The verification gate (D-13) is what actually catches
a broken package.

**Primary recommendation:** Add an optional `image` field to `IAiPromptRequest`, branch the assembler
to emit a content-block array, route `code-challenge` to `claude-opus-4-8` with `maxTokens: 1500`,
capture-and-downscale to ≤1568px in a new `ScreenshotService` using only Electron built-ins
(`desktopCapturer` + `nativeImage`, no new dependency), add `Ctrl+Alt+C`, and extend
`electron-builder.yml` with an explicit `asarUnpack: ["**/*.node", "**/node_modules/uiohook-napi/**",
"**/node_modules/native-recorder-nodejs/**"]` plus an `app.disableHardwareAcceleration()` top-level
guard behind an env/flag. Gate the package with an on-machine `07-VERIFICATION.md`.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Screenshot capture | Electron MAIN | — | `desktopCapturer` is main-process; IN-01 forbids renderer IO (D-05) |
| Active-monitor resolution | Electron MAIN | — | `screen.getDisplayMatching(window.getBounds())` is main-only API (D-01) |
| Image downscale + base64 | Electron MAIN | — | `nativeImage` is main; keep image bytes off IPC (D-05/IN-01) |
| Prompt assembly (image branch) | Pure utility (main) | — | `assemblePrompt` is a pure function; image rides as a param (D-04) |
| Vision stream lifecycle | Electron MAIN (orchestrator) | — | Single-in-flight invariant lives in `AiOrchestrator` (D-11) |
| Vision panel render | Renderer | — | Pure one-way view of pushed `jedi:ai` events (IN-01, D-08) |
| Content-protection self-exclusion | Electron MAIN (overlay manager) | OS (DWM) | `setContentProtection(true)` already applied; verify it covers capture (D-02) |
| Native-module packaging | electron-builder (build) | — | `asarUnpack` is a build-time concern, not runtime code (D-14) |
| Hardware-accel fallback | Electron MAIN (top-level) | — | `app.disableHardwareAcceleration()` must run before `app.ready` (D-15) |

## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Capture the monitor the OVERLAY sits on, via `screen.getDisplayMatching(overlayWindow.getBounds())`. `desktopCapturer` for that one display. No native foreground lookup.
- **D-02:** Overlay self-excludes from the capture via the EXISTING `setContentProtection(true)`. Planner VERIFIES; documented fallback is brief hide-capture-reshow only if a gap is found.
- **D-03:** Trigger = `Ctrl+Alt+C` (discrete, one-shot). Re-verify against Teams/Zoom/VS Code per the 02-03 protocol; documented fallback letter if it collides. Adds to `HOTKEY_CHORDS` like every other chord.
- **D-04:** Carry the image via an OPTIONAL field on `IAiPromptRequest` (e.g. `image?: { base64: string; mediaType: string }`). `PromptAssembler` builds content blocks `[{ image }, { text }]` when present, the current plain string when absent. `AnthropicGateway.stream()` passes `content` as string OR block array. One seam, no new gateway method, backward-compatible.
- **D-05:** Downscale in MAIN, before the gateway: capture → downscale ≤1568px long edge → base64 (no data-URL prefix) + media type → hand to orchestrator. All main-side. Planner picks lightest resize (e.g. `nativeImage.resize`).
- **D-06:** Model = `claude-opus-4-8` for code-challenge, as a per-mode named constant.
- **D-07:** Vision IS grounded: captured image + active session context (`getActiveContext()`) + recent transcript span. Vision-specific system prompt. Empty-span guard does NOT block vision (image alone is enough — planner ensures vision triggers with an empty transcript span).
- **D-08:** A DEDICATED vision panel, separate from the answer/talking-points panel. Streams token-by-token, reusing Phase-5 streaming/thinking/error/cancel render + debounced-append.
- **D-09:** Vision panel keeps its OWN bounded stacked history; joins the `Ctrl+Alt+F` focus-cycle as a THIRD target (transcript → AI → vision). `Ctrl+Alt+PgUp/PgDn` scroll the active panel. Corner indicator gains the vision state.
- **D-10:** Vision panel shown only when active/has content; takes over the AI-panel region while focused or streaming; otherwise Phase-5 layout unchanged. (UI-phase detail.)
- **D-11:** Same single-in-flight orchestrator across all three modes. `code-challenge` is a third `AiMode`. Re-press cancels; cross-mode cancels-and-starts. One active request, ever.
- **D-12:** Ship a PORTABLE `.exe` (single self-contained, double-click). No NSIS for v1.
- **D-13:** Verification is an ON-MACHINE MANUAL GATE with a committed `VERIFICATION.md` (Phase 1 `01-04` style): build the portable `.exe`, run on target Windows 11, human-verify (a) transparent, (b) never steals focus, (c) absent from screen-share, (d) real screenshot-solve works end-to-end. Record result + pinned Electron version.
- **D-14:** Native modules `uiohook-napi` AND `native-recorder-nodejs` must be `asarUnpack`'d and rebuilt for the Electron ABI (`@electron/rebuild` / `npm run rebuild`). If not, hotkeys+audio silently break in the package. *(Research note below refines: the load-bearing requirement is `asarUnpack`; rebuild is near-no-op for these N-API prebuilds — see Pitfall 4.)*
- **D-15:** Full 07-03 hardening set: latency instrumentation (hotkey→first-token, extend Phase-5 log, main-only); SmartScreen documentation (accepted friction, "Run anyway"); hardware-accel fallback (`app.disableHardwareAcceleration()`); hotkey-config recovery (harden `register().failed` surfacing).
- **D-16:** Whisper stub gateway is DROPPED from Phase 7 (v2 / out of scope; `ISttProvider` seam already proves swappability).

### Claude's Discretion

- Exact downscale algorithm/library (`nativeImage.resize` vs a small lib) and long-edge handling (only-if-larger; preserve aspect ratio) — pick lightest main-side path.
- Exact `IAiPromptRequest.image` field shape and how `PromptAssembler` branches string-vs-blocks — keep answer/talking-points byte-for-byte unchanged.
- The vision system prompt wording (DRAFT-tunable).
- Vision-panel bounds, takeover/visibility, corner-indicator styling (UI-phase; overlay is `resizable:false`).
- The fallback chord letter if `Ctrl+Alt+C` collides.
- `MAX_TOKENS` for vision (per-mode constant; code solutions are longer).
- electron-builder specifics: `asarUnpack` globs, `buildResources` layout, app icon, portable artifact name.
- Whether content protection needs the hide-capture-reshow fallback (decide after verifying).

### Deferred Ideas (OUT OF SCOPE)

- Whisper / local STT stub gateway (v2).
- NSIS installer (Start-menu, uninstaller) — documented later option.
- Code signing certificate — SmartScreen friction accepted instead.
- Region-select / draw-a-rectangle screenshot (needs a focusable surface — conflicts with keyboard-only).
- Capturing the OS-foreground window's monitor via native foreground lookup.
- Permanent three-way panel split.
- Per-mode different grounding.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| AI-03 | Screenshot → AI code-challenge solution, grounded in active session context | Vision content-block shape + `claude-opus-4-8` confirmed (Code Examples §1); `desktopCapturer` single-display capture (Code Examples §2); `nativeImage` downscale (Code Examples §3); reuses proven `AiOrchestrator`/`assemblePrompt`/`AnthropicGateway` seams (verified in source) |
| PKG-01 | Runnable Windows `.exe` with transparency/focus/content-protection intact | electron-builder portable + `asarUnpack` for both N-API native modules (Code Examples §4); `app.disableHardwareAcceleration()` placement (Code Examples §5); on-machine GO/NO-GO gate (D-13, Validation Architecture) |

## Standard Stack

No new runtime dependencies are needed. Everything is an Electron built-in or already installed.

### Core (all already present — verified in package.json)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `electron` | `35.7.5` (pinned) | `desktopCapturer`, `nativeImage`, `screen`, `app.disableHardwareAcceleration` | All vision-capture + hardening primitives are first-party Electron APIs `[VERIFIED: package.json]` |
| `@anthropic-ai/sdk` | `0.104.2` | Vision via `messages.stream()` with content-block array | In-use version; image-block API confirmed current against official docs `[VERIFIED: node_modules/@anthropic-ai/sdk/package.json + docs.anthropic vision]` |
| `electron-builder` | `26.15.3` | Portable Windows `.exe`, `asarUnpack`, `smartUnpack` | Already a devDependency; portable target already scaffolded `[VERIFIED: package.json]` |
| `@electron/rebuild` | `^4.0.1` | Rebuild native modules to Electron ABI | Already present; near-no-op for N-API prebuilds (Pitfall 4) `[VERIFIED: package.json]` |

### Supporting (Electron built-ins, no install)
| API | Purpose | When to Use |
|-----|---------|-------------|
| `desktopCapturer.getSources({ types:['screen'], thumbnailSize })` | Capture a display as a `nativeImage` | The single-display capture path (D-01) `[CITED: electronjs.org/docs/api/desktop-capturer]` |
| `screen.getDisplayMatching(rect)` | Resolve which display the overlay's bounds sit on | Map overlay bounds → the `Display` to capture (D-01) `[CITED: electronjs.org/docs/api/screen]` |
| `nativeImage.resize({ width, quality })` / `.toPNG()` / `.toJPEG(q)` / `.toDataURL()` | Downscale + encode in main | Lightest downscale path; `.toPNG().toString('base64')` yields the raw base64 (D-05) `[CITED: electronjs.org/docs/api/native-image]` |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `desktopCapturer` thumbnail at display pixel size | `screenshot-desktop` (npm) | CLAUDE.md: only for multi-monitor full-res edge cases; adds a native dep + a child process. Not needed — `desktopCapturer` with `thumbnailSize` set to the display's real pixel size returns a full-res `nativeImage`. Stay with the built-in. |
| `nativeImage.resize` | `sharp` / `jimp` | Adds a heavy native dep (`sharp`) or a slow pure-JS lib (`jimp`). `nativeImage.resize` is built-in, main-process, fast enough for one screenshot. Use the built-in (D-05 default = no new dep). |
| Base64 inline image block | Files API (`file_id`) | Files API is for *repeated* images across turns; vision here is one-shot per trigger. Base64 inline is correct and simpler `[CITED: docs.anthropic vision §Files API]` |

**Installation:** None. All APIs are built-in or already installed.

**Version verification:**
```bash
node -e "const p=require('./node_modules/@anthropic-ai/sdk/package.json');console.log(p.version)"  # → 0.104.2 (confirmed)
```

## Package Legitimacy Audit

> No external packages are installed in this phase. All capabilities use Electron built-ins or
> already-present, already-audited dependencies. slopcheck/registry verification is N/A — there is
> nothing new to install.

| Package | Registry | Disposition |
|---------|----------|-------------|
| (none — phase adds no dependencies) | — | N/A |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Architecture Patterns

### System Architecture Diagram

```
  Ctrl+Alt+C (uiohook keydown, main)
        │
        ▼
  AiOrchestrator.trigger('code-challenge')      ← single-in-flight guard (D-11): cancel any active stream
        │
        ├─► ScreenshotService.captureForOverlay(overlayWindow)         [MAIN]
        │       │  screen.getDisplayMatching(overlayWindow.getBounds())  → Display
        │       │  desktopCapturer.getSources({types:['screen'],          → match by display_id
        │       │      thumbnailSize: display pixel size})
        │       │  nativeImage.resize(≤1568 long edge, only-if-larger)
        │       │  .toPNG().toString('base64')                            → { base64, mediaType:'image/png' }
        │       ▼
        ├─► getActiveContext()  (Phase 6)  ──┐
        ├─► transcriptBuffer.recentSince()  ─┤
        │                                     ▼
        └─► assemblePrompt({ mode, span, context, image })              [PURE]
                │  if image: content = [{type:'image',source:{...}},{type:'text',text}]
                │  else:     content = string (Phase-5 unchanged)
                ▼
            AnthropicGateway.stream({ model: claude-opus-4-8, maxTokens, system, content })  [MAIN]
                │  messages:[{ role:'user', content }]   ← string OR block array
                ▼  (text deltas, debounced)
            pushAi({ type:'delta'|'done'|... , mode:'code-challenge', ... })  → jedi:ai
                ▼
            VisionPanel (renderer, pure view)  ← takes over AI-panel region when active (D-10)
```

The overlay is excluded from its own capture by the OS DWM display-affinity set via
`setContentProtection(true)` — verify this holds for `desktopCapturer` (Pitfall 1 / D-02).

### Recommended structure (additions only)
```
src/main/
├── vision/
│   ├── screenshot.service.ts          # NEW: capture+downscale+base64 (D-01/D-05)
│   ├── downscale.utility.ts           # NEW: pure ≤1568 long-edge math (only-if-larger) — unit-tested
│   └── test/
│       └── downscale.utility.test.ts  # NEW: Vitest co-located
├── ai/
│   ├── ai-gateway.interface.ts        # EDIT: AiMode += 'code-challenge'; IAiPromptRequest += image?
│   ├── prompt-assembler.ts            # EDIT: image branch + VISION_SYSTEM_PROMPT; text modes byte-identical
│   ├── anthropic-ai.gateway.ts        # EDIT: content = string | ImageBlock[]; one-line type widening
│   └── ai-orchestrator.ts             # EDIT: code-challenge path; CODE_CHALLENGE_MODEL; vision bypasses empty-span guard
src/renderer/src/components/
├── vision-panel.tsx                   # NEW: dedicated panel (reuses ai-panel patterns, D-08/D-09/D-10)
electron-builder.yml                   # EDIT: asarUnpack globs, icon, portable artifactName
07-VERIFICATION.md                     # NEW: on-machine GO/NO-GO record (D-13)
```

### Pattern 1: Optional image field, content branch (D-04)
**What:** Add `image?: { base64: string; mediaType: string }` to `IAiPromptRequest`. The assembler
returns `userContent` as `string | Anthropic.ContentBlockParam[]`. The gateway passes it straight
through — `messages.stream({ messages:[{ role:'user', content }] })` accepts both.
**When to use:** code-challenge mode only; answer/talking-points pass no image → string path unchanged.
**Example:** see Code Examples §1.

### Pattern 2: Active-display capture (D-01)
**What:** Resolve the `Display` under the overlay, then grab the matching `desktopCapturer` source at
the display's real pixel resolution.
**Key detail:** `display.id` is a number; `DesktopCapturerSource.display_id` is a **string** — compare
`String(display.id) === source.display_id`. Set `thumbnailSize` to `display.size` scaled by
`display.scaleFactor` to get full-resolution pixels (a thumbnail at logical size on a 150%-scaled
monitor would be soft). See Code Examples §2.

### Pattern 3: Vision bypasses the empty-span guard (D-07/D-11)
**What:** In `trigger()`, the `span.trim().length === 0` early-return currently fires the `empty`
placeholder and makes no gateway call. For `code-challenge`, the image alone is actionable — the guard
must NOT short-circuit. Branch: `if (mode !== 'code-challenge' && span.trim().length === 0) { ...empty... }`.
The single-in-flight cancel logic below it is reused unchanged.

### Anti-Patterns to Avoid
- **Sending a `data:` URL.** `nativeImage.toDataURL()` returns `data:image/png;base64,iVBOR...`. The
  API wants the raw base64 ONLY. Use `.toPNG().toString('base64')`, or strip the prefix from
  `toDataURL()`. (Pitfall 2.)
- **Downscaling in the renderer via canvas.** Violates IN-01 and adds an IPC round-trip of image
  bytes. Do it in main with `nativeImage` (D-05).
- **`asarUnpack`-ing nothing and trusting smartUnpack silently.** smartUnpack usually works, but the
  package can break with no error in dev — be explicit AND verify on-machine (Pitfall 4 / D-13).
- **Treating 1568 as the Opus model limit.** It is our chosen downscale target; Opus 4.8 actually
  accepts 2576px. Encode 1568 as an app constant, not a "model max." (Pitfall 5.)
- **Logging the image base64 or the sanitized stream errors.** Same T-5-02 discipline as Phase 5 —
  latency log carries `mode/model/latencyMs` only.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Capture a single monitor | Custom WASAPI/GDI/`BitBlt` native addon | `desktopCapturer` + `screen.getDisplayMatching` | Built-in, cross-checked with content protection; native surface is exactly what D-01 rejects |
| Resize/encode an image | `sharp`/`jimp`/manual canvas | `nativeImage.resize().toPNG()` | Built-in, main-process, one-shot; no native build, no IPC of bytes |
| Unpack native `.node` from asar | Post-build copy scripts | electron-builder `asarUnpack` (+ smartUnpack) | First-class build feature; handles the `require(absolutePath)` loader these modules use |
| SSE/streaming parse for vision | Hand-parse `content_block_delta` | `client.messages.stream()` `.on('text')` | Already wired in `AnthropicGateway`; vision reuses it verbatim |
| Image token/size math | Reimplement Claude's resize formula | Just downscale to ≤1568 long edge | The model handles its own resize/pad; we only pre-shrink to control latency/cost |

**Key insight:** The whole vision feature is "answer mode + an image param." Every genuinely hard
piece (streaming, single-in-flight, cancel, grounding, history, scroll/focus) already exists and is
proven. New code is one capture service, one pure downscale utility, one assembler branch, one model
constant, one chord, and one renderer panel.

## Runtime State Inventory

> This phase adds a feature + a package config; it is not a rename/migration. No stored data, live
> service config, OS-registered state, secrets, or build artifacts carry a renamed string.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — vision adds a transient in-memory image + a renderer-side bounded history; no new persisted store | none |
| Live service config | None | none |
| OS-registered state | The new `Ctrl+Alt+C` chord is registered via uiohook at runtime (not OS-persisted); same lifecycle as every existing chord | none beyond adding it to `HOTKEY_CHORDS` |
| Secrets/env vars | None new — vision reuses the already-keyed `AnthropicGateway` (safeStorage → .env → '', Phase 6 D-08) | none |
| Build artifacts | The packaged `release/*.exe` is the NEW artifact; native `.node` prebuilds must land in `app.asar.unpacked/` | verify via D-13 gate |

## Common Pitfalls

### Pitfall 1: Content protection may NOT exclude the overlay from `desktopCapturer` on every config
**What goes wrong:** `setContentProtection(true)` sets `WDA_EXCLUDEFROMCAPTURE` (Windows 10 2004+),
which reliably blocks screen-share. Whether it ALSO blanks the overlay out of a *local*
`desktopCapturer` screen grab is the same DWM mechanism in principle, but is not guaranteed across all
GPU/driver/scale-factor combinations — and it is exactly the kind of thing that differs in a packaged
build vs dev.
**Why it happens:** The exclusion is enforced by the desktop compositor; `desktopCapturer` reads the
composited frame, so it *should* honor the affinity, but driver edge cases exist.
**How to avoid:** D-02's plan is correct — VERIFY first (capture, inspect the PNG, confirm no overlay
rectangle). Keep the documented fallback ready: briefly `hideOverlay()` → capture → `showOverlay()`.
Note that `showOverlay()` re-applies content protection + always-on-top + click-through (verified in
`overlay-window.manager.ts:393`), so a reshow is safe. The hide flash is sub-frame and the user is
looking at the meeting app, not the overlay, when they press the chord.
**Warning signs:** A faint overlay rectangle in the captured image; Claude commenting on overlay text.
**Confidence:** MEDIUM — the success-criterion-2 requirement ("excluded from its own screenshot") is
the on-machine acceptance test (D-13d covers screenshot-solve end-to-end; add an explicit "no overlay
in the captured image" check to the gate).

### Pitfall 2: `data:` URL prefix in the base64
**What goes wrong:** `nativeImage.toDataURL()` returns `data:image/png;base64,<payload>`; sending that
as `source.data` is rejected by the API. `[VERIFIED: docs.anthropic vision — data field is raw base64]`
**How to avoid:** Use `image.toPNG().toString('base64')` (raw), OR `toDataURL().split(',')[1]`. Encode
the `mediaType` separately (`'image/png'`). The downscale utility should return `{ base64, mediaType }`
with base64 already prefix-free, and a unit test should assert no `data:` substring.

### Pitfall 3: Full-resolution capture on a HiDPI monitor
**What goes wrong:** `desktopCapturer` `thumbnailSize` defaults are small; passing `display.size`
(logical points) on a 150%-scaled monitor yields a soft, under-sampled image — bad for reading code.
**How to avoid:** `thumbnailSize: { width: Math.round(size.width * scaleFactor), height: Math.round(size.height * scaleFactor) }`.
Then downscale to ≤1568 long edge. (Capturing crisp then shrinking beats capturing soft.)

### Pitfall 4: `asarUnpack` is the real packaging risk — NOT the rebuild (refines D-14)
**What goes wrong:** D-14 frames the risk as "rebuild for the Electron ABI or hotkeys/audio silently
break." Research shows both modules ship **N-API prebuilds** (`uiohook-napi` via `node-gyp-build`;
`native-recorder-nodejs` via its own `bindings.js` that does `require(join(__dirname,'..','prebuilds',
'<plat>-<arch>','*.node'))`). N-API is ABI-stable across Electron majors, so the prebuilt `.node`
loads under Electron 35 without a rebuild (this is why Phase 4 worked in dev with no native-recorder
rebuild step — `npm run rebuild` only targets `uiohook-napi`). `[VERIFIED: node_modules/*/dist loaders + node-gyp-build present]`
The ACTUAL break is that `require(<absolute path>)` and `fs.existsSync(<path>)` **cannot read a file
inside `app.asar`** — so if the `.node` is packed, the loader's `existsSync` returns false and
`native-recorder` throws "Could not find native module," while `uiohook-napi`'s `node-gyp-build` also
fails to resolve.
**How to avoid:** Explicit `asarUnpack` for both modules' trees (electron-builder's `smartUnpack`
auto-unpacks `*.node` but be explicit and verify). The `node-gyp-build` and `prebuild-install` runtime
helper deps of these modules must also be unpacked (they `require` from disk). Globbing the whole
module dir is safest:
```yaml
asarUnpack:
  - "**/*.node"
  - "**/node_modules/uiohook-napi/**"
  - "**/node_modules/native-recorder-nodejs/**"
  - "**/node_modules/node-gyp-build/**"
```
Keep `npm run rebuild` (harmless) but extend it to be a no-op-safe `electron-rebuild -f -w uiohook-napi,native-recorder-nodejs`
only if a future non-prebuilt build is ever needed; the on-machine gate (D-13) is what proves the
package actually loads them.
**Warning signs:** App runs in dev, but the packaged `.exe` has dead hotkeys (uiohook) and a flat audio
meter / frozen transcript (native-recorder) with a main-process load error.
**Confidence:** HIGH on the loader mechanism; MEDIUM that smartUnpack alone suffices — hence explicit globs + gate.

### Pitfall 5: `claude-opus-4-8` max edge is 2576, not 1568
**What goes wrong:** Treating 1568 as the model ceiling and "upgrading" to 2576 to be safe — increasing
tokens (~3×), latency, and cost for no readability gain at typical screenshot sizes.
**Why it happens:** Older Claude models cap at 1568px; Opus 4.7+ raised it to 2576px and ~4784 visual
tokens. `[CITED: docs.anthropic vision §High-resolution image support]`
**How to avoid:** Keep the locked 1568 target (D-05). It is a deliberate, cheap, sufficient downscale
floor. Document in the constant: `// 1568 = app downscale target (D-05); Opus 4.8 itself allows up to 2576px.`

### Pitfall 6: `app.disableHardwareAcceleration()` must run before `app.ready`
**What goes wrong:** Calling it inside `app.whenReady()` is a no-op — it's already too late.
`[CITED: electronjs.org/docs/api/app + electron#51363]`
**How to avoid:** Call it synchronously at the top level of `src/main/index.ts`, before any
`app.whenReady()`. Gate it behind an env var / persisted pref so the *fallback* is opt-in:
```ts
if (process.env.JEDI_DISABLE_GPU === '1') { app.disableHardwareAcceleration(); }
```
Document the toggle in the SmartScreen/hardening doc. Note: electron#51363 reports that on Electron 38+
this flag no longer fully kills the GPU process — irrelevant here (pinned 35.7.5) but a reason not to
chase a newer major.

## Code Examples

### §1 Vision content blocks + SDK call (D-04/D-06) `[VERIFIED: docs.anthropic vision + @anthropic-ai/sdk 0.104.2]`
```typescript
// prompt-assembler.ts — image branch. Text modes return a string (byte-identical to Phase 5).
import type Anthropic from '@anthropic-ai/sdk';

export const VISION_SYSTEM_PROMPT = `You are helping the user solve a coding challenge shown in a screenshot during a live interview.
Read the problem from the image. Use the provided project context and recent transcript only as supporting context (the interviewer may have stated constraints aloud).
Produce a correct, idiomatic solution the user could speak through and type. Lead with a one-line approach, then the code, then a brief complexity note. No preamble.`;

// content is string (text modes) OR a block array (vision). Anthropic SDK accepts both.
type UserContent = string | Anthropic.ContentBlockParam[];

function buildVisionContent(image: { base64: string; mediaType: string }, text: string): Anthropic.ContentBlockParam[] {
    return [
        { type: 'image', source: { type: 'base64', media_type: image.mediaType as 'image/png', data: image.base64 } }, // image BEFORE text (docs recommend)
        { type: 'text', text },
    ];
}
```
```typescript
// anthropic-ai.gateway.ts — only the `content` type widens; the call is otherwise unchanged.
const stream = this.client.messages.stream({
    model: request.model,                       // 'claude-opus-4-8' for code-challenge
    max_tokens: request.maxTokens,              // 1500 (longer code output)
    system: request.system,                     // VISION_SYSTEM_PROMPT
    messages: [{ role: 'user', content: request.userContent }], // string | ContentBlockParam[]
});
```
Confirmed wire shape (from official docs): `{ "type":"image", "source":{ "type":"base64", "media_type":"image/png", "data":"<RAW base64, no data: prefix>" } }`, image block placed before the text block. Supported media types: `image/jpeg`, `image/png`, `image/gif`, `image/webp`.

### §2 Capture the overlay's display (D-01) `[CITED: electronjs.org desktop-capturer + screen]`
```typescript
// screenshot.service.ts (MAIN)
import { desktopCapturer, screen, nativeImage, type BrowserWindow } from 'electron';

export async function captureOverlayDisplay(overlay: BrowserWindow): Promise<Electron.NativeImage> {
    const display = screen.getDisplayMatching(overlay.getBounds()); // D-01
    const { width, height } = display.size;
    const sf = display.scaleFactor;                                  // Pitfall 3: capture at real pixels
    const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: Math.round(width * sf), height: Math.round(height * sf) },
    });
    // DesktopCapturerSource.display_id is a STRING; Display.id is a number.
    const source = sources.find((s) => s.display_id === String(display.id)) ?? sources[0];
    return source.thumbnail; // a full-resolution nativeImage of that monitor
}
```

### §3 Downscale ≤1568 long edge, only-if-larger, raw base64 (D-05) `[CITED: electronjs.org native-image]`
```typescript
// downscale.utility.ts (PURE-ish — the math is pure and unit-tested; nativeImage is the I/O edge)
export const VISION_MAX_LONG_EDGE = 1568; // app downscale target (D-05); Opus 4.8 itself allows 2576px.

/** Pure: compute the resized dimensions (preserve aspect; only shrink). Unit-tested. */
export function fitLongEdge(width: number, height: number, maxEdge: number): { width: number; height: number } {
    const longest = Math.max(width, height);
    if (longest <= maxEdge) return { width, height };          // only-if-larger
    const scale = maxEdge / longest;
    return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

export function toBase64Png(image: Electron.NativeImage): { base64: string; mediaType: string } {
    const { width, height } = image.getSize();
    const target = fitLongEdge(width, height, VISION_MAX_LONG_EDGE);
    const resized = target.width === width ? image : image.resize({ width: target.width, height: target.height });
    return { base64: resized.toPNG().toString('base64'), mediaType: 'image/png' }; // NO data: prefix (Pitfall 2)
}
```

### §4 electron-builder.yml extension (D-12/D-14) `[CITED: electron.build/docs/contents + configuration]`
```yaml
appId: com.rodrigo.jedi-interviews
productName: Jedi Interviews
directories:
    output: release
    buildResources: build       # place icon.ico here
files:
    - out/**/*
    - package.json
asarUnpack:                     # Pitfall 4: these load .node via require(absolutePath) — must be on real disk
    - "**/*.node"
    - "**/node_modules/uiohook-napi/**"
    - "**/node_modules/native-recorder-nodejs/**"
    - "**/node_modules/node-gyp-build/**"
win:
    icon: build/icon.ico
    target:
        - portable
portable:
    artifactName: ${productName}-${version}-portable.exe
```

### §5 Hardware-acceleration fallback (D-15) `[CITED: electronjs.org/docs/api/app]`
```typescript
// TOP of src/main/index.ts — synchronous, BEFORE any app.whenReady(). Opt-in fallback.
import { app } from 'electron';
if (process.env.JEDI_DISABLE_GPU === '1') {
    app.disableHardwareAcceleration(); // Pitfall 6: no-op if called after ready
}
```

### §6 Latency instrumentation for vision (D-15) — extend the existing log
The orchestrator already logs `[ai] first-token mode=… model=… latencyMs=…` (verified at
`ai-orchestrator.ts:213`). Adding `code-challenge` as a third mode requires NO new logging code — the
existing first-token log fires for it automatically. The only nuance: `startMs` should be captured at
the *chord press* (before the async capture+downscale), so the logged latency includes capture time
(the user feels it). Capture `startMs` at the top of the `code-challenge` branch in `trigger()`, before
`await captureOverlayDisplay`.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Claude image max edge 1568px | Opus 4.7+ / 4.8 max edge **2576px**, ~4784 visual tokens | Opus 4.7 release | Our 1568 target is now a *floor we choose*, not the model ceiling (Pitfall 5) |
| `@anthropic-ai/sdk` v3/v4 message shapes | v0.104.2 `messages.stream()` + content-block array | current | In-use SDK confirmed to accept the image block array (Code §1) |
| Manual `@electron/rebuild` for every native addon | N-API prebuilds load unchanged across Electron majors | N-API maturity | Rebuild is near-no-op for these two modules; `asarUnpack` is the real requirement (Pitfall 4) |

**Deprecated/outdated:**
- `nodeIntegration`/canvas-in-renderer downscale: violates IN-01; use main-process `nativeImage`.
- Treating `desktopCapturer` thumbnails as low-res: setting `thumbnailSize` to real pixels gives full-res.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The `claude-api` skill is NOT installed in this environment; vision API facts were sourced directly from official Anthropic docs (`platform.claude.com/docs/.../vision`) instead. The ROADMAP/CONTEXT mandate the skill as authoritative. The docs ARE the source the skill wraps, so this is equivalent — but the planner/discuss-phase should confirm the skill is available at build time per the research flag, and re-verify the `claude-opus-4-8` id + `max_tokens` then. | Standard Stack / Code §1 | LOW — official docs confirm the same shape; only the skill-availability process step is unmet |
| A2 | `MAX_TOKENS` for code-challenge = `1500`. CONTEXT leaves this to planner discretion ("code solutions are longer"). 1500 is a reasonable ceiling for a single coded solution + brief explanation; tune during the on-machine latency check (D-15). | Code §1 | LOW — a cap that's too low truncates a long solution; trivially raised |
| A3 | Explicit `asarUnpack` globs (rather than relying on smartUnpack alone) are needed for both N-API modules. smartUnpack *usually* auto-unpacks `*.node`, but the `node-gyp-build`/`prebuild-install` runtime helpers and the loader's `require(absolutePath)` make the explicit globs the safe choice. | Code §4 / Pitfall 4 | LOW — explicit globs are strictly safer; worst case they unpack a few extra files |
| A4 | Content protection (`setContentProtection(true)`) excludes the overlay from a local `desktopCapturer` capture, not just screen-share. Same DWM affinity, but driver/scale edge cases exist. | Pitfall 1 / D-02 | MEDIUM — if wrong, the hide-capture-reshow fallback (already planned in D-02) is required; the D-13 gate catches it |

**If this table is empty:** (it is not — four assumptions flagged for confirmation)

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Electron `desktopCapturer`/`nativeImage`/`screen` | Vision capture | ✓ | 35.7.5 built-in | — |
| `@anthropic-ai/sdk` | Vision stream | ✓ | 0.104.2 | — |
| `electron-builder` | Portable `.exe` | ✓ | 26.15.3 (devDep) | — |
| `uiohook-napi` win32-x64 prebuild | `Ctrl+Alt+C` chord | ✓ | 1.5.5 (`prebuilds/win32-x64/uiohook-napi.node` present) | — |
| `native-recorder-nodejs` win32-x64 prebuild | Audio (must survive packaging) | ✓ | 1.2.0 (`prebuilds/win32-x64/NativeAudioSDK.node` present) | — |
| `build/icon.ico` | Portable `.exe` icon | ✗ | — | electron-builder uses a default Electron icon if absent (cosmetic only; not blocking) |
| Target Windows 11 machine | D-13 GO/NO-GO gate | ✓ (the dev machine is the target) | — | — |
| `ANTHROPIC_API_KEY` (vision) | End-to-end screenshot-solve | configured per memory (safeStorage/.env) | — | gate D-13d requires a live key |

**Missing dependencies with no fallback:** none blocking.
**Missing dependencies with fallback:** app icon (cosmetic — supply `build/icon.ico` or accept default).

## Validation Architecture

> `workflow.nyquist_validation` was not found explicitly disabled in config; treating as enabled.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest `3.2.4` (co-located `*.test.ts`, `npm test` → `vitest run`) `[VERIFIED: package.json]` |
| Config file | electron-vite/vite-driven; tests run via `vitest run` |
| Quick run command | `npx vitest run src/main/vision/test/downscale.utility.test.ts` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| AI-03 | Downscale math: ≤1568 long edge, only-if-larger, aspect preserved | unit | `npx vitest run src/main/vision/test/downscale.utility.test.ts` | ❌ Wave 0 |
| AI-03 | base64 has NO `data:` prefix | unit | (assert in downscale test) | ❌ Wave 0 |
| AI-03 | `assemblePrompt` emits block array iff `image` present; string otherwise (text modes byte-identical) | unit | `npx vitest run src/main/ai/test/prompt-assembler.test.ts` | partial (extend existing) |
| AI-03 | Active-monitor resolution: `getDisplayMatching` → matching source by `display_id` (pure match logic extracted) | unit | `npx vitest run src/main/vision/test/screenshot.service.test.ts` | ❌ Wave 0 (test the pure match/select helper; mock desktopCapturer) |
| AI-03 | Orchestrator: code-challenge bypasses empty-span guard; single-in-flight cancel across 3 modes | unit | `npx vitest run src/main/ai/test/ai-orchestrator.test.ts` | extend existing |
| AI-03 | Live capture → stream → vision panel | manual/integration | — (on-machine, D-13d) | manual gate |
| PKG-01 | Packaged `.exe`: transparency, never-steal-focus, content-protection, screenshot-solve | manual gate | run `release/*.exe` on target machine | `07-VERIFICATION.md` (D-13) |
| PKG-01 | Native modules load in package (hotkeys + audio alive) | manual gate | observe in packaged `.exe` | part of `07-VERIFICATION.md` |

### Sampling Rate
- **Per task commit:** `npx vitest run <changed test file>`
- **Per wave merge:** `npm test` (full Vitest suite)
- **Phase gate:** Full suite green + `07-VERIFICATION.md` GO before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/main/vision/test/downscale.utility.test.ts` — covers AI-03 (downscale math + no-`data:`-prefix)
- [ ] `src/main/vision/test/screenshot.service.test.ts` — covers AI-03 (pure source-select/match logic; `desktopCapturer` mocked)
- [ ] Extend `src/main/ai/test/prompt-assembler.test.ts` — image branch + text-mode-unchanged assertions
- [ ] Extend `src/main/ai/test/ai-orchestrator.test.ts` — code-challenge empty-span bypass + 3-mode single-in-flight
- [ ] `07-VERIFICATION.md` template (mirror `01-04` gate) — manual GO/NO-GO record

*Live capture, streaming, and the packaged build are integration/manual-gate level — not unit-testable
(no headless display, no real API in CI). The downscale math, the assembler image branch, the
source-select logic, and the orchestrator state machine ARE pure/mockable and must be unit-tested.*

## Security Domain

> `security_enforcement` not found disabled in config; treating as enabled. This is a personal,
> local, single-user tool (no server, no multi-tenant, no untrusted network input) — most ASVS
> categories are N/A. The live concerns are secret handling and the renderer trust boundary, both
> already established in Phases 1/5/6.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | No user auth; local desktop tool |
| V3 Session Management | no | No sessions |
| V4 Access Control | no | Single local user |
| V5 Input Validation | partial | The captured image is local screen content (trusted source); the renderer remains a pure one-way view (IN-01) — no renderer→main control surface added for vision |
| V6 Cryptography | yes (inherited) | API keys at rest via `safeStorage` (DPAPI) — Phase 6 D-08; vision adds no new key path |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| API key leakage via image/error logs | Information Disclosure | Latency log carries `mode/model/latencyMs` only (verified `ai-orchestrator.ts:213`); never log image base64; `sanitizeAiError` already strips key-adjacent error bodies (T-5-02, verified `anthropic-ai.gateway.ts`) |
| Screenshot captures the overlay (key/secret on screen) | Information Disclosure | The overlay never renders secrets; content protection excludes it from capture (D-02, verify Pitfall 1) |
| Sensitive on-screen content sent to Anthropic | Information Disclosure | Documented/accepted in PROJECT.md (audio + AI calls leave the machine for v1); no new exposure beyond existing policy. The user controls when to press the chord. |
| Native `.node` loaded from a writable unpacked path | Tampering | `app.asar.unpacked/` is within the app install dir; portable `.exe` runs from user-chosen location — same trust as any unsigned personal tool (SmartScreen friction is the accepted control, D-15) |
| Renderer XSS rendering streamed code | Tampering/ID | Vision panel renders text content (React escapes by default); do NOT add `dangerouslySetInnerHTML` for code blocks — render as escaped text/`<pre>` |

## Sources

### Primary (HIGH confidence)
- `platform.claude.com/docs/en/docs/build-with-claude/vision` (official Anthropic docs) — image content-block shape `{type:'image',source:{type:'base64',media_type,data}}`, raw base64 (no `data:` prefix), supported media types (jpeg/png/gif/webp), image-before-text ordering, `claude-opus-4-8` examples, Opus 4.7+ max edge 2576px / 4784 visual tokens, 10MB/image + 32MB/request limits
- `node_modules/@anthropic-ai/sdk/package.json` — version `0.104.2` confirmed installed
- `node_modules/uiohook-napi/dist/index.js` + `package.json` — `node-gyp-build` N-API loader, prebuilds present
- `node_modules/native-recorder-nodejs/dist/bindings.js` + `package.json` — `require(absolutePath into prebuilds/win32-x64/NativeAudioSDK.node)` loader; N-API prebuilds; `prebuild-install`/`node-addon-api` deps
- Source files read: `ai-gateway.interface.ts`, `anthropic-ai.gateway.ts`, `prompt-assembler.ts`, `ai-orchestrator.ts`, `hotkey-registrar.service.ts`, `overlay-window.manager.ts`, `index.ts`, `ai-panel.tsx`, `electron-builder.yml`, `package.json`
- `electronjs.org/docs/api/app` (via search) — `app.disableHardwareAcceleration()` must be called before `ready`

### Secondary (MEDIUM confidence)
- `electron.build/docs/contents` + `configuration.html` (via WebSearch) — `asarUnpack`, `smartUnpack` auto-unpacks `*.node`
- electron/electron#51363 (via WebSearch) — `disableHardwareAcceleration` GPU-process caveat on Electron 38+ (not applicable to pinned 35)

### Tertiary (LOW confidence)
- Content-protection-excludes-`desktopCapturer` behavior — inferred from the shared DWM affinity mechanism; flagged A4 / Pitfall 1 for on-machine verification

## Metadata

**Confidence breakdown:**
- Vision API shape + model id: HIGH — confirmed against official Anthropic docs and the installed SDK version
- Native-module loading + packaging: HIGH on the loader mechanism (read the loaders directly); MEDIUM that smartUnpack alone suffices → explicit globs + on-machine gate
- Content-protection self-exclusion from desktopCapturer: MEDIUM — same mechanism as screen-share, but driver edge cases; D-13 gate is the proof
- Hardening (GPU flag, latency log, SmartScreen): HIGH — flag placement confirmed; latency log already exists; SmartScreen friction is a documented decision

**Research date:** 2026-06-19
**Valid until:** 2026-07-19 (stable; Electron pinned, SDK pinned). Re-verify the `claude-opus-4-8` id and image limits via the `claude-api` skill at build time per the ROADMAP research flag.
