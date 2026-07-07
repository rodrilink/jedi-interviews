import { contextBridge, ipcRenderer } from 'electron';
import type { IpcRendererEvent } from 'electron';

/**
 * The read-only, NON-SECRET status payload pushed from main to the HUD.
 *
 * Mirrors `IOverlayStatus` in the main process. Declared here (rather than imported)
 * because the sandboxed preload is bundled separately and must not reach into main.
 */
export interface IOverlayStatus {
    electronVersion: string;
    contentProtection: boolean;
    position: { x: number; y: number };
    /** Startup hotkey-registration outcome (D-06). Declared identically in main and renderer. */
    hotkeys: { active: string; failed: string[] };
    /** Whether the HUD content is shown (D-14/D-15). Main-owned; declared identically in main and renderer. */
    hudVisible: boolean;
    /** Which panel is the active keyboard-scroll target (D-08; Phase 7 D-09 adds 'vision'). Main-owned; declared identically in main and renderer. */
    activePanel: 'transcript' | 'ai' | 'vision';
    /** Whether the overlay is interactive (click-through disabled for drag-select, quick fix 260619-mcv). Main-owned; declared identically in main and renderer. */
    overlayInteractive: boolean;
    /** Transient "Copied ✓" flash flag after a copy-on-mouse-release auto-copy (quick fix 260619-mcv). Main-owned; declared identically in main and renderer. */
    copyOk: boolean;
}

/** The local (no-AI) classification of a committed utterance (QA-03). Mirrors `UtteranceClassification` in main. */
export type UtteranceClassification = 'question' | 'statement';

/**
 * A single finalized, speaker-attributed, classified utterance (QA-07). Mirrors `IUtteranceEvent` in the
 * main process; declared here (rather than imported) because the sandboxed preload is bundled separately
 * and must not reach into main. Text + speaker + classification only; never a secret (D-08).
 */
export interface IUtteranceEvent {
    /** The finalized utterance text for this turn. */
    text: string;
    /** `'Person 1' | 'Person 2' | … ` for a diarized turn, or the neutral `'Speaker'` bucket. */
    speaker: string;
    /** `true` when `speaker` is a numbered `Person N`; `false` for the neutral bucket. */
    isDiarized: boolean;
    /** The local Question/Statement heuristic result for `text`. */
    classification: UtteranceClassification;
}

/**
 * The read-only transcript payload pushed from main over `jedi:transcript` (D-04).
 *
 * Mirrors `IOverlayTranscript` in the main process. Declared here (rather than imported) because the
 * sandboxed preload is bundled separately and must not reach into main. Text + connection state only;
 * never the Deepgram key or any secret (D-08).
 */
export interface IOverlayTranscript {
    /** The space-joined finalized transcript text in the current time window. */
    finalText: string;
    /** The current interim (partial) transcript, rendered visually distinct from final (D-04). */
    interimText: string;
    /** The coarse STT connection state (`connecting | connected | reconnecting | disconnected | error`). */
    connectionState: string;
    /** The live capture RMS level in `[0, 1]`, computed in main, rendered as the overlay audio meter. */
    audioLevel: number;
    /**
     * The full session-scoped committed utterances, oldest first (Phase 8, QA-01). Additive over the same
     * read-only channel — no new control surface. Main pushes the WHOLE list each push and empties it in
     * place on Ctrl+Alt+K (an empty push carries `utterances: []`).
     */
    utterances: IUtteranceEvent[];
}

/** IPC channel for the read-only, non-secret status push from main (D-05). */
const STATUS_CHANNEL = 'jedi:status';

/** IPC channel for the read-only, one-way transcript push from main (D-04). */
const TRANSCRIPT_CHANNEL = 'jedi:transcript';

/** IPC channel for the read-only, one-way scroll-transcript signal from main (Phase 4, hotkey-driven). */
const SCROLL_TRANSCRIPT_CHANNEL = 'jedi:scroll-transcript';

/** IPC channel for the read-only, one-way AI push from main (Phase 5, AI-04). */
const AI_CHANNEL = 'jedi:ai';

/**
 * IPC channel for the ONE renderer->main write on the jedi:* surface (quick fix 260619-mcv item 2):
 * copy-on-mouse-release. The renderer sends the current text selection; main validates it is interactive
 * + non-empty and writes the system clipboard (the renderer never imports electron). One-way send only.
 */
const COPY_SELECTION_CHANNEL = 'jedi:copy-selection';

/** The scroll direction forwarded from main (mirrors `ScrollTranscriptDirection` in the main process). */
export type ScrollTranscriptDirection = 'up' | 'down';

/** The AI mode that produced an entry (mirrors `AiMode` in the main process; Phase 7 adds 'code-challenge'). */
export type AiMode = 'answer' | 'talking-points' | 'code-challenge';

/** The request source lane (Phase 11, D-04); mirrors `RequestSource` in the main process. */
export type RequestSource = 'manual' | 'auto';

/**
 * The read-only AI push payload received over `jedi:ai` (Phase 5, AI-04). Structurally mirrors
 * `IAiPushEvent` in the main process; declared here (rather than imported) because the sandboxed
 * preload is bundled separately and must not reach into main. AI text + state only; never the
 * Anthropic key or any secret.
 */
export type IAiPushEvent =
    | { type: 'thinking'; requestId: number; id: string; mode: AiMode; at: number; source: RequestSource; question?: string }
    | { type: 'delta'; requestId: number; id: string; text: string }
    | { type: 'done'; requestId: number; id: string; text: string }
    | { type: 'error'; requestId: number; id: string; text: string }
    | { type: 'cancelled'; requestId: number; id: string }
    | { type: 'empty'; requestId: number; id: string; mode: AiMode; at: number; text: string; source: RequestSource; question?: string }
    // D-02: the clear-AI hotkey empties the panel — no entry id (it targets the whole list). Mirrors
    // the `cleared` variant declared identically in the main process (Phase 5; full snapshot push in 05-03).
    | { type: 'cleared' };

/**
 * The single typed, read-only, NON-SECRET namespace exposed on `window.jedi`.
 *
 * The boundary is overwhelmingly one-way main → renderer (D-06): `onStatus`, `onTranscript`, `onAi`, and
 * `onScrollTranscript` are subscriptions carrying proof-of-life data, the live transcript, AI events, and
 * scroll signals. The renderer → main write surface is a SINGLE narrow exception (quick fix 260619-mcv
 * item 2): `copySelection`, used only by copy-on-mouse-release while interaction mode is engaged. It
 * carries a text string to main, which validates + writes the clipboard; no secret or control state.
 *
 * Subscriptions return an unsubscribe function (WR-03) so the consuming `useEffect` can remove its
 * listener on cleanup, preventing leaked listeners under React Strict Mode.
 */
const jediApi = {
    /** Marks the structural boundary as live. */
    isReady: true as const,

    /**
     * Subscribes to read-only overlay status updates pushed from the main process.
     *
     * @param callback - Invoked with the latest non-secret status payload on every push.
     * @returns An unsubscribe function that removes the listener (WR-03).
     */
    onStatus(callback: (status: IOverlayStatus) => void): () => void {
        const listener = (_event: IpcRendererEvent, status: IOverlayStatus): void => callback(status);
        ipcRenderer.on(STATUS_CHANNEL, listener);

        return (): void => {
            ipcRenderer.removeListener(STATUS_CHANNEL, listener);
        };
    },

    /**
     * Subscribes to read-only transcript updates pushed from the main process (D-04). High-frequency:
     * interim results fire many times per second.
     *
     * @param callback - Invoked with the latest transcript snapshot + connection state on every push.
     * @returns An unsubscribe function that removes the listener (WR-03).
     */
    onTranscript(callback: (transcript: IOverlayTranscript) => void): () => void {
        const listener = (_event: IpcRendererEvent, transcript: IOverlayTranscript): void => callback(transcript);
        ipcRenderer.on(TRANSCRIPT_CHANNEL, listener);

        return (): void => {
            ipcRenderer.removeListener(TRANSCRIPT_CHANNEL, listener);
        };
    },

    /**
     * Subscribes to read-only scroll-transcript signals pushed from main when the user presses the
     * Ctrl+Alt+PageUp/PageDown hotkeys (the unfocused overlay cannot be scrolled by mouse).
     *
     * @param callback - Invoked with the scroll direction on each hotkey press.
     * @returns An unsubscribe function that removes the listener (WR-03).
     */
    onScrollTranscript(callback: (direction: ScrollTranscriptDirection) => void): () => void {
        const listener = (_event: IpcRendererEvent, direction: ScrollTranscriptDirection): void => callback(direction);
        ipcRenderer.on(SCROLL_TRANSCRIPT_CHANNEL, listener);

        return (): void => {
            ipcRenderer.removeListener(SCROLL_TRANSCRIPT_CHANNEL, listener);
        };
    },

    /**
     * Subscribes to read-only AI push events from the main process (Phase 5, AI-04). High-frequency:
     * debounced streamed deltas fire many times per response. One-way only — there is NO renderer->main
     * control channel (IN-01); AI triggers come from main-side hotkeys, and this is a pure subscription.
     *
     * @param callback - Invoked with each AI push event (thinking / delta / done / error / cancelled / empty).
     * @returns An unsubscribe function that removes the listener (WR-03).
     */
    onAi(callback: (event: IAiPushEvent) => void): () => void {
        const listener = (_event: IpcRendererEvent, payload: IAiPushEvent): void => callback(payload);
        ipcRenderer.on(AI_CHANNEL, listener);

        return (): void => {
            ipcRenderer.removeListener(AI_CHANNEL, listener);
        };
    },

    /**
     * Sends the current text selection to main to be copied to the system clipboard (quick fix
     * 260619-mcv item 2, copy-on-mouse-release). The renderer calls this on mouseup while interaction
     * mode is ON; main validates the interactive state + non-empty text and writes the clipboard (the
     * renderer never imports electron). The ONLY renderer->main write on this surface; one-way send.
     *
     * @param selection - The selected text to copy. Main ignores empty strings (plain click = no-op).
     */
    copySelection(selection: string): void {
        ipcRenderer.send(COPY_SELECTION_CHANNEL, selection);
    },
};

export type JediApi = typeof jediApi;

if (process.contextIsolated) {
    contextBridge.exposeInMainWorld('jedi', jediApi);
} else {
    // contextIsolation is mandatory for this app (D-06); fail loudly if it is ever disabled.
    throw new Error('contextIsolation must be enabled — refusing to expose the jedi bridge without it.');
}
