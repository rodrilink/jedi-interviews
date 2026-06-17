import { app } from 'electron';
import { proveSecretBoundary } from '../src/main/placeholder-secret.service';

/**
 * Headless, automatable verification of the API-key security plumbing (SET-03).
 *
 * Runs the main-process-only safeStorage (DPAPI) placeholder round-trip after the app is
 * ready (Pitfall 4 — `safeStorage.isEncryptionAvailable()` is only true after `ready`),
 * prints `PASS` and exits 0 when the round-trip reproduces the placeholder, or prints
 * `FAIL` and exits non-zero otherwise. No window is created and no manual interaction is
 * required. Neither the placeholder nor the decrypted value is ever printed (V7).
 */
app.whenReady()
    .then(() => {
        const passed: boolean = proveSecretBoundary();

        if (passed) {
            process.stdout.write('PASS\n');
            app.exit(0);
        } else {
            process.stderr.write('FAIL\n');
            app.exit(1);
        }
    })
    .catch(() => {
        process.stderr.write('FAIL\n');
        app.exit(1);
    });
