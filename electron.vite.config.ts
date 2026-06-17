import { resolve } from 'path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
    main: {
        plugins: [externalizeDepsPlugin()],
        build: {
            rollupOptions: {
                input: {
                    index: resolve('src/main/index.ts'),
                },
            },
        },
    },
    preload: {
        plugins: [externalizeDepsPlugin()],
        build: {
            rollupOptions: {
                input: {
                    index: resolve('src/preload/index.ts'),
                },
                output: {
                    // Sandboxed preloads (sandbox:true, D-06) MUST be CommonJS — Electron does
                    // not support ES-module preloads under the sandbox. Force a .cjs output so
                    // the main process can load it regardless of the project's type:module.
                    format: 'cjs',
                    entryFileNames: '[name].cjs',
                },
            },
        },
    },
    renderer: {
        root: 'src/renderer',
        resolve: {
            alias: {
                '@renderer': resolve('src/renderer/src'),
            },
        },
        build: {
            rollupOptions: {
                input: {
                    index: resolve('src/renderer/index.html'),
                },
            },
        },
        plugins: [react()],
    },
});
