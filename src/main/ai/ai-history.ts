/**
 * The main-owned, bounded AI-entry history (D-02/D-03).
 *
 * It keeps the stacked list of AI panel entries (newest last) that the renderer renders as a pure
 * view. Two independent hard ceilings guarantee it can never grow unbounded — a maximum entry count
 * ({@link MAX_AI_ENTRIES}) and a maximum total character count ({@link MAX_AI_TOTAL_CHARS}) — exactly
 * mirroring the `TranscriptBuffer` bounded-buffer discipline so D-02's "bounded so it can never grow
 * unbounded" is enforced in ONE place (main), not in renderer React state.
 *
 * Each entry carries the `at` timestamp captured from the injected clock at append time; that
 * timestamp is the source the renderer turns into the D-03 relative-time header ("3s ago"). The
 * relative-time *string* formatting lives in the renderer; this module owns the testable timestamp.
 *
 * Pure in-memory state with an injected clock for deterministic tests; no IO, never persisted.
 */

import type { AiMode } from './ai-gateway.interface';

/**
 * The terminal state of an AI history entry. `done` = a completed answer; `error` = an inline
 * failure; `cancelled` = an aborted stream (D-06); `empty` = the D-11 empty-span placeholder.
 */
export type AiEntryKind = 'done' | 'error' | 'cancelled' | 'empty';

/** A single AI history entry — the unit the renderer stacks newest-at-bottom (D-02). */
export interface IAiHistoryEntry {
    /** Stable id (the orchestrator's monotonic request id rendered as a string), used as the row key. */
    id: string;
    /** Which mode produced the entry — drives the `Answer`/`Talking points` header label (D-03). */
    mode: AiMode;
    /** The entry text (the assembled answer, the error reason, or the empty-span placeholder). */
    text: string;
    /** The terminal kind of the entry. */
    kind: AiEntryKind;
    /** The epoch-ms time the entry was appended (from the injected clock) — the D-03 header source. */
    at: number;
}

/** The append payload: an entry without its `at`, which {@link AiHistory.append} stamps from the clock. */
export type AiHistoryAppend = Omit<IAiHistoryEntry, 'at'>;

/**
 * Hard ceiling on the number of retained AI entries. The oldest entries shift out first once the
 * count would exceed this. Planner-chosen grounded default (D-02): 50 entries is far more scrollback
 * than a single meeting needs while keeping the snapshot push cheap.
 */
export const MAX_AI_ENTRIES = 50;

/**
 * Hard ceiling on the total character count across all retained entries. The second clock-independent
 * memory bound (mirrors `TranscriptBuffer.MAX_TOTAL_CHARS`): oldest entries are dropped until the
 * total fits, so a few very long answers cannot grow the history past this.
 */
export const MAX_AI_TOTAL_CHARS = 20_000;

/**
 * A bounded stacked list of AI entries, newest last (D-02).
 *
 * @remarks
 * The Electron main process has no TSyringe DI container, so this is not an `@singleton()`; it is
 * instantiated once in `index.ts` (05-01) and treated as a singleton by convention, mirroring
 * `TranscriptBuffer`. It MUST be the single shared instance both the orchestrator and the
 * clear-AI handler (05-02) bind to.
 */
export class AiHistory {
    /** Retained entries, oldest first / newest last. */
    private entries: IAiHistoryEntry[] = [];

    /**
     * @param now - Clock returning the current time in epoch ms. Injected so the per-entry `at`
     *   timestamp is deterministic in tests; defaults to {@link Date.now} in production.
     */
    public constructor(private readonly now: () => number = Date.now) {}

    /**
     * Appends an entry, stamping it with the current clock time (the D-03 header source), then prunes
     * to the two hard bounds.
     *
     * @param entry - The entry to append, without its `at` timestamp (stamped here).
     */
    public append(entry: AiHistoryAppend): void {
        this.entries.push({ ...entry, at: this.now() });
        this.prune();
    }

    /**
     * Empties the history entirely. Wired to the clear-AI hotkey (D-02) via the handler in `index.ts`
     * (05-02), which calls this on the SAME shared instance the orchestrator appends to.
     */
    public clear(): void {
        this.entries = [];
    }

    /**
     * Returns the bounded entry list for the terminal/clear snapshot push.
     *
     * @returns A shallow copy of the retained entries, oldest first / newest last.
     */
    public snapshot(): IAiHistoryEntry[] {
        return [...this.entries];
    }

    /**
     * Enforces the two independent hard bounds, in order: shift out the oldest while over the entry
     * ceiling, then shift out the oldest while over the total-char ceiling. Both ceilings are
     * clock-independent, so the history can never grow past them (the D-02 memory ceiling).
     */
    private prune(): void {
        while (this.entries.length > MAX_AI_ENTRIES) {
            this.entries.shift();
        }

        let total = this.entries.reduce((sum, entry) => sum + entry.text.length, 0);
        while (total > MAX_AI_TOTAL_CHARS && this.entries.length > 0) {
            const dropped = this.entries.shift() as IAiHistoryEntry;
            total -= dropped.text.length;
        }
    }
}
