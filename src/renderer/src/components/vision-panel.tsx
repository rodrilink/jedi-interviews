import { useEffect, useRef, useState, type JSX } from 'react';

/**
 * The AI mode that produced an entry. Declared locally because the renderer is bundled separately from
 * the preload; structurally mirrors `AiMode` in main/preload (widened to include `'code-challenge'`).
 */
type AiMode = 'answer' | 'talking-points' | 'code-challenge';

/**
 * The read-only AI push event received over the `window.jedi.onAi` bridge (Phase 5, AI-04; Phase 7
 * vision rides the SAME channel). Declared locally for the same reason as {@link AiMode}; structurally
 * mirrors `IAiPushEvent` in main/preload.
 */
type IAiPushEvent =
    | { type: 'thinking'; requestId: number; id: string; mode: AiMode; at: number }
    | { type: 'delta'; requestId: number; id: string; text: string }
    | { type: 'done'; requestId: number; id: string; text: string }
    | { type: 'error'; requestId: number; id: string; text: string }
    | { type: 'cancelled'; requestId: number; id: string }
    | { type: 'empty'; requestId: number; id: string; mode: AiMode; at: number; text: string }
    | { type: 'cleared' };

/** The inline lifecycle state of a rendered entry (D-04, reused from the AI panel). */
type VisionEntryState = 'thinking' | 'streaming' | 'done' | 'error' | 'cancelled';

/** A single rendered vision-panel entry — the renderer's local mirror of a main-owned code-challenge entry. */
interface IVisionPanelEntry {
    id: string;
    text: string;
    state: VisionEntryState;
    at: number;
}

/**
 * Hard ceiling on retained vision entries (D-09). Code solutions are long, so this is smaller than the
 * AI panel's bound — a handful of prior solutions is ample scrollback while keeping the panel light.
 */
const MAX_VISION_ENTRIES = 10;

/**
 * Formats the relative-time header from an entry's capture timestamp. Coarse by design — the overlay is
 * a glanceable assist, not a precise clock. (Mirrors the AI panel's `formatRelativeTime`.)
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
 * Reduces an incoming {@link IAiPushEvent} into the local entry list, keeping ONLY code-challenge
 * entries (D-08 — the answer/talking-points entries belong to the AI panel). A code-challenge
 * `thinking` starts a new entry; `delta` appends streamed text to the matching in-progress entry; the
 * terminal `done`/`error`/`cancelled` set the final text + state. Entries are keyed by `id`, so a
 * terminal/delta whose id this panel never created (i.e. an answer/talking-points entry) is a no-op.
 * The list is bounded to {@link MAX_VISION_ENTRIES} (D-09).
 *
 * @param entries - The current entry list.
 * @param event - The incoming AI push event.
 * @returns The next entry list.
 */
function reduceEntries(entries: IVisionPanelEntry[], event: IAiPushEvent): IVisionPanelEntry[] {
    switch (event.type) {
        case 'thinking': {
            // D-08: only code-challenge entries live here; answer/talking-points belong to the AI panel.
            if (event.mode !== 'code-challenge') {
                return entries;
            }

            const next = [...entries, { id: event.id, text: '', state: 'thinking' as VisionEntryState, at: event.at }];

            // D-09 bounded history: drop the oldest while over the entry ceiling.
            return next.length > MAX_VISION_ENTRIES ? next.slice(next.length - MAX_VISION_ENTRIES) : next;
        }
        case 'delta':
            return entries.map((entry) => (entry.id === event.id ? { ...entry, text: event.text, state: 'streaming' } : entry));
        case 'done':
            return entries.map((entry) => (entry.id === event.id ? { ...entry, text: event.text, state: 'done' } : entry));
        case 'error':
            return entries.map((entry) => (entry.id === event.id ? { ...entry, text: event.text, state: 'error' } : entry));
        case 'cancelled':
            return entries.map((entry) => (entry.id === event.id ? { ...entry, state: 'cancelled' } : entry));
        case 'cleared':
            // The clear-AI hotkey resets every AI surface, including the dedicated vision panel.
            return [];
        default:
            return entries;
    }
}

/**
 * Renders the body of a single entry per its inline state (D-04): `thinking…` until the first token,
 * the streamed code while streaming/done, `AI error: <reason>` on failure, `(cancelled)` on abort.
 *
 * @param entry - The entry to render.
 * @returns The entry body text.
 */
function renderEntryBody(entry: IVisionPanelEntry): string {
    switch (entry.state) {
        case 'thinking':
            return 'thinking…';
        case 'cancelled':
            return '(cancelled)';
        default:
            return entry.text;
    }
}

/**
 * The dedicated streaming vision panel (D-08/D-09/D-10).
 *
 * A pure one-way view (IN-01): it subscribes to the read-only `window.jedi.onAi` channel and keeps a
 * bounded local mirror of ONLY the code-challenge entries (D-08 — separate from the answer/talking-points
 * AI panel because code solutions are long and read better isolated). It reuses the AI panel's streaming /
 * thinking… / error / cancelled inline-state render and the `stickToBottomRef` follow/pause + focused-panel
 * scroll model, guarding on the `'vision'` active panel (D-09 — the third focus-cycle target). It takes
 * over the AI-panel region only while it is the active panel OR is streaming/has content (D-10), so the
 * Phase-5 layout is otherwise unchanged. Streamed code renders as ESCAPED text inside `<pre>` — React
 * escapes by default and raw-HTML injection is never used (Security Domain / T-7-XSS).
 *
 * @returns The vision panel element, or `null` when it is neither active nor holding content (D-10).
 */
export function VisionPanel(): JSX.Element | null {
    const [entries, setEntries] = useState<IVisionPanelEntry[]>([]);
    const [nowMs, setNowMs] = useState<number>(() => Date.now());
    const [activePanel, setActivePanel] = useState<'transcript' | 'ai' | 'vision'>('ai');
    const listRef = useRef<HTMLDivElement | null>(null);
    const stickToBottomRef = useRef<boolean>(true);
    // The scroll subscription is wired once (empty-deps useEffect), so mirror the live active-panel flag
    // into a ref so the handler only scrolls the vision panel when vision is the active panel (D-09).
    const activePanelRef = useRef<'transcript' | 'ai' | 'vision'>('ai');

    useEffect(() => {
        const offAi = window.jedi?.onAi((event: IAiPushEvent) => {
            setEntries((current) => reduceEntries(current, event));
        });

        const offStatus = window.jedi?.onStatus((status) => {
            activePanelRef.current = status.activePanel;
            setActivePanel(status.activePanel);
        });

        // Hotkey-driven scroll. The single Ctrl+Alt+PgUp/PgDn channel is shared across all three panels,
        // so we only act when the vision panel is the active panel (D-09) — otherwise another panel handles it.
        const offScroll = window.jedi?.onScrollTranscript((direction) => {
            if (activePanelRef.current !== 'vision') {
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

        const tick = window.setInterval(() => setNowMs(Date.now()), 1000);

        return (): void => {
            offAi?.();
            offStatus?.();
            offScroll?.();
            window.clearInterval(tick);
        };
    }, []);

    // Follow the newest entry as code streams in, but only while the user hasn't scrolled up (D-03 model).
    useEffect(() => {
        const element = listRef.current;
        if (element !== null && stickToBottomRef.current) {
            element.scrollTop = element.scrollHeight;
        }
    }, [entries]);

    // D-10: take over the AI-panel region only when vision is the active panel OR is streaming / has
    // content. Otherwise render nothing so the Phase-5 layout (HUD + AI panel) is unchanged.
    const isStreaming = entries.some((entry) => entry.state === 'thinking' || entry.state === 'streaming');
    const shouldShow = activePanel === 'vision' || isStreaming || entries.length > 0;
    if (!shouldShow) {
        return null;
    }

    return (
        <section className="vision-panel" data-testid="card-vision-panel" data-active={activePanel === 'vision'}>
            <span className="vision-panel__active-indicator" data-testid="icon-active-panel-vision" data-active-panel={activePanel}>
                {activePanel === 'vision' ? 'Vision' : 'AI'}
            </span>
            <h2 className="vision-panel__title">Code challenge</h2>
            <div className="vision-panel__entries" data-testid="list-vision-entries" ref={listRef}>
                {entries.map((entry) => (
                    <article className={`vision-panel__entry vision-panel__entry--${entry.state}`} key={entry.id} data-testid={`row-vision-entry-${entry.id}`}>
                        <header className="vision-panel__entry-header">
                            <span className="vision-panel__entry-mode">Code challenge</span>
                            <span className="vision-panel__entry-time">{formatRelativeTime(entry.at, nowMs)}</span>
                        </header>
                        {/* Render streamed code as ESCAPED text inside <pre> — React escapes by default and
                            no raw-HTML injection is used (Security Domain / T-7-XSS). */}
                        <pre className="vision-panel__entry-body">{renderEntryBody(entry)}</pre>
                    </article>
                ))}
            </div>
        </section>
    );
}
