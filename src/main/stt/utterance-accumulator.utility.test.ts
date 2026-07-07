import { describe, expect, it } from 'vitest';
import { UtteranceAccumulator, pickModalSpeakerIndex } from './utterance-accumulator.utility';

describe('utterance-accumulator.utility', () => {
    describe('pickModalSpeakerIndex', () => {
        it('should return the modal speaker index when one index dominates the run', () => {
            // Arrange
            const words: ReadonlyArray<{ speaker?: number }> = [{ speaker: 0 }, { speaker: 0 }, { speaker: 1 }];

            // Act
            const result: number | undefined = pickModalSpeakerIndex(words);

            // Assert
            expect(result).toBe(0);
        });

        it('should return undefined when no word carries a speaker index', () => {
            // Arrange
            const words: ReadonlyArray<{ speaker?: number }> = [{}, {}];

            // Act
            const result: number | undefined = pickModalSpeakerIndex(words);

            // Assert
            expect(result).toBeUndefined();
        });
    });

    describe('UtteranceAccumulator', () => {
        it('should commit one result whose modal index is the dominant speaker for a mixed run', () => {
            // Arrange
            const accumulator: UtteranceAccumulator = new UtteranceAccumulator();
            const words: ReadonlyArray<{ punctuated_word?: string; word?: string; speaker?: number }> = [
                { punctuated_word: 'Hello', speaker: 0 },
                { punctuated_word: 'there', speaker: 0 },
                { punctuated_word: 'friend', speaker: 1 },
            ];

            // Act
            accumulator.append(words, 'Hello there friend');
            const committed = accumulator.commit();

            // Assert
            expect(committed).toBeDefined();
            expect(pickModalSpeakerIndex(committed?.words ?? [])).toBe(0);
        });

        it('should concatenate two is_final word runs into one committed result and then be empty', () => {
            // Arrange
            const accumulator: UtteranceAccumulator = new UtteranceAccumulator();

            // Act
            accumulator.append([{ punctuated_word: 'Hello', speaker: 0 }], 'Hello');
            accumulator.append([{ punctuated_word: 'world.', speaker: 0 }], 'world.');
            const committed = accumulator.commit();
            const second = accumulator.commit();

            // Assert
            expect(committed?.text).toBe('Hello world.');
            expect(committed?.words).toHaveLength(2);
            expect(second).toBeUndefined();
        });

        it('should peek the space-joined buffered runs without draining them', () => {
            // Arrange
            const accumulator: UtteranceAccumulator = new UtteranceAccumulator();

            // Act
            accumulator.append([{ punctuated_word: 'Hello', speaker: 0 }], 'Hello');
            accumulator.append([{ punctuated_word: 'there', speaker: 0 }], 'there');
            const peeked: string = accumulator.peek();
            const committed = accumulator.commit();

            // Assert
            expect(peeked).toBe('Hello there');
            expect(committed?.text).toBe('Hello there');
        });

        it('should peek an empty string when no runs are buffered', () => {
            // Arrange
            const accumulator: UtteranceAccumulator = new UtteranceAccumulator();

            // Act
            const peeked: string = accumulator.peek();

            // Assert
            expect(peeked).toBe('');
        });

        it('should return undefined when committing an empty accumulator', () => {
            // Arrange
            const accumulator: UtteranceAccumulator = new UtteranceAccumulator();

            // Act
            const committed = accumulator.commit();

            // Assert
            expect(committed).toBeUndefined();
        });

        it('should return undefined on a second consecutive commit after a real commit', () => {
            // Arrange
            const accumulator: UtteranceAccumulator = new UtteranceAccumulator();

            // Act
            accumulator.append([{ punctuated_word: 'Ship', speaker: 0 }], 'Ship');
            const first = accumulator.commit();
            const second = accumulator.commit();

            // Assert
            expect(first).toBeDefined();
            expect(second).toBeUndefined();
        });
    });
});
