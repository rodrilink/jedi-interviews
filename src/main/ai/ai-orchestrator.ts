/**
 * The priority-answer-queue AI request orchestrator (D-01..D-13, AA-05/AA-06).
 *
 * It owns the entire AI request lifecycle in the main process: read the recent transcript span,
 * guard the empty span, enqueue the request, and run exactly ONE gateway stream at a time, draining
 * the queue in priority order as each stream reaches a terminal event. It debounces the streamed
 * text deltas to the renderer and appends the finished entry to the bounded history. The renderer is
 * a pure view of the pushed {@link IAiPushEvent}s (IN-01) — there is no renderer->main control
 * surface; triggers come only from main-side hotkeys (and, from Phase 11, an auto source).
 *
 * Priority-queue semantics (v1.2, reverses v1.1 D-06/D-07):
 * - Nothing cancels an in-flight stream (D-01). Re-pressing the SAME mode (D-02) or pressing a
 *   DIFFERENT mode (D-03) mid-stream ENQUEUES the new request; the running stream always finishes
 *   first, then the queued item runs.
 * - Two-lane FIFO (D-05): manual requests run in press-order at the HEAD; auto requests (Phase 11)
 *   run in arrival-order BEHIND all manuals. A newly-enqueued manual sits behind already-queued
 *   manuals but ahead of every queued auto (no LIFO).
 * - A mode-keyed burst debounce (D-06) collapses a rapid same-mode burst into one queued request.
 * - Single-in-flight gate (D-07): at most one gateway {@link IAiGateway.stream} call is ever active.
 * - Bounded cap (D-08/D-09): the pending queue is bounded by {@link MAX_PENDING_QUEUE}; overflow
 *   silently drops the oldest AUTO; manuals are never evicted.
 *
 * Every stream + its target entry is tagged with a monotonic request id; gateway events whose id is
 * no longer the active one are ignored, so a finished stream's late deltas can never bleed into the
 * next queued entry (Pitfall 1 / D-11).
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

/**
 * The request-level burst debounce window (ms) that collapses a rapid same-mode press burst into a
 * single queued request (D-06/AA-06). This is the sibling of {@link DELTA_DEBOUNCE_MS} at the
 * request granularity: where the 40ms delta window coalesces token IPC, this ~200ms window coalesces
 * an accidental double-/triple-tap of the SAME hotkey so a fumbled press never spawns two Claude
 * calls (the money boundary). It is deliberately wider than the delta window — a human double-tap is
 * ~150–250ms apart, while a deliberate re-press to queue a second answer comes well after that. The
 * key is the mode, so pressing a DIFFERENT mode inside the window is NOT collapsed (D-06).
 */
export const BURST_DEBOUNCE_MS = 200;

/**
 * The hard ceiling on pending (not-yet-running) AUTO requests (D-08), mirroring
 * {@link AiHistory}'s `MAX_AI_ENTRIES` bounded-buffer discipline. The real runaway risk is the AUTO
 * lane once Phase 11 feeds it from question classification — a long meeting could otherwise queue
 * dozens of auto-answers behind a slow stream. On overflow the oldest AUTO is dropped (FIFO, D-09);
 * MANUALS are cap-exempt (a user's deliberate presses are never silently discarded). A small
 * single-digit bound: enough that a short burst of auto-answers survives, small enough that stale
 * autos never pile up and blow the Claude-call budget.
 */
export const MAX_PENDING_QUEUE = 5;

/** The empty-span placeholder text shown when there is nothing recent to act on (D-11). */
export const EMPTY_SPAN_TEXT = 'No recent transcript to act on';

/** The inline message shown when the Anthropic key is absent (Pitfall 3 / T-5-02). Never logs the key. */
export const MISSING_KEY_TEXT = 'AI error: missing API key';

/**
 * The request source lane (D-05). `'manual'` = a user hotkey press (runs at the queue head);
 * `'auto'` = a future Phase-11 auto-answer (runs behind all manuals, subject to eviction, D-08).
 * String-union `type` mirrors the local {@link AiMode} house style.
 */
export type RequestSource = 'manual' | 'auto';

/**
 * The one-way push payload sent to the renderer over the `jedi:ai` channel (Pitfall 4). Every
 * variant carries the `requestId` so the renderer can reconcile streaming deltas to the correct
 * in-progress entry. Streaming pushes incremental `delta`s (cheap); terminal events (`done` /
 * `error` / `cancelled`) carry the full text and the main re-pushes a bounded `history-snapshot`
 * only on terminal/clear — not per delta.
 */
export type IAiPushEvent =
    | { type: 'thinking'; requestId: number; id: string; mode: AiMode; at: number; source: RequestSource }
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

/**
 * A pending (not-yet-running) queued request (D-05). It stores only the INPUTS needed to build its
 * stream when it RUNS — prompt assembly is pull-on-run, so a manual's grounding reflects the moment
 * it runs (consistent with the old pull-on-trigger). The reserved `requestId`/`id` are allocated at
 * enqueue time so the item has a stable identity while it waits; `startMs` is captured at enqueue so
 * the D-10 latency measures the interval the user actually feels (press-to-first-token).
 */
interface IQueuedRequest {
    mode: AiMode;
    source: RequestSource;
    requestId: number;
    /** The entry id (the monotonic requestId rendered as a string) used as the renderer row key. */
    id: string;
    /** The monotonic start timestamp (ms) captured at enqueue — the D-10 latency baseline. */
    startMs: number;
}

/** The active in-flight request: its mode, monotonic id, stream handle, and accumulated text. */
interface IActiveRequest {
    mode: AiMode;
    source: RequestSource;
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
     * Monotonic start timestamp (ms) captured when the request is enqueued, used to compute the
     * hotkey-to-first-token latency (D-10). The requestId guard means a finished stream's late first
     * delta never logs here.
     */
    startMs: number;
    /** Whether the first-token latency line has already been logged for this stream (log exactly once, D-10). */
    firstTokenLogged: boolean;
}

/**
 * Orchestrates the priority answer queue with a single-in-flight execution gate.
 *
 * @remarks
 * The Electron main process has no TSyringe DI container, so this is not an `@singleton()`; it is
 * instantiated once in `index.ts` (05-01) and treated as a singleton by convention. Its dependencies
 * — the gateway, the shared transcript buffer, the shared AI history, and a `pushAi` closure — are
 * constructor-injected (it never imports the overlay manager directly), mirroring how
 * `wireSttPipeline` closes over `pushTranscript(window, …)`.
 */
export class AiOrchestrator {
    /** The ONE running slot (single-in-flight gate, D-07); `undefined` when idle. */
    private active: IActiveRequest | undefined;
    /** The sole monotonic request-id source (Pitfall 1 / D-11): every reserved id comes from `++this.requestSeq`. */
    private requestSeq = 0;
    private handlersWired = false;

    /**
     * The manual lane of the pending queue (D-05): FIFO, runs at the HEAD ahead of all autos. `push()`
     * appends, `shift()` dequeues oldest-first. Manuals are cap-exempt (D-08).
     */
    private pendingManual: IQueuedRequest[] = [];
    /**
     * The auto lane of the pending queue (D-05): FIFO, runs BEHIND every manual. Bounded by
     * {@link MAX_PENDING_QUEUE} with drop-oldest-auto eviction (D-08/D-09). Empty in Phase 10 in
     * production (no auto source yet); exercised via tests and fed by Phase 11.
     */
    private pendingAuto: IQueuedRequest[] = [];
    /**
     * Burst-debounce timers (D-06/D-01), keyed by a COMPOSITE collapse key rather than the bare mode.
     * A pending timer for a key means a matching press within the window collapses (no second enqueue),
     * mirroring the `debounceTimer !== undefined` coalesce guard in {@link scheduleDeltaFlush}.
     *
     * The composite key (see {@link burstKey}) preserves Phase-10 D-06 behavior for MANUAL requests
     * (mode-only, so a rapid double-tap of the same hotkey collapses) while making AUTO requests
     * content-aware (D-01): two DIFFERENT question texts each answer, but an identical repeated question
     * within the window collapses. The manual and auto lanes live in DISJOINT key spaces (`answer` vs
     * `answer#auto …`), so a keyless auto never folds into the manual mode-only key.
     */
    private readonly burstTimers = new Map<string, ReturnType<typeof setTimeout>>();

    /**
     * @param gateway - The AI generation seam (Anthropic in production, a fake in tests).
     * @param transcriptBuffer - The shared main-owned transcript buffer (the span source, D-09).
     * @param history - The shared bounded AI history; MUST be the same instance the clear-AI handler binds to.
     * @param pushAi - Pushes an {@link IAiPushEvent} to the renderer (a closure over the overlay window).
     * @param getActiveContext - Pulls the active session context to ground the prompt (D-10). Called
     *   FRESH when each queued item RUNS (pull-on-run) so a mid-session context Save is picked up on
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
        private readonly captureImage: () => Promise<{ base64: string; mediaType: string }> = () => Promise.reject(new Error('screenshot capture is not wired'))
    ) {
        this.wireGatewayHandlers();
    }

    /**
     * Triggers an AI request for the given mode (the hotkey entry point, D-02/D-03/D-05/D-10).
     *
     * Reads the ~60s span (D-09); if it is empty, appends the D-11 placeholder and makes NO gateway
     * call (D-13; code-challenge bypasses this — the image is actionable alone). Otherwise ENQUEUES
     * the request (D-01: nothing cancels the in-flight stream) subject to the mode-keyed burst
     * debounce (D-06). If the orchestrator is idle the drain loop starts it immediately; if a stream
     * is running the item waits its turn (manuals ahead of autos, D-05).
     *
     * @param mode - The AI mode to run.
     * @param source - The queue lane (D-05). Defaults to `'manual'` so `index.ts` stays byte-for-byte
     *   unchanged (its three hotkeys call `trigger(mode)`); Phase 11 passes `'auto'`.
     * @param contentKey - Optional content key for the AUTO lane's content-aware burst collapse (D-01):
     *   Phase 11 passes the classified question text so two DISTINCT questions each answer while an
     *   identical repeated question within the window collapses. Ignored for manual requests (they keep
     *   the Phase-10 mode-only collapse). See {@link burstKey}.
     */
    public trigger(mode: AiMode, source: RequestSource = 'manual', contentKey?: string): void {
        const span = this.transcriptBuffer.recentSince(RECENT_SPAN_MS);

        // D-11/D-13 empty-span guard — BEFORE any enqueue. Phase 7 D-07: code-challenge BYPASSES this —
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

        // D-01/D-02/D-03: enqueue (never cancel), subject to the burst debounce (D-06/D-01).
        this.enqueue(mode, source, contentKey);
    }

    /**
     * Builds the composite burst-collapse key (D-06/D-01) for the {@link burstTimers} map.
     *
     * MANUAL requests collapse on the bare `mode` (byte-for-byte Phase-10 D-06/D-10): a rapid double-tap
     * of the SAME hotkey folds into one queued request; a DIFFERENT mode has its own key.
     *
     * AUTO requests collapse on a mode + normalized-content composite so two DISTINCT question texts each
     * answer while an identical repeated question within the window collapses (D-01). Content is
     * normalized (trimmed + lowercased + inner-whitespace-collapsed) so trivially-different renderings of
     * the same question still collapse. A keyless auto (no `contentKey`) falls back to a defined
     * auto-namespaced sentinel key — REQUIRED so it lands in a key space DISJOINT from the manual
     * mode-only key and never folds a manual request (or vice versa).
     *
     * @param mode - The AI mode being enqueued.
     * @param source - The queue lane; only `'auto'` is content-keyed.
     * @param contentKey - The optional auto-lane content key (the question text).
     * @returns The composite string used to key {@link burstTimers}.
     */
    private burstKey(mode: AiMode, source: RequestSource, contentKey?: string): string {
        if (source !== 'auto') {
            // Manual: bare mode key (Phase-10 D-06 behavior, byte-for-byte).
            return mode;
        }

        // Auto: mode#auto-namespaced key, content-aware. The `#auto` namespace guarantees disjointness
        // from the manual `mode` key even when the content key is absent (the sentinel below).
        const normalized = contentKey === undefined ? '<no-content>' : contentKey.trim().toLowerCase().replace(/\s+/g, ' ');

        return `${mode}#auto ${normalized}`;
    }

    /**
     * Enqueues a request through the mode-keyed burst debounce (D-06), then places it in its lane and
     * drains (D-01/D-05). A same-mode press while its burst timer is pending COLLAPSES (returns without
     * a second enqueue), mirroring the "already scheduled → coalesce" guard in {@link scheduleDeltaFlush};
     * different modes have independent timers so they are never collapsed. On the trailing edge the
     * single reserved item is placed into its lane, the cap is enforced (D-08/D-09), and the run loop
     * is invoked.
     *
     * @param mode - The AI mode to enqueue.
     * @param source - The queue lane (D-05).
     * @param contentKey - The optional auto-lane content key threaded into the composite collapse key (D-01).
     */
    private enqueue(mode: AiMode, source: RequestSource, contentKey?: string): void {
        // Burst collapse (D-06/D-01): a pending timer for this COMPOSITE key means a matching re-press
        // folds into the already-scheduled enqueue rather than queuing a second request. Manual keys on
        // the bare mode (Phase-10); auto keys on mode + normalized content, in a disjoint namespace.
        const key = this.burstKey(mode, source, contentKey);
        if (this.burstTimers.has(key)) {
            return;
        }

        // Reserve the request identity NOW (Pitfall 1): a fresh monotonic id and the press-time start so
        // the D-10 latency measures the interval the user feels, even though the stream starts later.
        const requestId = ++this.requestSeq;
        const id = String(requestId);
        const startMs = Date.now();
        const item: IQueuedRequest = { mode, source, requestId, id, startMs };

        const timer = setTimeout(() => {
            this.burstTimers.delete(key);
            this.placeInLane(item);
            this.startNext();
        }, BURST_DEBOUNCE_MS);
        this.burstTimers.set(key, timer);
    }

    /**
     * Places a debounced item into its lane (D-05), then enforces the bounded cap (D-08/D-09).
     *
     * Manuals append behind already-queued manuals (FIFO, no LIFO); autos append behind all autos.
     * Because the manual lane is drained entirely before the auto lane in {@link dequeue}, a manual is
     * always ahead of every queued auto without any cross-lane reordering.
     *
     * @param item - The reserved request to enqueue.
     */
    private placeInLane(item: IQueuedRequest): void {
        if (item.source === 'manual') {
            this.pendingManual.push(item);
        } else {
            this.pendingAuto.push(item);
        }

        this.evictIfOverCap();
    }

    /**
     * Enforces the bounded pending cap (D-08/D-09), modeled on {@link AiHistory}'s `prune()` FIFO
     * drop-oldest loop. While the TOTAL pending count (both lanes) exceeds {@link MAX_PENDING_QUEUE},
     * drop the OLDEST AUTO (`pendingAuto.shift()`). If there is NO auto to evict (an all-manual
     * backlog), STOP and leave the manuals enqueued — MANUALS are cap-exempt (D-08): the cap bounds
     * runaway AUTO growth, not a user's deliberate presses.
     *
     * Eviction is deliberately SILENT (D-09): unlike every terminal path, it pushes NO `jedi:ai`
     * event and appends NOTHING to history, so a dropped auto leaves no trace and the glanceable
     * overlay stays uncluttered.
     */
    private evictIfOverCap(): void {
        while (this.pendingManual.length + this.pendingAuto.length > MAX_PENDING_QUEUE) {
            if (this.pendingAuto.length === 0) {
                // All-manual backlog: manuals are cap-exempt, so leave them and stop (D-08).
                return;
            }

            // Drop the oldest auto silently — no push, no history append (D-09).
            this.pendingAuto.shift();
        }
    }

    /**
     * Dequeues the highest-priority pending item: the oldest MANUAL first (head lane, D-05), then the
     * oldest AUTO. Returns `undefined` when both lanes are empty.
     *
     * @returns The next request to run, or `undefined` if the queue is empty.
     */
    private dequeue(): IQueuedRequest | undefined {
        if (this.pendingManual.length > 0) {
            return this.pendingManual.shift();
        }

        return this.pendingAuto.shift();
    }

    /**
     * The run loop / drain-to-next (D-01/D-07). Starts the next queued item, but ONLY when idle — the
     * single-in-flight gate: while `active` is set, this returns immediately, so the emitter always
     * maps to exactly one live request. Called from {@link enqueue} (so an idle orchestrator starts
     * immediately) and from every terminal path AFTER {@link clearActive} (so the queue drains).
     */
    private startNext(): void {
        // Single-in-flight gate (D-07): never start a second stream while one is running.
        if (this.active !== undefined) {
            return;
        }

        const item = this.dequeue();
        if (item === undefined) {
            return;
        }

        this.startRequest(item);
    }

    /**
     * Starts a dequeued item: assembles its prompt (pull-on-run, D-10), starts exactly one gateway
     * stream, sets it as the active in-flight request, and surfaces `thinking…` (D-04). A
     * code-challenge item routes to the async-capture reserve path ({@link startCodeChallenge}), NOT a
     * direct `gateway.stream`, preserving the Phase-7 capture flow.
     *
     * @param item - The reserved request to run.
     */
    private startRequest(item: IQueuedRequest): void {
        if (item.mode === 'code-challenge') {
            this.startCodeChallenge(item);

            return;
        }

        const { mode, source, requestId, id, startMs } = item;
        const at = Date.now();
        const model = mode === 'answer' ? ANSWER_MODEL : TALKING_POINTS_MODEL;
        // D-10 pull-on-run: read the active context FRESH here (never cached) so a mid-session context
        // Save grounds this run. `undefined` → Phase-5-identical prompt (fail-safe).
        const span = this.transcriptBuffer.recentSince(RECENT_SPAN_MS);
        const { system, userContent } = assemblePrompt({ mode, span, context: this.getActiveContext() });

        const stream = this.gateway.stream({ requestId, model, maxTokens: MAX_TOKENS[mode], system, userContent });
        this.active = { mode, source, requestId, id, stream, text: '', debounceTimer: undefined, pendingDelta: false, model, startMs, firstTokenLogged: false };

        // Surface the in-flight 'thinking…' state at run-start so the entry appears before the first token (D-04).
        // `source` (D-04) rides the push so the renderer can badge auto entries (renderer badge lands in Plan 02).
        this.pushAi({ type: 'thinking', requestId, id, mode, at, source });
    }

    /**
     * The code-challenge (vision) run path (Phase 7 D-01/D-04/D-05/D-07, D-13).
     *
     * Reserves the active slot with a placeholder stream + surfaces `thinking…` SYNCHRONOUSLY, then
     * captures + downscales the overlay's monitor, assembles the image+text prompt grounded in the
     * active context + transcript span (pull-on-run), and starts the Opus stream. A capture fault is
     * surfaced as an inline `error` entry (report-don't-throw) and drains to the next queued item so a
     * failed capture never strands the queue. The request-id guard means a capture that resolves after
     * this request was superseded is dropped — its stream never starts.
     *
     * @param item - The reserved code-challenge request to run.
     */
    private startCodeChallenge(item: IQueuedRequest): void {
        const { mode, source, requestId, id, startMs } = item;
        const at = Date.now();
        // The span for a queued code-challenge is read at run time (pull-on-run); it may be empty (D-13).
        const span = this.transcriptBuffer.recentSince(RECENT_SPAN_MS);

        // Reserve the request synchronously WITHOUT a stream yet: `thinking…` appears immediately.
        this.active = {
            mode,
            source,
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
        this.pushAi({ type: 'thinking', requestId, id, mode: 'code-challenge', at, source });

        void this.captureImage()
            .then((image) => {
                // Request-id guard: if this request was superseded during the async capture, the active
                // request changed — drop the resolved capture, do NOT start a stream (Pitfall 1).
                if (this.active === undefined || this.active.requestId !== requestId) {
                    return;
                }

                const { system, userContent } = assemblePrompt({ mode: 'code-challenge', span, context: this.getActiveContext(), image });
                this.active.stream = this.gateway.stream({ requestId, model: CODE_CHALLENGE_MODEL, maxTokens: MAX_TOKENS['code-challenge'], system, userContent });
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
                // Drain to the next queued item so a failed capture never strands the queue.
                this.startNext();
            });
    }

    /**
     * Wires the gateway's typed events once. Each handler ignores events that are not for the active
     * request id (Pitfall 1 / D-11), so a finished stream's late deltas/terminals never affect the
     * next queued entry. The terminal handlers clear the active slot FIRST, then record/push, then
     * drain to the next queued item — the order that keeps the single-in-flight invariant.
     */
    private wireGatewayHandlers(): void {
        if (this.handlersWired) {
            return;
        }

        this.handlersWired = true;

        this.gateway.on('text', (textDelta: string, requestId: number) => {
            // Pitfall-1 request-id guard (D-11 / T-10-05): the gateway is a shared emitter and requests
            // run back-to-back — when request 1 terminates it synchronously starts request 2 (clearActive
            // + startNext in the same tick), so `active` is NOT undefined when a request-1 straggler
            // arrives. We positively match the event's originating `requestId` to the active request's id
            // (mirroring flushDelta/startCodeChallenge); a delta from any superseded stream is dropped and
            // can never bleed into the now-active next entry.
            if (this.active === undefined || requestId !== this.active.requestId) {
                return;
            }

            // D-10: log the hotkey-to-first-token latency ONCE per stream, to the MAIN LOG ONLY (never
            // pushed to the renderer). Keyed on the active request (the Pitfall-1 guard above already
            // dropped late deltas from a finished stream), so each dequeued request logs its OWN
            // measurement. Only `mode`, `model`, and `latencyMs` are logged — never the transcript text,
            // the key, or an error payload (T-5-10; mirrors index.ts:131-135 discipline).
            if (!this.active.firstTokenLogged) {
                this.active.firstTokenLogged = true;
                const latencyMs = Date.now() - this.active.startMs;
                console.log(`[ai] first-token mode=${this.active.mode} model=${this.active.model} latencyMs=${latencyMs}`);
            }

            this.active.text += textDelta;
            this.scheduleDeltaFlush(this.active.requestId);
        });

        this.gateway.on('done', (finalText: string, eventRequestId: number) => {
            // Positive request-id guard (D-11 / WR-01): drop a duplicate/straggler terminal from a
            // superseded stream so it never prematurely terminates the now-active next request.
            if (this.active === undefined || eventRequestId !== this.active.requestId) {
                return;
            }

            const { requestId, id, mode } = this.active;
            const text = finalText.length > 0 ? finalText : this.active.text;
            this.clearActive();
            this.history.append({ id, mode, text, kind: 'done' });
            this.pushAi({ type: 'done', requestId, id, text });
            this.pushHistorySnapshot();
            // Drain to the next queued item (D-01/D-05): the manual lane first, then the auto lane.
            this.startNext();
        });

        this.gateway.on('error', (error: Error, eventRequestId: number) => {
            // Positive request-id guard (D-11): a superseded stream's late error must not terminate the
            // now-active next request.
            if (this.active === undefined || eventRequestId !== this.active.requestId) {
                return;
            }

            const { requestId, id, mode } = this.active;
            // Sanitized inline reason only — NEVER the raw error payload (T-5-02: it can embed x-api-key).
            const text = `AI error: ${error.message}`;
            this.clearActive();
            this.history.append({ id, mode, text, kind: 'error' });
            this.pushAi({ type: 'error', requestId, id, text });
            this.pushHistorySnapshot();
            // Drain to the next queued item so a transport fault never strands the queue.
            this.startNext();
        });

        // DORMANT (D-12): no trigger references the abort path in v1.2 (cancel-on-re-press removed, D-01),
        // but the handler keeps the same positive request-id guard as the others so the dormant seam stays
        // consistent if a future phase re-wires an explicit cancel.
        this.gateway.on('abort', (eventRequestId: number) => {
            if (this.active === undefined || eventRequestId !== this.active.requestId) {
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
     * DORMANT explicit-cancel seam (D-12). v1.2 removed cancel-on-re-press (D-01), so NO hotkey is
     * wired to this yet — `index.ts` never calls it. It is retained as the reachable entrypoint the
     * deferred "cancel current stream" hotkey (see CONTEXT Deferred Ideas) will bind to, keeping the
     * whole abort chain (`cancelActive`, the `'abort'` handler, the `'cancelled'` push variant, and
     * {@link IAiStream.abort}) live and typecheck-honest without a lint suppression. Aborting a queued
     * (not-yet-running) request is out of scope here — this cancels only the in-flight stream.
     */
    public cancelActiveRequest(): void {
        this.cancelActive();
    }

    /**
     * Cancels the active request by aborting its stream and recording a `(cancelled)` entry.
     *
     * DORMANT in v1.2 (D-12): reached only via the dormant {@link cancelActiveRequest} seam, never
     * from {@link trigger} (nothing cancels an in-flight stream, D-01). Retained so a future
     * explicit-cancel hotkey or clean-shutdown abort reuses it without a rewrite. Do NOT delete.
     *
     * Aborts the underlying stream, then records the `(cancelled)` entry and clears `active`
     * SYNCHRONOUSLY rather than waiting for the gateway's async `'abort'` event — the Pitfall-1 guard:
     * once `active` is cleared, a late `text`/`done` from the aborted stream finds no active request
     * and is ignored. The gateway `'abort'` handler then no-ops (its `active === undefined` guard).
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

    /** Clears the active request and its pending debounce timer so the next run starts clean. */
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
