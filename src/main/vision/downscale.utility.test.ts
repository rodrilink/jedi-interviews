import { describe, expect, it } from 'vitest';
import { fitLongEdge, toBase64Png, VISION_MAX_LONG_EDGE } from './downscale.utility';

/**
 * Unit coverage for the pure downscale math (AI-03/D-05).
 *
 * {@link fitLongEdge} is pure: `(width, height, maxEdge)` -> `{ width, height }`. These tests assert
 * the only-if-larger contract (no upscale), proportional shrink preserving aspect ratio in both
 * orientations, the exact-boundary case, and that {@link toBase64Png} produces prefix-free base64
 * (NO `data:` substring — Pitfall 2).
 */
describe('downscale.utility', () => {
    describe('VISION_MAX_LONG_EDGE', () => {
        it('should be the locked 1568 app downscale target (D-05)', () => {
            // Arrange / Act / Assert
            expect(VISION_MAX_LONG_EDGE).toBe(1568);
        });
    });

    describe('fitLongEdge — only-if-larger', () => {
        it('should return the dimensions unchanged when the longest edge is below the max', () => {
            // Arrange
            const width = 800;
            const height = 600;

            // Act
            const result: { width: number; height: number } = fitLongEdge(width, height, 1568);

            // Assert
            expect(result).toEqual({ width: 800, height: 600 });
        });

        it('should NOT resize at the exact 1568 boundary', () => {
            // Arrange
            const width = 1568;
            const height = 900;

            // Act
            const result: { width: number; height: number } = fitLongEdge(width, height, 1568);

            // Assert
            expect(result).toEqual({ width: 1568, height: 900 });
        });
    });

    describe('fitLongEdge — proportional shrink', () => {
        it('should shrink a landscape image so the long edge equals the max, preserving aspect ratio', () => {
            // Arrange
            const width = 3136;
            const height = 1568;

            // Act
            const result: { width: number; height: number } = fitLongEdge(width, height, 1568);

            // Assert
            expect(result).toEqual({ width: 1568, height: 784 });
        });

        it('should shrink a portrait image so the long edge equals the max, preserving aspect ratio', () => {
            // Arrange
            const width = 1568;
            const height = 3136;

            // Act
            const result: { width: number; height: number } = fitLongEdge(width, height, 1568);

            // Assert
            expect(result).toEqual({ width: 784, height: 1568 });
        });
    });

    describe('toBase64Png — prefix-free base64 (Pitfall 2)', () => {
        it('should return base64 with no data: prefix and the png media type', () => {
            // Arrange — a fake NativeImage whose getSize is small (no resize) and toPNG yields known bytes.
            const fakeImage = {
                getSize: (): { width: number; height: number } => ({ width: 100, height: 80 }),
                toPNG: (): Buffer => Buffer.from('fake-png-bytes'),
                resize: (): never => {
                    throw new Error('resize must not be called for a sub-max image');
                },
            } as unknown as Electron.NativeImage;

            // Act
            const result: { base64: string; mediaType: string } = toBase64Png(fakeImage);

            // Assert
            expect(result.base64).not.toContain('data:');
            expect(result.base64).toBe(Buffer.from('fake-png-bytes').toString('base64'));
            expect(result.mediaType).toBe('image/png');
        });

        it('should resize via fitLongEdge only when the image exceeds the max long edge', () => {
            // Arrange — an oversized image; capture the resize args to assert the proportional target.
            let resizeArgs: { width: number; height: number } | undefined;
            const fakeImage = {
                getSize: (): { width: number; height: number } => ({ width: 3136, height: 1568 }),
                toPNG: (): Buffer => Buffer.from('original'),
                resize: (options: { width: number; height: number }): Electron.NativeImage => {
                    resizeArgs = options;

                    return {
                        toPNG: (): Buffer => Buffer.from('resized'),
                    } as unknown as Electron.NativeImage;
                },
            } as unknown as Electron.NativeImage;

            // Act
            const result: { base64: string; mediaType: string } = toBase64Png(fakeImage);

            // Assert
            expect(resizeArgs).toEqual({ width: 1568, height: 784 });
            expect(result.base64).toBe(Buffer.from('resized').toString('base64'));
            expect(result.base64).not.toContain('data:');
        });
    });
});
