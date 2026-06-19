import { useEffect, useRef, useState, type JSX } from 'react';
import { formatUptime } from './format-uptime.utility';
import { PANEL_LABEL, type ActivePanel } from './panel-labels';

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
    /** Which panel is the active keyboard-scroll target (D-08; Phase 7 D-09 adds 'vision'). Main-owned; declared identically in main and preload. */
    activePanel: ActivePanel;
    /** Whether the overlay is interactive (click-through disabled for drag-select, quick fix 260619-mcv). Main-owned; declared identically in main and preload. */
    overlayInteractive: boolean;
}

/**
 * The read-only transcript payload received over the `window.jedi.onTranscript` bridge (D-04). The HUD
 * header reads only the coarse connection state + live audio level from it (the transcript TEXT now lives
 * in the dedicated {@link import('./transcript-panel').TranscriptPanel}). Mirrors `IOverlayTranscript`.
 */
interface IOverlayTranscript {
    finalText: string;
    interimText: string;
    /** The coarse STT connection state surfaced read-only in the header (TRN-03). */
    connectionState: string;
    /** The live capture RMS level in `[0, 1]`, computed in main, rendered as the header audio meter. */
    audioLevel: number;
}

/**
 * The compact hotkey cheat-sheet shown in the HUD header (D-13) so it doubles as an on-screen
 * reference while the user learns the chords. These are the finalized default chords —
 * 02-03 conflict-tested them against Teams/Zoom/VS Code and shipped the suggested set
 * unchanged (no collisions). The clear-transcript chord (Ctrl+Alt+K, D-07) is appended here;
 * its on-machine conflict re-check is scheduled for 04-04's manual verify (fall back to
 * Ctrl+Alt+X if it collides). The Phase 5 focus-cycle chord (Ctrl+Alt+F, D-08) is appended too; its
 * on-machine conflict re-check is scheduled for 05-03's manual verify (fall back to a reserved letter
 * if it collides). See `02-HOTKEY-CONFLICT-TEST.md` / `05-HOTKEY-CONFLICT-TEST.md`.
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
 * The full-width debug HUD HEADER bar across the TOP of the overlay (quick fix 260619-mcv, layout
 * refactor B). It renders the overlay's proof-of-life status (Electron version, content-protection,
 * window position, hotkey status), the live STT connection state + audio meter, the active-panel
 * readout, the Mouse interaction-mode indicator, and a compact hotkey cheat-sheet. The live transcript
 * TEXT is no longer here — it moved to the dedicated {@link import('./transcript-panel').TranscriptPanel}
 * Q/A column below this header.
 *
 * It subscribes to the read-only `window.jedi.onStatus` and `window.jedi.onTranscript` channels
 * (D-05/D-04), capturing each subscription's unsubscribe function and calling both on cleanup so no
 * listener leaks under React Strict Mode (WR-03). HUD content visibility is owned by the main process
 * (D-14/D-15): once status arrives, the header renders strictly according to the pushed `hudVisible`
 * flag — the HUD-toggle chord flips it in main. The `visible` prop is only a fallback default used
 * before the first status push. The renderer is a pure view: it never controls window or HUD state.
 *
 * @param props - Component props.
 * @param props.visible - Fallback HUD visibility before the first status push. Defaults to `true`.
 * @returns The HUD header element, or `null` when hidden.
 */
export function DebugHud({ visible = true }: { visible?: boolean }): JSX.Element | null {
    const [status, setStatus] = useState<IOverlayStatus | null>(null);
    const [transcript, setTranscript] = useState<IOverlayTranscript | null>(null);
    // The overlay launch instant, captured once on mount and fixed for the component's life so the
    // "Session started" row stays static and the uptime counts up from a stable origin.
    const sessionStartRef = useRef<number>(Date.now());
    // Drives the once-per-second uptime re-render, mirroring the ai-panel relative-time tick pattern.
    const [nowMs, setNowMs] = useState<number>(() => Date.now());

    useEffect(() => {
        const offStatus = window.jedi?.onStatus((next: IOverlayStatus) => setStatus(next));
        const offTranscript = window.jedi?.onTranscript((next: IOverlayTranscript) => setTranscript(next));

        // Advance the uptime row on a coarse 1s cadence (mirrors ai-panel) — ample for a glanceable
        // session-health readout and avoids a per-frame timer.
        const tick = window.setInterval(() => setNowMs(Date.now()), 1000);

        return (): void => {
            offStatus?.();
            offTranscript?.();
            window.clearInterval(tick);
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
    // Canonical panel display name via the single PANEL_LABEL map (locked decision A) — no scrambled labels.
    const activePanelLabel = status ? PANEL_LABEL[status.activePanel] : '—';
    // Whether interaction mode (click-through OFF for drag-select) is engaged (quick fix 260619-mcv).
    // Surfaced so the user can see whether Ctrl+Alt+M is currently ON; also the diagnostic for the chord.
    const mouseToggleLabel = status ? (status.overlayInteractive ? 'ON' : 'OFF') : '—';
    // Native Date for the renderer wall-clock display is deliberate (presentation, not business
    // logic — Luxon stays in main per project standards). Read once from the mount ref so it is static.
    const sessionStartedLabel = new Date(sessionStartRef.current).toLocaleString();
    const uptimeLabel = formatUptime(nowMs - sessionStartRef.current);
    const connectionStateLabel = transcript?.connectionState ?? '—';
    // Map the RMS level (0..1, typically peaking ~0.3 for speech) to a 0..100% bar width, with a gain
    // so normal speech fills a useful range rather than a sliver. Clamped to [0, 100].
    const audioLevel = transcript?.audioLevel ?? 0;
    const meterPercent = Math.max(0, Math.min(100, Math.round(audioLevel * 250)));

    return (
        <header className="debug-hud" data-testid="card-debug-hud">
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
                <dt className="debug-hud__key">Audio</dt>
                <dd className="debug-hud__value" data-testid="cell-audio-meter">
                    <span className="debug-hud__meter" data-testid="meter-audio-level">
                        <span className="debug-hud__meter-fill" style={{ width: `${meterPercent}%` }} />
                    </span>
                </dd>
                <dt className="debug-hud__key">Active panel</dt>
                <dd className="debug-hud__value" data-testid="cell-active-panel">
                    {activePanelLabel}
                </dd>
                <dt className="debug-hud__key">Mouse</dt>
                <dd className="debug-hud__value" data-testid="cell-mouse-toggle" data-mouse-toggle={mouseToggleLabel === 'ON'}>
                    {mouseToggleLabel}
                </dd>
                <dt className="debug-hud__key">Session started</dt>
                <dd className="debug-hud__value" data-testid="cell-session-started">
                    {sessionStartedLabel}
                </dd>
                <dt className="debug-hud__key">Uptime</dt>
                <dd className="debug-hud__value" data-testid="cell-uptime">
                    {uptimeLabel}
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
        </header>
    );
}
