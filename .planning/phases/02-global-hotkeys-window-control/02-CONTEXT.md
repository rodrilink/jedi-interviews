# Phase 2: Global Hotkeys + Window Control - Context

**Gathered:** 2026-06-17
**Status:** Ready for planning

<domain>
## Phase Boundary

The complete keyboard-only control loop for the overlay — global **show/hide**, **move**, and **opacity** adjustment — operating while a real meeting app (Teams/Zoom/VS Code) holds focus, plus a **HUD-visibility toggle** and a **quit** hotkey, with hotkey **registration failures detected and surfaced** (never silently dropped). Covers requirements OVL-03, OVL-05, CTL-01, CTL-02, CTL-03.

**Locked upstream (do not re-litigate):**
- Hotkey mechanism: **`uiohook-napi`** (passive low-level hook, does not steal the meeting app's accelerators) is the primary; **`globalShortcut` is the documented fallback** if the native rebuild proves difficult on the target machine. Check the `register()`/hook result from the first hotkey written (ROADMAP §Phase 2 Notes; CLAUDE.md §"What NOT to Use").
- `uiohook-napi` is a **native module** → must be rebuilt against Electron's ABI via `@electron/rebuild` after install and after any Electron upgrade (CLAUDE.md §"Version Compatibility").
- Show/hide MUST route through the existing **`showOverlay()`** wrapper in `src/main/overlay-window.manager.ts` — it re-applies `setAlwaysOnTop('screen-saver')`, `setContentProtection(true)`, and `setIgnoreMouseEvents` on every show (OVL-04 / Phase 1 D-07). Never call `show()`/`focus()`; reveal is `showInactive()`-only (OVL-02).
- The `DebugHud` component already accepts a `visible` prop (Phase 1 D-08) explicitly waiting for the Phase 2 hotkey toggle.
- Default chord family is **Ctrl+Alt** (ROADMAP plan 02-03).
- The 3-plan breakdown (02-01 HotkeyService, 02-02 window-control actions, 02-03 conflict testing → default chord set) is the agreed work breakdown.

</domain>

<decisions>
## Implementation Decisions

### Hotkey Map & Feel
- **D-01:** Move and opacity use **hold-to-repeat** — press and hold an arrow (move) or opacity key to keep nudging/fading smoothly, driven by uiohook's native key-repeat events. (Show/hide, HUD toggle, and quit remain discrete single presses.)
- **D-02:** Movement step is **~50px per step** (medium) — a few presses crosses a screen region without feeling sluggish.
- **D-03:** Opacity adjusts in **10% steps** (ten levels across the floor→ceiling range set in D-09).
- **D-04:** Phase 2 binds a **quit/exit hotkey** in addition to show/hide, move (4 arrows), and opacity up/down. Rationale: the overlay is `focusable:false`, screen-protected, has no taskbar icon (`skipTaskbar:true`) and no close button — without a quit chord the only exit is Task Manager.
- **D-05:** The **action set is locked** (5 groups: show/hide, move, opacity, HUD toggle, quit) but the **exact default chords are deferred to conflict testing (plan 02-03)** — pick concrete Ctrl+Alt chords only after testing against Teams/Zoom/VS Code so a colliding chord is never shipped. Suggested starting point (planner may adjust): `Ctrl+Alt+J` show/hide, `Ctrl+Alt+Arrows` move, `Ctrl+Alt+[`/`]` opacity, `Ctrl+Alt+H` HUD toggle, `Ctrl+Alt+Q` quit.

### Failure Surfacing UX (CTL-03)
- **D-06:** Hotkey registration failures/conflicts are surfaced as a **persistent status line in the existing DebugHud** (e.g. `Hotkeys: OK` / `Hotkeys: 2 failed`), pushed over the existing read-only `jedi:status` channel. Reuses the Phase 1 IPC pattern; always visible; no new window; no focus-stealing dialog.
- **D-07:** Failure detection happens **at startup only** — register each chord once at launch, check each `register()`/hook result, and surface the outcome then. No mid-session live re-checking (uiohook is a passive observer; "stolen chord" detection is over-engineering for v1, which has a fixed chord set and no remap UI).
- **D-08:** On a registration failure, the app **launches anyway with the working hotkeys** and surfaces which failed (per D-06). A personal tool should stay usable if one chord conflicts. When uiohook itself fails to attach, the **globalShortcut fallback** (locked upstream) is attempted before reporting, and the HUD line reflects whichever layer ended up active plus any still-failing chords.

### Move / Opacity Bounds
- **D-09:** Opacity range is **~20% floor → 100% ceiling.** Can get faint but never fully invisible (so it can't be "lost" by fading to zero) and can reach fully opaque for max readability. This is the overlay's own window opacity, separate from content protection.
- **D-10:** Moving the overlay **allows crossing onto adjacent monitors** — clamp only at the **outermost edges of the whole virtual desktop** (never push it fully off all screens). Use `screen` geometry (e.g. nearest-display / work-area math) to enforce.
- **D-11:** Position and opacity **do NOT persist across restarts** — the overlay starts at a fixed default position/opacity every launch. No electron-store writes for window state in Phase 2.
- **D-12:** On launch the overlay **starts shown** (as Phase 1 does today on `ready-to-show`), HUD up, so the user can confirm it's alive and read hotkey state, then toggle off with show/hide once oriented.

### HUD Toggle & First-Run
- **D-13:** The HUD becomes **status rows + a compact hotkey cheat-sheet** — keep the existing Electron/content-protection/position rows, add the `Hotkeys: OK/failed` line (D-06), and add a short list of the bound hotkeys (show/hide, move, opacity, HUD toggle, quit) so it doubles as an on-screen reference while the user learns the chords.
- **D-14:** The HUD-visibility toggle is its **own dedicated hotkey, separate from overlay show/hide** — show/hide controls the overlay *window*; a distinct chord toggles the HUD *content* within it (so the user can keep the overlay up but hide the debug readout). Fulfills D-08's "toggle wired in Phase 2."
- **D-15:** **Visibility/show state is owned by the main process.** Hotkeys fire in main; main shows/hides the window via `showOverlay()` and pushes a `visible` flag (for the HUD toggle) to the renderer over the existing read-only `jedi:status` channel. The renderer stays a pure view — consistent with the Phase 1 read-only-status IPC boundary; no renderer→main control channel is added.

### Claude's Discretion
- The exact default chords (within the Ctrl+Alt family and the locked action set) — chosen during conflict testing (D-05).
- Precise hold-to-repeat cadence/throttle, exact pixel step if 50px feels off in practice, and the visual layout/wording of the HUD cheat-sheet and the `Hotkeys:` status line.
- The internal shape of the HotkeyService (action→handler registry, how `register()` results are aggregated into the status payload) and how the uiohook→globalShortcut fallback is structured behind a single seam.
- Exact opacity step boundaries within the 20%→100% range and the default launch opacity.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope & requirements
- `.planning/ROADMAP.md` §"Phase 2: Global Hotkeys + Window Control" — goal, 5 success criteria, the 3 plans (02-01 HotkeyService, 02-02 window-control actions, 02-03 conflict testing → Ctrl+Alt default set), and the **Notes** (uiohook-napi primary / globalShortcut fallback; check the first `register()` return; native rebuild may need evaluation on this machine; standard patterns, no deep research needed).
- `.planning/REQUIREMENTS.md` §Overlay, §Control — OVL-03 (opacity by keyboard), OVL-05 (show/hide by global hotkey), CTL-01 (move by keyboard only), CTL-02 (hotkeys work while another app holds focus), CTL-03 (registration failures surfaced, never silently dropped).
- `.planning/PROJECT.md` — the focus-discipline constraint (overlay MUST NOT take keyboard/mouse focus; all control via global hotkeys) and the keyboard-only / hotkey-driven product framing.

### Prior-phase decisions this phase builds on
- `.planning/phases/01-overlay-shell-existential-behaviors/01-CONTEXT.md` — Phase 1 decisions, esp. D-07/D-08 (toggleable DebugHud surviving into Phase 2; single read-only `jedi:status` channel as the entire IPC surface) and the `showOverlay()` content-protection-reapplying wrapper.
- `.planning/STATE.md` §Accumulated Context — Phase 1 GO/NO-GO signed GO at Electron 35.7.5 on the target Windows 11 machine; the click-through fix (quick task 260616-w65: overlay needs `setIgnoreMouseEvents` or it swallows clicks — already in `overlay-window.manager.ts`).

### Stack & implementation guidance
- `CLAUDE.md` (project root) §"Recommended Stack" / §"What NOT to Use" / §"Version Compatibility" — `uiohook-napi@1.5.5` preferred over `globalShortcut` (passive hook never steals accelerators; `globalShortcut` registers OS-wide, silently fails on conflicts, can be blocked); rebuild `uiohook-napi` against Electron's ABI with `@electron/rebuild` after install/upgrade; `globalShortcut` acceptable only as the fallback layer.
- `CLAUDE.md` §"Overlay window configuration (the load-bearing details)" — `setAlwaysOnTop(true,'screen-saver')`, `setContentProtection(true)` re-applied after every show, transparent+frameless behavior, `backgroundThrottling:false`; re-assert on blur/display-change.

### Code to extend (see code_context below for specifics)
- `src/main/overlay-window.manager.ts` — `showOverlay()`, `IOverlayStatus`, `STATUS_CHANNEL`, `pushStatus()`.
- `src/main/index.ts` — app bootstrap where the HotkeyService is registered after `app.whenReady()`.
- `src/preload/index.ts` — the typed `window.jedi` bridge (`IOverlayStatus`, `onStatus`).
- `src/renderer/src/components/debug-hud.tsx` — the `visible`-prop-driven HUD to extend with the cheat-sheet + hotkey-status line.

No external ADRs/specs beyond the `.planning/` docs and the project `CLAUDE.md`.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`showOverlay(window)`** (`src/main/overlay-window.manager.ts:167`) — the only sanctioned reveal path; re-applies always-on-top + content protection + click-through, then `showInactive()`. Show/hide and move (display-change re-assert) hook into this. **Hide** has no wrapper yet — Phase 2 adds the hide path (likely `window.hide()`), but every *re-show* must go through `showOverlay()`.
- **`IOverlayStatus` + `STATUS_CHANNEL` ('jedi:status') + `pushStatus(window)`** (`overlay-window.manager.ts:11`, `:18`, `:48`) — the read-only main→renderer status push. Extend the `IOverlayStatus` payload with the hotkey-registration status and the HUD `visible` flag; keep it strictly non-secret and one-way (mirror the same interface in `src/preload/index.ts` and `debug-hud.tsx`, which each declare it locally because preload/renderer are bundled separately).
- **`DebugHud({ visible })`** (`src/renderer/src/components/debug-hud.tsx:27`) — already prop-driven for visibility (D-08) and already subscribes via `window.jedi.onStatus`. Phase 2 drives `visible` from the pushed flag and adds the cheat-sheet + `Hotkeys:` rows. CSS lives in `src/renderer/src/assets/hud.css`.
- **`window.jedi` bridge** (`src/preload/index.ts:27`) — typed, read-only, contextIsolated. Phase 2 stays within this read-only pattern (main owns control state, D-15); do not add a renderer→main control channel.

### Established Patterns
- **Main owns window/existential behavior; renderer is a pure read-only view** fed by `jedi:status`. Phase 2 preserves this: hotkeys fire and mutate window state in main, the HUD only reflects pushed state (D-15).
- **Defensive re-assertion on blur / display-metrics-changed** is already wired in `createOverlayWindow()` — move/show logic must not fight it; moving across monitors (D-10) should compose with the existing `display-*` handlers.
- **`focusable:false` + `showInactive()` + permanent `setIgnoreMouseEvents(true,{forward:true})`** is the non-negotiable focus/click-through contract (OVL-02). Hotkey-driven control is what *replaces* the unavailable mouse interaction — uiohook observes keys app-wide without consuming them, so it never breaks this contract.
- **Strict TS / IDEXX standards** — explicit return types, single quotes, 4-space, TSDoc on exports; `.service.ts` suffix for the HotkeyService class (verb-named, e.g. `HotkeyRegistrarService` / window-control action service), `.test.ts` co-located with Vitest.

### Integration Points
- **`src/main/index.ts`** `app.whenReady()` — register the HotkeyService here after the overlay boots; tear the hook down on `window-all-closed`/quit.
- **HotkeyService → window-control actions → `overlay-window.manager.ts`** — the service maps each chord to a handler that calls into the window manager (show via `showOverlay`, hide, move with clamping, opacity via `setOpacity`, HUD-toggle flag, quit via `app.quit()`).
- **Registration-result aggregation → `IOverlayStatus` → HUD** — the service collects each `register()`/hook outcome at startup and feeds the `Hotkeys: OK/failed` status into the existing `pushStatus` flow.
- **New dependency:** `uiohook-napi@1.5.5` + `@electron/rebuild` (dev) — first native module in the repo; install + rebuild against Electron 35.7.5's ABI is itself a planned step (ROADMAP "evaluate rebuild" flag).

</code_context>

<specifics>
## Specific Ideas

- The HUD is explicitly intended to **double as the hotkey cheat-sheet** during first-run/learning (D-13) — the same component that was the Phase 1 verification readout now also teaches the user the chords.
- **"Never lose the overlay"** was the recurring steer behind several bounds choices: opacity floor at ~20% (can't fade to invisible, D-09), clamp at the outermost desktop edge (can't push off all screens, D-10), and a dedicated quit hotkey (can always exit without Task Manager, D-04).
- Exact chords intentionally **left to empirical conflict testing** against the real meeting apps rather than guessed up front (D-05) — consistent with the project's "verify on the real machine" discipline from Phase 1.

</specifics>

<deferred>
## Deferred Ideas

- **Mid-session "stolen chord" re-detection** — considered for CTL-03 but rejected for v1 (D-07); uiohook is a passive observer and the chord set is fixed. Revisit if a remap UI is ever added.
- **Persisting window position/opacity across restarts** — considered (electron-store is already a dependency) but deferred (D-11) to keep Phase 2 minimal; natural to revisit alongside the settings/persistence work in Phase 6.
- **User-customizable hotkey remapping UI** — already tracked as v2 (CTL-V2-01 in REQUIREMENTS.md); out of scope for this phase's fixed default chord set.

</deferred>

---

*Phase: 2-Global Hotkeys + Window Control*
*Context gathered: 2026-06-17*
