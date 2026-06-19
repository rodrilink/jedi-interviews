/**
 * Resolves the effective API key from the two possible sources, applying the D-08 precedence: a
 * non-empty key saved via `safeStorage` always wins, otherwise the `process.env` / `.env` fallback
 * is used, otherwise the empty string (which surfaces the existing missing-key state downstream).
 *
 * This is the DELIBERATE inversion of `loadDotenvFile`'s "a real shell-exported env var always wins"
 * rule (load-dotenv.utility.ts) — but ONLY for the two user-supplied API keys, and ONLY here in the
 * resolution layer. `loadDotenvFile` itself is unchanged: it still never overwrites a real env var.
 * Keeping the inversion confined to this pure utility means a user who saves a key in the settings
 * window overrides a stale `.env` value at boot without mutating `process.env` or the dotenv loader.
 *
 * Pure and side-effect free so it is unit-testable without touching `safeStorage` or `process.env`.
 *
 * @param savedDecrypted - The decrypted key from the safeStorage store, or `undefined`/`''` if none.
 * @param envValue - The `process.env` fallback value, or `undefined` if unset.
 * @returns The resolved key: the non-empty saved key, else the env value, else `''`.
 */
export function resolveApiKey(savedDecrypted: string | undefined, envValue: string | undefined): string {
    if (savedDecrypted !== undefined && savedDecrypted.length > 0) {
        return savedDecrypted;
    }

    return envValue ?? '';
}
