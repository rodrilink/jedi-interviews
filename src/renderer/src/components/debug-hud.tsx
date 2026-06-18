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
 * The read-only transcript payload received over the `window.jedi.onTranscript` bridge (D-04).
 * Structurally mirrors `IOverlayTranscript` in main/preload; declared locally for the same reason.
 */
interface IOverlayTranscript {
    /** The space-joined finalized transcript text in the current time window. */
    finalText: string;
    /** The current interim (partial) transcript, rendered visually distinct from final (D-04). */
    interimText: string;
    /** The coarse STT connection state surfaced on the overlay (TRN-03). */
    connectionState: string;
}

/**
 * The compact hotkey cheat-sheet shown in the HUD (D-13) so it doubles as an on-screen
 * reference while the user learns the chords. These are the finalized default chords —
 * 02-03 conflict-tested them against Teams/Zoom/VS Code and shipped the suggested set
 * unchanged (no collisions). The clear-transcript chord (Ctrl+Alt+K, D-07) is appended here;
 * its on-machine conflict re-check is scheduled for 04-04's manual verify (fall back to
 * Ctrl+Alt+X if it collides). See `02-HOTKEY-CONFLICT-TEST.md`.
 */
const HOTKEY_CHEAT_SHEET: ReadonlyArray<{ id: string; label: string; chord: string }> = [
    { id: 'showhide', label: 'Show / Hide', chord: 'Ctrl+Alt+J' },
    { id: 'move', label: 'Move', chord: 'Ctrl+Alt+Arrows' },
    { id: 'opacity', label: 'Opacity', chord: 'Ctrl+Alt+[ / ]' },
    { id: 'hud', label: 'Toggle HUD', chord: 'Ctrl+Alt+H' },
    { id: 'clear', label: 'Clear transcript', chord: 'Ctrl+Alt+K' },
    { id: 'quit', label: 'Quit', chord: 'Ctrl+Alt+Q' },
];

/**
 * A small, toggleable debug HUD that renders the overlay's proof-of-life status (Electron version,
 * content-protection state, window position, hotkey status) plus the live STT transcript and
 * connection state (D-04).
 *
 * It subscribes to the read-only `window.jedi.onStatus` and `window.jedi.onTranscript` channels
 * (D-05/D-04), capturing each subscription's unsubscribe function and calling both on cleanup so no
 * listener leaks under React Strict Mode (WR-03). HUD content visibility is owned by the main process
 * (D-14/D-15): once status arrives, the component renders strictly according to the pushed
 * `hudVisible` flag — the HUD-toggle chord flips it in main, which also hides the transcript with it
 * (D-05). The `visible` prop is only a fallback default used before the first status push. The
 * renderer is a pure view: it never controls window or HUD state (no renderer->main channel, IN-01).
 *
 * @param props - Component props.
 * @param props.visible - Fallback HUD visibility before the first status push. Defaults to `true`.
 * @returns The HUD element, or `null` when hidden.
 */
export function DebugHud({ visible = true }: { visible?: boolean }): JSX.Element | null {
    const [status, setStatus] = useState<IOverlayStatus | null>(null);
    const [transcript, setTranscript] = useState<IOverlayTranscript | null>(null);

    useEffect(() => {
        const offStatus = window.jedi?.onStatus((next: IOverlayStatus) => setStatus(next));
        const offTranscript = window.jedi?.onTranscript((next: IOverlayTranscript) => setTranscript(next));

        return (): void => {
            offStatus?.();
            offTranscript?.();
        };
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
    const connectionStateLabel = transcript?.connectionState ?? '—';
    const finalTextLabel = transcript?.finalText ?? '';
    const interimTextLabel = transcript?.interimText ?? '';

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
                <dt className="debug-hud__key">Connection</dt>
                <dd className="debug-hud__value" data-testid="cell-connection-state">
                    {connectionStateLabel}
                </dd>
            </dl>
            <p className="debug-hud__transcript" data-testid="card-transcript">
                <span className="debug-hud__transcript-final" data-testid="cell-transcript-final">
                    {finalTextLabel}
                </span>{' '}
                <span className="debug-hud__interim" data-testid="cell-transcript-interim">
                    {interimTextLabel}
                </span>
            </p>
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
