import { safeStorage } from 'electron';
import Store from 'electron-store';

/**
 * A clearly-FAKE placeholder secret. No real API key exists in Phase 1 (D-04); real keys
 * arrive in Phase 6. This value only exists to prove the DPAPI encrypt-at-rest plumbing.
 * It must never be a real credential and must never be logged or exposed (V7).
 */
const PLACEHOLDER = 'jedi-placeholder-secret';

/**
 * The single electron-store key under which the round-trip persists ONLY the base64
 * ciphertext (never the plaintext placeholder — T-01-03-I2). The store file lives under
 * `userData` (outside the repo), so nothing secret is ever committed.
 */
const CIPHERTEXT_STORE_KEY = 'secretCiphertext';

/** Backing store for the ciphertext. Keyed under {@link CIPHERTEXT_STORE_KEY}. */
const store = new Store<{ secretCiphertext?: string }>();

/**
 * Proves the API-key security plumbing end-to-end with the most basic possible test (D-04):
 * a main-process-only `safeStorage` (DPAPI) round-trip. It encrypts a hardcoded fake
 * placeholder, persists ONLY the base64 ciphertext via electron-store, reads it back,
 * decrypts it, and asserts the decrypted value equals the original placeholder.
 *
 * Runs entirely in the main process — nothing here is exposed over IPC/contextBridge (D-05),
 * and neither the plaintext placeholder nor the decrypted value is ever logged (V7).
 *
 * MUST be called after `app.whenReady()`: on Windows `safeStorage.isEncryptionAvailable()`
 * only returns true after the `ready` event (Pitfall 4).
 *
 * @returns `true` when the decrypted value strictly equals the original placeholder;
 *          `false` (without throwing) when OS-backed encryption is unavailable.
 */
export function proveSecretBoundary(): boolean {
    if (!safeStorage.isEncryptionAvailable()) {
        return false;
    }

    const ciphertext: Buffer = safeStorage.encryptString(PLACEHOLDER);
    store.set(CIPHERTEXT_STORE_KEY, ciphertext.toString('base64'));

    const persisted = store.get(CIPHERTEXT_STORE_KEY);
    if (persisted === undefined) {
        return false;
    }

    const decrypted: string = safeStorage.decryptString(Buffer.from(persisted, 'base64'));

    return decrypted === PLACEHOLDER;
}
