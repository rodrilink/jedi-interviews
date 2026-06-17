import { contextBridge } from 'electron';

/**
 * The single typed, read-only, NON-SECRET namespace exposed on `window.jedi`.
 *
 * Phase 1 establishes the structural boundary only (D-06): no secret-bearing channels
 * exist yet (D-05). Plan 01-02 extends this object with a read-only status channel
 * (Electron version, content-protection state, window position) for the debug HUD.
 */
const jediApi = {
    /** Marks the structural boundary as live; replaced by real channels in later plans. */
    isReady: true as const,
};

export type JediApi = typeof jediApi;

if (process.contextIsolated) {
    contextBridge.exposeInMainWorld('jedi', jediApi);
} else {
    // contextIsolation is mandatory for this app (D-06); fail loudly if it is ever disabled.
    throw new Error('contextIsolation must be enabled — refusing to expose the jedi bridge without it.');
}
