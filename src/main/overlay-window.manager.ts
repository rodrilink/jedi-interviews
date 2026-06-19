import { BrowserWindow, screen } from 'electron';
import { join } from 'path';
import { fileURLToPath } from 'url';

import type { SttConnectionState } from './stt/stt-provider.interface';
import type { IAiPushEvent } from './ai/ai-orchestrator';

export type { IAiPushEvent };

const currentDirectory: string = fileURLToPath(new URL('.', import.meta.url));

/**
 * The non-secret status payload pushed to the renderer HUD over the read-only
 * `jedi:status` channel. Carries proof-of-life data only (D-05/D-07): never secrets.
 */
export interface IOverlayStatus {
    electronVersion: string;
    contentProtection: boolean;
    position: { x: number; y: number };
    /**
     * The startup hotkey-registration outcome (D-06): `active` is the layer that handled
     * registration ('uiohook' | 'globalShortcut' | 'none') and `failed` lists the action
     * labels whose chord failed to bind. Owned by main, surfaced read-only in the HUD.
     */
    hotkeys: { active: string; failed: string[] };
    /**
     * Whether the HUD *content* is shown inside the overlay window (D-14/D-15). This is a
     * main-owned flag, distinct from whether the overlay *window* itself is visible: the
     * HUD-toggle chord flips this without touching window visibility. The renderer derives
     * its HUD content visibility purely from this pushed flag (D-15: renderer is a pure view).
     */
    hudVisible: boolean;
    /**
     * Which panel is the keyboard-scroll target (D-08). Main-owned, distinct from {@link hudVisible}:
     * the focus-cycle chord (Ctrl+Alt+F) flips it between the transcript (HUD) and the AI panel, and the
     * single Ctrl+Alt+PgUp/PgDn scroll channel is routed in the renderer purely by this pushed flag. The
     * launch default is `'ai'` (D-08). Phase 7 (D-09) adds `'vision'` as a THIRD focus-cycle target
     * (transcript → ai → vision). The renderer renders a corner indicator off this flag and never
     * controls it (IN-01: renderer is a pure view).
     */
    activePanel: 'transcript' | 'ai' | 'vision';
    /**
     * Whether the overlay is currently INTERACTIVE — click-through disabled so the user can drag-select
     * code (quick fix 260619-mcv, D-09). Main-owned; the toggle chord (Ctrl+Alt+M) flips it. The renderer
     * surfaces it read-only in the HUD as a "Mouse: ON/OFF" indicator so the user can see whether the
     * single sanctioned interactive state is engaged. `false` by default (overlay is click-through, OVL-02).
     */
    overlayInteractive: boolean;
    /**
     * Transient flag: `true` for ~1.5s right after a copy-on-mouse-release auto-copy succeeded (quick fix
     * 260619-mcv item 2), so the HUD header can flash a "Copied ✓" indicator. Main-owned; set true on a
     * successful selection copy, then cleared and re-pushed. `false` the rest of the time.
     */
    copyOk: boolean;
}

/** IPC channel name for the read-only, non-secret status push to the renderer (D-05). */
export const STATUS_CHANNEL = 'jedi:status';

/**
 * IPC channel name for the read-only, one-way transcript push to the renderer (D-04). Kept separate
 * from {@link STATUS_CHANNEL} because transcript traffic is high-frequency (interim results fire many
 * times per second) and would otherwise bloat the status payload three sites declare identically.
 */
export const TRANSCRIPT_CHANNEL = 'jedi:transcript';

/**
 * IPC channel for the read-only, one-way AI push to the renderer (Phase 5, AI-04). Kept separate from
 * {@link STATUS_CHANNEL} for the SAME reason {@link TRANSCRIPT_CHANNEL} is: AI traffic is high-frequency
 * (debounced streamed deltas fire many times per response) and would otherwise bloat the status payload.
 * Carries {@link IAiPushEvent} payloads only — AI text + state, never the Anthropic key or any secret.
 */
export const AI_CHANNEL = 'jedi:ai';

/**
 * IPC channel for the read-only, one-way scroll-transcript signal (Phase 4). The overlay never takes
 * focus, so the transcript can only be scrolled by global hotkey: main forwards a coarse 'up'/'down'
 * direction here and the renderer scrolls its transcript element. Carries a direction string only.
 */
export const SCROLL_TRANSCRIPT_CHANNEL = 'jedi:scroll-transcript';

/** The scroll direction forwarded to the renderer over {@link SCROLL_TRANSCRIPT_CHANNEL}. */
export type ScrollTranscriptDirection = 'up' | 'down';

/**
 * The read-only transcript payload pushed to the HUD over {@link TRANSCRIPT_CHANNEL} (D-04). Carries
 * the renderable transcript snapshot plus the coarse STT connection state — text and state only,
 * never the Deepgram key or any secret (D-08). The renderer is a pure view of this payload.
 */
export interface IOverlayTranscript {
    /** The space-joined finalized transcript text in the current time window. */
    finalText: string;
    /** The current interim (partial) transcript, rendered visually distinct from final (D-04). */
    interimText: string;
    /** The coarse STT connection state, surfaced read-only on the overlay (TRN-03). */
    connectionState: SttConnectionState;
    /** The live capture RMS level in `[0, 1]`, computed in main, rendered as the overlay audio meter. */
    audioLevel: number;
}

/**
 * The current content-protection state, tracked at module level so the HUD can reflect
 * ON/OFF truthfully. Set inside {@link showOverlay} where protection is (re-)applied.
 */
let contentProtectionEnabled = false;

/**
 * The latest hotkey-registration outcome, tracked at module level (mirroring
 * {@link contentProtectionEnabled}) because it is owned by main but NOT derivable from the
 * window. Set via {@link setHotkeyStatus} by the registrar before {@link pushStatus} so the
 * HUD reflects it truthfully (D-06/D-15). Defaults to a not-yet-registered state.
 */
let lastHotkeyResult: { active: string; failed: string[] } = { active: 'none', failed: [] };

/**
 * Records the aggregated hotkey-registration outcome so the next {@link pushStatus} carries it
 * to the HUD. Called once at startup by the registrar (D-07: startup-only detection).
 *
 * @param result - The active layer and the list of action labels that failed to bind.
 */
export function setHotkeyStatus(result: { active: string; failed: string[] }): void {
    lastHotkeyResult = result;
}

/**
 * Whether the HUD *content* is currently shown (D-12: starts shown on launch). Tracked at
 * module level (mirroring {@link contentProtectionEnabled}) because it is main-owned and the
 * HUD-toggle chord flips it independently of the overlay window's own visibility (D-14).
 */
let hudVisible = true;

/**
 * Sets the main-owned HUD-content visibility flag (D-14/D-15). The next {@link pushStatus}
 * carries it to the renderer, which derives its HUD content visibility purely from this flag.
 *
 * @param visible - Whether the HUD content should be shown.
 */
export function setHudVisible(visible: boolean): void {
    hudVisible = visible;
}

/**
 * Reads the main-owned HUD-content visibility flag.
 *
 * @returns Whether the HUD content is currently shown.
 */
export function getHudVisible(): boolean {
    return hudVisible;
}

/**
 * Which panel is the active keyboard-scroll target (D-08). Tracked at module level (mirroring
 * {@link hudVisible}) because it is main-owned and the focus-cycle chord flips it independently of
 * window/HUD visibility. The launch default is `'ai'` (D-08): a freshly triggered AI answer is the
 * most likely thing the user wants to scroll first. The renderer routes the single scroll channel and
 * renders the corner indicator purely from this pushed flag.
 */
let activePanel: 'transcript' | 'ai' | 'vision' = 'ai';

/**
 * Sets the main-owned active-panel flag (D-08; Phase 7 D-09 adds `'vision'`). The next
 * {@link pushStatus} carries it to the renderer, which routes Ctrl+Alt+PgUp/PgDn scroll to the matching
 * panel and flips the indicator.
 *
 * @param panel - The panel to make the active scroll target.
 */
export function setActivePanel(panel: 'transcript' | 'ai' | 'vision'): void {
    activePanel = panel;
}

/**
 * Reads the main-owned active-panel flag so the focus-cycle chord can cycle it (transcript → ai →
 * vision → transcript, Phase 7 D-09).
 *
 * @returns The currently active scroll-target panel.
 */
export function getActivePanel(): 'transcript' | 'ai' | 'vision' {
    return activePanel;
}

/**
 * The latest code-challenge solution text, tracked at module level (mirroring {@link activePanel})
 * because it is main-owned and not derivable from the window. The pushAi closure in index.ts records the
 * accumulated text of the in-flight code-challenge entry on each delta/done and clears it on a
 * `cleared` event, so the copy-code-challenge chord (Ctrl+Alt+Y) can write it to the system clipboard in
 * main without widening the renderer IPC surface. Empty until the first code challenge streams in.
 */
let latestCodeChallengeText = '';

/**
 * Records the latest code-challenge solution text so the copy-code-challenge chord can yank it to the
 * clipboard (quick fix 260619-mcv, D-08). Called by the index.ts pushAi closure on each code-challenge
 * delta/done (carrying the full accumulated text) and with `''` on a `cleared` event.
 *
 * @param text - The full accumulated code-challenge solution text (or `''` to reset).
 */
export function setLatestCodeChallengeText(text: string): void {
    latestCodeChallengeText = text;
}

/**
 * Reads the latest recorded code-challenge solution text for the copy-code-challenge chord.
 *
 * @returns The full latest code-challenge solution text, or `''` if none has streamed in yet.
 */
export function getLatestCodeChallengeText(): string {
    return latestCodeChallengeText;
}

/**
 * Whether the overlay is currently INTERACTIVE — i.e. click-through is temporarily disabled so the user
 * can drag-select code in the Code Challenge panel (quick fix 260619-mcv, D-09). Tracked at module level
 * (mirroring {@link activePanel}) because it is main-owned and the toggle chord (Ctrl+Alt+M) flips it
 * independently of window/HUD visibility. Defaults to `false`: the overlay is created and shown
 * click-through (OVL-02) and only this explicit, reversible toggle relaxes that.
 */
let overlayInteractive = false;

/**
 * Toggles the overlay between click-through (default) and interactive (quick fix 260619-mcv, D-09).
 *
 * This is the ONE sanctioned place the overlay's never-take-focus / click-through discipline (OVL-02) is
 * relaxed, and it is explicit and user-invoked (the Ctrl+Alt+M chord). Three things must ALL be true for
 * the user to actually click + drag-select code, and earlier rounds proved each is necessary but not
 * sufficient on its own. When `interactive` is `true`:
 *   1. `setIgnoreMouseEvents(false)` — plain (NOT `{ forward: true }`) so clicks land on the overlay
 *      instead of passing through.
 *   2. `setFocusable(true)` + `focus()` — the window is created `focusable: false`, and a non-focusable
 *      window does not receive mouse-driven focus or text selection (Electron 35.x). This is the SINGLE
 *      sanctioned `focus()`, fully reverted on toggle OFF.
 *   3. Renderer hit-test partner (the real root cause of "clicks still don't land"): the window is
 *      `transparent: true` with `backgroundColor: '#00000000'`, and fully-transparent (zero-alpha) pixels
 *      are NOT hit-tested by the OS/Chromium — so even a focusable window receives no mouse events over
 *      its transparent regions. The pushed `overlayInteractive` flag (below) drives the renderer to add a
 *      `.overlay-root--interactive` class that paints a near-invisible but NON-zero-alpha background,
 *      making the surface hit-testable. That class reverts to fully transparent on toggle OFF, so the
 *      overlay returns to true click-through.
 * When `interactive` is `false` it re-asserts the overlay's load-bearing defaults EXACTLY as
 * {@link showOverlay} does — `setFocusable(false)` (restoring the never-take-focus default), click-through
 * (`setIgnoreMouseEvents(true, { forward: true })`), content protection, and the `'screen-saver'`
 * always-on-top level (OVL-04 / Pitfall 2) — then pushes status so the renderer drops the interactive
 * background and the HUD reflects the restored state. Guards `isDestroyed()` because hotkeys fire async.
 *
 * TASKBAR/TITLE FIX (quick fix 260619-mcv item 3): on Windows, `setFocusable(true)` on a `frame:false`
 * `skipTaskbar:true` window re-introduces a taskbar entry / window title, and `setFocusable(false)` does
 * NOT reliably re-hide it (it sticks). So BOTH branches explicitly re-assert `setSkipTaskbar(true)` and
 * `setTitle('')` (the window is also created with `title: ''`), so the window becomes click/selection-
 * capable with ZERO visible chrome in either state and the taskbar entry/title is gone on revert.
 *
 * @param window - The overlay window to toggle.
 * @param interactive - `true` to disable click-through for drag-select; `false` to restore the defaults.
 */
export function setOverlayInteractive(window: BrowserWindow, interactive: boolean): void {
    if (window.isDestroyed()) {
        return;
    }

    overlayInteractive = interactive;

    if (interactive) {
        // The sole sanctioned relaxation of OVL-02: let clicks/drag-select land on the overlay AND make
        // the window focusable + focused so a transparent, always-on-top window actually receives the
        // mouse interaction (setIgnoreMouseEvents(false) alone is insufficient on a non-focusable window).
        // setSkipTaskbar(true) + setTitle('') BEFORE focus() so making it focusable never surfaces a
        // taskbar entry or window title on Windows (item 3).
        window.setIgnoreMouseEvents(false);
        window.setFocusable(true);
        window.setSkipTaskbar(true);
        window.setTitle('');
        window.focus();
    } else {
        // Restore the load-bearing defaults exactly like showOverlay (the OS can drop these; re-assert).
        // setFocusable(false) reverts the single sanctioned focus exception so the never-take-focus
        // invariant (OVL-02) holds again outside the interactive window. setSkipTaskbar(true) + setTitle('')
        // kill the taskbar entry/title that setFocusable(true) introduced (Windows leaves it stuck — item 3).
        window.setFocusable(false);
        window.setSkipTaskbar(true);
        window.setTitle('');
        window.setIgnoreMouseEvents(true, { forward: true });
        window.setContentProtection(true);
        contentProtectionEnabled = true;
        window.setAlwaysOnTop(true, 'screen-saver');
    }

    pushStatus(window);
}

/**
 * Reads the main-owned overlay-interactive flag so the toggle-interaction chord can read-toggle-push it.
 *
 * @returns `true` when click-through is currently disabled (interactive); `false` when click-through.
 */
export function getOverlayInteractive(): boolean {
    return overlayInteractive;
}

/**
 * Transient "Copied ✓" flag (quick fix 260619-mcv item 2). True for {@link COPY_OK_FLASH_MS} right after a
 * copy-on-mouse-release auto-copy succeeds, so the HUD header can flash a confirmation. The timer is tracked
 * so a rapid second copy resets the window rather than clearing early.
 */
let copyOk = false;
let copyOkTimer: ReturnType<typeof setTimeout> | undefined;

/** How long the "Copied ✓" header indicator stays lit after an auto-copy (quick fix 260619-mcv item 2). */
const COPY_OK_FLASH_MS = 1500;

/**
 * Flashes the main-owned "Copied ✓" flag on the HUD header for {@link COPY_OK_FLASH_MS} (quick fix
 * 260619-mcv item 2). Sets {@link copyOk} true and pushes status immediately, then clears it and re-pushes
 * after the flash window. Called by the copy-selection IPC handler in index.ts ONLY after a successful
 * clipboard write, so the indicator never lies. A second copy mid-flash resets the timer.
 *
 * @param window - The overlay window whose HUD shows the transient indicator.
 */
export function markCopyOk(window: BrowserWindow): void {
    copyOk = true;
    pushStatus(window);

    if (copyOkTimer !== undefined) {
        clearTimeout(copyOkTimer);
    }

    copyOkTimer = setTimeout(() => {
        copyOk = false;
        copyOkTimer = undefined;
        if (!window.isDestroyed()) {
            pushStatus(window);
        }
    }, COPY_OK_FLASH_MS);
}

/**
 * Whether the overlay *window* itself is currently visible (D-12: starts shown on launch).
 * Owned here in one place (mirroring {@link contentProtectionEnabled}) rather than fragmented
 * into index.ts, so the single show/hide chord can branch on it: {@link showOverlay} sets it
 * true and {@link hideOverlay} sets it false. Distinct from {@link hudVisible}, which toggles
 * the HUD *content* within the window (D-14).
 */
let isOverlayVisible = true;

/**
 * Sets the main-owned overlay-window visibility flag. Called by {@link showOverlay} (true) and
 * {@link hideOverlay} (false) so window shown-state lives in exactly one place (D-15).
 *
 * @param visible - Whether the overlay window is shown.
 */
export function setOverlayVisible(visible: boolean): void {
    isOverlayVisible = visible;
}

/**
 * Reads the main-owned overlay-window visibility flag so the single show/hide chord can branch
 * between {@link showOverlay} and {@link hideOverlay} without a duplicate state variable.
 *
 * @returns Whether the overlay window is currently shown.
 */
export function getOverlayVisible(): boolean {
    return isOverlayVisible;
}

/**
 * Builds the status payload from the live window state.
 *
 * @param window - The overlay window to read position from.
 * @returns The non-secret proof-of-life status payload for the HUD.
 */
function buildStatus(window: BrowserWindow): IOverlayStatus {
    const [x, y] = window.getPosition();

    return {
        electronVersion: process.versions.electron,
        contentProtection: contentProtectionEnabled,
        position: { x, y },
        hotkeys: lastHotkeyResult,
        hudVisible,
        activePanel,
        overlayInteractive,
        copyOk,
    };
}

/**
 * Pushes the current status payload to the renderer over the read-only `jedi:status`
 * channel. Sends nothing if the renderer is gone (e.g. mid-teardown).
 *
 * @param window - The overlay window whose webContents receives the payload.
 */
export function pushStatus(window: BrowserWindow): void {
    if (window.isDestroyed() || window.webContents.isDestroyed()) {
        return;
    }

    window.webContents.send(STATUS_CHANNEL, buildStatus(window));
}

/**
 * Pushes a transcript snapshot to the renderer over the read-only, one-way `jedi:transcript`
 * channel (D-04). Mirrors {@link pushStatus} exactly, including the teardown guard, since transcript
 * pushes also fire async (on every interim/final/connection-state event) possibly mid-teardown. The
 * payload is text + connection state only — never the Deepgram key or any secret (D-08).
 *
 * @param window - The overlay window whose webContents receives the payload.
 * @param payload - The renderable transcript snapshot plus the coarse connection state.
 */
export function pushTranscript(window: BrowserWindow, payload: IOverlayTranscript): void {
    if (window.isDestroyed() || window.webContents.isDestroyed()) {
        return;
    }

    window.webContents.send(TRANSCRIPT_CHANNEL, payload);
}

/**
 * Pushes an AI event to the renderer over the read-only, one-way `jedi:ai` channel (Phase 5, AI-04).
 * Mirrors {@link pushTranscript} exactly, including the teardown guard, since AI pushes also fire async
 * (on every debounced delta / terminal event) possibly mid-teardown. The payload is AI text + state
 * only — never the Anthropic key or any secret. The orchestrator injects this as a `pushAi(event)`
 * closure over the overlay window, exactly as `wireSttPipeline` closes over `pushTranscript`.
 *
 * @param window - The overlay window whose webContents receives the payload.
 * @param payload - The AI push event (thinking / delta / done / error / cancelled / empty).
 */
export function pushAi(window: BrowserWindow, payload: IAiPushEvent): void {
    if (window.isDestroyed() || window.webContents.isDestroyed()) {
        return;
    }

    window.webContents.send(AI_CHANNEL, payload);
}

/**
 * Forwards a transcript scroll direction to the renderer over the read-only {@link
 * SCROLL_TRANSCRIPT_CHANNEL}. Fired by the Ctrl+Alt+PageUp/PageDown hotkeys (the overlay is unfocused,
 * so this is the only way to scroll). Sends nothing if the renderer is gone (mirrors the other pushes).
 *
 * @param window - The overlay window whose webContents receives the signal.
 * @param direction - Which way to scroll the transcript.
 */
export function pushScrollTranscript(window: BrowserWindow, direction: ScrollTranscriptDirection): void {
    if (window.isDestroyed() || window.webContents.isDestroyed()) {
        return;
    }

    window.webContents.send(SCROLL_TRANSCRIPT_CHANNEL, direction);
}

/**
 * Creates the transparent, frameless, always-on-top overlay window.
 *
 * The window is built `focusable: false` so it can never take *keyboard* focus from the
 * active meeting app (OVL-02). Keyboard focus is only half the story: a transparent,
 * always-on-top window still *captures mouse events* across its entire surface, so clicks
 * landing on it never reach the windows beneath. `setIgnoreMouseEvents(true, { forward: true })`
 * makes the overlay click-through so those clicks pass to the window underneath — without it
 * the overlay silently blocks clicks across its whole area even though `focusable: false`
 * already stops it taking keyboard focus. Click-through is permanent because the app is
 * keyboard-only and the user never needs to interact with the overlay via the mouse (OVL-02).
 * It is created hidden (`show: false`) and must only ever be revealed through
 * {@link showOverlay}, which uses `showInactive()` — never `show()` or `focus()`.
 * `backgroundColor: '#00000000'` plus `transparent: true` avoid the first-paint white flash
 * (Pitfall 6). The renderer keeps the same contextIsolation + sandbox boundary established in
 * 01-01 (D-06); no secret channels are exposed.
 *
 * @returns The created overlay BrowserWindow instance.
 */
export function createOverlayWindow(): BrowserWindow {
    const window = new BrowserWindow({
        // Two-column overlay: the HUD (status + transcript + cheat-sheet) sits left, the always-on
        // AiPanel sits right. 900px splits into two readable ~440px columns; 460px was too narrow to
        // hold both side by side. The move-clamp logic reads the live window width, so widening here
        // needs no other position changes.
        width: 900,
        height: 700,
        show: false,
        transparent: true,
        frame: false,
        focusable: false,
        skipTaskbar: true,
        resizable: false,
        hasShadow: false,
        backgroundColor: '#00000000',
        // Empty title so no Windows window title/chrome string exists to surface even transiently when
        // the window is made focusable for the interaction toggle (quick fix 260619-mcv item 3). The HTML
        // <title> can later re-set document.title; we also re-assert setTitle('') in setOverlayInteractive.
        title: '',
        webPreferences: {
            preload: join(currentDirectory, '../preload/index.cjs'),
            contextIsolation: true,
            sandbox: true,
            backgroundThrottling: false,
        },
    });

    // Make the overlay click-through so mouse events pass to the window beneath it.
    // `focusable: false` only governs keyboard focus; without this the overlay captures
    // clicks across its whole surface. `forward: true` still lets the renderer observe
    // move events for hover effects. Permanent: the app is keyboard-only (OVL-02).
    window.setIgnoreMouseEvents(true, { forward: true });

    // Re-assert the existential behaviors defensively whenever focus is lost: the
    // always-on-top level and content protection can be dropped by the OS on focus
    // changes, so we re-apply both (OVL-04, Pitfall 2). We never call focus() here.
    window.on('blur', () => {
        if (window.isDestroyed()) {
            return;
        }

        window.setAlwaysOnTop(true, 'screen-saver');
        window.setContentProtection(true);
        contentProtectionEnabled = true;
        pushStatus(window);
    });

    // The window's display affinity (content protection) can revert when the display
    // topology changes; re-run the full show wrapper to re-assert everything (Pitfall 2).
    const onDisplayChange = (): void => {
        if (window.isDestroyed()) {
            return;
        }

        showOverlay(window);
    };

    screen.on('display-metrics-changed', onDisplayChange);
    screen.on('display-added', onDisplayChange);
    screen.on('display-removed', onDisplayChange);

    // Reflect position changes in the HUD without ever stealing focus.
    window.on('move', () => {
        pushStatus(window);
    });

    // Stop listening to the global screen emitter once the window is gone.
    window.on('closed', () => {
        screen.removeListener('display-metrics-changed', onDisplayChange);
        screen.removeListener('display-added', onDisplayChange);
        screen.removeListener('display-removed', onDisplayChange);
    });

    // electron-vite injects ELECTRON_RENDERER_URL in dev for HMR; load the built file otherwise.
    if (process.env.ELECTRON_RENDERER_URL) {
        void window.loadURL(process.env.ELECTRON_RENDERER_URL);
    } else {
        void window.loadFile(join(currentDirectory, '../renderer/index.html'));
    }

    return window;
}

/**
 * The only sanctioned way to reveal the overlay.
 *
 * Re-applies, in order: the highest practical always-on-top level (`'screen-saver'`,
 * above the Windows taskbar), content protection (re-applied on EVERY show — OVL-04 /
 * Pitfall 2, since the OS can drop the capture-exclusion affinity across hide/show
 * cycles), click-through (re-applied on EVERY show for the same defensive reason — the OS
 * can reset window attributes across hide/show cycles), then `showInactive()` so the
 * overlay appears without taking focus (OVL-02 / Pitfall 3). It MUST never call the
 * focus-stealing show/focus methods.
 *
 * `setVisibleOnAllWorkspaces(true)` is called as a harmless no-op on Windows (it has no
 * effect there per the Electron docs) so the intent is documented without being relied on.
 *
 * @param window - The overlay window to reveal.
 */
export function showOverlay(window: BrowserWindow): void {
    window.setAlwaysOnTop(true, 'screen-saver');
    window.setContentProtection(true);
    contentProtectionEnabled = true;
    window.setIgnoreMouseEvents(true, { forward: true });
    window.setVisibleOnAllWorkspaces(true);
    window.showInactive();
    setOverlayVisible(true);
    pushStatus(window);
}

/**
 * Hides the overlay window (D-14 show/hide chord, hide branch). This is the ONLY sanctioned
 * hide path; every RE-show must route back through {@link showOverlay} so content protection,
 * always-on-top, and click-through are re-applied (the OS can drop these across hide/show
 * cycles — OVL-04 / Pitfall 2). Guards `isDestroyed()` because hotkeys fire async, possibly
 * mid-teardown.
 *
 * @param window - The overlay window to hide.
 */
export function hideOverlay(window: BrowserWindow): void {
    if (window.isDestroyed()) {
        return;
    }

    window.hide();
    setOverlayVisible(false);
    pushStatus(window);
}
