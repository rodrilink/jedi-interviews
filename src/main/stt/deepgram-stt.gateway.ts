import { EventEmitter } from 'events';
import { DeepgramClient } from '@deepgram/sdk';

import type { ISttProvider, ISttTranscriptEvent, SttConnectionState } from './stt-provider.interface';

/** The Deepgram live model used for streaming transcription (verified in @deepgram/sdk@5.4.0). */
const DEEPGRAM_MODEL = 'nova-3';

/** Target wire format declared to Deepgram — must match the resample utility's output (TRN-01). */
const TARGET_SAMPLE_RATE = 16000;
const TARGET_CHANNELS = 1;

/** Reconnect backoff curve: initial 500 ms, doubling, capped at 8 s, with +/-20% jitter (RESEARCH Pattern 4). */
const BACKOFF_INITIAL_MS = 500;
const BACKOFF_MAX_MS = 8_000;
const BACKOFF_JITTER_RATIO = 0.2;

/** Keep-alive cadence during silence so Deepgram does not idle-close the socket (RESEARCH Pitfall 3). */
const KEEP_ALIVE_INTERVAL_MS = 6_000;

/**
 * The subset of the Deepgram v5 live socket this gateway depends on. Declared locally rather than
 * importing `V1Socket` so the gateway is coupled only to the shape it uses, and so the test's
 * `FakeV1Socket` stand-in satisfies it without re-implementing the full SDK class.
 */
interface IDeepgramLiveSocket {
    on(event: 'open', callback: () => void): void;
    on(event: 'message', callback: (message: IDeepgramMessage) => void): void;
    on(event: 'close', callback: (event: unknown) => void): void;
    on(event: 'error', callback: (error: Error) => void): void;
    sendMedia(message: ArrayBuffer | ArrayBufferView): void;
    sendKeepAlive(message: object): void;
    sendCloseStream(message: object): void;
    close(): void;
}

/** The defensive shape of a Deepgram `Results` message — every field is treated as untrusted (T-4-04). */
interface IDeepgramMessage {
    is_final?: boolean;
    channel?: { alternatives?: Array<{ transcript?: string }> };
}

/**
 * The Deepgram-backed {@link ISttProvider} (TRN-01/TRN-02/TRN-03/TRN-05).
 *
 * Opens a Deepgram v5 live connection (linear16 / 16 kHz / mono / interim results), maps each
 * `message` to a typed `transcript` event distinguishing interim from final results, auto-reconnects
 * with bounded exponential backoff while surfacing a coarse `connection-state-change`, and keeps the
 * socket alive during silence. It NEVER throws on a transport fault — errors are surfaced via the
 * `error` event so a transient STT fault cannot crash the main process (mirrors the report-don't-throw
 * discipline of `HotkeyRegistrarService`).
 *
 * The Deepgram API key is supplied to the constructor by main only (sourced from
 * `process.env.DEEPGRAM_API_KEY` or a local untracked dev-config at the call site, D-08). It is never
 * logged, never placed in an emitted payload, and never crosses IPC (T-4-02 / Security V6). Phase 6's
 * `safeStorage`-backed key entry can later replace the source without touching this gateway.
 *
 * @remarks
 * The IDEXX `@singleton()` decorator is NOT applicable here: the Electron main process has no TSyringe
 * DI container. This gateway is instantiated exactly once in `index.ts` (04-04) and treated as a
 * singleton by convention, like the other main-process services in this app.
 */
export class DeepgramSttGateway extends EventEmitter implements ISttProvider {
    private connection: IDeepgramLiveSocket | undefined;
    private state: SttConnectionState = 'disconnected';
    private backoffMs: number = BACKOFF_INITIAL_MS;
    private keepAliveTimer: ReturnType<typeof setInterval> | undefined;
    private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    private audioSentSinceKeepAlive = false;
    private stopped = false;

    /**
     * @param apiKey - The Deepgram API key, read in main only (D-08). Held in memory for the client;
     *   never logged, emitted, or sent over IPC.
     */
    public constructor(private readonly apiKey: string) {
        super();
    }

    /**
     * Opens the Deepgram live connection and begins accepting audio. Resolves once the connect call
     * returns (or has entered the reconnect loop on failure); does not reject on a transport error —
     * the failure surfaces via the `error` event and a scheduled reconnect.
     */
    public async start(): Promise<void> {
        this.stopped = false;
        await this.connect();
    }

    /**
     * Closes the Deepgram connection and stops accepting audio. Clears the keep-alive and reconnect
     * timers, sends a close-stream, and closes the socket. Safe to call when already stopped.
     */
    public async stop(): Promise<void> {
        this.stopped = true;
        this.clearTimers();
        this.teardownConnection();
        this.setState('disconnected');

        return Promise.resolve();
    }

    /**
     * Streams one chunk of 16 kHz mono Int16 (linear16) PCM to Deepgram. Drops the chunk via an
     * early-return when not connected (the v1 drop-PCM-during-gap policy, D-06 lean), so callers
     * never have to check connection state before sending.
     *
     * @param pcm - 16 kHz mono Int16 PCM samples produced by the resample utility.
     */
    public sendAudio(pcm: Int16Array): void {
        if (this.state !== 'connected' || this.connection === undefined) {
            return;
        }

        this.audioSentSinceKeepAlive = true;
        this.connection.sendMedia(pcm.buffer);
    }

    /**
     * Opens a Deepgram v5 live connection and attaches the socket event handlers. Any thrown error
     * (e.g. a connect rejection) is surfaced via the `error` event and a reconnect is scheduled — the
     * method never re-throws, honoring the never-crash-on-transport-fault contract.
     */
    private async connect(): Promise<void> {
        this.setState(this.backoffMs === BACKOFF_INITIAL_MS ? 'connecting' : 'reconnecting');

        try {
            const client = new DeepgramClient({ apiKey: this.apiKey });
            const connection = (await client.listen.v1.connect({
                model: DEEPGRAM_MODEL,
                encoding: 'linear16',
                sample_rate: TARGET_SAMPLE_RATE,
                channels: TARGET_CHANNELS,
                interim_results: true,
                smart_format: true,
                // The HeaderAuthProvider supplies the real auth header from `apiKey`; the per-call
                // Authorization field is left empty so it merges out (verified against @deepgram/sdk@5.4.0).
                Authorization: '',
            })) as unknown as IDeepgramLiveSocket;

            this.connection = connection;
            this.attachHandlers(connection);
            this.startKeepAlive();
        } catch (error) {
            this.emitError(error instanceof Error ? error : new Error('Deepgram connect failed'));
            this.scheduleReconnect();
        }
    }

    /**
     * Wires the Deepgram socket lifecycle to the gateway's typed events: `open` -> connected (and a
     * backoff reset), `message` -> a transcript event, `close` -> reconnecting + scheduled reconnect,
     * `error` -> surfaced error (never thrown).
     *
     * @param connection - The freshly-connected Deepgram live socket.
     */
    private attachHandlers(connection: IDeepgramLiveSocket): void {
        connection.on('open', () => {
            this.backoffMs = BACKOFF_INITIAL_MS;
            this.setState('connected');
        });

        connection.on('message', (message: IDeepgramMessage) => {
            this.handleMessage(message);
        });

        connection.on('close', () => {
            if (this.stopped) {
                return;
            }

            this.setState('reconnecting');
            this.scheduleReconnect();
        });

        connection.on('error', (error: Error) => {
            this.emitError(error);
        });
    }

    /**
     * Emits the gateway's `error` event defensively. Node's EventEmitter throws synchronously when an
     * `'error'` event is emitted with no listener attached; this gateway must surface a transport fault
     * without crashing the main process even before a consumer has subscribed, so we no-op when there
     * is no listener rather than letting the emit throw.
     *
     * @param error - The error to surface.
     */
    private emitError(error: Error): void {
        if (this.listenerCount('error') > 0) {
            this.emit('error', error);
        }
    }

    /**
     * Maps an untrusted Deepgram `Results` message to a transcript event. Optional-chains every field
     * and skips empty-text messages so a malformed payload only ever produces render text, never
     * control flow (T-4-04).
     *
     * @param message - The raw Deepgram message payload.
     */
    private handleMessage(message: IDeepgramMessage): void {
        const text = message.channel?.alternatives?.[0]?.transcript ?? '';
        if (text.length === 0) {
            return;
        }

        const transcriptEvent: ISttTranscriptEvent = { text, isFinal: message.is_final === true };
        this.emit('transcript', transcriptEvent);
    }

    /**
     * Starts the keep-alive timer. On each tick, sends `sendKeepAlive({})` only when no audio chunk
     * was streamed in the interval, so Deepgram does not idle-close the socket during silence
     * (RESEARCH Pitfall 3) without competing with live audio.
     */
    private startKeepAlive(): void {
        this.stopKeepAlive();
        this.audioSentSinceKeepAlive = false;
        this.keepAliveTimer = setInterval(() => {
            if (this.audioSentSinceKeepAlive) {
                this.audioSentSinceKeepAlive = false;

                return;
            }

            if (this.connection !== undefined) {
                this.connection.sendKeepAlive({});
            }
        }, KEEP_ALIVE_INTERVAL_MS);
    }

    /** Schedules a reconnect after the current backoff delay (with jitter), then advances the backoff. */
    private scheduleReconnect(): void {
        if (this.stopped || this.reconnectTimer !== undefined) {
            return;
        }

        this.teardownConnection();
        this.stopKeepAlive();

        const delay = this.jittered(this.backoffMs);
        this.backoffMs = Math.min(this.backoffMs * 2, BACKOFF_MAX_MS);

        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = undefined;
            void this.connect();
        }, delay);
    }

    /**
     * Applies +/-{@link BACKOFF_JITTER_RATIO} jitter to a backoff delay so concurrent reconnects do
     * not synchronize into a thundering-herd retry storm.
     *
     * @param baseMs - The base backoff delay in milliseconds.
     * @returns The jittered delay in milliseconds.
     */
    private jittered(baseMs: number): number {
        const spread = baseMs * BACKOFF_JITTER_RATIO;

        return baseMs - spread + Math.random() * spread * 2;
    }

    /**
     * Updates the coarse connection state and emits a `connection-state-change` event only when the
     * state actually changes, so consumers (the overlay) see one event per transition (TRN-03).
     *
     * @param next - The new connection state.
     */
    private setState(next: SttConnectionState): void {
        if (this.state === next) {
            return;
        }

        this.state = next;
        this.emit('connection-state-change', next);
    }

    /** Sends a close-stream and closes the underlying socket, swallowing teardown faults. */
    private teardownConnection(): void {
        if (this.connection === undefined) {
            return;
        }

        const connection = this.connection;
        this.connection = undefined;
        try {
            connection.sendCloseStream({});
            connection.close();
        } catch {
            // Teardown of an already-dead socket must never throw or crash the main process.
        }
    }

    /** Clears both the keep-alive and reconnect timers. */
    private clearTimers(): void {
        this.stopKeepAlive();
        if (this.reconnectTimer !== undefined) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = undefined;
        }
    }

    /** Stops the keep-alive timer if running. */
    private stopKeepAlive(): void {
        if (this.keepAliveTimer !== undefined) {
            clearInterval(this.keepAliveTimer);
            this.keepAliveTimer = undefined;
        }
    }
}
