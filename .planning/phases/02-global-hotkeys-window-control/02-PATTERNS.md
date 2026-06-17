# Phase 2: Global Hotkeys + Window Control - Pattern Map

**Mapped:** 2026-06-17
**Files analyzed:** 6 (3 new, 3 modified)
**Analogs found:** 6 / 6

## File Classification

| New/Modified File | New/Mod | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|---------|------|-----------|----------------|---------------|
| `src/main/hotkey-registrar.service.ts` | new | service | event-driven | `src/main/placeholder-secret.service.ts` | role-match (service-suffix, main-process boundary) |
| `src/main/window-control.actions.ts` (or `.service.ts`) | new | service | transform / request-response | `src/main/overlay-window.manager.ts` (`showOverlay`) | role-match (same module, mutates same window) |
| `src/main/hotkey-registrar.service.test.ts` | new | test | event-driven | `src/main/placeholder-secret.service.test.ts` | exact (Vitest, node env, electron mock) |
| `src/main/overlay-window.manager.ts` | mod | manager/utility | request-response | itself (`showOverlay`, `IOverlayStatus`, `pushStatus`) | exact (extend in place) |
| `src/main/index.ts` | mod | handler/bootstrap | event-driven | itself (`bootOverlay`, `app.whenReady`) | exact (extend in place) |
| `src/preload/index.ts` | mod | bridge | request-response (one-way push) | itself (`IOverlayStatus`, `onStatus`) | exact (extend in place) |
| `src/renderer/src/components/debug-hud.tsx` | mod | component | event-driven (subscription) | itself (`DebugHud`, `onStatus`) | exact (extend in place) |

> Note on the `jedi:status` contract: `IOverlayStatus` is **declared three times** (main, preload, renderer) — each layer is bundled separately and must not import across the boundary. Any field added to the payload (hotkey status, HUD `visible` flag) MUST be added to all three declarations identically. This is an established, intentional duplication — do not try to centralize it.

## Pattern Assignments

### `src/main/hotkey-registrar.service.ts` (new — service, event-driven)

**Analog:** `src/main/placeholder-secret.service.ts` (main-process service, exported function, TSDoc, returns a boolean success signal — mirror the registration-result aggregation shape).

**Module-level constants pattern** (placeholder-secret.service.ts:9, :16):
```typescript
// SCREAMING_SNAKE_CASE module constants for fixed config (chords, steps).
const PLACEHOLDER = 'jedi-placeholder-secret';
const CIPHERTEXT_STORE_KEY = 'secretCiphertext';
```
Apply: define the locked Ctrl+Alt chord map and per-action handlers as module-level constants/registry (D-05 action set is locked; exact chords chosen in 02-03).

**Exported function with explicit return type + TSDoc `@returns` documenting the no-throw failure path** (placeholder-secret.service.ts:36-52):
```typescript
export function proveSecretBoundary(): boolean {
    if (!safeStorage.isEncryptionAvailable()) {
        return false; // returns false WITHOUT throwing on unavailability
    }
    // ...
    return decrypted === PLACEHOLDER;
}
```
Apply: the hotkey registrar's entry point should **aggregate each `register()`/hook result and return a structured outcome** (e.g. `{ active: 'uiohook' | 'globalShortcut'; failed: string[] }`) rather than throwing — D-08 (launch anyway with working hotkeys, surface the failures). Mirror the "degrade gracefully, return a result" shape exactly.

**Defensive availability guard before the native call** (placeholder-secret.service.ts:37-39): the `isEncryptionAvailable()` early-return is the analog for "try `uiohook` attach; if it throws/fails, fall back to `globalShortcut` before reporting" (D-08, fallback locked upstream).

**Native-module note:** `uiohook-napi@1.5.5` is the first native module in the repo → must be rebuilt against Electron 35.7.5's ABI via `@electron/rebuild` (CLAUDE.md §"Version Compatibility"). No existing analog for native rebuild — this is a fresh install/build step (ROADMAP "evaluate rebuild" flag).

---

### `src/main/window-control.actions.ts` (new — service, transform)

**Analog:** `src/main/overlay-window.manager.ts` — same module domain; every action mutates the same `BrowserWindow` and must compose with the existing `showOverlay` / blur / display handlers.

**The `showOverlay` re-show contract (lines 167-175) — every re-show path MUST route through this, never `show()`/`focus()`:**
```typescript
export function showOverlay(window: BrowserWindow): void {
    window.setAlwaysOnTop(true, 'screen-saver');
    window.setContentProtection(true);
    contentProtectionEnabled = true;
    window.setIgnoreMouseEvents(true, { forward: true });
    window.setVisibleOnAllWorkspaces(true);
    window.showInactive();
    pushStatus(window);
}
```
Apply: the show/hide action calls `showOverlay(window)` for reveal and `window.hide()` for hide (CONTEXT code_context: "Hide has no wrapper yet — Phase 2 adds the hide path (likely `window.hide()`), but every re-show must go through `showOverlay()`"). Do NOT inline the always-on-top/content-protection re-assertion in the action — call the wrapper.

**`isDestroyed()` guard before every window operation** (overlay-window.manager.ts:49, 105-107, 118-120):
```typescript
if (window.isDestroyed()) {
    return;
}
```
Apply: guard every move/opacity/show/hide action handler — hotkeys can fire during teardown.

**`screen` geometry usage for multi-monitor clamping** (overlay-window.manager.ts:1, 125-127): `import { screen } from 'electron'` is already in this module. The display-change handlers (`display-metrics-changed`, `display-added`, `display-removed`) already re-run `showOverlay`. Move-with-clamp (D-10) must compose with these — use `screen.getDisplayNearestPoint` / work-area math to clamp at the **outermost virtual-desktop edge**, never fight the `display-*` re-assert.

**`window.getPosition()` / `setPosition` and `setOpacity`:** position is read via `window.getPosition()` (overlay-window.manager.ts:33). Move actions call `window.setPosition(x, y)`; the existing `'move'` handler (lines 130-132) already calls `pushStatus` so the HUD reflects new position for free. Opacity uses `window.setOpacity` (D-09 floor 20% → ceiling 100%, 10% steps; D-03). Hold-to-repeat (D-01) is driven off uiohook's native key-repeat events in the registrar, not here.

---

### `src/main/hotkey-registrar.service.test.ts` (new — test, Vitest)

**Analog:** `src/main/placeholder-secret.service.test.ts` (exact — same env, same mock strategy).

**CRITICAL test-infra constraint** (`vitest.config.ts`): `environment: 'node'`, `include: ['src/**/*.test.ts']`. There is **NO jsdom / React Testing Library setup** and `.test.tsx` is NOT matched. Main-process service tests fit this config as-is. A `debug-hud` component test would require adding jsdom + RTL + a `.tsx` include glob — out of scope unless explicitly planned; prefer testing the new logic in main-process services.

**`vi.mock('electron', …)` factory pattern** (placeholder-secret.service.test.ts:11-17):
```typescript
const mockIsEncryptionAvailable = vi.fn<() => boolean>();
vi.mock('electron', () => ({
    safeStorage: {
        isEncryptionAvailable: (): boolean => mockIsEncryptionAvailable(),
        // ...
    },
}));
```
Apply: mock `uiohook-napi` (and `electron`'s `globalShortcut` for the fallback path) the same way — hoisted `vi.fn` handles wired into a factory, so registration success/failure and the fallback branch can be driven per-test.

**Dynamic `await import()` after mock setup** (placeholder-secret.service.test.ts:50, 65, 83): import the service inside each test (after `mockReturnValue`) so the mock state is in place before module init.

**AAA with bare comments + explicit type annotations** (placeholder-secret.service.test.ts:35-60):
```typescript
beforeEach(() => {
    vi.clearAllMocks();
    // ...
});

it('should ... ', async () => {
    // Arrange
    mockIsEncryptionAvailable.mockReturnValue(true);
    // Act
    const result: boolean = proveSecretBoundary();
    // Assert
    expect(result).toBe(true);
});
```
Apply: `// Arrange` / `// Act` / `// Assert` on their own lines, no trailing explanation (testing-standards). Cover happy path (all chords register), the failure path (some fail → surfaced, not thrown — D-08), and the uiohook-attach-fails → globalShortcut-fallback branch.

---

### `src/main/overlay-window.manager.ts` (modify — extend the status contract)

**Extend `IOverlayStatus`** (lines 11-15) — ADD fields, do not replace:
```typescript
export interface IOverlayStatus {
    electronVersion: string;
    contentProtection: boolean;
    position: { x: number; y: number };
    // Phase 2 additions:
    hudVisible: boolean;            // HUD content toggle flag (D-14/D-15), owned by main
    hotkeys: { active: string; failed: string[] }; // registration outcome (D-06)
}
```
Then extend `buildStatus` (lines 32-40) to populate the new fields. Keep the payload strictly non-secret and one-way. The main process owns the `hudVisible` and `hotkeys` state (D-15) — pass it into `buildStatus`/`pushStatus` from the registrar/index.

**`pushStatus` is the single push seam** (lines 48-54) — the registrar feeds its aggregated result through `pushStatus(window)`; do not add a new channel.

---

### `src/main/index.ts` (modify — register hotkeys in bootstrap)

**Analog:** itself — extend `bootOverlay` / `app.whenReady` (lines 13-32).

**Boot ordering pattern** (lines 13-25): `createOverlayWindow()` → `ready-to-show` → `showOverlay` + `pushStatus`. Register the HotkeyService **after** the overlay boots inside `app.whenReady()` (CONTEXT Integration Points). Pass the window handle so action handlers can mutate it.

**Teardown pattern** (lines 34-38): `window-all-closed` → `app.quit()` (non-darwin). Add uiohook hook teardown (`uIOhook.stop()` / `globalShortcut.unregisterAll()`) on quit / `window-all-closed` so the native hook is released (CONTEXT Integration Points: "tear the hook down on window-all-closed/quit"). The quit hotkey (D-04) calls `app.quit()`.

---

### `src/preload/index.ts` (modify — mirror the extended payload)

**Mirror `IOverlayStatus`** (lines 10-14) with the SAME new fields added to the main declaration. This duplication is intentional (the preload is bundled separately — see comment at preload/index.ts:5-8). `onStatus` (lines 36-38) is unchanged — it already forwards whatever payload arrives. Do NOT add a renderer→main control channel (D-15).

**Also update** `src/preload/index.d.ts` re-export (it re-exports `IOverlayStatus` for the renderer) — no change to its shape needed, it tracks `JediApi`/`IOverlayStatus` by type.

---

### `src/renderer/src/components/debug-hud.tsx` (modify — drive `visible`, add rows)

**Analog:** itself.

**Mirror `IOverlayStatus`** (lines 8-12) with the new fields (third duplicate declaration).

**Drive `visible` from pushed state** (D-14/D-15): the component already accepts `visible?: boolean` (line 27) and subscribes via `window.jedi?.onStatus` (lines 30-32). Phase 2: derive HUD visibility from `status.hudVisible` (main owns the toggle). `App.tsx` currently hard-codes `visible={true}` (App.tsx:16) — rewire it to read the pushed flag, or have `DebugHud` honor `status.hudVisible` internally. Keep the renderer a pure view.

**Add rows following the existing `<dt>/<dd>` + `data-testid` pattern** (lines 45-58):
```typescript
<dt className="debug-hud__key">Content protection</dt>
<dd className="debug-hud__value" data-testid="cell-content-protection">
    {contentProtectionLabel}
</dd>
```
Apply: add a `Hotkeys: OK / N failed` row (D-06) and a compact hotkey cheat-sheet (D-13). Use `data-testid` per the naming matrix — `cell-hotkey-status`, e.g. `row-hotkey-<action>` for cheat-sheet rows. CSS lives in `src/renderer/src/assets/hud.css`.

## Shared Patterns

### Read-only `jedi:status` IPC contract (extend, never replace)
**Source:** `src/main/overlay-window.manager.ts:11-54`, `src/preload/index.ts:10-38`, `src/renderer/src/components/debug-hud.tsx:8-32`
**Apply to:** all three files that declare `IOverlayStatus`.
- One-way main → renderer push over `STATUS_CHANNEL = 'jedi:status'`.
- `IOverlayStatus` declared identically in three places (bundling boundary).
- Main owns all control state (D-15); renderer only listens. Never add a renderer→main channel.

### TSDoc + explicit return types on all exports
**Source:** every file (e.g. overlay-window.manager.ts:42-48, placeholder-secret.service.ts:21-36)
**Apply to:** all new exported functions — `@param`, `@returns`, and `@throws` where relevant; 4-space indent, single quotes (IDEXX code-standards).

### `isDestroyed()` defensive guard
**Source:** `src/main/overlay-window.manager.ts:49, 105, 118`
**Apply to:** every new window-mutating action handler (hotkeys fire async, possibly mid-teardown).

### Graceful-degradation return shape (no throw on environmental failure)
**Source:** `src/main/placeholder-secret.service.ts:37-39, 45-47`
**Apply to:** the hotkey registrar — return a structured success/failure outcome (D-08), do not throw when a chord conflicts or uiohook can't attach.

### `.service.ts` suffix + verb-named service class/function
**Source:** `src/main/placeholder-secret.service.ts`, CLAUDE.md naming-conventions
**Apply to:** the new HotkeyService file — name it `hotkey-registrar.service.ts` (or similar verb-named), co-locate `.test.ts`.

## No Analog Found

| File / Concern | Role | Data Flow | Reason |
|----------------|------|-----------|--------|
| Native module install + `@electron/rebuild` against Electron 35.7.5 ABI | build step | n/a | First native module in the repo (`uiohook-napi`); no prior rebuild precedent — fresh planned step (ROADMAP flag). |
| `uiohook-napi` event subscription + hold-to-repeat (D-01) | event-driven | n/a | No existing global-input-hook code; follow CLAUDE.md §Recommended Stack (passive hook, never consumes keys) and the SDK's keydown/keyup/keyrepeat events. |
| `globalShortcut` fallback layer (D-08) | event-driven | n/a | Not yet used; documented fallback only (CLAUDE.md §"What NOT to Use" — fallback-only). Mock it in tests via `vi.mock('electron')`. |
| DebugHud `.test.tsx` component test | test | n/a | `vitest.config.ts` is `environment: 'node'` and only includes `**/*.test.ts`. No jsdom/RTL configured — adding a component test requires test-infra work; prefer covering Phase 2 logic in main-process `.test.ts` services. |

## Metadata

**Analog search scope:** `src/main/`, `src/preload/`, `src/renderer/src/`, repo root config.
**Files scanned:** 9 (overlay-window.manager.ts, index.ts, preload/index.ts, preload/index.d.ts, debug-hud.tsx, App.tsx, placeholder-secret.service.ts, placeholder-secret.service.test.ts, vitest.config.ts).
**Pattern extraction date:** 2026-06-17
