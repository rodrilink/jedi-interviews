/**
 * Pure card-row derivation for the Q/A panel (QA-04, D-03/D-04/D-05).
 *
 * The panel receives the full session-scoped `utterances` array on every push (Phase 8); this module
 * turns that raw stream into the exact card rows the panel renders — the `{seq} - {speaker}` label with a
 * per-type session-scoped sequence number and a deterministic per-speaker accent color slot. It is kept
 * DOM- and CSS-free (no React import, no `window` access, no raw hues) so it runs under the node vitest
 * environment and so the actual colors live in hud.css (the panel maps each slot token to a CSS rule via a
 * `data-speaker-color` attribute — inline `style` props are forbidden per the IDEXX rule).
 *
 * The `IUtteranceEvent` / `UtteranceClassification` shapes are mirrored LOCALLY (not imported from
 * `src/main`) because the renderer is bundled separately from main — the authoritative source is
 * `src/main/stt/stt-provider.interface.ts` (lines 44, 53-67).
 */

/** Local mirror of `UtteranceClassification` (stt-provider.interface.ts:44). */
export type UtteranceClassification = 'question' | 'statement';

/** Local mirror of `IUtteranceEvent` (stt-provider.interface.ts:53-67). */
export interface IUtteranceEvent {
    /** The finalized utterance text for this turn. */
    text: string;
    /** `'Person 1' | 'Person 2' | … ` for a diarized turn, or the neutral `'Speaker'` bucket (D-04). */
    speaker: string;
    /** `true` when {@link IUtteranceEvent.speaker} is a numbered `Person N`; `false` for the neutral bucket (D-05). */
    isDiarized: boolean;
    /** The local Question/Statement heuristic result (D-06/D-07/D-08). */
    classification: UtteranceClassification;
}

/** A single derived Q/A card row — everything the panel needs to render one card. */
export interface ICardRow {
    /** The exact header label in `{prefix}{seq} - {speaker}` form, e.g. `'Q1 - Person 1'` (D-03). */
    label: string;
    /** The Q/S prefix derived from {@link ICardRow.classification} (`'question' -> 'Q'`). */
    prefix: 'Q' | 'S';
    /** The per-type, session-scoped sequence number (Q1,Q2… independent of S1,S2…), in list order (D-03). */
    seq: number;
    /** The speaker label carried through from the utterance. */
    speaker: string;
    /** `false` => the neutral `'Speaker'` bucket, rendered neutral grey (D-05). */
    isDiarized: boolean;
    /** The utterance classification, driving the question accent/tint variant (D-01). */
    classification: UtteranceClassification;
    /** The finalized utterance text. */
    text: string;
    /** The deterministic accent-color slot token (`'p0'..'pN'`, or `'neutral'`) from {@link personAccentColor}. */
    speakerColor: string;
}

/** The ordered set of per-speaker accent slots (D-04); their concrete hues are defined in hud.css. */
const SPEAKER_COLOR_SLOTS: readonly string[] = ['p0', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'];

/** The neutral slot for the undiarized `'Speaker'` bucket (D-05). */
const NEUTRAL_SPEAKER_COLOR = 'neutral';

/**
 * Maps a speaker label to a deterministic accent-color slot token (D-04/D-05).
 *
 * A numbered `'Person N'` speaker parses its trailing integer and indexes (modulo the slot count) into a
 * fixed ordered palette, so the same person always maps to the same slot for the whole session and
 * distinct people map to distinct slots (until the palette wraps). The undiarized `'Speaker'` bucket — or
 * any input that is not a `'Person N'` — returns the single `'neutral'` token (D-05).
 *
 * @param speaker - The speaker label from an utterance (`'Person 1'`, `'Speaker'`, …).
 * @returns A stable, enumerable slot token (`'p0'..'p7'` or `'neutral'`), NOT a raw CSS color.
 */
export function personAccentColor(speaker: string): string {
    const match = /^Person (\d+)$/.exec(speaker);
    if (match === null) {
        return NEUTRAL_SPEAKER_COLOR;
    }

    const personNumber = Number.parseInt(match[1], 10);
    const slotIndex = (personNumber - 1) % SPEAKER_COLOR_SLOTS.length;

    return SPEAKER_COLOR_SLOTS[slotIndex];
}

/**
 * Derives the ordered list of card rows from the session-scoped utterance array (D-03).
 *
 * Sequence numbers are per-type running counters over the array in list order: the question counter and
 * the statement counter advance independently, and each utterance takes the next value of its own type.
 * The label is built as `${prefix}${seq} - ${speaker}` (space-hyphen-space, exact).
 *
 * @param utterances - The full session-scoped committed utterances, oldest first.
 * @returns One {@link ICardRow} per utterance, in the same order.
 */
export function deriveCardRows(utterances: IUtteranceEvent[]): ICardRow[] {
    let questionCount = 0;
    let statementCount = 0;

    return utterances.map((utterance) => {
        const prefix: 'Q' | 'S' = utterance.classification === 'question' ? 'Q' : 'S';
        const seq = prefix === 'Q' ? ++questionCount : ++statementCount;

        return {
            label: `${prefix}${seq} - ${utterance.speaker}`,
            prefix,
            seq,
            speaker: utterance.speaker,
            isDiarized: utterance.isDiarized,
            classification: utterance.classification,
            text: utterance.text,
            speakerColor: personAccentColor(utterance.speaker),
        };
    });
}
