import { EventEmitter } from 'events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { IAiGateway, IAiPromptRequest, IAiStream } from './ai-gateway.interface';
import { AiOrchestrator, BURST_DEBOUNCE_MS, MAX_PENDING_QUEUE } from './ai-orchestrator';
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

    describe('empty-span guard (D-11/D-13)', () => {
        it('should NOT call gateway.stream when the recent span is empty', () => {
            // Arrange — buffer left empty.

            // Act
            orchestrator.trigger('answer');
            vi.advanceTimersByTime(BURST_DEBOUNCE_MS + 1);

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
            vi.advanceTimersByTime(BURST_DEBOUNCE_MS + 1);

            // Assert
            expect(gateway.stream).toHaveBeenCalledTimes(1);
        });
    });

    describe('double-press enqueues (D-02/SC1)', () => {
        it('should NOT abort the in-flight stream when the same mode is re-pressed', () => {
            // Arrange
            seedSpan(buffer, 'Tell me about a hard bug you fixed.');
            orchestrator.trigger('answer');
            vi.advanceTimersByTime(BURST_DEBOUNCE_MS + 1);

            // Act — re-press well after the burst window so it enqueues rather than collapsing.
            orchestrator.trigger('answer');
            vi.advanceTimersByTime(BURST_DEBOUNCE_MS + 1);

            // Assert — nothing cancels an in-flight stream (D-01).
            expect(gateway.abort).not.toHaveBeenCalled();
        });

        it('should stream both same-mode requests in sequence, the second only after the first is done', () => {
            // Arrange
            seedSpan(buffer, 'Tell me about a hard bug you fixed.');
            orchestrator.trigger('answer');
            vi.advanceTimersByTime(BURST_DEBOUNCE_MS + 1);

            // Act — a second same-mode press mid-stream enqueues (past the burst window).
            orchestrator.trigger('answer');
            vi.advanceTimersByTime(BURST_DEBOUNCE_MS + 1);

            // Assert — still only ONE stream in flight while the first runs (non-overlap).
            expect(gateway.stream).toHaveBeenCalledTimes(1);

            // Act — drive the first to a terminal; the queued second now starts.
            gateway.emit('done', 'first answer');

            // Assert — both streamed, sequentially.
            expect(gateway.stream).toHaveBeenCalledTimes(2);
            expect(gateway.abort).not.toHaveBeenCalled();
        });
    });

    describe('burst collapse (D-06/SC3)', () => {
        it('should collapse a rapid same-mode burst into a single stream call', () => {
            // Arrange
            seedSpan(buffer, 'How would you design a rate limiter?');

            // Act — several presses inside the burst window BEFORE advancing timers.
            orchestrator.trigger('answer');
            orchestrator.trigger('answer');
            orchestrator.trigger('answer');
            vi.advanceTimersByTime(BURST_DEBOUNCE_MS + 1);

            // Assert — one stream call, the burst collapsed.
            expect(gateway.stream).toHaveBeenCalledTimes(1);
        });

        it('should NOT collapse different modes fired in quick succession', () => {
            // Arrange
            seedSpan(buffer, 'We are discussing the reconciliation service.');

            // Act — different modes in the same window are distinct dedup keys (D-06).
            orchestrator.trigger('answer');
            orchestrator.trigger('talking-points');
            vi.advanceTimersByTime(BURST_DEBOUNCE_MS + 1);

            // Assert — the first flushed to a running stream; drive it and the second runs too.
            expect(gateway.stream).toHaveBeenCalledTimes(1);
            gateway.emit('done', 'first');
            expect(gateway.stream).toHaveBeenCalledTimes(2);
            expect(gateway.abort).not.toHaveBeenCalled();
        });
    });

    describe('cross-mode enqueues without cancelling (D-01/D-03)', () => {
        it('should NOT abort the current stream when the other mode is pressed mid-stream', () => {
            // Arrange
            seedSpan(buffer, 'We are discussing the reconciliation service.');
            orchestrator.trigger('answer');
            vi.advanceTimersByTime(BURST_DEBOUNCE_MS + 1);

            // Act — a different mode mid-stream enqueues (D-03), never aborts (D-01).
            orchestrator.trigger('talking-points');
            vi.advanceTimersByTime(BURST_DEBOUNCE_MS + 1);

            // Assert
            expect(gateway.abort).not.toHaveBeenCalled();
            expect(gateway.stream).toHaveBeenCalledTimes(1);
        });

        it('should run both modes in sequence when the in-flight stream finishes', () => {
            // Arrange
            seedSpan(buffer, 'We are discussing the reconciliation service.');
            orchestrator.trigger('answer');
            vi.advanceTimersByTime(BURST_DEBOUNCE_MS + 1);
            orchestrator.trigger('talking-points');
            vi.advanceTimersByTime(BURST_DEBOUNCE_MS + 1);

            // Act — finish the first; the queued talking-points runs next.
            gateway.emit('done', 'answer text');

            // Assert
            expect(gateway.stream).toHaveBeenCalledTimes(2);
            expect(gateway.abort).not.toHaveBeenCalled();
        });
    });

    describe('manual preempts queued autos (D-05/SC2)', () => {
        it('should run a later-enqueued manual before earlier-enqueued autos, without aborting the in-flight stream', () => {
            // Arrange — one manual runs; two autos then queue behind it.
            seedSpan(buffer, 'Discussing the ledger reconciliation flow.');
            orchestrator.trigger('answer', 'manual');
            vi.advanceTimersByTime(BURST_DEBOUNCE_MS + 1);
            orchestrator.trigger('answer', 'auto');
            vi.advanceTimersByTime(BURST_DEBOUNCE_MS + 1);
            orchestrator.trigger('answer', 'auto');
            vi.advanceTimersByTime(BURST_DEBOUNCE_MS + 1);

            // Act — a manual in a distinguishable mode enqueues at the head lane, then the in-flight finishes.
            orchestrator.trigger('talking-points', 'manual');
            vi.advanceTimersByTime(BURST_DEBOUNCE_MS + 1);
            expect(gateway.stream).toHaveBeenCalledTimes(1);
            gateway.emit('done', 'first answer');

            // Assert — the manual (talking-points) runs NEXT, ahead of the queued autos, no abort.
            expect(gateway.stream).toHaveBeenCalledTimes(2);
            const secondRequest = gateway.stream.mock.calls[1]?.[0] as IAiPromptRequest;
            expect(secondRequest.model).toBe('claude-opus-4-8');
            expect(gateway.abort).not.toHaveBeenCalled();
        });
    });

    describe('request-id guard / no cross-bleed (Pitfall 1 / D-11)', () => {
        it('should NOT attach request 1 late delta to request 2 after request 1 finished and request 2 started', () => {
            // Arrange — request 1 runs; request 2 queued behind it.
            seedSpan(buffer, 'First question about caching.');
            orchestrator.trigger('answer');
            vi.advanceTimersByTime(BURST_DEBOUNCE_MS + 1);
            orchestrator.trigger('answer');
            vi.advanceTimersByTime(BURST_DEBOUNCE_MS + 1);
            // Finish request 1 so request 2 is dequeued and started.
            gateway.emit('done', 'request one text');
            pushed.length = 0;

            // Act — a late delta from request 1 arrives while request 2 is the active request.
            gateway.emit('text', 'stale token from request one');
            vi.advanceTimersByTime(200);

            // Assert — the late delta does not surface as a delta on request 2's entry.
            const deltas = pushed.filter((event) => event.type === 'delta');
            expect(deltas.every((event) => !('text' in event) || !event.text.includes('stale token from request one'))).toBe(true);
        });
    });

    describe('hotkey-to-first-token latency logging (D-10)', () => {
        it('should log one main-log first-token line on the first text delta', () => {
            // Arrange
            const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
            seedSpan(buffer, 'How would you design a rate limiter?');
            orchestrator.trigger('answer');
            vi.advanceTimersByTime(BURST_DEBOUNCE_MS + 1);

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
            vi.advanceTimersByTime(BURST_DEBOUNCE_MS + 1);

            // Act
            gateway.emit('text', 'Bullet');

            // Assert
            const line = logSpy.mock.calls.map((call) => String(call[0])).find((message) => message.includes('[ai] first-token'));
            expect(line).toContain('mode=talking-points');
            expect(line).toContain('model=claude-opus-4-8');
            expect(line).toContain('latencyMs=');

            logSpy.mockRestore();
        });

        it('should log a fresh first-token line for each queued request as it runs', () => {
            // Arrange — two same-mode requests, the second queued behind the first.
            const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
            seedSpan(buffer, 'We are discussing the reconciliation service.');
            orchestrator.trigger('answer');
            vi.advanceTimersByTime(BURST_DEBOUNCE_MS + 1);
            orchestrator.trigger('talking-points');
            vi.advanceTimersByTime(BURST_DEBOUNCE_MS + 1);
            // First stream's first delta logs, then it finishes and the queued one starts.
            gateway.emit('text', 'Answer');
            gateway.emit('done', 'answer done');
            logSpy.mockClear();

            // Act — the newly-started queued stream's first delta arrives.
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
            vi.advanceTimersByTime(BURST_DEBOUNCE_MS + 1);

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
            vi.advanceTimersByTime(BURST_DEBOUNCE_MS + 1);

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
            vi.advanceTimersByTime(BURST_DEBOUNCE_MS + 1);
            const firstRequest = gateway.stream.mock.calls[0]?.[0] as IAiPromptRequest;

            // Act — a mid-session Save changes the provider's return, then the next trigger pulls it.
            activeContext = { notes: 'We use a write-through Redis cache.' };
            orchestrator.trigger('talking-points');
            vi.advanceTimersByTime(BURST_DEBOUNCE_MS + 1);
            gateway.emit('done', 'first');

            // Assert — the first trigger saw no context; the second pulled the freshly-saved context.
            expect(firstRequest.userContent).not.toContain('write-through Redis cache');
            const secondRequest = gateway.stream.mock.calls[1]?.[0] as IAiPromptRequest;
            expect(secondRequest.userContent).toContain('We use a write-through Redis cache.');
        });
    });

    describe('code-challenge vision mode (Phase 7 AI-03/D-07/D-11)', () => {
        it('should trigger even when the transcript span is empty (D-13 bypasses the empty-span guard)', async () => {
            // Arrange — buffer left empty; vision is actionable from the image alone.

            // Act
            orchestrator.trigger('code-challenge');
            await vi.advanceTimersByTimeAsync(BURST_DEBOUNCE_MS + 1);
            await vi.runAllTimersAsync();

            // Assert — capture ran and a stream started (no empty short-circuit).
            expect(captureImage).toHaveBeenCalledTimes(1);
            expect(gateway.stream).toHaveBeenCalledTimes(1);
        });

        it('should still short-circuit the text modes on an empty span (guard intact for non-vision)', () => {
            // Arrange — buffer left empty.

            // Act
            orchestrator.trigger('answer');
            vi.advanceTimersByTime(BURST_DEBOUNCE_MS + 1);

            // Assert
            expect(gateway.stream).not.toHaveBeenCalled();
            expect(captureImage).not.toHaveBeenCalled();
        });

        it('should route code-challenge to the Opus model with the vision image block', async () => {
            // Arrange — empty span is fine for vision.

            // Act
            orchestrator.trigger('code-challenge');
            await vi.advanceTimersByTimeAsync(BURST_DEBOUNCE_MS + 1);
            await vi.runAllTimersAsync();

            // Assert
            const request = gateway.stream.mock.calls[0]?.[0] as IAiPromptRequest;
            expect(request.model).toBe('claude-opus-4-8');
            expect(Array.isArray(request.userContent)).toBe(true);
        });

        it('should enqueue (NOT abort) an in-flight vision stream when code-challenge is re-pressed (D-02)', async () => {
            // Arrange
            orchestrator.trigger('code-challenge');
            await vi.advanceTimersByTimeAsync(BURST_DEBOUNCE_MS + 1);
            await vi.runAllTimersAsync();

            // Act — a re-press past the burst window enqueues a second vision request.
            orchestrator.trigger('code-challenge');
            await vi.advanceTimersByTimeAsync(BURST_DEBOUNCE_MS + 1);

            // Assert — nothing aborted; still one stream while the first runs.
            expect(gateway.abort).not.toHaveBeenCalled();
            expect(gateway.stream).toHaveBeenCalledTimes(1);
        });

        it('should enqueue (NOT abort) when a text mode is pressed mid-vision (D-03)', async () => {
            // Arrange
            seedSpan(buffer, 'The interviewer wants O(n).');
            orchestrator.trigger('code-challenge');
            await vi.advanceTimersByTimeAsync(BURST_DEBOUNCE_MS + 1);
            await vi.runAllTimersAsync();

            // Act
            orchestrator.trigger('answer');
            await vi.advanceTimersByTimeAsync(BURST_DEBOUNCE_MS + 1);

            // Assert — vision keeps running; nothing aborted.
            expect(gateway.abort).not.toHaveBeenCalled();
            expect(gateway.stream).toHaveBeenCalledTimes(1);

            // The queued answer runs after vision finishes.
            gateway.emit('done', 'vision solution');
            expect(gateway.stream).toHaveBeenCalledTimes(2);
        });

        it('should surface an inline error entry when capture fails (report-don\'t-throw)', async () => {
            // Arrange
            captureImage = vi.fn(() => Promise.reject(new Error('No screen source available.')));

            // Act
            orchestrator.trigger('code-challenge');
            await vi.advanceTimersByTimeAsync(BURST_DEBOUNCE_MS + 1);
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
            vi.advanceTimersByTime(BURST_DEBOUNCE_MS + 1);
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
            vi.advanceTimersByTime(BURST_DEBOUNCE_MS + 1);
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

    describe('bounded cap + drop-oldest-auto eviction (D-08/D-09/SC5)', () => {
        it('should never let the auto-inclusive pending count exceed the cap under auto overflow', () => {
            // Arrange — one manual runs and holds the in-flight slot so nothing drains.
            seedSpan(buffer, 'Discussing the ledger reconciliation flow.');
            orchestrator.trigger('talking-points', 'manual');
            vi.advanceTimersByTime(BURST_DEBOUNCE_MS + 1);
            expect(gateway.stream).toHaveBeenCalledTimes(1);

            // Act — overflow the auto lane well past the cap. Distinct modes avoid burst collapse.
            const overflow = MAX_PENDING_QUEUE + 4;
            for (let index = 0; index < overflow; index += 1) {
                const mode = index % 2 === 0 ? 'answer' : 'talking-points';
                orchestrator.trigger(mode, 'auto');
                vi.advanceTimersByTime(BURST_DEBOUNCE_MS + 1);
            }

            // Assert — drain every queued item; the number that ever streamed (beyond the running one)
            // is capped at MAX_PENDING_QUEUE, proving the auto lane never exceeded the cap.
            let guard = 0;
            while (gateway.stream.mock.calls.length < MAX_PENDING_QUEUE + 1 && guard < overflow + 5) {
                gateway.emit('done', 'done');
                guard += 1;
            }
            gateway.emit('done', 'done');
            expect(gateway.stream.mock.calls.length).toBeLessThanOrEqual(MAX_PENDING_QUEUE + 1);
        });

        it('should emit NO jedi:ai push for a silently-evicted auto item (D-09)', () => {
            // Arrange — a running manual holds the slot; queue autos past the cap.
            seedSpan(buffer, 'Discussing the ledger reconciliation flow.');
            orchestrator.trigger('talking-points', 'manual');
            vi.advanceTimersByTime(BURST_DEBOUNCE_MS + 1);
            const pushedCountBeforeOverflow = pushed.length;

            // Act — enqueue autos beyond the cap so the oldest autos are evicted.
            const overflow = MAX_PENDING_QUEUE + 3;
            for (let index = 0; index < overflow; index += 1) {
                const mode = index % 2 === 0 ? 'answer' : 'talking-points';
                orchestrator.trigger(mode, 'auto');
                vi.advanceTimersByTime(BURST_DEBOUNCE_MS + 1);
            }

            // Assert — eviction pushed NOTHING: no cancelled/dropped/error event appeared for evicted autos.
            const eventsSinceOverflow = pushed.slice(pushedCountBeforeOverflow);
            const evictionEvents = eventsSinceOverflow.filter((event) => event.type === 'cancelled' || event.type === 'error');
            expect(evictionEvents).toHaveLength(0);
        });

        it('should never evict a manual even when more manuals than the cap are enqueued (D-08)', () => {
            // Arrange — a running item holds the slot.
            seedSpan(buffer, 'Discussing the ledger reconciliation flow.');
            orchestrator.trigger('answer', 'manual');
            vi.advanceTimersByTime(BURST_DEBOUNCE_MS + 1);

            // Act — queue more MANUAL items than the cap; alternate modes to avoid burst collapse.
            const manualCount = MAX_PENDING_QUEUE + 3;
            for (let index = 0; index < manualCount; index += 1) {
                const mode = index % 2 === 0 ? 'answer' : 'talking-points';
                orchestrator.trigger(mode, 'manual');
                vi.advanceTimersByTime(BURST_DEBOUNCE_MS + 1);
            }

            // Assert — drain everything; all manuals (the running one + all queued) reach gateway.stream.
            let guard = 0;
            while (gateway.stream.mock.calls.length < manualCount + 1 && guard < manualCount + 5) {
                gateway.emit('done', 'done');
                guard += 1;
            }
            gateway.emit('done', 'done');
            expect(gateway.stream.mock.calls.length).toBe(manualCount + 1);
        });
    });
});
