import { describe, expect, it } from 'vitest';
import { MAX_SEGMENTS, MAX_TOTAL_CHARS, TranscriptBuffer, WINDOW_MS } from './transcript-buffer';

/**
 * Unit coverage for the time-bounded rolling {@link TranscriptBuffer} (TRN-04, D-06).
 *
 * Every test injects a fake clock (`let nowMs = …; const buffer = new TranscriptBuffer(() => nowMs)`)
 * so prune-by-time and recentSince() are deterministic and never depend on the wall clock. The
 * three independent hard bounds (time window, segment ceiling, char ceiling) are each exercised in
 * isolation, plus interim-replacement, appendFinal-clears-interim, and clear().
 */
describe('transcript-buffer', () => {
    describe('appendFinal time-window pruning', () => {
        it('should drop a finalized segment once the clock advances past WINDOW_MS', () => {
            // Arrange
            let nowMs = 0;
            const buffer: TranscriptBuffer = new TranscriptBuffer(() => nowMs);

            // Act
            buffer.appendFinal('a');
            nowMs += WINDOW_MS + 1;
            buffer.appendFinal('b');

            // Assert
            expect(buffer.renderable().finalText).toBe('b');
        });

        it('should keep a finalized segment that is still inside the time window', () => {
            // Arrange
            let nowMs = 0;
            const buffer: TranscriptBuffer = new TranscriptBuffer(() => nowMs);

            // Act
            buffer.appendFinal('a');
            nowMs += WINDOW_MS - 1;
            buffer.appendFinal('b');

            // Assert
            expect(buffer.renderable().finalText).toBe('a b');
        });
    });

    describe('hard ceilings', () => {
        it('should drop the oldest segment once the segment count would exceed MAX_SEGMENTS', () => {
            // Arrange
            const buffer: TranscriptBuffer = new TranscriptBuffer(() => 0);

            // Act
            for (let index = 0; index < MAX_SEGMENTS + 1; index++) {
                buffer.appendFinal(`s${index}`);
            }

            // Assert
            const segments: string[] = buffer.renderable().finalText.split(' ');
            expect(segments.length).toBe(MAX_SEGMENTS);
            expect(segments[0]).toBe('s1');
        });

        it('should drop oldest segments until the total char count is within MAX_TOTAL_CHARS', () => {
            // Arrange
            const buffer: TranscriptBuffer = new TranscriptBuffer(() => 0);
            const chunk: string = 'x'.repeat(1000);
            const segmentsToAppend: number = Math.ceil(MAX_TOTAL_CHARS / 1000) + 2;

            // Act
            for (let index = 0; index < segmentsToAppend; index++) {
                buffer.appendFinal(chunk);
            }

            // Assert
            const totalChars: number = buffer.renderable().finalText.replace(/ /g, '').length;
            expect(totalChars).toBeLessThanOrEqual(MAX_TOTAL_CHARS);
        });
    });

    describe('interim handling', () => {
        it('should replace interim text rather than accumulate it', () => {
            // Arrange
            const buffer: TranscriptBuffer = new TranscriptBuffer(() => 0);

            // Act
            buffer.setInterim('x');
            buffer.setInterim('y');

            // Assert
            expect(buffer.renderable().interimText).toBe('y');
        });

        it('should clear the current interim when a final segment is appended', () => {
            // Arrange
            const buffer: TranscriptBuffer = new TranscriptBuffer(() => 0);

            // Act
            buffer.setInterim('partial');
            buffer.appendFinal('committed');

            // Assert
            expect(buffer.renderable().interimText).toBe('');
            expect(buffer.renderable().finalText).toBe('committed');
        });
    });

    describe('clear', () => {
        it('should empty both finalized and interim text', () => {
            // Arrange
            const buffer: TranscriptBuffer = new TranscriptBuffer(() => 0);
            buffer.appendFinal('a');
            buffer.setInterim('b');

            // Act
            buffer.clear();

            // Assert
            expect(buffer.renderable()).toEqual({ finalText: '', interimText: '' });
        });
    });

    describe('recentSince', () => {
        it('should return only finalized segments newer than now() minus the given window, space-joined', () => {
            // Arrange
            let nowMs = 0;
            const buffer: TranscriptBuffer = new TranscriptBuffer(() => nowMs);
            buffer.appendFinal('old');
            nowMs += 50_000;
            buffer.appendFinal('recent');
            nowMs += 20_000;

            // Act
            const span: string = buffer.recentSince(60_000);

            // Assert
            expect(span).toBe('recent');
        });
    });
});
