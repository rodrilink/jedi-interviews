import { app, screen, type BrowserWindow } from 'electron';
import { showOverlay, hideOverlay, pushStatus, setHudVisible, getHudVisible } from './overlay-window.manager';

/** Pixels the overlay moves per step (D-02: ~50px medium step). */
const MOVE_STEP_PX = 50;

/** Opacity change per step (D-03: 10% increments). */
const OPACITY_STEP = 0.1;

/** Lowest allowed opacity — faint but never fully invisible so the overlay can't be lost (D-09). */
const OPACITY_FLOOR = 0.2;

/** Highest allowed opacity — fully opaque for maximum readability (D-09). */
const OPACITY_CEILING = 1.0;

/**
 * Clamps a value to an inclusive range.
 *
 * @param value - The value to clamp.
 * @param minimum - The lower bound.
 * @param maximum - The upper bound.
 * @returns The value constrained to `[minimum, maximum]`.
 */
function clamp(value: number, minimum: number, maximum: number): number {
    return Math.min(maximum, Math.max(minimum, value));
}

/**
 * The bounding rectangle of the whole virtual desktop, computed as the union of every display's
 * work area (D-10). Moving may cross onto adjacent monitors; clamping only ever happens at these
 * outermost edges so the overlay can never be pushed fully off all screens.
 */
interface IVirtualDesktopBounds {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
}

/**
 * Mutates the overlay window in response to global hotkeys: show/hide (via the
 * {@link showOverlay}/{@link hideOverlay} wrappers, never `show()`/`focus()`), move with
 * outermost-edge clamping that may cross monitors (D-10), opacity stepping within a 20%->100%
 * range (D-03/D-09), HUD-content toggle (D-14), and quit (D-04). Every handler guards
 * `isDestroyed()` because hotkeys fire asynchronously, possibly mid-teardown.
 *
 * Hold-to-repeat (D-01) is owned by `HotkeyRegistrarService` — it invokes these per-step,
 * idempotent handlers on each uiohook key-repeat event; this service adds no repeat timer.
 * Position and opacity are NOT persisted across restarts (D-11): no electron-store writes here.
 *
 * @remarks
 * The IDEXX `@singleton()` decorator is not applicable in the Electron main process (no TSyringe
 * container). This service is instantiated once in `index.ts` and treated as a singleton by
 * convention, like {@link HotkeyRegistrarService}.
 */
export class WindowControlActionsService {
    /**
     * @param window - The overlay window every handler mutates.
     */
    public constructor(private readonly window: BrowserWindow) {}

    /**
     * Reveals the overlay through the sanctioned {@link showOverlay} wrapper, which re-applies
     * content protection, always-on-top, and click-through on every show (OVL-04). Never calls
     * `show()`/`focus()`, so the overlay never steals focus from the meeting app (OVL-02).
     */
    public showOverlay(): void {
        if (this.window.isDestroyed()) {
            return;
        }

        showOverlay(this.window);
    }

    /**
     * Hides the overlay window through the sanctioned {@link hideOverlay} wrapper.
     */
    public hideOverlay(): void {
        if (this.window.isDestroyed()) {
            return;
        }

        hideOverlay(this.window);
    }

    /** Nudges the overlay one step left (D-02), clamped at the outermost virtual-desktop edge. */
    public moveLeft(): void {
        this.move(-MOVE_STEP_PX, 0);
    }

    /** Nudges the overlay one step right (D-02), clamped at the outermost virtual-desktop edge. */
    public moveRight(): void {
        this.move(MOVE_STEP_PX, 0);
    }

    /** Nudges the overlay one step up (D-02), clamped at the outermost virtual-desktop edge. */
    public moveUp(): void {
        this.move(0, -MOVE_STEP_PX);
    }

    /** Nudges the overlay one step down (D-02), clamped at the outermost virtual-desktop edge. */
    public moveDown(): void {
        this.move(0, MOVE_STEP_PX);
    }

    /** Raises opacity one 10% step toward the 100% ceiling (D-03/D-09). */
    public opacityUp(): void {
        this.stepOpacity(OPACITY_STEP);
    }

    /** Lowers opacity one 10% step toward the 20% floor (D-03/D-09). */
    public opacityDown(): void {
        this.stepOpacity(-OPACITY_STEP);
    }

    /**
     * Flips the main-owned HUD-content visibility flag (D-14/D-15) and pushes the new status so
     * the renderer reflects it as a pure view. Toggles the HUD *content*, not the overlay window.
     */
    public toggleHud(): void {
        if (this.window.isDestroyed()) {
            return;
        }

        setHudVisible(!getHudVisible());
        pushStatus(this.window);
    }

    /**
     * Quits the app via `app.quit()` (D-04) — the only non-Task-Manager exit, since the overlay
     * has no taskbar icon or close button.
     */
    public quit(): void {
        app.quit();
    }

    /**
     * Shifts the overlay by `(dx, dy)` and clamps the result so the window stays within the
     * outermost edges of the whole virtual desktop (D-10) — it may cross onto adjacent monitors
     * but can never be pushed fully off all screens. No persistence (D-11).
     *
     * @param dx - Horizontal delta in pixels.
     * @param dy - Vertical delta in pixels.
     */
    private move(dx: number, dy: number): void {
        if (this.window.isDestroyed()) {
            return;
        }

        const [x, y] = this.window.getPosition();
        const [width, height] = this.window.getSize();
        const bounds: IVirtualDesktopBounds = this.virtualDesktopBounds();

        const clampedX: number = clamp(x + dx, bounds.minX, bounds.maxX - width);
        const clampedY: number = clamp(y + dy, bounds.minY, bounds.maxY - height);

        this.window.setPosition(clampedX, clampedY);
    }

    /**
     * Adjusts opacity by `delta`, clamped to the `[0.2, 1.0]` range (D-09). Rounded to one
     * decimal so repeated 0.1 steps don't accumulate floating-point drift.
     *
     * @param delta - The opacity change (+/- 0.1 per step).
     */
    private stepOpacity(delta: number): void {
        if (this.window.isDestroyed()) {
            return;
        }

        const next: number = clamp(this.window.getOpacity() + delta, OPACITY_FLOOR, OPACITY_CEILING);
        this.window.setOpacity(Math.round(next * 10) / 10);
    }

    /**
     * Computes the union of every display's work area — the outermost rectangle the overlay may
     * occupy (D-10). Used to clamp moves at the virtual-desktop edge while allowing monitor
     * crossing.
     *
     * @returns The min/max X/Y of the whole virtual desktop.
     */
    private virtualDesktopBounds(): IVirtualDesktopBounds {
        const displays = screen.getAllDisplays();

        const bounds: IVirtualDesktopBounds = {
            minX: Number.POSITIVE_INFINITY,
            minY: Number.POSITIVE_INFINITY,
            maxX: Number.NEGATIVE_INFINITY,
            maxY: Number.NEGATIVE_INFINITY,
        };

        for (const display of displays) {
            const { x, y, width, height } = display.workArea;
            bounds.minX = Math.min(bounds.minX, x);
            bounds.minY = Math.min(bounds.minY, y);
            bounds.maxX = Math.max(bounds.maxX, x + width);
            bounds.maxY = Math.max(bounds.maxY, y + height);
        }

        return bounds;
    }
}
