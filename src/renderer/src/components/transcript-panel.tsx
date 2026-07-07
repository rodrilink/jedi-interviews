import { useEffect, useRef, useState, type JSX } from 'react';
import { PANEL_LABEL, type ActivePanel } from './panel-labels';
import { deriveCardRows, derivePeople, type IUtteranceEvent } from './utterance-view.utility';

/**
 * The read-only transcript payload received over the `window.jedi.onTranscript` bridge (D-04).
 * Structurally mirrors `IOverlayTranscript` in main/preload; declared locally because the renderer is
 * bundled separately from the preload.
 */
interface IOverlayTranscript {
    /** The space-joined finalized transcript text in the current (bounded, rolling) main-side window. */
    finalText: string;
    /** The current interim (partial) transcript, rendered visually distinct from final (D-04). */
    interimText: string;
    /** The coarse STT connection state surfaced on the overlay (TRN-03). */
    connectionState: string;
    /** The live capture RMS level in `[0, 1]`, computed in main, rendered in the HUD header meter. */
    audioLevel: number;
    /**
     * The full session-scoped committed utterances, oldest first (Phase 8, QA-01). Main pushes the WHOLE
     * list on every push and empties it in place on Ctrl+Alt+K, so the panel renders directly from this
     * array without a panel-side accumulator (an empty push carries `utterances: []`).
     */
    utterances: IUtteranceEvent[];
}

/**
 * The Questions / Answers ("Q/A") transcript panel — the LEFT column of the panel row.
 *
 * A pure one-way view (IN-01): it subscribes to the read-only `window.jedi.onTranscript` channel and to
 * `window.jedi.onStatus` (for the focus highlight + the shared Ctrl+Alt+PgUp/PgDn scroll routing — it
 * scrolls only when 'transcript' is active, D-08).
 *
 * CARD STACK (Phase 9, QA-04/QA-05): each committed utterance in `next.utterances` renders as its own card
 * labeled `{seq} - {speaker}` (`Q1 - Person 1`, `S3 - Person 2`) via {@link deriveCardRows}, with question
 * cards visually distinct from statements (D-01) and each `Person N` name in a stable per-speaker accent
 * color (D-04). Because main pushes the full session-scoped list each push (and empties it in place on
 * Ctrl+Alt+K), the panel renders directly from the pushed array — no panel-side accumulation, no
 * flat-text overlap reconciliation.
 *
 * PEOPLE ROW + GHOST + EMPTY STATE (Plan 09-02, QA-06/D-09/D-12): a compact people row of counted colored
 * chips ({@link derivePeople}) is pinned at the top as the color legend, shown only once the first
 * `Person N` appears (D-06/D-12). The live in-progress line (`interimText`) renders as one faint unlabeled
 * "ghost" card at the bottom of the stack that solidifies into a real card on finalize (D-09/D-10); it is
 * driven by the single `interimText` state, so it is replaced in place and never accumulates (Phase 8 D-02).
 * When there are no cards and no interim, a muted centered "Listening…" placeholder reassures the user the
 * panel is live (D-12).
 *
 * @returns The Q/A transcript panel element (always rendered).
 */
export function TranscriptPanel(): JSX.Element {
    const [utterances, setUtterances] = useState<IUtteranceEvent[]>([]);
    const [interimText, setInterimText] = useState<string>('');
    const [connectionState, setConnectionState] = useState<string>('');
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
        const offTranscript = window.jedi?.onTranscript((next: IOverlayTranscript) => {
            setInterimText(next.interimText);
            setConnectionState(next.connectionState);

            // Clear-transcript (Ctrl+Alt+K) empties the main-owned `utterances` list in place, so an empty
            // `next.utterances` IS the authoritative clear signal. Gate the reset on that field — NOT on
            // `finalText`, which is only the last ~90s of the rolling `TranscriptBuffer` window and legitimately
            // empties during a conversational lull while the full session `utterances` is still intact (that
            // false-clear would wipe every committed card mid-session). Reset interim in lockstep and
            // early-return so derived state clears together.
            if (next.utterances.length === 0) {
                setUtterances([]);
                setInterimText('');

                return;
            }

            // Main pushes the FULL session-scoped utterance list on every push, so render directly from it
            // (no panel-side accumulator — the derivation counts sequences from list order each render).
            setUtterances(next.utterances);
        });

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

    // Keep the newest card in view as the stack/interim grows — but only while the user hasn't scrolled up
    // to read earlier history (stickToBottomRef). This follow + the visible scrollbar (overflow-y:auto in
    // CSS) let the user scroll back through the session card stack.
    useEffect(() => {
        const element = transcriptRef.current;
        if (element !== null && stickToBottomRef.current) {
            element.scrollTop = element.scrollHeight;
        }
    }, [utterances, interimText]);

    const cardRows = deriveCardRows(utterances);
    const people = derivePeople(utterances);
    // The empty state (D-12) is only when there is neither a committed card NOR a forming interim line, so
    // the "Listening…" placeholder disappears the instant the first ghost card or real card appears.
    const isEmpty = cardRows.length === 0 && interimText.length === 0;

    return (
        <section className="transcript-panel" data-testid="card-transcript-panel" data-active={activePanel === 'transcript'} data-connection-state={connectionState}>
            {/* Corner active-panel indicator mirroring the AI/Code panels: highlights when Q/A is the
                focus-cycle target (Ctrl+Alt+F). Pure view of the main-owned activePanel flag. */}
            <span className="transcript-panel__active-indicator" data-testid="icon-active-panel-transcript" data-active-panel={activePanel}>
                {PANEL_LABEL.transcript}
            </span>
            <h2 className="transcript-panel__title">{PANEL_LABEL.transcript}</h2>
            {/* Compact people row (QA-06/D-06): pinned above the scrolling body as the color legend. Rendered
                only once at least one numbered Person N exists (the undiarized 'Speaker' bucket is already
                excluded by derivePeople, D-05/D-07); hidden entirely on an empty session (D-12). */}
            {people.length > 0 && (
                <div className="transcript-panel__people" data-testid="list-people">
                    {people.map((person) => (
                        <span
                            className="transcript-panel__person-chip"
                            key={person.speaker}
                            data-testid={`row-person-${person.speaker.replace(/\D/g, '')}`}
                            data-speaker-color={person.color}
                        >
                            {`${person.speaker} (${person.count})`}
                        </span>
                    ))}
                </div>
            )}
            <div className="transcript-panel__body" data-testid="card-transcript" ref={transcriptRef}>
                {cardRows.map((row, index) => (
                    <article
                        className={`transcript-panel__card transcript-panel__card--${row.classification === 'question' ? 'question' : 'statement'}`}
                        key={index}
                        data-testid={`row-utterance-${index}`}
                    >
                        <header className="transcript-panel__card-header">
                            <span
                                className="transcript-panel__card-speaker"
                                data-testid={`cell-utterance-speaker-${index}`}
                                data-diarized={row.isDiarized}
                                data-speaker-color={row.speakerColor}
                            >
                                {row.label}
                            </span>
                        </header>
                        <p className="transcript-panel__card-body">{row.text}</p>
                    </article>
                ))}
                {/* Interim "ghost" card (D-09/D-10): ONE trailing unlabeled card for the forming turn, driven
                    solely by the single `interimText` state so it is replaced in place each interim update
                    (never accumulated, never remounted) and resolves cleanly into a real card on finalize —
                    no label, no Q/S accent, a faint/dashed frame reading as "still forming". */}
                {interimText.length > 0 && (
                    <article className="transcript-panel__card transcript-panel__card--ghost" data-testid="row-utterance-interim">
                        <p className="transcript-panel__card-body">{interimText}</p>
                    </article>
                )}
                {/* Empty-state placeholder (D-12): a muted centered line while the session has no cards and no
                    interim; returns automatically after Ctrl+Alt+K via the empty-push reset. */}
                {isEmpty && (
                    <p className="transcript-panel__placeholder" data-testid="cell-transcript-placeholder">
                        Listening…
                    </p>
                )}
            </div>
        </section>
    );
}
