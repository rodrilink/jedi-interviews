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
                // The AudioWorklet must be a standalone, TRANSPILED ES module loaded at runtime by
                // `audioContext.audioWorklet.addModule(url)`. Neither a `?url` import nor
                // `new URL('...worklet.ts', import.meta.url)` works here: Vite treats a bare `.ts`
                // as a static asset and emits the RAW (untranspiled) source — which the browser
                // cannot execute. Declaring the worklet as its own rollup input entry forces it
                // through the TS->JS transform. A fixed `entryFileNames` for that entry gives the
                // capture seam a stable URL (`assets/rms-meter.worklet.js`) to pass to `addModule`.
                input: {
                    index: resolve('src/renderer/index.html'),
                    'rms-meter.worklet': resolve('src/renderer/src/audio/rms-meter.worklet.ts'),
                },
                output: {
                    entryFileNames: (chunkInfo): string => (chunkInfo.name === 'rms-meter.worklet' ? 'assets/rms-meter.worklet.js' : 'assets/[name]-[hash].js'),
                },
            },
        },
        plugins: [react()],
    },
});
