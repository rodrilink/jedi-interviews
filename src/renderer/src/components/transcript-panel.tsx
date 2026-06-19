import { useEffect, useRef, useState, type JSX } from 'react';
import { PANEL_LABEL, type ActivePanel } from './panel-labels';

/**
 * The read-only transcript payload received over the `window.jedi.onTranscript` bridge (D-04).
 * Structurally mirrors `IOverlayTranscript` in main/preload; declared locally because the renderer is
 * bundled separately from the preload.
 */
interface IOverlayTranscript {
    /** The space-joined finalized transcript text in the current time window. */
    finalText: string;
    /** The current interim (partial) transcript, rendered visually distinct from final (D-04). */
    interimText: string;
    /** The coarse STT connection state surfaced on the overlay (TRN-03). */
    connectionState: string;
    /** The live capture RMS level in `[0, 1]`, computed in main, rendered in the HUD header meter. */
    audioLevel: number;
}

/**
 * The Questions / Answers ("Q/A") transcript panel — the LEFT column of the three-panel row (quick fix
 * 260619-mcv, layout refactor B).
 *
 * Previously the live transcript was a cramped block stacked inside the DebugHud. It is now a FULL peer
 * panel alongside the AI and Code panels: same chrome, same height treatment, same focus-highlight model.
 * A pure one-way view (IN-01): it subscribes to the read-only `window.jedi.onTranscript` channel and
 * renders the finalized + interim transcript, and to `window.jedi.onStatus` to track the main-owned
 * `activePanel` flag (for the focus highlight + the shared Ctrl+Alt+PgUp/PgDn scroll routing — it scrolls
 * only when 'transcript' is active, D-08). It reuses the prior stick-to-bottom follow/pause behavior so
 * the newest text stays in view while leaving the user free to scroll up.
 *
 * @returns The Q/A transcript panel element (always rendered).
 */
export function TranscriptPanel(): JSX.Element {
    const [transcript, setTranscript] = useState<IOverlayTranscript | null>(null);
    const [activePanel, setActivePanel] = useState<ActivePanel>('ai');
    const transcriptRef = useRef<HTMLDivElement | null>(null);
    // While the user has scrolled up via hotkey, auto-stick is paused so new text doesn't yank them back
    // to the bottom mid-read. Scrolling back to the bottom re-enables the live follow.
    const stickToBottomRef = useRef<boolean>(true);
    // The scroll subscription is wired once (empty-deps useEffect), so mirror the live active-panel flag
    // into a ref so the handler reads the live value and only scrolls this panel when 'transcript' is the
    // active panel (D-08 routing).
    const activePanelRef = useRef<ActivePanel>('ai');

    useEffect(() => {
        const offTranscript = window.jedi?.onTranscript((next: IOverlayTranscript) => setTranscript(next));

        const offStatus = window.jedi?.onStatus((status) => {
            activePanelRef.current = status.activePanel;
            setActivePanel(status.activePanel);
        });

        // Hotkey-driven scroll (the unfocused overlay cannot be scrolled by mouse). Each press steps
        // ~3 lines; reaching the bottom re-arms live auto-follow, scrolling up pauses it. The single
        // scroll channel is shared across all three panels, so we only act when 'transcript' is active.
        const offScroll = window.jedi?.onScrollTranscript((direction) => {
            if (activePanelRef.current !== 'transcript') {
                return;
            }

            const element = transcriptRef.current;
            if (element === null) {
                return;
            }

            const lineStep = 3 * 18;
            element.scrollTop += direction === 'down' ? lineStep : -lineStep;
            stickToBottomRef.current = element.scrollTop + element.clientHeight >= element.scrollHeight - 4;
        });

        return (): void => {
            offTranscript?.();
            offStatus?.();
            offScroll?.();
        };
    }, []);

    // Keep the newest transcript text in view as final/interim text grows — but only while the user
    // hasn't scrolled up to read earlier text (stickToBottomRef).
    useEffect(() => {
        const element = transcriptRef.current;
        if (element !== null && stickToBottomRef.current) {
            element.scrollTop = element.scrollHeight;
        }
    }, [transcript?.finalText, transcript?.interimText]);

    const finalTextLabel = transcript?.finalText ?? '';
    const interimTextLabel = transcript?.interimText ?? '';

    return (
        <section className="transcript-panel" data-testid="card-transcript-panel" data-active={activePanel === 'transcript'}>
            {/* Corner active-panel indicator mirroring the AI/Code panels: highlights when Q/A is the
                focus-cycle target (Ctrl+Alt+F). Pure view of the main-owned activePanel flag. */}
            <span className="transcript-panel__active-indicator" data-testid="icon-active-panel-transcript" data-active-panel={activePanel}>
                {PANEL_LABEL.transcript}
            </span>
            <h2 className="transcript-panel__title">{PANEL_LABEL.transcript}</h2>
            <div className="transcript-panel__body" data-testid="card-transcript" ref={transcriptRef}>
                <span className="transcript-panel__final" data-testid="cell-transcript-final">
                    {finalTextLabel}
                </span>{' '}
                <span className="transcript-panel__interim" data-testid="cell-transcript-interim">
                    {interimTextLabel}
                </span>
            </div>
        </section>
    );
}
