import { EventEmitter } from 'events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ISttTranscriptEvent, SttConnectionState } from './stt-provider.interface';

/** Local listener aliases for the gateway's typed events (the interface declares these inline). */
type ISttTranscriptListener = (transcriptEvent: ISttTranscriptEvent) => void;
type ISttConnectionStateListener = (state: SttConnectionState) => void;
type ISttErrorListener = (error: Error) => void;

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
const mockConnect = vi.fn<() => Promise<FakeV1Socket>>();
const mockDeepgramClientConstructor = vi.fn<(options: { apiKey: string }) => void>();

vi.mock('@deepgram/sdk', () => ({
    DeepgramClient: class {
        public readonly listen = {
            v1: {
                connect: (...args: unknown[]): Promise<FakeV1Socket> => mockConnect(...(args as [])),
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

    it('should emit a final transcript when is_final is true', async () => {
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
        emitTranscriptMessage('final words', true);

        // Assert
        expect(transcripts).toEqual([{ text: 'final words', isFinal: true }]);
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
