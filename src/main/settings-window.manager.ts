import { BrowserWindow } from 'electron';
import { join } from 'path';
import { fileURLToPath } from 'url';

const currentDirectory: string = fileURLToPath(new URL('.', import.meta.url));

/**
 * The single settings window for the app's lifetime, lazily created on first open and recreated after
 * close (D-01). Module-level by-convention singleton — the main process has no TSyringe container — and
 * `undefined` whenever no settings window exists. See {@link openOrFocusSettingsWindow}.
 */
let settingsWindow: BrowserWindow | undefined;

/**
 * Creates the settings BrowserWindow. This is `createOverlayWindow()` with its existential options
 * INVERTED: where the overlay is transparent, frameless, non-focusable, and click-through (so it never
 * steals focus from the meeting app), the settings window is a NORMAL opaque, framed, focusable window
 * — it hosts text inputs, so being focusable is the entire point (SET-01, D-02).
 *
 * It deliberately does NOT call `setIgnoreMouseEvents`, does NOT re-assert always-on-top or content
 * protection on blur/display-change, and does NOT call `setContentProtection` — applying content
 * protection would hide this window from the user's OWN screenshots, an anti-pattern for a window the
 * user is meant to see and interact with (RESEARCH Pattern 3). The contextIsolation + sandbox boundary
 * is KEPT (T-06-04); it loads the dedicated `settings.cjs` preload (the two-way `settingsApi`, D-04).
 *
 * It is created hidden (`show: false`) and revealed by {@link openOrFocusSettingsWindow} via normal
 * `show()` + `focus()` (NOT the overlay's `showInactive()`) — this window SHOULD take focus.
 *
 * @returns The created settings BrowserWindow instance.
 */
function createSettingsWindow(): BrowserWindow {
    const window = new BrowserWindow({
        width: 900,
        height: 700,
        show: false,
        transparent: false,
        frame: true,
        focusable: true,
        skipTaskbar: false,
        resizable: true,
        backgroundColor: '#1e1e1e',
        webPreferences: {
            preload: join(currentDirectory, '../preload/settings.cjs'),
            contextIsolation: true,
            sandbox: true,
        },
    });

    // electron-vite injects ELECTRON_RENDERER_URL in dev for HMR. Unlike the overlay (which loads the
    // bare URL = index.html), the settings entry MUST append its filename so the dev server serves the
    // settings renderer rather than the overlay (RESEARCH Pattern 2 / Pitfall 1 — the verified suffix
    // is recorded in the SUMMARY). The prod loadFile path is unambiguous.
    if (process.env.ELECTRON_RENDERER_URL) {
        void window.loadURL(`${process.env.ELECTRON_RENDERER_URL}/settings.html`);
    } else {
        void window.loadFile(join(currentDirectory, '../renderer/settings.html'));
    }

    return window;
}

/**
 * Opens the settings window, or focuses it if it is already open (D-01 lazy lifecycle). The first press
 * of Ctrl+Alt+S creates the window; pressing again while it is open focuses the existing window (no
 * second window); closing it (X) and pressing again recreates it. The `closed` listener clears the
 * module handle so the next press creates a fresh window (mirroring the overlay manager's closed-cleanup
 * discipline). Reveal uses normal `show()` + `focus()` — the settings window SHOULD take focus.
 */
export function openOrFocusSettingsWindow(): void {
    if (settingsWindow !== undefined && !settingsWindow.isDestroyed()) {
        settingsWindow.show();
        settingsWindow.focus();
        return;
    }

    const window = createSettingsWindow();
    settingsWindow = window;

    window.on('ready-to-show', () => {
        window.show();
        window.focus();
    });

    window.on('closed', () => {
        settingsWindow = undefined;
    });
}
