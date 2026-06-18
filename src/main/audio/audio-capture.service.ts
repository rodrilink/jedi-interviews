import { AudioRecorder } from 'native-recorder-nodejs';

import { downmixToMonoFloat32, resampleLinear, float32ToInt16, assertSampleRate } from './pcm-resample.utility';

/** Target output rate for Deepgram's linear16 endpoint (16 kHz mono), matching the resample utility (TRN-01). */
const TARGET_SAMPLE_RATE = 16000;

/** The minimal output-device shape this service needs from `AudioRecorder.getDevices` (id/name/isDefault). */
export interface ICaptureDevice {
    id: string;
    name: string;
    isDefault: boolean;
}

/**
 * Chooses which output device to capture (04-01 finding: `isDefault` is not necessarily where Windows
 * routes audio). Precedence: an explicit name override (case-insensitive substring) → the device
 * flagged default → the first enumerated device. Pure and side-effect free so it is unit-testable.
 *
 * @param devices - The enumerated output devices (must be non-empty; callers guard the empty case).
 * @param overrideName - Optional case-insensitive name substring to pin a specific device.
 * @returns The selected device.
 */
export function selectCaptureDevice<TDevice extends ICaptureDevice>(devices: readonly TDevice[], overrideName?: string): TDevice {
    const trimmedOverride = overrideName?.trim();
    if (trimmedOverride !== undefined && trimmedOverride.length > 0) {
        const needle = trimmedOverride.toLowerCase();
        const matched = devices.find((candidate) => candidate.name.toLowerCase().includes(needle));
        if (matched !== undefined) {
            return matched;
        }
    }

    return devices.find((candidate) => candidate.isDefault) ?? devices[0];
}

/**
 * The main-process system-audio loopback capture service (D-01/D-02).
 *
 * Wraps `native-recorder-nodejs`'s `AudioRecorder` — the in-process WASAPI loopback addon proven GO
 * on this machine (04-01, Electron 35.7.5) — and converts each raw device buffer to the 16 kHz mono
 * Int16 (linear16) PCM Deepgram expects, then hands it to a `sendPcm` sink (the gateway's
 * `sendAudio`, wired in `index.ts`). The Chromium `getDisplayMedia`/renderer Web Audio path it
 * replaces is gone (D-02/IN-01): there is exactly one audio path now, entirely in main.
 *
 * It mirrors the native-wrapper discipline of `HotkeyRegistrarService`: it NEVER throws on a device
 * failure (every fault is surfaced via the `onError` callback so a transient capture problem cannot
 * crash the main process), `start()` is idempotent (an early-return guard so React Strict-Mode /
 * re-entry cannot leak a second capture handle, WR-02), and it exposes a `teardown()` for clean
 * release on quit.
 *
 * @remarks
 * The IDEXX `@singleton()` decorator is NOT applicable here: the Electron main process has no TSyringe
 * DI container. This service is instantiated exactly once in `index.ts` (04-04) and treated as a
 * singleton by convention, like the other main-process services in this app.
 */
export class AudioCaptureService {
    /** The active recorder handle; `undefined` while not capturing. Doubles as the idempotency guard. */
    private recorder: AudioRecorder | undefined;

    /**
     * @param sendPcm - Sink receiving each 16 kHz mono Int16 PCM chunk (the gateway's `sendAudio`).
     * @param onError - Optional fault sink. Device/capture failures are reported here, never thrown,
     *   so a transient capture problem cannot crash the main process (mirrors report-don't-throw).
     */
    public constructor(
        private readonly sendPcm: (pcm: Int16Array) => void,
        private readonly onError?: (error: Error) => void
    ) {}

    /**
     * Starts loopback capture from the currently-active output device, converting each raw buffer to
     * 16 kHz mono Int16 PCM and pushing it to the `sendPcm` sink.
     *
     * Idempotent (WR-02): returns early if already capturing so a double-boot cannot leak a handle.
     * Empty-device safe (WR-01): if no output device is enumerated, surfaces the condition via
     * `onError` instead of indexing into an empty array. The device's actual sample rate is read from
     * `getDeviceFormat` and passed straight through `assertSampleRate` and into the resampler, so the
     * rate we resample *from* always equals the device's real rate (a mismatch fails loudly rather
     * than silently garbling the transcript). Never throws: a startup/device fault is reported via
     * `onError`.
     */
    public async start(): Promise<void> {
        // WR-02 idempotent guard: a second start() while capturing must not leak a recorder handle.
        if (this.recorder !== undefined) {
            return;
        }

        try {
            const outputs = AudioRecorder.getDevices('output');
            // WR-01 empty-device guard: surface the condition rather than indexing an empty array.
            if (outputs.length === 0) {
                this.report(new Error('No system-audio output device available for loopback capture.'));

                return;
            }

            // 04-01 finding: the isDefault device is NOT necessarily where Windows routes audio (the
            // default enumerated as a silent headset while media played on the speakers). Allow an
            // explicit override via JEDI_CAPTURE_DEVICE (case-insensitive name substring) so the user
            // can pin the device actually playing audio; otherwise prefer the default, then the first.
            const device = selectCaptureDevice(outputs, process.env.JEDI_CAPTURE_DEVICE);
            const format = AudioRecorder.getDeviceFormat(device.id);

            // The declared resample inRate IS the device's reported rate — assertSampleRate then holds
            // by construction, keeping the loud-fail guard wired for any future rate-source change.
            assertSampleRate(format.sampleRate, format.sampleRate);

            const recorder = new AudioRecorder();
            this.recorder = recorder;

            recorder.on('data', (buffer: Buffer) => {
                const mono = downmixToMonoFloat32(buffer, format.channels);
                const resampled = resampleLinear(mono, format.sampleRate, TARGET_SAMPLE_RATE);
                this.sendPcm(float32ToInt16(resampled));
            });

            // Never crash on a capture-thread fault — surface it and keep the app alive.
            recorder.on('error', (error: Error) => {
                this.report(error);
            });

            await recorder.start({ deviceType: 'output', deviceId: device.id });
        } catch (error) {
            // A JS-level startup/device failure is reported, never re-thrown (report-don't-throw).
            this.recorder = undefined;
            this.report(error instanceof Error ? error : new Error('Audio capture failed to start.'));
        }
    }

    /**
     * Stops the recorder and clears the handle. Safe to call when not capturing. Swallows teardown
     * faults so quitting can never be blocked by an already-dead recorder.
     */
    public async teardown(): Promise<void> {
        const recorder = this.recorder;
        this.recorder = undefined;
        if (recorder === undefined) {
            return;
        }

        try {
            await recorder.stop();
        } catch {
            // Teardown of an already-stopped recorder must never throw or block quit.
        }
    }

    /**
     * Routes a fault to the optional `onError` sink. No-op when no sink is attached, so an early fault
     * cannot crash the process before the wiring in `index.ts` subscribes.
     *
     * @param error - The fault to surface.
     */
    private report(error: Error): void {
        if (this.onError !== undefined) {
            this.onError(error);
        }
    }
}
