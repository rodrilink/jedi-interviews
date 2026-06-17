import type { JediApi } from './index';

declare global {
    interface Window {
        /** The typed, read-only, non-secret bridge exposed by the preload (D-06). */
        jedi: JediApi;
    }
}

export {};
