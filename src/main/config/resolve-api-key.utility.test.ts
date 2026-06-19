import { describe, expect, it } from 'vitest';
import { resolveApiKey } from './resolve-api-key.utility';

describe('resolveApiKey', () => {
    it('should return the saved key when both saved and env are present', () => {
        // Arrange
        const saved = 'sk-saved';
        const env = 'sk-env';

        // Act
        const resolved: string = resolveApiKey(saved, env);

        // Assert
        expect(resolved).toBe('sk-saved');
    });

    it('should fall back to env when saved is undefined', () => {
        // Arrange
        const env = 'sk-env';

        // Act
        const resolved: string = resolveApiKey(undefined, env);

        // Assert
        expect(resolved).toBe('sk-env');
    });

    it('should fall back to env when saved is an empty string', () => {
        // Arrange
        const env = 'sk-env';

        // Act
        const resolved: string = resolveApiKey('', env);

        // Assert
        expect(resolved).toBe('sk-env');
    });

    it('should return an empty string when both saved and env are undefined', () => {
        // Arrange
        const saved = undefined;
        const env = undefined;

        // Act
        const resolved: string = resolveApiKey(saved, env);

        // Assert
        expect(resolved).toBe('');
    });

    it('should return the saved key when env is undefined', () => {
        // Arrange
        const saved = 'sk-saved';

        // Act
        const resolved: string = resolveApiKey(saved, undefined);

        // Assert
        expect(resolved).toBe('sk-saved');
    });
});
