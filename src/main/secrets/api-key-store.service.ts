import { safeStorage } from 'electron';
import Store from 'electron-store';

/**
 * The electron-store keys under which the two API-key ciphertexts persist. ONLY the base64
 * ciphertext is ever stored — never the plaintext key (T-06-03). These are DISTINCT from the
 * Phase 1 placeholder's `secretCiphertext` key (placeholder-secret.service.ts), which is unrelated
 * and left untouched. The store file lives under `userData` (outside the repo), so nothing secret
 * is ever committed.
 */
const DEEPGRAM_KEY_CIPHERTEXT = 'deepgramKeyCiphertext';
const ANTHROPIC_KEY_CIPHERTEXT = 'anthropicKeyCiphertext';

/** The backing-store shape for the two key ciphertexts. */
interface IApiKeyStoreShape {
    deepgramKeyCiphertext?: string;
    anthropicKeyCiphertext?: string;
}

/**
 * Encrypt-at-rest store for the two user-supplied API keys (Deepgram + Anthropic), generalizing the
 * Phase 1 single-placeholder round-trip (placeholder-secret.service.ts) to two real keys. Each key is
 * encrypted with the OS-backed `safeStorage` (DPAPI on Windows) and persisted as base64 ciphertext via
 * electron-store; decryption happens in the MAIN PROCESS ONLY and the plaintext key is never logged,
 * never returned over IPC, and never persisted in the clear (T-06-02, T-06-03).
 *
 * Presence is surfaced to the renderer as a boolean only ({@link hasDeepgram}/{@link hasAnthropic});
 * the decrypted key ({@link getDeepgram}/{@link getAnthropic}) is consumed in main only, at boot
 * (resolveApiKey precedence, D-08) and on live re-key (06-04).
 *
 * Every operation is guarded by `safeStorage.isEncryptionAvailable()`, which on Windows only returns
 * true AFTER the `ready` event (Pitfall 2). When encryption is unavailable, saves are a silent no-op
 * and reads return `undefined`.
 *
 * @remarks
 * The IDEXX `@singleton()` decorator is NOT applicable here: the Electron main process has no TSyringe
 * DI container. This service is instantiated exactly once in `index.ts` and treated as a singleton by
 * convention (mirroring {@link HotkeyRegistrarService}).
 */
export class ApiKeyStoreService {
    private readonly store = new Store<IApiKeyStoreShape>();

    /**
     * Encrypts and persists the Deepgram key as base64 ciphertext. No-op when OS-backed encryption is
     * unavailable (pre-`ready`, Pitfall 2). The plaintext is never logged or persisted in the clear.
     *
     * @param plaintext - The raw Deepgram API key to encrypt at rest.
     */
    public saveDeepgram(plaintext: string): void {
        this.save(DEEPGRAM_KEY_CIPHERTEXT, plaintext);
    }

    /**
     * Encrypts and persists the Anthropic key as base64 ciphertext. No-op when OS-backed encryption is
     * unavailable (pre-`ready`, Pitfall 2). The plaintext is never logged or persisted in the clear.
     *
     * @param plaintext - The raw Anthropic API key to encrypt at rest.
     */
    public saveAnthropic(plaintext: string): void {
        this.save(ANTHROPIC_KEY_CIPHERTEXT, plaintext);
    }

    /**
     * Decrypts and returns the persisted Deepgram key. MAIN-PROCESS ONLY — the result must never cross
     * IPC. Returns `undefined` when no key is stored or encryption is unavailable.
     *
     * @returns The decrypted Deepgram key, or `undefined`.
     */
    public getDeepgram(): string | undefined {
        return this.get(DEEPGRAM_KEY_CIPHERTEXT);
    }

    /**
     * Decrypts and returns the persisted Anthropic key. MAIN-PROCESS ONLY — the result must never cross
     * IPC. Returns `undefined` when no key is stored or encryption is unavailable.
     *
     * @returns The decrypted Anthropic key, or `undefined`.
     */
    public getAnthropic(): string | undefined {
        return this.get(ANTHROPIC_KEY_CIPHERTEXT);
    }

    /**
     * @returns `true` when a Deepgram key ciphertext is persisted (presence only — safe to send over IPC).
     */
    public hasDeepgram(): boolean {
        return this.store.get(DEEPGRAM_KEY_CIPHERTEXT) !== undefined;
    }

    /**
     * @returns `true` when an Anthropic key ciphertext is persisted (presence only — safe to send over IPC).
     */
    public hasAnthropic(): boolean {
        return this.store.get(ANTHROPIC_KEY_CIPHERTEXT) !== undefined;
    }

    /**
     * Encrypts `plaintext` and stores ONLY the base64 ciphertext under `storeKey`. No-op when OS-backed
     * encryption is unavailable. The plaintext is never logged.
     */
    private save(storeKey: keyof IApiKeyStoreShape, plaintext: string): void {
        if (!safeStorage.isEncryptionAvailable()) {
            return;
        }

        const ciphertext: Buffer = safeStorage.encryptString(plaintext);
        this.store.set(storeKey, ciphertext.toString('base64'));
    }

    /**
     * Reads and decrypts the persisted base64 ciphertext under `storeKey`, in MAIN ONLY. Returns
     * `undefined` when no key is stored or encryption is unavailable.
     */
    private get(storeKey: keyof IApiKeyStoreShape): string | undefined {
        if (!safeStorage.isEncryptionAvailable()) {
            return undefined;
        }

        const persisted = this.store.get(storeKey);
        if (persisted === undefined) {
            return undefined;
        }

        return safeStorage.decryptString(Buffer.from(persisted, 'base64'));
    }
}
