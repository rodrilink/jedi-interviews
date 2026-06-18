import { type JSX } from 'react';
import { DebugHud } from './components/debug-hud';
import './assets/hud.css';

/**
 * The overlay renderer root.
 *
 * It renders the toggleable debug HUD (D-07/D-08), which subscribes to the read-only
 * `window.jedi.onStatus` and `window.jedi.onTranscript` channels and displays the live Electron
 * version, content-protection state, window position, hotkey status, the live transcript, the STT
 * connection state, and a hotkey cheat-sheet over a transparent background. HUD-content visibility
 * is owned by the main process and toggled by the HUD-toggle chord (D-14/D-15): `DebugHud` honors
 * the pushed `hudVisible` flag, so `App` passes no prop and lets the component fall back to
 * shown-on-launch (D-12) until the first status push arrives.
 *
 * The renderer is a pure one-way view: as of Phase 4 (D-02/IN-01) the entire audio path — WASAPI
 * capture, resample, the Deepgram socket, and the transcript buffer — lives in the main process, so
 * `App` no longer starts or owns any capture. It only renders what main pushes.
 *
 * @returns The overlay root element.
 */
export function App(): JSX.Element {
    return <DebugHud />;
}
