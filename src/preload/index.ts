import { contextBridge, ipcRenderer } from 'electron';
import type { IpcRendererEvent } from 'electron';

/**
 * The read-only, NON-SECRET status payload pushed from main to the HUD.
 *
 * Mirrors `IOverlayStatus` in the main process. Declared here (rather than imported)
 * because the sandboxed preload is bundled separately and must not reach into main.
 */
export interface IOverlayStatus {
    electronVersion: string;
    contentProtection: boolean;
    position: { x: number; y: number };
    /** Startup hotkey-registration outcome (D-06). Declared identically in main and renderer. */
    hotkeys: { active: string; failed: string[] };
    /** Whether the HUD content is shown (D-14/D-15). Main-owned; declared identically in main and renderer. */
    hudVisible: boolean;
}

/**
 * The read-only transcript payload pushed from main over `jedi:transcript` (D-04).
 *
 * Mirrors `IOverlayTranscript` in the main process. Declared here (rather than imported) because the
 * sandboxed preload is bundled separately and must not reach into main. Text + connection state only;
 * never the Deepgram key or any secret (D-08).
 */
export interface IOverlayTranscript {
    /** The space-joined finalized transcript text in the current time window. */
    finalText: string;
    /** The current interim (partial) transcript, rendered visually distinct from final (D-04). */
    interimText: string;
    /** The coarse STT connection state (`connecting | connected | reconnecting | disconnected | error`). */
    connectionState: string;
    /** The live capture RMS level in `[0, 1]`, computed in main, rendered as the overlay audio meter. */
    audioLevel: number;
}

/** IPC channel for the read-only, non-secret status push from main (D-05). */
const STATUS_CHANNEL = 'jedi:status';

/** IPC channel for the read-only, one-way transcript push from main (D-04). */
const TRANSCRIPT_CHANNEL = 'jedi:transcript';

/**
 * The single typed, read-only, NON-SECRET namespace exposed on `window.jedi`.
 *
 * The boundary is strictly one-way main → renderer (D-06): `onStatus` and `onTranscript` are
 * subscriptions carrying proof-of-life data and the live transcript respectively. As of Phase 4
 * (IN-01) the renderer → main write surface is ZERO — the Phase 3 `reportAudioLevel` exception was
 * removed when the renderer audio path was retired (D-02), so no control channel is exposed.
 *
 * Both subscriptions return an unsubscribe function (WR-03) so the consuming `useEffect` can remove
 * its listener on cleanup, preventing leaked listeners under React Strict Mode.
 */
const jediApi = {
    /** Marks the structural boundary as live. */
    isReady: true as const,

    /**
     * Subscribes to read-only overlay status updates pushed from the main process.
     *
     * @param callback - Invoked with the latest non-secret status payload on every push.
     * @returns An unsubscribe function that removes the listener (WR-03).
     */
    onStatus(callback: (status: IOverlayStatus) => void): () => void {
        const listener = (_event: IpcRendererEvent, status: IOverlayStatus): void => callback(status);
        ipcRenderer.on(STATUS_CHANNEL, listener);

        return (): void => {
            ipcRenderer.removeListener(STATUS_CHANNEL, listener);
        };
    },

    /**
     * Subscribes to read-only transcript updates pushed from the main process (D-04). High-frequency:
     * interim results fire many times per second.
     *
     * @param callback - Invoked with the latest transcript snapshot + connection state on every push.
     * @returns An unsubscribe function that removes the listener (WR-03).
     */
    onTranscript(callback: (transcript: IOverlayTranscript) => void): () => void {
        const listener = (_event: IpcRendererEvent, transcript: IOverlayTranscript): void => callback(transcript);
        ipcRenderer.on(TRANSCRIPT_CHANNEL, listener);

        return (): void => {
            ipcRenderer.removeListener(TRANSCRIPT_CHANNEL, listener);
        };
    },
};

export type JediApi = typeof jediApi;

if (process.contextIsolated) {
    contextBridge.exposeInMainWorld('jedi', jediApi);
} else {
    // contextIsolation is mandatory for this app (D-06); fail loudly if it is ever disabled.
    throw new Error('contextIsolation must be enabled — refusing to expose the jedi bridge without it.');
}
