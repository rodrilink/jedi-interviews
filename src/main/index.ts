import { app, BrowserWindow } from 'electron';
import { createOverlayWindow, showOverlay, pushStatus, setHotkeyStatus } from './overlay-window.manager';
import { HotkeyRegistrarService, HOTKEY_ACTION_LABELS, type HotkeyHandlerMap } from './hotkey-registrar.service';

/**
 * The single hotkey registrar for the app's lifetime. Instantiated once after the overlay
 * boots and torn down on quit. There is no TSyringe container in the main process, so this
 * module-level handle is the conventional singleton (see HotkeyRegistrarService @remarks).
 */
let hotkeyRegistrar: HotkeyRegistrarService | undefined;

/**
 * Builds the action-label -> handler map for the registrar. In 02-01 every handler is a no-op
 * stub so the registration + failure-surfacing + hold-to-repeat seam can be proven end to end;
 * 02-02 replaces these with the real window-control handlers (move, opacity, show/hide, quit).
 *
 * @returns A handler map covering every locked action label.
 */
function buildStubHandlers(): HotkeyHandlerMap {
    const handlers: HotkeyHandlerMap = {};
    for (const label of HOTKEY_ACTION_LABELS) {
        handlers[label] = (): void => {};
    }

    return handlers;
}

/**
 * Boots the overlay window once Electron is ready.
 *
 * The overlay is created hidden and revealed only via {@link showOverlay} (never
 * `show()`/`focus()`), so it never steals focus from the active meeting app (OVL-02).
 * Revealing it on `ready-to-show` mitigates the transparent-window white flash (Pitfall 6).
 * The first status push primes the HUD with the live version, content-protection state,
 * and position.
 */
function bootOverlay(): BrowserWindow {
    const window = createOverlayWindow();

    window.on('ready-to-show', () => {
        showOverlay(window);
        pushStatus(window);
    });

    return window;
}

app.whenReady().then(() => {
    const window = bootOverlay();

    // Register the global hotkey layer after the overlay boots. The aggregated outcome is
    // fed to the HUD over the read-only jedi:status channel (D-06) — startup-only (D-07), and
    // the app launches even if some chords fail (D-08). Real handlers arrive in 02-02.
    hotkeyRegistrar = new HotkeyRegistrarService(buildStubHandlers());
    const result = hotkeyRegistrar.register();
    setHotkeyStatus(result);
    pushStatus(window);

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            bootOverlay();
        }
    });
});

app.on('window-all-closed', () => {
    // Release the native hook (or the globalShortcut accelerators) before quitting.
    hotkeyRegistrar?.teardown();

    if (process.platform !== 'darwin') {
        app.quit();
    }
});
