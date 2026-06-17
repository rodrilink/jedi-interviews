/**
 * Computes the root-mean-square (RMS) amplitude of a single Float32 audio frame.
 *
 * RMS is `sqrt(sum(sample^2) / length)` — the standard scalar measure of signal
 * energy. For normalized PCM samples in `[-1, 1]` the result lies in `[0, 1]`: a
 * silent (all-zero) frame yields exactly 0 (the "audio paused reads ~0" property,
 * D-06) and a full-scale frame (all `±1`) yields 1. This is the unit-tested source
 * of truth for the RMS math; the AudioWorklet inlines the same computation because
 * its global scope cannot import project modules (D-05).
 *
 * @param frame - The Float32 audio samples to measure.
 * @returns The RMS amplitude in `[0, 1]` for normalized input; 0 for an empty frame.
 */
export function computeRms(frame: Float32Array): number {
    if (frame.length === 0) {
        return 0;
    }

    let sumOfSquares = 0;
    for (let index = 0; index < frame.length; index++) {
        const sample = frame[index];
        sumOfSquares += sample * sample;
    }

    return Math.sqrt(sumOfSquares / frame.length);
}
