import { describe, expect, it } from 'vitest';
import { ANSWER_SYSTEM_PROMPT, TALKING_POINTS_SYSTEM_PROMPT, assemblePrompt, type IAssembledPrompt } from './prompt-assembler';

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
    });
});
