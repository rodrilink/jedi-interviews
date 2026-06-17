import { describe, expect, it } from 'vitest';
import { computeRms } from './rms.utility';

describe('rms.utility', () => {
    it('should return 0 for an all-zero (silent) frame', () => {
        // Arrange
        const frame: Float32Array = new Float32Array([0, 0, 0, 0]);

        // Act
        const rms: number = computeRms(frame);

        // Assert
        expect(rms).toBe(0);
    });

    it('should return 1 for a full-scale frame of all ones', () => {
        // Arrange
        const frame: Float32Array = new Float32Array([1, 1, 1, 1]);

        // Act
        const rms: number = computeRms(frame);

        // Assert
        expect(rms).toBe(1);
    });

    it('should return 0 for an empty frame without dividing by zero', () => {
        // Arrange
        const frame: Float32Array = new Float32Array([]);

        // Act
        const rms: number = computeRms(frame);

        // Assert
        expect(rms).toBe(0);
    });

    it('should return sqrt(mean of squares) for a known mixed frame', () => {
        // Arrange
        const frame: Float32Array = new Float32Array([0.5, -0.5, 0.5, -0.5]);
        const expected: number = 0.5;

        // Act
        const rms: number = computeRms(frame);

        // Assert
        expect(rms).toBeCloseTo(expected, 10);
    });
});
