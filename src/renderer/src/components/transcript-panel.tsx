import { useEffect, useRef, useState, type JSX } from 'react';
import { PANEL_LABEL, type ActivePanel } from './panel-labels';

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
}

/**
 * Reconciles the next rolling `finalText` snapshot into the monotonically-growing panel-side log (quick
 * fix 260619-mcv round 8 item 1).
 *
 * Main's {@link import('../../../main/stt/transcript-buffer').TranscriptBuffer} is a BOUNDED rolling
 * window (~90s / 400 segments / 20000 chars) that evicts old finalized segments at the source, so each
 * `finalText` push is a contiguous, space-joined SLICE of the full session: as the window rolls, old
 * content drops off the FRONT of the snapshot and new content appears at the END. A naive append would
 * therefore both duplicate the overlapping tail AND still lose nothing — so we reconcile by overlap.
 *
 * The new snapshot's content continues the log: find the longest suffix of the accumulated `log` that is
 * a prefix of `next` (the shared overlap) and append only the remainder. This grows the log monotonically
 * with genuinely-new finalized content and never repeats lines, even after the main window has rolled.
 *
 * Cases handled:
 *  - First content (`log === ''`): the whole snapshot is new.
 *  - Snapshot grew at the tail with no front-pruning: full overlap = old log tail, append the new suffix.
 *  - Snapshot pruned at the front (its start is now mid-log): the overlap still matches deeper in the log,
 *    so only the trailing new content is appended.
 *  - No overlap found (e.g. a long pause rolled the whole window past what we last saw): append a space +
 *    the snapshot so distinct content is not glued together.
 *
 * @param log - The accumulated full-session finalized log so far.
 * @param next - The next rolling `finalText` snapshot from main.
 * @returns The next accumulated log (>= the previous length).
 */
function reconcileFinalLog(log: string, next: string): string {
    if (next.length === 0) {
        return log;
    }

    if (log.length === 0) {
        return next;
    }

    if (next === log || log.endsWith(next)) {
        // The snapshot is entirely already logged (no new finalized content yet) — nothing to append.
        return log;
    }

    // Find the longest suffix of `log` that is a prefix of `next`: that is the overlap between what we
    // already have and the rolling snapshot. Start from the largest possible overlap and shrink.
    const maxOverlap = Math.min(log.length, next.length);
    for (let overlap = maxOverlap; overlap > 0; overlap--) {
        if (log.slice(log.length - overlap) === next.slice(0, overlap)) {
            return log + next.slice(overlap);
        }
    }

    // No overlap — the window rolled entirely past our last-seen content. Append with a separating space
    // so the previously-logged tail and the new snapshot don't run together into one word.
    return `${log} ${next}`;
}

/**
 * The Questions / Answers ("Q/A") transcript panel — the LEFT column of the panel row.
 *
 * A pure one-way view (IN-01): it subscribes to the read-only `window.jedi.onTranscript` channel and to
 * `window.jedi.onStatus` (for the focus highlight + the shared Ctrl+Alt+PgUp/PgDn scroll routing — it
 * scrolls only when 'transcript' is active, D-08).
 *
 * FULL-SESSION HISTORY (quick fix 260619-mcv round 8 item 1): main's TranscriptBuffer is a bounded rolling
 * window, so its `finalText` push only ever carries the recent slice — old lines would otherwise vanish
 * and there would be nothing to scroll back to. WITHOUT touching the main buffer (other code depends on
 * its bounded live window), this panel keeps its OWN full-session finalized log: it accumulates every new
 * finalized snapshot via {@link reconcileFinalLog} (overlap-dedup so the log grows monotonically without
 * repeating the overlapping tail) and never truncates it for the life of the session. Interim text still
 * replaces in place (never accumulated). The clear-transcript chord (Ctrl+Alt+K) empties the main buffer
 * and pushes an empty `finalText` snapshot AND empty interim — that resets this panel-side log too.
 *
 * @returns The Q/A transcript panel element (always rendered).
 */
export function TranscriptPanel(): JSX.Element {
    // The monotonically-growing full-session finalized log (panel-side; never truncated). A ref holds the
    // authoritative value for reconciliation across pushes; state drives the render.
    const finalLogRef = useRef<string>('');
    const [finalLog, setFinalLog] = useState<string>('');
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

            // Clear-transcript (Ctrl+Alt+K) empties the main buffer and pushes an empty finalText +
            // empty interim. Treat a fully-empty push as a reset so the panel-side log clears in lockstep
            // with the main buffer rather than retaining stale history.
            if (next.finalText.length === 0 && next.interimText.length === 0) {
                finalLogRef.current = '';
                setFinalLog('');

                return;
            }

            // Accumulate genuinely-new finalized content into the full-session log (overlap-dedup).
            const reconciled = reconcileFinalLog(finalLogRef.current, next.finalText);
            if (reconciled !== finalLogRef.current) {
                finalLogRef.current = reconciled;
                setFinalLog(reconciled);
            }
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

    // Keep the newest transcript text in view as the log/interim grows — but only while the user hasn't
    // scrolled up to read earlier history (stickToBottomRef). Now that the panel keeps the full session,
    // this follow + the visible scrollbar (overflow-y:auto in CSS) let the user scroll back through it.
    useEffect(() => {
        const element = transcriptRef.current;
        if (element !== null && stickToBottomRef.current) {
            element.scrollTop = element.scrollHeight;
        }
    }, [finalLog, interimText]);

    return (
        <section className="transcript-panel" data-testid="card-transcript-panel" data-active={activePanel === 'transcript'} data-connection-state={connectionState}>
            {/* Corner active-panel indicator mirroring the AI/Code panels: highlights when Q/A is the
                focus-cycle target (Ctrl+Alt+F). Pure view of the main-owned activePanel flag. */}
            <span className="transcript-panel__active-indicator" data-testid="icon-active-panel-transcript" data-active-panel={activePanel}>
                {PANEL_LABEL.transcript}
            </span>
            <h2 className="transcript-panel__title">{PANEL_LABEL.transcript}</h2>
            <div className="transcript-panel__body" data-testid="card-transcript" ref={transcriptRef}>
                <span className="transcript-panel__final" data-testid="cell-transcript-final">
                    {finalLog}
                </span>{' '}
                <span className="transcript-panel__interim" data-testid="cell-transcript-interim">
                    {interimText}
                </span>
            </div>
        </section>
    );
}
