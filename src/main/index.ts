import { resolve } from 'path';
import { app, BrowserWindow, ipcMain } from 'electron';
import { loadDotenvFile } from './config/load-dotenv.utility';
import { resolveApiKey } from './config/resolve-api-key.utility';
import { ApiKeyStoreService } from './secrets/api-key-store.service';
import { openOrFocusSettingsWindow } from './settings-window.manager';
import {
    createOverlayWindow,
    showOverlay,
    pushStatus,
    pushTranscript,
    pushScrollTranscript,
    pushAi,
    setHotkeyStatus,
    getOverlayVisible,
    setActivePanel,
    getActivePanel,
} from './overlay-window.manager';
import { HotkeyRegistrarService, type HotkeyHandlerMap } from './hotkey-registrar.service';
import { WindowControlActionsService } from './window-control.actions';
import { AudioCaptureService } from './audio/audio-capture.service';
import { computeRmsInt16 } from './audio/rms.utility';
import { DeepgramSttGateway } from './stt/deepgram-stt.gateway';
import { TranscriptBuffer } from './stt/transcript-buffer';
import type { ISttTranscriptEvent, SttConnectionState } from './stt/stt-provider.interface';
import { AnthropicGateway } from './ai/anthropic-ai.gateway';
import { AiOrchestrator } from './ai/ai-orchestrator';
import { AiHistory } from './ai/ai-history';
import { SessionContextRepository } from './context/session-context.repository';

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
 * Live re-key entry point for the Deepgram STT gateway (D-07, instance-swap). Created inside
 * {@link wireSttPipeline} (which owns the overlay window, buffer, and connection-state) and stored
 * here at module level so the `settings:save-keys` IPC handler can invoke it. Undefined until the STT
 * pipeline is wired at boot. See {@link wireSttPipeline} for the swap discipline (stop → new instance →
 * re-attach handlers → re-point sttGateway → start).
 */
let rekeyDeepgram: ((newKey: string) => Promise<void>) | undefined;

/**
 * The single AI stack for the app's lifetime (Phase 5), instantiated once in `app.whenReady()`.
 * Module-level by-convention singletons mirroring {@link sttGateway}. {@link aiHistory} MUST be this
 * single shared instance — NOT one constructed inside the orchestrator — because 05-02's clear-AI
 * handler will call `aiHistory.clear()`/`snapshot()` and must bind to the SAME instance the
 * orchestrator was injected with (Fix 3). The gateway holds no socket, so no teardown is required.
 */
let aiGateway: AnthropicGateway | undefined;
let aiOrchestrator: AiOrchestrator | undefined;
let aiHistory: AiHistory | undefined;

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
 * @param aiOrchestrator - The single-in-flight AI orchestrator the 'ai-answer'/'ai-talking-points' chords trigger (Phase 5).
 * @param aiHistory - The shared bounded AI history; the 'clear-ai' chord empties it then pushes a `cleared` event.
 * @returns A handler map covering every locked action label.
 */
function buildHandlers(
    actions: WindowControlActionsService,
    window: BrowserWindow,
    buffer: TranscriptBuffer,
    getConnectionState: () => SttConnectionState,
    aiOrchestrator: AiOrchestrator,
    aiHistory: AiHistory
): HotkeyHandlerMap {
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
            // audioLevel resets to 0 here; the next captured PCM chunk re-pushes the live level within
            // ~66 ms, so the meter only momentarily dips rather than going stale.
            pushTranscript(window, { ...buffer.renderable(), connectionState: getConnectionState(), audioLevel: 0 });
        },
        'scroll-transcript-up': (): void => pushScrollTranscript(window, 'up'),
        'scroll-transcript-down': (): void => pushScrollTranscript(window, 'down'),
        // Phase 5 (D-08): Focus-cycle. Flips the main-owned activePanel flag (AI default) and re-pushes
        // status; the renderer routes the single Ctrl+Alt+PgUp/PgDn scroll channel and flips the corner
        // indicator off the pushed flag. Mirrors the getOverlayVisible() branch (read the main-owned
        // flag, toggle, push) — there is no second scroll channel; routing lives in the renderer (D-08).
        'focus-cycle': (): void => {
            setActivePanel(getActivePanel() === 'ai' ? 'transcript' : 'ai');
            pushStatus(window);
        },
        // Phase 5 (AI-01/D-05): Answer mode. The orchestrator owns the whole lifecycle — empty-span
        // guard (D-11), single-in-flight cancel on re-press (D-06), and the debounced jedi:ai push —
        // so the handler is a one-liner.
        'ai-answer': (): void => aiOrchestrator.trigger('answer'),
        // Phase 5 (AI-02/D-05): Talking-points mode. Same orchestrator lifecycle as answer; the mode
        // selects TALKING_POINTS_SYSTEM_PROMPT + claude-opus-4-8 (D-10) inside the orchestrator.
        'ai-talking-points': (): void => aiOrchestrator.trigger('talking-points'),
        // Phase 5 (D-02): Clear the AI panel. Empties the SAME shared aiHistory instance the orchestrator
        // appends to (Fix 3), then pushes a `cleared` event so the renderer resets its mirror to empty.
        // Mirrors the clear-transcript handler shape (mutate the main-owned store, then push the result).
        'clear-ai': (): void => {
            aiHistory.clear();
            pushAi(window, { type: 'cleared' });
        },
        // Phase 6 (D-01/SET-01): Open (or focus) the settings window. The window manager owns the lazy
        // create-or-focus lifecycle, so the handler is a one-liner mirroring the other chords. The
        // settings window is a normal focusable window — opening it deliberately takes focus, unlike the
        // overlay; it never touches the overlay's focus discipline.
        'open-settings': (): void => openOrFocusSettingsWindow(),
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
 * @param apiKeyStore - The two-key safeStorage store; a saved Deepgram key overrides a stale .env (D-08).
 * @returns A getter for the current connection state, read by the clear-transcript handler.
 */
function wireSttPipeline(window: BrowserWindow, buffer: TranscriptBuffer, apiKeyStore: ApiKeyStoreService): () => SttConnectionState {
    let connectionState: SttConnectionState = 'disconnected';

    // D-08 precedence: a key saved via the settings window (safeStorage) wins over a stale .env value;
    // the env fallback preserves the pre-Phase-6 behavior. Resolved here, post-app.ready (Pitfall 2), so
    // safeStorage is available. The key is read in main only and never logged or sent over IPC.
    const gateway = new DeepgramSttGateway(resolveApiKey(apiKeyStore.getDeepgram(), process.env.DEEPGRAM_API_KEY));
    sttGateway = gateway;

    // Latest audio level (RMS, 0..1) computed in main from the captured PCM. Surfaced on the overlay
    // as a live meter so the user sees capture is alive even during silence between transcripts.
    let audioLevel = 0;

    // Reads the current audio level for handler pushes; closed over so re-attached handlers (on re-key)
    // always read the live value rather than a stale capture.
    const getAudioLevel = (): number => audioLevel;

    // Attach the three gateway lifecycle bindings. Extracted so re-keying Deepgram (a fresh gateway
    // instance) re-attaches the SAME bindings (Pitfall 3) — otherwise a re-keyed socket would emit
    // transcripts/state with no listener and the live transcript would freeze.
    attachSttGatewayHandlers(gateway, window, buffer, () => connectionState, (state) => (connectionState = state), getAudioLevel);

    // Throttle the level-only push so the meter animates smoothly (~15 fps) without flooding IPC on
    // every ~10 ms PCM chunk. Transcript/connection pushes carry the level too, so the bar is always
    // current on those events as well.
    let lastLevelPushMs = 0;
    const capture = new AudioCaptureService(
        (pcm) => {
            audioLevel = computeRmsInt16(pcm);
            const nowMs = Date.now();
            if (nowMs - lastLevelPushMs >= 66) {
                lastLevelPushMs = nowMs;
                pushTranscript(window, { ...buffer.renderable(), connectionState, audioLevel });
            }
            // Feed the CURRENT gateway instance via the module-level re-pointable ref (NOT the local
            // `gateway` const) so a live Deepgram re-key keeps the running capture pumping into the new
            // socket without restarting AudioCaptureService (D-07).
            sttGateway?.sendAudio(pcm);
        },
        () => {
            // A capture/device fault must never crash main. It surfaces via the absence of transcript
            // updates and a flat meter; we keep the app alive rather than throwing (WR-01/WR-02).
        }
    );
    audioCapture = capture;

    void gateway.start().then(() => capture.start());

    // D-07 live re-key (instance swap): the Deepgram gateway holds `apiKey` privately with no setter, so
    // re-keying = tear down the running socket, construct a fresh gateway with the new key, re-attach the
    // SAME lifecycle handlers (Pitfall 3 — else the new socket emits to no listener and the transcript
    // freezes), re-point the module-level `sttGateway` (the capture callback feeds whatever it points at),
    // then start. The running AudioCaptureService is untouched, so capture never pauses. Never logs the key.
    rekeyDeepgram = async (newKey: string): Promise<void> => {
        await sttGateway?.stop();
        const next = new DeepgramSttGateway(newKey);
        attachSttGatewayHandlers(next, window, buffer, () => connectionState, (state) => (connectionState = state), getAudioLevel);
        sttGateway = next;
        await next.start();
    };

    return (): SttConnectionState => connectionState;
}

/**
 * Attaches the three Deepgram gateway lifecycle bindings (`transcript`, `connection-state-change`,
 * `error`) to the overlay-push pipeline. Defined ONCE and called from both the boot path
 * ({@link wireSttPipeline}) and the live re-key path ({@link rekeyDeepgram}) so a re-keyed gateway
 * instance is wired identically and the transcript resumes (Pitfall 3 — a fresh socket with no
 * listeners would freeze the live transcript).
 *
 * The handlers read/write the connection state through the supplied accessors so the single
 * authoritative state variable (owned by {@link wireSttPipeline}) is shared across re-keys.
 *
 * @param gateway - The gateway instance to wire (the boot instance or a re-keyed one).
 * @param window - The overlay window the transcript snapshot is pushed to.
 * @param buffer - The shared transcript buffer (interim replaced, finals committed).
 * @param getConnectionState - Reads the current connection state for the transcript push.
 * @param setConnectionState - Writes the current connection state on a state-change event.
 * @param getAudioLevel - Reads the latest computed audio level for the transcript push.
 */
function attachSttGatewayHandlers(
    gateway: DeepgramSttGateway,
    window: BrowserWindow,
    buffer: TranscriptBuffer,
    getConnectionState: () => SttConnectionState,
    setConnectionState: (state: SttConnectionState) => void,
    getAudioLevel: () => number
): void {
    gateway.on('transcript', (event: ISttTranscriptEvent) => {
        if (event.isFinal) {
            buffer.appendFinal(event.text);
        } else {
            buffer.setInterim(event.text);
        }

        pushTranscript(window, { ...buffer.renderable(), connectionState: getConnectionState(), audioLevel: getAudioLevel() });
    });

    gateway.on('connection-state-change', (state: SttConnectionState) => {
        setConnectionState(state);
        pushTranscript(window, { ...buffer.renderable(), connectionState: state, audioLevel: getAudioLevel() });
    });

    gateway.on('error', () => {
        // The gateway never throws — it surfaces transport faults here. We keep running; the
        // connection-state row already reflects reconnecting/disconnected. The error is NOT logged
        // with its payload to avoid any risk of leaking key-adjacent detail (D-08).
    });
}

app.whenReady().then(() => {
    // Load local dev secrets (the Deepgram key, D-08) from a gitignored .env before anything reads
    // process.env. A shell-exported var always wins; a missing file is a no-op (packaged builds inject
    // secrets via the real environment). MUST run before wireSttPipeline reads DEEPGRAM_API_KEY.
    loadDotenvFile(resolve(app.getAppPath(), '.env'));

    // The two-key safeStorage store (D-08/SET-02). Instantiated once here, post-app.ready so
    // safeStorage.isEncryptionAvailable() is true (Pitfall 2). By-convention singleton — no TSyringe.
    // A key saved via the settings window overrides a stale .env value at boot (resolveApiKey).
    const apiKeyStore = new ApiKeyStoreService();

    // The session-context persistence layer (06-02, D-09). By-convention singleton resolved here at the
    // entry point only (no service-locator mid-method). Backs the orchestrator's pull-on-trigger context
    // provider (D-10) and the two settings:*-context IPC handlers below.
    const contextRepo = new SessionContextRepository();

    const window = bootOverlay();

    // The authoritative rolling transcript buffer (main-owned, TRN-04). Wired into the STT pipeline
    // below and wiped by the clear-transcript chord.
    const buffer = new TranscriptBuffer();

    // Wire capture -> resample -> Deepgram -> buffer -> jedi:transcript push once (TRN-01/02/03).
    const getConnectionState = wireSttPipeline(window, buffer, apiKeyStore);

    // Wire the Phase 5 AI stack. The Anthropic key is read from process.env in main only (mirroring the
    // Deepgram D-08 policy), AFTER loadDotenvFile, and constructor-injected — the gateway never reads
    // env and never logs the key. aiHistory is a SINGLE shared instance (Fix 3): both the orchestrator
    // (which appends to it) and 05-02's clear-ai handler must bind to the same instance. The
    // orchestrator closes over the shared `buffer` (the span source) and a `pushAi(window, event)`
    // closure, mirroring how wireSttPipeline closes over pushTranscript. If the key is empty, the
    // orchestrator surfaces `AI error: missing API key` inline (Pitfall 3) — never logs the key.
    // D-08 precedence for the Anthropic key too: a saved safeStorage key overrides a stale .env value.
    aiGateway = new AnthropicGateway(resolveApiKey(apiKeyStore.getAnthropic(), process.env.ANTHROPIC_API_KEY));
    aiHistory = new AiHistory();
    // D-10 pull-on-trigger: the orchestrator's 5th arg pulls the active grounding context FRESH at each
    // trigger, so a mid-session context Save grounds the very next AI call with no restart. An absent
    // context returns `undefined` → formatContext '' → byte-for-byte Phase-5 prompt (fail-safe).
    aiOrchestrator = new AiOrchestrator(aiGateway, buffer, aiHistory, (event) => pushAi(window, event), () => contextRepo.activeAsGrounding());

    // Register the settings window's dedicated two-way IPC surface (D-04). These four named channels are
    // the ENTIRE settings renderer->main write surface; the overlay's one-way jedi:* channels are
    // untouched. SECURITY: get-keys returns presence booleans only (T-06-01) — the decrypted key never
    // crosses IPC outbound; save-keys trims + string-validates input (T-06-05) and never logs the key
    // (T-06-02). Live re-key of the running gateways lands in 06-04; here save just persists. The two
    // context channels are declared now and fully wired (the editor UI + persistence) in 06-03/06-04.
    ipcMain.handle('settings:get-keys', (): { deepgram: boolean; anthropic: boolean } => ({
        deepgram: apiKeyStore.hasDeepgram(),
        anthropic: apiKeyStore.hasAnthropic(),
    }));

    ipcMain.handle('settings:save-keys', async (_event, keys: { deepgram?: string; anthropic?: string }): Promise<void> => {
        // Validate each field is a non-empty string before persisting (T-06-05). The plaintext is
        // encrypted at rest by the store and is NEVER logged here.
        if (typeof keys?.deepgram === 'string' && keys.deepgram.trim().length > 0) {
            const trimmed = keys.deepgram.trim();
            apiKeyStore.saveDeepgram(trimmed);
            // D-07 live re-key: tear down + reconnect the running STT socket with the new key, no restart.
            await rekeyDeepgram?.(trimmed);
        }

        if (typeof keys?.anthropic === 'string' && keys.anthropic.trim().length > 0) {
            const trimmed = keys.anthropic.trim();
            apiKeyStore.saveAnthropic(trimmed);
            // D-07 live re-key: rebuild the Anthropic SDK client in place so the next AI call uses the
            // new key, no restart. The orchestrator's gateway reference + wired handlers are untouched.
            aiGateway?.rekey(trimmed);
        }
    });

    // settings:get-context (06-04): the editor pre-fills from the active context DTO (CTX-02). Returns
    // `undefined` when no context exists yet (the editor renders empty fields). No key/secret crosses here.
    ipcMain.handle('settings:get-context', (): ReturnType<typeof contextRepo.getActive> => contextRepo.getActive());

    // settings:save-context (06-04, CTX-02/D-06): persist-and-activate the four grounding fields so the
    // NEXT AI trigger pulls them via the orchestrator's provider — no restart. SECURITY (T-06-14,
    // Tampering): the inbound DTO is untrusted renderer input, so VALIDATE its shape before persisting —
    // reject a non-object, and coerce each field defensively (a wrong-typed field is dropped, never
    // forwarded into the prompt). Only the four grounding fields are written; id/source/createdAt are
    // owned by the repository. The renderer already sends `links` as a parsed string[] (preload contract),
    // so no newline parsing is needed here.
    ipcMain.handle('settings:save-context', (_event, dto: unknown): void => {
        if (typeof dto !== 'object' || dto === null) {
            return;
        }

        const candidate = dto as Record<string, unknown>;
        const notes = typeof candidate.notes === 'string' ? candidate.notes : undefined;
        const ticketText = typeof candidate.ticketText === 'string' ? candidate.ticketText : undefined;
        const repoSnippets = typeof candidate.repoSnippets === 'string' ? candidate.repoSnippets : undefined;
        const links = Array.isArray(candidate.links) ? candidate.links.filter((link): link is string => typeof link === 'string') : undefined;

        contextRepo.saveActive({ notes, ticketText, repoSnippets, links });
    });

    // Register the global hotkey layer after the overlay boots. The aggregated outcome is
    // fed to the HUD over the read-only jedi:status channel (D-06) — startup-only (D-07), and
    // the app launches even if some chords fail (D-08). The real window-control handlers
    // (02-02) mutate this overlay window when their chords fire; the clear-transcript chord
    // (D-07/TRN-04) wipes the buffer and re-pushes the emptied snapshot. The 'ai-answer' chord
    // (Phase 5) triggers the injected orchestrator.
    const windowControlActions = new WindowControlActionsService(window);
    hotkeyRegistrar = new HotkeyRegistrarService(buildHandlers(windowControlActions, window, buffer, getConnectionState, aiOrchestrator, aiHistory));
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
