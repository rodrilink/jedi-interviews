---
phase: quick-260619-mcv
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/main/hotkey-registrar.service.ts
  - src/main/index.ts
  - src/main/overlay-window.manager.ts
  - src/renderer/src/App.tsx
  - src/renderer/src/components/ai-panel.tsx
  - src/renderer/src/components/vision-panel.tsx
  - src/renderer/src/components/debug-hud.tsx
  - src/renderer/src/assets/hud.css
autonomous: false
requirements: [CTL-03, OVL-02, OVL-04, AI-03, D-08, D-09]
must_haves:
  truths:
    - "Ctrl+Alt+F visibly cycles a focus highlight across all three panels: Transcript (HUD) -> AI -> Code Challenge -> Transcript."
    - "Transcript, AI, and Code Challenge are three distinct, simultaneously-visible columns; the Code Challenge panel no longer overlaps or replaces the AI panel."
    - "Vision (code-challenge) streaming still renders into the Code Challenge panel; AI answers/talking-points still render into the AI panel; transcript unchanged."
    - "Ctrl+Alt+Y copies the full text of the most-recent code-challenge solution to the system clipboard in one shot, overlay stays click-through."
    - "A focus-toggle hotkey turns the overlay click-through OFF so the user can drag-select code-challenge text with the mouse, and turns it back ON (re-asserting content protection + always-on-top) when toggled again."
    - "Overlay still never takes keyboard focus by default and is click-through by default; the only sanctioned setIgnoreMouseEvents(false) is the explicit, reversible focus toggle."
  artifacts:
    - path: "src/main/hotkey-registrar.service.ts"
      provides: "Two new Ctrl+Alt chords: copy-code-challenge (Y) and toggle-interaction (chosen conflict-free key)"
      contains: "copy-code-challenge"
    - path: "src/main/overlay-window.manager.ts"
      provides: "Three-state activePanel cycle helper, setOverlayInteractive toggle, latest code-challenge text tracking"
    - path: "src/renderer/src/App.tsx"
      provides: "Three-column layout: DebugHud | AiPanel | VisionPanel (no takeover wrapper)"
      contains: "VisionPanel"
  key_links:
    - from: "src/main/hotkey-registrar.service.ts"
      to: "src/main/index.ts buildHandlers"
      via: "new chord labels mapped to handlers"
      pattern: "copy-code-challenge|toggle-interaction"
    - from: "src/main/index.ts pushAi closure"
      to: "overlay-window.manager latest-code-challenge text"
      via: "main records done/delta text for the copy hotkey"
      pattern: "code-challenge|latestCodeChallenge"
    - from: "src/main/index.ts toggle handler"
      to: "overlay window setIgnoreMouseEvents"
      via: "setOverlayInteractive"
      pattern: "setIgnoreMouseEvents"
---

<objective>
Fix three observed overlay UI defects on the packaged build:

1. **Ctrl+Alt+F focus cycle has no visible effect.** The chord IS registered and IS handled (it cycles
   the main-owned `activePanel` flag transcript->ai->vision), but it only flips a scroll-routing flag +
   a tiny corner pill on the AI panel. With the vision panel hidden until it has content, and no visible
   focus affordance on the HUD/transcript, the user sees nothing happen. Make the cycle produce a clear,
   visible focus highlight across all three panels.
2. **Code Challenge is a takeover overlay, not a distinct panel.** `.vision-panel` is
   `position:absolute; inset:0` inside a `.overlay-column` wrapper that it shares with the AI panel, so it
   covers/replaces the AI panel. Restructure into three real columns (Transcript | AI | Code Challenge).
3. **No way to copy the code-challenge solution.** Add BOTH (LOCKED — user chose "Both"): (a) a copy-all
   hotkey using the Electron clipboard in main, and (b) an explicit, reversible focus-toggle hotkey that
   flips `setIgnoreMouseEvents` off so the user can drag-select, then back on (re-asserting the overlay's
   load-bearing behaviors).

Purpose: Make the overlay's three-panel model real and usable, and give the user a way to extract code.
Output: Updated main hotkey/window plumbing + renderer three-column layout, all tests green.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@CLAUDE.md
@.planning/phases/07-screenshot-vision-packaging-hardening/07-01-SUMMARY.md

# The exact files being changed (already read during planning — patterns below):
@src/main/hotkey-registrar.service.ts
@src/main/index.ts
@src/main/overlay-window.manager.ts
@src/renderer/src/App.tsx
@src/renderer/src/components/ai-panel.tsx
@src/renderer/src/components/vision-panel.tsx
@src/renderer/src/assets/hud.css

<interfaces>
<!-- Key contracts the executor needs. Extracted during planning. -->

Hotkey chord shape (src/main/hotkey-registrar.service.ts):
  interface IHotkeyChord { label: string; keycode: number; accelerator: string; kind: 'repeat' | 'discrete'; }
  HOTKEY_CHORDS is `readonly IHotkeyChord[]`. A new chord = add an entry; `buildHandlers` in index.ts must
  add a handler under the SAME label or it surfaces in register().failed (CTL-03). UiohookKey.Y exists.
  Dispatch requires event.ctrlKey && event.altKey + a keycode match (Ctrl+Alt is mandatory on every chord).

Active-panel plumbing (src/main/overlay-window.manager.ts):
  let activePanel: 'transcript' | 'ai' | 'vision' = 'ai';
  export function setActivePanel(panel): void
  export function getActivePanel(): 'transcript' | 'ai' | 'vision'
  buildStatus() puts `activePanel` on IOverlayStatus, pushed over jedi:status. Renderer panels read
  status.activePanel (mirrored into a ref) to route the single jedi:scroll-transcript channel + show a
  corner indicator. The focus-cycle handler in index.ts already does:
    const next = current === 'transcript' ? 'ai' : current === 'ai' ? 'vision' : 'transcript';

  Overlay window behaviors (createOverlayWindow / showOverlay):
    window.setIgnoreMouseEvents(true, { forward: true });  // click-through, re-asserted in showOverlay
    window.setContentProtection(true) + setAlwaysOnTop(true,'screen-saver') re-asserted on blur + show
    contentProtectionEnabled (module-level) tracks state for the HUD.

AI push events (src/main/ai/ai-orchestrator -> pushAi closure in index.ts):
  IAiPushEvent = thinking{id,mode,at} | delta{id,text} | done{id,text} | error{id,text}
              | cancelled{id} | empty{id,mode,at,text} | cleared
  For code-challenge, mode==='code-challenge' on thinking/empty; delta/done carry full accumulated `text`
  keyed by id. The vision panel keeps only code-challenge entries; the AI panel skips them.

CSS layout (src/renderer/src/assets/hud.css):
  #root is `display:flex; flex-direction:row` with `gap:8px; padding:8px` on a fixed 900x700 window.
  Currently 2 columns: .debug-hud (flex 1 1 0) and .overlay-column (flex 1 1 0, position:relative) which
  contains .ai-panel (flex 1 1 0) and .vision-panel (position:absolute; inset:0; z-index:2 — the takeover).
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Split Code Challenge into a distinct third column + visible 3-way focus highlight</name>
  <files>src/renderer/src/App.tsx, src/renderer/src/components/vision-panel.tsx, src/renderer/src/components/ai-panel.tsx, src/renderer/src/components/debug-hud.tsx, src/renderer/src/assets/hud.css</files>
  <action>
    Restructure the overlay into THREE distinct, always-present columns (fixes Issue 2 + the visible half
    of Issue 1). All changes are renderer-only; do not touch the focus discipline or click-through.

    App.tsx: remove the `.overlay-column` wrapper. Render three siblings directly under #root:
    `<DebugHud />`, `<AiPanel />`, `<VisionPanel />`. Update the component TSDoc to describe a three-column
    layout (Transcript | AI | Code Challenge) instead of the takeover model.

    vision-panel.tsx: make VisionPanel ALWAYS render (return a `<section>`, never `null`). Remove the
    `shouldShow`/`isStreaming` early-return takeover logic (the D-10 "takes over the AI region" behavior is
    being replaced by a real third column). When `entries.length === 0`, render a quiet placeholder line
    (e.g. "No code challenge yet — press Ctrl+Alt+C to capture one.") inside the entries area so the empty
    column reads intentionally. Keep ALL existing behavior: reduceEntries (code-challenge-only), the onAi /
    onStatus / onScrollTranscript subscriptions, the stickToBottom follow, the activePanelRef scroll guard
    (vision), the escaped `<pre>` render, MAX_VISION_ENTRIES. Keep data-testid="card-vision-panel".

    Visible focus highlight (fixes the visible half of Issue 1): each of the three panels must show it is
    the focused panel when `activePanel` matches. Add a `data-active` (or reuse `data-active-panel`)
    attribute on the root element of each panel keyed off the pushed activePanel:
      - debug-hud.tsx: the transcript/HUD is the 'transcript' focus target. The DebugHud already
        subscribes to onStatus — read status.activePanel and set data-active={activePanel === 'transcript'}
        on the .debug-hud root (add the onStatus read of activePanel if not already tracked). Add a
        data-testid="icon-active-panel-transcript" indicator span mirroring the AI/vision indicator pattern.
      - ai-panel.tsx: set data-active={activePanel === 'ai'} on the .ai-panel root (it already tracks
        activePanel). Keep the existing corner indicator/testid.
      - vision-panel.tsx: keep data-active={activePanel === 'vision'} on the .vision-panel root.

    hud.css: change the layout from 2 columns to 3. Delete the `.overlay-column` rule (and its position:relative
    anchor). Change `.vision-panel` from `position:absolute; inset:0; z-index:2` to a normal in-flow column:
    `flex: 1 1 0; min-width:0; min-height:0` matching `.debug-hud` and `.ai-panel` (keep the rest of its
    chrome). Each of the three columns now gets ~1/3 of the 900px width via flex on #root. Add a clear focused
    highlight rule for each panel root when focused — e.g. a brighter border + subtle outer ring:
      .debug-hud[data-active='true'], .ai-panel[data-active='true'], .vision-panel[data-active='true']
      { border-color: rgb(196 181 253 / 70%); box-shadow: 0 0 0 1px rgb(196 181 253 / 45%); }
    Style the new debug-hud active indicator span to match the existing .ai-panel__active-indicator pill.

    Per IDEXX standards: 4-space indent, single quotes, explicit return types on exported functions, no inline
    style props (CSS only), data-testid on the new indicator. Update co-located component tests
    (vision-panel.test.tsx / ai-panel.test.tsx / debug-hud.test.tsx) if they assert the old takeover
    null-render or 2-column structure; add/adjust assertions so VisionPanel renders unconditionally and each
    panel exposes data-active when focused. Use renderWithProviders only if those tests already use it.
  </action>
  <verify>
    <automated>npx vitest run src/renderer/src/components/vision-panel.test.tsx src/renderer/src/components/ai-panel.test.tsx 2>&1 | tail -20; npm run typecheck</automated>
  </verify>
  <done>App.tsx renders DebugHud + AiPanel + VisionPanel as three siblings; VisionPanel returns a section unconditionally (placeholder when empty); .overlay-column removed and .vision-panel is in-flow flex 1 1 0; each panel exposes a focused highlight via data-active; typecheck + the two component test files pass.</done>
</task>

<task type="auto">
  <name>Task 2: Add copy-code-challenge (Ctrl+Alt+Y) clipboard hotkey + reversible interaction toggle in main</name>
  <files>src/main/hotkey-registrar.service.ts, src/main/overlay-window.manager.ts, src/main/index.ts</files>
  <action>
    Add the two new chords and their main-side handlers (fixes Issue 3). All clipboard + window mutation
    stays in main; the renderer is untouched (no IPC surface widening). Both chords are 'discrete'.

    hotkey-registrar.service.ts: append TWO entries to HOTKEY_CHORDS following the existing comment+entry
    pattern (note each is OUTSIDE the locked conflict-tested set and needs the on-machine Teams/Zoom/VS Code
    re-check — documented in Task 3 verification):
      - { label: 'copy-code-challenge', keycode: UiohookKey.Y, accelerator: 'Ctrl+Alt+Y', kind: 'discrete' }
        ('Y' = "yank"; chosen because Y is unused by the existing set {J,arrows,[,],H,Q,K,PgUp,PgDn,A,T,G,F,S,C}).
      - { label: 'toggle-interaction', keycode: <pick a conflict-free letter>, accelerator: 'Ctrl+Alt+<key>', kind: 'discrete' }
        Pick a letter NOT in the existing set and not obviously colliding (suggest 'M' for "mouse"; if M is
        taken by a host app on the re-check, fall back to a reserved letter and update the TSDoc). Document the
        choice in a comment like the other chords.

    overlay-window.manager.ts: add the main-owned state + helpers (mirroring the existing activePanel/hudVisible
    module-level pattern with TSDoc):
      - Track the latest code-challenge solution text: `let latestCodeChallengeText = '';` plus
        `export function setLatestCodeChallengeText(text: string): void` and
        `export function getLatestCodeChallengeText(): string`. (Index wires pushAi to record it — see below.)
      - Add `let overlayInteractive = false;` plus `export function setOverlayInteractive(window, interactive): void`.
        When interactive===true: `window.setIgnoreMouseEvents(false)` so the user can click/drag-select in the
        code panel — this is the ONE sanctioned place click-through is disabled; the never-steal-focus relaxation
        is intentional and explicit here. When interactive===false: re-assert the overlay's load-bearing defaults
        exactly like showOverlay does — `window.setIgnoreMouseEvents(true, { forward: true })`,
        `window.setContentProtection(true)` (set contentProtectionEnabled=true), `window.setAlwaysOnTop(true,'screen-saver')`
        — then pushStatus(window). Guard window.isDestroyed(). Add `export function getOverlayInteractive(): boolean`
        so the toggle handler can read-toggle-push. (Do NOT change the default: overlay is created and shown
        click-through; this toggle only flips it temporarily and restores it.)

    index.ts:
      - In the pushAi closure passed to the AiOrchestrator (currently `(event) => pushAi(window, event)`), ALSO
        record the latest code-challenge text: when event.type is 'delta' or 'done' AND the entry is a
        code-challenge entry, call setLatestCodeChallengeText(event.text). The push events don't carry `mode`
        on delta/done, so track the code-challenge entry id from the preceding 'thinking'/'empty' event whose
        mode==='code-challenge' (keep a local `codeChallengeId` in the closure; update it on thinking/empty
        with mode 'code-challenge', and only record text for deltas/dones matching that id). On 'cleared',
        reset latestCodeChallengeText to ''. Keep the existing pushAi(window, event) call unchanged.
      - In buildHandlers, add two handlers under the new labels (import clipboard from 'electron' at top; the
        renderer must NOT import electron — this is main, which is correct):
          'copy-code-challenge': () => { const text = getLatestCodeChallengeText(); if (text.length > 0) clipboard.writeText(text); }
          'toggle-interaction': () => { setOverlayInteractive(window, !getOverlayInteractive()); }
        buildHandlers' signature/closure already has `window`; thread getLatestCodeChallengeText/setOverlayInteractive
        via the overlay-window.manager imports (add them to the existing import block from './overlay-window.manager').

    Per IDEXX standards: explicit return types on the new exported functions, single quotes, 4-space indent,
    error-free typecheck. No new IPC channel; no preload change.
  </action>
  <verify>
    <automated>npm run typecheck && npm run lint && npx vitest run src/main 2>&1 | tail -15</automated>
  </verify>
  <done>HOTKEY_CHORDS has copy-code-challenge (Ctrl+Alt+Y) and toggle-interaction entries; buildHandlers maps both labels (so neither appears in register().failed, CTL-03); overlay-window.manager exports setLatestCodeChallengeText/getLatestCodeChallengeText/setOverlayInteractive/getOverlayInteractive; setOverlayInteractive(false) re-asserts click-through + content protection + always-on-top; the pushAi closure records the latest code-challenge text and resets on 'cleared'; clipboard is imported only in main; typecheck + lint + existing main tests pass.</done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <what-built>
    Three observed defects fixed: (1) Ctrl+Alt+F now visibly cycles a focus highlight across all three panels;
    (2) Code Challenge is its own third column alongside Transcript and AI (no more overlap); (3) Ctrl+Alt+Y
    copies the full latest code-challenge solution to the clipboard, and the interaction-toggle chord
    (Ctrl+Alt+<chosen key>) temporarily disables click-through so you can drag-select code, then restores it.
  </what-built>
  <how-to-verify>
    Build/run the overlay (dev `npm run dev` or the packaged .exe, whichever matches how you hit the bug).

    A. Three-panel layout:
       1. Confirm THREE distinct columns are visible at once: Transcript/HUD (left), AI (middle), Code
          Challenge (right). The Code Challenge column must NOT cover or replace the AI panel.
       2. Press Ctrl+Alt+A (or Ctrl+Alt+T) to stream an AI answer — it lands in the AI column.
       3. Press Ctrl+Alt+C to capture a code challenge — the solution streams into the Code Challenge column,
          while the AI column keeps its content.

    B. Ctrl+Alt+F focus cycle:
       4. Press Ctrl+Alt+F repeatedly. The focus highlight (brighter border/ring + indicator pill) must move
          Transcript -> AI -> Code Challenge -> Transcript on each press. Confirm it is now visibly working.
       5. NOTE: if Ctrl+Alt+F collides with the meeting app on YOUR machine (find/search), report it — the
          documented fallback is to remap 'F' to a reserved letter. Re-check Ctrl+Alt+F against Teams, Zoom,
          and VS Code per the 02-03 protocol and report any collision.

    C. Copy solution (both mechanisms):
       6. With a code-challenge solution present, press Ctrl+Alt+Y. Paste into a text editor — the FULL
          solution text must appear. Overlay stays click-through (clicks still pass to the app underneath).
       7. Press the interaction-toggle chord (Ctrl+Alt+<the key chosen in Task 2>). Click into the Code
          Challenge panel and drag-select some code with the mouse (this is the sanctioned, temporary
          click-through-off state). Copy with Ctrl+C.
       8. Press the toggle chord again. Confirm click-through is RESTORED (clicks pass through to the app
          underneath again) and the overlay still floats on top / stays excluded from screen capture.

    D. Hotkey conflict re-check (verification item — do NOT assume conflict-free): on THIS machine, with
       Teams, Zoom, and VS Code each holding focus in turn, confirm Ctrl+Alt+Y and Ctrl+Alt+<toggle key>
       fire the overlay action AND do not break the host app. Report any collision so the chord can be remapped.
  </how-to-verify>
  <resume-signal>Type "approved" if all four sections pass, or describe what failed (and any hotkey collisions found) so the chords/layout can be adjusted.</resume-signal>
</task>

</tasks>

<verification>
- `npm run typecheck` (node + web) clean.
- `npm run lint` (oxlint) clean.
- `npx vitest run` for the touched renderer component tests and the main tests passes.
- Manual checkpoint (Task 3): three-column layout, visible Ctrl+Alt+F cycle, Ctrl+Alt+Y clipboard copy,
  reversible interaction toggle, and on-machine conflict re-check for the two new chords + Ctrl+Alt+F.
</verification>

<success_criteria>
- Ctrl+Alt+F cycles a VISIBLE focus highlight across Transcript -> AI -> Code Challenge -> Transcript.
- Transcript, AI, and Code Challenge are three distinct, simultaneously-visible columns.
- Vision streams to the Code Challenge column; AI to the AI column; transcript unchanged.
- Ctrl+Alt+Y copies the full latest code-challenge solution to the clipboard with overlay click-through intact.
- The interaction-toggle chord disables click-through for mouse drag-select and restores it (re-asserting
  content protection + always-on-top) when toggled off.
- Overlay remains click-through and never-steal-focus by default; the toggle is the only sanctioned exception.
- New chords' on-machine conflict status is reported (NOT assumed conflict-free).
</success_criteria>

<output>
Create `.planning/quick/260619-mcv-fix-ctrl-alt-f-focus-cycle-split-code-ch/260619-mcv-SUMMARY.md` when done.
</output>
