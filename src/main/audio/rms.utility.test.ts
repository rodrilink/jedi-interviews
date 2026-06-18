import { describe, expect, it } from 'vitest';
import { computeRmsInt16 } from './rms.utility';

describe('computeRmsInt16', () => {
    it('should return 0 for an empty frame', () => {
        // Arrange
        const frame = new Int16Array(0);

        // Act
        const rms: number = computeRmsInt16(frame);

        // Assert
        expect(rms).toBe(0);
    });

    it('should return 0 for an all-silent frame', () => {
        // Arrange
        const frame = new Int16Array([0, 0, 0, 0]);

        // Act
        const rms: number = computeRmsInt16(frame);

        // Assert
        expect(rms).toBe(0);
    });

    it('should approach 1 for a full-scale frame', () => {
        // Arrange
        const frame = new Int16Array([32767, -32768, 32767, -32768]);

        // Act
        const rms: number = computeRmsInt16(frame);

        // Assert
        expect(rms).toBeGreaterThan(0.99);
        expect(rms).toBeLessThanOrEqual(1);
    });

    it('should compute a mid-level value for a half-scale constant frame', () => {
        // Arrange
        const frame = new Int16Array([16384, 16384, 16384]);

        // Act
        const rms: number = computeRmsInt16(frame);

        // Assert
        expect(rms).toBeCloseTo(0.5, 2);
    });
});
