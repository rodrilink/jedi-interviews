import { useEffect, useState, type JSX } from 'react';

/**
 * The read-only, non-secret status payload received from the main process over the
 * `window.jedi.onStatus` bridge. Structurally mirrors `IOverlayStatus` in main/preload;
 * declared locally because the renderer is bundled separately from the preload.
 */
interface IOverlayStatus {
    electronVersion: string;
    contentProtection: boolean;
    position: { x: number; y: number };
    /** Startup hotkey-registration outcome (D-06). Declared identically in main and preload. */
    hotkeys: { active: string; failed: string[] };
    /** Whether the HUD content is shown (D-14/D-15). Main-owned; declared identically in main and preload. */
    hudVisible: boolean;
}

/**
 * The compact hotkey cheat-sheet shown in the HUD (D-13) so it doubles as an on-screen
 * reference while the user learns the chords. These are the finalized default chords —
 * 02-03 conflict-tested them against Teams/Zoom/VS Code and shipped the suggested set
 * unchanged (no collisions). See `02-HOTKEY-CONFLICT-TEST.md`.
 */
const HOTKEY_CHEAT_SHEET: ReadonlyArray<{ id: string; label: string; chord: string }> = [
    { id: 'showhide', label: 'Show / Hide', chord: 'Ctrl+Alt+J' },
    { id: 'move', label: 'Move', chord: 'Ctrl+Alt+Arrows' },
    { id: 'opacity', label: 'Opacity', chord: 'Ctrl+Alt+[ / ]' },
    { id: 'hud', label: 'Toggle HUD', chord: 'Ctrl+Alt+H' },
    { id: 'quit', label: 'Quit', chord: 'Ctrl+Alt+Q' },
];

/**
 * A small, toggleable debug HUD that renders the overlay's proof-of-life status:
 * Electron version, content-protection state (ON/OFF), and window position (D-07).
 *
 * It subscribes to the read-only `window.jedi.onStatus` channel (D-05). HUD content
 * visibility is owned by the main process (D-14/D-15): once status arrives, the component
 * renders strictly according to the pushed `hudVisible` flag — the HUD-toggle chord flips it
 * in main. The `visible` prop is only a fallback default used before the first status push (or
 * if the bridge is unavailable); it never overrides the pushed flag. The renderer is a pure
 * view: it never controls window or HUD state (no renderer->main channel).
 *
 * @param props - Component props.
 * @param props.visible - Fallback HUD visibility before the first status push. Defaults to `true`.
 * @returns The HUD element, or `null` when hidden.
 */
export function DebugHud({ visible = true }: { visible?: boolean }): JSX.Element | null {
    const [status, setStatus] = useState<IOverlayStatus | null>(null);

    useEffect(() => {
        window.jedi?.onStatus((next: IOverlayStatus) => setStatus(next));
    }, []);

    // Main owns HUD-content visibility (D-15): honor the pushed flag once it arrives; before the
    // first push fall back to the prop default so the HUD shows on launch (D-12).
    const hudVisible: boolean = status ? status.hudVisible : visible;
    if (!hudVisible) {
        return null;
    }

    const contentProtectionLabel = status ? (status.contentProtection ? 'ON' : 'OFF') : '—';
    const positionLabel = status ? `${status.position.x}, ${status.position.y}` : '—';
    const electronVersionLabel = status?.electronVersion ?? '—';
    const hotkeyLabel = status ? (status.hotkeys.failed.length === 0 ? 'OK' : `${status.hotkeys.failed.length} failed`) : '—';

    return (
        <section className="debug-hud" data-testid="card-debug-hud">
            <h1 className="debug-hud__title">Jedi Interviews</h1>
            <dl className="debug-hud__grid">
                <dt className="debug-hud__key">Electron</dt>
                <dd className="debug-hud__value" data-testid="cell-electron-version">
                    {electronVersionLabel}
                </dd>
                <dt className="debug-hud__key">Content protection</dt>
                <dd className="debug-hud__value" data-testid="cell-content-protection">
                    {contentProtectionLabel}
                </dd>
                <dt className="debug-hud__key">Position</dt>
                <dd className="debug-hud__value" data-testid="cell-position">
                    {positionLabel}
                </dd>
                <dt className="debug-hud__key">Hotkeys</dt>
                <dd className="debug-hud__value" data-testid="cell-hotkey-status">
                    {hotkeyLabel}
                </dd>
            </dl>
            <dl className="debug-hud__grid debug-hud__cheatsheet" data-testid="card-hotkey-cheatsheet">
                {HOTKEY_CHEAT_SHEET.map((entry) => (
                    <div className="debug-hud__cheatsheet-row" key={entry.id} data-testid={`row-hotkey-${entry.id}`}>
                        <dt className="debug-hud__key">{entry.label}</dt>
                        <dd className="debug-hud__value">{entry.chord}</dd>
                    </div>
                ))}
            </dl>
        </section>
    );
}
