import { app, BrowserWindow } from 'electron';
import { join } from 'path';
import { fileURLToPath } from 'url';

const currentDirectory: string = fileURLToPath(new URL('.', import.meta.url));

/**
 * Creates the application's main window.
 *
 * The renderer is wired with the structural security boundary from the start (D-06):
 * contextIsolation and sandbox are enabled, nodeIntegration is left disabled, and the
 * renderer can only reach the main process through the typed contextBridge preload.
 *
 * @returns The created BrowserWindow instance.
 */
function createWindow(): BrowserWindow {
    const window = new BrowserWindow({
        width: 900,
        height: 670,
        show: false,
        autoHideMenuBar: true,
        webPreferences: {
            preload: join(currentDirectory, '../preload/index.cjs'),
            contextIsolation: true,
            sandbox: true,
            backgroundThrottling: false,
        },
    });

    window.on('ready-to-show', () => {
        window.show();
    });

    // electron-vite injects ELECTRON_RENDERER_URL in dev for HMR; load the built file otherwise.
    if (process.env.ELECTRON_RENDERER_URL) {
        void window.loadURL(process.env.ELECTRON_RENDERER_URL);
    } else {
        void window.loadFile(join(currentDirectory, '../renderer/index.html'));
    }

    return window;
}

app.whenReady().then(() => {
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
