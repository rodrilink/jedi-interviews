import type { JediApi, IOverlayStatus, IOverlayTranscript, IAiPushEvent, AiMode } from './index';

declare global {
    interface Window {
        /** The typed, read-only, non-secret bridge exposed by the preload (D-06). */
        jedi: JediApi;
    }
}

/** Re-exported so the renderer HUD + AI panel can type the payloads they receive. */
export type { IOverlayStatus, IOverlayTranscript, IAiPushEvent, AiMode };
