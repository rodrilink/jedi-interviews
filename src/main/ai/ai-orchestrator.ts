/**
 * The single-in-flight AI request orchestrator (D-06/D-07/D-09/D-10/D-11, AI-04).
 *
 * It owns the entire AI request lifecycle in the main process: read the recent transcript span,
 * guard the empty span, assemble the prompt, start exactly ONE gateway stream at a time, debounce
 * the streamed text deltas to the renderer, and append the finished entry to the bounded history.
 * The renderer is a pure view of the pushed {@link IAiPushEvent}s (IN-01) — there is no
 * renderer->main control surface; triggers come only from main-side hotkeys.
 *
 * Single-in-flight invariant (D-06/D-07): at most one stream is active. Re-pressing the SAME mode
 * cancels its own stream (D-06); pressing the OTHER mode cancels the current and starts the new one
 * (D-07). Every stream + its target entry is tagged with a monotonic request id; gateway events
 * whose id is no longer the active one are ignored, so an aborted stream's late deltas can never
 * bleed into a new entry (Pitfall 1).
 */

import type { AiMode, IAiGateway, IAiStream } from './ai-gateway.interface';
import { assemblePrompt, RECENT_SPAN_MS, type IGroundingContext } from './prompt-assembler';
import { AiHistory } from './ai-history';
import { TranscriptBuffer } from '../stt/transcript-buffer';

/**
 * Per-mode model ids (D-10). Named per-mode constants so a mode can be cheaply re-tiered later
 * (e.g. moving talking-points to Haiku if 05-03 latency logging shows Opus too slow).
 */
export const ANSWER_MODEL = 'claude-haiku-4-5';
export const TALKING_POINTS_MODEL = 'claude-opus-4-8';
/** Code-challenge (vision) model (Phase 7 D-06). Opus for hard solving; a re-tierable named constant. */
export const CODE_CHALLENGE_MODEL = 'claude-opus-4-8';

/**
 * Per-mode hard output-token caps (Pitfall 6). The system prompt enforces brevity; these are the
 * safety caps, tunable during the 07-02 on-machine latency gate. Answers are a few sentences; talking
 * points are 3–5 short bullets; a code-challenge solution is longer (code + a brief complexity note),
 * so it gets a higher cap (RESEARCH A2 — tune at the latency gate).
 */
export const MAX_TOKENS: Record<AiMode, number> = {
    answer: 400,
    'talking-points': 500,
    'code-challenge': 1500,
};

/**
 * The trailing-edge debounce interval (ms) for pushing streamed text deltas to the renderer (AI-04).
 * In the locked 30–60ms band (D-04), matching the house 66ms audio-level throttle rationale: a fast
 * Haiku stream would otherwise flood IPC token-by-token.
 */
export const DELTA_DEBOUNCE_MS = 40;

/** The empty-span placeholder text shown when there is nothing recent to act on (D-11). */
export const EMPTY_SPAN_TEXT = 'No recent transcript to act on';

/** The inline message shown when the Anthropic key is absent (Pitfall 3 / T-5-02). Never logs the key. */
export const MISSING_KEY_TEXT = 'AI error: missing API key';

/**
 * The one-way push payload sent to the renderer over the `jedi:ai` channel (Pitfall 4). Every
 * variant carries the `requestId` so the renderer can reconcile streaming deltas to the correct
 * in-progress entry. Streaming pushes incremental `delta`s (cheap); terminal events (`done` /
 * `error` / `cancelled`) carry the full text and the main re-pushes a bounded `history-snapshot`
 * only on terminal/clear — not per delta.
 */
export type IAiPushEvent =
    | { type: 'thinking'; requestId: number; id: string; mode: AiMode; at: number }
    | { type: 'delta'; requestId: number; id: string; text: string }
    | { type: 'done'; requestId: number; id: string; text: string }
    | { type: 'error'; requestId: number; id: string; text: string }
    | { type: 'cancelled'; requestId: number; id: string }
    | { type: 'empty'; requestId: number; id: string; mode: AiMode; at: number; text: string }
    // D-02: the clear-AI hotkey empties the panel. Carries no entry id (it targets the whole list);
    // the renderer resets its mirror to an empty list. This is the minimal clear signal the current
    // renderer contract supports — the full bounded `history-snapshot` reconciliation push lands in
    // 05-03 (pushHistorySnapshot is still a no-op here).
    | { type: 'cleared' };

/** The active in-flight request: its mode, monotonic id, stream handle, and accumulated text. */
interface IActiveRequest {
    mode: AiMode;
    requestId: number;
    /** The entry id (the monotonic requestId rendered as a string) used as the renderer row key. */
    id: string;
    stream: IAiStream;
    text: string;
    debounceTimer: ReturnType<typeof setTimeout> | undefined;
    pendingDelta: boolean;
    /** The model id this stream runs on, captured so the first-token latency log can attribute it (D-10). */
    model: string;
    /**
     * Monotonic start timestamp (ms) captured when the stream is created, used to compute the
     * hotkey-to-first-token latency (D-10). Reset per requestId so a cross-mode cancel-and-restart gets
     * its own measurement; the requestId guard means an aborted stream's late first delta never logs here.
     */
    startMs: number;
    /** Whether the first-token latency line has already been logged for this stream (log exactly once, D-10). */
    firstTokenLogged: boolean;
}

/**
 * Orchestrates single-in-flight AI requests.
 *
 * @remarks
 * The Electron main process has no TSyringe DI container, so this is not an `@singleton()`; it is
 * instantiated once in `index.ts` (05-01) and treated as a singleton by convention. Its dependencies
 * — the gateway, the shared transcript buffer, the shared AI history, and a `pushAi` closure — are
 * constructor-injected (it never imports the overlay manager directly), mirroring how
 * `wireSttPipeline` closes over `pushTranscript(window, …)`.
 */
export class AiOrchestrator {
    private active: IActiveRequest | undefined;
    private requestSeq = 0;
    private handlersWired = false;

    /**
     * @param gateway - The AI generation seam (Anthropic in production, a fake in tests).
     * @param transcriptBuffer - The shared main-owned transcript buffer (the span source, D-09).
     * @param history - The shared bounded AI history; MUST be the same instance the clear-AI handler binds to.
     * @param pushAi - Pushes an {@link IAiPushEvent} to the renderer (a closure over the overlay window).
     * @param getActiveContext - Pulls the active session context to ground the prompt (D-10). Called
     *   FRESH on every {@link trigger} (pull-on-trigger) so a mid-session context Save is picked up on
     *   the very next AI request with no restart and no cached orchestrator state. Returns `undefined`
     *   when there is no active context, which keeps the assembled prompt byte-for-byte Phase-5-identical
     *   (the seam fails safe via `formatContext` → `''`).
     * @param captureImage - Captures + downscales the overlay's monitor for the code-challenge vision
     *   mode (Phase 7 D-01/D-05). A closure over the `ScreenshotService` + overlay window, threaded the
     *   SAME way `getActiveContext` was (constructed once in `index.ts`). Defaults to a rejecting stub so
     *   a code-challenge trigger without a wired capture seam surfaces an inline error rather than
     *   crashing — the text modes never call it.
     */
    public constructor(
        private readonly gateway: IAiGateway,
        private readonly transcriptBuffer: TranscriptBuffer,
        private readonly history: AiHistory,
        private readonly pushAi: (event: IAiPushEvent) => void,
        private readonly getActiveContext: () => IGroundingContext | undefined,
        private readonly captureImage: () => Promise<{ base64: string; mediaType: string }> = () =>
            Promise.reject(new Error('screenshot capture is not wired'))
    ) {
        this.wireGatewayHandlers();
    }

    /**
     * Triggers an AI request for the given mode (the hotkey entry point, D-05/D-06/D-07).
     *
     * Reads the ~60s span (D-09); if it is empty, appends the D-11 placeholder and makes NO gateway
     * call. Otherwise enforces the single-in-flight invariant: re-pressing the SAME mode cancels its
     * own stream and returns (D-06); the OTHER mode cancels the current then starts the new one
     * (D-07). The new stream + its entry are tagged with a fresh monotonic request id (Pitfall 1).
     *
     * @param mode - The AI mode to run.
     */
    public trigger(mode: AiMode): void {
        const span = this.transcriptBuffer.recentSince(RECENT_SPAN_MS);

        // D-11 empty-span guard — BEFORE any gateway call. Phase 7 D-07: code-challenge BYPASSES this —
        // the captured screenshot alone is actionable, so an empty transcript span must NOT short-circuit
        // it (the image is the problem; the span is only supporting narration). Text modes still guard.
        if (mode !== 'code-challenge' && span.trim().length === 0) {
            const requestId = ++this.requestSeq;
            const id = String(requestId);
            const at = Date.now();
            this.history.append({ id, mode, text: EMPTY_SPAN_TEXT, kind: 'empty' });
            this.pushAi({ type: 'empty', requestId, id, mode, at, text: EMPTY_SPAN_TEXT });
            this.pushHistorySnapshot();

            return;
        }

        // D-06: re-press the SAME mode while its stream is in flight -> cancel, done.
        if (this.active !== undefined && this.active.mode === mode) {
            this.cancelActive();

            return;
        }

        // D-07: the OTHER mode mid-stream -> cancel the current, then start the new one. Holds across all
        // THREE modes (Phase 7 D-11): pressing answer/talking-points mid-vision cancels vision and starts
        // the new one; re-pressing vision mid-stream is the same-mode cancel above. One active request, ever.
        if (this.active !== undefined) {
            this.cancelActive();
        }

        // Capture the monotonic start NOW so the logged latency measures the hotkey-to-first-token
        // interval the user actually feels (D-10). For code-challenge this is captured BEFORE the async
        // screenshot capture so capture time is included in the measured latency (RESEARCH §6).
        const startMs = Date.now();

        if (mode === 'code-challenge') {
            this.triggerCodeChallenge(span, startMs);

            return;
        }

        const requestId = ++this.requestSeq;
        const id = String(requestId);
        const at = Date.now();
        const model = mode === 'answer' ? ANSWER_MODEL : TALKING_POINTS_MODEL;
        // D-10 pull-on-trigger: read the active context FRESH here (never cached) so a mid-session
        // context Save grounds the very next trigger. `undefined` → Phase-5-identical prompt (fail-safe).
        const { system, userContent } = assemblePrompt({ mode, span, context: this.getActiveContext() });

        const stream = this.gateway.stream({ model, maxTokens: MAX_TOKENS[mode], system, userContent });
        this.active = { mode, requestId, id, stream, text: '', debounceTimer: undefined, pendingDelta: false, model, startMs, firstTokenLogged: false };

        // Surface the in-flight 'thinking…' state immediately so the entry appears before the first token (D-04).
        this.pushAi({ type: 'thinking', requestId, id, mode, at });
    }

    /**
     * The code-challenge (vision) branch of {@link trigger} (Phase 7 D-01/D-04/D-05/D-07).
     *
     * Reserves the request id + surfaces `thinking…` SYNCHRONOUSLY (so re-pressing the chord during the
     * async capture cancels this in-flight request, holding the single-in-flight invariant), then
     * captures + downscales the overlay's monitor, assembles the image+text prompt grounded in the active
     * context + transcript span (D-07), and starts the Opus stream. A capture fault is surfaced as an
     * inline `error` entry (report-don't-throw) rather than crashing main. The request-id guard means a
     * capture that resolves after the request was cancelled/superseded is dropped — its stream never starts.
     *
     * @param span - The recent transcript span (may be empty for vision — D-07).
     * @param startMs - The monotonic start captured at the chord press (before capture — RESEARCH §6).
     */
    private triggerCodeChallenge(span: string, startMs: number): void {
        const requestId = ++this.requestSeq;
        const id = String(requestId);
        const at = Date.now();

        // Reserve the request synchronously WITHOUT a stream yet: `thinking…` appears immediately and a
        // re-press / cross-mode press during the async capture cancels this pending request (the abort
        // is a no-op until the stream exists, but clearing `active` drops the resolved capture below).
        this.active = {
            mode: 'code-challenge',
            requestId,
            id,
            stream: { abort: (): void => undefined },
            text: '',
            debounceTimer: undefined,
            pendingDelta: false,
            model: CODE_CHALLENGE_MODEL,
            startMs,
            firstTokenLogged: false,
        };
        this.pushAi({ type: 'thinking', requestId, id, mode: 'code-challenge', at });

        void this.captureImage()
            .then((image) => {
                // Request-id guard: if this request was cancelled/superseded during the async capture, the
                // active request changed — drop the resolved capture, do NOT start a stream (Pitfall 1).
                if (this.active === undefined || this.active.requestId !== requestId) {
                    return;
                }

                const { system, userContent } = assemblePrompt({ mode: 'code-challenge', span, context: this.getActiveContext(), image });
                this.active.stream = this.gateway.stream({ model: CODE_CHALLENGE_MODEL, maxTokens: MAX_TOKENS['code-challenge'], system, userContent });
            })
            .catch((error: unknown) => {
                // Report-don't-throw: a capture fault surfaces as an inline error entry (reusing the
                // AI-error push path) rather than crashing main. Guarded so a fault from a superseded
                // request never overwrites a newer entry.
                if (this.active === undefined || this.active.requestId !== requestId) {
                    return;
                }

                const reason = error instanceof Error ? error.message : 'screenshot capture failed';
                const text = `AI error: ${reason}`;
                this.clearActive();
                this.history.append({ id, mode: 'code-challenge', text, kind: 'error' });
                this.pushAi({ type: 'error', requestId, id, text });
                this.pushHistorySnapshot();
            });
    }

    /**
     * Wires the gateway's typed events once. Each handler ignores events that are not for the active
     * request id (Pitfall 1), so an aborted stream's late deltas/terminals never affect a new entry.
     */
    private wireGatewayHandlers(): void {
        if (this.handlersWired) {
            return;
        }

        this.handlersWired = true;

        this.gateway.on('text', (textDelta: string) => {
            // Pitfall-1 request-id guard: with a shared gateway emitter, a delta from an aborted stream
            // can still fire after its request was cancelled. We only have one active request at a time
            // (single-in-flight, D-07), so once `active` is cleared on cancel/terminal, a late delta has
            // no active request to attach to and is dropped — it can never bleed into the new entry.
            if (this.active === undefined) {
                return;
            }

            // D-10: log the hotkey-to-first-token latency ONCE per stream, to the MAIN LOG ONLY (never
            // pushed to the renderer). Keyed on the active request (the Pitfall-1 guard above already
            // dropped late deltas from an aborted stream), so a cross-mode cancel-and-restart logs the
            // NEW stream's own measurement. Only `mode`, `model`, and `latencyMs` are logged — never the
            // transcript text, the key, or an error payload (T-5-10; mirrors index.ts:131-135 discipline).
            if (!this.active.firstTokenLogged) {
                this.active.firstTokenLogged = true;
                const latencyMs = Date.now() - this.active.startMs;
                console.log(`[ai] first-token mode=${this.active.mode} model=${this.active.model} latencyMs=${latencyMs}`);
            }

            this.active.text += textDelta;
            this.scheduleDeltaFlush(this.active.requestId);
        });

        this.gateway.on('done', (finalText: string) => {
            if (this.active === undefined) {
                return;
            }

            const { requestId, id, mode } = this.active;
            const text = finalText.length > 0 ? finalText : this.active.text;
            this.clearActive();
            this.history.append({ id, mode, text, kind: 'done' });
            this.pushAi({ type: 'done', requestId, id, text });
            this.pushHistorySnapshot();
        });

        this.gateway.on('error', (error: Error) => {
            if (this.active === undefined) {
                return;
            }

            const { requestId, id, mode } = this.active;
            // Sanitized inline reason only — NEVER the raw error payload (T-5-02: it can embed x-api-key).
            const text = `AI error: ${error.message}`;
            this.clearActive();
            this.history.append({ id, mode, text, kind: 'error' });
            this.pushAi({ type: 'error', requestId, id, text });
            this.pushHistorySnapshot();
        });

        this.gateway.on('abort', () => {
            if (this.active === undefined) {
                return;
            }

            const { requestId, id, mode } = this.active;
            this.clearActive();
            this.history.append({ id, mode, text: '(cancelled)', kind: 'cancelled' });
            this.pushAi({ type: 'cancelled', requestId, id });
            this.pushHistorySnapshot();
        });
    }

    /**
     * Schedules a trailing-edge flush of the accumulated text to the renderer (AI-04). Coalesces
     * rapid token deltas into one push per {@link DELTA_DEBOUNCE_MS} window, mirroring the house
     * 66ms audio-level throttle. The first token does NOT push synchronously; it pushes on the timer.
     */
    private scheduleDeltaFlush(requestId: number): void {
        if (this.active === undefined) {
            return;
        }

        this.active.pendingDelta = true;
        if (this.active.debounceTimer !== undefined) {
            return;
        }

        this.active.debounceTimer = setTimeout(() => {
            this.flushDelta(requestId);
        }, DELTA_DEBOUNCE_MS);
    }

    /**
     * Flushes the accumulated streamed text as one `delta` push, if there is a pending change. The
     * `requestId` captured when the timer was scheduled is re-checked here (Pitfall-1 request-id
     * guard): if the active request changed (`requestId !== this.active.requestId`) or there is no
     * active request, the timer belongs to a superseded stream and its flush is dropped.
     *
     * @param requestId - The request id active when this flush was scheduled.
     */
    private flushDelta(requestId: number): void {
        if (this.active === undefined || requestId !== this.active.requestId) {
            return;
        }

        this.active.debounceTimer = undefined;
        if (!this.active.pendingDelta) {
            return;
        }

        this.active.pendingDelta = false;
        this.pushAi({ type: 'delta', requestId: this.active.requestId, id: String(this.active.requestId), text: this.active.text });
    }

    /**
     * Cancels the active request from a hotkey re-press (D-06) or a cross-mode switch (D-07).
     *
     * Aborts the underlying stream, then records the `(cancelled)` entry and clears `active`
     * SYNCHRONOUSLY rather than waiting for the gateway's async `'abort'` event. Doing it here is the
     * Pitfall-1 guard: once `active` is cleared, a late `text`/`done` from the aborted stream finds no
     * active request and is ignored, so cancelled-stream tokens can never bleed into a new entry. The
     * gateway `'abort'` handler then no-ops (its `active === undefined` guard), avoiding a double record.
     */
    private cancelActive(): void {
        if (this.active === undefined) {
            return;
        }

        const { requestId, id, mode, stream } = this.active;
        stream.abort();
        this.clearActive();
        this.history.append({ id, mode, text: '(cancelled)', kind: 'cancelled' });
        this.pushAi({ type: 'cancelled', requestId, id });
        this.pushHistorySnapshot();
    }

    /** Clears the active request and its pending debounce timer so the next trigger starts clean. */
    private clearActive(): void {
        if (this.active?.debounceTimer !== undefined) {
            clearTimeout(this.active.debounceTimer);
        }

        this.active = undefined;
    }

    /**
     * Reconciliation hook for terminal/clear events (Pitfall 4: never on the per-delta fast path).
     *
     * In 05-01 the terminal `done`/`error`/`cancelled`/`empty` pushes already carry the authoritative
     * entry text, and the bounded history is the main-owned source of truth (D-02). A dedicated
     * `history-snapshot` push (already a variant of {@link IAiPushEvent}) is wired here in 05-03 when
     * the renderer needs the full bounded list for scrollback reconciliation — attaching it here keeps
     * it off the per-delta path so main never re-serializes the bounded list many times a second.
     */
    private pushHistorySnapshot(): void {
        // Intentionally a no-op in 05-01: the terminal pushes deliver the authoritative entry text and
        // the renderer reconciles its bounded mirror there. 05-03 attaches the full-snapshot push.
    }
}
