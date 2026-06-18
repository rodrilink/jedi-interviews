import { EventEmitter } from 'events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { IAiGateway, IAiPromptRequest, IAiStream } from './ai-gateway.interface';
import { AiOrchestrator } from './ai-orchestrator';
import type { IAiPushEvent } from './ai-orchestrator';
import { AiHistory } from './ai-history';
import { TranscriptBuffer } from '../stt/transcript-buffer';

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

    beforeEach(() => {
        // Arrange (shared): fresh fakes, fake timers for the trailing-edge debounce assertions.
        vi.clearAllMocks();
        vi.useFakeTimers();
        gateway = new FakeAiGateway();
        buffer = new TranscriptBuffer(() => 0);
        history = new AiHistory(() => 0);
        pushed = [];
        orchestrator = new AiOrchestrator(gateway, buffer, history, (event: IAiPushEvent) => pushed.push(event));
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
