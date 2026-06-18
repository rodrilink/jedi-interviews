import { describe, expect, it } from 'vitest';
import { AiHistory, MAX_AI_ENTRIES, MAX_AI_TOTAL_CHARS, type IAiHistoryEntry } from './ai-history';

/**
 * Unit coverage for the bounded {@link AiHistory} (D-02/D-03).
 *
 * Mirrors the transcript-buffer test idiom: every test injects a fake clock
 * (`let nowMs = …; const history = new AiHistory(() => nowMs)`) so the per-entry `at` timestamp
 * (the D-03 relative-time header source) and the two independent hard bounds (last-N entry count,
 * total-char ceiling) are deterministic and never depend on the wall clock.
 */
describe('ai-history', () => {
    describe('append + snapshot', () => {
        it('should append an entry and return it in the snapshot', () => {
            // Arrange
            const history: AiHistory = new AiHistory(() => 0);

            // Act
            history.append({ id: '1', mode: 'answer', text: 'hello', kind: 'done' });

            // Assert
            const snapshot: IAiHistoryEntry[] = history.snapshot();
            expect(snapshot).toHaveLength(1);
            expect(snapshot[0].text).toBe('hello');
            expect(snapshot[0].mode).toBe('answer');
        });

        it('should capture the entry timestamp from the injected clock (D-03 header source)', () => {
            // Arrange
            let nowMs = 0;
            const history: AiHistory = new AiHistory(() => nowMs);

            // Act
            nowMs = 123_456;
            history.append({ id: '1', mode: 'answer', text: 'hi', kind: 'done' });

            // Assert
            expect(history.snapshot()[0].at).toBe(123_456);
        });
    });

    describe('hard ceilings', () => {
        it('should drop the oldest entry once the count would exceed MAX_AI_ENTRIES', () => {
            // Arrange
            const history: AiHistory = new AiHistory(() => 0);

            // Act
            for (let index = 0; index < MAX_AI_ENTRIES + 1; index++) {
                history.append({ id: `${index}`, mode: 'answer', text: `entry ${index}`, kind: 'done' });
            }

            // Assert
            const snapshot: IAiHistoryEntry[] = history.snapshot();
            expect(snapshot).toHaveLength(MAX_AI_ENTRIES);
            expect(snapshot[0].id).toBe('1');
        });

        it('should drop oldest entries until the total char count is within MAX_AI_TOTAL_CHARS', () => {
            // Arrange
            const history: AiHistory = new AiHistory(() => 0);
            const chunk: string = 'x'.repeat(1000);
            const entriesToAppend: number = Math.ceil(MAX_AI_TOTAL_CHARS / 1000) + 2;

            // Act
            for (let index = 0; index < entriesToAppend; index++) {
                history.append({ id: `${index}`, mode: 'answer', text: chunk, kind: 'done' });
            }

            // Assert
            const totalChars: number = history.snapshot().reduce((sum, entry) => sum + entry.text.length, 0);
            expect(totalChars).toBeLessThanOrEqual(MAX_AI_TOTAL_CHARS);
        });
    });

    describe('clear', () => {
        it('should empty the history', () => {
            // Arrange
            const history: AiHistory = new AiHistory(() => 0);
            history.append({ id: '1', mode: 'answer', text: 'a', kind: 'done' });

            // Act
            history.clear();

            // Assert
            expect(history.snapshot()).toEqual([]);
        });
    });
});
