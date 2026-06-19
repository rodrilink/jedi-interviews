import { type JSX } from 'react';

/**
 * The compact hotkey cheat-sheet (D-13) shown as its own reference column. These are the finalized
 * default chords — 02-03 conflict-tested them against Teams/Zoom/VS Code (no collisions) — plus the
 * later additions (clear-transcript K, focus-cycle F, copy-code Y, toggle-mouse M). The on-machine
 * conflict re-check for the newer chords is tracked in the quick-task verification.
 */
const HOTKEY_CHEAT_SHEET: ReadonlyArray<{ id: string; label: string; chord: string }> = [
    { id: 'showhide', label: 'Show / Hide', chord: 'Ctrl+Alt+J' },
    { id: 'move', label: 'Move', chord: 'Ctrl+Alt+Arrows' },
    { id: 'opacity', label: 'Opacity', chord: 'Ctrl+Alt+[ / ]' },
    { id: 'hud', label: 'Toggle HUD', chord: 'Ctrl+Alt+H' },
    { id: 'clear', label: 'Clear transcript', chord: 'Ctrl+Alt+K' },
    { id: 'focus', label: 'Focus panel', chord: 'Ctrl+Alt+F' },
    { id: 'scroll', label: 'Scroll active panel', chord: 'Ctrl+Alt+PgUp / PgDn' },
    { id: 'answer', label: 'Answer', chord: 'Ctrl+Alt+A' },
    { id: 'talking-points', label: 'Talking points', chord: 'Ctrl+Alt+T' },
    { id: 'clear-ai', label: 'Clear AI', chord: 'Ctrl+Alt+G' },
    { id: 'copy-code', label: 'Copy code', chord: 'Ctrl+Alt+Y' },
    { id: 'toggle-mouse', label: 'Toggle mouse', chord: 'Ctrl+Alt+M' },
    { id: 'quit', label: 'Quit', chord: 'Ctrl+Alt+Q' },
];

/**
 * The Commands reference panel — the FOURTH, narrowest column to the right of the Code panel (quick fix
 * 260619-mcv item 1). The hotkey cheat-sheet used to be crammed into the HUD header; it now lives here as
 * a compact, scannable reference list so the header is decluttered.
 *
 * It is a STATIC reference (no live subscriptions, no scroll content to route), so it deliberately does
 * NOT participate in the Ctrl+Alt+F focus cycle (the cycle stays Q/A → AI → Code) and shows no focus
 * highlight. Keyboard-only app: this panel is glanceable, not interactive.
 *
 * @returns The Commands reference panel element.
 */
export function CommandsPanel(): JSX.Element {
    return (
        <section className="commands-panel" data-testid="card-commands-panel">
            <h2 className="commands-panel__title">Commands</h2>
            <dl className="commands-panel__list">
                {HOTKEY_CHEAT_SHEET.map((entry) => (
                    <div className="commands-panel__row" key={entry.id} data-testid={`row-command-${entry.id}`}>
                        <dt className="commands-panel__label">{entry.label}</dt>
                        <dd className="commands-panel__chord">{entry.chord}</dd>
                    </div>
                ))}
            </dl>
        </section>
    );
}
