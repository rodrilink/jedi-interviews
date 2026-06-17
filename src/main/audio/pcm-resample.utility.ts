/**
 * Pure PCM conversion utilities (TRN-01).
 *
 * The WASAPI capture addon (`native-recorder-nodejs`) emits interleaved 16-bit little-endian PCM
 * at the device's native format — proven on this machine to be 48 kHz stereo (Task 1 go/no-go).
 * Deepgram's live linear16 endpoint wants 16 kHz mono Int16. These four functions bridge that gap:
 * down-mix stereo to mono, resample to 16 kHz, convert Float32 back to Int16, and — critically —
 * assert that the rate we resample *from* matches the device's actual rate, so a wrong assumption
 * fails loudly instead of silently producing a pitch-shifted, garbled transcript.
 *
 * Every function is pure and idempotent: no classes, no shared state, no side effects.
 */

/**
 * Down-mixes an interleaved 16-bit LE PCM buffer to mono Float32 in `[-1, 1)`.
 *
 * Each frame's channels are averaged. Samples are normalized by dividing by 32768 (matching the
 * asymmetric Int16 domain `[-32768, 32767]`), so a full-scale negative sample maps to exactly -1.
 *
 * @param pcm - Interleaved 16-bit little-endian PCM (2 bytes per sample, `channels` samples per frame).
 * @param channels - The number of interleaved channels (e.g. 2 for stereo).
 * @returns A mono Float32Array (one sample per frame); empty for an empty buffer.
 */
export function downmixToMonoFloat32(pcm: Buffer, channels: number): Float32Array {
    const frames = Math.floor(pcm.length / 2 / channels);
    if (frames === 0) {
        return new Float32Array(0);
    }

    const out = new Float32Array(frames);
    for (let frame = 0; frame < frames; frame++) {
        let sum = 0;
        for (let channel = 0; channel < channels; channel++) {
            const sample = pcm.readInt16LE((frame * channels + channel) * 2);
            sum += sample / 32768;
        }
        out[frame] = sum / channels;
    }
    return out;
}

/**
 * Resamples a mono Float32 signal from `inRate` to `outRate` using linear interpolation.
 *
 * Linear interpolation is adequate for speech-to-text; a polyphase/FIR resampler would be
 * overkill here. Returns the input unchanged (same reference) when the rates are equal.
 *
 * @param input - The mono Float32 samples at `inRate`.
 * @param inRate - The input sample rate in Hz (must equal the device's actual rate — see {@link assertSampleRate}).
 * @param outRate - The desired output sample rate in Hz (16000 for Deepgram linear16).
 * @returns The resampled Float32Array of length `floor(input.length / (inRate / outRate))`.
 */
export function resampleLinear(input: Float32Array, inRate: number, outRate: number): Float32Array {
    if (inRate === outRate) {
        return input;
    }

    const ratio = inRate / outRate;
    const outLength = Math.floor(input.length / ratio);
    const out = new Float32Array(outLength);
    for (let index = 0; index < outLength; index++) {
        const position = index * ratio;
        const left = Math.floor(position);
        const right = Math.min(left + 1, input.length - 1);
        const fraction = position - left;
        out[index] = input[left] * (1 - fraction) + input[right] * fraction;
    }
    return out;
}

/**
 * Converts a mono Float32 signal in `[-1, 1]` to Int16 for Deepgram's linear16 encoding.
 *
 * Out-of-range values are clamped to `[-1, 1]` first, then scaled asymmetrically: negatives by
 * 32768 (so -1 maps to -32768) and non-negatives by 32767 (so 1 maps to 32767), matching the
 * Int16 domain.
 *
 * @param input - The mono Float32 samples to convert.
 * @returns An Int16Array of the same length.
 */
export function float32ToInt16(input: Float32Array): Int16Array {
    const out = new Int16Array(input.length);
    for (let index = 0; index < input.length; index++) {
        const clamped = Math.max(-1, Math.min(1, input[index]));
        out[index] = clamped < 0 ? clamped * 32768 : clamped * 32767;
    }
    return out;
}

/**
 * Asserts that the sample rate we declare to the resampler matches the device's actual rate.
 *
 * A mismatch silently produces pitch- and timing-shifted audio that Deepgram transcribes into
 * nonsense with no error, so this guard fails loudly instead (the ROADMAP "declared == actual"
 * rule). It throws a plain `Error` — the local precedent for failing loudly on a broken invariant
 * (this app has no `ipay-common-lib` typed errors; see `preload/index.ts`).
 *
 * @param declaredRate - The rate passed to {@link resampleLinear} as `inRate`.
 * @param actualRate - The device's real sample rate from `AudioRecorder.getDeviceFormat()`.
 * @throws {Error} When `declaredRate !== actualRate`.
 */
export function assertSampleRate(declaredRate: number, actualRate: number): void {
    if (declaredRate !== actualRate) {
        throw new Error(`Declared sample rate ${declaredRate} Hz does not match the device's actual rate ${actualRate} Hz — refusing to resample (would garble the transcript).`);
    }
}
