# Phase 7: Screenshot Vision + Packaging & Hardening - Pattern Map

**Mapped:** 2026-06-19
**Files analyzed:** 13 (4 new, 8 edited, 1 new verification doc)
**Analogs found:** 13 / 13 (every file has a strong in-repo analog — this phase is almost entirely additive)

> **Discipline (from CONTEXT/RESEARCH):** *Extend the seam, don't fork it.* The image rides an optional
> field on the existing `IAiPromptRequest`; there is NO `streamVision()` method, NO second orchestrator,
> NO new gateway. Main owns all IO/state (capture, downscale, base64, prompt assembly, stream lifecycle);
> the renderer is a pure one-way view of pushed `jedi:ai` events (IN-01). Every excerpt below is the
> proven Phase-5/6 shape the new code copies.

> **Convention correction — tests are CO-LOCATED, not in a `test/` subdir.** RESEARCH.md's "Recommended
> structure" shows `src/main/vision/test/downscale.utility.test.ts`, but the ACTUAL repo convention
> (verified across every existing `*.test.ts`) is the test file sitting **next to** its source:
> `src/main/audio/rms.utility.ts` + `src/main/audio/rms.utility.test.ts`. The executor MUST follow the
> repo convention: `src/main/vision/downscale.utility.test.ts` (NO `test/` subfolder). There are zero
> `test/` subdirectories in `src/`. This overrides the RESEARCH.md path.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| NEW `src/main/vision/screenshot.service.ts` | service (main) | file-I/O / transform | `src/main/audio/audio-capture.service.ts` + `overlay-window.manager.ts` (screen/window APIs) | role-match |
| NEW `src/main/vision/downscale.utility.ts` | utility (pure) | transform | `src/main/audio/rms.utility.ts` | exact |
| NEW `src/main/vision/downscale.utility.test.ts` | test (Vitest) | — | `src/main/audio/rms.utility.test.ts` | exact |
| NEW `src/renderer/src/components/vision-panel.tsx` | component | event-driven (one-way view) | `src/renderer/src/components/ai-panel.tsx` | exact |
| EDIT `src/main/ai/ai-gateway.interface.ts` | interface | contract | self (the `AiMode` union + `IAiPromptRequest`) | exact (extend) |
| EDIT `src/main/ai/prompt-assembler.ts` | utility (pure) | transform | self (`assemblePrompt`/`formatContext`) | exact (extend) |
| EDIT `src/main/ai/anthropic-ai.gateway.ts` | gateway | streaming/request-response | self (`stream()`) | exact (extend) |
| EDIT `src/main/ai/ai-orchestrator.ts` | service (main) | streaming/event-driven | self (`trigger(mode)` + per-mode constants) | exact (extend) |
| EDIT `src/main/hotkey-registrar.service.ts` | service (main) | event-driven | self (every `HOTKEY_CHORDS` entry) | exact (extend) |
| EDIT `src/main/index.ts` | handler (entry) | wiring | self (`buildHandlers` map + `aiOrchestrator` wiring ~line 331) | exact (extend) |
| EDIT `electron-builder.yml` | config | build | self (existing portable config) + RESEARCH §4 | role-match (extend) |
| EDIT `package.json` | config | build | self (`rebuild` script) | exact (extend) |
| NEW `.planning/.../07-VERIFICATION.md` | doc (gate) | — | `01-PHASE-VERIFICATION.md` + root `VERIFICATION.md` | exact |

---

## Pattern Assignments

### NEW `src/main/vision/downscale.utility.ts` (utility, pure transform)

**Analog:** `src/main/audio/rms.utility.ts` — the canonical pure-utility shape in this repo (no class, no IO, idempotent, full TSDoc with `@param`/`@returns`, explicit return type, 4-space, single quotes).

**Shape to copy** (`rms.utility.ts:1-25`):
```typescript
/**
 * Computes the root-mean-square (RMS) amplitude of an Int16 PCM frame, normalized to `[0, 1]`.
 * ... Pure and side-effect free.
 *
 * @param frame - The Int16 PCM samples to measure.
 * @returns The RMS amplitude in `[0, 1]`; 0 for an empty frame.
 */
export function computeRmsInt16(frame: Int16Array): number {
    if (frame.length === 0) {
        return 0;
    }
    // ...
    return Math.sqrt(sumOfSquares / frame.length);
}
```

**What to produce here** (per RESEARCH §3, D-05): a pure `fitLongEdge(width, height, maxEdge)` returning
`{ width, height }` (only-if-larger; preserve aspect ratio) plus the named constant
`export const VISION_MAX_LONG_EDGE = 1568;` with the Pitfall-5 comment (`// app downscale target (D-05);
Opus 4.8 itself allows 2576px`). Keep the `nativeImage`-touching `toBase64Png(image)` (the IO edge) here
too, but the **pure** math (`fitLongEdge`) is what the co-located test exercises. base64 MUST be
prefix-free (`.toPNG().toString('base64')`, NOT `.toDataURL()` — Pitfall 2).

---

### NEW `src/main/vision/downscale.utility.test.ts` (test, Vitest)

**Analog:** `src/main/audio/rms.utility.test.ts` — co-located, `describe`/`it`, explicit AAA comments on
their own lines, explicit type annotation on the result variable, IDEXX testing standards.

**Shape to copy** (`rms.utility.test.ts:1-25`):
```typescript
import { describe, expect, it } from 'vitest';
import { computeRmsInt16 } from './rms.utility';

describe('computeRmsInt16', () => {
    it('should return 0 for an empty frame', () => {
        // Arrange
        const frame = new Int16Array(0);

        // Act
        const rms: number = computeRmsInt16(frame);

        // Assert
        expect(rms).toBe(0);
    });
    // ...
});
```

**Coverage to write** (RESEARCH "Wave 0 Gaps"): only-if-larger (no upscale when `longest <= maxEdge`),
aspect ratio preserved on both landscape & portrait, exact `1568` boundary, and an assertion that the
produced base64 contains **no `data:` substring** (Pitfall 2). Note: `import { describe, expect, it } from 'vitest'`
— relative import to the sibling source, no path alias.

---

### NEW `src/main/vision/screenshot.service.ts` (service, main — capture + downscale + base64)

**Analogs:**
- `src/main/audio/audio-capture.service.ts` — the main-process service-class precedent (by-convention
  singleton, instantiated once in `index.ts`, NO `@singleton()` decorator — the main process has no
  TSyringe container; document this in the `@remarks`, copying the note used verbatim across
  `AnthropicGateway`/`AiOrchestrator`/`HotkeyRegistrarService`).
- `src/main/overlay-window.manager.ts` — the `screen.*` + `BrowserWindow.getBounds()` usage precedent
  (it already imports `screen` and reacts to display-change events at lines 343-353).

**Main-owns-IO `@remarks` pattern to copy** (from `AiOrchestrator`, `ai-orchestrator.ts:96-103`):
```typescript
/**
 * @remarks
 * The Electron main process has no TSyringe DI container, so this is not an `@singleton()`; it is
 * instantiated once in `index.ts` and treated as a singleton by convention. Its dependencies are
 * constructor-injected ...
 */
```

**What to produce** (RESEARCH §2, D-01/D-05): `captureOverlayDisplay(overlay)` →
`screen.getDisplayMatching(overlay.getBounds())`; `desktopCapturer.getSources({ types: ['screen'],
thumbnailSize: { width: size.width * scaleFactor, height: size.height * scaleFactor } })` (Pitfall 3 —
real pixels); match by `source.display_id === String(display.id)` (Pattern 2 — `display.id` is a number,
`display_id` is a string). Extract the **pure source-select/match helper** into its own function so it is
unit-testable with `desktopCapturer` mocked (RESEARCH Test Map). Then downscale via the
`downscale.utility.ts` `toBase64Png`. NO renderer canvas, NO IPC of image bytes (IN-01).

**Report-don't-throw discipline:** capture faults must not crash main — mirror the
`AudioCaptureService` fault callback (`index.ts:221-224`: "A capture/device fault must never crash main").

---

### EDIT `src/main/ai/ai-gateway.interface.ts` (interface — extend the contract)

**Analog:** itself. The file already anticipates Phase 7 in its own TSDoc ("Phase 7 adds a vision mode",
line 20).

**Two edits, nothing else:**
1. Widen the union (`ai-gateway.interface.ts:20`):
```typescript
export type AiMode = 'answer' | 'talking-points'; // → add | 'code-challenge'
```
2. Add the optional image field to `IAiPromptRequest` (`ai-gateway.interface.ts:29-38`). The current shape:
```typescript
export interface IAiPromptRequest {
    model: string;
    maxTokens: number;
    system: string;
    userContent: string;   // currently `string`
}
```
Per D-04: add `image?: { base64: string; mediaType: string }` AND widen `userContent` to
`string | Anthropic.ContentBlockParam[]` (the assembler emits the block array when an image is present).
The event-emitter contract (`on('text'|'done'|'error'|'abort')`) is **unchanged** — do not touch it.
Keep the "no `@anthropic-ai/sdk` import live here" promise loose: a `type`-only import of
`Anthropic.ContentBlockParam` is acceptable since it's a pure type (no runtime dependency).

---

### EDIT `src/main/ai/prompt-assembler.ts` (utility — add image branch + VISION_SYSTEM_PROMPT)

**Analog:** itself — `assemblePrompt`/`formatContext` (`prompt-assembler.ts:127-133`). The DRAFT-tunable
system-prompt-constant convention is already established by `ANSWER_SYSTEM_PROMPT` /
`TALKING_POINTS_SYSTEM_PROMPT` (each a top-level `export const` with the "claude-api skill DRAFT caveat"
TSDoc). Add `VISION_SYSTEM_PROMPT` in the same style.

**Current selection + assembly to extend** (`prompt-assembler.ts:127-133`):
```typescript
export function assemblePrompt(input: IAssembleInput): IAssembledPrompt {
    const system = input.mode === 'answer' ? ANSWER_SYSTEM_PROMPT : TALKING_POINTS_SYSTEM_PROMPT;
    const contextBlock = formatContext(input.context);
    const userContent = `${contextBlock}Recent transcript (last ~60s):\n${input.span}`;
    return { system, userContent };
}
```

**Extend pattern (D-04/D-07):** add `image?: { base64; mediaType }` to `IAssembleInput`; widen
`IAssembledPrompt.userContent` to `string | Anthropic.ContentBlockParam[]`. Branch: when `input.image`
is present, select `VISION_SYSTEM_PROMPT` and return the block array `[{ type:'image', source:{ type:'base64',
media_type, data } }, { type:'text', text }]` (image BEFORE text — RESEARCH §1); the text block reuses the
SAME `contextBlock + transcript span` string so vision stays grounded (D-07). When `image` is absent, the
function is **byte-for-byte identical** to today (the existing test in `prompt-assembler.test.ts` must
still pass unchanged).

**Test extension analog:** `src/main/ai/prompt-assembler.test.ts` (already exists; extend it). Add cases
for the image branch (block array emitted iff image present) and a "text modes unchanged" regression case.

---

### EDIT `src/main/ai/anthropic-ai.gateway.ts` (gateway — widen `content` type only)

**Analog:** itself — the existing `stream()` call (`anthropic-ai.gateway.ts:71-99`). The SDK already
accepts both a string and a content-block array; this is a one-line type widening at the call site, no
behavioral change.

**The call to leave structurally unchanged** (`anthropic-ai.gateway.ts:73-78`):
```typescript
const stream = this.client.messages.stream({
    model: request.model,
    max_tokens: request.maxTokens,
    system: request.system,
    messages: [{ role: 'user', content: request.userContent }],  // ← content now string | ContentBlockParam[]
});
```
`request.userContent` is now `string | Anthropic.ContentBlockParam[]`; `messages.stream` accepts both, so
**no logic changes**. The `rekey()` live-rekey path, the `emitError`/`sanitizeAiError` T-5-02 discipline,
and the `finalText()` terminal handling are all reused as-is. **Never log the image base64** (extend the
existing "never log the rejection / key-adjacent payload" rule).

---

### EDIT `src/main/ai/ai-orchestrator.ts` (service — code-challenge path, model constant, empty-span bypass)

**Analog:** itself — `trigger(mode)` (`ai-orchestrator.ts:140-183`) and the per-mode constant blocks
(`ANSWER_MODEL`/`TALKING_POINTS_MODEL` at lines 26-27; `MAX_TOKENS` record at 34-37).

**Per-mode constant pattern to copy** (`ai-orchestrator.ts:26-37`):
```typescript
export const ANSWER_MODEL = 'claude-haiku-4-5';
export const TALKING_POINTS_MODEL = 'claude-opus-4-8';
// → add: export const CODE_CHALLENGE_MODEL = 'claude-opus-4-8';  (D-06; re-tierable named constant)

export const MAX_TOKENS: Record<AiMode, number> = {
    answer: 400,
    'talking-points': 500,
    // → add: 'code-challenge': 1500,  (RESEARCH A2 — longer code output; tune at the latency gate)
};
```
Because `MAX_TOKENS` is `Record<AiMode, number>`, widening `AiMode` to include `'code-challenge'` makes
the TS compiler REQUIRE the new key — a good forcing function the executor must satisfy.

**Empty-span guard bypass (RESEARCH Pattern 3 / D-07).** The current guard short-circuits ALL modes
(`ai-orchestrator.ts:144`):
```typescript
// D-11 empty-span guard — BEFORE any gateway call.
if (span.trim().length === 0) {
    // ...append EMPTY_SPAN_TEXT, push 'empty', return (no gateway call)
}
```
Vision must NOT short-circuit (the image alone is actionable). Branch it:
`if (mode !== 'code-challenge' && span.trim().length === 0) { ...empty... }`.

**Model + assemble call to extend** (`ai-orchestrator.ts:170-178`):
```typescript
const model = mode === 'answer' ? ANSWER_MODEL : TALKING_POINTS_MODEL; // → add code-challenge → CODE_CHALLENGE_MODEL
const { system, userContent } = assemblePrompt({ mode, span, context: this.getActiveContext() });
const startMs = Date.now();
const stream = this.gateway.stream({ model, maxTokens: MAX_TOKENS[mode], system, userContent });
```
For `code-challenge`: capture `startMs` BEFORE the async capture+downscale (RESEARCH §6 — so the logged
latency includes capture time the user feels), `await` the `ScreenshotService` capture, then pass the
resulting `image` into `assemblePrompt({ mode, span, context, image })`. The single-in-flight / cancel /
request-id-guard / debounce / first-token-log machinery (lines 155-183, 189-258, 311-331) is reused
**unchanged** (D-11). The first-token latency log (line 213) automatically covers the third mode — no new
log code (RESEARCH §6). **Constructor dependency:** add a `ScreenshotService` (or a capture closure) the
SAME way the orchestrator already took `getActiveContext` as its 5th constructor arg (lines 120-126).

**Push-event widening:** `IAiPushEvent` variants carry `mode: AiMode` (lines 60, 65); widening `AiMode`
flows through. The renderer's `IAiPushEvent` mirror must widen in lockstep (see vision-panel below).

**Test extension analog:** `src/main/ai/ai-orchestrator.test.ts` (exists; extend) — add the empty-span
bypass for code-challenge and a 3-mode single-in-flight cross-cancel case.

---

### EDIT `src/main/hotkey-registrar.service.ts` (service — add Ctrl+Alt+C to HOTKEY_CHORDS)

**Analog:** every existing entry in `HOTKEY_CHORDS` (`hotkey-registrar.service.ts:53-112`). The newest
chords (`open-settings`, `clear-ai`, `focus-cycle`) are the closest template — each is a one-line entry
plus a multi-line TSDoc documenting (a) the letter is outside the locked conflict-tested set, (b) the
02-03 Teams/Zoom/VS Code re-check is pending with a fallback letter, (c) `discrete` kind, (d) the handler
is wired in `index.ts` and a missing handler surfaces in `register().failed` (CTL-03) with no registrar
change.

**Exact entry shape to copy** (`hotkey-registrar.service.ts:105-111`, `open-settings`):
```typescript
// Phase 6 (D-02/SET-01): ... 'S' is OUTSIDE the locked, conflict-tested set {J, arrows, [, ], H, Q, K,
// PgUp, PgDn, A, T, G, F}; the on-machine Teams/Zoom/VS Code conflict re-check is pending ... (fall back
// to a reserved letter ... if a collision surfaces, and update this TSDoc). 'discrete' so a held key
// opens once per press. The 'open-settings' handler ... is wired in index.ts; a missing handler surfaces
// in register().failed (CTL-03) — no registrar change.
{ label: 'open-settings', keycode: UiohookKey.S, accelerator: 'Ctrl+Alt+S', kind: 'discrete' },
```

**What to add** (D-03): `{ label: 'capture-code-challenge', keycode: UiohookKey.C, accelerator: 'Ctrl+Alt+C', kind: 'discrete' }`
with the matching TSDoc. The taken set is now `{J, arrows, [, ], H, Q, K, PgUp, PgDn, A, T, G, F, S}` —
note `C` is outside it; document the fallback letter per the 02-03 protocol. `discrete` so re-press
cancels the in-flight vision stream (the orchestrator owns that, not the registrar). NO registrar logic
changes — `dispatchUiohookKeydown` / `bindViaUiohook` / `register` are untouched; the loop already covers
any new chord.

---

### EDIT `src/main/index.ts` (handler entry — wire the chord handler + ScreenshotService + GPU guard)

**Analog:** itself — the `buildHandlers` map (`index.ts:83-143`) and the `aiOrchestrator` construction
(line 331).

**(1) Top-level GPU guard (RESEARCH §5, D-15, Pitfall 6).** Add at the TOP of the module, BEFORE
`app.whenReady()` (the existing imports start at line 1; the guard goes synchronously after imports,
before any ready hook). It must be opt-in and run before ready:
```typescript
import { app } from 'electron';
if (process.env.JEDI_DISABLE_GPU === '1') {
    app.disableHardwareAcceleration(); // no-op if called after ready (Pitfall 6)
}
```

**(2) Chord handler — one-liner in `buildHandlers`.** Copy the `'ai-answer'` shape (`index.ts:125`):
```typescript
'ai-answer': (): void => aiOrchestrator.trigger('answer'),
// → add: 'capture-code-challenge': (): void => aiOrchestrator.trigger('code-challenge'),
```
The orchestrator owns capture+downscale+stream lifecycle, so the handler stays a one-liner. The handler
key MUST match the `label` added to `HOTKEY_CHORDS`. (`buildHandlers` may need the overlay `window`
threaded to the orchestrator/ScreenshotService — `window` is already in scope where `buildHandlers` is
called.)

**(3) ScreenshotService wiring.** Construct it once at the entry point (no service-locator mid-method)
and pass it (or a capture closure) into the `AiOrchestrator` constructor, mirroring how
`() => contextRepo.activeAsGrounding()` was threaded as the 5th arg (`index.ts:331`):
```typescript
aiOrchestrator = new AiOrchestrator(aiGateway, buffer, aiHistory, (event) => pushAi(window, event), () => contextRepo.activeAsGrounding());
// → extend the constructor with the ScreenshotService (or a () => captureOverlayDisplay(window) closure)
```
The ScreenshotService needs the overlay `window` (its bounds → `getDisplayMatching`, D-01) — `window` is
already available here (line 309).

**(4) Three-way focus cycle (D-09).** The `focus-cycle` handler (`index.ts:118-121`) currently flips
between two panels; extend to cycle transcript → ai → vision:
```typescript
'focus-cycle': (): void => {
    setActivePanel(getActivePanel() === 'ai' ? 'transcript' : 'ai'); // → 3-way cycle
    pushStatus(window);
},
```
This requires widening the `activePanel` type `'transcript' | 'ai'` → add `'vision'` in
`overlay-window.manager.ts` (lines 144, 152, 161 — `setActivePanel`/`getActivePanel`/the module flag) and
in the renderer's `IOverlayStatus` mirror. (UI-phase detail; planner sequences it.)

**Content protection (D-02) — VERIFY, don't add.** `showOverlay()` already calls
`setContentProtection(true)` on every show (`overlay-window.manager.ts:395`) and re-asserts it on `blur`
(line 336) and display change. Do NOT add separate hide/exclude logic; the verification gate confirms it
covers `desktopCapturer`. Documented fallback (only if a gap is found): brief `hideOverlay()` → capture →
`showOverlay()` (the reshow re-applies protection — line 393-402).

---

### NEW `src/renderer/src/components/vision-panel.tsx` (component — dedicated streaming panel)

**Analog:** `src/renderer/src/components/ai-panel.tsx` — REUSE its entire structure. It is a pure one-way
view (IN-01): subscribes to `window.jedi.onAi`, maintains a bounded local mirror, appends `delta`s to the
in-progress entry, reconciles terminal `done`/`error`/`cancelled`, and uses the `stickToBottomRef`
follow/pause + focused-panel scroll model.

**Locally-declared mirror types to copy** (`ai-panel.tsx:6-25`): the renderer re-declares `AiMode`,
`IAiPushEvent`, `AiEntryState`, `IAiPanelEntry` locally ("declared locally because the renderer is
bundled separately from the preload; structurally mirrors `IAiPushEvent` in main/preload"). The vision
panel widens `AiMode` to include `'code-challenge'` in its local mirror, in lockstep with main.

**stickToBottomRef + focused-panel scroll to copy** (`ai-panel.tsx:136-194`):
```typescript
const stickToBottomRef = useRef<boolean>(true);
const activePanelRef = useRef<'transcript' | 'ai'>('ai'); // → widen to include 'vision'
// ...
const offScroll = window.jedi?.onScrollTranscript((direction) => {
    if (activePanelRef.current !== 'ai') { return; } // → vision panel guards on 'vision'
    const element = listRef.current;
    if (element === null) { return; }
    const lineStep = 3 * 18;
    element.scrollTop += direction === 'down' ? lineStep : -lineStep;
    stickToBottomRef.current = element.scrollTop + element.clientHeight >= element.scrollHeight - 4;
});
// follow-on-stream:
useEffect(() => {
    const element = listRef.current;
    if (element !== null && stickToBottomRef.current) {
        element.scrollTop = element.scrollHeight;
    }
}, [entries]);
```

**reduceEntries reducer to copy** (`ai-panel.tsx:73-94`): the `thinking`/`empty`/`delta`/`done`/`error`/
`cancelled`/`cleared` switch is reused as-is. The vision panel filters/keeps only `code-challenge`-mode
entries (D-08 — dedicated panel separate from answer/talking-points).

**Bounded history (D-09):** mirror the AI-panel's bounded local mirror (same bound style as `AiHistory` /
`TranscriptBuffer`).

**`data-testid` conventions to follow** (`ai-panel.tsx:197-206`): `card-*` for the panel
(`card-vision-panel`), `list-*` for the entry container, `row-*` for entries (`row-vision-entry-${id}`),
`icon-active-panel` for the corner indicator (extend to a `'vision'` state, D-09). NO inline `style=`
props (renderer rule) — use the SCSS class convention (`ai-panel__*` → `vision-panel__*`).

**Security (RESEARCH Security Domain):** render streamed code as escaped text / `<pre>` — React escapes
by default; do NOT add `dangerouslySetInnerHTML`.

**Composition:** rendered as a sibling in `App` like `AiPanel` (D-10: shown only when active/has content;
takes over the AI-panel region while focused/streaming — UI-phase detail, planner sequences).

---

### EDIT `electron-builder.yml` (config — asarUnpack globs + icon + portable artifactName)

**Analog:** itself (the existing minimal portable config) plus the concrete target shape in RESEARCH §4.

**Current full file:**
```yaml
appId: com.rodrigo.jedi-interviews
productName: Jedi Interviews
directories:
    output: release
    buildResources: build
files:
    - out/**/*
    - package.json
win:
    target:
        - portable
```

**Extend to** (RESEARCH §4, D-12/D-14, Pitfall 4 — `asarUnpack` is the load-bearing fix, NOT the rebuild):
```yaml
asarUnpack:
    - "**/*.node"
    - "**/node_modules/uiohook-napi/**"
    - "**/node_modules/native-recorder-nodejs/**"
    - "**/node_modules/node-gyp-build/**"
win:
    icon: build/icon.ico        # cosmetic; electron-builder uses default if absent
    target:
        - portable
portable:
    artifactName: ${productName}-${version}-portable.exe
```
4-space indentation (matches the existing file and the repo standard). The `build/icon.ico` is optional
(RESEARCH Environment table — default icon used if absent; not blocking).

---

### EDIT `package.json` (config — extend the rebuild script)

**Analog:** itself — the `scripts` block (`package.json:13-29`).

**Current:**
```json
"rebuild": "electron-rebuild -f -w uiohook-napi"
```
**Extend** (D-14): cover both native modules:
`"electron-rebuild -f -w uiohook-napi,native-recorder-nodejs"`. RESEARCH Pitfall 4 caveat: the rebuild is
near-no-op for these N-API prebuilds (ABI-stable across Electron majors), so it is harmless insurance —
the real packaging fix is the `asarUnpack` above and the on-machine gate. Do NOT add new dependencies (no
`sharp`/`jimp`/`screenshot-desktop` — RESEARCH "no new runtime dependency").

---

### NEW `.planning/phases/07-screenshot-vision-packaging-hardening/07-VERIFICATION.md` (doc — on-machine GO/NO-GO gate)

**Analog:** `.planning/phases/01-overlay-shell-existential-behaviors/01-PHASE-VERIFICATION.md` and the
signed root `VERIFICATION.md` it references. Copy the structure: YAML frontmatter (`phase`, `verified`,
`status`, `score`, `human_verification`), a "Goal Achievement / Observable Truths" table with
Status + Evidence columns, a "Human Verification Required" section, and a "Gaps Summary".

**Observable-truths shape to copy** (`01-PHASE-VERIFICATION.md:27-35`): a per-truth table where the
manual existential behaviors are explicitly human-judged on the target Windows 11 machine and the pinned
Electron version is recorded.

**The four manual checks this gate must record** (D-13): (a) overlay renders transparent in the packaged
`.exe`; (b) never steals focus from the active app; (c) absent from screen-share (content protection
holds — Pitfall 1: also confirm "no overlay rectangle in the captured screenshot image"); (d) a real
screenshot-solve works end-to-end in the packaged build. Plus the D-14 native-module checks (hotkeys
alive = `uiohook-napi` loaded; audio meter alive = `native-recorder-nodejs` loaded). Record the pinned
Electron version (`35.7.5`) and machine, signed.

---

## Shared Patterns

### Main-owns-IO, renderer-pure-view (IN-01)
**Source:** `ai-orchestrator.ts:5-9` + the whole capture/downscale/stream/push flow.
**Apply to:** `screenshot.service.ts`, `downscale.utility.ts`, the orchestrator vision path, `index.ts`.
All capture, downscale, base64, prompt assembly, and stream lifecycle live in MAIN. The renderer
(`vision-panel.tsx`) only renders pushed `jedi:ai` events. There is NO renderer→main control surface for
vision; the trigger is a main-side hotkey only.
```typescript
// ai-orchestrator.ts:5-9
// ... The renderer is a pure view of the pushed IAiPushEvent`s (IN-01) — there is no
// renderer->main control surface; triggers come only from main-side hotkeys.
```

### By-convention singleton (no `@singleton()`)
**Source:** the verbatim `@remarks` block in `ai-orchestrator.ts:96-103`, `anthropic-ai.gateway.ts:23-27`,
`hotkey-registrar.service.ts:124-128`.
**Apply to:** `ScreenshotService` (new main-process service class). Copy the note: "The Electron main
process has no TSyringe DI container, so this is not an `@singleton()`; it is instantiated once in
`index.ts` and treated as a singleton by convention." Dependencies are constructor-injected; resolve at
the `index.ts` entry point only (no `container.resolve()` mid-method).

### Report-don't-throw on a transport/IO fault
**Source:** `anthropic-ai.gateway.ts:101-119` (`emitError`/`sanitizeAiError`); `index.ts:221-224` (the
audio-capture fault callback: "A capture/device fault must never crash main").
**Apply to:** `ScreenshotService` capture (a failed `desktopCapturer.getSources` must surface, not crash —
the orchestrator can push an inline `error` entry like the existing AI-error path) and the widened
`stream()`.

### Per-mode named constant (re-tierable)
**Source:** `ai-orchestrator.ts:26-37` (`ANSWER_MODEL`, `TALKING_POINTS_MODEL`, `MAX_TOKENS` record).
**Apply to:** `CODE_CHALLENGE_MODEL = 'claude-opus-4-8'` and the `'code-challenge': 1500` MAX_TOKENS key
(D-06). Widening `AiMode` forces the `Record<AiMode, number>` to gain the key (compiler-enforced).

### DRAFT-tunable system-prompt constant
**Source:** `prompt-assembler.ts:30-46` (`ANSWER_SYSTEM_PROMPT` / `TALKING_POINTS_SYSTEM_PROMPT`, each with
the "claude-api skill unavailable at research time, DRAFT wording tunable" TSDoc caveat).
**Apply to:** `VISION_SYSTEM_PROMPT` — same export-const style, same DRAFT caveat (RESEARCH §1 has a draft).

### Latency log — main-only, no payload (T-5-02 / T-5-10)
**Source:** `ai-orchestrator.ts:205-214` (`console.log('[ai] first-token mode=… model=… latencyMs=…')` —
"Only `mode`, `model`, and `latencyMs` are logged — never the transcript text, the key, or an error payload").
**Apply to:** vision automatically reuses this (RESEARCH §6 — third mode logs with no new code). NEVER log
the image base64. Capture `startMs` at the top of the code-challenge branch so capture time is included.

### Chord-entry + index.ts handler wiring (CTL-03)
**Source:** `hotkey-registrar.service.ts:105-111` (chord entry) ↔ `index.ts:140` (`open-settings` handler).
**Apply to:** the `capture-code-challenge` chord + its one-line `aiOrchestrator.trigger('code-challenge')`
handler. A missing handler surfaces in `register().failed` (CTL-03) — no registrar logic change.

### On-machine human-judged GO/NO-GO gate
**Source:** `01-PHASE-VERIFICATION.md` + root `VERIFICATION.md`.
**Apply to:** `07-VERIFICATION.md` — the three existential behaviors (transparency, focus, content
protection) plus screenshot-solve and native-module liveness are human-judged on the target machine.

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| (none) | — | — | Every file in scope has a strong in-repo analog. The only genuinely new mechanics (`desktopCapturer` single-display capture, `nativeImage.resize`) are Electron built-ins with no prior call site, but the SURROUNDING service/utility/test shapes all copy proven analogs. |

---

## Metadata

**Analog search scope:** `src/main/ai/`, `src/main/audio/`, `src/main/stt/`, `src/main/context/`,
`src/main/` (root: `index.ts`, `overlay-window.manager.ts`, `hotkey-registrar.service.ts`),
`src/renderer/src/components/`, repo root (`electron-builder.yml`, `package.json`),
`.planning/phases/01-*`.
**Files scanned:** ~22 source/config/doc files; 18 co-located `*.test.ts` enumerated (confirming the
co-located test convention).
**Key convention findings:**
1. Tests are CO-LOCATED (`x.ts` + `x.test.ts` siblings), NOT in `test/` subdirs — overrides RESEARCH.md's
   recommended path.
2. The AI path already declares Phase 7 as its extension point in its own TSDoc (`ai-gateway.interface.ts:20`).
3. The `activePanel` type is `'transcript' | 'ai'` (two-way) and must widen to add `'vision'` for the
   D-09 three-way focus cycle, in both `overlay-window.manager.ts` and the renderer mirror.
4. `MAX_TOKENS: Record<AiMode, number>` makes the new mode's token cap compiler-enforced once `AiMode` widens.
5. Main-process service classes carry NO `@singleton()` (no TSyringe in main) — a verbatim `@remarks`
   note is the established convention.
**Pattern extraction date:** 2026-06-19
