import { resolve } from 'path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';

/**
 * Dedicated electron-vite config for the headless `verify:keys` check (SET-02).
 *
 * It bundles only `scripts/verify-api-keys.ts` (plus its main-process imports) into a separate
 * `out/verify-keys/` directory so neither the app's `out/main` build nor the placeholder
 * `out/verify` build is disturbed. electron-vite emits an ESM main bundle and externalizes deps, so
 * the ESM-only `electron-store@11` resolves correctly (Pitfall 5).
 */
export default defineConfig({
    main: {
        plugins: [externalizeDepsPlugin()],
        build: {
            outDir: 'out/verify-keys',
            rollupOptions: {
                input: {
                    'verify-api-keys': resolve('scripts/verify-api-keys.ts'),
                },
            },
        },
    },
});
