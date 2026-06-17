---
phase: 01-overlay-shell-existential-behaviors
plan: 02
subsystem: overlay
tags: [electron, browser-window, content-protection, focus-discipline, contextBridge, react, hud]

# Dependency graph
requires:
  - 01-01 (electron-vite scaffold + contextIsolation/sandbox/typed contextBridge boundary)
provides:
  - createOverlayWindow() — transparent/frameless/focusable:false overlay BrowserWindow
  - showOverlay(win) — the only sanctioned reveal; re-applies alwaysOnTop('screen-saver') + setContentProtection(true) on every show, then showInactive (never show/focus)
  - Read-only non-secret jedi:status channel (window.jedi.onStatus) carrying {electronVersion, contentProtection, position}
  - Toggleable debug HUD (DebugHud, visible prop) surviving into later phases (D-07/D-08)
affects:
  - 01-03 (safeStorage round-trip — independent main-process work, no dependency on this slice)
  - 01-04 (on-machine GO/NO-GO gate verifies OVL-01/02/04 against this overlay + HUD readout)
  - Phase 2 (hotkey layer acts on the WindowManager and wires the HUD visible toggle)
  - Phase 6 (real secret channels extend the same preload contextBridge namespace)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Content-protection-reapplying showOverlay() wrapper (re-applied on every show + blur + display change)
    - focusable:false + showInactive-only reveal (never show()/focus()) for focus discipline
    - Single read-only non-secret main→renderer status channel via contextBridge (the only Phase 1 IPC surface)
    - Module-level content-protection state tracked so the HUD reflects ON/OFF truthfully
    - Toggleable debug HUD component (visible prop) that survives into later phases

key-files:
  created:
    - src/main/overlay-window.manager.ts
    - src/renderer/src/components/debug-hud.tsx
    - src/renderer/src/assets/hud.css
  modified:
    - src/main/index.ts
    - src/preload/index.ts
    - src/preload/index.d.ts
    - src/renderer/src/App.tsx

key-decisions:
  - "HUD is a <section>/<dl> with per-row data-testid (cell-electron-version/-content-protection/-position) plus card-debug-hud on the root, styled entirely via hud.css (no inline style props)"
  - "IOverlayStatus declared in both main and preload (mirrored, not imported) because the sandboxed preload is bundled separately and must not reach into main; renderer redeclares it locally for the same reason"
  - "showOverlay calls setVisibleOnAllWorkspaces(true) as a documented harmless no-op on Windows — intent recorded, behavior not relied on"

patterns-established:
  - "showOverlay() is the ONLY sanctioned reveal path; it re-applies content protection on every show and is re-asserted on blur + display-metrics/added/removed"
  - "One read-only, non-secret status channel (jedi:status) is the entire Phase 1 IPC surface (D-05)"

requirements-completed: [OVL-01, OVL-02, OVL-04]

# Metrics
duration: 6min
completed: 2026-06-17
---

# Phase 1 Plan 02: Overlay WindowManager + Debug HUD Summary

**A transparent/frameless/always-on-top, focusable:false overlay shown only via a content-protection-reapplying `showOverlay()` wrapper, rendering a toggleable debug HUD that displays the live Electron version, content-protection state, and window position over a read-only non-secret main→preload→renderer channel.**

## Performance

- **Duration:** ~6 min
- **Tasks:** 2
- **Files:** 3 created, 4 modified

## Accomplishments
- Built `src/main/overlay-window.manager.ts` exporting `createOverlayWindow(): BrowserWindow` and `showOverlay(win): void` (explicit return types, IDEXX standard). The window is `transparent`, `frame:false`, `focusable:false`, `skipTaskbar:true`, `resizable:false`, `hasShadow:false`, `backgroundColor:'#00000000'`, `show:false`, with `contextIsolation:true` + `sandbox:true` + `backgroundThrottling:false` (D-06 boundary preserved).
- `showOverlay` re-applies, in order, `setAlwaysOnTop(true,'screen-saver')`, `setContentProtection(true)` (every show — OVL-04 / Pitfall 2), then `showInactive()` (never `show()`/`focus()` — OVL-02 / Pitfall 3).
- Defensive re-assertion wired: `'blur'` re-applies always-on-top + content protection; `display-metrics-changed` / `display-added` / `display-removed` re-run `showOverlay`. Screen listeners are cleaned up on `'closed'`.
- `index.ts` boots the overlay after `ready-to-show` (transparent white-flash mitigation, Pitfall 6) and primes the HUD with a first status push.
- Extended the preload `window.jedi` namespace with a read-only `onStatus(cb)` over `ipcRenderer.on('jedi:status', ...)` — the only IPC surface in Phase 1, carrying no secrets (D-05). Typed `IOverlayStatus` in preload + re-exported from `index.d.ts`.
- Built `debug-hud.tsx`: a `DebugHud({ visible })` component (defaults shown — D-08) that subscribes via `window.jedi.onStatus` and renders Electron version, content protection ON/OFF, and position. Carries `data-testid="card-debug-hud"` plus per-cell test ids. Styled via `hud.css` with a transparent body/root background; no inline `style=` props.
- Mounted the HUD in `App.tsx` (replacing the scaffold proof-of-life markup).
- All gates green: `npm run typecheck`, `npm run lint`, `npm run format:check` exit 0; full `electron-vite build` produces clean main/preload(.cjs)/renderer bundles with the HUD CSS bundled as a CSP-compatible `'self'` asset.

## Task Commits

1. **Task 1: Overlay WindowManager + content-protection-reapplying showOverlay** - `d82d6c8` (feat)
2. **Task 2: Read-only status channel + toggleable debug HUD** - `2c4caf0` (feat)

## Files Created/Modified
- `src/main/overlay-window.manager.ts` (created) - `createOverlayWindow`, `showOverlay`, `pushStatus`, `IOverlayStatus`, `STATUS_CHANNEL`; blur/display re-assert; module-level CP-state tracking
- `src/main/index.ts` (modified) - Boots the overlay via the manager after `ready-to-show`; removed the scaffold `createWindow`
- `src/preload/index.ts` (modified) - Added `onStatus` subscriber + `IOverlayStatus` type to `window.jedi` (no secrets)
- `src/preload/index.d.ts` (modified) - Re-exports `IOverlayStatus` for the renderer; removed redundant empty export
- `src/renderer/src/components/debug-hud.tsx` (created) - Toggleable HUD rendering version/CP-state/position
- `src/renderer/src/assets/hud.css` (created) - Transparent body/root; HUD card styling; no inline styles
- `src/renderer/src/App.tsx` (modified) - Mounts `DebugHud`, imports `hud.css`

## Decisions Made
- **Mirrored `IOverlayStatus` across main / preload / renderer** rather than sharing one import — the sandboxed preload and the renderer are bundled as separate units and must not reach into main; structural typing keeps them in sync.
- **HUD markup uses `<dl>` + per-row `data-testid`** (`cell-electron-version`, `cell-content-protection`, `cell-position`) in addition to the required `card-debug-hud`, so 01-04 / Phase 2 tests can target individual readouts.
- **`setVisibleOnAllWorkspaces(true)` kept as a documented no-op** on Windows (research + CLAUDE.md note); called for intent, not relied upon.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Task 1 negative grep gate tripped on a TSDoc comment**
- **Found during:** Task 1 verification
- **Issue:** The `! grep -Eq "\.show\(\)|\.focus\(\)"` gate matched the literal `window.show()`/`window.focus()` text inside a TSDoc comment describing what the wrapper must NOT call — a false positive; no such calls exist in code.
- **Fix:** Reworded the comment to "the focus-stealing show/focus methods" so the gate verifies intent (no actual calls) without matching prose.
- **Files modified:** src/main/overlay-window.manager.ts
- **Committed in:** d82d6c8

**2. [Rule 3 - Blocking] oxlint `no-useless-empty-export` warning after adding a real export to index.d.ts**
- **Found during:** Task 2 verification
- **Issue:** Adding `export type { IOverlayStatus }` made the pre-existing `export {};` redundant; oxlint flagged it (warning, not error).
- **Fix:** Removed the now-redundant `export {};` from `src/preload/index.d.ts`.
- **Files modified:** src/preload/index.d.ts
- **Committed in:** 2c4caf0

---

**Total deviations:** 2 auto-fixed (both Rule 3 blocking/tooling friction). No scope changes, no architectural deviations.

## Manual / On-Machine Verification (deferred to 01-04, NOT fabricated here)
- The HUD display on `npm run dev` could not be visually eyeballed in this non-interactive execution environment. Mitigation: `electron-vite build` produced all three bundles cleanly and the renderer compiled the HUD + CSS. The authoritative on-machine eyeball (HUD shows Electron version `35.7.5`, CP=ON, a real position; transparent over all windows; meeting-app focus retained; absent — not black — in screen share) is the explicit responsibility of the 01-04 GO/NO-GO gate (D-01/D-02/D-03), per the plan's `<verification>` block.
- **Expected on-machine readout once run:** Electron `35.7.5`, Content protection `ON`, and the overlay's window position.

## Known Stubs
- None that block the plan goal. The HUD `visible` prop defaults to `true` and has no toggle wired yet — this is intentional per D-08 (no hotkeys exist in Phase 1; Phase 2 wires the toggle). Not a blocking stub.

## Threat Surface
- No new trust boundary introduced. The `jedi:status` channel carries only `{electronVersion, contentProtection, position}` — non-secret proof-of-life data (T-01-02-I mitigated, D-05). The subscriber is one-way (main → renderer); the renderer cannot push secrets back. `setContentProtection(true)` re-applied on every show + blur + display change mitigates T-01-02-I2 (final proof in 01-04's screen-share self-test).

## Self-Check: PASSED

All 3 created files exist on disk; both task commits (`d82d6c8`, `2c4caf0`) are present in git history. Typecheck, lint, format:check, and a full build all pass.

---
*Phase: 01-overlay-shell-existential-behaviors*
*Completed: 2026-06-17*
