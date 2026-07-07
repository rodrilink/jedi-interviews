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
 * pure contract file: no implementation lives here. A `type`-only import of
 * `Anthropic.ContentBlockParam` is used purely to type the vision content-block array (D-04) — it is
 * a compile-time type, not a runtime `@anthropic-ai/sdk` dependency.
 */

import type Anthropic from '@anthropic-ai/sdk';

/**
 * The AI modes this phase ships (D-05/D-10/D-12, Phase 7 D-11). String-union `type` mirrors the local
 * `HotkeyLayer` precedent in `hotkey-registrar.service.ts`. Phase 7 added `'code-challenge'` (the
 * screenshot vision mode) as a third mode under the SAME single-in-flight orchestrator (D-11).
 */
export type AiMode = 'answer' | 'talking-points' | 'code-challenge';

/** A single in-flight AI stream handle. The orchestrator holds exactly one at a time (D-07). */
export interface IAiStream {
    /** Aborts this stream cleanly; fires the gateway `'abort'` event (D-06/D-07). */
    abort(): void;
}

/** The assembled prompt the gateway sends (the {@link "./prompt-assembler"} output, D-13). */
export interface IAiPromptRequest {
    /**
     * The monotonic id of the orchestrator request this stream serves. The gateway echoes it back on
     * every emitted event so the orchestrator can positively match a delta/terminal to the currently
     * active request and DROP a superseded stream's late events. Without this the shared emitter's
     * back-to-back requests could cross-bleed (a finished request's straggler corrupting the next
     * queued entry, D-11 / T-10-05).
     */
    requestId: number;
    /** Per-mode model id, a named constant chosen by the orchestrator (D-10). */
    model: string;
    /** Hard output-token cap (Pitfall 6). */
    maxTokens: number;
    /** The mode's system prompt (D-12; the vision system prompt for code-challenge, D-07). */
    system: string;
    /**
     * The user turn. A plain string for the text modes (answer/talking-points — byte-for-byte
     * unchanged from Phase 5), OR an Anthropic content-block array for the vision mode (D-04): an
     * image block followed by a text block. The gateway passes this straight through to
     * `messages.stream({ messages: [{ role: 'user', content: userContent }] })`, which accepts both.
     */
    userContent: string | Anthropic.ContentBlockParam[];
    /**
     * The optional captured screenshot for the code-challenge vision mode (D-04). Carries RAW base64
     * (NO `data:` prefix — Pitfall 2) plus its media type. Absent for the text modes, which keeps their
     * `userContent` a plain string and their request byte-for-byte Phase-5-identical.
     */
    image?: { base64: string; mediaType: string };
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
     * @param listener - Receives each text delta string and the `requestId` of the originating stream
     *   (echoed from {@link IAiPromptRequest.requestId}) so the consumer can drop a superseded stream's
     *   late deltas (D-11).
     */
    on(event: 'text', listener: (textDelta: string, requestId: number) => void): void;

    /**
     * Subscribes to successful completion, carrying the full final text.
     *
     * @param event - The literal event name `'done'`.
     * @param listener - Receives the assembled final text and the `requestId` of the originating stream
     *   (echoed from {@link IAiPromptRequest.requestId}) so a duplicate terminal for a superseded stream
     *   is dropped rather than terminating the now-active request (WR-01).
     */
    on(event: 'done', listener: (finalText: string, requestId: number) => void): void;

    /**
     * Subscribes to a transport/API fault. Implementations surface errors here rather than throwing.
     *
     * @param event - The literal event name `'error'`.
     * @param listener - Receives the {@link Error} and the `requestId` of the originating stream
     *   (echoed from {@link IAiPromptRequest.requestId}) so a superseded stream's late error is dropped.
     */
    on(event: 'error', listener: (error: Error, requestId: number) => void): void;

    /**
     * Subscribes to stream-aborted notifications (the stream was cancelled via {@link IAiStream.abort}).
     *
     * @param event - The literal event name `'abort'`.
     * @param listener - Invoked with the `requestId` of the originating stream (echoed from
     *   {@link IAiPromptRequest.requestId}) so a superseded stream's late abort is dropped.
     */
    on(event: 'abort', listener: (requestId: number) => void): void;
}
