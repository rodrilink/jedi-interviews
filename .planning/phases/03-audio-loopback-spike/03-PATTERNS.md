# Phase 3: Audio Loopback Spike - Pattern Map

**Mapped:** 2026-06-17
**Files analyzed:** 7 (5 modified, 2+ new)
**Analogs found:** 5 / 7 (the two genuinely-new files — the renderer capture seam and the AudioWorklet processor — have no in-repo analog; RESEARCH/CLAUDE.md guidance applies)

> No RESEARCH.md for this phase (research skipped — approach locked in CONTEXT.md). File list extracted from CONTEXT.md `<canonical_refs>` and `<code_context>`.

---

## File Classification

| New/Modified File | New? | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|------|-----------|----------------|---------------|
| `src/main/overlay-window.manager.ts` | modify | manager (status/state) | event-driven push | self (Phase 2 `hotkeys`/`hudVisible` field) | exact |
| `src/preload/index.ts` | modify | bridge | request-response (subscribe) | self (Phase 2 `IOverlayStatus` mirror) | exact |
| `src/preload/index.d.ts` | maybe-modify | type decl | n/a | self | exact |
| `src/renderer/src/components/debug-hud.tsx` | modify | component (view) | event-driven (onStatus) | self (Phase 2 `Hotkeys:` row) | exact |
| `src/renderer/src/assets/hud.css` | modify | style | n/a | self (`.debug-hud__*`) | exact |
| `src/renderer/src/...` audio-capture seam (NEW) | new | service/module (renderer-side) | streaming (MediaStream → worklet) | partial: `*.service.ts` shape + `App.tsx` wiring | role-match (no streaming analog) |
| `src/renderer/src/...` AudioWorklet processor (NEW) | new | worklet (audio thread) | transform/streaming | **none** | no analog |
| `src/renderer/src/...` RMS utility + `.test.ts` (NEW, optional) | new | utility + test | transform | `*.test.ts` (Vitest AAA) | role-match |

**Locations marked `...` are Claude's discretion** (CONTEXT D-02 / "Claude's Discretion"). Recommended placements are given per-file below.

---

## Pattern Assignments

### `src/main/overlay-window.manager.ts` (manager, event-driven push) — MODIFY

**Analog:** itself — the Phase 2 `hotkeys` + `hudVisible` fields are the exact template. An audio-level field is added the **same four ways**.

**1. Add field to `IOverlayStatus`** (the interface at lines 11–28). Mirror the TSDoc style of the `hotkeys` field (lines 15–20):

```typescript
// existing fields ... hotkeys, hudVisible
/**
 * The latest RMS audio level from the renderer's loopback capture (D-04/D-05),
 * 0..1. Surfaced read-only in the HUD `Audio:` row to confirm non-silent signal
 * by eye. Unlike every other field this originates renderer-side (see Shared
 * Patterns → Renderer-originated status), not from window/main state.
 */
audioLevel: number;
```

**2. Module-level state + setter** — mirror `setHotkeyStatus` exactly (lines 39–55) and `lastHotkeyResult` (line 45):

```typescript
/**
 * The latest RMS level pushed up from the renderer capture (mirrors {@link lastHotkeyResult}):
 * owned at module level because it is not derivable from the window. Updated via
 * {@link setAudioLevel} before {@link pushStatus} so the HUD reflects it truthfully.
 */
let lastAudioLevel = 0;

/**
 * Records the latest RMS level so the next {@link pushStatus} carries it to the HUD.
 *
 * @param level - The RMS level in the range 0..1.
 */
export function setAudioLevel(level: number): void {
    lastAudioLevel = level;
}
```

**3. Include in `buildStatus`** (lines 118–128) — add one line alongside `hotkeys: lastHotkeyResult,`:

```typescript
return {
    electronVersion: process.versions.electron,
    contentProtection: contentProtectionEnabled,
    position: { x, y },
    hotkeys: lastHotkeyResult,
    hudVisible,
    audioLevel: lastAudioLevel,
};
```

**`pushStatus` itself (lines 136–142) does NOT change** — it already sends the whole `buildStatus()` payload over `STATUS_CHANNEL`.

> **Critical reconciliation (see Shared Patterns):** every existing field is set by main from window/registrar state. `audioLevel` is the first value that originates in the **renderer** (where `getDisplayMedia`/AudioWorklet live). The CONTEXT note (code_context → Established Patterns) says: "reconcile cleanly rather than adding a renderer→main control channel." This means a new renderer→main IPC path is required to carry the level up before `setAudioLevel` + `pushStatus` re-broadcast it — there is **no existing analog** for that direction; see the dedicated Shared Pattern below.

---

### `src/preload/index.ts` (bridge) — MODIFY

**Analog:** itself — the preload `IOverlayStatus` is a hand-mirrored copy of main's (lines 10–18, declared not imported by design — see comment lines 5–9). Add the **same** `audioLevel` field with an identical-declaration TSDoc note, matching the `hotkeys`/`hudVisible` one-liners (lines 14–17):

```typescript
/** Latest RMS audio level 0..1 (D-04). Declared identically in main and renderer. */
audioLevel: number;
```

**If a renderer→main reporting channel is chosen** (see Shared Patterns), it is added here as a new method on `jediApi` (lines 31–43). The current `onStatus` (lines 40–42) is the template for a read path; a *send* method (`ipcRenderer.send`) would be the first write surface — preserve the "renderer can only listen" comment intent by scoping it narrowly to the audio level. **`src/preload/index.d.ts`** auto-follows via the `JediApi`/`IOverlayStatus` re-export (lines 1, 11) — no manual edit unless a new method changes the exported type.

---

### `src/renderer/src/components/debug-hud.tsx` (component, view) — MODIFY

**Analog:** itself — the `Hotkeys:` row is the exact template (D-04).

**1. Mirror the field** in the local `IOverlayStatus` (lines 8–16) — same as preload.

**2. Derive a display label** next to the existing label derivations (lines 61–64). The `hotkeyLabel` ternary (line 64) is the template; add a number + block-bar (bar form is Claude's discretion per D-04):

```typescript
const audioLevelLabel = status ? formatAudioMeter(status.audioLevel) : '—';
```

**3. Render the row** — copy the `Hotkeys:` `<dt>/<dd>` pair (lines 82–85) into the same `<dl className="debug-hud__grid">`:

```tsx
<dt className="debug-hud__key">Audio</dt>
<dd className="debug-hud__value" data-testid="cell-audio-level">
    {audioLevelLabel}
</dd>
```

Follow the `data-testid` convention: `cell-` prefix (naming-conventions.md test-ID matrix), matching `cell-hotkey-status`, `cell-position`, etc.

**Note:** the component stays a **pure view** — it only reads `status.audioLevel` pushed via `onStatus` (lines 50–52). The capture/worklet does NOT live in this component; keep it in the dedicated seam module (below) and wire it in `App.tsx`.

---

### `src/renderer/src/assets/hud.css` (style) — MODIFY

**Analog:** itself — `.debug-hud__value` (lines 62–66) already sets `font-variant-numeric: tabular-nums`, ideal for a live number that updates rapidly without width jitter. If a block-character bar is added, define a `.debug-hud__meter` class near the cheat-sheet block (lines 73–81) following the existing `rgb(... / %)` color and hairline-border idiom. No structural CSS change is required for a plain number.

---

### Renderer audio-capture seam (NEW) — `src/renderer/src/services/audio-capture.service.ts` (recommended)

**Role:** service/module · **Data flow:** streaming (MediaStream → AudioContext → AudioWorkletNode)
**Analog:** partial only. Closest shape references:
- **Class + TSDoc + constructor-injected dependency** idiom → `WindowControlActionsService` (`src/main/window-control.actions.ts`, lines 56–60) and `HotkeyRegistrarService` (`hotkey-registrar.service.ts`, lines 80–97). Reuse: PascalCase + `Service` suffix, explicit return types, TSDoc on every public method, `@remarks` for the no-TSyringe note (this runs in the renderer, also no DI container).
- **Where it's wired** → `App.tsx` (lines 17–19) renders `<DebugHud />`; the capture seam should be started from the renderer entry (`App.tsx` via a `useEffect`, or `main.tsx`) so it auto-starts with no user gesture (D-03). Mirror `DebugHud`'s `useEffect(() => { window.jedi?.onStatus(...) }, [])` subscription idiom (debug-hud.tsx lines 50–52) for lifecycle.

**No analog exists for the Web Audio streaming pipeline itself.** Build per CLAUDE.md §"AudioWorklet" and §"System audio loopback":
- `navigator.mediaDevices.getDisplayMedia({ audio: true, video: true })` — **`video: true` MUST be present** (CONTEXT locked; `audio:true, video:false` throws on Windows). Immediately stop and discard the video track.
- `new AudioContext()` → `createMediaStreamSource(stream)` → `audioContext.audioWorklet.addModule(workletUrl)` → `new AudioWorkletNode(...)`.
- Receive RMS values from the worklet via `workletNode.port.onmessage`, throttle the update cadence (Claude's discretion, D-04), and report the level toward the HUD via the chosen renderer→main path (Shared Patterns).
- Manage `MediaStream`/`AudioContext` teardown (Claude's discretion per CONTEXT — consider stopping tracks / closing context on unmount/quit).

**Build/asset note:** the worklet module must be loadable at runtime by URL. There is **no precedent** in `electron.vite.config.ts` (lines 33–48, renderer block) for worklet/asset entries — the planner must handle worklet bundling (Vite `?url`/`?worker`-style import or a separate rollup input). This is a concrete unknown to resolve in 03-01.

---

### AudioWorklet processor (NEW) — `src/renderer/src/audio/rms-meter.worklet.ts` (recommended)

**Role:** worklet (runs on the audio render thread) · **Data flow:** transform (Float32 frames → RMS scalar)
**Analog:** **none.** No `*.worklet.ts` or `AudioWorkletProcessor` exists anywhere in the repo.

Build per CLAUDE.md §"AudioWorklet" (D-05): extend `AudioWorkletProcessor`, implement `process(inputs, outputs, parameters)`, compute RMS over the input Float32 frames, and `this.port.postMessage(rms)`. `registerProcessor('rms-meter', RmsMeterProcessor)`.

**Constraints to honor:**
- This is the **same worklet Phase 4 extends** to down-mix/resample to 16 kHz mono Int16 PCM (D-05, deferred to Phase 4) — structure it so the RMS computation is a clean, isolable layer (D-02: RMS meter is a removable verification layer).
- AudioWorklet global scope has **no DOM and no Node**; it cannot import the project's normal modules freely. Keep it self-contained. The pure RMS math, if extracted for unit testing, should live in a separate importable `*.utility.ts` (next file).
- IDEXX standards still apply where the toolchain allows: explicit return types, single quotes, 4-space indent, TSDoc. `code-standards.md` §Utilities: pure, idempotent, no side effects, no state — applies to the RMS math.

---

### RMS math utility + co-located test (NEW, optional but encouraged) — `src/renderer/src/audio/rms.utility.ts` + `rms.utility.test.ts`

**Role:** utility + unit test · **Data flow:** transform
**Analog:** test structure → `window-control.actions.test.ts` (full file) and `hotkey-registrar.service.test.ts`.

CONTEXT (code_context → Established Patterns) explicitly says: "worklet/RMS math is unit-testable even if the live capture is not." Extract the RMS computation into a pure function so it can be tested with Vitest, then import it into the worklet.

**Test pattern to copy** (from `window-control.actions.test.ts`):
- `import { beforeEach, describe, expect, it, vi } from 'vitest';` (line 1)
- `describe(...)` → `it('should ...')` with **AAA comments on their own lines** (testing-standards.md §AAA): lines 77–90 are the canonical example.
- `beforeEach(() => { vi.clearAllMocks(); ... })` (lines 70–75).
- Explicit type annotations on all test objects (testing-standards.md §Type Safety) — e.g. `const frames: Float32Array = ...`.
- Test happy path **and** edge cases: silent frame (all zeros → RMS 0, the D-06 "paused reads ~0" property), full-scale frame, empty array.

The pure-utility idiom (no class, no state, single exported function with explicit return type) is shown by `clamp` in `window-control.actions.ts` (lines 24–26).

---

## Shared Patterns

### Read-only status push (main → renderer) — the established one-way flow
**Source:** `overlay-window.manager.ts` `pushStatus` (lines 136–142) + `STATUS_CHANNEL = 'jedi:status'` (line 31); preload `onStatus` (lines 40–42); HUD `useEffect` subscription (debug-hud.tsx lines 50–52).
**Apply to:** the HUD `Audio:` row display. The level reaches the HUD exactly like every other field — `buildStatus()` includes it, `pushStatus()` sends it, `onStatus` delivers it, the HUD renders it. **No change to this flow's shape** — only a new field rides along.

### Renderer-originated value → main (NEW PATTERN, no analog) — REQUIRES A PLANNER DECISION
**Why it's needed:** `getDisplayMedia` and `AudioWorklet` exist **only in the renderer**, but `IOverlayStatus`/`pushStatus` are **main-owned**. Every current field is set from main-side state; `audioLevel` is the first value computed in the renderer. CONTEXT (code_context → Established Patterns) directs: *"reconcile cleanly rather than adding a renderer→main control channel."*

Two clean options for the planner to choose (and document the trade-off):
1. **Minimal renderer→main report channel** — add a narrow, write-only `ipcRenderer.send('jedi:audio-level', n)` in preload (new method on `jediApi`, mirroring `onStatus`'s structure at lines 40–42), main listens via `ipcMain.on`, calls `setAudioLevel(n)` + `pushStatus(window)`. Keeps the HUD a pure consumer of `jedi:status` (preserves D-04/the Phase 1/2 view contract) but introduces the app's first renderer→main surface. **There is no existing analog for `ipcRenderer.send`/`ipcMain.on` in this repo** — `index.ts` only registers app/window lifecycle, never IPC handlers.
2. **Renderer-local display** — the capture seam pushes the level straight into the HUD via renderer-internal state (e.g. a shared store/callback), bypassing main entirely for this one value. Avoids new IPC but **breaks the "HUD renders strictly from pushed `jedi:status`" invariant** (debug-hud.tsx lines 54–56) and the D-04 "same pattern as the Phase 2 `Hotkeys:` row" intent.

**Recommendation for the planner:** Option 1 best honors D-04 ("pushed over the read-only `jedi:status` channel — same pattern as the Phase 2 `Hotkeys:` row"). Flag explicitly that it adds the first renderer→main IPC channel (a genuinely new pattern), and keep that channel single-purpose and non-secret, consistent with the Phase 1 boundary comments in preload (lines 23–30).

### Singleton-by-convention services (no TSyringe in this app)
**Source:** `HotkeyRegistrarService` `@remarks` (hotkey-registrar.service.ts lines 68–79); `WindowControlActionsService` `@remarks` (window-control.actions.ts lines 51–55).
**Apply to:** the new audio-capture seam service. The IDEXX `@singleton()`/TSyringe pattern (architecture-patterns.md) does **not** apply — neither main nor renderer has a DI container here. Instantiate once (in `App.tsx`/entry) and document it with the same `@remarks` note.

### Defensive teardown / destroyed guards
**Source:** `pushStatus` destroyed guard (lines 137–139); every `WindowControlActionsService` method's `isDestroyed()` guard; `window-all-closed` teardown in `index.ts` (lines 84–91).
**Apply to:** capture lifecycle. If capture/teardown is wired (Claude's discretion per CONTEXT), follow the `window-all-closed` → `registrar.teardown()` idiom for releasing the `MediaStream`/`AudioContext`.

### Strict TypeScript / IDEXX standards (everywhere)
**Source:** every file in the repo. Explicit return types on exports, single quotes, 4-space indent, 180-col, trailing ES5 commas, TSDoc on exports (`@param`/`@returns`/`@throws`). Interfaces are `IOverlayStatus`-style — note the repo follows the existing local `IOverlayStatus` (no `I`-less names) but does NOT prefix every interface (e.g. `IVirtualDesktopBounds` is prefixed, matching naming-conventions.md). Match the prevailing local style of each file you touch.

---

## No Analog Found

| File | Role | Data Flow | Reason planner uses CLAUDE.md / Web Audio docs instead |
|------|------|-----------|--------------------------------------------------------|
| AudioWorklet processor (`*.worklet.ts`) | worklet | transform/streaming | No `AudioWorkletProcessor` anywhere in repo; build per CLAUDE.md §AudioWorklet. Worklet bundling has no precedent in `electron.vite.config.ts`. |
| Renderer audio-capture seam (Web Audio pipeline) | service | streaming | No `getDisplayMedia`/`AudioContext`/MediaStream code exists; only the *class shape* and *entry wiring* have analogs, not the streaming pipeline. |
| Renderer→main report channel (if Option 1 chosen) | IPC | request (write) | Repo has zero `ipcRenderer.send`/`ipcMain.on`; all current IPC is one-way main→renderer via `webContents.send`. |

---

## Metadata

**Analog search scope:** `src/main/**`, `src/preload/**`, `src/renderer/**`, `electron.vite.config.ts`, `package.json`, `tsconfig.web.json`
**Files scanned:** 13 source files (5 main, 2 preload, 3 renderer, 3 tests) + 3 config files
**Pattern extraction date:** 2026-06-17
```