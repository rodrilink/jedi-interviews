import { EventEmitter } from 'events';
import Anthropic from '@anthropic-ai/sdk';

import type { IAiGateway, IAiPromptRequest, IAiStream } from './ai-gateway.interface';

/**
 * The Anthropic-backed {@link IAiGateway} (AI-01/AI-04, D-10/D-12).
 *
 * Opens a Claude Messages stream via the SDK's `client.messages.stream(...)` helper, maps each
 * per-token `text` delta, the terminal completion, the abort, and any transport fault to the typed
 * gateway events. It NEVER throws on a transport fault — errors are surfaced via the `error` event
 * (with the same no-listener guard as `DeepgramSttGateway.emitError`) so a transient 5xx/overloaded
 * fault cannot crash the main process. It does NOT hand-parse SSE frames; the SDK helper accumulates
 * the snapshot and exposes the terminal events.
 *
 * The Anthropic API key is supplied to the constructor by main only (sourced from
 * `process.env.ANTHROPIC_API_KEY` or a local untracked dev-config at the call site, mirroring the
 * Deepgram D-08 policy). It is never logged, never placed in an emitted payload, and never crosses
 * IPC. This gateway NEVER reads `process.env` itself. Phase 6's `safeStorage`-backed key entry can
 * later replace the source without touching this gateway.
 *
 * @remarks
 * The IDEXX `@singleton()` decorator is NOT applicable here: the Electron main process has no TSyringe
 * DI container. This gateway is instantiated exactly once in `index.ts` (05-01) and treated as a
 * singleton by convention, like the other main-process services in this app.
 */
export class AnthropicGateway extends EventEmitter implements IAiGateway {
    private readonly client: Anthropic;

    /**
     * @param apiKey - The Anthropic API key, read in main only (mirrors Deepgram D-08). Held in
     *   memory for the client; never logged, emitted, or sent over IPC.
     */
    public constructor(private readonly apiKey: string) {
        super();
        this.client = new Anthropic({ apiKey: this.apiKey });
    }

    /**
     * Starts a streaming generation and returns its abort handle. Wires the SDK stream's `text`,
     * `abort`, and `error` events to the gateway's typed events, and resolves `finalText()` into a
     * terminal `done`. Never throws: a synchronous construction fault (e.g. a missing key surfaced by
     * the SDK) is caught and surfaced via the `error` event, and a no-op abort handle is returned.
     *
     * @param request - The assembled prompt (model, max-tokens, system, user content).
     * @returns The abort handle for this stream (D-06/D-07 single-in-flight cancel).
     */
    public stream(request: IAiPromptRequest): IAiStream {
        try {
            const stream = this.client.messages.stream({
                model: request.model,
                max_tokens: request.maxTokens,
                system: request.system,
                messages: [{ role: 'user', content: request.userContent }],
            });

            stream.on('text', (textDelta: string) => this.emit('text', textDelta));
            stream.on('abort', () => this.emit('abort'));
            stream.on('error', (error: unknown) => this.emitError(error instanceof Error ? error : new Error('AI stream error')));
            // Terminal success — finalText() resolves on message_stop. The catch is intentionally a
            // no-op: a failure here has already surfaced via the 'error' / 'abort' events above, and
            // we must never log the rejection (the SDK error object can embed request headers, T-5-02).
            void stream
                .finalText()
                .then((finalText: string) => this.emit('done', finalText))
                .catch(() => undefined);

            return { abort: (): void => stream.abort() };
        } catch (error) {
            // A synchronous fault before the stream object exists (e.g. an invalid/missing key the SDK
            // rejects on construct). Surface it without throwing; return a no-op abort handle.
            this.emitError(error instanceof Error ? error : new Error('AI stream error'));

            return { abort: (): void => undefined };
        }
    }

    /**
     * Emits the gateway's `error` event defensively. Node's EventEmitter throws synchronously when an
     * `'error'` event is emitted with no listener attached; this gateway must surface a transport fault
     * without crashing the main process even before a consumer has subscribed, so we no-op when there
     * is no listener rather than letting the emit throw. The error payload is NEVER logged here
     * (T-5-02: the SDK error object can embed `x-api-key` request headers).
     *
     * @param error - The error to surface.
     */
    private emitError(error: Error): void {
        if (this.listenerCount('error') > 0) {
            this.emit('error', error);
        }
    }
}
