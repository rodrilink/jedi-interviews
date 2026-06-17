import { app, BrowserWindow, ipcMain, session, desktopCapturer, type IpcMainEvent } from 'electron';
import { createOverlayWindow, showOverlay, pushStatus, setHotkeyStatus, getOverlayVisible, setAudioLevel } from './overlay-window.manager';
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
 * Installs the picker-free system-audio loopback grant and the single renderer -> main
 * audio-level report listener.
 *
 * `setDisplayMediaRequestHandler` answers the overlay renderer's `getDisplayMedia` call directly
 * with a screen video source plus `audio: 'loopback'` (Windows-only, Electron 31+), so loopback
 * audio is granted with NO on-screen picker and NO user gesture — preserving the focus/click-through
 * contract (D-03 / OVL-02). The grant is scoped to the locally-loaded overlay `webContents` only:
 * any request from a different `webContents` is denied (`callback({})`), so no remote/unknown content
 * can ever be granted capture (T-03-01). The renderer discards the video track and keeps only audio.
 *
 * `ipcMain.on('jedi:audio-level')` is the app's only write-direction IPC surface: it records the
 * untrusted, non-secret RMS scalar via {@link setAudioLevel} (which coerces non-finite input) and
 * re-broadcasts it on the read-only `jedi:status` channel so the HUD `Audio:` row updates (T-03-02).
 *
 * @param window - The overlay window whose webContents is the sole authorized capture target.
 */
function installAudioPipeline(window: BrowserWindow): void {
    session.defaultSession.setDisplayMediaRequestHandler(
        (request, callback) => {
            // Grant loopback ONLY to the locally-loaded overlay renderer; deny everything else.
            if (request.frame?.url !== window.webContents.getURL()) {
                callback({});
                return;
            }

            void desktopCapturer.getSources({ types: ['screen'] }).then((sources) => {
                // A video source MUST accompany audio:'loopback' on Windows; the renderer stops and
                // discards the video track immediately, keeping only the system-audio stream.
                callback({ video: sources[0], audio: 'loopback' });
            });
        },
        // useSystemPicker:false — never show an OS picker (D-03); the handler resolves the source.
        { useSystemPicker: false }
    );

    ipcMain.on('jedi:audio-level', (_event: IpcMainEvent, level: number) => {
        setAudioLevel(level);
        pushStatus(window);
    });
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

    // Install the picker-free loopback grant + the renderer->main audio-level listener so the
    // renderer's auto-started capture (D-03) can resolve getDisplayMedia and surface the live RMS
    // level in the HUD Audio: row over the read-only jedi:status push (D-04/D-05).
    installAudioPipeline(window);

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
