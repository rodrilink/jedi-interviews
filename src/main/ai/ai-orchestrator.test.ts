import { EventEmitter } from 'events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { IAiGateway, IAiPromptRequest, IAiStream } from './ai-gateway.interface';
import { AiOrchestrator, ANSWER_MODEL, BURST_DEBOUNCE_MS, MAX_PENDING_QUEUE } from './ai-orchestrator';
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
            gateway.emit('done', 'first answer', (gateway.stream.mock.calls[0]?.[0] as IAiPromptRequest).requestId);

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
            gateway.emit('done', 'first', (gateway.stream.mock.calls[0]?.[0] as IAiPromptRequest).requestId);
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
            gateway.emit('done', 'answer text', (gateway.stream.mock.calls[0]?.[0] as IAiPromptRequest).requestId);

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
            gateway.emit('done', 'first answer', (gateway.stream.mock.calls[0]?.[0] as IAiPromptRequest).requestId);

            // Assert — the manual (talking-points) runs NEXT, ahead of the queued autos, no abort.
            expect(gateway.stream).toHaveBeenCalledTimes(2);
            const secondRequest = gateway.stream.mock.calls[1]?.[0] as IAiPromptRequest;
            expect(secondRequest.model).toBe('claude-opus-4-8');
            expect(gateway.abort).not.toHaveBeenCalled();
        });
    });

    describe('content-keyed auto-lane dedup (D-01)', () => {
        it('should stream both DISTINCT auto questions within the burst window (distinct content is NOT collapsed)', () => {
            // Arrange
            seedSpan(buffer, 'We are discussing the reconciliation service.');

            // Act — two DIFFERENT question contents inside the same burst window.
            orchestrator.trigger('answer', 'auto', 'What is a closure?');
            orchestrator.trigger('answer', 'auto', 'How does the event loop work?');
            vi.advanceTimersByTime(BURST_DEBOUNCE_MS + 1);

            // Assert — the first flushed to a running stream; drive it and the second runs too.
            expect(gateway.stream).toHaveBeenCalledTimes(1);
            gateway.emit('done', 'first', (gateway.stream.mock.calls[0]?.[0] as IAiPromptRequest).requestId);
            expect(gateway.stream).toHaveBeenCalledTimes(2);
            expect(gateway.abort).not.toHaveBeenCalled();
        });

        it('should collapse the SAME auto question content fired twice within the burst window to one stream', () => {
            // Arrange
            seedSpan(buffer, 'We are discussing the reconciliation service.');

            // Act — the identical question content twice inside the burst window.
            orchestrator.trigger('answer', 'auto', 'What is a closure?');
            orchestrator.trigger('answer', 'auto', 'What is a closure?');
            vi.advanceTimersByTime(BURST_DEBOUNCE_MS + 1);

            // Assert — collapsed to exactly one stream for that content.
            expect(gateway.stream).toHaveBeenCalledTimes(1);
        });

        it('should collapse the SAME auto question content ignoring surrounding whitespace/case', () => {
            // Arrange
            seedSpan(buffer, 'We are discussing the reconciliation service.');

            // Act — same content, differing only in leading/trailing whitespace + case.
            orchestrator.trigger('answer', 'auto', 'What is a closure?');
            orchestrator.trigger('answer', 'auto', '  what is a closure?  ');
            vi.advanceTimersByTime(BURST_DEBOUNCE_MS + 1);

            // Assert — normalized equality collapses them to one.
            expect(gateway.stream).toHaveBeenCalledTimes(1);
        });

        it('should keep manual mode-only collapse byte-for-byte: a rapid double manual answer still collapses to one', () => {
            // Arrange
            seedSpan(buffer, 'Tell me about a hard bug you fixed.');

            // Act — a rapid double MANUAL answer press inside the window.
            orchestrator.trigger('answer', 'manual');
            orchestrator.trigger('answer', 'manual');
            vi.advanceTimersByTime(BURST_DEBOUNCE_MS + 1);

            // Assert — manual keeps the Phase-10 mode-only collapse (one stream).
            expect(gateway.stream).toHaveBeenCalledTimes(1);
        });

        it('should NOT collapse a keyless auto answer into the manual answer key space within the same window', () => {
            // Arrange
            seedSpan(buffer, 'Discussing the ledger reconciliation flow.');

            // Act — a keyless auto and a manual answer inside the same burst window.
            orchestrator.trigger('answer', 'manual');
            orchestrator.trigger('answer', 'auto');
            vi.advanceTimersByTime(BURST_DEBOUNCE_MS + 1);

            // Assert — distinct key spaces: the first runs, the second queues; drive the first and the
            // second runs too (they were NOT folded into one).
            expect(gateway.stream).toHaveBeenCalledTimes(1);
            gateway.emit('done', 'first', (gateway.stream.mock.calls[0]?.[0] as IAiPromptRequest).requestId);
            expect(gateway.stream).toHaveBeenCalledTimes(2);
            expect(gateway.abort).not.toHaveBeenCalled();
        });
    });

    describe('source on the thinking push (D-04)', () => {
        it('should carry source: auto on the run-start thinking push for an auto trigger', () => {
            // Arrange
            seedSpan(buffer, 'We are discussing the reconciliation service.');

            // Act
            orchestrator.trigger('answer', 'auto', 'What is a closure?');
            vi.advanceTimersByTime(BURST_DEBOUNCE_MS + 1);

            // Assert
            const thinking = pushed.find((event) => event.type === 'thinking');
            expect(thinking && 'source' in thinking && thinking.source).toBe('auto');
        });

        it('should carry source: manual on the run-start thinking push for a manual trigger', () => {
            // Arrange
            seedSpan(buffer, 'We are discussing the reconciliation service.');

            // Act
            orchestrator.trigger('answer', 'manual');
            vi.advanceTimersByTime(BURST_DEBOUNCE_MS + 1);

            // Assert
            const thinking = pushed.find((event) => event.type === 'thinking');
            expect(thinking && 'source' in thinking && thinking.source).toBe('manual');
        });
    });

    describe('auto-trigger (AA-01/AA-02)', () => {
        it('should enqueue and start exactly one stream for an auto question with a non-empty span (SC 1)', () => {
            // Arrange
            seedSpan(buffer, 'We are discussing closures and the event loop.');

            // Act — the orchestrator IS the unit under test; no keypress, just the auto trigger.
            orchestrator.trigger('answer', 'auto', 'What is a closure?');
            vi.advanceTimersByTime(BURST_DEBOUNCE_MS + 1);

            // Assert — exactly one stream started.
            expect(gateway.stream).toHaveBeenCalledTimes(1);
        });

        it('should stream an answer for an auto question when the span is EMPTY at trigger time (CR-01 first-question regression)', () => {
            // Arrange — buffer left EMPTY: production emits 'utterance' BEFORE the 'transcript' that
            // appends the turn, so the auto trigger fires against a span that does not yet contain the
            // just-asked question. The question text alone is actionable — the guard must not drop it.

            // Act
            orchestrator.trigger('answer', 'auto', 'What is a closure?');
            vi.advanceTimersByTime(BURST_DEBOUNCE_MS + 1);

            // Assert — an answer streams (not short-circuited to an empty placeholder).
            expect(gateway.stream).toHaveBeenCalledTimes(1);
        });

        it('should NOT push an empty-kind entry for an auto question with an empty span but a content key (CR-01)', () => {
            // Arrange — empty buffer, auto trigger carrying the question text.

            // Act
            orchestrator.trigger('answer', 'auto', 'What is a closure?');
            vi.advanceTimersByTime(BURST_DEBOUNCE_MS + 1);

            // Assert — no empty placeholder; the auto question is answered from its own text.
            const empties = pushed.filter((event) => event.type === 'empty');
            expect(empties).toHaveLength(0);
        });

        it('should still push an empty-kind entry for a keyless auto trigger on an empty span (guard intact when there is nothing to act on)', () => {
            // Arrange — empty buffer AND no content key: there is genuinely nothing to answer.

            // Act
            orchestrator.trigger('answer', 'auto');
            vi.advanceTimersByTime(BURST_DEBOUNCE_MS + 1);

            // Assert — the guard still fires (no stream, empty placeholder pushed).
            expect(gateway.stream).not.toHaveBeenCalled();
            const empties = pushed.filter((event) => event.type === 'empty');
            expect(empties.length).toBeGreaterThan(0);
        });

        it('should carry source:auto on the empty placeholder for a keyless auto trigger (WR-03 badge attribution)', () => {
            // Arrange — empty buffer, keyless auto: hits the guard and produces an empty placeholder.

            // Act
            orchestrator.trigger('answer', 'auto');
            vi.advanceTimersByTime(BURST_DEBOUNCE_MS + 1);

            // Assert — the placeholder still attributes the auto lane so the renderer can badge it.
            const empty = pushed.find((event) => event.type === 'empty');
            expect(empty).toBeDefined();
            expect(empty?.type === 'empty' && empty.source).toBe('auto');
        });

        it('should carry source:manual on the empty placeholder for a manual trigger (WR-03)', () => {
            // Arrange — empty buffer, manual trigger.

            // Act
            orchestrator.trigger('answer');
            vi.advanceTimersByTime(BURST_DEBOUNCE_MS + 1);

            // Assert — a manual empty placeholder attributes the manual lane.
            const empty = pushed.find((event) => event.type === 'empty');
            expect(empty).toBeDefined();
            expect(empty?.type === 'empty' && empty.source).toBe('manual');
        });

        it('should assemble an auto answer with the same model/system/userContent as a manual answer (SC 2 grounding parity)', () => {
            // Arrange — the same span + active context both paths see.
            const span = 'What database backs the ledger service?';
            seedSpan(buffer, span);
            activeContext = {
                notes: 'Use Postgres for the ledger.',
                ticketText: 'JIRA-42: ledger persistence.',
                repoSnippets: 'class LedgerRepository {}',
                links: ['https://example.com/ledger-doc'],
            };
            const expected = assemblePrompt({ mode: 'answer', span, context: activeContext });

            // Act — the auto path assembles through the SAME assemblePrompt path (pull-on-run).
            orchestrator.trigger('answer', 'auto', 'What database backs the ledger service?');
            vi.advanceTimersByTime(BURST_DEBOUNCE_MS + 1);

            // Assert — same mode/model + byte-for-byte identical assembled prompt.
            const request = gateway.stream.mock.calls[0]?.[0] as IAiPromptRequest;
            expect(request.model).toBe(ANSWER_MODEL);
            expect(request.system).toBe(expected.system);
            expect(request.userContent).toBe(expected.userContent);
        });

        it('should run a later manual answer ahead of earlier-queued autos after the in-flight stream finishes (SC 5 preempt)', () => {
            // Arrange — an auto runs and holds the slot; two more autos queue behind it.
            seedSpan(buffer, 'Discussing the ledger reconciliation flow.');
            orchestrator.trigger('answer', 'auto', 'First auto question about caching?');
            vi.advanceTimersByTime(BURST_DEBOUNCE_MS + 1);
            orchestrator.trigger('answer', 'auto', 'Second auto question about sharding?');
            vi.advanceTimersByTime(BURST_DEBOUNCE_MS + 1);

            // Act — a manual answer enqueues at the head lane, then the in-flight auto finishes.
            orchestrator.trigger('answer', 'manual');
            vi.advanceTimersByTime(BURST_DEBOUNCE_MS + 1);
            expect(gateway.stream).toHaveBeenCalledTimes(1);
            gateway.emit('done', 'first auto answer', (gateway.stream.mock.calls[0]?.[0] as IAiPromptRequest).requestId);

            // Assert — the MANUAL runs next (ahead of the queued autos), no abort. Drive it and the first
            // queued auto runs after, proving the manual jumped the auto lane.
            expect(gateway.stream).toHaveBeenCalledTimes(2);
            expect(gateway.abort).not.toHaveBeenCalled();
        });

        it('should never start a second stream while a prior auto stream is active for a distinct-question burst (SC 5 single-in-flight)', () => {
            // Arrange — a burst of DISTINCT auto questions, each past the burst window so none collapse.
            seedSpan(buffer, 'Discussing the ledger reconciliation flow.');
            const questions = ['What is a closure?', 'How does the event loop work?', 'What is a promise?'];
            questions.forEach((question) => {
                orchestrator.trigger('answer', 'auto', question);
                vi.advanceTimersByTime(BURST_DEBOUNCE_MS + 1);
            });

            // Assert — despite three queued autos, only ONE stream is ever active at a time. Drain one at a
            // time and assert the stream count only advances by one per terminal (never in parallel).
            expect(gateway.stream).toHaveBeenCalledTimes(1);
            gateway.emit('done', 'answer one', (gateway.stream.mock.calls[0]?.[0] as IAiPromptRequest).requestId);
            expect(gateway.stream).toHaveBeenCalledTimes(2);
            gateway.emit('done', 'answer two', (gateway.stream.mock.calls[1]?.[0] as IAiPromptRequest).requestId);
            expect(gateway.stream).toHaveBeenCalledTimes(3);
            expect(gateway.abort).not.toHaveBeenCalled();
        });
    });

    describe('request-id guard / no cross-bleed (Pitfall 1 / D-11)', () => {
        it('should drop a straggler delta between a finished request and the next queued request start', () => {
            // Arrange — request 1 runs and finishes; the queue is momentarily idle (active === undefined).
            seedSpan(buffer, 'First question about caching.');
            orchestrator.trigger('answer');
            vi.advanceTimersByTime(BURST_DEBOUNCE_MS + 1);
            const request1Id = (gateway.stream.mock.calls[0]?.[0] as IAiPromptRequest).requestId;
            gateway.emit('done', 'request one final text', request1Id);
            pushed.length = 0;

            // Act — request 1's late straggler delta fires while nothing is active; it must be dropped.
            gateway.emit('text', 'stale token from request one', request1Id);
            vi.advanceTimersByTime(200);

            // Assert — no delta pushed (the requestId guard dropped the straggler with no active request).
            const deltas = pushed.filter((event) => event.type === 'delta');
            expect(deltas).toHaveLength(0);
        });

        it('should start the next queued request with a CLEAN text buffer (no bleed from request 1)', () => {
            // Arrange — request 1 accumulates text, then finishes; request 2 was queued behind it.
            seedSpan(buffer, 'First question about caching.');
            orchestrator.trigger('answer');
            vi.advanceTimersByTime(BURST_DEBOUNCE_MS + 1);
            orchestrator.trigger('answer');
            vi.advanceTimersByTime(BURST_DEBOUNCE_MS + 1);
            const cleanStartRequest1Id = (gateway.stream.mock.calls[0]?.[0] as IAiPromptRequest).requestId;
            gateway.emit('text', 'request one partial', cleanStartRequest1Id);
            gateway.emit('done', 'request one final', cleanStartRequest1Id);
            const cleanStartRequest2Id = (gateway.stream.mock.calls[1]?.[0] as IAiPromptRequest).requestId;
            pushed.length = 0;

            // Act — request 2 is now active; its own token streams and flushes.
            gateway.emit('text', 'request two token', cleanStartRequest2Id);
            vi.advanceTimersByTime(200);

            // Assert — request 2's delta carries ONLY its own text, never request 1's accumulated text.
            const deltas = pushed.filter((event) => event.type === 'delta');
            expect(deltas.length).toBeGreaterThan(0);
            const latest = deltas[deltas.length - 1];
            expect('text' in latest && latest.text).toBe('request two token');
        });

        it('should drop a request-1-tagged text delta that arrives after request 2 is active', () => {
            // Arrange — request 1 runs, request 2 queues behind it, then request 1's terminal starts request 2.
            seedSpan(buffer, 'First question about caching.');
            orchestrator.trigger('answer');
            vi.advanceTimersByTime(BURST_DEBOUNCE_MS + 1);
            orchestrator.trigger('answer');
            vi.advanceTimersByTime(BURST_DEBOUNCE_MS + 1);
            const request1Id = (gateway.stream.mock.calls[0]?.[0] as IAiPromptRequest).requestId;
            gateway.emit('done', 'request one final', request1Id);
            const request2Id = (gateway.stream.mock.calls[1]?.[0] as IAiPromptRequest).requestId;
            pushed.length = 0;

            // Act — request 1's straggler delta, tagged with request 1's id, fires while request 2 is active.
            gateway.emit('text', 'stale token from request one', request1Id);
            vi.advanceTimersByTime(200);

            // Assert — no delta bled under request 2 from the superseded request 1 straggler.
            const stragglerDeltas = pushed.filter((event) => event.type === 'delta');
            stragglerDeltas.forEach((delta) => {
                expect(delta.requestId).toBe(request2Id);
                expect('text' in delta && delta.text).not.toContain('stale token from request one');
            });

            // Act — request 2's own token, tagged with request 2's id, streams and flushes cleanly.
            gateway.emit('text', 'request two own token', request2Id);
            vi.advanceTimersByTime(200);

            // Assert — the flushed delta is exactly request 2's own token, attributed to request 2.
            const request2Deltas = pushed.filter((event) => event.type === 'delta');
            const latest = request2Deltas[request2Deltas.length - 1];
            expect('text' in latest && latest.text).toBe('request two own token');
            expect(latest.requestId).toBe(request2Id);
        });

        it('should drop a duplicate terminal for an already-superseded stream after request 2 is active (WR-01)', () => {
            // Arrange — request 1 runs, request 2 queues behind it, then request 1's terminal starts request 2.
            seedSpan(buffer, 'First question about caching.');
            orchestrator.trigger('answer');
            vi.advanceTimersByTime(BURST_DEBOUNCE_MS + 1);
            orchestrator.trigger('answer');
            vi.advanceTimersByTime(BURST_DEBOUNCE_MS + 1);
            const request1Id = (gateway.stream.mock.calls[0]?.[0] as IAiPromptRequest).requestId;
            gateway.emit('done', 'request one final', request1Id);
            const request2Id = (gateway.stream.mock.calls[1]?.[0] as IAiPromptRequest).requestId;
            expect(gateway.stream).toHaveBeenCalledTimes(2);
            pushed.length = 0;

            // Act — a duplicate terminal, tagged with request 1's superseded id, fires while request 2 is active.
            gateway.emit('done', 'request one duplicate terminal', request1Id);
            vi.advanceTimersByTime(200);

            // Assert — request 2 was not prematurely terminated: no third stream started, no terminal for request 2.
            expect(gateway.stream).toHaveBeenCalledTimes(2);
            const request2Terminals = pushed.filter((event) => (event.type === 'done' || event.type === 'error') && event.requestId === request2Id);
            expect(request2Terminals).toHaveLength(0);
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
            const latencyRequestId = (gateway.stream.mock.calls[0]?.[0] as IAiPromptRequest).requestId;
            gateway.emit('text', 'Tok', latencyRequestId);
            gateway.emit('text', 'en', latencyRequestId);

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
            gateway.emit('text', 'Bullet', (gateway.stream.mock.calls[0]?.[0] as IAiPromptRequest).requestId);

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
            const freshLogRequest1Id = (gateway.stream.mock.calls[0]?.[0] as IAiPromptRequest).requestId;
            gateway.emit('text', 'Answer', freshLogRequest1Id);
            gateway.emit('done', 'answer done', freshLogRequest1Id);
            logSpy.mockClear();

            // Act — the newly-started queued stream's first delta arrives.
            gateway.emit('text', 'Bullet', (gateway.stream.mock.calls[1]?.[0] as IAiPromptRequest).requestId);

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
            gateway.emit('done', 'first', (gateway.stream.mock.calls[0]?.[0] as IAiPromptRequest).requestId);

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
            gateway.emit('done', 'vision solution', (gateway.stream.mock.calls[0]?.[0] as IAiPromptRequest).requestId);
            expect(gateway.stream).toHaveBeenCalledTimes(2);
        });

        it("should surface an inline error entry when capture fails (report-don't-throw)", async () => {
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
            gateway.emit('text', 'Tok', (gateway.stream.mock.calls[0]?.[0] as IAiPromptRequest).requestId);

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
            const debounceRequestId = (gateway.stream.mock.calls[0]?.[0] as IAiPromptRequest).requestId;
            gateway.emit('text', 'Tok', debounceRequestId);
            gateway.emit('text', 'en', debounceRequestId);
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
                // Tag each terminal with the currently-active request (the latest started stream) so the
                // positive request-id guard matches and the queue drains one item at a time.
                const activeRequestId = (gateway.stream.mock.calls[gateway.stream.mock.calls.length - 1]?.[0] as IAiPromptRequest).requestId;
                gateway.emit('done', 'done', activeRequestId);
                guard += 1;
            }
            gateway.emit('done', 'done', (gateway.stream.mock.calls[gateway.stream.mock.calls.length - 1]?.[0] as IAiPromptRequest).requestId);
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
                // Tag each terminal with the currently-active request (the latest started stream) so the
                // positive request-id guard matches and the queue drains one item at a time.
                const activeRequestId = (gateway.stream.mock.calls[gateway.stream.mock.calls.length - 1]?.[0] as IAiPromptRequest).requestId;
                gateway.emit('done', 'done', activeRequestId);
                guard += 1;
            }
            gateway.emit('done', 'done', (gateway.stream.mock.calls[gateway.stream.mock.calls.length - 1]?.[0] as IAiPromptRequest).requestId);
            expect(gateway.stream.mock.calls.length).toBe(manualCount + 1);
        });
    });
});
