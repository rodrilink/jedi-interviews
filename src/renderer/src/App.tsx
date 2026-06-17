import type { JSX } from 'react';
import { DebugHud } from './components/debug-hud';
import './assets/hud.css';

/**
 * The overlay renderer root.
 *
 * In Phase 1 it renders the toggleable debug HUD (D-07/D-08), which subscribes to the
 * read-only `window.jedi.onStatus` channel and displays the live Electron version,
 * content-protection state, and window position over a transparent background. The HUD
 * shows by default since no hotkeys exist yet; Phase 2 wires its toggle.
 *
 * @returns The overlay root element.
 */
export function App(): JSX.Element {
    return <DebugHud visible={true} />;
}
