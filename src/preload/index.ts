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
}

/** IPC channel for the read-only, non-secret status push from main (D-05). */
const STATUS_CHANNEL = 'jedi:status';

/**
 * The single typed, read-only, NON-SECRET namespace exposed on `window.jedi`.
 *
 * Phase 1 establishes the structural boundary only (D-06): no secret-bearing channels
 * exist (D-05). `onStatus` is the ONLY IPC surface in Phase 1 — a one-way main → renderer
 * subscription carrying proof-of-life data (Electron version, content-protection state,
 * window position) for the debug HUD. The renderer can only listen; it cannot push back.
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
};

export type JediApi = typeof jediApi;

if (process.contextIsolated) {
    contextBridge.exposeInMainWorld('jedi', jediApi);
} else {
    // contextIsolation is mandatory for this app (D-06); fail loudly if it is ever disabled.
    throw new Error('contextIsolation must be enabled — refusing to expose the jedi bridge without it.');
}
