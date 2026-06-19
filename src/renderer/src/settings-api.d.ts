/**
 * Renderer-side typing for the scoped two-way `window.settingsApi` bridge (D-04, exposed by
 * src/preload/settings.ts). Declared LOCALLY here — mirroring the structural shape of the preload's
 * `SettingsApi` type — because the sandboxed preload bundle is not part of the renderer's typecheck
 * graph (tsconfig.web includes only `src/renderer/src/**` + the overlay `src/preload/index.d.ts`).
 *
 * SECURITY (T-06-10): `getKeys` returns PRESENCE BOOLEANS ONLY — never a key value. The Keys tab UI
 * is therefore structurally unable to render a saved key string.
 */

/** The four editable grounding fields plus persistence metadata (mirrors `ISessionContextDto` in main). */
export interface ISettingsSessionContextDto {
    id: string;
    notes: string;
    ticketText: string;
    repoSnippets: string;
    links: string[];
    name?: string;
    source?: string;
    createdAt?: string;
}

/** The presence flags returned by `getKeys` — booleans only, never the key values. */
export interface IApiKeyPresence {
    deepgram: boolean;
    anthropic: boolean;
}

/**
 * The shape the Context tab sends on save.
 *
 * LINK PARSING AUTHORITY (D-05, plan decision): `links` is the RAW newline-joined textarea string —
 * NOT a pre-split array. Parsing into a clean `string[]` is authoritative in MAIN, via the tested
 * `parseLinks` utility (06-02), inside the `settings:save-context` handler (wired in 06-04). The
 * renderer never parses links; it only ever joins `links[]` with `'\n'` for editing on pre-fill. This
 * keeps the CRLF-safe parse in exactly one place.
 */
export interface ISaveContextInput {
    notes?: string;
    ticketText?: string;
    repoSnippets?: string;
    /** Raw textarea text, one URL per line — parsed by `parseLinks` in main (NOT pre-split). */
    links?: string;
}

/** The two-way settings bridge contract (structurally mirrors the preload's `SettingsApi`). */
export interface ISettingsApi {
    getKeys(): Promise<IApiKeyPresence>;
    saveKeys(keys: { deepgram?: string; anthropic?: string }): Promise<void>;
    getContext(): Promise<ISettingsSessionContextDto | undefined>;
    saveContext(input: ISaveContextInput): Promise<void>;
}

declare global {
    interface Window {
        /** The scoped two-way settings bridge (D-04). Present only in the settings window. */
        settingsApi: ISettingsApi;
    }
}
