import { describe, expect, it } from 'vitest';
import { classifyUtterance } from './question-classifier.utility';
import type { UtteranceClassification } from './stt-provider.interface';

describe('question-classifier.utility', () => {
    describe('classifyUtterance', () => {
        it('should classify a sentence ending in a question mark as a question', () => {
            // Arrange
            const text = 'Can you walk me through the design?';

            // Act
            const result: UtteranceClassification = classifyUtterance(text);

            // Assert
            expect(result).toBe('question');
        });

        it('should classify a sentence opening with an interrogative word and no question mark as a question', () => {
            // Arrange
            const text = 'What is the deployment target';

            // Act
            const result: UtteranceClassification = classifyUtterance(text);

            // Assert
            expect(result).toBe('question');
        });

        it('should classify a sentence opening with an auxiliary word as a question', () => {
            // Arrange
            const text = 'Do we ship on Friday';

            // Act
            const result: UtteranceClassification = classifyUtterance(text);

            // Assert
            expect(result).toBe('question');
        });

        it('should classify a plain declarative sentence with no cue as a statement', () => {
            // Arrange
            const text = 'We shipped it on Friday.';

            // Act
            const result: UtteranceClassification = classifyUtterance(text);

            // Assert
            expect(result).toBe('statement');
        });

        it('should classify a polite imperative as a statement by design', () => {
            // Arrange
            const text = 'Walk me through the design.';

            // Act
            const result: UtteranceClassification = classifyUtterance(text);

            // Assert
            expect(result).toBe('statement');
        });

        it('should classify a multi-sentence utterance as a question when any sentence is a question', () => {
            // Arrange
            const text = 'We had a good sprint. Are we ready for the demo?';

            // Act
            const result: UtteranceClassification = classifyUtterance(text);

            // Assert
            expect(result).toBe('question');
        });

        it('should classify empty text as a statement by default', () => {
            // Arrange
            const text = '';

            // Act
            const result: UtteranceClassification = classifyUtterance(text);

            // Assert
            expect(result).toBe('statement');
        });
    });
});
