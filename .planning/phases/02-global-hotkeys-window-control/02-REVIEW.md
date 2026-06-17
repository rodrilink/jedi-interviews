---
phase: 02-global-hotkeys-window-control
reviewed: 2026-06-17T00:00:00Z
depth: standard
files_reviewed: 11
files_reviewed_list:
  - src/main/hotkey-registrar.service.ts
  - src/main/hotkey-registrar.service.test.ts
  - src/main/window-control.actions.ts
  - src/main/window-control.actions.test.ts
  - src/main/overlay-window.manager.ts
  - src/main/index.ts
  - src/preload/index.ts
  - src/renderer/src/components/debug-hud.tsx
  - src/renderer/src/App.tsx
  - src/renderer/src/assets/hud.css
  - package.json
findings:
  critical: 1
  warning: 6
  info: 4
  total: 11
status: issues_found
---

# Phase 02: Code Review Report

**Reviewed:** 2026-06-17
**Depth:** standard
**Files Reviewed:** 11
**Status:** issues_found

## Summary

Phase 02 adds the global hotkey registrar, the window-control action handlers, the overlay
window manager, and the debug HUD. The focus-discipline constraints are mostly honored:
`createOverlayWindow` uses `focusable: false` + `showInactive()`, click-through and content
protection are re-asserted on every show, and the renderer remains a pure view driven by
main-owned status. The contextIsolation/sandbox boundary is preserved and the preload fails
loudly if isolation is ever disabled — good.

However, the central design abstraction of the registrar — the `ActionKind` (`repeat` vs
`discrete`) distinction — is declared, documented at length, but **never actually applied** in
the uiohook dispatch path. The result is a real behavioral defect: discrete actions
(`show/hide` in particular) fire on every OS key-repeat event, so holding the show/hide chord
rapidly flip-flops the overlay's visibility. The registrar is also non-idempotent: a second
`register()` stacks duplicate uiohook listeners, and `teardown()` never detaches them. Several
narrower robustness gaps (HUD listener leak, missing electron-store/AI deps vs. CLAUDE.md,
no debounce for discrete chords) are flagged below.

## Critical Issues

### CR-01: `ActionKind` 'discrete' is never enforced — discrete chords fire on every OS key-repeat

**File:** `src/main/hotkey-registrar.service.ts:160-174` (dispatch), `:31-42`, `:53-63` (declaration)
**Issue:** `IHotkeyChord.kind` (`'repeat' | 'discrete'`) is declared, populated for every chord,
and documented extensively (lines 41-42, 141-143, 153-158) as the mechanism that gives move/
opacity hold-to-repeat while keeping `show/hide`, `hud-toggle`, and `quit` to one fire per
press. But `dispatchUiohookKeydown` never reads `chord.kind` — it invokes the handler on **every**
matching keydown, including the OS auto-repeat stream. The service's own test confirms this:
`hotkey-registrar.service.test.ts:199` asserts `show/hide` is called **2 times** for two
keydowns and the comment rationalizes it as "an idempotent toggle."

`show/hide` is **not** idempotent — it flip-flops (`index.ts:26-32` branches on
`getOverlayVisible()`). Holding `Ctrl+Alt+J` therefore makes the overlay strobe show/hide at the
OS repeat rate (~30/sec), and on key release the final visibility is non-deterministic (depends
on the parity of repeat events delivered). `hud-toggle` has the same flip-flop problem
(`window-control.actions.ts:120-127`). This directly contradicts the documented D-01 contract.

**Fix:** Track held keycodes and only fire `discrete` handlers on the leading edge:
```typescript
private readonly heldDiscreteKeycodes = new Set<number>();

private dispatchUiohookKeydown(event: UiohookKeyboardEvent): void {
    if (!event.ctrlKey || !event.altKey) {
        return;
    }
    const chord = HOTKEY_CHORDS.find((candidate) => candidate.keycode === event.keycode);
    if (chord === undefined) {
        return;
    }
    if (chord.kind === 'discrete') {
        if (this.heldDiscreteKeycodes.has(chord.keycode)) {
            return; // ignore OS auto-repeat for discrete actions
        }
        this.heldDiscreteKeycodes.add(chord.keycode);
    }
    const handler = this.handlers[chord.label];
    if (typeof handler === 'function') {
        handler();
    }
}
```
Add a `keyup` listener that clears the keycode from `heldDiscreteKeycodes` so the next discrete
press fires. Update the test at `:199` to assert `show/hide` fires **once** across repeated
keydowns.

**RESOLVED (commit 63fdff4):** `dispatchUiohookKeydown` now branches on `chord.kind`. Discrete
chords use a `heldDiscreteKeycodes` leading-edge guard — fire once per press, ignore the OS
auto-repeat keydown stream until a `keyup` listener clears the held keycode. Repeat chords
(move/opacity) are untouched and still fire per keydown (D-01). `teardown()` clears the held set.
The misleading "idempotent toggle" comment was replaced. Tests now assert: held discrete chord
fires once across two keydowns, fires again after a keyup, and repeat chords fire per keydown.

## Warnings

### WR-01: `register()` is non-idempotent — duplicate uiohook listeners stack

**File:** `src/main/hotkey-registrar.service.ts:132-151`
**Issue:** `bindViaUiohook` calls `uIOhook.on('keydown', …)` and `uIOhook.start()` every time
`register()` runs, but never removes a previously-attached listener. A second `register()` (the
test does exactly this at `:125` and `:163`) attaches a second keydown listener and starts the
hook again, so every chord handler fires twice per keydown thereafter. Production calls
`register()` once (`index.ts:73`), so this is latent today, but the abstraction advertises no
single-call constraint and the test masks it by asserting only `not.toThrow()`.
**Fix:** Guard re-entry (return early / teardown first if `activeLayer !== 'none'`), and store the
bound listener reference so it can be removed in `teardown()`:
```typescript
public register(): IHotkeyRegistrationResult {
    if (this.activeLayer !== 'none') {
        this.teardown();
    }
    // …existing body…
}
```

### WR-02: `teardown()` never detaches the uiohook keydown listener

**File:** `src/main/hotkey-registrar.service.ts:114-122`, `:144-146`
**Issue:** The uiohook teardown calls `uIOhook.stop()` but leaves the `.on('keydown', …)`
listener attached to the singleton `uIOhook` EventEmitter. Combined with WR-01, any
re-`register()` accumulates listeners on a process-global emitter. Even without re-register, the
closure keeps `this` (and therefore the `BrowserWindow` via the handler map) reachable after
teardown.
**Fix:** Keep a reference to the bound handler (`this.boundKeydown = (e) => this.dispatch…`),
attach with that reference, and call `uIOhook.off('keydown', this.boundKeydown)` in `teardown()`.

### WR-03: HUD status subscription leaks listeners — no useEffect cleanup, no unsubscribe API

**File:** `src/renderer/src/components/debug-hud.tsx:50-52`; `src/preload/index.ts:40-42`
**Issue:** `useEffect(() => { window.jedi?.onStatus(...) }, [])` returns no cleanup function, and
`onStatus` in the preload registers an `ipcRenderer.on(STATUS_CHANNEL, …)` listener that is never
removable (no unsubscribe is returned). Under React 19 StrictMode (dev) the effect runs twice,
registering two IPC listeners; each main push then invokes `setStatus` twice. More generally the
listener can never be torn down, so any future remount leaks a renderer-side IPC listener.
**Fix:** Have `onStatus` return an unsubscribe function and call it from the effect cleanup:
```typescript
// preload
onStatus(callback) {
    const listener = (_e, status) => callback(status);
    ipcRenderer.on(STATUS_CHANNEL, listener);
    return () => ipcRenderer.removeListener(STATUS_CHANNEL, listener);
}
// component
useEffect(() => window.jedi?.onStatus(setStatus), []);
```

### WR-04: No debounce/guard on discrete `quit` chord during auto-repeat

**File:** `src/main/window-control.actions.ts:133-135`; `src/main/hotkey-registrar.service.ts:160-174`
**Issue:** Tied to CR-01: `quit` is `discrete` but fires on every key-repeat. `app.quit()` being
called dozens of times is mostly harmless, but combined with `show/hide` strobing it confirms the
discrete contract is unenforced everywhere, not just for show/hide. Resolving CR-01 fixes this;
called out separately because `quit` would otherwise be dismissed as "idempotent."
**Fix:** Covered by the CR-01 leading-edge guard.

### WR-05: `move()` Y-clamp can place the window in a dead zone between mismatched monitors

**File:** `src/main/window-control.actions.ts:145-158`, `:182-201`
**Issue:** `virtualDesktopBounds` unions every display's work area into one rectangle, then
`move` clamps X and Y independently against that union. With monitors of different heights or
vertical offsets (e.g. a 1080p screen beside a 1440p screen), the union rectangle includes
coordinates that lie on no physical display. The overlay can be moved into that gap and become
invisible — the exact "overlay can't be lost" guarantee D-09/D-10 is trying to provide. The
single-display and equal-height side-by-side tests (`window-control.actions.test.ts:105-132`) do
not exercise this.
**Fix:** Clamp against the work area of the display the window currently overlaps most
(`screen.getDisplayMatching(windowBounds).workArea`) rather than the global union, or at minimum
add a regression test with staggered-height displays and document the accepted behavior.

### WR-06: Production runtime dependencies absent from `package.json`

**File:** `package.json:29-32`
**Issue:** `dependencies` lists only `electron-store` and `uiohook-napi`. The project spec
(CLAUDE.md) and the stated v1 scope require `@deepgram/sdk` and `@anthropic-ai/sdk`, and the
overlay manager relies on Electron `safeStorage`/`BrowserWindow` behaviors. For phase 02 this is
in-scope only insofar as `react`/`react-dom` are listed under **devDependencies** (lines 37, 43-44)
despite being shipped runtime code in the packaged renderer. Misclassified deps can be pruned by
`npm prune --production` during packaging and break the build.
**Fix:** Move `react` and `react-dom` to `dependencies`. (Deepgram/Anthropic are later phases —
note only, not a blocker for this phase.)

## Info

### IN-01: `HotkeyLayer`/accelerator strings duplicated as untyped `string` across the IPC boundary

**File:** `src/main/overlay-window.manager.ts:20`, `:45`, `:53`; `src/preload/index.ts:15`; `src/renderer/src/components/debug-hud.tsx:13`
**Issue:** `IOverlayStatus.hotkeys.active` is typed as `string` in the status payload, discarding
the precise `HotkeyLayer` union from the registrar. The three structurally-identical
`IOverlayStatus` interfaces are hand-maintained in main, preload, and renderer; a field rename in
one will silently drift.
**Fix:** Export a shared type module (or narrow `active` to the `HotkeyLayer` union) so drift is a
compile error.

### IN-02: `setOverlayVisible` exported but only used internally; `getOverlayVisible` is the sole external consumer

**File:** `src/main/overlay-window.manager.ts:98-100`
**Issue:** `setOverlayVisible` is exported but only ever called inside the module (by `showOverlay`/
`hideOverlay`). Unused exports widen the surface and invite callers to bypass the
show/hide wrappers and desync the flag.
**Fix:** Drop the `export` on `setOverlayVisible` (keep it module-private).

### IN-03: `forward: true` comment claims renderer can observe move events, but window is non-interactive

**File:** `src/main/overlay-window.manager.ts:183-187`, `:259`
**Issue:** The comment says `forward: true` "still lets the renderer observe move events for hover
effects," but the app is documented keyboard-only and click-through-permanent; there are no hover
effects. Comment describes intent that the design explicitly rejects (the *what*, not a real
*why*), which will mislead future readers.
**Fix:** Trim the comment to state only the load-bearing reason (`forward: true` keeps move events
flowing so click-through stays reliable) or drop the hover-effects claim.

### IN-04: `DebugHud` `visible` prop is dead in practice

**File:** `src/renderer/src/components/debug-hud.tsx:47`, `:56`; `src/renderer/src/App.tsx:18`
**Issue:** `App` renders `<DebugHud />` with no prop, and once the first status push arrives the
component reads `status.hudVisible` exclusively. The `visible` prop only matters for the
sub-second window before the first push and has no test coverage.
**Fix:** Keep if intentional (it is the documented launch fallback), but add a brief test asserting
the pre-push default renders, or remove the prop and default to `true` internally.

---

_Reviewed: 2026-06-17_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
