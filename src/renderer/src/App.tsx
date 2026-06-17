import { useEffect, type JSX } from 'react';
import { DebugHud } from './components/debug-hud';
import { AudioCaptureService } from './services/audio-capture.service';
import './assets/hud.css';

/**
 * The overlay renderer root.
 *
 * It renders the toggleable debug HUD (D-07/D-08), which subscribes to the read-only
 * `window.jedi.onStatus` channel and displays the live Electron version, content-protection
 * state, window position, hotkey status, RMS audio level, and a hotkey cheat-sheet over a
 * transparent background. HUD-content visibility is owned by the main process and toggled by
 * the HUD-toggle chord (D-14/D-15): `DebugHud` honors the pushed `hudVisible` flag, so `App`
 * passes no prop and lets the component fall back to shown-on-launch (D-12) until the first
 * status push arrives.
 *
 * It also auto-starts system-audio loopback capture on mount with no user gesture and no
 * picker (D-03), feeding the worklet-computed RMS level to the HUD `Audio:` row, and tears the
 * capture down on unmount.
 *
 * @returns The overlay root element.
 */
export function App(): JSX.Element {
    useEffect(() => {
        const captureService = new AudioCaptureService();

        // Auto-start with no user gesture (D-03); log rather than throw so a capture failure
        // never blanks the HUD — the gate is judged by the Audio: row reading ~0 on-machine.
        void captureService.start().catch((error: unknown) => {
            console.error('Audio loopback capture failed to start', error);
        });

        return () => {
            void captureService.stop();
        };
    }, []);

    return <DebugHud />;
}
