import { useEffect, useState, type JSX } from 'react';
import { DebugHud } from './components/debug-hud';
import { TranscriptPanel } from './components/transcript-panel';
import { AiPanel } from './components/ai-panel';
import { VisionPanel } from './components/vision-panel';
import './assets/hud.css';

/**
 * The overlay renderer root (quick fix 260619-mcv, layout refactor B).
 *
 * Layout: a full-width `DebugHud` status HEADER across the top, and below it a ROW of THREE peer panels —
 * `TranscriptPanel` ("Q/A", left), `AiPanel` ("AI", middle), and `VisionPanel` ("Code", right, widest).
 *
 * - `DebugHud` (D-07/D-08) is the header: it subscribes to the read-only `window.jedi.onStatus` /
 *   `window.jedi.onTranscript` channels and shows the Electron version, content-protection, position,
 *   hotkey status, STT connection state, audio meter, active-panel readout, the Mouse interaction-mode
 *   indicator, and the hotkey cheat-sheet. HUD-content visibility is main-owned (Ctrl+Alt+H, D-14/D-15).
 * - `TranscriptPanel` is the live STT transcript as a FULL peer panel (it used to be a cramped block
 *   inside the HUD). It renders the finalized + interim transcript and follows the newest text.
 * - `AiPanel` (Phase 5, D-01) renders streamed answer/talking-points entries; it is outside the
 *   HUD-toggle gate so it stays visible regardless of Ctrl+Alt+H.
 * - `VisionPanel` (Phase 7, D-08/D-09) renders ONLY code-challenge entries in the widest column.
 *
 * Each panel highlights itself when it is the focus-cycle target (Ctrl+Alt+F cycles transcript → ai →
 * vision → transcript via the main-owned `activePanel` flag). When `overlayInteractive` is true (the
 * Ctrl+Alt+M toggle), `#root` gets the `root--interactive` class so the surface becomes hit-testable
 * (non-zero-alpha background) — a fully-transparent window receives no mouse events even when focusable,
 * so this class is what actually lets the user click + drag-select code. It reverts to fully transparent
 * (click-through default) when the toggle is off.
 *
 * The renderer is a pure one-way view (IN-01): the audio path and AI orchestration live in main; `App`
 * only renders what main pushes.
 *
 * @returns The overlay root element.
 */
export function App(): JSX.Element {
    const [overlayInteractive, setOverlayInteractive] = useState<boolean>(false);

    useEffect(() => {
        const offStatus = window.jedi?.onStatus((status) => setOverlayInteractive(status.overlayInteractive));

        return (): void => {
            offStatus?.();
        };
    }, []);

    // While interaction mode is ON, mark the root so CSS gives the interactive surface a real (non-zero-
    // alpha) background — fully-transparent pixels are not hit-tested by the OS/Chromium, so click +
    // drag-select would otherwise never land even on a focusable window (quick fix 260619-mcv, item C).
    const rootClassName = overlayInteractive ? 'overlay-root overlay-root--interactive' : 'overlay-root';

    return (
        <div className={rootClassName} data-testid="overlay-root" data-interactive={overlayInteractive}>
            <DebugHud />
            <div className="overlay-panels">
                <TranscriptPanel />
                <AiPanel />
                <VisionPanel />
            </div>
        </div>
    );
}
