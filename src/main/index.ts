import { app, BrowserWindow } from 'electron';
import { createOverlayWindow, showOverlay, pushStatus, setHotkeyStatus, getOverlayVisible } from './overlay-window.manager';
import { HotkeyRegistrarService, type HotkeyHandlerMap } from './hotkey-registrar.service';
import { WindowControlActionsService } from './window-control.actions';

/**
 * The single hotkey registrar for the app's lifetime. Instantiated once after the overlay
 * boots and torn down on quit. There is no TSyringe container in the main process, so this
 * module-level handle is the conventional singleton (see HotkeyRegistrarService @remarks).
 */
let hotkeyRegistrar: HotkeyRegistrarService | undefined;

/**
 * Builds the action-label -> handler map for the registrar from the real window-control
 * actions (02-02). Each label maps to a method on {@link WindowControlActionsService} that
 * mutates the overlay window. The single show/hide chord branches on the main-owned
 * {@link getOverlayVisible} state (owned in overlay-window.manager, not duplicated here): hide
 * when currently visible, show via {@link showOverlay} when hidden (D-14/D-15). The four move
 * directions, opacity up/down, the HUD-content toggle (D-14), and quit (D-04) map directly.
 *
 * @param actions - The window-control action service bound to the overlay window.
 * @returns A handler map covering every locked action label.
 */
function buildHandlers(actions: WindowControlActionsService): HotkeyHandlerMap {
    return {
        'show/hide': (): void => {
            if (getOverlayVisible()) {
                actions.hideOverlay();
            } else {
                actions.showOverlay();
            }
        },
        'move-left': (): void => actions.moveLeft(),
        'move-right': (): void => actions.moveRight(),
        'move-up': (): void => actions.moveUp(),
        'move-down': (): void => actions.moveDown(),
        'opacity-down': (): void => actions.opacityDown(),
        'opacity-up': (): void => actions.opacityUp(),
        'hud-toggle': (): void => actions.toggleHud(),
        quit: (): void => actions.quit(),
    };
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
    // the app launches even if some chords fail (D-08). The real window-control handlers
    // (02-02) mutate this overlay window when their chords fire.
    const windowControlActions = new WindowControlActionsService(window);
    hotkeyRegistrar = new HotkeyRegistrarService(buildHandlers(windowControlActions));
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
