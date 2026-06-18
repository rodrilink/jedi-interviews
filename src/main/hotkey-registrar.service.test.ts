import { EventEmitter } from 'events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * In-memory uiohook stand-in. The real `uIOhook` singleton is an EventEmitter that emits
 * `keydown` (repeated by the OS while a key is held — the hold-to-repeat source, D-01) and
 * `keyup`, plus `start()`/`stop()`. We reuse a real EventEmitter so the registrar's actual
 * `.on('keydown', …)` wiring is exercised, and expose `emitKeydown` so tests can drive
 * single presses and simulated key-repeat streams.
 */
class FakeUiohook extends EventEmitter {
    public start(): void {
        mockStart();
    }

    public stop(): void {
        mockStop();
    }
}

const mockStart = vi.fn<() => void>();
const mockStop = vi.fn<() => void>();
let fakeUiohook: FakeUiohook;

// uiohook keycodes used by the locked, conflict-tested chord set (mirrors UiohookKey).
const KEYCODE = {
    J: 36,
    H: 35,
    Q: 16,
    K: 37,
    ArrowLeft: 57419,
    ArrowUp: 57416,
    ArrowRight: 57421,
    ArrowDown: 57424,
    BracketLeft: 26,
    BracketRight: 27,
} as const;

vi.mock('uiohook-napi', () => ({
    get uIOhook(): FakeUiohook {
        return fakeUiohook;
    },
    UiohookKey: {
        J: KEYCODE.J,
        H: KEYCODE.H,
        Q: KEYCODE.Q,
        K: KEYCODE.K,
        ArrowLeft: KEYCODE.ArrowLeft,
        ArrowUp: KEYCODE.ArrowUp,
        ArrowRight: KEYCODE.ArrowRight,
        ArrowDown: KEYCODE.ArrowDown,
        BracketLeft: KEYCODE.BracketLeft,
        BracketRight: KEYCODE.BracketRight,
    },
}));

const mockGlobalShortcutRegister = vi.fn<(accelerator: string, callback: () => void) => boolean>();
const mockGlobalShortcutUnregisterAll = vi.fn<() => void>();

vi.mock('electron', () => ({
    globalShortcut: {
        register: (accelerator: string, callback: () => void): boolean => mockGlobalShortcutRegister(accelerator, callback),
        unregisterAll: (): void => mockGlobalShortcutUnregisterAll(),
    },
}));

/** Emits a single uiohook keydown carrying the given keycode with Ctrl+Alt held. */
function emitCtrlAltKeydown(keycode: number): void {
    fakeUiohook.emit('keydown', {
        type: 4,
        time: Date.now(),
        altKey: true,
        ctrlKey: true,
        metaKey: false,
        shiftKey: false,
        keycode,
    });
}

/** Emits a single uiohook keyup carrying the given keycode (releasing the held chord). */
function emitKeyup(keycode: number): void {
    fakeUiohook.emit('keyup', {
        type: 5,
        time: Date.now(),
        altKey: true,
        ctrlKey: true,
        metaKey: false,
        shiftKey: false,
        keycode,
    });
}

/** Builds a handler map where every action label maps to a fresh spy. */
function buildHandlerSpies(labels: readonly string[]): Record<string, ReturnType<typeof vi.fn>> {
    const handlers: Record<string, ReturnType<typeof vi.fn>> = {};
    for (const label of labels) {
        handlers[label] = vi.fn<() => void>();
    }

    return handlers;
}

describe('hotkey-registrar.service', () => {
    beforeEach(() => {
        // Arrange (shared): reset mocks and re-create the fake uiohook emitter between tests.
        vi.clearAllMocks();
        fakeUiohook = new FakeUiohook();
    });

    it('should return active uiohook with no failures when every chord binds', async () => {
        // Arrange
        const { HotkeyRegistrarService, HOTKEY_ACTION_LABELS } = await import('./hotkey-registrar.service');
        const handlers = buildHandlerSpies(HOTKEY_ACTION_LABELS);
        const service = new HotkeyRegistrarService(handlers);

        // Act
        const result = service.register();

        // Assert
        expect(result.active).toBe('uiohook');
        expect(result.failed).toEqual([]);
        expect(mockStart).toHaveBeenCalledTimes(1);
    });

    it('should expose hotkey-driven transcript scroll action labels (keyboard-only scrolling)', async () => {
        // Arrange
        const { HOTKEY_ACTION_LABELS } = await import('./hotkey-registrar.service');

        // Assert
        expect(HOTKEY_ACTION_LABELS).toContain('scroll-transcript-up');
        expect(HOTKEY_ACTION_LABELS).toContain('scroll-transcript-down');
    });

    it('should surface per-chord failures in failed without throwing', async () => {
        // Arrange
        const { HotkeyRegistrarService, HOTKEY_ACTION_LABELS } = await import('./hotkey-registrar.service');
        const handlers = buildHandlerSpies(HOTKEY_ACTION_LABELS);
        // A handler map missing one action label simulates a chord that could not be bound.
        const failingLabel = HOTKEY_ACTION_LABELS[0];
        delete handlers[failingLabel];
        const service = new HotkeyRegistrarService(handlers);

        // Act
        const result = service.register();

        // Assert
        expect(result.active).toBe('uiohook');
        expect(result.failed).toContain(failingLabel);
        expect(() => service.register()).not.toThrow();
    });

    it('should fall back to globalShortcut when uiohook attach throws', async () => {
        // Arrange
        mockStart.mockImplementation(() => {
            throw new Error('uiohook attach failed');
        });
        mockGlobalShortcutRegister.mockReturnValue(true);
        const { HotkeyRegistrarService, HOTKEY_ACTION_LABELS } = await import('./hotkey-registrar.service');
        const handlers = buildHandlerSpies(HOTKEY_ACTION_LABELS);
        const service = new HotkeyRegistrarService(handlers);

        // Act
        const result = service.register();

        // Assert
        expect(result.active).toBe('globalShortcut');
        expect(result.failed).toEqual([]);
        expect(mockGlobalShortcutRegister).toHaveBeenCalled();
    });

    it('should report active none with all labels failed when both layers fail', async () => {
        // Arrange
        mockStart.mockImplementation(() => {
            throw new Error('uiohook attach failed');
        });
        mockGlobalShortcutRegister.mockReturnValue(false);
        const { HotkeyRegistrarService, HOTKEY_ACTION_LABELS } = await import('./hotkey-registrar.service');
        const handlers = buildHandlerSpies(HOTKEY_ACTION_LABELS);
        const service = new HotkeyRegistrarService(handlers);

        // Act
        const result = service.register();

        // Assert
        expect(result.active).toBe('none');
        expect(result.failed).toEqual([...HOTKEY_ACTION_LABELS]);
        expect(() => service.register()).not.toThrow();
    });

    it('should invoke repeat handlers on each uiohook key-repeat event but discrete handlers once (CR-01)', async () => {
        // Arrange
        const { HotkeyRegistrarService } = await import('./hotkey-registrar.service');
        const handlers = {
            'show/hide': vi.fn<() => void>(),
            'move-left': vi.fn<() => void>(),
            'move-right': vi.fn<() => void>(),
            'move-up': vi.fn<() => void>(),
            'move-down': vi.fn<() => void>(),
            'opacity-down': vi.fn<() => void>(),
            'opacity-up': vi.fn<() => void>(),
            'hud-toggle': vi.fn<() => void>(),
            quit: vi.fn<() => void>(),
        };
        const service = new HotkeyRegistrarService(handlers);
        service.register();

        // Act
        // The OS emits a stream of keydown events while a key is held (hold-to-repeat). The two
        // show/hide keydowns arrive with no intervening keyup — simulating a held discrete chord.
        emitCtrlAltKeydown(KEYCODE.ArrowLeft);
        emitCtrlAltKeydown(KEYCODE.ArrowLeft);
        emitCtrlAltKeydown(KEYCODE.ArrowLeft);
        emitCtrlAltKeydown(KEYCODE.BracketRight);
        emitCtrlAltKeydown(KEYCODE.BracketRight);
        emitCtrlAltKeydown(KEYCODE.J);
        emitCtrlAltKeydown(KEYCODE.J);

        // Assert
        // Repeat chords (D-01) step on every keydown.
        expect(handlers['move-left']).toHaveBeenCalledTimes(3);
        expect(handlers['opacity-up']).toHaveBeenCalledTimes(2);
        // Discrete chords fire once on the leading edge; the auto-repeat keydown is ignored.
        expect(handlers['show/hide']).toHaveBeenCalledTimes(1);
    });

    it('should fire a discrete chord again after a keyup releases the held key (CR-01)', async () => {
        // Arrange
        const { HotkeyRegistrarService } = await import('./hotkey-registrar.service');
        const handlers = buildHandlerSpies(['show/hide', 'move-left', 'move-right', 'move-up', 'move-down', 'opacity-down', 'opacity-up', 'hud-toggle', 'quit']);
        const service = new HotkeyRegistrarService(handlers);
        service.register();

        // Act
        // First press (leading edge), an auto-repeat that must be ignored, release, then a re-press.
        emitCtrlAltKeydown(KEYCODE.J);
        emitCtrlAltKeydown(KEYCODE.J);
        emitKeyup(KEYCODE.J);
        emitCtrlAltKeydown(KEYCODE.J);

        // Assert
        expect(handlers['show/hide']).toHaveBeenCalledTimes(2);
    });

    it('should fire move and opacity once per press under the globalShortcut fallback', async () => {
        // Arrange
        mockStart.mockImplementation(() => {
            throw new Error('uiohook attach failed');
        });
        // Capture the accelerator -> callback registrations so we can drive a single press.
        const registered: Record<string, () => void> = {};
        mockGlobalShortcutRegister.mockImplementation((accelerator: string, callback: () => void): boolean => {
            registered[accelerator] = callback;

            return true;
        });
        const { HotkeyRegistrarService } = await import('./hotkey-registrar.service');
        const moveHandler = vi.fn<() => void>();
        const handlers = {
            'show/hide': vi.fn<() => void>(),
            'move-left': moveHandler,
            'move-right': vi.fn<() => void>(),
            'move-up': vi.fn<() => void>(),
            'move-down': vi.fn<() => void>(),
            'opacity-down': vi.fn<() => void>(),
            'opacity-up': vi.fn<() => void>(),
            'hud-toggle': vi.fn<() => void>(),
            quit: vi.fn<() => void>(),
        };
        const service = new HotkeyRegistrarService(handlers);
        service.register();

        // Act
        // globalShortcut exposes no native key-repeat — a single accelerator fire per press.
        registered['Ctrl+Alt+Left']();

        // Assert
        expect(moveHandler).toHaveBeenCalledTimes(1);
    });

    it('should fire the clear-transcript handler once for a single Ctrl+Alt+K press (D-07)', async () => {
        // Arrange
        const { HotkeyRegistrarService, HOTKEY_ACTION_LABELS } = await import('./hotkey-registrar.service');
        const handlers = buildHandlerSpies(HOTKEY_ACTION_LABELS);
        const service = new HotkeyRegistrarService(handlers);
        service.register();

        // Act
        emitCtrlAltKeydown(KEYCODE.K);

        // Assert
        expect(handlers['clear-transcript']).toHaveBeenCalledTimes(1);
    });

    it('should surface a missing clear-transcript handler in failed (CTL-03)', async () => {
        // Arrange
        const { HotkeyRegistrarService, HOTKEY_ACTION_LABELS } = await import('./hotkey-registrar.service');
        const handlers = buildHandlerSpies(HOTKEY_ACTION_LABELS);
        delete handlers['clear-transcript'];
        const service = new HotkeyRegistrarService(handlers);

        // Act
        const result = service.register();

        // Assert
        expect(result.failed).toContain('clear-transcript');
    });
});
