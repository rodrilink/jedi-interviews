/*
 * AudioWorklet processor that computes the RMS level of each incoming Float32 audio
 * frame and posts it to the main thread (D-05).
 *
 * This runs on the audio render thread — its global scope has NO DOM and NO Node, and
 * it cannot import the project's normal modules. The RMS math is therefore inlined
 * here rather than imported from `rms.utility.ts`; that utility stays the unit-tested
 * source of truth for the identical computation. The RMS block is kept clean and
 * isolable so Phase 4 can extend this same worklet to down-mix/resample to 16 kHz mono
 * Int16 PCM for Deepgram (D-02/D-05) without disturbing the metering layer.
 */

/** Minimal ambient surface for the AudioWorklet global scope (no DOM lib in worklets). */
declare const registerProcessor: (name: string, processorCtor: typeof AudioWorkletProcessor) => void;

declare class AudioWorkletProcessor {
    public readonly port: MessagePort;
    public constructor();
}

/**
 * Reads the first input's first channel each render quantum, computes its RMS, and posts
 * the scalar to the main thread for the HUD `Audio:` row.
 *
 * @remarks
 * Returns `true` from {@link RmsMeterProcessor.process} to keep the node alive for the
 * lifetime of the capture, even across silent frames.
 */
class RmsMeterProcessor extends AudioWorkletProcessor {
    /**
     * Computes the RMS of the first input channel and posts it to the main thread.
     *
     * @param inputs - Per-input arrays of per-channel Float32 frames for this quantum.
     * @returns Always `true` to keep the processor (and its source node) alive.
     */
    public process(inputs: Float32Array[][]): boolean {
        const channel = inputs[0]?.[0];
        if (channel === undefined || channel.length === 0) {
            this.port.postMessage(0);
            return true;
        }

        let sumOfSquares = 0;
        for (let index = 0; index < channel.length; index++) {
            const sample = channel[index];
            sumOfSquares += sample * sample;
        }

        const rms = Math.sqrt(sumOfSquares / channel.length);
        this.port.postMessage(rms);

        return true;
    }
}

registerProcessor('rms-meter', RmsMeterProcessor);
