import { app, BrowserWindow } from 'electron';
import { createOverlayWindow, showOverlay, pushStatus, pushTranscript, setHotkeyStatus, getOverlayVisible } from './overlay-window.manager';
import { HotkeyRegistrarService, type HotkeyHandlerMap } from './hotkey-registrar.service';
import { WindowControlActionsService } from './window-control.actions';
import { AudioCaptureService } from './audio/audio-capture.service';
import { DeepgramSttGateway } from './stt/deepgram-stt.gateway';
import { TranscriptBuffer } from './stt/transcript-buffer';
import type { ISttTranscriptEvent, SttConnectionState } from './stt/stt-provider.interface';

/**
 * The single hotkey registrar for the app's lifetime. Instantiated once after the overlay
 * boots and torn down on quit. There is no TSyringe container in the main process, so this
 * module-level handle is the conventional singleton (see HotkeyRegistrarService @remarks).
 */
let hotkeyRegistrar: HotkeyRegistrarService | undefined;

/**
 * The single STT capture service and gateway for the app's lifetime, instantiated once in
 * `app.whenReady()` and torn down on quit. Module-level by-convention singletons (the main process
 * has no TSyringe container), mirroring {@link hotkeyRegistrar}.
 */
let audioCapture: AudioCaptureService | undefined;
let sttGateway: DeepgramSttGateway | undefined;

/**
 * Builds the action-label -> handler map for the registrar from the real window-control
 * actions (02-02) plus the Phase 4 clear-transcript action (D-07). Each label maps to a handler
 * that mutates the overlay window or the transcript buffer. The single show/hide chord branches on
 * the main-owned {@link getOverlayVisible} state; the four move directions, opacity up/down, the
 * HUD-content toggle (D-14), and quit (D-04) map directly. `clear-transcript` wipes the main-side
 * {@link TranscriptBuffer} and immediately pushes the emptied snapshot so the overlay reflects it.
 *
 * @param actions - The window-control action service bound to the overlay window.
 * @param window - The overlay window to push the cleared transcript snapshot to.
 * @param buffer - The transcript buffer wiped by the clear-transcript chord.
 * @param getConnectionState - Reads the current connection state for the cleared-snapshot push.
 * @returns A handler map covering every locked action label.
 */
function buildHandlers(actions: WindowControlActionsService, window: BrowserWindow, buffer: TranscriptBuffer, getConnectionState: () => SttConnectionState): HotkeyHandlerMap {
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
        'clear-transcript': (): void => {
            buffer.clear();
            pushTranscript(window, { ...buffer.renderable(), connectionState: getConnectionState() });
        },
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

/**
 * Wires the full main-side STT pipeline once: WASAPI capture -> resample -> Deepgram gateway ->
 * transcript buffer -> one-way `jedi:transcript` push to the overlay (TRN-01/02/03/04).
 *
 * All pieces are by-convention singletons resolved here at the entry point only (no service-locator
 * mid-method). The Deepgram key is read from `process.env.DEEPGRAM_API_KEY` in main only (D-08) and
 * passed to the gateway constructor; it never crosses IPC and is never logged. Gateway `transcript`
 * events fill the buffer (interim replaced, finals committed) and push the renderable snapshot;
 * `connection-state-change` updates the surfaced state and re-pushes; `error` is swallowed (the
 * gateway never throws) so a transient STT fault keeps the app running. Capture faults likewise
 * surface to a logged, non-crashing handler.
 *
 * @param window - The overlay window the transcript snapshot is pushed to.
 * @param buffer - The shared transcript buffer (also wiped by the clear-transcript chord).
 * @returns A getter for the current connection state, read by the clear-transcript handler.
 */
function wireSttPipeline(window: BrowserWindow, buffer: TranscriptBuffer): () => SttConnectionState {
    let connectionState: SttConnectionState = 'disconnected';

    const gateway = new DeepgramSttGateway(process.env.DEEPGRAM_API_KEY ?? '');
    sttGateway = gateway;

    gateway.on('transcript', (event: ISttTranscriptEvent) => {
        if (event.isFinal) {
            buffer.appendFinal(event.text);
        } else {
            buffer.setInterim(event.text);
        }

        pushTranscript(window, { ...buffer.renderable(), connectionState });
    });

    gateway.on('connection-state-change', (state: SttConnectionState) => {
        connectionState = state;
        pushTranscript(window, { ...buffer.renderable(), connectionState: state });
    });

    gateway.on('error', () => {
        // The gateway never throws — it surfaces transport faults here. We keep running; the
        // connection-state row already reflects reconnecting/disconnected. The error is NOT logged
        // with its payload to avoid any risk of leaking key-adjacent detail (D-08).
    });

    const capture = new AudioCaptureService(
        (pcm) => gateway.sendAudio(pcm),
        () => {
            // A capture/device fault must never crash main. It surfaces via the absence of transcript
            // updates; we keep the app alive rather than throwing (report-don't-throw, WR-01/WR-02).
        }
    );
    audioCapture = capture;

    void gateway.start().then(() => capture.start());

    return (): SttConnectionState => connectionState;
}

app.whenReady().then(() => {
    const window = bootOverlay();

    // The authoritative rolling transcript buffer (main-owned, TRN-04). Wired into the STT pipeline
    // below and wiped by the clear-transcript chord.
    const buffer = new TranscriptBuffer();

    // Wire capture -> resample -> Deepgram -> buffer -> jedi:transcript push once (TRN-01/02/03).
    const getConnectionState = wireSttPipeline(window, buffer);

    // Register the global hotkey layer after the overlay boots. The aggregated outcome is
    // fed to the HUD over the read-only jedi:status channel (D-06) — startup-only (D-07), and
    // the app launches even if some chords fail (D-08). The real window-control handlers
    // (02-02) mutate this overlay window when their chords fire; the clear-transcript chord
    // (D-07/TRN-04) wipes the buffer and re-pushes the emptied snapshot.
    const windowControlActions = new WindowControlActionsService(window);
    hotkeyRegistrar = new HotkeyRegistrarService(buildHandlers(windowControlActions, window, buffer, getConnectionState));
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

    // Release the native capture handle and close the Deepgram socket so no native/socket
    // resource leaks on quit (mirrors the registrar teardown discipline).
    void audioCapture?.teardown();
    void sttGateway?.stop();

    if (process.platform !== 'darwin') {
        app.quit();
    }
});
