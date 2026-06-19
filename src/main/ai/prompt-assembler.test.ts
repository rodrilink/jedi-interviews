import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { ANSWER_SYSTEM_PROMPT, TALKING_POINTS_SYSTEM_PROMPT, VISION_SYSTEM_PROMPT, assemblePrompt, type IAssembledPrompt } from './prompt-assembler';

/**
 * Unit coverage for the pure {@link assemblePrompt} (AI-01/AI-02/D-13).
 *
 * The assembler is a pure function: `{ mode, span, context? }` -> `{ system, userContent }`. These
 * tests assert the per-mode system-prompt selection, that the transcript span is embedded under a
 * labeled header, and the D-13 empty-context-slot behavior (an absent/empty grounding context yields
 * no context block, so Phase 6 can fill the SAME parameter with no call-site change).
 */
describe('prompt-assembler', () => {
    describe('system-prompt selection', () => {
        it('should select the answer system prompt for answer mode (AI-01)', () => {
            // Arrange
            const span = 'So what would you do if the build fails on main?';

            // Act
            const assembled: IAssembledPrompt = assemblePrompt({ mode: 'answer', span });

            // Assert
            expect(assembled.system).toBe(ANSWER_SYSTEM_PROMPT);
        });

        it('should select the talking-points system prompt for talking-points mode (AI-02)', () => {
            // Arrange
            const span = 'We are refactoring the payments reconciliation job.';

            // Act
            const assembled: IAssembledPrompt = assemblePrompt({ mode: 'talking-points', span });

            // Assert
            expect(assembled.system).toBe(TALKING_POINTS_SYSTEM_PROMPT);
        });
    });

    describe('talking-points prompt wording (AI-02/D-12)', () => {
        it('should instruct 3 to 5 short bullets each prefixed with a dash', () => {
            // Arrange
            const prompt = TALKING_POINTS_SYSTEM_PROMPT;

            // Act
            const requestsThreeToFive = prompt.includes('3') && prompt.includes('5');

            // Assert
            expect(requestsThreeToFive).toBe(true);
            expect(prompt).toContain('- ');
        });

        it('should focus the talking points on the project work being discussed', () => {
            // Arrange
            const prompt = TALKING_POINTS_SYSTEM_PROMPT;

            // Act
            const focusesOnProjectWork = prompt.includes('project work');

            // Assert
            expect(focusesOnProjectWork).toBe(true);
        });
    });

    describe('span embedding', () => {
        it('should embed the transcript span under a labeled recent-transcript header', () => {
            // Arrange
            const span = 'How would you handle a flaky test?';

            // Act
            const assembled: IAssembledPrompt = assemblePrompt({ mode: 'answer', span });

            // Assert
            expect(assembled.userContent).toContain('Recent transcript (last ~60s):');
            expect(assembled.userContent).toContain(span);
        });

        it('should embed the transcript span under the same labeled header for talking-points mode', () => {
            // Arrange
            const span = 'We are refactoring the payments reconciliation job and the retry logic is flaky.';

            // Act
            const assembled: IAssembledPrompt = assemblePrompt({ mode: 'talking-points', span });

            // Assert
            expect(assembled.userContent).toContain('Recent transcript (last ~60s):');
            expect(assembled.userContent).toContain(span);
        });
    });

    describe('grounding-context slot (D-13)', () => {
        it('should produce no context block when context is undefined', () => {
            // Arrange
            const span = 'What is your experience with TypeScript?';

            // Act
            const assembled: IAssembledPrompt = assemblePrompt({ mode: 'answer', span, context: undefined });

            // Assert
            expect(assembled.userContent).toBe(`Recent transcript (last ~60s):\n${span}`);
        });

        it('should produce no context block when context is an empty object', () => {
            // Arrange
            const span = 'What is your experience with TypeScript?';

            // Act
            const assembled: IAssembledPrompt = assemblePrompt({ mode: 'answer', span, context: {} });

            // Assert
            expect(assembled.userContent).toBe(`Recent transcript (last ~60s):\n${span}`);
        });

        it('should produce no context block for talking-points mode when context is undefined (D-13 holds for both modes)', () => {
            // Arrange
            const span = 'We are migrating the reconciliation job off the legacy queue.';

            // Act
            const assembled: IAssembledPrompt = assemblePrompt({ mode: 'talking-points', span, context: undefined });

            // Assert
            expect(assembled.userContent).toBe(`Recent transcript (last ~60s):\n${span}`);
        });
    });

    describe('vision image branch (Phase 7 AI-03/D-04/D-07)', () => {
        it('should return userContent as a string for the text modes (no image) — byte-for-byte unchanged', () => {
            // Arrange
            const span = 'How would you design a URL shortener?';

            // Act
            const assembled: IAssembledPrompt = assemblePrompt({ mode: 'answer', span });

            // Assert
            expect(typeof assembled.userContent).toBe('string');
            expect(assembled.userContent).toBe(`Recent transcript (last ~60s):\n${span}`);
        });

        it('should select the vision system prompt and return a block array when an image is present', () => {
            // Arrange
            const span = 'Solve for O(n) time.';
            const image = { base64: 'AAAABBBBCCCC', mediaType: 'image/png' };

            // Act
            const assembled: IAssembledPrompt = assemblePrompt({ mode: 'code-challenge', span, image });

            // Assert
            expect(assembled.system).toBe(VISION_SYSTEM_PROMPT);
            expect(Array.isArray(assembled.userContent)).toBe(true);
        });

        it('should place the image block BEFORE the text block and carry the raw base64 (no data: prefix)', () => {
            // Arrange
            const span = 'Use a hash map.';
            const image = { base64: 'RAWBASE64NOPREFIX', mediaType: 'image/png' };

            // Act
            const assembled: IAssembledPrompt = assemblePrompt({ mode: 'code-challenge', span, image });
            const blocks = assembled.userContent as Anthropic.ContentBlockParam[];

            // Assert
            expect(blocks[0].type).toBe('image');
            expect(blocks[1].type).toBe('text');
            const imageBlock = blocks[0] as Anthropic.ImageBlockParam;
            const source = imageBlock.source as Anthropic.Base64ImageSource;
            expect(source.type).toBe('base64');
            expect(source.media_type).toBe('image/png');
            expect(source.data).toBe('RAWBASE64NOPREFIX');
            expect(source.data).not.toContain('data:');
        });

        it('should reuse the same grounded context + transcript span in the vision text block (D-07)', () => {
            // Arrange
            const span = 'The interviewer said inputs fit in memory.';
            const image = { base64: 'IMG', mediaType: 'image/png' };
            const context = { notes: 'Prefer iterative over recursive.' };

            // Act
            const assembled: IAssembledPrompt = assemblePrompt({ mode: 'code-challenge', span, image, context });
            const blocks = assembled.userContent as Anthropic.ContentBlockParam[];
            const textBlock = blocks[1] as Anthropic.TextBlockParam;

            // Assert
            expect(textBlock.text).toContain('Prefer iterative over recursive.');
            expect(textBlock.text).toContain(span);
        });
    });
});
