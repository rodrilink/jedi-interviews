import { resolve } from 'path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';

/**
 * Dedicated electron-vite config for the headless `verify:secret` check (SET-03).
 *
 * It bundles only `scripts/verify-secret.ts` (plus its main-process imports) into a
 * separate `out/verify/` directory so the app's normal `build` output under `out/main`
 * is never disturbed. electron-vite emits an ESM main bundle and externalizes deps, so the
 * ESM-only `electron-store@11` resolves correctly (Pitfall 5).
 */
export default defineConfig({
    main: {
        plugins: [externalizeDepsPlugin()],
        build: {
            outDir: 'out/verify',
            rollupOptions: {
                input: {
                    'verify-secret': resolve('scripts/verify-secret.ts'),
                },
            },
        },
    },
});
