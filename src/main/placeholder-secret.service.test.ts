import { beforeEach, describe, expect, it, vi } from 'vitest';

// In-memory stand-in for the electron-store backing file. The test asserts on what
// actually lands in the store so we can prove ciphertext-only persistence (T-01-03-I2).
const storeBacking: Record<string, string> = {};

const mockIsEncryptionAvailable = vi.fn<() => boolean>();
const mockEncryptString = vi.fn<(plain: string) => Buffer>();
const mockDecryptString = vi.fn<(cipher: Buffer) => string>();

vi.mock('electron', () => ({
    safeStorage: {
        isEncryptionAvailable: (): boolean => mockIsEncryptionAvailable(),
        encryptString: (plain: string): Buffer => mockEncryptString(plain),
        decryptString: (cipher: Buffer): string => mockDecryptString(cipher),
    },
}));

vi.mock('electron-store', () => ({
    default: class {
        public set(key: string, value: string): void {
            storeBacking[key] = value;
        }

        public get(key: string): string | undefined {
            return storeBacking[key];
        }
    },
}));

// The fake placeholder the service round-trips. Must match the service's hardcoded value.
const PLACEHOLDER = 'jedi-placeholder-secret';

describe('placeholder-secret.service', () => {
    beforeEach(() => {
        // Arrange (shared): reset mocks and the in-memory store between tests.
        vi.clearAllMocks();
        for (const key of Object.keys(storeBacking)) {
            delete storeBacking[key];
        }

        // Default DPAPI fake: reversible base64-prefixed transform so the round-trip is exercised end to end.
        mockEncryptString.mockImplementation((plain: string): Buffer => Buffer.from(`enc:${plain}`, 'utf8'));
        mockDecryptString.mockImplementation((cipher: Buffer): string => cipher.toString('utf8').replace(/^enc:/, ''));
    });

    it('should return true when the safeStorage round-trip reproduces the placeholder', async () => {
        // Arrange
        mockIsEncryptionAvailable.mockReturnValue(true);
        const { proveSecretBoundary } = await import('./placeholder-secret.service');

        // Act
        const result: boolean = proveSecretBoundary();

        // Assert
        expect(result).toBe(true);
        expect(mockIsEncryptionAvailable).toHaveBeenCalled();
        expect(mockEncryptString).toHaveBeenCalledWith(PLACEHOLDER);
        expect(mockDecryptString).toHaveBeenCalled();
    });

    it('should persist only base64 ciphertext, never the plaintext placeholder', async () => {
        // Arrange
        mockIsEncryptionAvailable.mockReturnValue(true);
        const { proveSecretBoundary } = await import('./placeholder-secret.service');

        // Act
        proveSecretBoundary();

        // Assert
        const persistedValues: string[] = Object.values(storeBacking);
        expect(persistedValues.length).toBeGreaterThan(0);
        for (const persisted of persistedValues) {
            expect(persisted).not.toContain(PLACEHOLDER);
            // Round-trips cleanly through base64 → it is the encoded ciphertext, not raw text.
            expect(Buffer.from(persisted, 'base64').toString('base64')).toBe(persisted);
        }
    });

    it('should return false (not throw) when encryption is unavailable', async () => {
        // Arrange
        mockIsEncryptionAvailable.mockReturnValue(false);
        const { proveSecretBoundary } = await import('./placeholder-secret.service');

        // Act
        const result: boolean = proveSecretBoundary();

        // Assert
        expect(result).toBe(false);
        expect(mockEncryptString).not.toHaveBeenCalled();
    });
});
