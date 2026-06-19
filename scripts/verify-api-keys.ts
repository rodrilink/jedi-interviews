import { app } from 'electron';
import { ApiKeyStoreService } from '../src/main/secrets/api-key-store.service';

/**
 * Headless, automatable verification of the two-key API-key store (SET-02, VALIDATION.md).
 *
 * Runs the main-process-only safeStorage (DPAPI) round-trip for BOTH keys after the app is ready
 * (Pitfall 2 — `safeStorage.isEncryptionAvailable()` is only true after `ready`): it saves a test
 * Deepgram key and a test Anthropic key, reads each back decrypted, and asserts each strictly equals
 * its original. Prints `PASS` and exits 0 when both round-trips reproduce their originals, or `FAIL`
 * and exits non-zero otherwise. No window is created and no manual interaction is required. The key
 * values are NEVER printed (T-06-02) — only PASS/FAIL crosses stdout/stderr.
 */
const DEEPGRAM_TEST_KEY = 'dg-test-key';
const ANTHROPIC_TEST_KEY = 'an-test-key';

app.whenReady()
    .then(() => {
        const store = new ApiKeyStoreService();

        store.saveDeepgram(DEEPGRAM_TEST_KEY);
        store.saveAnthropic(ANTHROPIC_TEST_KEY);

        const deepgramMatches: boolean = store.getDeepgram() === DEEPGRAM_TEST_KEY;
        const anthropicMatches: boolean = store.getAnthropic() === ANTHROPIC_TEST_KEY;

        if (deepgramMatches && anthropicMatches) {
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
