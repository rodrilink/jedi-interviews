import { useEffect, useRef, useState, type JSX } from 'react';
import { DebugHud } from './components/debug-hud';
import { TranscriptPanel } from './components/transcript-panel';
import { AiPanel } from './components/ai-panel';
import { VisionPanel } from './components/vision-panel';
import { CommandsPanel } from './components/commands-panel';
import './assets/hud.css';

/**
 * The overlay renderer root (quick fix 260619-mcv).
 *
 * Layout: a full-width `DebugHud` status HEADER across the top (spanning all four columns), and below it
 * a ROW of FOUR panels — `TranscriptPanel` ("Q/A", left), `AiPanel` ("AI"), `VisionPanel` ("Code",
 * widest), and `CommandsPanel` ("Commands", narrowest reference column, far right).
 *
 * - `DebugHud` is the header: it subscribes to the read-only `window.jedi.onStatus` / `window.jedi.onTranscript`
 *   channels and shows the Electron version, content-protection, position, hotkey status, STT connection
 *   state, audio meter, active-panel readout, the Mouse interaction-mode indicator, and the transient
 *   "Copied ✓" flash. The hotkey cheat-sheet moved out to the CommandsPanel (item 1 declutter).
 * - `TranscriptPanel` is the live STT transcript as a full peer panel.
 * - `AiPanel` (Phase 5, D-01) renders streamed answer/talking-points entries.
 * - `VisionPanel` (Phase 7, D-08/D-09) renders ONLY code-challenge entries in the widest column.
 * - `CommandsPanel` is a static hotkey reference; it is OUTSIDE the Ctrl+Alt+F focus cycle (which stays
 *   Q/A → AI → Code) because it has no scroll content.
 *
 * Each of the three content panels highlights itself when it is the focus-cycle target. When
 * `overlayInteractive` is true (the Ctrl+Alt+M toggle), `#root` gets the `overlay-root--interactive` class
 * so the surface becomes hit-testable (non-zero-alpha background) — a fully-transparent window receives no
 * mouse events even when focusable, so this is what actually lets the user click + drag-select code. It
 * reverts to fully transparent (click-through default) when the toggle is off.
 *
 * COPY-ON-RELEASE (item 2): while interaction is ON, a document `mouseup` reads the current text selection
 * and sends it to main (via the `window.jedi.copySelection` preload seam) to be copied to the clipboard —
 * no Ctrl+C needed. Main validates interactive + non-empty and flashes the header "Copied ✓". An empty
 * selection / plain click is a no-op. Ctrl+Alt+Y (copy the full latest solution) keeps working unchanged.
 *
 * The renderer is a pure view (IN-01): the audio path and AI orchestration live in main; `App` only
 * renders what main pushes, plus this one explicit, interactive-gated copy send.
 *
 * @returns The overlay root element.
 */
export function App(): JSX.Element {
    const [overlayInteractive, setOverlayInteractive] = useState<boolean>(false);
    // The mouseup listener is wired once (empty-deps useEffect), so mirror the live interactive flag into
    // a ref so the handler reads the current value rather than a stale closure capture.
    const overlayInteractiveRef = useRef<boolean>(false);

    useEffect(() => {
        const offStatus = window.jedi?.onStatus((status) => {
            overlayInteractiveRef.current = status.overlayInteractive;
            setOverlayInteractive(status.overlayInteractive);
        });

        // Copy-on-mouse-release (item 2): only while interaction mode is ON, copy the current selection to
        // the clipboard on mouseup. Empty selection / plain click = no-op (main also re-checks both, so a
        // stale send while click-through can never copy). Main owns the clipboard; the renderer never
        // imports electron — it sends the text through the dedicated preload seam.
        const onMouseUp = (): void => {
            if (!overlayInteractiveRef.current) {
                return;
            }

            const selection = window.getSelection()?.toString() ?? '';
            if (selection.length === 0) {
                return;
            }

            window.jedi?.copySelection(selection);
        };

        document.addEventListener('mouseup', onMouseUp);

        return (): void => {
            offStatus?.();
            document.removeEventListener('mouseup', onMouseUp);
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
                <CommandsPanel />
            </div>
        </div>
    );
}
