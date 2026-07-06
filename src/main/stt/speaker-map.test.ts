import { describe, expect, it } from 'vitest';
import { SpeakerMap } from './speaker-map';

describe('speaker-map', () => {
    describe('SpeakerMap', () => {
        it('should assign stable Person N labels by first-seen index', () => {
            // Arrange
            const speakerMap: SpeakerMap = new SpeakerMap();

            // Act
            const first: { speaker: string; isDiarized: boolean } = speakerMap.label(0);
            const second: { speaker: string; isDiarized: boolean } = speakerMap.label(1);
            const firstAgain: { speaker: string; isDiarized: boolean } = speakerMap.label(0);

            // Assert
            expect(first).toEqual({ speaker: 'Person 1', isDiarized: true });
            expect(second).toEqual({ speaker: 'Person 2', isDiarized: true });
            expect(firstAgain).toEqual({ speaker: 'Person 1', isDiarized: true });
        });

        it('should return the neutral Speaker bucket for an undiarized utterance without consuming a Person number', () => {
            // Arrange
            const speakerMap: SpeakerMap = new SpeakerMap();

            // Act
            const neutral: { speaker: string; isDiarized: boolean } = speakerMap.label(undefined);
            const firstDiarized: { speaker: string; isDiarized: boolean } = speakerMap.label(0);

            // Assert
            expect(neutral).toEqual({ speaker: 'Speaker', isDiarized: false });
            expect(firstDiarized).toEqual({ speaker: 'Person 1', isDiarized: true });
        });

        it('should restart Person numbering at Person 1 after clear', () => {
            // Arrange
            const speakerMap: SpeakerMap = new SpeakerMap();
            speakerMap.label(0);
            speakerMap.label(1);

            // Act
            speakerMap.clear();
            const afterClear: { speaker: string; isDiarized: boolean } = speakerMap.label(5);

            // Assert
            expect(afterClear).toEqual({ speaker: 'Person 1', isDiarized: true });
        });
    });
});
