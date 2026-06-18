/**
 * Computes the root-mean-square (RMS) amplitude of an Int16 PCM frame, normalized to `[0, 1]`.
 *
 * RMS is `sqrt(sum(sample^2) / length)`, the standard scalar measure of signal energy. Each Int16
 * sample is normalized by 32768 (the `[-32768, 32767]` domain) before squaring, so a silent frame
 * yields 0 and a full-scale frame approaches 1. This is the main-process counterpart to the
 * renderer's `computeRms` (Float32) — main captures Int16 PCM, so it needs the Int16 form. Pure and
 * side-effect free.
 *
 * @param frame - The Int16 PCM samples to measure.
 * @returns The RMS amplitude in `[0, 1]`; 0 for an empty frame.
 */
export function computeRmsInt16(frame: Int16Array): number {
    if (frame.length === 0) {
        return 0;
    }

    let sumOfSquares = 0;
    for (let index = 0; index < frame.length; index++) {
        const sample = frame[index] / 32768;
        sumOfSquares += sample * sample;
    }

    return Math.sqrt(sumOfSquares / frame.length);
}
