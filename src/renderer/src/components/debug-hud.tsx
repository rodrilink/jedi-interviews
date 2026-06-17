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
}

/**
 * A small, toggleable debug HUD that renders the overlay's proof-of-life status:
 * Electron version, content-protection state (ON/OFF), and window position (D-07).
 *
 * It subscribes to the read-only `window.jedi.onStatus` channel — the only IPC surface
 * in Phase 1, carrying no secrets (D-05). The HUD is built to survive into later phases
 * (D-08): it accepts a `visible` prop and defaults to shown in Phase 1 (no hotkeys yet);
 * Phase 2 wires the toggle once the global hotkey layer exists.
 *
 * @param props - Component props.
 * @param props.visible - Whether the HUD is shown. Defaults to `true` for Phase 1.
 * @returns The HUD element, or `null` when hidden.
 */
export function DebugHud({ visible = true }: { visible?: boolean }): JSX.Element | null {
    const [status, setStatus] = useState<IOverlayStatus | null>(null);

    useEffect(() => {
        window.jedi?.onStatus((next: IOverlayStatus) => setStatus(next));
    }, []);

    if (!visible) {
        return null;
    }

    const contentProtectionLabel = status ? (status.contentProtection ? 'ON' : 'OFF') : '—';
    const positionLabel = status ? `${status.position.x}, ${status.position.y}` : '—';
    const electronVersionLabel = status?.electronVersion ?? '—';

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
            </dl>
        </section>
    );
}
