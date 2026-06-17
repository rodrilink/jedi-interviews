import type { JediApi, IOverlayStatus } from './index';

declare global {
    interface Window {
        /** The typed, read-only, non-secret bridge exposed by the preload (D-06). */
        jedi: JediApi;
    }
}

/** Re-exported so the renderer HUD can type the status payload it receives. */
export type { IOverlayStatus };
