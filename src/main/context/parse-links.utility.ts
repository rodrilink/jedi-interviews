/**
 * Parses a Links textarea into a clean list of entries (CTX-01 / Pitfall 6).
 *
 * Splits on `\n` or `\r\n` (CRLF-safe), trims each line, and drops empty / whitespace-only lines.
 * Pure, idempotent, and empty-input safe — `parseLinks('')` is `[]`. Round-trips with
 * `links.join('\n')`, which the four-field editor uses to render the textarea (06-03).
 *
 * @param text - The raw textarea value (one link per line).
 * @returns The trimmed, non-empty link entries in order; `[]` for empty input.
 */
export function parseLinks(text: string): string[] {
    return text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
}
