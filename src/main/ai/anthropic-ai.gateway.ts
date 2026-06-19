import { EventEmitter } from 'events';
import Anthropic from '@anthropic-ai/sdk';

import type { IAiGateway, IAiPromptRequest, IAiStream } from './ai-gateway.interface';
import { sanitizeAiError } from './sanitize-ai-error.utility';

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
    // NOT `readonly`: {@link rekey} reassigns both in place so a settings-window key Save applies live
    // with no restart (D-07, Pattern 5b). `readonly` here would be a TS2540 compile error.
    private client: Anthropic;
    private apiKey: string;

    /**
     * @param apiKey - The Anthropic API key, read in main only (mirrors Deepgram D-08). Held in
     *   memory for the client; never logged, emitted, or sent over IPC.
     */
    public constructor(apiKey: string) {
        super();
        this.apiKey = apiKey;
        this.client = new Anthropic({ apiKey: this.apiKey });
    }

    /**
     * Re-keys this gateway in place with a freshly-saved Anthropic key (D-07, live re-key, Pattern 5b).
     *
     * Replaces the in-memory `apiKey` and rebuilds the SDK `client` so the NEXT {@link stream} call
     * uses the new key — no process restart, no re-wiring. The orchestrator holds this gateway by a
     * `readonly` reference and its event handlers are wired once in the constructor; both are untouched
     * here, so a swap of the underlying SDK client is transparent to every consumer.
     *
     * SECURITY: like the constructor, this NEVER logs, emits, or sends the key over IPC, and the
     * gateway still NEVER reads `process.env` itself (the key is supplied by main, D-08).
     *
     * @param newKey - The new plaintext Anthropic API key (already trimmed/validated by the caller).
     */
    public rekey(newKey: string): void {
        this.apiKey = newKey;
        this.client = new Anthropic({ apiKey: newKey });
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
            stream.on('error', (error: unknown) => this.emitError(error));
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
            this.emitError(error);

            return { abort: (): void => undefined };
        }
    }

    /**
     * Emits the gateway's `error` event defensively. Node's EventEmitter throws synchronously when an
     * `'error'` event is emitted with no listener attached; this gateway must surface a transport fault
     * without crashing the main process even before a consumer has subscribed, so we no-op when there
     * is no listener rather than letting the emit throw.
     *
     * The raw value is first reduced to a short, safe reason via {@link sanitizeAiError} (T-5-02): the
     * SDK error object can embed the request body, headers, or `x-api-key`, and for a 400 its `message`
     * is the entire JSON error body. We emit an `Error` whose `message` is already the sanitized reason,
     * so the orchestrator's `AI error: ${error.message}` renders clean inline text. The raw payload is
     * never logged and never emitted.
     *
     * @param error - The raw value thrown by the SDK or a transport fault.
     */
    private emitError(error: unknown): void {
        if (this.listenerCount('error') > 0) {
            this.emit('error', new Error(sanitizeAiError(error)));
        }
    }
}
