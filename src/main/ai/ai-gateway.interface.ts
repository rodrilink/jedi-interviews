/**
 * The AI-generation provider seam (D-13).
 *
 * Every consumer of AI streaming depends on THIS interface, never on `@anthropic-ai/sdk`
 * directly: the orchestrator (`AiOrchestrator`, 05-01) and the bootstrap wiring (`index.ts`)
 * all program against `IAiGateway`. That indirection is the whole point of the seam — the
 * Anthropic backend (`AnthropicGateway`, 05-01) can be swapped for a future provider (or a
 * vision-mode variant in Phase 7) without touching a single consumer, as long as the new
 * provider emits the same typed events.
 *
 * The shape is event-emitter style to mirror the `ISttProvider`/`DeepgramSttGateway` precedent
 * (event-driven, report-don't-throw), so a future provider re-uses the same contract. This is a
 * pure contract file: no implementation and no `@anthropic-ai/sdk` import live here.
 */

/**
 * The AI modes this phase ships (D-05/D-10/D-12). String-union `type` mirrors the local
 * `HotkeyLayer` precedent in `hotkey-registrar.service.ts`. Extensible: Phase 7 adds a vision mode.
 */
export type AiMode = 'answer' | 'talking-points';

/** A single in-flight AI stream handle. The orchestrator holds exactly one at a time (D-07). */
export interface IAiStream {
    /** Aborts this stream cleanly; fires the gateway `'abort'` event (D-06/D-07). */
    abort(): void;
}

/** The assembled prompt the gateway sends (the {@link "./prompt-assembler"} output, D-13). */
export interface IAiPromptRequest {
    /** Per-mode model id, a named constant chosen by the orchestrator (D-10). */
    model: string;
    /** Hard output-token cap (Pitfall 6). */
    maxTokens: number;
    /** The mode's system prompt (D-12). */
    system: string;
    /** The user turn: the labeled transcript span (+ the empty Phase-5 context slot, D-13). */
    userContent: string;
}

/**
 * The swappable AI-generation seam (D-13).
 *
 * Consumers (`AiOrchestrator`) depend on THIS, never on `@anthropic-ai/sdk`. Mirrors
 * `ISttProvider`: event-emitter style, report-don't-throw. An implementation surfaces transport
 * faults via the `error` event rather than throwing, so a transient API fault never crashes main.
 *
 * @remarks
 * Like the other main-process services in this app, an implementation is instantiated once and
 * treated as a singleton by convention — the Electron main process has no TSyringe DI container,
 * so the IDEXX `@singleton()` decorator does not apply here.
 */
export interface IAiGateway {
    /** Starts a streaming generation and returns its abort handle. Never throws on a transport fault. */
    stream(request: IAiPromptRequest): IAiStream;

    /**
     * Subscribes to per-token text deltas (AI-04).
     *
     * @param event - The literal event name `'text'`.
     * @param listener - Receives each text delta string.
     */
    on(event: 'text', listener: (textDelta: string) => void): void;

    /**
     * Subscribes to successful completion, carrying the full final text.
     *
     * @param event - The literal event name `'done'`.
     * @param listener - Receives the assembled final text.
     */
    on(event: 'done', listener: (finalText: string) => void): void;

    /**
     * Subscribes to a transport/API fault. Implementations surface errors here rather than throwing.
     *
     * @param event - The literal event name `'error'`.
     * @param listener - Receives the {@link Error}.
     */
    on(event: 'error', listener: (error: Error) => void): void;

    /**
     * Subscribes to stream-aborted notifications (the stream was cancelled via {@link IAiStream.abort}).
     *
     * @param event - The literal event name `'abort'`.
     * @param listener - Invoked with no arguments when the stream aborts.
     */
    on(event: 'abort', listener: () => void): void;
}
