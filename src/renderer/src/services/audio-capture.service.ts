/**
 * Path (relative to the renderer document) of the transpiled `rms-meter` AudioWorklet module,
 * emitted as a dedicated rollup entry by electron.vite.config.ts at this fixed name. Resolved
 * against `window.location` so it works under both the dev server (`ELECTRON_RENDERER_URL`) and
 * the packaged `file://` index. `audioContext.audioWorklet.addModule` loads it at runtime.
 */
const WORKLET_ASSET_PATH = 'assets/rms-meter.worklet.js';

/** How often (ms) the latest RMS level is forwarded to the HUD — ~12 Hz, readable without width jitter. */
const LEVEL_REPORT_INTERVAL_MS = 80;

/**
 * The renderer-side system-audio loopback capture seam (D-01/D-02).
 *
 * `start()` opens a loopback `MediaStream` via `getDisplayMedia`, runs it through the
 * `rms-meter` AudioWorklet, and forwards the latest RMS level to the main process over the
 * narrow write-only `jedi:audio-level` channel (which re-broadcasts it on `jedi:status` for
 * the HUD `Audio:` row, D-04). Capture auto-starts with no picker and no user gesture
 * (D-03) — see {@link App}. This is the real Phase 4 audio source, not throwaway spike code:
 * Phase 4 extends the same worklet to emit 16 kHz Int16 PCM for Deepgram.
 *
 * @remarks
 * There is no DI container in the renderer (no TSyringe), so this is instantiated once at the
 * renderer entry and treated as a singleton by convention, mirroring `WindowControlActionsService`
 * in the main process.
 */
export class AudioCaptureService {
    private stream: MediaStream | undefined;

    private audioContext: AudioContext | undefined;

    private lastReportedAt = 0;

    /**
     * Starts loopback capture: grabs the system-audio stream (discarding video), wires it
     * through the RMS AudioWorklet, and begins forwarding throttled RMS levels to main.
     *
     * `getDisplayMedia` is called with `video: true` present because `audio: true, video: false`
     * throws on Windows; the granted video track is stopped and discarded immediately (the
     * `setDisplayMediaRequestHandler` in main supplies the loopback source with no picker, D-03).
     *
     * @returns A promise that resolves once the worklet is wired and capture is running.
     */
    public async start(): Promise<void> {
        const stream = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true });
        this.stream = stream;

        for (const videoTrack of stream.getVideoTracks()) {
            videoTrack.stop();
            stream.removeTrack(videoTrack);
        }

        const audioContext = new AudioContext();
        this.audioContext = audioContext;

        const workletUrl = new URL(WORKLET_ASSET_PATH, window.location.href).href;
        await audioContext.audioWorklet.addModule(workletUrl);

        const source = audioContext.createMediaStreamSource(stream);
        const meterNode = new AudioWorkletNode(audioContext, 'rms-meter');

        meterNode.port.onmessage = (event: MessageEvent<number>): void => {
            const now = Date.now();
            if (now - this.lastReportedAt < LEVEL_REPORT_INTERVAL_MS) {
                return;
            }

            this.lastReportedAt = now;
            window.jedi?.reportAudioLevel(event.data);
        };

        source.connect(meterNode);
    }

    /**
     * Stops all capture tracks and closes the AudioContext for clean teardown (called from the
     * renderer-entry effect cleanup). Idempotent: safe to call when capture never started.
     *
     * @returns A promise that resolves once teardown is complete.
     */
    public async stop(): Promise<void> {
        if (this.stream !== undefined) {
            for (const track of this.stream.getTracks()) {
                track.stop();
            }

            this.stream = undefined;
        }

        if (this.audioContext !== undefined) {
            await this.audioContext.close();
            this.audioContext = undefined;
        }
    }
}
