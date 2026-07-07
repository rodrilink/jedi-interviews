/**
 * Utterance grouping primitives (QA-01 grouping core).
 *
 * Deepgram streams a live turn as several `is_final` word runs, then signals the end of the turn
 * with `speech_final` (or a fallback `UtteranceEnd`). These primitives turn that stream into ONE
 * committed utterance per turn:
 *
 * - {@link pickModalSpeakerIndex} is a pure fold that picks the dominant per-word speaker index for
 *   a run, returning `undefined` when no word carries diarization info (D-04, neutral bucket).
 * - {@link UtteranceAccumulator} buffers the `is_final` runs and drains them on `commit()`. A commit
 *   on an empty buffer is a no-op returning `undefined`, so a trailing `UtteranceEnd` arriving after
 *   a `speech_final` commit is harmlessly ignored (Pitfall 4, double-commit guard).
 *
 * {@link pickModalSpeakerIndex} is pure and idempotent (no classes, no state, no side effects).
 */

/**
 * One diarized word as delivered by Deepgram (all fields optional — the payload is untrusted).
 */
interface IDeepgramWord {
    /** The raw recognized word. */
    word?: string;
    /** The smart-formatted / punctuated word, preferred for display when present. */
    punctuated_word?: string;
    /** The diarization speaker index for this word, when diarization is enabled. */
    speaker?: number;
}

/**
 * The drained result of a committed utterance turn.
 */
interface ICommittedUtterance {
    /** The concatenated text of every buffered `is_final` run for the turn. */
    text: string;
    /** The accumulated words, retaining their per-word `speaker` index for modal resolution. */
    words: Array<{ speaker?: number }>;
}

/**
 * Picks the modal (most frequent) speaker index across a run of diarized words.
 *
 * Only words whose `speaker` is an actual number are counted; a run with no diarization info returns
 * `undefined` so the caller falls back to the neutral bucket (D-04). Reading a missing or garbage
 * `speaker` field never throws — it is simply ignored (T-8-02).
 *
 * @param words - The words of one utterance turn (untrusted shape).
 * @returns The most frequent speaker index, or `undefined` when no word carries one.
 */
export function pickModalSpeakerIndex(words: ReadonlyArray<{ speaker?: number }>): number | undefined {
    const counts = new Map<number, number>();
    for (const word of words) {
        if (typeof word.speaker === 'number') {
            counts.set(word.speaker, (counts.get(word.speaker) ?? 0) + 1);
        }
    }
    if (counts.size === 0) {
        return undefined;
    }
    let best: number | undefined;
    let bestCount = -1;
    for (const [index, count] of counts) {
        if (count > bestCount) {
            best = index;
            bestCount = count;
        }
    }
    return best;
}

/**
 * Buffers the `is_final` word runs of a single speaker turn and drains them on commit (QA-01).
 *
 * @remarks
 * The Electron main process has no TSyringe DI container, so this is not an `@singleton()`; it is
 * instantiated once in `index.ts` (08) and treated as a singleton by convention, mirroring
 * `HotkeyRegistrarService`.
 */
export class UtteranceAccumulator {
    /** The text fragments of each buffered `is_final` run, joined on commit. */
    private textRuns: string[] = [];

    /** The accumulated words across the buffered runs, retained for modal-speaker resolution. */
    private words: Array<{ speaker?: number }> = [];

    /**
     * Appends one `is_final` word run to the current turn.
     *
     * @param words - The words of this run (untrusted shape; only `speaker` is retained).
     * @param text - The finalized text for this run.
     */
    public append(words: ReadonlyArray<IDeepgramWord>, text: string): void {
        this.textRuns.push(text);
        for (const word of words) {
            this.words.push({ speaker: word.speaker });
        }
    }

    /**
     * Returns the space-joined text of the `is_final` runs buffered so far WITHOUT draining them.
     *
     * Deepgram resets its live `transcript` field after every `is_final` run within a turn (a long
     * utterance yields several `is_final` responses before `speech_final`, per the cited endpointing
     * docs), so the recognizer's next interim only carries the newest fragment. The gateway prefixes
     * this peeked turn-so-far onto the live interim (and emits it after each `is_final` append) so the
     * overlay's in-progress (grey) line shows the WHOLE turn as it builds, instead of shrinking back to
     * Deepgram's post-reset fragment. The buffer is unchanged; the single committed utterance still
     * drains only on {@link UtteranceAccumulator.commit} at `speech_final`/`UtteranceEnd` (D-01).
     *
     * @returns The space-joined finalized-so-far text of the current turn (empty string when none).
     */
    public peek(): string {
        return this.textRuns.join(' ');
    }

    /**
     * Drains the buffered runs into one committed utterance, or returns `undefined` when nothing is
     * buffered. The empty-buffer no-op makes a trailing `UtteranceEnd` after a `speech_final` commit
     * harmless (Pitfall 4, double-commit guard).
     *
     * @returns The committed utterance, or `undefined` when the accumulator is empty.
     */
    public commit(): ICommittedUtterance | undefined {
        if (this.textRuns.length === 0 && this.words.length === 0) {
            return undefined;
        }
        const committed: ICommittedUtterance = {
            text: this.textRuns.join(' '),
            words: this.words,
        };
        this.clear();
        return committed;
    }

    /**
     * Discards the current turn without emitting it.
     */
    public clear(): void {
        this.textRuns = [];
        this.words = [];
    }
}
