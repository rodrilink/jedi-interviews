import { describe, expect, it } from 'vitest';
import { assertSampleRate, downmixToMonoFloat32, float32ToInt16, resampleLinear } from './pcm-resample.utility';

/** Builds an interleaved 16-bit LE stereo Buffer from [left, right] sample pairs. */
function buildStereoInt16LeBuffer(framePairs: ReadonlyArray<readonly [number, number]>): Buffer {
    const buffer: Buffer = Buffer.alloc(framePairs.length * 2 * 2);
    for (let frame = 0; frame < framePairs.length; frame++) {
        buffer.writeInt16LE(framePairs[frame][0], frame * 4);
        buffer.writeInt16LE(framePairs[frame][1], frame * 4 + 2);
    }
    return buffer;
}

describe('pcm-resample.utility', () => {
    describe('downmixToMonoFloat32', () => {
        it('should average the two channels of a 4-frame stereo buffer into [-1, 1] mono samples', () => {
            // Arrange
            const stereo: Buffer = buildStereoInt16LeBuffer([
                [32767, 32767],
                [-32768, -32768],
                [16384, 0],
                [0, 0],
            ]);
            const expected: Float32Array = new Float32Array([32767 / 32768, -1, 16384 / 32768 / 2, 0]);

            // Act
            const mono: Float32Array = downmixToMonoFloat32(stereo, 2);

            // Assert
            expect(mono.length).toBe(4);
            expect(mono[0]).toBeCloseTo(expected[0], 6);
            expect(mono[1]).toBeCloseTo(expected[1], 6);
            expect(mono[2]).toBeCloseTo(expected[2], 6);
            expect(mono[3]).toBe(0);
        });

        it('should return an empty Float32Array for an empty buffer', () => {
            // Arrange
            const empty: Buffer = Buffer.alloc(0);

            // Act
            const mono: Float32Array = downmixToMonoFloat32(empty, 2);

            // Assert
            expect(mono.length).toBe(0);
        });
    });

    describe('resampleLinear', () => {
        it('should produce floor(input.length / 3) samples when downsampling 48000 to 16000', () => {
            // Arrange
            const input: Float32Array = new Float32Array(30).fill(0.5);

            // Act
            const output: Float32Array = resampleLinear(input, 48000, 16000);

            // Assert
            expect(output.length).toBe(10);
        });

        it('should return the input unchanged when inRate equals outRate (passthrough)', () => {
            // Arrange
            const input: Float32Array = new Float32Array([0.1, 0.2, 0.3, 0.4]);

            // Act
            const output: Float32Array = resampleLinear(input, 16000, 16000);

            // Assert
            expect(output).toBe(input);
        });
    });

    describe('float32ToInt16', () => {
        it('should map 1, -1, and 0 to 32767, -32768, and 0 with asymmetric scaling', () => {
            // Arrange
            const input: Float32Array = new Float32Array([1, -1, 0]);

            // Act
            const output: Int16Array = float32ToInt16(input);

            // Assert
            expect(Array.from(output)).toEqual([32767, -32768, 0]);
        });

        it('should clamp out-of-range values to the [-1, 1] domain before scaling', () => {
            // Arrange
            const input: Float32Array = new Float32Array([2, -2]);

            // Act
            const output: Int16Array = float32ToInt16(input);

            // Assert
            expect(Array.from(output)).toEqual([32767, -32768]);
        });
    });

    describe('assertSampleRate', () => {
        it('should not throw when the declared rate equals the actual rate', () => {
            // Arrange
            const rate: number = 48000;

            // Act / Assert
            expect(() => assertSampleRate(rate, rate)).not.toThrow();
        });

        it('should throw a descriptive Error when the declared rate differs from the actual rate', () => {
            // Arrange
            const declaredRate: number = 48000;
            const actualRate: number = 44100;

            // Act / Assert
            expect(() => assertSampleRate(declaredRate, actualRate)).toThrow();
        });
    });
});
