import { contextBridge, ipcRenderer } from 'electron';

/**
 * The session-context DTO exchanged over the `settings:get-context`/`settings:save-context` channels.
 *
 * Declared LOCALLY (rather than imported from main) because the sandboxed preload is bundled
 * separately and must not reach into the main process. It mirrors `ISessionContextDto` in main; the
 * context channels are declared here in 06-01 but fully wired (the editor UI + persistence) in
 * 06-03/06-04.
 */
export interface ISessionContextDto {
    id: string;
    notes: string;
    ticketText: string;
    repoSnippets: string;
    links: string[];
    name?: string;
    source?: string;
    createdAt?: string;
}

/**
 * The dedicated, SCOPED two-way IPC surface for the settings window (D-04).
 *
 * This is the deliberate exception to the overlay's strictly one-way main->renderer boundary: the
 * settings window hosts text inputs and must read/write persisted data, so it uses `ipcRenderer.invoke`
 * (request-response). The overlay's `window.jedi` namespace is UNTOUCHED — this surface is exposed only
 * in the settings window, under a separate bridge name (`settingsApi`).
 *
 * SECURITY (D-04 / T-06-01): `getKeys` returns PRESENCE BOOLEANS ONLY — the decrypted key NEVER crosses
 * IPC outbound. `saveKeys` carries plaintext renderer->main ONCE (inbound), where main encrypts it via
 * safeStorage. This preload never reads or decrypts a stored key; that happens in main only.
 */
const settingsApi = {
    /**
     * Reads which API keys are currently saved. Returns presence booleans only — never the key values.
     *
     * @returns A promise resolving to `{ deepgram, anthropic }` presence flags.
     */
    getKeys(): Promise<{ deepgram: boolean; anthropic: boolean }> {
        return ipcRenderer.invoke('settings:get-keys');
    },

    /**
     * Saves one or both API keys. Each present non-empty key is encrypted at rest in the main process.
     * The plaintext crosses IPC inbound only and is never returned, logged, or persisted in the clear.
     *
     * @param keys - The keys to save; omit a field to leave that key unchanged.
     * @returns A promise that resolves once the save completes.
     */
    saveKeys(keys: { deepgram?: string; anthropic?: string }): Promise<void> {
        return ipcRenderer.invoke('settings:save-keys', keys);
    },

    /**
     * Reads the active session context (notes, ticket text, repo snippets, links). Declared in 06-01;
     * the persistence behind it is wired in 06-03/06-04.
     *
     * @returns A promise resolving to the active session-context DTO.
     */
    getContext(): Promise<ISessionContextDto> {
        return ipcRenderer.invoke('settings:get-context');
    },

    /**
     * Persists the session context. Declared in 06-01; the persistence behind it is wired in 06-03/06-04.
     *
     * @param dto - The session-context DTO to persist.
     * @returns A promise that resolves once the save completes.
     */
    saveContext(dto: ISessionContextDto): Promise<void> {
        return ipcRenderer.invoke('settings:save-context', dto);
    },
};

export type SettingsApi = typeof settingsApi;

if (process.contextIsolated) {
    contextBridge.exposeInMainWorld('settingsApi', settingsApi);
} else {
    // contextIsolation is mandatory for this app (D-04/T-06-04); fail loudly if it is ever disabled.
    throw new Error('contextIsolation must be enabled — refusing to expose the settingsApi bridge without it.');
}
