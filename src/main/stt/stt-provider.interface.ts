/**
 * The STT (speech-to-text) provider seam (TRN-05).
 *
 * Every consumer of live transcription depends on THIS interface, never on `@deepgram/sdk`
 * directly: the PCM buffer feed (04-03), the bootstrap wiring (04-04), and Phase 5's AI
 * orchestrator all program against `ISttProvider`. That indirection is the whole point of
 * the seam — the Deepgram backend (`DeepgramSttGateway`, 04-02) can be swapped for a local
 * Whisper provider (v2, STT-V2-01) without touching a single consumer, as long as the new
 * provider emits the same typed events.
 *
 * The shape is event-emitter style to mirror Deepgram v5's `connection.on('message')` model
 * (verified against `@deepgram/sdk@5.4.0`), so a future provider re-uses the same contract.
 * This is a pure contract file: no implementation and no Deepgram import live here.
 */

/**
 * A single transcript update emitted by an {@link ISttProvider}.
 *
 * Interim (partial) results fire many times per second as the recognizer refines its guess;
 * final results are committed text. Consumers replace the current interim on each event and
 * only accumulate finals (TRN-02), so interim text never duplicates into the rolling buffer.
 */
export interface ISttTranscriptEvent {
    /** The recognized transcript text for this update (may be the empty string between phrases). */
    text: string;
    /** `true` for a finalized segment; `false`/absent for an interim (partial) result. */
    isFinal: boolean;
}

/**
 * The coarse connection state of an {@link ISttProvider}, surfaced read-only on the overlay
 * so the user can see when the STT link drops and recovers (TRN-03). String-union `type`
 * mirrors the local `HotkeyLayer` precedent in `hotkey-registrar.service.ts`.
 */
export type SttConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'error';

/**
 * The swappable speech-to-text provider contract (TRN-05).
 *
 * @remarks
 * Like the other main-process services in this app, an implementation is instantiated once and
 * treated as a singleton by convention — the Electron main process has no TSyringe DI container,
 * so the IDEXX `@singleton()` decorator does not apply here.
 */
export interface ISttProvider {
    /**
     * Opens the STT connection and begins accepting audio. Resolves once the provider is ready
     * to receive PCM (or has entered its reconnect loop); rejects only on an unrecoverable
     * startup error (e.g. a missing API key).
     */
    start(): Promise<void>;

    /**
     * Closes the STT connection and stops accepting audio. Resolves once teardown completes.
     * Safe to call when already stopped.
     */
    stop(): Promise<void>;

    /**
     * Streams one chunk of 16 kHz mono Int16 (linear16) PCM to the recognizer. Implementations
     * drop the chunk internally when not connected (the v1 drop-PCM-during-gap policy), so callers
     * never have to check connection state before sending.
     *
     * @param pcm - 16 kHz mono Int16 PCM samples produced by the resample utility.
     */
    sendAudio(pcm: Int16Array): void;

    /**
     * Subscribes to transcript updates (interim and final, TRN-02).
     *
     * @param event - The literal event name `'transcript'`.
     * @param listener - Receives each {@link ISttTranscriptEvent}.
     */
    on(event: 'transcript', listener: (transcriptEvent: ISttTranscriptEvent) => void): void;

    /**
     * Subscribes to connection-state changes, surfaced on the overlay (TRN-03).
     *
     * @param event - The literal event name `'connection-state-change'`.
     * @param listener - Receives the new {@link SttConnectionState}.
     */
    on(event: 'connection-state-change', listener: (state: SttConnectionState) => void): void;

    /**
     * Subscribes to provider errors. Implementations surface errors here rather than throwing,
     * so a transient STT fault never crashes the main process.
     *
     * @param event - The literal event name `'error'`.
     * @param listener - Receives the {@link Error}.
     */
    on(event: 'error', listener: (error: Error) => void): void;
}
