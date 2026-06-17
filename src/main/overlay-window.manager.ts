import { BrowserWindow, screen } from 'electron';
import { join } from 'path';
import { fileURLToPath } from 'url';

const currentDirectory: string = fileURLToPath(new URL('.', import.meta.url));

/**
 * The non-secret status payload pushed to the renderer HUD over the read-only
 * `jedi:status` channel. Carries proof-of-life data only (D-05/D-07): never secrets.
 */
export interface IOverlayStatus {
    electronVersion: string;
    contentProtection: boolean;
    position: { x: number; y: number };
}

/** IPC channel name for the read-only, non-secret status push to the renderer (D-05). */
export const STATUS_CHANNEL = 'jedi:status';

/**
 * The current content-protection state, tracked at module level so the HUD can reflect
 * ON/OFF truthfully. Set inside {@link showOverlay} where protection is (re-)applied.
 */
let contentProtectionEnabled = false;

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
    pushStatus(window);
}
