/**
 * The main-owned, time-bounded rolling transcript buffer (TRN-04, D-06).
 *
 * It keeps only the last {@link WINDOW_MS} of finalized transcript and prunes older segments, so the
 * overlay shows recent conversation and Phase 5's AI can read a time-based recent span
 * ({@link TranscriptBuffer.recentSince}). The window aligns with Phase 5's ~60s span selection plus
 * headroom (D-06).
 *
 * Beyond the time window, two further *hard* memory ceilings guarantee the buffer can never grow
 * unbounded even if the injected clock misbehaves (stuck, frozen, or regressing): a maximum segment
 * count ({@link MAX_SEGMENTS}) and a maximum total character count ({@link MAX_TOTAL_CHARS}). These
 * three independent bounds together are the D-06 memory ceiling and the T-4-06 DoS mitigation.
 *
 * The buffer is pure in-memory state with an injected clock for deterministic tests; it performs no
 * IO and is never persisted (D-08: nothing in Phase 4 is persisted).
 */

/** A single finalized transcript segment with the epoch-ms timestamp it was committed at. */
export interface ITranscriptSegment {
    /** The finalized transcript text for this segment. */
    text: string;
    /** The epoch-ms time (from the injected clock) at which the segment was committed. */
    at: number;
}

/**
 * The rolling time window in milliseconds. Only finalized segments newer than `now() - WINDOW_MS`
 * are retained. Set to 90s: comfortably above Phase 5's ~60s recent-span read plus headroom (A7/D-06).
 */
export const WINDOW_MS = 90_000;

/**
 * Hard ceiling on the number of retained finalized segments. A regressing or frozen clock cannot
 * defeat the time window forever — this ceiling shifts out the oldest segments regardless of `at`.
 */
export const MAX_SEGMENTS = 400;

/**
 * Hard ceiling on the total character count across all retained finalized segments. The second
 * clock-independent memory bound: oldest segments are dropped until the total fits.
 */
export const MAX_TOTAL_CHARS = 20_000;

/**
 * A time-bounded rolling buffer of finalized transcript text plus one current interim string.
 *
 * Interim text is *replaced* on every update (never accumulated, per the RESEARCH anti-pattern) and
 * is cleared when a final segment is committed. Only finalized segments are retained and pruned.
 *
 * @remarks
 * The Electron main process has no TSyringe DI container, so this is not an `@singleton()`; it is
 * instantiated once in `index.ts` (04-04) and treated as a singleton by convention, mirroring
 * `HotkeyRegistrarService`.
 */
export class TranscriptBuffer {
    /** Retained finalized segments, oldest first. */
    private finals: ITranscriptSegment[] = [];

    /** The current (uncommitted) interim transcript; replaced on each update, cleared on commit. */
    private interim = '';

    /**
     * @param now - Clock returning the current time in epoch ms. Injected so prune-by-time and
     *   {@link recentSince} are deterministic in tests; defaults to {@link Date.now} in production.
     */
    public constructor(private readonly now: () => number = Date.now) {}

    /**
     * Commits a finalized transcript segment: records it with the current timestamp, clears the
     * current interim (a final supersedes the in-progress interim), and prunes to the bounds.
     *
     * @param text - The finalized transcript text to commit.
     */
    public appendFinal(text: string): void {
        this.finals.push({ text, at: this.now() });
        this.interim = '';
        this.prune();
    }

    /**
     * Replaces the current interim transcript. Interim text is never accumulated — each call
     * overwrites the previous interim so the overlay shows the latest partial result only.
     *
     * @param text - The latest interim (partial) transcript text.
     */
    public setInterim(text: string): void {
        this.interim = text;
    }

    /**
     * Empties the buffer entirely — both finalized segments and the current interim. Wired to the
     * clear-transcript hotkey (TRN-04, D-07) via the handler in `index.ts` (04-04).
     */
    public clear(): void {
        this.finals = [];
        this.interim = '';
    }

    /**
     * Returns the space-joined finalized text whose segments fall within the last `ms` milliseconds
     * (relative to the injected clock). Read by Phase 5's AI orchestrator for its recent-span input.
     *
     * @param ms - The look-back window in milliseconds.
     * @returns The space-joined finalized text within the window (empty string if none).
     */
    public recentSince(ms: number): string {
        const cutoff = this.now() - ms;

        return this.finals
            .filter((segment) => segment.at >= cutoff)
            .map((segment) => segment.text)
            .join(' ');
    }

    /**
     * Returns the renderable transcript snapshot for the overlay push (04-04 reads this).
     *
     * @returns The space-joined finalized text and the current interim text.
     */
    public renderable(): { finalText: string; interimText: string } {
        return {
            finalText: this.finals.map((segment) => segment.text).join(' '),
            interimText: this.interim,
        };
    }

    /**
     * Enforces the three independent hard bounds, in order: drop segments older than the time
     * window, then shift out the oldest while over the segment ceiling, then shift out the oldest
     * while over the total-char ceiling. The two count/char ceilings are clock-independent, so a
     * misbehaving clock cannot grow the buffer past them (T-4-06 mitigation).
     */
    private prune(): void {
        const cutoff = this.now() - WINDOW_MS;
        this.finals = this.finals.filter((segment) => segment.at >= cutoff);

        while (this.finals.length > MAX_SEGMENTS) {
            this.finals.shift();
        }

        let total = this.finals.reduce((sum, segment) => sum + segment.text.length, 0);
        while (total > MAX_TOTAL_CHARS && this.finals.length > 0) {
            const dropped = this.finals.shift() as ITranscriptSegment;
            total -= dropped.text.length;
        }
    }
}
