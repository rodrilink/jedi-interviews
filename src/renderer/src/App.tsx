import { type JSX } from 'react';
import { DebugHud } from './components/debug-hud';
import { AiPanel } from './components/ai-panel';
import './assets/hud.css';

/**
 * The overlay renderer root.
 *
 * It renders two sibling surfaces. The toggleable debug HUD (D-07/D-08) subscribes to the read-only
 * `window.jedi.onStatus` and `window.jedi.onTranscript` channels and displays the live Electron
 * version, content-protection state, window position, hotkey status, the live transcript, the STT
 * connection state, and a hotkey cheat-sheet. HUD-content visibility is owned by the main process and
 * toggled by the HUD-toggle chord (D-14/D-15): `DebugHud` honors the pushed `hudVisible` flag.
 *
 * The always-on `AiPanel` (Phase 5, D-01) is a SIBLING of `DebugHud`, NOT a child — it subscribes to
 * the read-only `window.jedi.onAi` channel and renders streamed AI entries. It is deliberately
 * outside the HUD-toggle gate so it stays visible regardless of Ctrl+Alt+H (D-01).
 *
 * The renderer is a pure one-way view: as of Phase 4 (D-02/IN-01) the entire audio path — WASAPI
 * capture, resample, the Deepgram socket, and the transcript buffer — lives in the main process, and
 * Phase 5's AI orchestration likewise lives in main. `App` only renders what main pushes.
 *
 * @returns The overlay root element.
 */
export function App(): JSX.Element {
    return (
        <>
            <DebugHud />
            <AiPanel />
        </>
    );
}
