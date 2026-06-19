import { useEffect, useRef, useState, type JSX } from 'react';

/**
 * The AI mode that produced an entry (D-03 header label). Declared locally because the renderer is
 * bundled separately from the preload; structurally mirrors `AiMode` in main/preload.
 */
type AiMode = 'answer' | 'talking-points' | 'code-challenge';

/**
 * The read-only AI push event received over the `window.jedi.onAi` bridge (Phase 5, AI-04). Declared
 * locally for the same reason as {@link AiMode}; structurally mirrors `IAiPushEvent` in main/preload.
 */
type IAiPushEvent =
    | { type: 'thinking'; requestId: number; id: string; mode: AiMode; at: number }
    | { type: 'delta'; requestId: number; id: string; text: string }
    | { type: 'done'; requestId: number; id: string; text: string }
    | { type: 'error'; requestId: number; id: string; text: string }
    | { type: 'cancelled'; requestId: number; id: string }
    | { type: 'empty'; requestId: number; id: string; mode: AiMode; at: number; text: string }
    // D-02: the clear-AI hotkey empties the panel — no entry id (it resets the whole list). Mirrors the
    // `cleared` variant declared identically in main/preload (Phase 5; full snapshot reconciliation in 05-03).
    | { type: 'cleared' };

/** The inline lifecycle state of a rendered entry (D-04). */
type AiEntryState = 'thinking' | 'streaming' | 'done' | 'error' | 'cancelled' | 'empty';

/** A single rendered AI panel entry — the renderer's local mirror of a main-owned history entry (D-02). */
interface IAiPanelEntry {
    id: string;
    mode: AiMode;
    text: string;
    state: AiEntryState;
    at: number;
}

/** The human-readable mode header label (D-03). */
const MODE_LABEL: Record<AiMode, string> = {
    answer: 'Answer',
    'talking-points': 'Talking points',
    'code-challenge': 'Code challenge',
};

/**
 * Formats the D-03 relative-time header from an entry's capture timestamp. Coarse by design — the
 * overlay is a glanceable assist, not a precise clock.
 *
 * @param at - The entry's epoch-ms capture time (from main's injected clock).
 * @param nowMs - The current epoch-ms time.
 * @returns A short relative string like `now`, `3s ago`, `2m ago`.
 */
function formatRelativeTime(at: number, nowMs: number): string {
    const deltaSeconds = Math.max(0, Math.round((nowMs - at) / 1000));
    if (deltaSeconds < 1) {
        return 'now';
    }
    if (deltaSeconds < 60) {
        return `${deltaSeconds}s ago`;
    }

    return `${Math.floor(deltaSeconds / 60)}m ago`;
}

/**
 * Reduces an incoming {@link IAiPushEvent} into the local entry list. A `thinking`/`empty` event
 * starts a new entry; `delta` appends streamed text to the matching in-progress entry; the terminal
 * `done`/`error`/`cancelled` events set the final text + state. Entries are keyed by `id` so a stale
 * stream (already superseded) cannot resurrect an entry — main's request-id guard means only the
 * active stream's events arrive for the newest entry.
 *
 * @param entries - The current entry list.
 * @param event - The incoming AI push event.
 * @returns The next entry list.
 */
function reduceEntries(entries: IAiPanelEntry[], event: IAiPushEvent): IAiPanelEntry[] {
    switch (event.type) {
        case 'thinking':
            // D-08: code-challenge entries belong to the dedicated VisionPanel, not the AI panel. Skipping
            // the start here means this panel never creates a code-challenge entry, so the later
            // delta/done/error/cancelled (keyed by that id) are no-ops in the `.map` branches below.
            if (event.mode === 'code-challenge') {
                return entries;
            }

            return [...entries, { id: event.id, mode: event.mode, text: '', state: 'thinking', at: event.at }];
        case 'empty':
            if (event.mode === 'code-challenge') {
                return entries;
            }

            return [...entries, { id: event.id, mode: event.mode, text: event.text, state: 'empty', at: event.at }];
        case 'delta':
            return entries.map((entry) => (entry.id === event.id ? { ...entry, text: event.text, state: 'streaming' } : entry));
        case 'done':
            return entries.map((entry) => (entry.id === event.id ? { ...entry, text: event.text, state: 'done' } : entry));
        case 'error':
            return entries.map((entry) => (entry.id === event.id ? { ...entry, text: event.text, state: 'error' } : entry));
        case 'cancelled':
            return entries.map((entry) => (entry.id === event.id ? { ...entry, state: 'cancelled' } : entry));
        case 'cleared':
            // D-02: the clear-AI hotkey resets the whole panel to empty. Main owns the authoritative
            // history (it called AiHistory.clear()); the renderer mirrors that by dropping every entry.
            return [];
        default:
            return entries;
    }
}

/**
 * Renders the body of a single entry per its inline state (D-04): `thinking…` until the first token,
 * the streamed text while streaming/done, `AI error: <reason>` on failure, and `(cancelled)` on abort.
 *
 * @param entry - The entry to render.
 * @returns The entry body text.
 */
function renderEntryBody(entry: IAiPanelEntry): string {
    switch (entry.state) {
        case 'thinking':
            return 'thinking…';
        case 'cancelled':
            return '(cancelled)';
        default:
            // streaming / done / error / empty all render their accumulated text (error text already
            // carries the sanitized `AI error: <reason>`; empty carries the D-11 placeholder).
            return entry.text;
    }
}

/**
 * The always-on AI panel (D-01).
 *
 * A NEW content surface, rendered as a sibling of `DebugHud` in `App` and NOT gated on the
 * `hudVisible` flag — it stays visible regardless of the Ctrl+Alt+H HUD toggle (D-01). It subscribes
 * to the read-only `window.jedi.onAi` channel, maintains a bounded local mirror of the entry list,
 * appends streamed `delta`s to the in-progress entry, and reconciles to the terminal state on
 * done/error/cancelled (Pitfall 4). Each entry shows a small header (mode label + relative time, D-03)
 * and its inline state (thinking…/streaming/error/cancelled, D-04). It reuses the DebugHud
 * `stickToBottomRef` auto-follow pattern so the newest streaming entry stays in view while leaving the
 * user free to scroll up. The renderer is a pure view: it never controls AI state (IN-01).
 *
 * @returns The AI panel element (always rendered — never returns null on a flag, D-01).
 */
export function AiPanel(): JSX.Element {
    const [entries, setEntries] = useState<IAiPanelEntry[]>([]);
    const [nowMs, setNowMs] = useState<number>(() => Date.now());
    // The corner active-panel indicator (D-08) reads off the pushed flag; default 'ai' before the first
    // status push (matching main's launch default) so the indicator renders correctly on launch.
    const [activePanel, setActivePanel] = useState<'transcript' | 'ai' | 'vision'>('ai');
    const listRef = useRef<HTMLDivElement | null>(null);
    // While the user has scrolled up via hotkey, auto-stick is paused so a new streaming entry doesn't
    // yank them back to the bottom mid-read. Scrolling back to the bottom re-arms the live follow.
    const stickToBottomRef = useRef<boolean>(true);
    // The scroll subscription is wired once (empty-deps useEffect), so it would close over a stale
    // `activePanel`. Mirror the latest flag into a ref so the handler reads the live value and only
    // scrolls the AI panel when the AI panel is the active panel (D-08 routing).
    const activePanelRef = useRef<'transcript' | 'ai' | 'vision'>('ai');

    useEffect(() => {
        const offAi = window.jedi?.onAi((event: IAiPushEvent) => {
            setEntries((current) => reduceEntries(current, event));
        });

        // Track the main-owned active-panel flag so the corner indicator reflects it and the shared
        // scroll channel routes correctly (D-08). The renderer is a pure view of this pushed flag.
        const offStatus = window.jedi?.onStatus((status) => {
            activePanelRef.current = status.activePanel;
            setActivePanel(status.activePanel);
        });

        // Hotkey-driven scroll. The single Ctrl+Alt+PgUp/PgDn channel is shared with the HUD transcript,
        // so we only act when the AI panel is the active panel (D-08) — otherwise the HUD handles it.
        // Mirrors the debug-hud scroll step + stick-to-bottom re-arm so a long answer is fully readable.
        const offScroll = window.jedi?.onScrollTranscript((direction) => {
            if (activePanelRef.current !== 'ai') {
                return;
            }

            const element = listRef.current;
            if (element === null) {
                return;
            }

            const lineStep = 3 * 18;
            element.scrollTop += direction === 'down' ? lineStep : -lineStep;
            stickToBottomRef.current = element.scrollTop + element.clientHeight >= element.scrollHeight - 4;
        });

        // Refresh the relative-time headers (D-03) on a coarse cadence so "now -> 3s ago" advances
        // without a per-frame timer. The overlay is glanceable; 1s resolution is ample.
        const tick = window.setInterval(() => setNowMs(Date.now()), 1000);

        return (): void => {
            offAi?.();
            offStatus?.();
            offScroll?.();
            window.clearInterval(tick);
        };
    }, []);

    // Keep the newest entry in view as text streams in — but only while the user hasn't scrolled up
    // (stickToBottomRef), mirroring the DebugHud transcript follow/pause behavior (D-03).
    useEffect(() => {
        const element = listRef.current;
        if (element !== null && stickToBottomRef.current) {
            element.scrollTop = element.scrollHeight;
        }
    }, [entries]);

    return (
        <section className="ai-panel" data-testid="card-ai-panel">
            {/* Corner active-panel indicator (D-08): shows which panel the shared scroll chord targets.
                A pure view of the main-owned activePanel flag; Ctrl+Alt+F flips it in main. */}
            <span className="ai-panel__active-indicator" data-testid="icon-active-panel" data-active-panel={activePanel}>
                {activePanel === 'ai' ? 'AI' : 'Transcript'}
            </span>
            <h2 className="ai-panel__title">AI</h2>
            <div className="ai-panel__entries" data-testid="list-ai-entries" ref={listRef}>
                {entries.map((entry) => (
                    <article className={`ai-panel__entry ai-panel__entry--${entry.state}`} key={entry.id} data-testid={`row-ai-entry-${entry.id}`}>
                        <header className="ai-panel__entry-header">
                            <span className="ai-panel__entry-mode">{MODE_LABEL[entry.mode]}</span>
                            <span className="ai-panel__entry-time">{formatRelativeTime(entry.at, nowMs)}</span>
                        </header>
                        <p className="ai-panel__entry-body">{renderEntryBody(entry)}</p>
                    </article>
                ))}
            </div>
        </section>
    );
}
