import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserWindow, Display } from 'electron';

// Hoisted mock handles so each test can drive screen geometry, app.quit, and the
// overlay-window.manager show/hide/HUD seam independently. The service mutates the overlay
// window directly (geometry/opacity/visibility) and delegates reveal/hide to the manager.
const mockGetAllDisplays = vi.fn<() => Display[]>();
const mockAppQuit = vi.fn<() => void>();

vi.mock('electron', () => ({
    app: {
        quit: (): void => mockAppQuit(),
    },
    screen: {
        getAllDisplays: (): Display[] => mockGetAllDisplays(),
    },
}));

const mockShowOverlay = vi.fn<(window: BrowserWindow) => void>();
const mockHideOverlay = vi.fn<(window: BrowserWindow) => void>();
const mockPushStatus = vi.fn<(window: BrowserWindow) => void>();
const mockSetHudVisible = vi.fn<(visible: boolean) => void>();
const mockGetHudVisible = vi.fn<() => boolean>();

vi.mock('./overlay-window.manager', () => ({
    showOverlay: (window: BrowserWindow): void => mockShowOverlay(window),
    hideOverlay: (window: BrowserWindow): void => mockHideOverlay(window),
    pushStatus: (window: BrowserWindow): void => mockPushStatus(window),
    setHudVisible: (visible: boolean): void => mockSetHudVisible(visible),
    getHudVisible: (): boolean => mockGetHudVisible(),
}));

/** A single mocked display covering one rectangle of the virtual desktop. */
const createDisplay = (x: number, y: number, width: number, height: number): Display => ({ workArea: { x, y, width, height } }) as Display;

/**
 * Builds a mocked overlay BrowserWindow with controllable position/opacity. Tracks the last
 * setPosition/setOpacity calls so clamping math can be asserted, and lets each test inject the
 * starting position/opacity and the `isDestroyed` flag.
 */
const createMockWindow = ({
    position = [0, 0],
    size = [420, 220],
    opacity = 1,
    destroyed = false,
}: {
    position?: [number, number];
    size?: [number, number];
    opacity?: number;
    destroyed?: boolean;
} = {}): BrowserWindow => {
    let currentPosition: [number, number] = position;
    let currentOpacity: number = opacity;

    return {
        isDestroyed: (): boolean => destroyed,
        getPosition: (): [number, number] => currentPosition,
        setPosition: vi.fn((x: number, y: number): void => {
            currentPosition = [x, y];
        }),
        getSize: (): [number, number] => size,
        getOpacity: (): number => currentOpacity,
        setOpacity: vi.fn((value: number): void => {
            currentOpacity = value;
        }),
    } as unknown as BrowserWindow;
};

describe('window-control.actions', () => {
    beforeEach(() => {
        // Arrange (shared): reset mocks and default to a single 1920x1080 display.
        vi.clearAllMocks();
        mockGetAllDisplays.mockReturnValue([createDisplay(0, 0, 1920, 1080)]);
        mockGetHudVisible.mockReturnValue(true);
    });

    it('should reveal via showOverlay and hide via hideOverlay, never show/focus', async () => {
        // Arrange
        const window: BrowserWindow = createMockWindow();
        const { WindowControlActionsService } = await import('./window-control.actions');
        const service = new WindowControlActionsService(window);

        // Act
        service.showOverlay();
        service.hideOverlay();

        // Assert
        expect(mockShowOverlay).toHaveBeenCalledWith(window);
        expect(mockHideOverlay).toHaveBeenCalledWith(window);
    });

    it('should move by exactly 50px and clamp at the outermost virtual-desktop edge', async () => {
        // Arrange
        const window: BrowserWindow = createMockWindow({ position: [100, 100] });
        const { WindowControlActionsService } = await import('./window-control.actions');
        const service = new WindowControlActionsService(window);

        // Act
        service.moveRight();

        // Assert
        expect(window.setPosition).toHaveBeenCalledWith(150, 100);
    });

    it('should clamp a rightward move so the window stays within the outermost edge', async () => {
        // Arrange: window 420px wide near the right edge of a 1920-wide desktop.
        const window: BrowserWindow = createMockWindow({ position: [1490, 100] });
        const { WindowControlActionsService } = await import('./window-control.actions');
        const service = new WindowControlActionsService(window);

        // Act
        service.moveRight();

        // Assert: x cannot exceed 1920 - 420 = 1500 (window stays fully within the desktop).
        expect(window.setPosition).toHaveBeenCalledWith(1500, 100);
    });

    it('should allow moving right onto an adjacent monitor (crossing allowed)', async () => {
        // Arrange: two side-by-side displays; window near the first display's right edge.
        mockGetAllDisplays.mockReturnValue([createDisplay(0, 0, 1920, 1080), createDisplay(1920, 0, 1920, 1080)]);
        const window: BrowserWindow = createMockWindow({ position: [1900, 100] });
        const { WindowControlActionsService } = await import('./window-control.actions');
        const service = new WindowControlActionsService(window);

        // Act
        service.moveRight();

        // Assert: the new x lands within the union (0..3840-420), i.e. crosses past 1920.
        const [newX] = (window.setPosition as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [number, number];
        expect(newX).toBe(1950);
        expect(newX).toBeGreaterThan(1920);
    });

    it('should step opacity by 0.1 and clamp to the [0.2, 1.0] range', async () => {
        // Arrange
        const floorWindow: BrowserWindow = createMockWindow({ opacity: 0.3 });
        const ceilWindow: BrowserWindow = createMockWindow({ opacity: 1.0 });
        const midWindow: BrowserWindow = createMockWindow({ opacity: 0.6 });
        const { WindowControlActionsService } = await import('./window-control.actions');

        // Act
        new WindowControlActionsService(floorWindow).opacityDown();
        new WindowControlActionsService(ceilWindow).opacityUp();
        new WindowControlActionsService(midWindow).opacityDown();

        // Assert
        expect(floorWindow.setOpacity).toHaveBeenCalledWith(0.2);
        expect(ceilWindow.setOpacity).toHaveBeenCalledWith(1.0);
        expect(midWindow.setOpacity).toHaveBeenCalledWith(0.5);
    });

    it('should flip the main-owned hudVisible flag and push status on toggle', async () => {
        // Arrange
        mockGetHudVisible.mockReturnValue(true);
        const window: BrowserWindow = createMockWindow();
        const { WindowControlActionsService } = await import('./window-control.actions');
        const service = new WindowControlActionsService(window);

        // Act
        service.toggleHud();

        // Assert
        expect(mockSetHudVisible).toHaveBeenCalledWith(false);
        expect(mockPushStatus).toHaveBeenCalledWith(window);
    });

    it('should invoke app.quit on the quit handler', async () => {
        // Arrange
        const window: BrowserWindow = createMockWindow();
        const { WindowControlActionsService } = await import('./window-control.actions');
        const service = new WindowControlActionsService(window);

        // Act
        service.quit();

        // Assert
        expect(mockAppQuit).toHaveBeenCalledTimes(1);
    });

    it('should no-op every handler when the window is destroyed', async () => {
        // Arrange
        const window: BrowserWindow = createMockWindow({ destroyed: true });
        const { WindowControlActionsService } = await import('./window-control.actions');
        const service = new WindowControlActionsService(window);

        // Act
        service.showOverlay();
        service.hideOverlay();
        service.moveRight();
        service.opacityUp();
        service.toggleHud();

        // Assert
        expect(mockShowOverlay).not.toHaveBeenCalled();
        expect(mockHideOverlay).not.toHaveBeenCalled();
        expect(window.setPosition).not.toHaveBeenCalled();
        expect(window.setOpacity).not.toHaveBeenCalled();
        expect(mockSetHudVisible).not.toHaveBeenCalled();
    });
});
