import type { JSX } from 'react';

/**
 * Minimal renderer surface for the Walking Skeleton scaffold.
 *
 * It reads the structural bridge (`window.jedi`) only to prove the contextIsolated
 * preload boundary is wired (D-06). Plan 01-02 replaces this with the transparent
 * debug HUD (Electron version, content-protection state, window position).
 *
 * @returns The scaffold proof-of-life element.
 */
export function App(): JSX.Element {
    const bridgeReady = window.jedi?.isReady === true;

    return (
        <main>
            <h1>Jedi Interviews</h1>
            <p>Walking Skeleton scaffold is running.</p>
            <p>Preload bridge: {bridgeReady ? 'connected' : 'unavailable'}</p>
        </main>
    );
}
