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

/** IPC channel for the read-only, non-secret status push from main (D-05). */
const STATUS_CHANNEL = 'jedi:status';

/** IPC channel for the single write-only renderer → main RMS level report (D-04/D-05). */
const AUDIO_LEVEL_CHANNEL = 'jedi:audio-level';

/**
 * The single typed, read-only, NON-SECRET namespace exposed on `window.jedi`.
 *
 * Phase 1 establishes the structural boundary only (D-06): no secret-bearing channels
 * exist (D-05). `onStatus` is a one-way main → renderer subscription carrying proof-of-life
 * data (Electron version, content-protection state, window position) for the debug HUD.
 *
 * Phase 3 adds the ONE exception to the otherwise listen-only boundary: `reportAudioLevel`
 * is a narrow, single-purpose, write-only renderer → main channel for the non-secret RMS
 * level (D-04/D-05). Everything else stays one-way main → renderer; no general control
 * surface is exposed.
 */
const jediApi = {
    /** Marks the structural boundary as live. */
    isReady: true as const,

    /**
     * Subscribes to read-only overlay status updates pushed from the main process.
     *
     * @param callback - Invoked with the latest non-secret status payload on every push.
     */
    onStatus(callback: (status: IOverlayStatus) => void): void {
        ipcRenderer.on(STATUS_CHANNEL, (_event: IpcRendererEvent, status: IOverlayStatus) => callback(status));
    },

    /**
     * Reports the latest renderer-computed RMS audio level to the main process (D-04/D-05).
     *
     * This is the app's ONLY write-direction IPC surface: main re-broadcasts the value on the
     * read-only `jedi:status` channel so the HUD `Audio:` row reflects it. The level is a
     * non-secret scalar in `[0, 1]`; no audio samples or secrets cross this channel.
     *
     * @param level - The RMS audio level in the range `[0, 1]`.
     */
    reportAudioLevel(level: number): void {
        ipcRenderer.send(AUDIO_LEVEL_CHANNEL, level);
    },
};

export type JediApi = typeof jediApi;

if (process.contextIsolated) {
    contextBridge.exposeInMainWorld('jedi', jediApi);
} else {
    // contextIsolation is mandatory for this app (D-06); fail loudly if it is ever disabled.
    throw new Error('contextIsolation must be enabled — refusing to expose the jedi bridge without it.');
}
