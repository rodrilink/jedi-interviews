import { EventEmitter } from 'events';
import { DeepgramClient } from '@deepgram/sdk';

import type { ISttProvider, ISttTranscriptEvent, IUtteranceEvent, SttConnectionState } from './stt-provider.interface';
import { pickModalSpeakerIndex, UtteranceAccumulator } from './utterance-accumulator.utility';
import { SpeakerMap } from './speaker-map';
import { classifyUtterance } from './question-classifier.utility';

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
    // `listen.v1.connect(args)` returns the socket but does NOT open it — the websocket only opens
    // (and fires 'open') after an explicit `connect()` call. `waitForOpen()` resolves once it does.
    connect(): void;
    waitForOpen(): Promise<unknown>;
    close(): void;
}

/**
 * The defensive shape of a Deepgram v5 live `message` — every field is treated as untrusted (T-4-04).
 *
 * The live socket delivers a union discriminated on `type` (`'Results'` | `'Metadata'` |
 * `'UtteranceEnd'` | `'SpeechStarted'`, verified against `@deepgram/sdk@5.4.0`). Only `Results`
 * carries transcript/word data; `UtteranceEnd` is the end-of-turn fallback finalization signal. Every
 * field is optional so a malformed/partial payload only ever yields empty text or an empty word run,
 * never control flow.
 */
interface IDeepgramMessage {
    type?: string;
    is_final?: boolean;
    speech_final?: boolean;
    channel?: {
        alternatives?: Array<{
            transcript?: string;
            words?: Array<{ word?: string; punctuated_word?: string; speaker?: number }>;
        }>;
    };
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
     * Buffers each turn's `is_final` word runs and drains them on commit (QA-01). Owned by the gateway
     * so all `@deepgram/sdk` payload coupling stays in this one file (D-09).
     */
    private readonly accumulator = new UtteranceAccumulator();

    /**
     * The session-long diarization-index → `Person N` map (QA-02). Owned here so the committed
     * `utterance` is fully labeled before it crosses the seam — no Deepgram type escapes the gateway.
     */
    private readonly speakerMap = new SpeakerMap();

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
        // Send the Int16Array view itself (an ArrayBufferView) rather than `.buffer`: `.buffer` is
        // ArrayBufferLike (possibly SharedArrayBuffer) which sendMedia's ArrayBuffer | ArrayBufferView
        // type rejects, and the view also respects any subarray offset/length.
        this.connection.sendMedia(pcm);
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
                // The SDK types these query params as string-literal unions ('true' | 'false' | string),
                // not booleans — they are serialized into the websocket query string.
                interim_results: 'true',
                smart_format: 'true',
                // Enable diarization (per-word `speaker` index) and the end-of-utterance signal. Both
                // are string-literal query params like the flags above. `utterance_end_ms` REQUIRES
                // `interim_results`, and drives the `UtteranceEnd` fallback commit. We do NOT set
                // `utterances` — that is batch-only and a no-op on the live socket (RESEARCH).
                diarize: 'true',
                utterance_end_ms: '1000',
                // The HeaderAuthProvider supplies the real auth header from `apiKey`; the per-call
                // Authorization field is left empty so it merges out (verified against @deepgram/sdk@5.4.0).
                Authorization: '',
                // Disable the SDK's built-in ReconnectingWebSocket (defaults to 30 attempts). This
                // gateway is the SINGLE reconnect authority — leaving the SDK's reconnect on makes the
                // two engines fight on every close, thrashing connected/connecting/reconnecting and
                // firing N-API callbacks on a socket we tear down underneath the SDK (DEP0168).
                reconnectAttempts: 0,
            })) as unknown as IDeepgramLiveSocket;

            this.connection = connection;
            this.attachHandlers(connection);
            // listen.v1.connect(args) returns the socket WITHOUT opening it. Handlers are attached
            // first (so the leading-edge 'open' is never missed), then we explicitly open the socket.
            // The 'open' handler drives the transition to 'connected'; the keep-alive timer is already
            // gated on state === 'connected', so starting it now is safe (it no-ops until open).
            connection.connect();
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
     * Routes an untrusted Deepgram live `message` (T-4-04). Discriminates on `type`:
     *
     * - `UtteranceEnd` — the end-of-turn fallback: commit any pending accumulated turn (no-op when the
     *   accumulator is already empty, so a trailing `UtteranceEnd` after a `speech_final` never
     *   double-commits — Pitfall 4).
     * - Anything else with a `type` that is not `Results` (`Metadata`/`SpeechStarted`) is ignored.
     * - `Results` — interim (`is_final` falsy) still emits the D-02 live `transcript` line unchanged;
     *   an `is_final` run is buffered, and a `speech_final` run finalizes the turn (D-01, one committed
     *   `utterance` per turn — NOT one per `is_final`).
     *
     * Every field is optional-chained with `?? ''`/`?? []` fallbacks so a malformed payload only ever
     * yields empty text or an empty word run — never control flow, never a throw.
     *
     * @param message - The raw Deepgram message payload.
     */
    private handleMessage(message: IDeepgramMessage): void {
        if (message.type === 'UtteranceEnd') {
            this.commitPendingUtterance();

            return;
        }

        if (message.type !== undefined && message.type !== 'Results') {
            return;
        }

        const alternative = message.channel?.alternatives?.[0];
        const text = alternative?.transcript ?? '';

        if (message.is_final !== true) {
            if (text.length > 0) {
                const transcriptEvent: ISttTranscriptEvent = { text, isFinal: false };
                this.emit('transcript', transcriptEvent);
            }

            return;
        }

        this.accumulator.append(alternative?.words ?? [], text);
        if (message.speech_final === true) {
            this.commitPendingUtterance();
        }
    }

    /**
     * Drains the accumulated turn into exactly ONE `utterance` seam event (D-01, one entry per turn),
     * or no-ops when the accumulator is empty (Pitfall 4 double-commit guard — a trailing
     * `UtteranceEnd` after a `speech_final` commit produces nothing). This is the SOLE site that emits
     * `'utterance'`. The modal per-word speaker index is resolved to a stable `Person N` label via the
     * gateway-owned {@link SpeakerMap}, and the text is locally classified — so all `@deepgram/sdk`
     * coupling stays inside this file and a fully-labeled, classified utterance crosses the seam (D-09).
     */
    private commitPendingUtterance(): void {
        const committed = this.accumulator.commit();
        if (committed === undefined) {
            return;
        }

        const speakerIndex = pickModalSpeakerIndex(committed.words);
        const { speaker, isDiarized } = this.speakerMap.label(speakerIndex);
        const utterance: IUtteranceEvent = {
            text: committed.text,
            speaker,
            isDiarized,
            classification: classifyUtterance(committed.text),
        };
        this.emit('utterance', utterance);
    }

    /**
     * Resets the session speaker numbering and discards any half-accumulated turn (D-05). Wired to the
     * clear-transcript chord (Ctrl+Alt+K) in `index.ts` (08) so a fresh session restarts at Person 1.
     */
    public clearSpeakers(): void {
        this.speakerMap.clear();
        this.accumulator.clear();
    }

    /**
     * Starts the keep-alive timer. On each tick, sends `sendKeepAlive({})` only when no audio chunk
     * was streamed in the interval, so Deepgram does not idle-close the socket during silence
     * (RESEARCH Pitfall 3) without competing with live audio.
     *
     * The send is gated on `state === 'connected'` (not merely on a non-undefined connection): the
     * socket object exists from the moment `connect()` returns but only accepts traffic after its
     * `'open'` event, and the SDK throws `Socket is not open.` synchronously otherwise. Because this
     * runs inside a timer callback, that throw would become an uncaught main-process exception; the
     * state gate plus the defensive try/catch keep a transport race from ever crashing the app.
     */
    private startKeepAlive(): void {
        this.stopKeepAlive();
        this.audioSentSinceKeepAlive = false;
        this.keepAliveTimer = setInterval(() => {
            if (this.audioSentSinceKeepAlive) {
                this.audioSentSinceKeepAlive = false;

                return;
            }

            if (this.state !== 'connected' || this.connection === undefined) {
                return;
            }

            try {
                this.connection.sendKeepAlive({});
            } catch (error) {
                // The socket closed between the state check and the send (a transport race). Surface
                // it without crashing; the 'close' handler drives the reconnect.
                this.emitError(error instanceof Error ? error : new Error('Deepgram keep-alive failed'));
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
