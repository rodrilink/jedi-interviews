import { describe, expect, it } from 'vitest';
import { deriveCardRows, derivePeople, personAccentColor, type ICardRow, type IPersonSummary, type IUtteranceEvent } from './utterance-view.utility';

describe('deriveCardRows', () => {
    it('should return an empty array for no utterances', () => {
        // Arrange
        const utterances: IUtteranceEvent[] = [];

        // Act
        const rows: ICardRow[] = deriveCardRows(utterances);

        // Assert
        expect(rows).toEqual([]);
    });

    it('should derive Q1 - Person 1 for a single diarized question', () => {
        // Arrange
        const utterances: IUtteranceEvent[] = [{ text: 'Is this working?', speaker: 'Person 1', isDiarized: true, classification: 'question' }];

        // Act
        const rows: ICardRow[] = deriveCardRows(utterances);

        // Assert
        expect(rows).toHaveLength(1);
        expect(rows[0].label).toBe('Q1 - Person 1');
        expect(rows[0].prefix).toBe('Q');
        expect(rows[0].seq).toBe(1);
        expect(rows[0].classification).toBe('question');
        expect(rows[0].speaker).toBe('Person 1');
        expect(rows[0].text).toBe('Is this working?');
    });

    it('should sequence question and statement counters independently in list order', () => {
        // Arrange
        const utterances: IUtteranceEvent[] = [
            { text: 'one', speaker: 'Person 1', isDiarized: true, classification: 'statement' },
            { text: 'two', speaker: 'Person 1', isDiarized: true, classification: 'question' },
            { text: 'three', speaker: 'Person 2', isDiarized: true, classification: 'statement' },
            { text: 'four', speaker: 'Person 1', isDiarized: true, classification: 'question' },
        ];

        // Act
        const rows: ICardRow[] = deriveCardRows(utterances);

        // Assert
        expect(rows.map((row) => row.label)).toEqual(['S1 - Person 1', 'Q1 - Person 1', 'S2 - Person 2', 'Q2 - Person 1']);
    });

    it('should label an undiarized question as Q1 - Speaker and report isDiarized false', () => {
        // Arrange
        const utterances: IUtteranceEvent[] = [{ text: 'anyone?', speaker: 'Speaker', isDiarized: false, classification: 'question' }];

        // Act
        const rows: ICardRow[] = deriveCardRows(utterances);

        // Assert
        expect(rows[0].label).toBe('Q1 - Speaker');
        expect(rows[0].isDiarized).toBe(false);
        expect(rows[0].speakerColor).toBe('neutral');
    });
});

describe('personAccentColor', () => {
    it('should return a stable slot token for Person 1 across repeat calls', () => {
        // Arrange
        const speaker = 'Person 1';

        // Act
        const first: string = personAccentColor(speaker);
        const second: string = personAccentColor(speaker);

        // Assert
        expect(first).toBe(second);
        expect(first).toMatch(/^p\d+$/);
    });

    it('should return a different slot token for Person 2 than Person 1', () => {
        // Arrange
        const personOne = 'Person 1';
        const personTwo = 'Person 2';

        // Act
        const slotOne: string = personAccentColor(personOne);
        const slotTwo: string = personAccentColor(personTwo);

        // Assert
        expect(slotOne).not.toBe(slotTwo);
    });

    it('should return the neutral token for the undiarized Speaker bucket', () => {
        // Arrange
        const speaker = 'Speaker';

        // Act
        const slot: string = personAccentColor(speaker);

        // Assert
        expect(slot).toBe('neutral');
    });

    it('should return the neutral token for any non-Person N input', () => {
        // Arrange
        const speaker = 'Unknown';

        // Act
        const slot: string = personAccentColor(speaker);

        // Assert
        expect(slot).toBe('neutral');
    });
});

describe('derivePeople', () => {
    it('should return an empty array for no utterances', () => {
        // Arrange
        const utterances: IUtteranceEvent[] = [];

        // Act
        const people: IPersonSummary[] = derivePeople(utterances);

        // Assert
        expect(people).toEqual([]);
    });

    it('should list distinct numbered speakers in first-appearance order with their utterance counts', () => {
        // Arrange
        const utterances: IUtteranceEvent[] = [
            { text: 'a', speaker: 'Person 1', isDiarized: true, classification: 'statement' },
            { text: 'b', speaker: 'Person 1', isDiarized: true, classification: 'question' },
            { text: 'c', speaker: 'Person 2', isDiarized: true, classification: 'statement' },
            { text: 'd', speaker: 'Person 1', isDiarized: true, classification: 'statement' },
        ];

        // Act
        const people: IPersonSummary[] = derivePeople(utterances);

        // Assert
        expect(people).toEqual([
            { speaker: 'Person 1', count: 3, color: personAccentColor('Person 1') },
            { speaker: 'Person 2', count: 1, color: personAccentColor('Person 2') },
        ]);
    });

    it('should exclude the undiarized Speaker bucket even when present in the input', () => {
        // Arrange
        const utterances: IUtteranceEvent[] = [
            { text: 'a', speaker: 'Person 1', isDiarized: true, classification: 'statement' },
            { text: 'b', speaker: 'Speaker', isDiarized: false, classification: 'question' },
            { text: 'c', speaker: 'Speaker', isDiarized: false, classification: 'statement' },
        ];

        // Act
        const people: IPersonSummary[] = derivePeople(utterances);

        // Assert
        expect(people).toEqual([{ speaker: 'Person 1', count: 1, color: personAccentColor('Person 1') }]);
    });

    it('should count both question and statement utterances toward the same person total', () => {
        // Arrange
        const utterances: IUtteranceEvent[] = [
            { text: 'a', speaker: 'Person 1', isDiarized: true, classification: 'question' },
            { text: 'b', speaker: 'Person 1', isDiarized: true, classification: 'statement' },
        ];

        // Act
        const people: IPersonSummary[] = derivePeople(utterances);

        // Assert
        expect(people).toHaveLength(1);
        expect(people[0].count).toBe(2);
    });

    it('should color each person with personAccentColor so the row is the card color legend', () => {
        // Arrange
        const utterances: IUtteranceEvent[] = [
            { text: 'a', speaker: 'Person 1', isDiarized: true, classification: 'statement' },
            { text: 'b', speaker: 'Person 2', isDiarized: true, classification: 'statement' },
        ];

        // Act
        const people: IPersonSummary[] = derivePeople(utterances);

        // Assert
        expect(people[0].color).toBe(personAccentColor('Person 1'));
        expect(people[1].color).toBe(personAccentColor('Person 2'));
    });
});
