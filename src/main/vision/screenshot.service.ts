import { desktopCapturer, screen, type BrowserWindow } from 'electron';

import { toBase64Png } from './downscale.utility';

/**
 * Selects the `DesktopCapturerSource` for a given display id (D-01, Pattern 2).
 *
 * `Display.id` is a NUMBER but `DesktopCapturerSource.display_id` is a STRING, so the match compares
 * `String(displayId)`. Falls back to the first source when no source reports the matching display id
 * (some drivers leave `display_id` empty), and returns `undefined` for an empty source list so the
 * caller can surface the fault rather than indexing into nothing. Pure and side-effect free.
 *
 * @param sources - The screen sources returned by `desktopCapturer.getSources`.
 * @param displayId - The numeric `Display.id` of the display to capture.
 * @returns The matching source, the first source as a fallback, or `undefined` when `sources` is empty.
 */
export function selectSourceForDisplay(sources: Electron.DesktopCapturerSource[], displayId: number): Electron.DesktopCapturerSource | undefined {
    return sources.find((source) => source.display_id === String(displayId)) ?? sources[0];
}

/**
 * The main-process screenshot capture service for the code-challenge vision mode (AI-03, D-01/D-05).
 *
 * It captures the monitor the OVERLAY sits on — resolved via `screen.getDisplayMatching` from the
 * overlay's bounds (D-01), so capture is deterministic and needs no native foreground lookup while the
 * meeting app holds focus and the overlay never does — grabs that one display at its real pixel
 * resolution via `desktopCapturer` (scaled by `scaleFactor` so a HiDPI capture stays crisp, Pitfall 3),
 * then downscales + base64-encodes it entirely in main via {@link toBase64Png} (D-05/IN-01: no renderer
 * canvas, no IPC of image bytes).
 *
 * Report-don't-throw: a capture fault (no source found) is surfaced as a thrown error the orchestrator
 * catches and renders as an inline error entry — it must never crash main (mirrors the audio-capture
 * fault discipline at `index.ts:221-224`). The overlay excludes itself from the capture via the EXISTING
 * `setContentProtection(true)` (D-02), verified at the manual gate in 07-02 — no hide/exclude logic here.
 *
 * @remarks
 * The Electron main process has no TSyringe DI container, so this is not an `@singleton()`; it is
 * instantiated once in `index.ts` and treated as a singleton by convention. Its dependencies are
 * supplied by the caller (the overlay window is passed per capture), mirroring the other main-process
 * services in this app.
 */
export class ScreenshotService {
    /**
     * Captures the monitor the overlay is parked on and returns a downscaled, prefix-free base64 PNG.
     *
     * Resolves the overlay's display (D-01), captures it at real pixels (Pitfall 3), selects the
     * matching source (D-01/Pattern 2), and hands the thumbnail to {@link toBase64Png} (≤1568px long
     * edge, no `data:` prefix — D-05/Pitfall 2). Throws when no screen source is available so the
     * orchestrator can surface the fault inline rather than the service crashing main.
     *
     * @param overlay - The overlay window whose monitor is captured (its bounds drive `getDisplayMatching`).
     * @returns The downscaled base64 PNG and its media type.
     * @throws When `desktopCapturer` returns no usable screen source for the overlay's display.
     */
    public async captureForOverlay(overlay: BrowserWindow): Promise<{ base64: string; mediaType: string }> {
        const display = screen.getDisplayMatching(overlay.getBounds());
        const { width, height } = display.size;
        const scaleFactor = display.scaleFactor;

        const sources = await desktopCapturer.getSources({
            types: ['screen'],
            thumbnailSize: {
                width: Math.round(width * scaleFactor),
                height: Math.round(height * scaleFactor),
            },
        });

        const source = selectSourceForDisplay(sources, display.id);
        if (source === undefined) {
            throw new Error('No screen source available to capture the code challenge.');
        }

        return toBase64Png(source.thumbnail);
    }
}
