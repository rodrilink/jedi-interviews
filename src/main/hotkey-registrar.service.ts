import { globalShortcut } from 'electron';
import { uIOhook, UiohookKey, type UiohookKeyboardEvent } from 'uiohook-napi';

/**
 * The layer that ended up handling hotkeys after {@link HotkeyRegistrarService.register}:
 * the passive uiohook hook (preferred), the globalShortcut fallback, or none if both failed.
 */
export type HotkeyLayer = 'uiohook' | 'globalShortcut' | 'none';

/**
 * The aggregated outcome of registering the locked action set at startup (D-07: startup-only).
 *
 * Mirrors the graceful-degradation return shape of `placeholder-secret.service.ts` — the
 * registrar NEVER throws on a chord conflict or a failed uiohook attach; it reports which
 * layer is active and which action labels still failed so the HUD can surface them (D-06/D-08).
 */
export interface IHotkeyRegistrationResult {
    /** The layer that handled registration: 'uiohook', 'globalShortcut', or 'none'. */
    active: HotkeyLayer;
    /** Action labels whose chord failed to bind — surfaced in the HUD, never silently dropped. */
    failed: string[];
}

/** A handler map keyed by action label. 02-02 injects real window-control handlers. */
export type HotkeyHandlerMap = Record<string, () => void>;

/**
 * Whether an action repeats while its chord is held (move/opacity — D-01) or fires once
 * per discrete press (show/hide, HUD toggle, quit).
 */
type ActionKind = 'repeat' | 'discrete';

/** A single locked action: its uiohook keycode, its globalShortcut accelerator, and its kind. */
interface IHotkeyChord {
    /** Stable action label used as the handler-map key and in {@link IHotkeyRegistrationResult.failed}. */
    label: string;
    /** uiohook physical keycode (the chord's non-modifier key). Ctrl+Alt is required on every chord. */
    keycode: number;
    /** Electron globalShortcut accelerator string for the fallback layer. */
    accelerator: string;
    /** 'repeat' for move/opacity hold-to-repeat (D-01); 'discrete' otherwise. */
    kind: ActionKind;
}

/**
 * The locked five-group Ctrl+Alt action set (D-05) with its finalized default chords. These
 * chords are the conflict-tested defaults: 02-03 empirically verified every one against
 * Microsoft Teams, Zoom, and VS Code holding focus on the target Windows 11 machine — each
 * overlay action fired, no app swallowed the chord, and every app-own Ctrl+Alt accelerator
 * still fired (passive uiohook non-consumption, CTL-02). No chord collided, so the suggested
 * defaults ship unchanged. See `.planning/phases/02-global-hotkeys-window-control/02-HOTKEY-CONFLICT-TEST.md`.
 */
const HOTKEY_CHORDS: readonly IHotkeyChord[] = [
    { label: 'show/hide', keycode: UiohookKey.J, accelerator: 'Ctrl+Alt+J', kind: 'discrete' },
    { label: 'move-left', keycode: UiohookKey.ArrowLeft, accelerator: 'Ctrl+Alt+Left', kind: 'repeat' },
    { label: 'move-right', keycode: UiohookKey.ArrowRight, accelerator: 'Ctrl+Alt+Right', kind: 'repeat' },
    { label: 'move-up', keycode: UiohookKey.ArrowUp, accelerator: 'Ctrl+Alt+Up', kind: 'repeat' },
    { label: 'move-down', keycode: UiohookKey.ArrowDown, accelerator: 'Ctrl+Alt+Down', kind: 'repeat' },
    { label: 'opacity-down', keycode: UiohookKey.BracketLeft, accelerator: 'Ctrl+Alt+[', kind: 'repeat' },
    { label: 'opacity-up', keycode: UiohookKey.BracketRight, accelerator: 'Ctrl+Alt+]', kind: 'repeat' },
    { label: 'hud-toggle', keycode: UiohookKey.H, accelerator: 'Ctrl+Alt+H', kind: 'discrete' },
    { label: 'quit', keycode: UiohookKey.Q, accelerator: 'Ctrl+Alt+Q', kind: 'discrete' },
    // Phase 4 (D-07/TRN-04): wipe the main-side TranscriptBuffer. 'K' for "clear" is not in the
    // locked, conflict-tested set {J, arrows, [, ], H, Q}; the on-machine Teams/Zoom/VS Code
    // re-check is scheduled for 04-04's manual verify (fall back to 'X' if a conflict surfaces).
    // 'discrete' so a held key clears once per press, not repeatedly. The clear-transcript handler
    // (transcriptBuffer.clear()) is wired in index.ts (04-04); a missing handler surfaces in
    // register().failed (CTL-03), exactly like every other chord — no registrar logic changes.
    { label: 'clear-transcript', keycode: UiohookKey.K, accelerator: 'Ctrl+Alt+K', kind: 'discrete' },
];

/** The ordered list of action labels in the locked set, exported for tests and HUD copy. */
export const HOTKEY_ACTION_LABELS: readonly string[] = HOTKEY_CHORDS.map((chord) => chord.label);

/**
 * Registers the locked Ctrl+Alt action set as a passive low-level hook via uiohook-napi
 * (preferred — never consumes the focused meeting app's accelerators), falling back to
 * Electron `globalShortcut` only if the native hook cannot attach (D-08). Aggregates each
 * chord's result into {@link IHotkeyRegistrationResult} and wires hold-to-repeat for move/
 * opacity off uiohook's keydown stream (the OS re-emits keydown while a key is held — D-01).
 *
 * @remarks
 * The IDEXX `@singleton()` decorator is NOT applicable here: the Electron main process has no
 * TSyringe DI container. This service is instantiated exactly once in `index.ts` and treated
 * as a singleton by convention.
 */
export class HotkeyRegistrarService {
    private activeLayer: HotkeyLayer = 'none';

    /**
     * Keycodes of currently-held DISCRETE chords. The OS re-emits `keydown` on its auto-repeat
     * stream while a key is held; a discrete chord must fire only on the leading edge of a press,
     * so we record its keycode here on first fire and ignore subsequent auto-repeat keydowns until
     * the matching `keyup` removes it. Repeat chords (move/opacity, D-01) are never tracked here —
     * they intentionally fire on every keydown.
     */
    private readonly heldDiscreteKeycodes = new Set<number>();

    /**
     * @param handlers - Map of action label -> handler invoked when that chord fires. In this
     *   plan the handlers may be no-op stubs; 02-02 injects the real window-control handlers.
     *   A missing entry for a locked label is treated as a failed binding (surfaced, not thrown).
     */
    public constructor(private readonly handlers: HotkeyHandlerMap) {}

    /**
     * Registers every locked chord once, at startup (D-07), and returns the aggregated outcome.
     * Never throws on a chord-bind failure or a uiohook attach failure: a failure adds the
     * action label to `failed` and, for a total uiohook failure, routes to the globalShortcut
     * fallback before reporting (D-08).
     *
     * @returns The active layer and the list of action labels that failed to bind.
     */
    public register(): IHotkeyRegistrationResult {
        try {
            const failed: string[] = this.bindViaUiohook();
            this.activeLayer = 'uiohook';

            return { active: 'uiohook', failed };
        } catch {
            // uiohook could not attach at all — fall back to globalShortcut (D-08).
            return this.bindViaGlobalShortcut();
        }
    }

    /**
     * Releases the active layer's resources. Safe to call regardless of which layer (if any)
     * registered: stops the uiohook hook and/or clears all globalShortcut accelerators.
     */
    public teardown(): void {
        if (this.activeLayer === 'uiohook') {
            uIOhook.stop();
        } else if (this.activeLayer === 'globalShortcut') {
            globalShortcut.unregisterAll();
        }

        // Clear the leading-edge guard so a fresh register() starts with no stale held keys.
        this.heldDiscreteKeycodes.clear();
        this.activeLayer = 'none';
    }

    /**
     * Attaches the uiohook keydown listener and starts the hook. A missing handler for a locked
     * label counts as a failed binding (collected in the returned list). Throws only if the
     * native hook itself cannot start, which routes to the globalShortcut fallback in
     * {@link register}.
     *
     * @returns The action labels with no handler (failed bindings).
     */
    private bindViaUiohook(): string[] {
        const failed: string[] = [];

        for (const chord of HOTKEY_CHORDS) {
            if (typeof this.handlers[chord.label] !== 'function') {
                failed.push(chord.label);
            }
        }

        // The OS re-emits `keydown` while a key is held. Repeat chords (move/opacity) fire on every
        // such event to give them their hold-to-repeat behavior (D-01). Discrete chords are guarded
        // by a leading-edge check in dispatchUiohookKeydown so they fire once per physical press;
        // the keyup listener below clears the held key so the next press fires again.
        uIOhook.on('keydown', (event: UiohookKeyboardEvent) => {
            this.dispatchUiohookKeydown(event);
        });

        uIOhook.on('keyup', (event: UiohookKeyboardEvent) => {
            this.heldDiscreteKeycodes.delete(event.keycode);
        });

        uIOhook.start();

        return failed;
    }

    /**
     * Matches a uiohook keydown against the locked chords (Ctrl+Alt + keycode) and invokes the
     * matching action's handler. Invoked on EACH keydown — including the OS auto-repeat stream.
     * Repeat chords (move/opacity) step on every repeat (D-01); discrete chords are gated by a
     * leading-edge guard so they fire once per press and ignore auto-repeat until `keyup`.
     *
     * @param event - The uiohook keyboard event.
     */
    private dispatchUiohookKeydown(event: UiohookKeyboardEvent): void {
        if (!event.ctrlKey || !event.altKey) {
            return;
        }

        const chord = HOTKEY_CHORDS.find((candidate) => candidate.keycode === event.keycode);
        if (chord === undefined) {
            return;
        }

        if (chord.kind === 'discrete') {
            if (this.heldDiscreteKeycodes.has(chord.keycode)) {
                // Auto-repeat keydown for a still-held discrete chord — ignore until keyup.
                return;
            }

            this.heldDiscreteKeycodes.add(chord.keycode);
        }

        const handler = this.handlers[chord.label];
        if (typeof handler === 'function') {
            handler();
        }
    }

    /**
     * Fallback layer used only when the native uiohook hook cannot attach (D-08). Registers each
     * chord via `globalShortcut.register`, whose boolean return is the ONLY conflict signal
     * (globalShortcut silently fails on conflict — CLAUDE.md). A `false` return adds the label
     * to `failed`.
     *
     * @remarks
     * globalShortcut has NO native key-repeat, so under this fallback layer move/opacity fire
     * once per accelerator press — hold-to-repeat (D-01) is a uiohook-only capability. This
     * limitation is surfaced in the plan SUMMARY rather than silently dropped; we do not
     * synthesize a repeat timer for the fallback.
     *
     * @returns The aggregated registration result for the fallback layer.
     */
    private bindViaGlobalShortcut(): IHotkeyRegistrationResult {
        const failed: string[] = [];

        for (const chord of HOTKEY_CHORDS) {
            const handler = this.handlers[chord.label];
            if (typeof handler !== 'function') {
                failed.push(chord.label);
                continue;
            }

            const registered: boolean = globalShortcut.register(chord.accelerator, handler);
            if (!registered) {
                failed.push(chord.label);
            }
        }

        this.activeLayer = failed.length === HOTKEY_CHORDS.length ? 'none' : 'globalShortcut';

        return { active: this.activeLayer, failed };
    }
}
