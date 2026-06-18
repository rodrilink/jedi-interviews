import { readFileSync } from 'fs';

/**
 * Parses the contents of a `.env`-style file into a key/value map. Pure and side-effect free so it
 * is unit-testable without touching the filesystem or `process.env`. Supports `KEY=value` pairs,
 * `#` comment lines, blank lines, surrounding-quote stripping, and values that contain `=`.
 *
 * @param contents - The raw text of a `.env` file.
 * @returns A map of the parsed environment keys to their values.
 */
export function parseDotenv(contents: string): Record<string, string> {
    const result: Record<string, string> = {};

    for (const rawLine of contents.split('\n')) {
        const line = rawLine.trim();
        if (line.length === 0 || line.startsWith('#')) {
            continue;
        }

        const equalsIndex = line.indexOf('=');
        if (equalsIndex === -1) {
            continue;
        }

        const key = line.slice(0, equalsIndex).trim();
        if (key.length === 0) {
            continue;
        }

        let value = line.slice(equalsIndex + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }

        result[key] = value;
    }

    return result;
}

/**
 * Loads a `.env` file from disk and applies its keys to `process.env` WITHOUT overwriting any value
 * already present in the real environment (a shell-exported var always wins). Main-process only;
 * the loaded values (e.g. the Deepgram key, D-08) are never logged. A missing or unreadable file is
 * a no-op so production launches — which inject secrets via the real environment — are unaffected.
 *
 * @param path - Absolute path to the `.env` file.
 */
export function loadDotenvFile(path: string): void {
    let contents: string;
    try {
        contents = readFileSync(path, 'utf8');
    } catch {
        // No .env in this environment (e.g. packaged build). Secrets come from the real env instead.
        return;
    }

    const parsed = parseDotenv(contents);
    for (const [key, value] of Object.entries(parsed)) {
        if (process.env[key] === undefined) {
            process.env[key] = value;
        }
    }
}
