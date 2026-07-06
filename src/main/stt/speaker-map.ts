/**
 * Session-long speaker map (QA-02).
 *
 * Deepgram's raw diarization indices drift on a rolling live stream, so a bare index is not a
 * stable identity. This map assigns each index a `Person N` label the first time it is seen and
 * keeps that label for the whole session (D-03), giving every voice a consistent identity across
 * index drift. An utterance with no diarization info gets the neutral `Speaker` bucket and stays
 * out of the numbered list without consuming a Person number (D-04). Clearing the map (wired to the
 * clear-transcript chord) restarts numbering at Person 1 (D-05).
 *
 * The map is index-keyed, not time-keyed, so it needs no injected clock. Its size is naturally
 * bounded by the distinct-speaker count of one meeting, so no cap is applied this phase (T-8-01).
 */

/**
 * A stable session-scoped speaker map from Deepgram diarization index to `Person N` (QA-02).
 *
 * @remarks
 * The Electron main process has no TSyringe DI container, so this is not an `@singleton()`; it is
 * instantiated once in `index.ts` (08) and treated as a singleton by convention, mirroring
 * `HotkeyRegistrarService`.
 */
export class SpeakerMap {
    /** The first-seen index → stable `Person N` label mapping for the session. */
    private readonly indexToPerson = new Map<number, string>();

    /** The next Person number to hand out; advances only when a new index is first seen. */
    private nextPersonNumber = 1;

    /**
     * Resolves a diarization index to its stable session label.
     *
     * A defined index is mapped to `Person N` on first sight and keeps that label thereafter (D-03).
     * An `undefined` index (no diarization info) returns the neutral `Speaker` bucket WITHOUT
     * advancing the Person counter (D-04).
     *
     * @param speakerIndex - The Deepgram diarization index, or `undefined` when the turn is undiarized.
     * @returns The stable speaker label plus whether it is a numbered `Person N`.
     */
    public label(speakerIndex: number | undefined): { speaker: string; isDiarized: boolean } {
        if (speakerIndex === undefined) {
            return { speaker: 'Speaker', isDiarized: false };
        }
        let person = this.indexToPerson.get(speakerIndex);
        if (person === undefined) {
            person = `Person ${this.nextPersonNumber++}`;
            this.indexToPerson.set(speakerIndex, person);
        }
        return { speaker: person, isDiarized: true };
    }

    /**
     * Empties the map AND resets the Person counter so numbering restarts at Person 1 (D-05). Wired
     * to the clear-transcript chord in `index.ts` (08) so a fresh session starts fresh.
     */
    public clear(): void {
        this.indexToPerson.clear();
        this.nextPersonNumber = 1;
    }
}
