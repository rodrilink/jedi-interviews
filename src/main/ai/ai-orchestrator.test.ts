import { EventEmitter } from 'events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { IAiGateway, IAiPromptRequest, IAiStream } from './ai-gateway.interface';
import { AiOrchestrator } from './ai-orchestrator';
import type { IAiPushEvent } from './ai-orchestrator';
import { AiHistory } from './ai-history';
import { TranscriptBuffer } from '../stt/transcript-buffer';
import { assemblePrompt, type IGroundingContext } from './prompt-assembler';

/**
 * In-memory stand-in for the {@link IAiGateway}, mirroring the FakeV1Socket pattern used for the
 * Deepgram gateway test. It is a real EventEmitter so the orchestrator's actual `gateway.on(...)`
 * wiring is exercised, and exposes `stream` as a spy returning a spied abort handle so tests can
 * assert that the stream was (or was NOT) started and that abort() was called.
 */
class FakeAiGateway extends EventEmitter implements IAiGateway {
    public readonly abort = vi.fn<() => void>();
    public readonly stream = vi.fn<(request: IAiPromptRequest) => IAiStream>(() => ({ abort: this.abort }));
}

/** Drains a finalized transcript segment into a buffer so the orchestrator's recentSince() span is non-empty. */
function seedSpan(buffer: TranscriptBuffer, text: string): void {
    buffer.appendFinal(text);
}

describe('ai-orchestrator', () => {
    let gateway: FakeAiGateway;
    let buffer: TranscriptBuffer;
    let history: AiHistory;
    let pushed: IAiPushEvent[];
    let orchestrator: AiOrchestrator;
    /** The pull-on-trigger provider's current return value; reassign per test to simulate a mid-session Save. */
    let activeContext: IGroundingContext | undefined;
    /** The capture seam (Phase 7 D-01/D-05); a spy resolving to a fake image so code-challenge tests run. */
    let captureImage: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        // Arrange (shared): fresh fakes, fake timers for the trailing-edge debounce assertions.
        vi.clearAllMocks();
        vi.useFakeTimers();
        gateway = new FakeAiGateway();
        buffer = new TranscriptBuffer(() => 0);
        history = new AiHistory(() => 0);
        pushed = [];
        // Default: no active context (the Phase-5 fail-safe path). Individual tests reassign `activeContext`
        // BEFORE trigger() to assert pull-on-trigger — the orchestrator reads the provider at each trigger.
        activeContext = undefined;
        // Default capture seam resolves to a fake downscaled image (no data: prefix).
        captureImage = vi.fn(() => Promise.resolve({ base64: 'FAKEBASE64', mediaType: 'image/png' }));
        orchestrator = new AiOrchestrator(
            gateway,
            buffer,
            history,
            (event: IAiPushEvent) => pushed.push(event),
            () => activeContext,
            () => captureImage()
        );
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    describe('empty-span guard (D-11)', () => {
        it('should NOT call gateway.stream when the recent span is empty', () => {
            // Arrange — buffer left empty.

            // Act
            orchestrator.trigger('answer');

            // Assert
            expect(gateway.stream).not.toHaveBeenCalled();
        });

        it('should push an empty-kind entry when the recent span is empty', () => {
            // Arrange — buffer left empty.

            // Act
            orchestrator.trigger('answer');

            // Assert
            const empties = pushed.filter((event) => event.type === 'empty');
            expect(empties.length).toBeGreaterThan(0);
        });

        it('should call gateway.stream when the recent span is non-empty', () => {
            // Arrange
            seedSpan(buffer, 'What is your favorite data structure?');

            // Act
            orchestrator.trigger('answer');

            // Assert
            expect(gateway.stream).toHaveBeenCalledTimes(1);
        });
    });

    describe('single-in-flight cancel (D-06)', () => {
        it('should abort the in-flight stream when the same mode is re-pressed', () => {
            // Arrange
            seedSpan(buffer, 'Tell me about a hard bug you fixed.');
            orchestrator.trigger('answer');

            // Act
            orchestrator.trigger('answer');

            // Assert
            expect(gateway.abort).toHaveBeenCalledTimes(1);
        });

        it('should not start a second stream when the same mode is re-pressed (cancel only)', () => {
            // Arrange
            seedSpan(buffer, 'Tell me about a hard bug you fixed.');
            orchestrator.trigger('answer');

            // Act
            orchestrator.trigger('answer');

            // Assert
            expect(gateway.stream).toHaveBeenCalledTimes(1);
        });
    });

    describe('cancel-current-start-new across modes (D-07)', () => {
        it('should abort the current stream and start a new one when the other mode is pressed', () => {
            // Arrange
            seedSpan(buffer, 'We are discussing the reconciliation service.');
            orchestrator.trigger('answer');

            // Act
            orchestrator.trigger('talking-points');

            // Assert
            expect(gateway.abort).toHaveBeenCalledTimes(1);
            expect(gateway.stream).toHaveBeenCalledTimes(2);
        });
    });

    describe('request-id guard (Pitfall 1)', () => {
        it('should NOT append a stale aborted stream late delta to the new entry', () => {
            // Arrange
            seedSpan(buffer, 'First question about caching.');
            orchestrator.trigger('answer'); // request 1
            orchestrator.trigger('answer'); // re-press aborts request 1
            pushed.length = 0;

            // Act — request 1's late delta fires after it was aborted.
            gateway.emit('text', 'stale token from the aborted stream');
            vi.advanceTimersByTime(200);

            // Assert
            const deltas = pushed.filter((event) => event.type === 'delta');
            expect(deltas).toHaveLength(0);
        });
    });

    describe('hotkey-to-first-token latency logging (D-10)', () => {
        it('should log one main-log first-token line on the first text delta', () => {
            // Arrange
            const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
            seedSpan(buffer, 'How would you design a rate limiter?');
            orchestrator.trigger('answer');

            // Act
            gateway.emit('text', 'Tok');
            gateway.emit('text', 'en');

            // Assert
            const firstTokenLines = logSpy.mock.calls.filter((call) => typeof call[0] === 'string' && call[0].includes('[ai] first-token'));
            expect(firstTokenLines).toHaveLength(1);

            logSpy.mockRestore();
        });

        it('should log the active mode and model in the first-token line', () => {
            // Arrange
            const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
            seedSpan(buffer, 'Walk me through the talking points.');
            orchestrator.trigger('talking-points');

            // Act
            gateway.emit('text', 'Bullet');

            // Assert
            const line = logSpy.mock.calls.map((call) => String(call[0])).find((message) => message.includes('[ai] first-token'));
            expect(line).toContain('mode=talking-points');
            expect(line).toContain('model=claude-opus-4-8');
            expect(line).toContain('latencyMs=');

            logSpy.mockRestore();
        });

        it('should NOT log latency for a stale aborted stream late first delta', () => {
            // Arrange
            const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
            seedSpan(buffer, 'First question about caching.');
            orchestrator.trigger('answer'); // request 1
            orchestrator.trigger('answer'); // re-press aborts request 1, no new stream
            logSpy.mockClear();

            // Act — request 1's late first delta fires after it was aborted.
            gateway.emit('text', 'stale token');

            // Assert
            const firstTokenLines = logSpy.mock.calls.filter((call) => typeof call[0] === 'string' && call[0].includes('[ai] first-token'));
            expect(firstTokenLines).toHaveLength(0);

            logSpy.mockRestore();
        });

        it('should log a fresh first-token line for the new stream after a cross-mode switch', () => {
            // Arrange
            const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
            seedSpan(buffer, 'We are discussing the reconciliation service.');
            orchestrator.trigger('answer'); // request 1
            orchestrator.trigger('talking-points'); // aborts request 1, starts request 2
            logSpy.mockClear();

            // Act — the new stream's first delta arrives.
            gateway.emit('text', 'Bullet');

            // Assert
            const firstTokenLines = logSpy.mock.calls.map((call) => String(call[0])).filter((message) => message.includes('[ai] first-token'));
            expect(firstTokenLines).toHaveLength(1);
            expect(firstTokenLines[0]).toContain('mode=talking-points');

            logSpy.mockRestore();
        });
    });

    describe('active-context injection (D-10, pull-on-trigger)', () => {
        it('should inject the four grounding blocks into the assembled userContent when context is filled', () => {
            // Arrange
            seedSpan(buffer, 'What database are we using for the ledger?');
            activeContext = {
                notes: 'Use Postgres for the ledger.',
                ticketText: 'JIRA-42: ledger persistence.',
                repoSnippets: 'class LedgerRepository {}',
                links: ['https://example.com/ledger-doc'],
            };

            // Act
            orchestrator.trigger('answer');

            // Assert
            const request = gateway.stream.mock.calls[0]?.[0] as IAiPromptRequest;
            expect(request.userContent).toContain('Use Postgres for the ledger.');
            expect(request.userContent).toContain('JIRA-42: ledger persistence.');
            expect(request.userContent).toContain('class LedgerRepository {}');
            expect(request.userContent).toContain('https://example.com/ledger-doc');
        });

        it('should produce a byte-for-byte Phase-5-identical prompt when the active context is undefined', () => {
            // Arrange
            const span = 'How would you shard the events table?';
            seedSpan(buffer, span);
            activeContext = undefined;
            const phase5 = assemblePrompt({ mode: 'answer', span, context: undefined });

            // Act
            orchestrator.trigger('answer');

            // Assert
            const request = gateway.stream.mock.calls[0]?.[0] as IAiPromptRequest;
            expect(request.system).toBe(phase5.system);
            expect(request.userContent).toBe(phase5.userContent);
        });

        it('should pull the active context at EACH trigger so a value change between triggers is reflected (no cached state)', () => {
            // Arrange — first trigger with no context.
            seedSpan(buffer, 'Tell me about the caching layer.');
            activeContext = undefined;
            orchestrator.trigger('answer');
            const firstRequest = gateway.stream.mock.calls[0]?.[0] as IAiPromptRequest;

            // Act — a mid-session Save changes the provider's return, then the next trigger pulls it.
            activeContext = { notes: 'We use a write-through Redis cache.' };
            orchestrator.trigger('talking-points');

            // Assert — the first trigger saw no context; the second pulled the freshly-saved context.
            expect(firstRequest.userContent).not.toContain('write-through Redis cache');
            const secondRequest = gateway.stream.mock.calls[1]?.[0] as IAiPromptRequest;
            expect(secondRequest.userContent).toContain('We use a write-through Redis cache.');
        });
    });

    describe('code-challenge vision mode (Phase 7 AI-03/D-07/D-11)', () => {
        it('should trigger even when the transcript span is empty (D-07 bypasses the empty-span guard)', async () => {
            // Arrange — buffer left empty; vision is actionable from the image alone.

            // Act
            orchestrator.trigger('code-challenge');
            await vi.runAllTimersAsync();

            // Assert — capture ran and a stream started (no empty short-circuit).
            expect(captureImage).toHaveBeenCalledTimes(1);
            expect(gateway.stream).toHaveBeenCalledTimes(1);
        });

        it('should still short-circuit the text modes on an empty span (guard intact for non-vision)', () => {
            // Arrange — buffer left empty.

            // Act
            orchestrator.trigger('answer');

            // Assert
            expect(gateway.stream).not.toHaveBeenCalled();
            expect(captureImage).not.toHaveBeenCalled();
        });

        it('should route code-challenge to the Opus model with the vision image block', async () => {
            // Arrange — empty span is fine for vision.

            // Act
            orchestrator.trigger('code-challenge');
            await vi.runAllTimersAsync();

            // Assert
            const request = gateway.stream.mock.calls[0]?.[0] as IAiPromptRequest;
            expect(request.model).toBe('claude-opus-4-8');
            expect(Array.isArray(request.userContent)).toBe(true);
        });

        it('should cancel an in-flight vision stream when code-challenge is re-pressed (D-06)', async () => {
            // Arrange
            orchestrator.trigger('code-challenge');
            await vi.runAllTimersAsync();

            // Act
            orchestrator.trigger('code-challenge');

            // Assert
            expect(gateway.abort).toHaveBeenCalledTimes(1);
        });

        it('should cancel vision and start the new mode when a text mode is pressed mid-vision (3-mode single-in-flight, D-11)', async () => {
            // Arrange
            seedSpan(buffer, 'The interviewer wants O(n).');
            orchestrator.trigger('code-challenge');
            await vi.runAllTimersAsync();

            // Act
            orchestrator.trigger('answer');

            // Assert — exactly one active request: vision aborted, answer started.
            expect(gateway.abort).toHaveBeenCalledTimes(1);
            expect(gateway.stream).toHaveBeenCalledTimes(2);
        });

        it('should surface an inline error entry when capture fails (report-don\'t-throw)', async () => {
            // Arrange
            captureImage = vi.fn(() => Promise.reject(new Error('No screen source available.')));

            // Act
            orchestrator.trigger('code-challenge');
            await vi.runAllTimersAsync();

            // Assert — no stream started; an error entry was pushed.
            expect(gateway.stream).not.toHaveBeenCalled();
            const errors = pushed.filter((event) => event.type === 'error');
            expect(errors.length).toBeGreaterThan(0);
        });
    });

    describe('trailing-edge debounce (AI-04)', () => {
        it('should not push a delta synchronously on the first text event', () => {
            // Arrange
            seedSpan(buffer, 'Describe your testing approach.');
            orchestrator.trigger('answer');
            pushed.length = 0;

            // Act
            gateway.emit('text', 'Tok');

            // Assert
            expect(pushed.filter((event) => event.type === 'delta')).toHaveLength(0);
        });

        it('should push a coalesced delta after the debounce interval elapses', () => {
            // Arrange
            seedSpan(buffer, 'Describe your testing approach.');
            orchestrator.trigger('answer');
            pushed.length = 0;

            // Act
            gateway.emit('text', 'Tok');
            gateway.emit('text', 'en');
            vi.advanceTimersByTime(200);

            // Assert
            const deltas = pushed.filter((event) => event.type === 'delta');
            expect(deltas.length).toBeGreaterThan(0);
        });
    });
});
