import { describe, expect, it } from 'vitest';
import { selectSourceForDisplay } from './screenshot.service';

/**
 * Unit coverage for the pure source-select helper (AI-03/D-01, Pattern 2).
 *
 * `selectSourceForDisplay` is the only pure/unit-testable seam in the capture service: `display.id` is
 * a number, `DesktopCapturerSource.display_id` is a string, so the match compares `String(display.id)`.
 * The full `captureForOverlay` path touches `screen`/`desktopCapturer` (Electron main APIs) and is
 * exercised at the manual gate, not here.
 */

/** The minimal `DesktopCapturerSource` shape the helper reads (id + display_id). */
interface IFakeSource {
    id: string;
    display_id: string;
}

describe('selectSourceForDisplay', () => {
    it('should return the source whose display_id matches String(displayId)', () => {
        // Arrange
        const sources: IFakeSource[] = [
            { id: 'screen:1', display_id: '111' },
            { id: 'screen:2', display_id: '222' },
        ];

        // Act
        const selected = selectSourceForDisplay(sources as unknown as Electron.DesktopCapturerSource[], 222);

        // Assert
        expect(selected?.id).toBe('screen:2');
    });

    it('should fall back to the first source when no display_id matches', () => {
        // Arrange
        const sources: IFakeSource[] = [
            { id: 'screen:1', display_id: '111' },
            { id: 'screen:2', display_id: '222' },
        ];

        // Act
        const selected = selectSourceForDisplay(sources as unknown as Electron.DesktopCapturerSource[], 999);

        // Assert
        expect(selected?.id).toBe('screen:1');
    });

    it('should return undefined for an empty sources array', () => {
        // Arrange
        const sources: IFakeSource[] = [];

        // Act
        const selected = selectSourceForDisplay(sources as unknown as Electron.DesktopCapturerSource[], 111);

        // Assert
        expect(selected).toBeUndefined();
    });
});
