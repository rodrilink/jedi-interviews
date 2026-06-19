import { type JSX } from 'react';
import { DebugHud } from './components/debug-hud';
import { AiPanel } from './components/ai-panel';
import { VisionPanel } from './components/vision-panel';
import './assets/hud.css';

/**
 * The overlay renderer root.
 *
 * It renders THREE sibling column surfaces side by side (Transcript | AI | Code Challenge). The
 * toggleable debug HUD (D-07/D-08) is the LEFT "Transcript" column: it subscribes to the read-only
 * `window.jedi.onStatus` and `window.jedi.onTranscript` channels and displays the live Electron
 * version, content-protection state, window position, hotkey status, the live transcript, the STT
 * connection state, and a hotkey cheat-sheet. HUD-content visibility is owned by the main process and
 * toggled by the HUD-toggle chord (D-14/D-15): `DebugHud` honors the pushed `hudVisible` flag.
 *
 * The always-on `AiPanel` (Phase 5, D-01) is the MIDDLE column — a SIBLING of `DebugHud`, NOT a child —
 * it subscribes to the read-only `window.jedi.onAi` channel and renders streamed answer/talking-points
 * entries. It is deliberately outside the HUD-toggle gate so it stays visible regardless of Ctrl+Alt+H.
 *
 * The dedicated `VisionPanel` (Phase 7, D-08/D-09) is the RIGHT "Code Challenge" column — its own
 * distinct, always-present column alongside the HUD and AI panel (no longer a takeover overlay). It
 * renders ONLY code-challenge entries and shows a quiet placeholder when empty so the column reads
 * intentionally. Each of the three columns highlights itself when it is the focus-cycle target
 * (Ctrl+Alt+F cycles transcript → ai → vision → transcript via the main-owned `activePanel` flag).
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
            <VisionPanel />
        </>
    );
}
