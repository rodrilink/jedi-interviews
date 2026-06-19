/**
 * Formats an elapsed-milliseconds duration as a glanceable session timer string: `MM:SS` below one
 * hour, widening to `HH:MM:SS` at/over one hour. Every segment is zero-padded to two digits.
 *
 * Native `Math`/`Number` are used here deliberately: this is presentation-only wall-clock formatting
 * in the renderer (a count-up display of a local elapsed duration), not business or persisted date
 * logic. Luxon is reserved for main-process/business date handling per project standards — pulling it
 * into the renderer for a trivial duration format would add weight with no correctness benefit.
 *
 * Negative input is clamped to 0 so transient clock skew can never render a negative timer.
 *
 * @param elapsedMs - Milliseconds elapsed since the session started.
 * @returns `MM:SS` under one hour, `HH:MM:SS` at/over one hour.
 */
export function formatUptime(elapsedMs: number): string {
    const totalSeconds = Math.floor(Math.max(0, elapsedMs) / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    const pad2 = (value: number): string => value.toString().padStart(2, '0');

    if (hours > 0) {
        return `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}`;
    }

    return `${pad2(minutes)}:${pad2(seconds)}`;
}
