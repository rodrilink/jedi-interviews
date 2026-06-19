import { describe, expect, it } from 'vitest';
import { formatUptime } from './format-uptime.utility';

describe('formatUptime', () => {
    it('should render 00:00 for zero elapsed milliseconds', () => {
        // Arrange
        const elapsedMs = 0;

        // Act
        const label: string = formatUptime(elapsedMs);

        // Assert
        expect(label).toBe('00:00');
    });

    it('should zero-pad seconds under a minute', () => {
        // Arrange
        const elapsedMs = 5_000;

        // Act
        const label: string = formatUptime(elapsedMs);

        // Assert
        expect(label).toBe('00:05');
    });

    it('should render MM:SS once past a minute', () => {
        // Arrange
        const elapsedMs = 65_000;

        // Act
        const label: string = formatUptime(elapsedMs);

        // Assert
        expect(label).toBe('01:05');
    });

    it('should widen to HH:MM:SS at exactly one hour', () => {
        // Arrange
        const elapsedMs = 3_600_000;

        // Act
        const label: string = formatUptime(elapsedMs);

        // Assert
        expect(label).toBe('01:00:00');
    });

    it('should render HH:MM:SS past an hour', () => {
        // Arrange
        const elapsedMs = 3_661_000;

        // Act
        const label: string = formatUptime(elapsedMs);

        // Assert
        expect(label).toBe('01:01:01');
    });

    it('should clamp negative input to zero', () => {
        // Arrange
        const elapsedMs = -5_000;

        // Act
        const label: string = formatUptime(elapsedMs);

        // Assert
        expect(label).toBe('00:00');
    });
});
