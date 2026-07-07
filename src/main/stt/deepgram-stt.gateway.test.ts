import { EventEmitter } from 'events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ISttTranscriptEvent, IUtteranceEvent, SttConnectionState } from './stt-provider.interface';

/** Local listener aliases for the gateway's typed events (the interface declares these inline). */
type ISttTranscriptListener = (transcriptEvent: ISttTranscriptEvent) => void;
type ISttConnectionStateListener = (state: SttConnectionState) => void;
type ISttErrorListener = (error: Error) => void;
type IUtteranceListener = (utterance: IUtteranceEvent) => void;

/**
 * In-memory stand-in for the Deepgram v5 `V1Socket`. The real socket is an event emitter
 * exposing `on('open' | 'message' | 'close' | 'error')` plus `sendMedia`/`sendKeepAlive`/
 * `sendCloseStream`/`close`. We back it with a real EventEmitter so the gateway's actual
 * `connection.on(...)` wiring is exercised, and expose the send methods as spies so tests can
 * assert PCM/keep-alive/teardown calls (mirrors the FakeUiohook pattern in
 * hotkey-registrar.service.test.ts).
 */
class FakeV1Socket extends EventEmitter {
    public readonly sendMedia = vi.fn<(message: ArrayBuffer | ArrayBufferView) => void>();
    public readonly sendKeepAlive = vi.fn<(message: object) => void>();
    public readonly sendCloseStream = vi.fn<(message: object) => void>();
    public readonly connect = vi.fn<() => void>();
    public readonly waitForOpen = vi.fn<() => Promise<unknown>>(() => Promise.resolve(undefined));
    public readonly close = vi.fn<() => void>();

    /**
     * The gateway uses `connection.on(event, cb)`; Node's EventEmitter `.on` returns `this`,
     * whereas Deepgram's returns `void`. The gateway never relies on the return value, so the
     * inherited EventEmitter `.on` is a faithful stand-in.
     */
}

let fakeSocket: FakeV1Socket;
const mockConnect = vi.fn<(options?: Record<string, unknown>) => Promise<FakeV1Socket>>();
const mockDeepgramClientConstructor = vi.fn<(options: { apiKey: string }) => void>();

vi.mock('@deepgram/sdk', () => ({
    DeepgramClient: class {
        public readonly listen = {
            v1: {
                connect: (options?: Record<string, unknown>): Promise<FakeV1Socket> => mockConnect(options),
            },
        };

        public constructor(options: { apiKey: string }) {
            mockDeepgramClientConstructor(options);
        }
    },
}));

const FAKE_API_KEY = 'dg-fake-test-key-do-not-log-0123456789';

/** Emits a Deepgram `message` carrying a single alternative transcript with the given finality. */
function emitTranscriptMessage(transcript: string, isFinal: boolean): void {
    fakeSocket.emit('message', {
        type: 'Results',
        is_final: isFinal,
        channel: { alternatives: [{ transcript }] },
    });
}

/**
 * Emits a Deepgram `Results` message, optionally carrying `speech_final` and per-word diarization
 * indices — the extended shape the diarized-utterance path consumes.
 */
function emitResultsMessage(
    transcript: string,
    isFinal: boolean,
    options?: {
        speechFinal?: boolean;
        words?: Array<{ punctuated_word?: string; word?: string; speaker?: number }>;
    }
): void {
    fakeSocket.emit('message', {
        type: 'Results',
        is_final: isFinal,
        speech_final: options?.speechFinal,
        channel: { alternatives: [{ transcript, words: options?.words }] },
    });
}

/** Emits a Deepgram `UtteranceEnd` message — the end-of-turn fallback finalization signal. */
function emitUtteranceEnd(): void {
    fakeSocket.emit('message', { type: 'UtteranceEnd', channel: [0], last_word_end: 1.2 });
}

describe('deepgram-stt.gateway', () => {
    beforeEach(() => {
        // Arrange (shared): reset spies, re-create the fake socket, and make connect resolve it.
        vi.clearAllMocks();
        vi.useFakeTimers();
        fakeSocket = new FakeV1Socket();
        mockConnect.mockResolvedValue(fakeSocket);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('should construct DeepgramClient with the configured api key', async () => {
        // Arrange
        const { DeepgramSttGateway } = await import('./deepgram-stt.gateway');
        const gateway = new DeepgramSttGateway(FAKE_API_KEY);

        // Act
        await gateway.start();

        // Assert
        expect(mockDeepgramClientConstructor).toHaveBeenCalledWith({ apiKey: FAKE_API_KEY });
    });

    it('should emit connecting then connected when the socket opens', async () => {
        // Arrange
        const { DeepgramSttGateway } = await import('./deepgram-stt.gateway');
        const gateway = new DeepgramSttGateway(FAKE_API_KEY);
        const states: SttConnectionState[] = [];
        const stateListener: ISttConnectionStateListener = (state: SttConnectionState): void => {
            states.push(state);
        };
        gateway.on('connection-state-change', stateListener);

        // Act
        await gateway.start();
        fakeSocket.emit('open');

        // Assert
        expect(states).toContain('connecting');
        expect(states).toContain('connected');
        expect(states.indexOf('connecting')).toBeLessThan(states.indexOf('connected'));
    });

    it('should explicitly open the socket (connect) after attaching handlers', async () => {
        // Arrange
        const { DeepgramSttGateway } = await import('./deepgram-stt.gateway');
        const gateway = new DeepgramSttGateway(FAKE_API_KEY);

        // Act
        await gateway.start();

        // Assert
        expect(fakeSocket.connect).toHaveBeenCalledTimes(1);
    });

    it('should emit an interim transcript when is_final is falsy', async () => {
        // Arrange
        const { DeepgramSttGateway } = await import('./deepgram-stt.gateway');
        const gateway = new DeepgramSttGateway(FAKE_API_KEY);
        const transcripts: ISttTranscriptEvent[] = [];
        const transcriptListener: ISttTranscriptListener = (transcriptEvent: ISttTranscriptEvent): void => {
            transcripts.push(transcriptEvent);
        };
        gateway.on('transcript', transcriptListener);

        // Act
        await gateway.start();
        fakeSocket.emit('open');
        emitTranscriptMessage('hello', false);

        // Assert
        expect(transcripts).toEqual([{ text: 'hello', isFinal: false }]);
    });

    it('should commit the turn AND re-emit it as a final transcript on speech_final', async () => {
        // Arrange
        const { DeepgramSttGateway } = await import('./deepgram-stt.gateway');
        const gateway = new DeepgramSttGateway(FAKE_API_KEY);
        const transcripts: ISttTranscriptEvent[] = [];
        const utterances: IUtteranceEvent[] = [];
        const transcriptListener: ISttTranscriptListener = (transcriptEvent: ISttTranscriptEvent): void => {
            transcripts.push(transcriptEvent);
        };
        const utteranceListener: IUtteranceListener = (utterance: IUtteranceEvent): void => {
            utterances.push(utterance);
        };
        gateway.on('transcript', transcriptListener);
        gateway.on('utterance', utteranceListener);

        // Act
        await gateway.start();
        fakeSocket.emit('open');
        emitResultsMessage('final words', true, { speechFinal: true });

        // Assert
        expect(transcripts).toEqual([
            { text: 'final words', isFinal: false },
            { text: 'final words', isFinal: true },
        ]);
        expect(utterances).toEqual([{ text: 'final words', speaker: 'Speaker', isDiarized: false, classification: 'statement' }]);
    });

    it('should re-emit the committed turn as a final transcript so the buffer feed is non-empty (CR-01 regression)', async () => {
        // Arrange
        const { DeepgramSttGateway } = await import('./deepgram-stt.gateway');
        const gateway = new DeepgramSttGateway(FAKE_API_KEY);
        const transcripts: ISttTranscriptEvent[] = [];
        const utterances: IUtteranceEvent[] = [];
        const transcriptListener: ISttTranscriptListener = (transcriptEvent: ISttTranscriptEvent): void => {
            transcripts.push(transcriptEvent);
        };
        const utteranceListener: IUtteranceListener = (utterance: IUtteranceEvent): void => {
            utterances.push(utterance);
        };
        gateway.on('transcript', transcriptListener);
        gateway.on('utterance', utteranceListener);

        // Act
        await gateway.start();
        fakeSocket.emit('open');
        emitResultsMessage('how are', true, { words: [{ speaker: 0 }, { speaker: 0 }] });
        emitResultsMessage('you doing?', true, { speechFinal: true, words: [{ speaker: 0 }, { speaker: 0 }] });

        // Assert
        expect(utterances).toHaveLength(1);
        expect(transcripts.filter((transcriptEvent) => transcriptEvent.isFinal)).toEqual([{ text: 'how are you doing?', isFinal: true }]);
    });

    it('should keep the interim line showing the whole turn-so-far across multiple is_final runs (grey-continuity regression)', async () => {
        // Arrange
        const { DeepgramSttGateway } = await import('./deepgram-stt.gateway');
        const gateway = new DeepgramSttGateway(FAKE_API_KEY);
        const interims: string[] = [];
        const transcriptListener: ISttTranscriptListener = (transcriptEvent: ISttTranscriptEvent): void => {
            if (!transcriptEvent.isFinal) {
                interims.push(transcriptEvent.text);
            }
        };
        gateway.on('transcript', transcriptListener);

        // Act
        await gateway.start();
        fakeSocket.emit('open');
        emitResultsMessage('hello', false);
        emitResultsMessage('hello there', true, { words: [{ speaker: 0 }] });
        emitResultsMessage('how', false);
        emitResultsMessage('how are you', true, { speechFinal: true, words: [{ speaker: 0 }] });

        // Assert
        expect(interims).toEqual(['hello', 'hello there', 'hello there how', 'hello there how are you']);
    });

    it('should re-emit a final transcript on an UtteranceEnd-fallback commit', async () => {
        // Arrange
        const { DeepgramSttGateway } = await import('./deepgram-stt.gateway');
        const gateway = new DeepgramSttGateway(FAKE_API_KEY);
        const transcripts: ISttTranscriptEvent[] = [];
        const utterances: IUtteranceEvent[] = [];
        const transcriptListener: ISttTranscriptListener = (transcriptEvent: ISttTranscriptEvent): void => {
            transcripts.push(transcriptEvent);
        };
        const utteranceListener: IUtteranceListener = (utterance: IUtteranceEvent): void => {
            utterances.push(utterance);
        };
        gateway.on('transcript', transcriptListener);
        gateway.on('utterance', utteranceListener);

        // Act
        await gateway.start();
        fakeSocket.emit('open');
        emitResultsMessage('a pending turn', true, { words: [{ speaker: 0 }] });
        emitUtteranceEnd();

        // Assert
        expect(utterances).toHaveLength(1);
        expect(transcripts.filter((transcriptEvent) => transcriptEvent.isFinal)).toEqual([{ text: 'a pending turn', isFinal: true }]);
    });

    it('should NOT emit a final transcript for a whitespace-only committed turn', async () => {
        // Arrange
        const { DeepgramSttGateway } = await import('./deepgram-stt.gateway');
        const gateway = new DeepgramSttGateway(FAKE_API_KEY);
        const transcripts: ISttTranscriptEvent[] = [];
        const transcriptListener: ISttTranscriptListener = (transcriptEvent: ISttTranscriptEvent): void => {
            transcripts.push(transcriptEvent);
        };
        gateway.on('transcript', transcriptListener);

        // Act
        await gateway.start();
        fakeSocket.emit('open');
        emitResultsMessage('   ', true, { speechFinal: true, words: [{ speaker: 0 }] });

        // Assert
        expect(transcripts.filter((transcriptEvent) => transcriptEvent.isFinal)).toEqual([]);
    });

    it('should not emit a transcript for an empty-text message', async () => {
        // Arrange
        const { DeepgramSttGateway } = await import('./deepgram-stt.gateway');
        const gateway = new DeepgramSttGateway(FAKE_API_KEY);
        const transcriptListener: ISttTranscriptListener = vi.fn<(transcriptEvent: ISttTranscriptEvent) => void>();
        gateway.on('transcript', transcriptListener);

        // Act
        await gateway.start();
        fakeSocket.emit('open');
        emitTranscriptMessage('', true);

        // Assert
        expect(transcriptListener).not.toHaveBeenCalled();
    });

    it('should not throw and emit error when the socket reports an error', async () => {
        // Arrange
        const { DeepgramSttGateway } = await import('./deepgram-stt.gateway');
        const gateway = new DeepgramSttGateway(FAKE_API_KEY);
        const errors: Error[] = [];
        const errorListener: ISttErrorListener = (error: Error): void => {
            errors.push(error);
        };
        gateway.on('error', errorListener);
        const socketError: Error = new Error('transport failure');

        // Act
        await gateway.start();
        const emitError = (): void => {
            fakeSocket.emit('error', socketError);
        };

        // Assert
        expect(emitError).not.toThrow();
        expect(errors).toEqual([socketError]);
    });

    it('should enter reconnecting and schedule a reconnect after a close', async () => {
        // Arrange
        const { DeepgramSttGateway } = await import('./deepgram-stt.gateway');
        const gateway = new DeepgramSttGateway(FAKE_API_KEY);
        const states: SttConnectionState[] = [];
        const stateListener: ISttConnectionStateListener = (state: SttConnectionState): void => {
            states.push(state);
        };
        gateway.on('connection-state-change', stateListener);

        // Act
        await gateway.start();
        fakeSocket.emit('open');
        const connectCallsAfterStart: number = mockConnect.mock.calls.length;
        fakeSocket.emit('close', { code: 1006 });
        await vi.advanceTimersByTimeAsync(10_000);

        // Assert
        expect(states).toContain('reconnecting');
        expect(mockConnect.mock.calls.length).toBeGreaterThan(connectCallsAfterStart);
    });

    it('should drop PCM via early-return when not connected', async () => {
        // Arrange
        const { DeepgramSttGateway } = await import('./deepgram-stt.gateway');
        const gateway = new DeepgramSttGateway(FAKE_API_KEY);
        const pcm: Int16Array = new Int16Array([1, 2, 3, 4]);

        // Act
        await gateway.start();
        gateway.sendAudio(pcm);

        // Assert
        expect(fakeSocket.sendMedia).not.toHaveBeenCalled();
    });

    it('should forward PCM to sendMedia once connected', async () => {
        // Arrange
        const { DeepgramSttGateway } = await import('./deepgram-stt.gateway');
        const gateway = new DeepgramSttGateway(FAKE_API_KEY);
        const pcm: Int16Array = new Int16Array([10, 20, 30]);

        // Act
        await gateway.start();
        fakeSocket.emit('open');
        gateway.sendAudio(pcm);

        // Assert
        expect(fakeSocket.sendMedia).toHaveBeenCalledTimes(1);
    });

    it('should send a keep-alive during silence', async () => {
        // Arrange
        const { DeepgramSttGateway } = await import('./deepgram-stt.gateway');
        const gateway = new DeepgramSttGateway(FAKE_API_KEY);

        // Act
        await gateway.start();
        fakeSocket.emit('open');
        await vi.advanceTimersByTimeAsync(10_000);

        // Assert
        expect(fakeSocket.sendKeepAlive).toHaveBeenCalled();
    });

    it('should not send a keep-alive before the socket has opened', async () => {
        // Arrange
        const { DeepgramSttGateway } = await import('./deepgram-stt.gateway');
        const gateway = new DeepgramSttGateway(FAKE_API_KEY);

        // Act
        await gateway.start();
        await vi.advanceTimersByTimeAsync(10_000);

        // Assert
        expect(fakeSocket.sendKeepAlive).not.toHaveBeenCalled();
    });

    it('should not throw when a keep-alive tick races a socket that is not open', async () => {
        // Arrange
        const { DeepgramSttGateway } = await import('./deepgram-stt.gateway');
        const gateway = new DeepgramSttGateway(FAKE_API_KEY);
        gateway.on('error', () => undefined);
        fakeSocket.sendKeepAlive.mockImplementation(() => {
            throw new Error('Socket is not open.');
        });

        // Act
        await gateway.start();
        fakeSocket.emit('open');

        // Assert
        await expect(vi.advanceTimersByTimeAsync(10_000)).resolves.not.toThrow();
    });

    it('should tear down the socket on stop', async () => {
        // Arrange
        const { DeepgramSttGateway } = await import('./deepgram-stt.gateway');
        const gateway = new DeepgramSttGateway(FAKE_API_KEY);

        // Act
        await gateway.start();
        fakeSocket.emit('open');
        await gateway.stop();

        // Assert
        expect(fakeSocket.sendCloseStream).toHaveBeenCalled();
        expect(fakeSocket.close).toHaveBeenCalled();
    });

    it('should still emit an interim transcript for an is_final:false Results and no utterance', async () => {
        // Arrange
        const { DeepgramSttGateway } = await import('./deepgram-stt.gateway');
        const gateway = new DeepgramSttGateway(FAKE_API_KEY);
        const transcripts: ISttTranscriptEvent[] = [];
        const utterances: IUtteranceEvent[] = [];
        const transcriptListener: ISttTranscriptListener = (transcriptEvent: ISttTranscriptEvent): void => {
            transcripts.push(transcriptEvent);
        };
        const utteranceListener: IUtteranceListener = (utterance: IUtteranceEvent): void => {
            utterances.push(utterance);
        };
        gateway.on('transcript', transcriptListener);
        gateway.on('utterance', utteranceListener);

        // Act
        await gateway.start();
        fakeSocket.emit('open');
        emitResultsMessage('hello', false);

        // Assert
        expect(transcripts).toEqual([{ text: 'hello', isFinal: false }]);
        expect(utterances).toEqual([]);
    });

    it('should emit exactly one utterance per speech_final turn built from multiple is_final runs', async () => {
        // Arrange
        const { DeepgramSttGateway } = await import('./deepgram-stt.gateway');
        const gateway = new DeepgramSttGateway(FAKE_API_KEY);
        const utterances: IUtteranceEvent[] = [];
        const utteranceListener: IUtteranceListener = (utterance: IUtteranceEvent): void => {
            utterances.push(utterance);
        };
        gateway.on('utterance', utteranceListener);

        // Act
        await gateway.start();
        fakeSocket.emit('open');
        emitResultsMessage('how are', true, { words: [{ speaker: 0 }, { speaker: 0 }] });
        emitResultsMessage('you doing?', true, { speechFinal: true, words: [{ speaker: 0 }, { speaker: 0 }] });

        // Assert
        expect(utterances).toHaveLength(1);
        expect(utterances[0].text).toBe('how are you doing?');
    });

    it('should not emit an utterance for an is_final run that is not speech_final', async () => {
        // Arrange
        const { DeepgramSttGateway } = await import('./deepgram-stt.gateway');
        const gateway = new DeepgramSttGateway(FAKE_API_KEY);
        const utterances: IUtteranceEvent[] = [];
        const utteranceListener: IUtteranceListener = (utterance: IUtteranceEvent): void => {
            utterances.push(utterance);
        };
        gateway.on('utterance', utteranceListener);

        // Act
        await gateway.start();
        fakeSocket.emit('open');
        emitResultsMessage('partial turn', true, { words: [{ speaker: 0 }] });

        // Assert
        expect(utterances).toEqual([]);
    });

    it('should commit one utterance on UtteranceEnd when a turn is pending', async () => {
        // Arrange
        const { DeepgramSttGateway } = await import('./deepgram-stt.gateway');
        const gateway = new DeepgramSttGateway(FAKE_API_KEY);
        const utterances: IUtteranceEvent[] = [];
        const utteranceListener: IUtteranceListener = (utterance: IUtteranceEvent): void => {
            utterances.push(utterance);
        };
        gateway.on('utterance', utteranceListener);

        // Act
        await gateway.start();
        fakeSocket.emit('open');
        emitResultsMessage('this is a statement', true, { words: [{ speaker: 1 }] });
        emitUtteranceEnd();

        // Assert
        expect(utterances).toHaveLength(1);
        expect(utterances[0].text).toBe('this is a statement');
    });

    it('should emit exactly one utterance for a speech_final followed by a trailing UtteranceEnd', async () => {
        // Arrange
        const { DeepgramSttGateway } = await import('./deepgram-stt.gateway');
        const gateway = new DeepgramSttGateway(FAKE_API_KEY);
        const utterances: IUtteranceEvent[] = [];
        const utteranceListener: IUtteranceListener = (utterance: IUtteranceEvent): void => {
            utterances.push(utterance);
        };
        gateway.on('utterance', utteranceListener);

        // Act
        await gateway.start();
        fakeSocket.emit('open');
        emitResultsMessage('done talking now', true, { speechFinal: true, words: [{ speaker: 0 }] });
        emitUtteranceEnd();

        // Assert
        expect(utterances).toHaveLength(1);
    });

    it('should attribute a diarized turn to a Person N speaker and classify it', async () => {
        // Arrange
        const { DeepgramSttGateway } = await import('./deepgram-stt.gateway');
        const gateway = new DeepgramSttGateway(FAKE_API_KEY);
        const utterances: IUtteranceEvent[] = [];
        const utteranceListener: IUtteranceListener = (utterance: IUtteranceEvent): void => {
            utterances.push(utterance);
        };
        gateway.on('utterance', utteranceListener);

        // Act
        await gateway.start();
        fakeSocket.emit('open');
        emitResultsMessage('what is the plan?', true, { speechFinal: true, words: [{ speaker: 2 }, { speaker: 2 }] });

        // Assert
        expect(utterances).toEqual([{ text: 'what is the plan?', speaker: 'Person 1', isDiarized: true, classification: 'question' }]);
    });

    it('should give an undiarized turn the neutral speaker with isDiarized false', async () => {
        // Arrange
        const { DeepgramSttGateway } = await import('./deepgram-stt.gateway');
        const gateway = new DeepgramSttGateway(FAKE_API_KEY);
        const utterances: IUtteranceEvent[] = [];
        const utteranceListener: IUtteranceListener = (utterance: IUtteranceEvent): void => {
            utterances.push(utterance);
        };
        gateway.on('utterance', utteranceListener);

        // Act
        await gateway.start();
        fakeSocket.emit('open');
        emitResultsMessage('just a remark.', true, { speechFinal: true, words: [{}] });

        // Assert
        expect(utterances).toEqual([{ text: 'just a remark.', speaker: 'Speaker', isDiarized: false, classification: 'statement' }]);
    });

    it('should not emit transcript or utterance for Metadata or SpeechStarted messages', async () => {
        // Arrange
        const { DeepgramSttGateway } = await import('./deepgram-stt.gateway');
        const gateway = new DeepgramSttGateway(FAKE_API_KEY);
        const transcriptListener: ISttTranscriptListener = vi.fn<(transcriptEvent: ISttTranscriptEvent) => void>();
        const utteranceListener: IUtteranceListener = vi.fn<(utterance: IUtteranceEvent) => void>();
        gateway.on('transcript', transcriptListener);
        gateway.on('utterance', utteranceListener);

        // Act
        await gateway.start();
        fakeSocket.emit('open');
        fakeSocket.emit('message', { type: 'Metadata' });
        fakeSocket.emit('message', { type: 'SpeechStarted' });

        // Assert
        expect(transcriptListener).not.toHaveBeenCalled();
        expect(utteranceListener).not.toHaveBeenCalled();
    });

    it('should enable diarization and utterance-end on the connect args', async () => {
        // Arrange
        const { DeepgramSttGateway } = await import('./deepgram-stt.gateway');
        const gateway = new DeepgramSttGateway(FAKE_API_KEY);

        // Act
        await gateway.start();

        // Assert
        const connectArgs = mockConnect.mock.calls[0][0] ?? {};
        expect(connectArgs.diarize).toBe('true');
        expect(connectArgs.utterance_end_ms).toBe('1000');
        expect(connectArgs.interim_results).toBe('true');
        expect(connectArgs.smart_format).toBe('true');
        expect(connectArgs).not.toHaveProperty('utterances');
    });

    it('should not throw and commit no utterance for a malformed diarized Results payload', async () => {
        // Arrange
        const { DeepgramSttGateway } = await import('./deepgram-stt.gateway');
        const gateway = new DeepgramSttGateway(FAKE_API_KEY);
        const utterances: IUtteranceEvent[] = [];
        const utteranceListener: IUtteranceListener = (utterance: IUtteranceEvent): void => {
            utterances.push(utterance);
        };
        gateway.on('utterance', utteranceListener);

        // Act
        await gateway.start();
        fakeSocket.emit('open');
        const emitMalformed = (): void => {
            fakeSocket.emit('message', { type: 'Results', is_final: true, channel: {} });
            fakeSocket.emit('message', { type: 'Results', is_final: true, channel: { alternatives: [{ words: [{}] }] } });
            fakeSocket.emit('message', { type: 'Results', is_final: false });
        };

        // Assert
        expect(emitMalformed).not.toThrow();
        expect(utterances).toEqual([]);
    });

    it('should never log the api key during the connection lifecycle', async () => {
        // Arrange
        const consoleSpies: ReturnType<typeof vi.spyOn>[] = [
            vi.spyOn(console, 'log').mockImplementation(() => undefined),
            vi.spyOn(console, 'info').mockImplementation(() => undefined),
            vi.spyOn(console, 'warn').mockImplementation(() => undefined),
            vi.spyOn(console, 'error').mockImplementation(() => undefined),
            vi.spyOn(console, 'debug').mockImplementation(() => undefined),
        ];
        const { DeepgramSttGateway } = await import('./deepgram-stt.gateway');
        const gateway = new DeepgramSttGateway(FAKE_API_KEY);

        // Act
        await gateway.start();
        fakeSocket.emit('open');
        fakeSocket.emit('error', new Error('boom'));
        fakeSocket.emit('close', { code: 1006 });

        // Assert
        const loggedArguments: string = consoleSpies
            .flatMap((spy) => spy.mock.calls)
            .flat()
            .map((argument) => String(argument))
            .join(' ');
        expect(loggedArguments).not.toContain(FAKE_API_KEY);
    });
});
