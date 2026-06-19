---
phase: quick-260619-mcv
plan: 01
status: complete
subsystem: ui
tags: [electron, overlay, react, ipc, clipboard, hotkeys, transparent-window, windows]

# Dependency graph
requires:
  - phase: 04-stt-pipeline-live-transcript
    provides: bounded rolling TranscriptBuffer + jedi:transcript push (the Q/A panel reconciles its full-session log from this)
  - phase: 05-ai-orchestration-answer-talking-points
    provides: jedi:ai push events + activePanel focus-cycle flag (the AI panel + focus highlight build on this)
  - phase: 07-screenshot-vision-packaging-hardening
    provides: code-challenge vision mode + the takeover vision panel this task replaced with a real column
provides:
  - Full-width status HEADER + four peer panels (Q/A | AI | Code | Commands) overlay layout
  - Visible Ctrl+Alt+F focus cycle (Q/A -> AI -> Code) with highlight + corner pill + HUD readout
  - Single canonical panel-label map (panel-labels.ts) shared by pills and HUD readout
  - Two copy mechanisms: Ctrl+Alt+Y (full solution) + copy-on-mouse-release while interactive
  - Reversible interaction toggle (Ctrl+Alt+M) with hit-testable transparent window, zero chrome, no blink
  - Renderer-side full-session Q/A transcript log (survives the bounded main buffer rolling)
affects: [overlay-ui, focus-discipline, ipc-surface, transcript-display]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Single source-of-truth display-label map for focus-cycle panels (panel-labels.ts)"
    - "Sanctioned, reversible relaxation of the click-through/never-steal-focus discipline behind one explicit user toggle"
    - "Renderer-side monotonic overlap-reconciled log to retain full session over a bounded main-side rolling buffer"
    - "First narrow renderer->main WRITE channel on the jedi namespace, interaction-gated + re-validated in main"

key-files:
  created:
    - src/renderer/src/components/panel-labels.ts
    - src/renderer/src/components/transcript-panel.tsx
    - src/renderer/src/components/commands-panel.tsx
  modified:
    - src/main/overlay-window.manager.ts
    - src/main/index.ts
    - src/main/hotkey-registrar.service.ts
    - src/preload/index.ts
    - src/renderer/src/App.tsx
    - src/renderer/src/components/debug-hud.tsx
    - src/renderer/src/components/ai-panel.tsx
    - src/renderer/src/components/vision-panel.tsx
    - src/renderer/src/assets/hud.css

key-decisions:
  - "Kept ONE narrow renderer->main write channel (jedi:copy-selection) for copy-on-release; main re-validates overlayInteractive + non-empty before writing the clipboard (user-approved; first write on the previously one-way jedi surface)"
  - "Windows interaction-toggle OFF path: blur() before setFocusable(false), NO hide()/showInactive() — eliminates both the stuck title bar AND the blink"
  - "Q/A full-session history kept renderer-side (unbounded for the session); main TranscriptBuffer bounds untouched because other code depends on its bounded live window"
  - "Code-challenge vision panel converted from a takeover overlay into a real, always-present column"
  - "Internal activePanel keys (transcript|ai|vision) unchanged to avoid churn; only display strings mapped (Q/A, AI, Code)"

patterns-established:
  - "panel-labels.ts: one map drives every user-facing panel name (focus pill + HUD readout + panel titles)"
  - "Interaction-toggle: setIgnoreMouseEvents(false)+setFocusable(true)+focus()+1%-alpha hit-test background ON; blur()+full default re-assert OFF"
  - "reconcileFinalLog: longest suffix/prefix overlap dedup to grow a renderer log monotonically from a rolling snapshot"

requirements-completed: [CTL-03, OVL-02, OVL-04, AI-03, D-08, D-09]

# Metrics
duration: 8 verification rounds (multi-session)
completed: 2026-06-19
---

# Quick Task 260619-mcv: Overlay UX Overhaul Summary

**Overlay reworked into a full-width status header over four peer panels (Q/A | AI | Code | Commands) with a visible Ctrl+Alt+F focus cycle, canonical panel labels, dual copy mechanisms (Ctrl+Alt+Y + copy-on-mouse-release), a reversible chrome-free interaction toggle, and a renderer-side full-session Q/A history that survives the bounded main transcript buffer.**

## Performance

- **Duration:** 8 verification rounds (multi-session; on-machine verification gate between each)
- **Completed:** 2026-06-19
- **Tasks:** Plan Tasks 1-2 (autonomous) + a human-verify gate that expanded into 8 rounds of iterative on-machine fixes
- **Files modified:** 10 (3 created, 7 modified)

## Accomplishments

- **Layout overhaul.** Replaced three overlapping sections with a full-width status HEADER plus a row of four peer panels: **Q/A | AI | Code | Commands**. The three content panels are equal width (`flex 2` each); Commands is a narrow reference column (`flex 0.8`). The overlay window was widened **900 → 1280** so the panels aren't cramped (~400px content columns, ~115px Commands). The transcript, previously a cramped block inside the HUD, is now a full peer "Q/A" panel.
- **Visible focus cycle.** Ctrl+Alt+F now visibly cycles **Q/A → AI → Code** — focus highlight (brighter border + ring), corner pill, and HUD active-panel readout all reflect it. The original "not working" was a no-visible-effect problem, not a dead chord.
- **Canonical panel labels.** A single source-of-truth map (`panel-labels.ts`: `transcript→"Q/A"`, `ai→"AI"`, `vision→"Code"`) drives every user-facing panel name (focus pill + HUD readout + titles), fixing the previously scrambled labels. Internal `activePanel` keys are unchanged.
- **Two copy mechanisms (both, per user decision).** Ctrl+Alt+Y copies the full latest code-challenge solution; **copy-on-mouse-release** auto-copies the current selection on `mouseup` while interaction is ON, flashing **"Copied ✓"** in the header. Empty selection / plain click is a no-op.
- **Reversible interaction toggle.** Ctrl+Alt+M flips the overlay between click-through (default) and interactive (drag-select code). Making the transparent window actually receive clicks required `setFocusable(true)+focus()` **and** a 1%-alpha hit-test background while interactive (zero-alpha pixels aren't hit-tested). Zero window chrome in either state on Windows; the OFF path fully reverts (click-through, content-protection, always-on-top, no taskbar/title) with **no blink**. The HUD shows a Mouse ON/OFF indicator.
- **Commands panel.** The hotkey cheat-sheet was extracted out of the cluttered header into its own narrow column; chord text wraps (no horizontal scrollbar).
- **Q/A full-session history.** The Q/A panel keeps its OWN full-session finalized log in the renderer (monotonic, overlap-reconciled accumulation) so history survives the bounded main `TranscriptBuffer` rolling/pruning. Scrollbar + Ctrl+Alt+PgUp/PgDn scrollback + stick-to-bottom follow; Ctrl+Alt+K clears it in lockstep with the main buffer.

## Task Commits

This task ran as a 2-task autonomous plan that paused at a human-verify gate, which expanded into 8 on-machine verification rounds. Commit range: **`d45e42e..a88dd43`** (pre-dispatch plan `d45e42e`; 15 commits on top — 14 feature/fix + 1 worktree merge). Final HEAD: **`a88dd43`**.

1. **Split code challenge into a third column + visible focus highlight** — `f9053ab` (feat)
2. **Add copy-code-challenge (Ctrl+Alt+Y) + reversible interaction toggle (Ctrl+Alt+M)** — `36d5ff5` (feat)
3. **Merge quick task worktree** — `913c968` (chore)
4. **Rename Code Challenge indicator label Vision → Code** — `559b15e` (fix)
5. **Widen the Code Challenge column** — `2b1357a` (fix)
6. **Make Ctrl+Alt+M actually work + HUD mouse indicator** (setFocusable+focus) — `014cf82` (fix)
7. **Header + three-panel layout, canonical panel labels, interactive hit-test background** — `71f81f4` (fix)
8. **Kill the title bar on the interaction-toggle OFF path (Windows)** — `c9bd55b` (fix)
9. **Commands panel + copy-on-release + taskbar/title fix** — `6ed2156` (fix)
10. **Stop the header clipping its last status cell (uptime)** — `eb59cd1` (fix)
11. **Equalize the three content panels' widths (flex 2 each)** — `9fdfd36` (fix)
12. **Widen the overlay window 900 → 1280** — `5bf9e2d` (fix)
13. **Stabilize the Copy header cell + stop the Commands horizontal scrollbar** — `9de3f9a` (fix)
14. **Keep a full-session Q/A history panel-side so it scrolls back** — `c04d4fd` (fix)
15. **Eliminate the mouse-toggle OFF blink without the title bar returning** — `a88dd43` (fix)

_The SUMMARY/STATE/ROADMAP docs commit is handled separately by the orchestrator._

## Files Created/Modified

**Created**
- `src/renderer/src/components/panel-labels.ts` — Single source-of-truth display-label map for the focus-cycle panels.
- `src/renderer/src/components/transcript-panel.tsx` — The "Q/A" peer panel; keeps the renderer-side full-session log (overlap-reconciled accumulation) and the scroll/follow behavior.
- `src/renderer/src/components/commands-panel.tsx` — The narrow "Commands" reference column holding the hotkey cheat-sheet (extracted from the header).

**Modified**
- `src/main/overlay-window.manager.ts` — `setOverlayInteractive` (the sanctioned, reversible relaxation: focus + hit-test + chrome-free + blink-free revert), `overlayInteractive`/`copyOk` status fields, `markCopyOk` transient flash, latest-code-challenge text tracking, window width 1280, `title: ''`.
- `src/main/index.ts` — `copy-code-challenge` + `toggle-interaction` hotkey handlers, the `jedi:copy-selection` IPC handler (interaction-gated clipboard write), pushAi closure recording the latest code-challenge text.
- `src/main/hotkey-registrar.service.ts` — Two new chords: `copy-code-challenge` (Ctrl+Alt+Y) and `toggle-interaction` (Ctrl+Alt+M).
- `src/preload/index.ts` — `overlayInteractive`/`copyOk` on `IOverlayStatus`; the single narrow `copySelection` write method (`jedi:copy-selection`).
- `src/renderer/src/App.tsx` — Header-over-four-panels layout, `overlay-root--interactive` class, copy-on-mouseup wiring.
- `src/renderer/src/components/debug-hud.tsx` — HUD became a full-width status header (transcript + cheat-sheet removed); Mouse ON/OFF + "Copied ✓" cells; layout-stable copy cell; canonical active-panel label.
- `src/renderer/src/components/ai-panel.tsx` — Focus highlight via `data-active`; canonical "AI" label via the map.
- `src/renderer/src/components/vision-panel.tsx` — Real always-present "Code" column (no longer a takeover overlay); canonical "Code" label; empty-state placeholder.
- `src/renderer/src/assets/hud.css` — Full layout rewrite: header bar, four-panel row, focus highlight, interactive hit-test background, panel widths, commands wrap, copy-cell stability.

## Decisions Made

- **Single narrow renderer→main write channel** (`jedi:copy-selection`) for copy-on-release. The overlay `jedi` surface was previously strictly one-way (main→renderer); this is the first write. It is **interaction-gated** and main **re-validates** `overlayInteractive` is true and the text is a non-empty string before writing the clipboard (a stale/spoofed send while click-through can't copy). User-approved.
- **Windows interaction-toggle OFF path** lands on `blur()` before `setFocusable(false)`, with **no** `hide()`/`showInactive()`. Diagnosed across rounds: the title bar only appeared because the frameless window was repainted in the focused state when focusability was dropped; blurring first repaints it unfocused/frameless (no title bar) and avoids the re-realize that caused the blink.
- **Q/A full-session log kept renderer-side** (unbounded for the session — full meeting history by design). The main `TranscriptBuffer` bounds (~90s / 400 segments / 20000 chars) are deliberately **untouched** because Phase 5 AI span-selection and other code depend on its bounded live window.
- **Vision panel converted** from a takeover overlay into a real, always-present "Code" column.
- **Internal `activePanel` keys** (`transcript|ai|vision`) unchanged to avoid churn; only the display strings are mapped.

## Deviations from Plan

The plan's Task 1/2 were small (split the panel, add the two chords). The bulk of the work emerged at the human-verify gate as 8 rounds of on-machine-discovered fixes, handled under deviation rules (auto-fix bugs / add missing critical functionality) with the user approving each round's outcome.

### Auto-fixed / additive work

**1. [Rule 2 — missing functionality] Status payload extended + new write channel**
- **Found during:** copy-on-release + interaction-state surfacing
- **Issue:** No way to surface `overlayInteractive`/`copyOk` to the HUD; no renderer→main path for copy-on-release.
- **Fix:** Added `overlayInteractive`/`copyOk` to `IOverlayStatus` (all three mirrors) and a single narrow, interaction-gated `jedi:copy-selection` write channel.
- **Files modified:** `overlay-window.manager.ts`, `index.ts`, `preload/index.ts`, `debug-hud.tsx`, `App.tsx`
- **Committed in:** `014cf82`, `6ed2156`

**2. [Rule 1 — bug] Transparent-window click + Windows title/blink**
- **Found during:** interaction-toggle on-machine testing (rounds 2/3/5/8)
- **Issue:** `setIgnoreMouseEvents(false)` alone didn't make a transparent, non-focusable window clickable; making it focusable surfaced a Windows title bar/taskbar entry; the round-5 fix introduced a blink.
- **Fix:** `setFocusable(true)+focus()` + 1%-alpha hit-test background ON; `blur()`-first + in-place default re-assert OFF (no hide/show).
- **Files modified:** `overlay-window.manager.ts`, `App.tsx`, `hud.css`
- **Committed in:** `014cf82`, `71f81f4`, `c9bd55b`, `a88dd43`

**3. [Rule 1 — bug] Q/A history vanished under the bounded buffer**
- **Found during:** Q/A scrollback testing (round 8)
- **Issue:** The bounded main buffer evicts old segments, so the panel only ever showed the recent slice — nothing to scroll back to.
- **Fix:** Renderer-side monotonic, overlap-reconciled full-session log; main buffer untouched.
- **Files modified:** `transcript-panel.tsx`
- **Committed in:** `c04d4fd`

**4. [Rule 1 — bug] Header layout: clipped uptime cell + reflow on copy; Commands horizontal scrollbar**
- **Found during:** layout/visual rounds (6/7)
- **Fix:** Wrapping flex header cells, fixed-width copy cell, Commands chord wrapping + flex bump.
- **Files modified:** `debug-hud.tsx`, `hud.css`
- **Committed in:** `eb59cd1`, `9fdfd36`, `9de3f9a`

---

**Total deviations:** Iterative on-machine fixes across 8 rounds, all user-approved at each gate.
**Impact on plan:** Substantial scope growth beyond the 2-task plan, but it was the user-directed completion of the overlay UX. No unrelated scope creep.

## Issues Encountered

- **Renderer test infrastructure absent.** The plan's Task 1 verify command referenced `vision-panel.test.tsx` / `ai-panel.test.tsx`, but the repo has no renderer DOM-test setup (vitest is `environment: 'node'`, includes only `*.test.ts`; no jsdom / `@testing-library/react`). Creating those tests would require new dev dependencies (excluded from auto-fix). Verification relied on `npm run typecheck` + `npm run lint` (the applicable automated gates) plus on-machine user verification. Recommend a separate task to add renderer test infra if component tests are wanted.
- **Pre-existing repo-wide Prettier format drift** in ~20 files this task never touched. No husky pre-commit hook is actually present despite `CLAUDE.md` describing one, so commits weren't blocked; CI `format:check` will flag the drift independently. Recommend a separate cleanup task. This task formatted only the files it touched.

## Verification

- **All functional + visual behavior was verified on-machine by the user** across the 8 rounds (layout, focus cycle, labels, both copy mechanisms, interaction toggle with zero chrome and no blink, Q/A history + scrollback).
- **Gates at finalize:** `npm run typecheck` (node + web) clean; `npm run lint` (oxlint) clean; `npx vitest run src/main` = **143 passed** (18 files). Main `TranscriptBuffer` untouched, so no test regression.

### Carried verification item (NOT done — must be carried into STATE)

**On-machine hotkey-conflict re-check for the two NEW chords is still pending:**
- **Ctrl+Alt+Y** (copy code-challenge) and **Ctrl+Alt+M** (toggle-mouse) must be re-checked against **Microsoft Teams**, **Zoom**, and **VS Code** each holding focus, per the 02-03 / 05-03 conflict-test protocol (confirm the overlay action fires AND the host app's own Ctrl+Alt accelerators still fire).
- **Documented fallback if a collision is found:** remap the colliding chord to a reserved letter and update its TSDoc in `hotkey-registrar.service.ts` (and the cheat-sheet in `commands-panel.tsx`).

## User Setup Required

None — no external service configuration required.

## Self-Check: PASSED

Verified at finalize:
- Created files exist: `panel-labels.ts`, `transcript-panel.tsx`, `commands-panel.tsx` — all present.
- Final commit `a88dd43` is HEAD; commit range `d45e42e..a88dd43` = 15 commits (14 feature/fix + 1 worktree merge).
- Gates: typecheck PASS, lint PASS, `vitest run src/main` = 143 passed.

## Next Steps / Readiness

- Overlay UX is functionally complete and on-machine verified for v1.
- **Carry into STATE:** the pending Ctrl+Alt+Y / Ctrl+Alt+M on-machine conflict re-check (above).
- Recommended follow-up tasks: (1) repo-wide Prettier cleanup of the pre-existing drift; (2) optional renderer DOM-test infrastructure (jsdom + RTL) if component tests are desired.

---
*Quick task: 260619-mcv*
*Completed: 2026-06-19*
