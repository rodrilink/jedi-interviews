import { BrowserWindow, screen } from 'electron';
import { join } from 'path';
import { fileURLToPath } from 'url';

import type { SttConnectionState } from './stt/stt-provider.interface';

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
        width: 420,
        height: 220,
        show: false,
        transparent: true,
        frame: false,
        focusable: false,
        skipTaskbar: true,
        resizable: false,
        hasShadow: false,
        backgroundColor: '#00000000',
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
